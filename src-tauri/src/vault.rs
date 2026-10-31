// Vault - Secure storage for sensitive data
// Uses AES-GCM encryption with Argon2 key derivation

use crate::errors::VaultError;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{password_hash::SaltString, Argon2, PasswordHasher};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use hmac::{Hmac, Mac};
use parking_lot::Mutex;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;
use zeroize::{Zeroize, Zeroizing};

/// Vault configuration stored on disk.
///
/// Shape: one Argon2 salt, base64 `nonce || ciphertext` entries per key, and an
/// optional password verifier. Vaults written before the verifier existed have
/// no `verifier` field at all and still parse (`#[serde(default)]`); every write
/// from this build on sets it. `Clone` exists so a save can build the next state,
/// persist it atomically, and only then adopt it in memory.
#[derive(Clone, Serialize, Deserialize)]
struct VaultConfig {
    /// Salt for key derivation
    salt: String,
    /// Encrypted entries
    entries: HashMap<String, String>, // key -> encrypted base64 value
    /// base64(HMAC-SHA256(master_key, VERIFIER_DOMAIN || salt)).
    ///
    /// `None` means "written before the verifier existed". It is never set on a
    /// write again: create, change_password and the legacy migration all fill it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    verifier: Option<String>,
}

/// Vault entry structure
#[derive(Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct VaultEntry {
    pub key: String,
    pub value: String, // Decrypted value
    pub description: Option<String>,
}

/// Vault state
pub struct VaultState {
    config: VaultConfig,
    master_key: [u8; 32], // Derived from master password
    config_path: PathBuf,
}

impl VaultState {
    /// Create a new vault with a master password.
    ///
    /// Creation never overwrites: the target path is claimed with exclusive
    /// create semantics first, so an existing `vault.json` makes this fail with
    /// `AlreadyExists` and keeps every byte of it. A caller that really wants to
    /// replace an existing vault needs a separate, explicit destructive
    /// operation; this API deliberately has none.
    pub fn create(master_password: &str, config_path: PathBuf) -> Result<Self, VaultError> {
        let salt = SaltString::generate(&mut OsRng);
        let master_key =
            derive_master_key(master_password, &salt).map_err(VaultError::CreateFailed)?;
        let salt = salt.to_string();

        let config = VaultConfig {
            verifier: Some(encode_verifier(&master_key, &salt)),
            salt,
            entries: HashMap::new(),
        };

        let mut vault = Self {
            config,
            master_key,
            config_path,
        };

        let initial = vault.config.clone();
        vault.create_exclusive(initial)?;

        Ok(vault)
    }

    /// Unlock an existing vault with master password.
    ///
    /// The password is decided here, before the caller ever holds a `VaultState`,
    /// and only by evidence that exists in the file:
    ///
    /// 1. `verifier` present (every vault written by this build): an HMAC check,
    ///    so a wrong password fails at unlock instead of at the first `get`, and
    ///    an empty vault is no longer openable with any string at all.
    /// 2. `verifier` absent, `entries` non-empty (legacy vault): a real entry is
    ///    decrypted; AES-GCM authentication makes that a sufficient proof. A
    ///    success seals the vault with a verifier through the normal commit
    ///    boundary, which is the only migration step this format needs.
    /// 3. `verifier` absent, `entries` empty (legacy vault): **the password is not
    ///    verifiable and this build does not pretend otherwise.** There is no
    ///    ciphertext and no verifier, i.e. no material that any password could be
    ///    checked against, so the only compatible choice is to accept the
    ///    supplied password and seal it with a verifier. Accepted cost: whoever
    ///    presents the first password after the upgrade fixes the password of
    ///    that empty legacy vault. Nothing can be lost, because the vault is
    ///    empty; a legacy vault that holds data always takes path 2.
    ///
    /// A migration write never fails an unlock: on error the legacy file and the
    /// legacy password keep working exactly as before, and the next successful
    /// save finishes the migration.
    ///
    /// A path that holds no vault is refused with a state-specific error and is
    /// never rewritten: `Uninitialized` for the zero-length placeholder of an
    /// interrupted create (recoverable by creating again) and `Corrupt` for
    /// anything this format cannot parse (kept byte for byte for manual
    /// recovery). See `read_vault_file`.
    pub fn unlock(master_password: &str, config_path: PathBuf) -> Result<Self, VaultError> {
        let content = read_vault_file(&config_path)?;

        let config: VaultConfig = serde_json::from_str(&content).map_err(|e| {
            VaultError::Corrupt(format!(
                "vault file {} cannot be parsed ({}); it was left untouched for manual recovery",
                config_path.display(),
                e
            ))
        })?;

        // Re-derive key using stored salt
        let salt = SaltString::from_b64(&config.salt)
            .map_err(|e| VaultError::UnlockFailed(format!("Invalid salt: {}", e)))?;
        let master_key =
            derive_master_key(master_password, &salt).map_err(VaultError::UnlockFailed)?;

        if let Some(stored) = config.verifier.as_deref() {
            if !verifier_matches(stored, &master_key, &config.salt) {
                // No message detail here: a verifier mismatch must not hint at
                // how much of the password was right.
                return Err(VaultError::InvalidPassword);
            }
            return Ok(Self {
                config,
                master_key,
                config_path,
            });
        }

        if !config.entries.is_empty() {
            let decrypts = config
                .entries
                .values()
                .any(|encrypted| decrypt_value(encrypted, &master_key).is_ok());
            if !decrypts {
                return Err(VaultError::InvalidPassword);
            }
            return Ok(Self::seal_legacy(config, master_key, config_path));
        }

        log::warn!(
            "vault: legacy vault at {} carries neither a verifier nor entries, so the master password cannot be verified; the supplied password is adopted and sealed",
            config_path.display()
        );
        Ok(Self::seal_legacy(config, master_key, config_path))
    }

    /// Adopt a verifier-less legacy vault for the key that just unlocked it.
    fn seal_legacy(config: VaultConfig, master_key: [u8; 32], config_path: PathBuf) -> Self {
        let mut vault = Self {
            config,
            master_key,
            config_path,
        };
        vault.migrate_verifier();
        vault
    }

    /// Write a verifier for the current key, best effort.
    ///
    /// Failure is logged and swallowed on purpose: the legacy file is untouched,
    /// so the old password keeps working, and the verifier stays in memory so the
    /// next successful commit persists it. Nothing here is allowed to turn a
    /// working unlock into a failed one.
    fn migrate_verifier(&mut self) {
        if self.config.verifier.is_some() {
            return;
        }

        let verifier = encode_verifier(&self.master_key, &self.config.salt);
        let mut candidate = self.config.clone();
        candidate.verifier = Some(verifier.clone());

        match self.commit(candidate) {
            Ok(()) => {}
            Err(error) => {
                log::warn!(
                    "vault: verifier migration could not be persisted, keeping the legacy file: {}",
                    error
                );
                self.config.verifier = Some(verifier);
            }
        }
    }

    /// Check if vault exists.
    ///
    /// A zero-length file does not count: it is the exclusive-claim placeholder of
    /// a create that never finished (see `is_unfilled_placeholder`), so reporting
    /// it as "no vault yet" is what lets the create flow complete that
    /// initialization instead of offering an unlock that cannot succeed. A
    /// damaged vault does count: it exists, and it must not be created over.
    pub fn exists(config_path: &Path) -> bool {
        match fs::symlink_metadata(config_path) {
            Ok(metadata) => !(metadata.file_type().is_file() && metadata.len() == 0),
            Err(_) => false,
        }
    }

    /// Encrypt and store a value.
    ///
    /// The entry goes into a candidate config that is persisted first; the
    /// in-memory map only changes once the vault file was durably replaced, so a
    /// failed save never leaves memory ahead of the file on disk.
    pub fn set(&mut self, key: &str, value: &str) -> Result<(), VaultError> {
        let encrypted = encrypt_value(value, &self.master_key)?;
        let mut config = self.config.clone();
        config.entries.insert(key.to_string(), encrypted);
        self.commit(config)
    }

    /// Decrypt and retrieve a value
    pub fn get(&self, key: &str) -> Result<String, VaultError> {
        let encrypted = self
            .config
            .entries
            .get(key)
            .ok_or_else(|| VaultError::KeyNotFound(key.to_string()))?;
        decrypt_value(encrypted, &self.master_key)
    }

    /// List all vault keys
    pub fn list_keys(&self) -> Vec<String> {
        self.config.entries.keys().cloned().collect()
    }

    /// Delete a vault entry.
    ///
    /// Same commit boundary as set: the removal reaches the disk before it
    /// reaches memory.
    pub fn delete(&mut self, key: &str) -> Result<(), VaultError> {
        let mut config = self.config.clone();
        if config.entries.remove(key).is_none() {
            return Err(VaultError::KeyNotFound(key.to_string()));
        }
        self.commit(config)
    }

    /// Change master password.
    ///
    /// Commit boundary: the re-encrypted config with the new salt and the new
    /// verifier is written atomically first; the salt, entries and master key are
    /// swapped in memory only after that replace succeeded. If persistence fails,
    /// the old password still decrypts the untouched vault file and still works
    /// in memory. The verifier always moves with the salt: a rotation that shipped
    /// a stale verifier would reject the new password on the next unlock.
    pub fn change_password(&mut self, new_password: &str) -> Result<(), VaultError> {
        let new_salt = SaltString::generate(&mut OsRng);
        // Wrapped so a failed save wipes the derived key instead of leaking it.
        let new_master_key = Zeroizing::new(
            derive_master_key(new_password, &new_salt).map_err(VaultError::CreateFailed)?,
        );

        // Re-encrypt every entry with the new key; the plaintext of one entry
        // lives for a single iteration and is wiped when `plaintext` drops.
        let mut entries = HashMap::with_capacity(self.config.entries.len());
        for (key, encrypted) in &self.config.entries {
            let plaintext = Zeroizing::new(decrypt_value(encrypted, &self.master_key)?);
            entries.insert(
                key.clone(),
                encrypt_value(plaintext.as_str(), &new_master_key)?,
            );
        }

        let new_salt = new_salt.to_string();
        let candidate = VaultConfig {
            verifier: Some(encode_verifier(&new_master_key, &new_salt)),
            salt: new_salt,
            entries,
        };

        // Commit point: nothing below this line runs unless the durable replace
        // succeeded, so a failed save leaves the old password fully usable.
        self.commit(candidate)?;
        self.master_key = *new_master_key;

        Ok(())
    }

    /// Atomically replace the vault file with `config`, then adopt it in memory.
    ///
    /// This is the only function that writes an existing vault, so set, delete,
    /// change_password and the verifier migration share one commit point: durable
    /// replace first, in-memory state second.
    fn commit(&mut self, config: VaultConfig) -> Result<(), VaultError> {
        write_atomic(&self.config_path, &serialize_config(&config)?)?;
        self.config = config;
        Ok(())
    }

    /// First write of a brand new vault: claim the path, then fill it atomically.
    ///
    /// The claim is `O_CREAT | O_EXCL` on Unix and `CREATE_NEW` on Windows, i.e.
    /// one kernel operation that fails when anything already occupies the path.
    /// Nothing here asks "does the vault exist?" and then writes, so no racing
    /// create, script or hand edit can slip in between the answer and the write.
    ///
    /// The claim is an empty placeholder that the normal atomic replace then
    /// overwrites, which keeps the first write on the same durability path as
    /// every later one. If that replace fails the placeholder is ours alone, so
    /// it is removed again and a failed create leaves no vault file behind.
    ///
    /// The one thing a claim cannot survive is the process dying between the two
    /// steps: the placeholder stays behind as a zero-length `vault.json`. The
    /// next create recognises it with `is_unfilled_placeholder` and fills it
    /// through the same atomic replace, so recovery never unlinks a path that
    /// could hold a vault. Any file with content at all is refused as
    /// `AlreadyExists`, whatever it parses to.
    ///
    /// Reclaiming is a check followed by a replace, and both steps run inside
    /// `lock_for_create`, so no other instance of this build can be between its
    /// own check and its own replace at the same time. That removes the window the
    /// pair used to leave open: a second creator landing its vault in that gap is
    /// now either serialised behind the first one (and then refused by the
    /// re-check it performs *after* it takes the lock) or blocked by the lock.
    ///
    /// Residual window, quantified: the lock is advisory, so a writer that does
    /// not take it -- a hand edit, a script, a build older than this one -- can
    /// still produce content between the re-check and the replace. What remains is
    /// one metadata read immediately followed by one `rename` (both
    /// sub-microsecond), and that writer has to land a complete `vault.json`
    /// inside an interval nothing signals to it. Two instances of this build, or
    /// two windows of it, cannot reach the window at all: they serialise on the
    /// lock, and the loser's re-check (which runs after it holds the lock) sees
    /// the winner's content and returns `AlreadyExists`.
    fn create_exclusive(&mut self, config: VaultConfig) -> Result<(), VaultError> {
        let content = serialize_config(&config)?;
        let claim = claim_new_vault_file(&self.config_path)?;

        #[cfg(test)]
        if fault_injection::take_claim_crash() {
            // Simulated process death between the claim and the fill: the
            // placeholder stays on disk, exactly like an interrupted create.
            return Err(VaultError::SaveFailed(
                "injected crash after the exclusive claim".to_string(),
            ));
        }

        match claim {
            Claim::Fresh(handle) => {
                // The claim decided that this process may create a vault; the lock
                // keeps a *reclaiming* creator out of the window between its own
                // re-check and its replace while this one fills the file.
                lock_for_create(&self.config_path, &handle)?;
                if let Err(error) = write_atomic(&self.config_path, &content) {
                    // Release the handle before unlinking so Windows can delete it too.
                    drop(handle);
                    let _ = fs::remove_file(&self.config_path);
                    return Err(error);
                }
                drop(handle);
            }
            Claim::Reclaimed => {
                // Recovery is only ever allowed to overwrite a zero-length regular
                // file, and the verdict has to stay true until the replace lands.
                // The lock is what makes those two steps one critical section: a
                // creator that is also in this branch cannot re-check the file
                // while this one is replacing it, and any content another creator
                // wrote before this point is refused instead of overwritten.
                let guard = fs::File::open(&self.config_path).map_err(|error| {
                    save_failed(
                        "Failed to open the vault placeholder",
                        &self.config_path,
                        &error,
                    )
                })?;
                lock_for_create(&self.config_path, &guard)?;

                // Re-check the proof immediately before the replace.
                if !is_unfilled_placeholder(&self.config_path)? {
                    return Err(VaultError::AlreadyExists);
                }

                #[cfg(test)]
                if let Some(millis) = fault_injection::take_reclaim_delay() {
                    // Fault injection: hold the critical section open so a second
                    // creator has every chance to slip in between the re-check and
                    // the replace. Without the lock this is where two creates both
                    // observe an empty placeholder and both overwrite the path.
                    std::thread::sleep(std::time::Duration::from_millis(millis));
                }

                // A failed replace leaves the placeholder exactly where it was, so
                // the next attempt starts from the same recoverable state.
                write_atomic(&self.config_path, &content)?;
            }
        }

        self.config = config;
        Ok(())
    }
}

impl Drop for VaultState {
    fn drop(&mut self) {
        // Wipe the derived AES key when the vault is locked or replaced.
        self.master_key.zeroize();
    }
}

/// Derive the 32-byte AES key from the master password and salt.
///
/// Returns a plain message so create, unlock and change_password keep their own
/// error variants. The message never contains the password.
fn derive_master_key(master_password: &str, salt: &SaltString) -> Result<[u8; 32], String> {
    let hash = Argon2::default()
        .hash_password(master_password.as_bytes(), salt)
        .map_err(|e| format!("Failed to derive key: {}", e))?;

    let hash_output = hash
        .hash
        .ok_or_else(|| "Failed to get hash output".to_string())?;

    let mut master_key = [0u8; 32];
    let hash_bytes = hash_output.as_bytes();
    let len = std::cmp::min(hash_bytes.len(), 32);
    master_key[..len].copy_from_slice(&hash_bytes[..len]);
    Ok(master_key)
}

// ==================== Password verifier ====================

/// Domain separation for the password verifier.
///
/// The verifier is an HMAC over this label plus the stored salt under the
/// derived master key, never the key itself and never anything derived from the
/// password alone: holding the vault file yields no offline test faster than
/// Argon2, and a value minted for this purpose cannot be replayed as an AES key
/// or as an authenticator for anything else. The label is a compile-time
/// constant that is never stored, so the file leaks neither.
const VERIFIER_DOMAIN: &[u8] = b"terminal-vault-verifier-v1";

type HmacSha256 = Hmac<Sha256>;

/// Raw 32-byte verifier for the salt under the given master key.
fn verifier_mac(master_key: &[u8; 32], salt: &str) -> [u8; 32] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(master_key)
        .expect("HMAC-SHA256 accepts any key length");
    mac.update(VERIFIER_DOMAIN);
    mac.update(salt.as_bytes());

    let tag = mac.finalize().into_bytes();
    let mut verifier = [0u8; 32];
    verifier.copy_from_slice(&tag);
    verifier
}

/// The stored form of the verifier: base64 of the HMAC.
fn encode_verifier(master_key: &[u8; 32], salt: &str) -> String {
    BASE64.encode(verifier_mac(master_key, salt))
}

/// Constant-time verifier check.
///
/// HMAC verify compares through a constant-time equality, so a mismatch cannot
/// be turned into a byte-by-byte oracle, and a stored value that is not valid
/// base64 is rejected without comparing anything.
fn verifier_matches(stored: &str, master_key: &[u8; 32], salt: &str) -> bool {
    let Ok(expected) = BASE64.decode(stored) else {
        return false;
    };

    let mut mac = <HmacSha256 as Mac>::new_from_slice(master_key)
        .expect("HMAC-SHA256 accepts any key length");
    mac.update(VERIFIER_DOMAIN);
    mac.update(salt.as_bytes());
    mac.verify_slice(&expected).is_ok()
}

// ==================== Atomic persistence ====================

/// Write `bytes` to `path` through a same-directory temporary file.
///
/// Strategy: `NamedTempFile::new_in(dir)` keeps the temporary file on the same
/// filesystem as the target (a rename across filesystems is not atomic), then
/// write -> flush -> `sync_all` -> `persist`. `persist` is `rename(2)` on Unix
/// and `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)` on Windows, so both
/// platforms replace an existing `vault.json` in one step: Windows needs no
/// remove-then-rename dance, and neither platform can expose a truncated vault
/// because the old file stays readable until the new one is fully written and
/// synced.
///
/// Cleanup: `temp` owns the temporary file, so every error return below and any
/// panic during unwinding drop it and unlink it. A failed save therefore never
/// leaves a half-written vault file, nor a stray temporary file.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), VaultError> {
    let dir = path.parent().ok_or_else(|| {
        VaultError::SaveFailed(format!(
            "Vault path has no parent directory: {}",
            path.display()
        ))
    })?;

    let mut temp = NamedTempFile::new_in(dir)
        .map_err(|e| save_failed("Failed to create temporary vault file", dir, &e))?;
    let temp_path = temp.path().to_path_buf();

    write_payload(&mut temp, bytes, &temp_path)?;
    restrict_temp_permissions(&temp, path, &temp_path)?;
    temp.as_file()
        .sync_all()
        .map_err(|e| save_failed("Failed to sync temporary vault file", &temp_path, &e))?;

    if let Err(error) = temp.persist(path) {
        // `error.file` still owns the temporary file, so dropping it removes it.
        return Err(save_failed(
            "Failed to replace vault file",
            path,
            &error.error,
        ));
    }

    sync_parent_dir(dir);
    Ok(())
}

/// Serialize a config for the write path.
fn serialize_config(config: &VaultConfig) -> Result<Vec<u8>, VaultError> {
    serde_json::to_vec_pretty(config)
        .map_err(|e| VaultError::SaveFailed(format!("Failed to serialize config: {}", e)))
}

/// `OpenOptions` that create the vault file only while the path is still free.
#[cfg(unix)]
fn exclusive_create_options() -> fs::OpenOptions {
    use std::os::unix::fs::OpenOptionsExt;

    let mut options = fs::OpenOptions::new();
    // mode 0600: the placeholder is owner-only from the first byte, and
    // `restrict_temp_permissions` carries that mode onto the replaced file.
    options.write(true).create_new(true).mode(0o600);
    options
}

/// Windows has no POSIX mode bits; `create_new` maps to `CREATE_NEW`, which is
/// the exclusive half that matters here, and the placeholder inherits the vault
/// directory ACL exactly like the vault file that replaces it.
#[cfg(not(unix))]
fn exclusive_create_options() -> fs::OpenOptions {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    options
}

/// Claim a path for a brand new vault, or explain why it cannot be claimed.
///
/// `create_new(true)` is the exclusive-create flag: `O_CREAT | O_EXCL` on Unix,
/// `CREATE_NEW` on Windows. Both fail atomically when the path is taken, which
/// is what removes the check-then-write window instead of shrinking it.
fn claim_new_vault_file(path: &Path) -> Result<Claim, VaultError> {
    match exclusive_create_options().open(path) {
        Ok(file) => Ok(Claim::Fresh(file)),
        Err(error) => {
            // Something that cannot hold a vault (a directory, a device) is not
            // "a vault already exists": reporting AlreadyExists there would tell
            // the caller it is safe to unlock a path that is not a vault.
            if path.is_dir() {
                return Err(save_failed("Failed to create the vault file", path, &error));
            }
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                if is_unfilled_placeholder(path)? {
                    return Ok(Claim::Reclaimed);
                }
                return Err(VaultError::AlreadyExists);
            }
            Err(save_failed("Failed to create the vault file", path, &error))
        }
    }
}

/// What claiming the vault path found.
enum Claim {
    /// The path was free and this process now holds the empty placeholder.
    Fresh(fs::File),
    /// The path held a zero-length placeholder from an interrupted create. The
    /// caller fills it with one atomic replace; nothing is unlinked.
    Reclaimed,
}

/// How long a creator waits for another process to leave its create critical
/// section: 200 attempts of 10 ms, i.e. two seconds in total.
///
/// The critical section it waits on is a re-check plus one rename, so in practice
/// the wait is one scheduler tick. The bound exists so a peer that is wedged or
/// swapped out surfaces as an error instead of hanging the create command.
const CREATE_LOCK_ATTEMPTS: u32 = 200;
const CREATE_LOCK_RETRY: std::time::Duration = std::time::Duration::from_millis(10);

/// Take the exclusive advisory lock that serialises vault creation.
///
/// The exclusive claim decides *who may create* a vault, but it cannot serialise
/// the recovery path: a reclaim has to prove the placeholder is still empty and
/// then replace it, and a second creator could fill the path between those two
/// steps. This lock turns the pair into one critical section:
///
/// * taken on the vault file itself, so nothing new appears in the vault
///   directory and no sidecar file can go stale;
/// * the kernel's lock (`flock(2)` on Unix, `LockFileEx` on Windows), released when
///   the handle drops, so a killed or crashed process cannot leave a lock behind
///   that blocks the next start -- a lock *file* could;
/// * taken before the re-check and released only after the replace, so a creator
///   that re-checks while a replace is in flight cannot see a stale "empty"
///   verdict and overwrite the file that replace just wrote.
///
/// Participation is by convention: only this build takes it. Residual window and
/// its quantification are described on `create_exclusive`.
fn lock_for_create(path: &Path, handle: &fs::File) -> Result<(), VaultError> {
    let mut waited = 0;
    loop {
        match handle.try_lock() {
            Ok(()) => return Ok(()),
            Err(fs::TryLockError::WouldBlock) if waited + 1 < CREATE_LOCK_ATTEMPTS => {
                waited += 1;
                std::thread::sleep(CREATE_LOCK_RETRY);
            }
            Err(fs::TryLockError::WouldBlock) => {
                return Err(VaultError::SaveFailed(format!(
                    "another process is still initializing the vault at {}, so this create did not start",
                    path.display()
                )));
            }
            Err(fs::TryLockError::Error(error)) => {
                return Err(save_failed("Failed to lock the vault file", path, &error));
            }
        }
    }
}

/// True only when `path` is provably a claim placeholder that was never filled.
///
/// The proof rests on the write path: every write to this file (create, set,
/// delete, change_password, the verifier migration) goes through `write_atomic`,
/// which renames a complete `serialize_config` buffer over the target. A
/// serialized config always carries its salt, so no code path in this module can
/// leave a zero-length file behind as a *vault*: a zero-length regular file can
/// only be the empty placeholder `claim_new_vault_file` opened and the
/// interrupted create never replaced. It holds no bytes, so reclaiming it cannot
/// destroy anything.
///
/// Everything else returns `false`: a vault with content, a truncated or
/// hand-edited file, a symlink, a device, a directory. Recovery therefore has no
/// path that overwrites or unlinks content.
fn is_unfilled_placeholder(path: &Path) -> Result<bool, VaultError> {
    let entry = fs::symlink_metadata(path)
        .map_err(|e| save_failed("Failed to inspect the existing vault path", path, &e))?;
    // symlink_metadata does not follow links, so a symlink or a device node is
    // never mistaken for the placeholder this module created.
    if !entry.file_type().is_file() || entry.len() != 0 {
        return Ok(false);
    }

    // Re-read through a handle: the length that decides is the one on the object
    // this call opened, not the one a stale path lookup reported.
    let opened = fs::File::open(path)
        .map_err(|e| save_failed("Failed to open the existing vault file", path, &e))?;
    let metadata = opened
        .metadata()
        .map_err(|e| save_failed("Failed to inspect the existing vault file", path, &e))?;
    Ok(metadata.is_file() && metadata.len() == 0)
}

/// Read the vault file, naming an unfilled placeholder separately from damage.
///
/// Three states reach this function and only one of them is a vault:
///
/// * zero bytes is the placeholder of an interrupted create, reported as
///   `Uninitialized` so the caller can start the create flow again;
/// * content the format cannot parse is `Corrupt` and is never removed,
///   truncated or rewritten here: the bytes stay for manual recovery;
/// * a parseable config goes on to password verification as a real vault.
fn read_vault_file(path: &Path) -> Result<String, VaultError> {
    let content = fs::read_to_string(path)
        .map_err(|e| VaultError::UnlockFailed(format!("Failed to read vault config: {}", e)))?;
    if content.is_empty() {
        return Err(VaultError::Uninitialized(format!(
            "vault file {} is an empty placeholder left by an interrupted create; create the vault again",
            path.display()
        )));
    }
    Ok(content)
}

/// Build a `SaveFailed` error from a stage, a path and the underlying IO error.
///
/// Only paths and `io::Error` text are formatted here: no key, password or
/// plaintext ever reaches a vault error message or a log line.
fn save_failed(stage: &str, path: &Path, error: &std::io::Error) -> VaultError {
    VaultError::SaveFailed(format!("{} ({}): {}", stage, path.display(), error))
}

/// Write the payload into the temporary file and flush it to the OS.
fn write_payload(
    temp: &mut NamedTempFile,
    bytes: &[u8],
    temp_path: &Path,
) -> Result<(), VaultError> {
    #[cfg(test)]
    if let Some(limit) = fault_injection::take_write_budget() {
        // Fault injection: leave a truncated payload behind and fail the way a
        // full disk or an interrupted write would. The target file is never
        // touched and the temporary file is removed by the caller drop.
        let truncated = &bytes[..bytes.len().min(limit)];
        temp.write_all(truncated)
            .map_err(|e| save_failed("Failed to write temporary vault file", temp_path, &e))?;
        temp.flush()
            .map_err(|e| save_failed("Failed to flush temporary vault file", temp_path, &e))?;
        return Err(VaultError::SaveFailed(format!(
            "injected write failure after {} bytes",
            truncated.len()
        )));
    }

    temp.write_all(bytes)
        .map_err(|e| save_failed("Failed to write temporary vault file", temp_path, &e))?;
    temp.flush()
        .map_err(|e| save_failed("Failed to flush temporary vault file", temp_path, &e))
}

/// Keep the temporary file at least as strict as the vault file it replaces.
///
/// `NamedTempFile` creates the temporary file with mode 0600 on Unix, so the
/// write phase never exposes the ciphertext to group or other. When the existing
/// `vault.json` is stricter still (for example 0400), that mode is carried over
/// instead of being widened.
#[cfg(unix)]
fn restrict_temp_permissions(
    temp: &NamedTempFile,
    target: &Path,
    temp_path: &Path,
) -> Result<(), VaultError> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let existing = fs::metadata(target).ok().map(|meta| meta.mode() & 0o777);
    let mode = match existing {
        Some(mode) if mode & 0o077 == 0 && mode & 0o400 != 0 => mode,
        _ => 0o600,
    };

    temp.as_file()
        .set_permissions(fs::Permissions::from_mode(mode))
        .map_err(|e| {
            save_failed(
                "Failed to restrict temporary vault file permissions",
                temp_path,
                &e,
            )
        })
}

/// Windows has no POSIX mode bits: the temporary file inherits the vault
/// directory ACL, exactly like the `vault.json` it replaces, so it is never wider
/// than the final file. `persist` also clears the temporary attribute it set.
#[cfg(not(unix))]
fn restrict_temp_permissions(
    _temp: &NamedTempFile,
    _target: &Path,
    _temp_path: &Path,
) -> Result<(), VaultError> {
    Ok(())
}

/// Flush the directory entry the rename just changed, so the replacement
/// survives a crash immediately after the save returns.
///
/// Only Unix can open a directory and fsync it; on Windows `MoveFileExW` exposes
/// no portable directory handle, so there the fresh content is guaranteed by the
/// `sync_all` of the temporary file before the rename. A directory fsync failure
/// is logged and not propagated: the vault file is already replaced at that
/// point, so failing the save would be a lie.
fn sync_parent_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(handle) = fs::File::open(dir) {
        if let Err(error) = handle.sync_all() {
            log::warn!(
                "vault: failed to fsync directory {}: {}",
                dir.display(),
                error
            );
        }
    }

    #[cfg(not(unix))]
    let _ = dir;
}

/// Test-only fault injection for the atomic write path.
///
/// The budget is thread-local, so parallel tests cannot leak an injected failure
/// into each other.
#[cfg(test)]
mod fault_injection {
    use std::cell::Cell;

    thread_local! {
        static WRITE_BUDGET: Cell<Option<usize>> = const { Cell::new(None) };
        static CLAIM_CRASH: Cell<bool> = const { Cell::new(false) };
        static RECLAIM_DELAY_MS: Cell<Option<u64>> = const { Cell::new(None) };
    }

    /// Arm the next reclaim to hold its critical section open for `millis`.
    pub(super) fn delay_after_reclaim_check(millis: u64) {
        RECLAIM_DELAY_MS.with(|delay| delay.set(Some(millis)));
    }

    /// Consume the armed reclaim delay, if any.
    pub(super) fn take_reclaim_delay() -> Option<u64> {
        RECLAIM_DELAY_MS.with(|delay| delay.take())
    }

    /// Arm the next save to fail after `bytes` bytes reach the temporary file.
    pub(super) fn fail_write_after(bytes: usize) {
        WRITE_BUDGET.with(|budget| budget.set(Some(bytes)));
    }

    /// Arm the next create to die right after the exclusive claim, i.e. between
    /// the two persistence steps, leaving the placeholder on disk the way a
    /// killed process would.
    pub(super) fn fail_after_claim() {
        CLAIM_CRASH.with(|flag| flag.set(true));
    }

    /// Consume the armed claim crash, if any.
    pub(super) fn take_claim_crash() -> bool {
        CLAIM_CRASH.with(|flag| flag.replace(false))
    }

    /// Disarm the injection.
    pub(super) fn clear() {
        WRITE_BUDGET.with(|budget| budget.set(None));
        CLAIM_CRASH.with(|flag| flag.set(false));
        RECLAIM_DELAY_MS.with(|delay| delay.set(None));
    }

    /// Consume the armed budget, if any.
    pub(super) fn take_write_budget() -> Option<usize> {
        WRITE_BUDGET.with(|budget| budget.take())
    }
}

/// Encrypt a value using AES-256-GCM
fn encrypt_value(value: &str, key: &[u8; 32]) -> Result<String, VaultError> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| VaultError::EncryptFailed(format!("Failed to create cipher: {}", e)))?;

    // Generate random nonce
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt
    let ciphertext = cipher
        .encrypt(nonce, value.as_bytes())
        .map_err(|e| VaultError::EncryptFailed(format!("Encryption failed: {}", e)))?;

    // Combine nonce + ciphertext and encode as base64
    let mut combined = nonce_bytes.to_vec();
    combined.extend(ciphertext);

    Ok(BASE64.encode(&combined))
}

/// Decrypt a value using AES-256-GCM
fn decrypt_value(encrypted: &str, key: &[u8; 32]) -> Result<String, VaultError> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| VaultError::DecryptFailed(format!("Failed to create cipher: {}", e)))?;

    // Decode base64
    let combined = BASE64
        .decode(encrypted)
        .map_err(|e| VaultError::DecryptFailed(format!("Invalid base64: {}", e)))?;

    if combined.len() < 12 {
        return Err(VaultError::DecryptFailed("Invalid encrypted data".into()));
    }

    // Extract nonce and ciphertext
    let nonce = Nonce::from_slice(&combined[..12]);
    let ciphertext = &combined[12..];

    // Decrypt
    let plaintext = cipher.decrypt(nonce, ciphertext).map_err(|e| {
        VaultError::DecryptFailed(format!("Decryption failed (wrong password?): {}", e))
    })?;

    String::from_utf8(plaintext)
        .map_err(|e| VaultError::DecryptFailed(format!("Invalid UTF-8: {}", e)))
}

// Global vault state (protected by Mutex for thread safety)
static VAULT_STATE: once_cell::sync::Lazy<Mutex<Option<VaultState>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

/// Get the vault config file path
fn get_vault_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("terminal");
    fs::create_dir_all(&path).ok();
    path.push("vault.json");
    path
}

#[tauri::command]
pub fn vault_exists() -> bool {
    VaultState::exists(&get_vault_path())
}

#[tauri::command]
pub fn vault_create(master_password: String) -> Result<(), VaultError> {
    if master_password.is_empty() {
        return Err(VaultError::InvalidPassword);
    }
    let vault = VaultState::create(&master_password, get_vault_path())?;
    let mut state = VAULT_STATE.lock();
    *state = Some(vault);
    Ok(())
}

#[tauri::command]
pub fn vault_unlock(master_password: String) -> Result<(), VaultError> {
    let vault = VaultState::unlock(&master_password, get_vault_path())?;
    let mut state = VAULT_STATE.lock();
    *state = Some(vault);
    Ok(())
}

#[tauri::command]
pub fn vault_lock() {
    let mut state = VAULT_STATE.lock();
    *state = None;
}

#[tauri::command]
pub fn vault_is_unlocked() -> bool {
    let state = VAULT_STATE.lock();
    state.is_some()
}

#[tauri::command]
pub fn vault_set(key: String, value: String) -> Result<(), VaultError> {
    if key.is_empty() {
        return Err(VaultError::EncryptFailed("Key cannot be empty".into()));
    }
    let mut state = VAULT_STATE.lock();
    let vault = state.as_mut().ok_or(VaultError::VaultLocked)?;
    vault.set(&key, &value)
}

#[tauri::command]
pub fn vault_get(key: String) -> Result<String, VaultError> {
    if key.is_empty() {
        return Err(VaultError::KeyNotFound("Key cannot be empty".into()));
    }
    let state = VAULT_STATE.lock();
    let vault = state.as_ref().ok_or(VaultError::VaultLocked)?;
    vault.get(&key)
}

#[tauri::command]
pub fn vault_list() -> Vec<String> {
    let state = VAULT_STATE.lock();
    state.as_ref().map(|v| v.list_keys()).unwrap_or_default()
}

#[tauri::command]
pub fn vault_delete(key: String) -> Result<(), VaultError> {
    if key.is_empty() {
        return Err(VaultError::KeyNotFound("Key cannot be empty".into()));
    }
    let mut state = VAULT_STATE.lock();
    let vault = state.as_mut().ok_or(VaultError::VaultLocked)?;
    vault.delete(&key)
}

#[tauri::command]
pub fn vault_change_password(old_password: String, new_password: String) -> Result<(), VaultError> {
    if old_password.is_empty() {
        return Err(VaultError::InvalidPassword);
    }
    if new_password.is_empty() {
        return Err(VaultError::InvalidPassword);
    }
    // First unlock with old password to verify
    let config_path = get_vault_path();
    let mut vault = VaultState::unlock(&old_password, config_path)?;

    // Change password
    vault.change_password(&new_password)?;

    // Update state
    let mut state = VAULT_STATE.lock();
    *state = Some(vault);

    Ok(())
}

// ==================== Team Share Encryption ====================
// Provides end-to-end encryption for sensitive team shares.
// Data is encrypted with the vault's master key before being sent to the server.

/// Encrypt data for team sharing. Returns base64-encoded ciphertext.
#[tauri::command]
pub fn vault_encrypt_for_team(data: String) -> Result<String, VaultError> {
    let state = VAULT_STATE.lock();
    let vault = state.as_ref().ok_or(VaultError::VaultLocked)?;

    // Serialize the data to JSON, then encrypt
    let json_bytes = serde_json::to_vec(&data)
        .map_err(|e| VaultError::EncryptFailed(format!("Serialization failed: {}", e)))?;

    // Use the existing encrypt_value function with the vault's master key
    encrypt_value(&String::from_utf8_lossy(&json_bytes), &vault.master_key)
}

/// Decrypt team share data. Takes base64-encoded ciphertext and returns original JSON string.
#[tauri::command]
pub fn vault_decrypt_for_team(encrypted_data: String) -> Result<String, VaultError> {
    let state = VAULT_STATE.lock();
    let vault = state.as_ref().ok_or(VaultError::VaultLocked)?;

    let decrypted_str = decrypt_value(&encrypted_data, &vault.master_key)?;

    // The decrypted data is a JSON string, parse it back to get the original value
    serde_json::from_str::<String>(&decrypted_str)
        .map_err(|e| VaultError::DecryptFailed(format!("Invalid JSON in decrypted data: {}", e)))
}

/// Check if team share encryption is available (vault must be unlocked)
#[tauri::command]
pub fn vault_can_encrypt_for_team() -> bool {
    let state = VAULT_STATE.lock();
    state.is_some()
}

#[cfg(test)]
#[path = "vault_tests.rs"]
mod tests;
