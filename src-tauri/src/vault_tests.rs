//! Failure-injection tests for vault persistence.
//!
//! Every test uses a throwaway temp directory and a synthetic master password: no
//! real user vault, password or SSH key is touched, and no plaintext is printed.

use super::*;

const OLD_PASSWORD: &str = "test-only-old-master-password";
const NEW_PASSWORD: &str = "test-only-new-master-password";
const SECRET_VALUE: &str = "test-only-secret-value";

fn vault_path(dir: &Path) -> PathBuf {
    dir.join("vault.json")
}

fn dir_entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .expect("read temporary directory")
        .map(|entry| {
            entry
                .expect("directory entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

/// A wrong password cannot be rejected by `unlock` alone: the vault format has
/// no password verifier, so "the password opens the vault" means "the key it
/// derives decrypts the stored entries".
fn opens_vault(path: &Path, password: &str, key: &str) -> bool {
    VaultState::unlock(password, path.to_path_buf())
        .and_then(|vault| vault.get(key))
        .is_ok()
}

fn create_with_entry(dir: &Path) -> (VaultState, PathBuf) {
    let path = vault_path(dir);
    let mut vault = VaultState::create(OLD_PASSWORD, path.clone()).expect("create vault");
    vault.set("host", SECRET_VALUE).expect("store entry");
    (vault, path)
}

#[test]
fn save_replaces_the_vault_file_and_leaves_no_temporary_file() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let (vault, path) = create_with_entry(dir.path());
    drop(vault);

    assert_eq!(dir_entries(dir.path()), vec!["vault.json".to_string()]);

    let reopened = VaultState::unlock(OLD_PASSWORD, path).expect("unlock after save");
    assert_eq!(reopened.get("host").expect("read entry"), SECRET_VALUE);
}

#[test]
fn injected_write_failure_keeps_the_previous_bytes_and_cleans_the_temporary_file() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let (mut vault, path) = create_with_entry(dir.path());
    let before = fs::read(&path).expect("read vault bytes");

    fault_injection::fail_write_after(4);
    let result = vault.set("other", "test-only-other-secret");
    fault_injection::clear();

    let error = result.expect_err("injected write failure must surface");
    assert!(matches!(error, VaultError::SaveFailed(_)));
    let message = error.to_string();
    assert!(
        !message.contains(SECRET_VALUE),
        "save errors must not carry plaintext: {message}"
    );
    assert!(
        !message.contains(OLD_PASSWORD),
        "save errors must not carry the master password: {message}"
    );

    assert_eq!(
        fs::read(&path).expect("read vault bytes"),
        before,
        "a failed save must not touch the vault file"
    );
    assert_eq!(
        dir_entries(dir.path()),
        vec!["vault.json".to_string()],
        "a failed save must remove its temporary file"
    );
    assert!(
        matches!(vault.get("other"), Err(VaultError::KeyNotFound(_))),
        "a failed save must not add the entry in memory"
    );
}

#[test]
fn failed_change_password_keeps_the_old_password_usable_in_memory_and_on_disk() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let (mut vault, path) = create_with_entry(dir.path());
    let salt_before = vault.config.salt.clone();
    let bytes_before = fs::read(&path).expect("read vault bytes");

    fault_injection::fail_write_after(8);
    let result = vault.change_password(NEW_PASSWORD);
    fault_injection::clear();

    assert!(
        result.is_err(),
        "a failed persistence must fail change_password"
    );
    assert_eq!(
        vault.config.salt, salt_before,
        "memory must keep the old salt"
    );
    assert_eq!(
        vault.get("host").expect("old key still decrypts"),
        SECRET_VALUE,
        "memory must keep the old master key"
    );
    assert_eq!(
        fs::read(&path).expect("read vault bytes"),
        bytes_before,
        "a failed rotation must not touch the vault file"
    );

    assert!(
        opens_vault(&path, OLD_PASSWORD, "host"),
        "the old password must still decrypt the untouched vault file"
    );
    assert!(
        !opens_vault(&path, NEW_PASSWORD, "host"),
        "the rejected new password must not decrypt the vault"
    );
}

#[test]
fn change_password_commits_a_new_salt_and_keeps_entries_readable() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let (mut vault, path) = create_with_entry(dir.path());
    let salt_before = vault.config.salt.clone();

    vault
        .change_password(NEW_PASSWORD)
        .expect("change password");

    assert_ne!(
        vault.config.salt, salt_before,
        "a rotation must commit a fresh salt"
    );
    assert_eq!(vault.get("host").expect("new key decrypts"), SECRET_VALUE);

    let reopened =
        VaultState::unlock(NEW_PASSWORD, path.clone()).expect("new password unlocks the file");
    assert_eq!(reopened.get("host").expect("read entry"), SECRET_VALUE);
    assert!(
        !opens_vault(&path, OLD_PASSWORD, "host"),
        "the old password must not decrypt the rotated vault"
    );
    assert_eq!(dir_entries(dir.path()), vec!["vault.json".to_string()]);
}

#[test]
fn failed_delete_keeps_the_entry_in_memory_and_on_disk() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let (mut vault, path) = create_with_entry(dir.path());

    fault_injection::fail_write_after(2);
    let result = vault.delete("host");
    fault_injection::clear();

    assert!(result.is_err(), "a failed persistence must fail delete");
    assert_eq!(
        vault.get("host").expect("entry must survive in memory"),
        SECRET_VALUE
    );

    let reopened = VaultState::unlock(OLD_PASSWORD, path).expect("unlock after a failed delete");
    assert_eq!(reopened.list_keys(), vec!["host".to_string()]);
}

#[cfg(unix)]
#[test]
fn the_vault_file_never_grants_group_or_other_access() {
    use std::os::unix::fs::PermissionsExt;

    fn mode_of(path: &Path) -> u32 {
        fs::metadata(path)
            .expect("vault file metadata")
            .permissions()
            .mode()
            & 0o777
    }

    let dir = tempfile::tempdir().expect("temporary directory");
    let path = vault_path(dir.path());

    let mut vault = VaultState::create(OLD_PASSWORD, path.clone()).expect("create vault");
    assert_eq!(
        mode_of(&path) & 0o077,
        0,
        "a created vault file must not be group or world accessible: {:o}",
        mode_of(&path)
    );

    vault.set("host", SECRET_VALUE).expect("store entry");
    assert_eq!(
        mode_of(&path) & 0o077,
        0,
        "a save must not widen the vault file permissions: {:o}",
        mode_of(&path)
    );

    vault
        .change_password(NEW_PASSWORD)
        .expect("change password");
    assert_eq!(
        mode_of(&path) & 0o077,
        0,
        "a rotation must not widen the vault file permissions: {:o}",
        mode_of(&path)
    );
}

#[cfg(unix)]
#[test]
fn a_stricter_existing_vault_mode_is_preserved_instead_of_widened() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().expect("temporary directory");
    let (mut vault, path) = create_with_entry(dir.path());

    fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).expect("restrict vault file");

    vault
        .set("second", "test-only-second-secret")
        .expect("save over a read-only vault file");

    let mode = fs::metadata(&path)
        .expect("vault file metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(
        mode & 0o077,
        0,
        "replacement must not be group/world accessible: {mode:o}"
    );
    assert_eq!(
        mode & 0o400,
        0o400,
        "replacement must stay owner readable: {mode:o}"
    );

    let reopened = VaultState::unlock(OLD_PASSWORD, path).expect("unlock after a narrow save");
    assert_eq!(reopened.list_keys().len(), 2);
}

#[cfg(unix)]
#[test]
fn a_read_only_directory_fails_the_save_and_keeps_the_old_password_usable() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().expect("temporary directory");
    let (mut vault, path) = create_with_entry(dir.path());
    let bytes_before = fs::read(&path).expect("read vault bytes");

    let original = fs::metadata(dir.path())
        .expect("directory metadata")
        .permissions();
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o500))
        .expect("make the directory read-only");
    let result = vault.change_password(NEW_PASSWORD);
    fs::set_permissions(dir.path(), original).expect("restore directory permissions");

    if result.is_ok() {
        // Running as root: directory write bits do not bind, so nothing to assert.
        return;
    }

    assert_eq!(
        fs::read(&path).expect("read vault bytes"),
        bytes_before,
        "an unwritable directory must not touch the vault file"
    );
    assert!(
        vault.get("host").is_ok(),
        "memory must survive a failed rotation"
    );

    assert!(
        opens_vault(&path, OLD_PASSWORD, "host"),
        "the old password must still decrypt the untouched vault file"
    );
    assert!(
        !opens_vault(&path, NEW_PASSWORD, "host"),
        "the rejected new password must not decrypt the vault"
    );
}

#[test]
fn a_temporary_file_left_by_a_killed_process_never_becomes_the_vault() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let (mut vault, path) = create_with_entry(dir.path());
    let bytes_before = fs::read(&path).expect("read vault bytes");

    // Simulate a process killed between write and rename: a truncated temporary
    // file is left behind while the real vault file is untouched.
    let mut leftover = NamedTempFile::new_in(dir.path()).expect("leftover temporary file");
    leftover
        .write_all(b"{\"salt\":\"truncated")
        .expect("write truncated payload");
    leftover.flush().expect("flush truncated payload");
    let leftover_path = leftover
        .into_temp_path()
        .keep()
        .expect("leak the file like a crashed process");

    let reopened = VaultState::unlock(OLD_PASSWORD, path.clone())
        .expect("a leftover temporary file must not block unlocking");
    assert_eq!(reopened.get("host").expect("read entry"), SECRET_VALUE);
    assert_eq!(fs::read(&path).expect("read vault bytes"), bytes_before);

    vault
        .set("second", "test-only-second-secret")
        .expect("save after a leftover");
    assert_eq!(
        dir_entries(dir.path()).len(),
        2,
        "a save must remove its own temporary file and leave the crashed one alone"
    );
    assert!(
        leftover_path.exists(),
        "the crashed process file stays behind"
    );

    let reopened = VaultState::unlock(OLD_PASSWORD, path).expect("unlock after a leftover save");
    assert_eq!(reopened.list_keys().len(), 2);
}

#[test]
fn a_failed_replace_removes_the_temporary_file() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = vault_path(dir.path());
    // A directory in the target's place makes the final replace fail after the
    // payload was already written and synced.
    fs::create_dir(&path).expect("occupy the vault path with a directory");

    let error = VaultState::create(OLD_PASSWORD, path)
        .err()
        .expect("replacing a directory with the vault file must fail");
    assert!(matches!(error, VaultError::SaveFailed(_)));
    assert_eq!(
        dir_entries(dir.path()),
        vec!["vault.json".to_string()],
        "a failed replace must remove its temporary file"
    );
}

#[test]
fn the_vault_file_keeps_the_historical_shape_and_holds_only_ciphertext() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let (vault, path) = create_with_entry(dir.path());
    drop(vault);

    let content = fs::read_to_string(&path).expect("read vault file");
    assert!(
        !content.contains(SECRET_VALUE),
        "the vault file must never contain plaintext"
    );

    #[derive(Deserialize)]
    struct HistoricalVaultConfig {
        salt: String,
        entries: HashMap<String, String>,
    }

    let parsed: HistoricalVaultConfig =
        serde_json::from_str(&content).expect("historical schema must still parse");
    assert!(!parsed.salt.is_empty());
    assert_eq!(parsed.entries.len(), 1);
    assert!(!parsed.entries["host"].contains(SECRET_VALUE));
}

// ==================== Password verifier (Issue #152) ====================

const WRONG_PASSWORD: &str = "test-only-wrong-master-password";

/// Read the vault file as JSON so a test can inspect exactly what is stored.
fn read_vault_json(path: &Path) -> serde_json::Value {
    serde_json::from_str(&fs::read_to_string(path).expect("read vault file"))
        .expect("parse vault file")
}

/// The stored verifier, or none for a vault written before the verifier existed.
fn stored_verifier(path: &Path) -> Option<String> {
    read_vault_json(path)
        .get("verifier")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

/// Write a pre-verifier vault file by hand: the historical shape, no verifier field.
fn write_legacy_vault(path: &Path, password: &str, entries: &[(&str, &str)]) {
    let salt = SaltString::generate(&mut OsRng);
    let key = derive_master_key(password, &salt).expect("derive legacy key");

    let mut encrypted = HashMap::new();
    for (name, value) in entries {
        encrypted.insert(
            (*name).to_string(),
            encrypt_value(value, &key).expect("encrypt legacy entry"),
        );
    }

    let legacy = serde_json::json!({ "salt": salt.to_string(), "entries": encrypted });
    fs::write(
        path,
        serde_json::to_vec_pretty(&legacy).expect("serialize legacy vault"),
    )
    .expect("write legacy vault");
}

#[test]
fn a_new_vault_verifies_the_master_password_at_unlock() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = vault_path(dir.path());
    let vault = VaultState::create(OLD_PASSWORD, path.clone()).expect("create vault");
    drop(vault);

    assert!(
        stored_verifier(&path).is_some(),
        "a vault written by this build must carry a verifier"
    );

    let reopened =
        VaultState::unlock(OLD_PASSWORD, path.clone()).expect("correct password unlocks");
    assert!(reopened.list_keys().is_empty());
    assert!(
        matches!(
            VaultState::unlock(WRONG_PASSWORD, path),
            Err(VaultError::InvalidPassword)
        ),
        "a wrong password must be rejected at unlock"
    );
}

#[test]
fn an_empty_vault_rejects_every_password_but_its_own() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = vault_path(dir.path());
    let vault = VaultState::create(OLD_PASSWORD, path.clone()).expect("create vault");
    drop(vault);

    // Issue #152: an empty vault used to be openable with any string at all.
    let error = VaultState::unlock(WRONG_PASSWORD, path.clone())
        .err()
        .expect("an empty vault must still reject a wrong password");
    assert!(matches!(error, VaultError::InvalidPassword));
    assert!(
        !error.to_string().contains(WRONG_PASSWORD),
        "the error must not carry the password"
    );
    assert!(
        !error.to_string().contains(OLD_PASSWORD),
        "the error must not carry the master password"
    );

    assert!(VaultState::unlock(OLD_PASSWORD, path).is_ok());
}

#[test]
fn a_legacy_vault_with_entries_verifies_the_password_and_seals_a_verifier() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = vault_path(dir.path());
    write_legacy_vault(&path, OLD_PASSWORD, &[("host", SECRET_VALUE)]);
    let legacy_bytes = fs::read(&path).expect("read legacy bytes");
    assert!(
        stored_verifier(&path).is_none(),
        "the fixture must be a pre-verifier vault"
    );

    assert!(
        matches!(
            VaultState::unlock(WRONG_PASSWORD, path.clone()),
            Err(VaultError::InvalidPassword)
        ),
        "a legacy vault with entries must still reject a wrong password"
    );
    assert_eq!(
        fs::read(&path).expect("read legacy bytes"),
        legacy_bytes,
        "a rejected password must not rewrite the vault"
    );

    let mut vault =
        VaultState::unlock(OLD_PASSWORD, path.clone()).expect("the legacy password must unlock");
    assert_eq!(
        vault.get("host").expect("read migrated entry"),
        SECRET_VALUE
    );
    assert!(
        stored_verifier(&path).is_some(),
        "a successful legacy unlock must migrate a verifier in"
    );
    assert_eq!(
        dir_entries(dir.path()),
        vec!["vault.json".to_string()],
        "the migration must leave no temporary file"
    );

    vault
        .set("second", "test-only-second-secret")
        .expect("save after migration");
    drop(vault);

    let reopened = VaultState::unlock(OLD_PASSWORD, path).expect("unlock after migration");
    assert_eq!(reopened.list_keys().len(), 2);
}

#[test]
fn a_legacy_empty_vault_cannot_verify_and_seals_the_supplied_password() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = vault_path(dir.path());
    write_legacy_vault(&path, OLD_PASSWORD, &[]);
    assert!(stored_verifier(&path).is_none());

    // A legacy empty vault holds neither ciphertext nor a verifier, i.e. nothing
    // any password could be tested against. The compatibility choice is to accept
    // the supplied password and seal it, not to pretend the password was checked.
    let vault = VaultState::unlock(WRONG_PASSWORD, path.clone())
        .expect("a legacy empty vault cannot reject a password");
    drop(vault);

    assert!(
        stored_verifier(&path).is_some(),
        "the accepted password must be sealed with a verifier"
    );
    assert!(
        matches!(
            VaultState::unlock(OLD_PASSWORD, path.clone()),
            Err(VaultError::InvalidPassword)
        ),
        "after sealing, every other password must be rejected"
    );
    assert!(VaultState::unlock(WRONG_PASSWORD, path).is_ok());
}

#[test]
fn a_failed_verifier_migration_keeps_the_legacy_file_and_the_old_password_usable() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = vault_path(dir.path());
    write_legacy_vault(&path, OLD_PASSWORD, &[("host", SECRET_VALUE)]);
    let before = fs::read(&path).expect("read legacy bytes");

    fault_injection::fail_write_after(4);
    let unlocked = VaultState::unlock(OLD_PASSWORD, path.clone());
    fault_injection::clear();

    let vault = unlocked.expect("a failed migration must not fail the unlock");
    assert_eq!(
        vault.get("host").expect("entry stays readable"),
        SECRET_VALUE,
        "the vault must stay usable after a failed migration"
    );
    drop(vault);

    assert_eq!(
        fs::read(&path).expect("read legacy bytes"),
        before,
        "a failed migration must not touch the legacy file"
    );
    assert!(
        stored_verifier(&path).is_none(),
        "a failed migration must leave a legacy file behind"
    );
    assert_eq!(
        dir_entries(dir.path()),
        vec!["vault.json".to_string()],
        "a failed migration must remove its temporary file"
    );
    assert!(
        VaultState::unlock(OLD_PASSWORD, path.clone()).is_ok(),
        "the old password must still work after a failed migration"
    );

    // Nothing about the failure is sticky: the next unlock finishes the migration.
    let mut vault =
        VaultState::unlock(OLD_PASSWORD, path.clone()).expect("unlock without injection");
    vault
        .set("second", "test-only-second-secret")
        .expect("save after a recovered migration");
    drop(vault);
    assert!(stored_verifier(&path).is_some());
}

#[test]
fn change_password_rotates_the_verifier_together_with_the_salt() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let (mut vault, path) = create_with_entry(dir.path());
    let verifier_before = stored_verifier(&path).expect("verifier before rotation");

    vault
        .change_password(NEW_PASSWORD)
        .expect("rotate the password");

    let verifier_after = stored_verifier(&path).expect("verifier after rotation");
    assert_ne!(
        verifier_before, verifier_after,
        "the verifier must move with the salt"
    );
    assert!(
        VaultState::unlock(NEW_PASSWORD, path.clone()).is_ok(),
        "the new password must verify against the rotated verifier"
    );
    assert!(
        matches!(
            VaultState::unlock(OLD_PASSWORD, path),
            Err(VaultError::InvalidPassword)
        ),
        "the old password must fail at unlock, not later"
    );
}

#[test]
fn a_failed_change_password_keeps_the_old_verifier_and_the_old_password() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let (mut vault, path) = create_with_entry(dir.path());
    let verifier_before = stored_verifier(&path).expect("verifier before rotation");
    let bytes_before = fs::read(&path).expect("read vault bytes");

    fault_injection::fail_write_after(8);
    let result = vault.change_password(NEW_PASSWORD);
    fault_injection::clear();

    assert!(
        result.is_err(),
        "a failed persistence must fail the rotation"
    );
    assert_eq!(
        stored_verifier(&path).expect("verifier after a failed rotation"),
        verifier_before,
        "a failed rotation must not ship a verifier for the new key"
    );
    assert_eq!(
        fs::read(&path).expect("read vault bytes"),
        bytes_before,
        "a failed rotation must not touch the vault file"
    );
    assert_eq!(
        vault.get("host").expect("memory keeps the old key"),
        SECRET_VALUE
    );
    assert!(opens_vault(&path, OLD_PASSWORD, "host"));
    assert!(!opens_vault(&path, NEW_PASSWORD, "host"));
}

#[test]
fn a_verifier_minted_for_another_salt_is_rejected() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let (vault, path) = create_with_entry(dir.path());
    drop(vault);

    // Right password, right key length, wrong domain-separated message: the
    // verifier must be bound to the salt that is actually stored.
    let impostor = {
        let salt = SaltString::generate(&mut OsRng);
        let key = derive_master_key(OLD_PASSWORD, &salt).expect("derive impostor key");
        encode_verifier(&key, salt.as_str())
    };
    let mut json = read_vault_json(&path);
    json["verifier"] = serde_json::Value::String(impostor);
    fs::write(&path, serde_json::to_vec_pretty(&json).expect("serialize")).expect("write vault");

    assert!(
        matches!(
            VaultState::unlock(OLD_PASSWORD, path),
            Err(VaultError::InvalidPassword)
        ),
        "a verifier for a different salt must not unlock the vault"
    );
}

#[test]
fn the_stored_verifier_is_a_base64_tag_and_stores_no_domain_label() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let (vault, path) = create_with_entry(dir.path());
    drop(vault);

    let content = fs::read_to_string(&path).expect("read vault file");
    let verifier = stored_verifier(&path).expect("verifier");
    let decoded = BASE64
        .decode(&verifier)
        .expect("the verifier must be base64");
    assert_eq!(decoded.len(), 32, "HMAC-SHA256 emits 32 bytes");
    assert!(
        !content.contains("terminal-vault-verifier-v1"),
        "the domain label is a code constant and must not be stored"
    );
    assert!(!content.contains(OLD_PASSWORD));
    assert!(!content.contains(SECRET_VALUE));
}

// ==================== Create protection (Issue #153) ====================

#[test]
fn creating_over_an_existing_vault_is_refused_and_keeps_every_byte() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let (vault, path) = create_with_entry(dir.path());
    drop(vault);
    let before = fs::read(&path).expect("read vault bytes");

    let error = VaultState::create(NEW_PASSWORD, path.clone())
        .err()
        .expect("a second create must be refused");
    assert!(matches!(error, VaultError::AlreadyExists));
    assert!(!error.to_string().contains(NEW_PASSWORD));

    assert_eq!(
        fs::read(&path).expect("read vault bytes"),
        before,
        "a refused create must not touch the existing vault"
    );
    assert!(opens_vault(&path, OLD_PASSWORD, "host"));
    assert!(!opens_vault(&path, NEW_PASSWORD, "host"));
    assert_eq!(dir_entries(dir.path()), vec!["vault.json".to_string()]);
}

#[test]
fn concurrent_creates_leave_exactly_one_vault() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = vault_path(dir.path());
    let attempts = 4;

    let results: Vec<Result<(), VaultError>> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..attempts)
            .map(|_| {
                let path = path.clone();
                scope.spawn(move || VaultState::create(OLD_PASSWORD, path).map(|_| ()))
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().expect("create thread"))
            .collect()
    });

    let created = results.iter().filter(|result| result.is_ok()).count();
    let refused = results
        .iter()
        .filter(|result| matches!(result, Err(VaultError::AlreadyExists)))
        .count();

    assert_eq!(created, 1, "exactly one exclusive create may win");
    assert_eq!(
        refused,
        attempts - 1,
        "every losing create must be refused with AlreadyExists"
    );
    assert_eq!(dir_entries(dir.path()), vec!["vault.json".to_string()]);
    assert!(VaultState::unlock(OLD_PASSWORD, path).is_ok());
}

#[test]
fn every_read_only_path_keeps_the_legacy_bytes_intact() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = vault_path(dir.path());
    write_legacy_vault(&path, OLD_PASSWORD, &[("host", SECRET_VALUE)]);
    let before = fs::read(&path).expect("read legacy bytes");

    assert!(VaultState::unlock(WRONG_PASSWORD, path.clone()).is_err());
    assert_eq!(fs::read(&path).expect("read legacy bytes"), before);

    assert!(matches!(
        VaultState::create(NEW_PASSWORD, path.clone()).err(),
        Some(VaultError::AlreadyExists)
    ));
    assert_eq!(fs::read(&path).expect("read legacy bytes"), before);

    fault_injection::fail_write_after(2);
    let unlocked = VaultState::unlock(OLD_PASSWORD, path.clone());
    fault_injection::clear();
    assert!(unlocked.is_ok());
    assert_eq!(
        fs::read(&path).expect("read legacy bytes"),
        before,
        "a rejected password, a refused create and a failed migration must all leave the bytes alone"
    );
}

/// The exclusive claim is one primitive on both platforms; only the file-mode
/// half differs, so the part that can vary is cfg-gated.
#[test]
fn exclusive_create_holds_on_unix_and_windows_persistence() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = vault_path(dir.path());
    let vault = VaultState::create(OLD_PASSWORD, path.clone()).expect("create vault");
    drop(vault);

    assert!(
        matches!(
            VaultState::create(OLD_PASSWORD, path.clone()).err(),
            Some(VaultError::AlreadyExists)
        ),
        "the exclusive claim must refuse a taken path on every platform"
    );

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mode = fs::metadata(&path)
            .expect("vault file metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(
            mode & 0o077,
            0,
            "the Unix claim and replace must stay owner-only: {mode:o}"
        );
    }

    #[cfg(not(unix))]
    {
        // Windows has no POSIX mode bits: create_new is CREATE_NEW and the
        // replace is MoveFileExW with MOVEFILE_REPLACE_EXISTING, so the
        // observable contract is that the claim stayed exclusive and the file
        // still round-trips through a real unlock.
        assert!(VaultState::unlock(OLD_PASSWORD, path.clone()).is_ok());
    }
}
