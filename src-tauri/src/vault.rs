// Vault - Secure storage for sensitive data
// Uses AES-GCM encryption with Argon2 key derivation

use crate::errors::VaultError;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{password_hash::SaltString, Argon2, PasswordHasher};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use parking_lot::Mutex;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;
use zeroize::{Zeroize, Zeroizing};

/// Vault configuration stored on disk.
///
/// The persisted shape is deliberately unchanged: one Argon2 salt plus base64
/// `nonce || ciphertext` entries per key. `Clone` exists so a save can build the
/// next state, persist it atomically, and only then adopt it in memory.
#[derive(Clone, Serialize, Deserialize)]
struct VaultConfig {
    /// Salt for key derivation
    salt: String,
    /// Encrypted entries
    entries: HashMap<String, String>, // key -> encrypted base64 value
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
    /// The empty vault is persisted through the same atomic replace used by
    /// every later write, so a failed create cannot leave a partially written
    /// `vault.json` behind.
    pub fn create(master_password: &str, config_path: PathBuf) -> Result<Self, VaultError> {
        let salt = SaltString::generate(&mut OsRng);
        let master_key =
            derive_master_key(master_password, &salt).map_err(VaultError::CreateFailed)?;

        let mut vault = Self {
            config: VaultConfig {
                salt: salt.to_string(),
                entries: HashMap::new(),
            },
            master_key,
            config_path,
        };

        let initial = vault.config.clone();
        vault.commit(initial)?;

        Ok(vault)
    }

    /// Unlock an existing vault with master password
    pub fn unlock(master_password: &str, config_path: PathBuf) -> Result<Self, VaultError> {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| VaultError::UnlockFailed(format!("Failed to read vault config: {}", e)))?;

        let config: VaultConfig = serde_json::from_str(&content)
            .map_err(|e| VaultError::UnlockFailed(format!("Invalid vault config: {}", e)))?;

        // Re-derive key using stored salt
        let salt = SaltString::from_b64(&config.salt)
            .map_err(|e| VaultError::UnlockFailed(format!("Invalid salt: {}", e)))?;
        let master_key =
            derive_master_key(master_password, &salt).map_err(VaultError::UnlockFailed)?;

        Ok(Self {
            config,
            master_key,
            config_path,
        })
    }

    /// Check if vault exists
    pub fn exists(config_path: &Path) -> bool {
        config_path.exists()
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
    /// Commit boundary: the re-encrypted config with the new salt is written
    /// atomically first; the salt, entries and master key are swapped in memory
    /// only after that replace succeeded. If persistence fails, the old password
    /// still decrypts the untouched vault file and still works in memory.
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

        let candidate = VaultConfig {
            salt: new_salt.to_string(),
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
    /// This is the only function that writes the vault, so create, set, delete
    /// and change_password share one commit point: durable replace first,
    /// in-memory state second.
    fn commit(&mut self, config: VaultConfig) -> Result<(), VaultError> {
        let content = serde_json::to_vec_pretty(&config)
            .map_err(|e| VaultError::SaveFailed(format!("Failed to serialize config: {}", e)))?;
        write_atomic(&self.config_path, &content)?;
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
    }

    /// Arm the next save to fail after `bytes` bytes reach the temporary file.
    pub(super) fn fail_write_after(bytes: usize) {
        WRITE_BUDGET.with(|budget| budget.set(Some(bytes)));
    }

    /// Disarm the injection.
    pub(super) fn clear() {
        WRITE_BUDGET.with(|budget| budget.set(None));
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
