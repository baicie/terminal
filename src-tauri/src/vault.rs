// Vault - Secure storage for sensitive data
// Uses AES-GCM encryption with Argon2 key derivation

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
use std::path::PathBuf;

/// Vault configuration stored on disk
#[derive(Serialize, Deserialize)]
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
    /// Create a new vault with a master password
    pub fn create(master_password: &str, config_path: PathBuf) -> Result<Self, String> {
        // Generate a random salt
        let salt = SaltString::generate(&mut OsRng);

        // Derive key using Argon2
        let argon2 = Argon2::default();
        let hash = argon2
            .hash_password(master_password.as_bytes(), &salt)
            .map_err(|e| format!("Failed to derive key: {}", e))?;

        // Extract 32 bytes for AES-256
        let hash_output = hash.hash.ok_or("Failed to get hash output")?;
        let mut master_key = [0u8; 32];
        let hash_bytes = hash_output.as_bytes();
        let len = std::cmp::min(hash_bytes.len(), 32);
        master_key[..len].copy_from_slice(&hash_bytes[..len]);

        let config = VaultConfig {
            salt: salt.to_string(),
            entries: HashMap::new(),
        };

        // Save initial config
        let vault = Self {
            config,
            master_key,
            config_path: config_path.clone(),
        };
        vault.save_config()?;

        Ok(vault)
    }

    /// Unlock an existing vault with master password
    pub fn unlock(master_password: &str, config_path: PathBuf) -> Result<Self, String> {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read vault config: {}", e))?;

        let config: VaultConfig = serde_json::from_str(&content)
            .map_err(|e| format!("Invalid vault config: {}", e))?;

        // Re-derive key using stored salt
        let salt = SaltString::from_b64(&config.salt)
            .map_err(|e| format!("Invalid salt: {}", e))?;

        let argon2 = Argon2::default();
        let hash = argon2
            .hash_password(master_password.as_bytes(), &salt)
            .map_err(|e| format!("Failed to derive key: {}", e))?;

        let hash_output = hash.hash.ok_or("Failed to get hash output")?;
        let mut master_key = [0u8; 32];
        let hash_bytes = hash_output.as_bytes();
        let len = std::cmp::min(hash_bytes.len(), 32);
        master_key[..len].copy_from_slice(&hash_bytes[..len]);

        Ok(Self {
            config,
            master_key,
            config_path,
        })
    }

    /// Check if vault exists
    pub fn exists(config_path: &PathBuf) -> bool {
        config_path.exists()
    }

    /// Encrypt and store a value
    pub fn set(&mut self, key: &str, value: &str) -> Result<(), String> {
        let encrypted = encrypt_value(value, &self.master_key)?;
        self.config.entries.insert(key.to_string(), encrypted);
        self.save_config()
    }

    /// Decrypt and retrieve a value
    pub fn get(&self, key: &str) -> Result<String, String> {
        let encrypted = self
            .config
            .entries
            .get(key)
            .ok_or_else(|| format!("Key not found: {}", key))?;
        decrypt_value(encrypted, &self.master_key)
    }

    /// List all vault keys
    pub fn list_keys(&self) -> Vec<String> {
        self.config.entries.keys().cloned().collect()
    }

    /// Delete a vault entry
    pub fn delete(&mut self, key: &str) -> Result<(), String> {
        if self.config.entries.remove(key).is_none() {
            return Err(format!("Key not found: {}", key));
        }
        self.save_config()
    }

    /// Change master password
    pub fn change_password(&mut self, new_password: &str) -> Result<(), String> {
        // Generate new salt
        let new_salt = SaltString::generate(&mut OsRng);

        // Derive new key
        let argon2 = Argon2::default();
        let hash = argon2
            .hash_password(new_password.as_bytes(), &new_salt)
            .map_err(|e| format!("Failed to derive key: {}", e))?;

        let hash_output = hash.hash.ok_or("Failed to get hash output")?;
        let mut new_master_key = [0u8; 32];
        let hash_bytes = hash_output.as_bytes();
        let len = std::cmp::min(hash_bytes.len(), 32);
        new_master_key[..len].copy_from_slice(&hash_bytes[..len]);

        // Re-encrypt all entries with new key
        let mut new_entries = HashMap::new();
        for (key, encrypted) in &self.config.entries {
            // Decrypt with old key
            let value = decrypt_value(encrypted, &self.master_key)?;
            // Encrypt with new key
            let new_encrypted = encrypt_value(&value, &new_master_key)?;
            new_entries.insert(key.clone(), new_encrypted);
        }

        // Update config
        self.config.salt = new_salt.to_string();
        self.config.entries = new_entries;
        self.master_key = new_master_key;

        self.save_config()
    }

    fn save_config(&self) -> Result<(), String> {
        let content = serde_json::to_string_pretty(&self.config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        fs::write(&self.config_path, content)
            .map_err(|e| format!("Failed to write config: {}", e))
    }
}

/// Encrypt a value using AES-256-GCM
fn encrypt_value(value: &str, key: &[u8; 32]) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    // Generate random nonce
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt
    let ciphertext = cipher
        .encrypt(nonce, value.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Combine nonce + ciphertext and encode as base64
    let mut combined = nonce_bytes.to_vec();
    combined.extend(ciphertext);

    Ok(BASE64.encode(&combined))
}

/// Decrypt a value using AES-256-GCM
fn decrypt_value(encrypted: &str, key: &[u8; 32]) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    // Decode base64
    let combined = BASE64
        .decode(encrypted)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    if combined.len() < 12 {
        return Err("Invalid encrypted data".to_string());
    }

    // Extract nonce and ciphertext
    let nonce = Nonce::from_slice(&combined[..12]);
    let ciphertext = &combined[12..];

    // Decrypt
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed (wrong password?): {}", e))?;

    String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8: {}", e))
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
pub fn vault_create(master_password: String) -> Result<(), String> {
    let vault = VaultState::create(&master_password, get_vault_path())?;
    let mut state = VAULT_STATE.lock();
    *state = Some(vault);
    Ok(())
}

#[tauri::command]
pub fn vault_unlock(master_password: String) -> Result<(), String> {
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
pub fn vault_set(key: String, value: String) -> Result<(), String> {
    let mut state = VAULT_STATE.lock();
    let vault = state.as_mut().ok_or("Vault is locked")?;
    vault.set(&key, &value)
}

#[tauri::command]
pub fn vault_get(key: String) -> Result<String, String> {
    let state = VAULT_STATE.lock();
    let vault = state.as_ref().ok_or("Vault is locked")?;
    vault.get(&key)
}

#[tauri::command]
pub fn vault_list() -> Vec<String> {
    let state = VAULT_STATE.lock();
    state.as_ref().map(|v| v.list_keys()).unwrap_or_default()
}

#[tauri::command]
pub fn vault_delete(key: String) -> Result<(), String> {
    let mut state = VAULT_STATE.lock();
    let vault = state.as_mut().ok_or("Vault is locked")?;
    vault.delete(&key)
}

#[tauri::command]
pub fn vault_change_password(old_password: String, new_password: String) -> Result<(), String> {
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
