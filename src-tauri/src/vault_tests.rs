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
