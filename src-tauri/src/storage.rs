//! Storage service module
//!
//! Provides unified storage abstraction for WebDAV, S3, and custom REST API backends.
//!
//! NOTE: 该模块当前是 *骨架*：trait + 三种 backend 实现 + manager 全部就位，
//! 但 Tauri 端尚未把它们暴露为命令（仅有 `storage_upload` 占位 stub）。
//! 当 docs/issue.md 中“数据存储服务配置 - 后端待实现”落地时，将由
//! `lib.rs` 把 `StorageManager` 注入 Tauri State 并启用对应命令，
//! 在那之前这里的项是有意保留为 dead_code 的。
#![allow(dead_code)]

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;
use crate::state::SharedStateType;

/// Storage backend types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
pub enum StorageBackend {
    WebDAV {
        endpoint: String,
        username: String,
        password: String,
        base_path: Option<String>,
    },
    S3 {
        endpoint: String,
        access_key: String,
        secret_key: String,
        bucket: String,
        region: Option<String>,
    },
    RestApi {
        endpoint: String,
        api_key: Option<String>,
        headers: Option<HashMap<String, String>>,
    },
}

/// Storage configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    pub backend: StorageBackend,
    pub enabled: bool,
}

/// Storage operation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageResult {
    pub success: bool,
    pub message: String,
    pub timestamp: i64,
}

/// Storage item metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageItem {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: Option<u64>,
    pub modified: Option<i64>,
}

/// Unified storage service trait
#[async_trait::async_trait]
pub trait StorageService: Send + Sync {
    /// Upload data to storage
    async fn upload(&self, path: &str, data: &[u8]) -> Result<StorageResult>;

    /// Download data from storage
    async fn download(&self, path: &str) -> Result<Vec<u8>>;

    /// Delete data from storage
    async fn delete(&self, path: &str) -> Result<StorageResult>;

    /// List items in a directory
    async fn list(&self, path: &str) -> Result<Vec<StorageItem>>;

    /// Check if connection is healthy
    async fn health_check(&self) -> Result<bool>;
}

/// WebDAV storage implementation
pub struct WebDAVStorage {
    endpoint: String,
    username: String,
    password: String,
    base_path: String,
    client: reqwest::Client,
}

impl WebDAVStorage {
    pub fn new(endpoint: String, username: String, password: String, base_path: Option<String>) -> Self {
        Self {
            endpoint,
            username,
            password,
            base_path: base_path.unwrap_or_default(),
            client: reqwest::Client::new(),
        }
    }

    fn make_url(&self, path: &str) -> String {
        let endpoint = self.endpoint.trim_end_matches('/');
        let base = self.base_path.trim_end_matches('/');
        let p = path.trim_start_matches('/');

        if base.is_empty() {
            format!("{}/{}", endpoint, p)
        } else {
            format!("{}/{}/{}", endpoint, base, p)
        }
    }
}

#[async_trait::async_trait]
impl StorageService for WebDAVStorage {
    async fn upload(&self, path: &str, data: &[u8]) -> Result<StorageResult> {
        let url = self.make_url(path);

        let response = self.client
            .put(&url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Content-Type", "application/octet-stream")
            .body(data.to_vec())
            .send()
            .await
            .map_err(|e| anyhow!("WebDAV upload failed: {}", e))?;

        if response.status().is_success() || response.status().as_u16() == 201 {
            Ok(StorageResult {
                success: true,
                message: format!("Uploaded to {}", path),
                timestamp: chrono::Utc::now().timestamp(),
            })
        } else {
            Ok(StorageResult {
                success: false,
                message: format!("Upload failed with status: {}", response.status()),
                timestamp: chrono::Utc::now().timestamp(),
            })
        }
    }

    async fn download(&self, path: &str) -> Result<Vec<u8>> {
        let url = self.make_url(path);

        let response = self.client
            .get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| anyhow!("WebDAV download failed: {}", e))?;

        if response.status().is_success() {
            let bytes = response.bytes().await
                .map_err(|e| anyhow!("Failed to read response: {}", e))?;
            Ok(bytes.to_vec())
        } else {
            Err(anyhow!("Download failed with status: {}", response.status()))
        }
    }

    async fn delete(&self, path: &str) -> Result<StorageResult> {
        let url = self.make_url(path);

        let response = self.client
            .delete(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| anyhow!("WebDAV delete failed: {}", e))?;

        if response.status().is_success() {
            Ok(StorageResult {
                success: true,
                message: format!("Deleted {}", path),
                timestamp: chrono::Utc::now().timestamp(),
            })
        } else {
            Ok(StorageResult {
                success: false,
                message: format!("Delete failed with status: {}", response.status()),
                timestamp: chrono::Utc::now().timestamp(),
            })
        }
    }

    async fn list(&self, path: &str) -> Result<Vec<StorageItem>> {
        let url = self.make_url(path);

        let body = r#"<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/><D:getcontentlength/><D:resourcetype/><D:getlastmodified/></D:prop></D:propfind>"#;

        let response = self.client
            .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "1")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| anyhow!("WebDAV list failed: {}", e))?;

        if response.status().is_success() {
            let body = response.text().await?;
            let items = parse_webdav_response(&body, path);
            Ok(items)
        } else {
            Err(anyhow!("List failed with status: {}", response.status()))
        }
    }

    async fn health_check(&self) -> Result<bool> {
        let url = self.make_url("");

        let response = self.client
            .request(reqwest::Method::from_bytes(b"OPTIONS").unwrap(), &url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| anyhow!("WebDAV health check failed: {}", e))?;

        Ok(response.status().is_success())
    }
}

/// Parse WebDAV PROPFIND response
fn parse_webdav_response(body: &str, _base_path: &str) -> Vec<StorageItem> {
    let mut items = Vec::new();

    for line in body.lines() {
        if line.contains("<D:href") || line.contains("<d:href") {
            if let Some(start) = line.find(">") {
                if let Some(end) = line.find("</") {
                    let href = &line[start + 1..end];
                    if !href.is_empty() && href != "/" {
                        let name = std::path::Path::new(href)
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| href.to_string());

                        items.push(StorageItem {
                            name,
                            path: href.to_string(),
                            is_directory: line.contains("<D:collection") || line.contains("<d:collection"),
                            size: None,
                            modified: None,
                        });
                    }
                }
            }
        }
    }

    items
}

/// S3 storage implementation
pub struct S3Storage {
    endpoint: String,
    access_key: String,
    secret_key: String,
    bucket: String,
    region: String,
    client: reqwest::Client,
}

impl S3Storage {
    pub fn new(
        endpoint: String,
        access_key: String,
        secret_key: String,
        bucket: String,
        region: Option<String>,
    ) -> Self {
        Self {
            endpoint,
            access_key,
            secret_key,
            bucket,
            region: region.unwrap_or_else(|| "us-east-1".to_string()),
            client: reqwest::Client::new(),
        }
    }

    fn make_url(&self, path: &str) -> String {
        let endpoint = self.endpoint.trim_end_matches('/');
        let bucket = self.bucket.trim_start_matches('/');
        let p = path.trim_start_matches('/');
        format!("{}/{}/{}", endpoint, bucket, p)
    }
}

#[async_trait::async_trait]
impl StorageService for S3Storage {
    async fn upload(&self, path: &str, data: &[u8]) -> Result<StorageResult> {
        let url = self.make_url(path);

        let response = self.client
            .put(&url)
            .header("x-amz-acl", "private")
            .body(data.to_vec())
            .send()
            .await
            .map_err(|e| anyhow!("S3 upload failed: {}", e))?;

        if response.status().is_success() || response.status().as_u16() == 200 {
            Ok(StorageResult {
                success: true,
                message: format!("Uploaded to s3://{}/{}", self.bucket, path),
                timestamp: chrono::Utc::now().timestamp(),
            })
        } else {
            Ok(StorageResult {
                success: false,
                message: format!("S3 upload failed: {}", response.status()),
                timestamp: chrono::Utc::now().timestamp(),
            })
        }
    }

    async fn download(&self, path: &str) -> Result<Vec<u8>> {
        let url = self.make_url(path);

        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| anyhow!("S3 download failed: {}", e))?;

        if response.status().is_success() {
            let bytes = response.bytes().await
                .map_err(|e| anyhow!("Failed to read response: {}", e))?;
            Ok(bytes.to_vec())
        } else {
            Err(anyhow!("S3 download failed: {}", response.status()))
        }
    }

    async fn delete(&self, path: &str) -> Result<StorageResult> {
        let url = self.make_url(path);

        let response = self.client
            .delete(&url)
            .send()
            .await
            .map_err(|e| anyhow!("S3 delete failed: {}", e))?;

        if response.status().is_success() {
            Ok(StorageResult {
                success: true,
                message: format!("Deleted s3://{}/{}", self.bucket, path),
                timestamp: chrono::Utc::now().timestamp(),
            })
        } else {
            Ok(StorageResult {
                success: false,
                message: format!("S3 delete failed: {}", response.status()),
                timestamp: chrono::Utc::now().timestamp(),
            })
        }
    }

    async fn list(&self, path: &str) -> Result<Vec<StorageItem>> {
        let url = format!(
            "{}/{}?list-type=2&prefix={}",
            self.endpoint.trim_end_matches('/'),
            self.bucket,
            path.trim_start_matches('/')
        );

        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| anyhow!("S3 list failed: {}", e))?;

        if response.status().is_success() {
            let body = response.text().await?;
            let items = parse_s3_list_response(&body);
            Ok(items)
        } else {
            Err(anyhow!("S3 list failed: {}", response.status()))
        }
    }

    async fn health_check(&self) -> Result<bool> {
        let url = format!("{}/{}", self.endpoint.trim_end_matches('/'), self.bucket);

        let response = self.client
            .head(&url)
            .send()
            .await
            .map_err(|e| anyhow!("S3 health check failed: {}", e))?;

        Ok(response.status().is_success())
    }
}

/// Parse S3 list response
fn parse_s3_list_response(body: &str) -> Vec<StorageItem> {
    let mut items = Vec::new();
    let mut in_contents = false;
    let mut current_key = String::new();
    let mut current_size = 0u64;

    for line in body.lines() {
        let line = line.trim();
        if line == "<Contents>" {
            in_contents = true;
        } else if line == "</Contents>" {
            if !current_key.is_empty() {
                items.push(StorageItem {
                    name: std::path::Path::new(&current_key)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| current_key.clone()),
                    path: current_key.clone(),
                    is_directory: false,
                    size: Some(current_size),
                    modified: None,
                });
            }
            current_key.clear();
            current_size = 0;
            in_contents = false;
        } else if in_contents {
            if line.starts_with("<Key>") && line.ends_with("</Key>") {
                current_key = line.replace("<Key>", "").replace("</Key>", "");
            } else if line.starts_with("<Size>") && line.ends_with("</Size>") {
                if let Ok(size) = line.replace("<Size>", "").replace("</Size>", "").parse() {
                    current_size = size;
                }
            }
        }
    }

    items
}

/// REST API storage implementation
pub struct RestApiStorage {
    endpoint: String,
    api_key: Option<String>,
    headers: HashMap<String, String>,
    client: reqwest::Client,
}

impl RestApiStorage {
    pub fn new(endpoint: String, api_key: Option<String>, headers: Option<HashMap<String, String>>) -> Self {
        Self {
            endpoint,
            api_key,
            headers: headers.unwrap_or_default(),
            client: reqwest::Client::new(),
        }
    }

    fn make_url(&self, path: &str) -> String {
        format!("{}/{}", self.endpoint.trim_end_matches('/'), path.trim_start_matches('/'))
    }
}

#[async_trait::async_trait]
impl StorageService for RestApiStorage {
    async fn upload(&self, path: &str, data: &[u8]) -> Result<StorageResult> {
        let url = self.make_url(path);

        let mut request = self.client.put(&url);

        if let Some(ref key) = self.api_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }

        for (k, v) in &self.headers {
            request = request.header(k.as_str(), v.as_str());
        }

        let response = request
            .body(data.to_vec())
            .send()
            .await
            .map_err(|e| anyhow!("REST API upload failed: {}", e))?;

        if response.status().is_success() {
            Ok(StorageResult {
                success: true,
                message: format!("Uploaded to {}", path),
                timestamp: chrono::Utc::now().timestamp(),
            })
        } else {
            Ok(StorageResult {
                success: false,
                message: format!("Upload failed: {}", response.status()),
                timestamp: chrono::Utc::now().timestamp(),
            })
        }
    }

    async fn download(&self, path: &str) -> Result<Vec<u8>> {
        let url = self.make_url(path);

        let mut request = self.client.get(&url);

        if let Some(ref key) = self.api_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }

        for (k, v) in &self.headers {
            request = request.header(k.as_str(), v.as_str());
        }

        let response = request
            .send()
            .await
            .map_err(|e| anyhow!("REST API download failed: {}", e))?;

        if response.status().is_success() {
            let bytes = response.bytes().await
                .map_err(|e| anyhow!("Failed to read response: {}", e))?;
            Ok(bytes.to_vec())
        } else {
            Err(anyhow!("Download failed: {}", response.status()))
        }
    }

    async fn delete(&self, path: &str) -> Result<StorageResult> {
        let url = self.make_url(path);

        let mut request = self.client.delete(&url);

        if let Some(ref key) = self.api_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }

        let response = request
            .send()
            .await
            .map_err(|e| anyhow!("REST API delete failed: {}", e))?;

        if response.status().is_success() {
            Ok(StorageResult {
                success: true,
                message: format!("Deleted {}", path),
                timestamp: chrono::Utc::now().timestamp(),
            })
        } else {
            Ok(StorageResult {
                success: false,
                message: format!("Delete failed: {}", response.status()),
                timestamp: chrono::Utc::now().timestamp(),
            })
        }
    }

    async fn list(&self, path: &str) -> Result<Vec<StorageItem>> {
        let url = format!("{}?list=true", self.make_url(path));

        let mut request = self.client.get(&url);

        if let Some(ref key) = self.api_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }

        let response = request
            .send()
            .await
            .map_err(|e| anyhow!("REST API list failed: {}", e))?;

        if response.status().is_success() {
            let body = response.text().await?;
            let items: Vec<StorageItem> = serde_json::from_str(&body)
                .unwrap_or_default();
            Ok(items)
        } else {
            Err(anyhow!("List failed: {}", response.status()))
        }
    }

    async fn health_check(&self) -> Result<bool> {
        let url = format!("{}/health", self.endpoint.trim_end_matches('/'));

        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| anyhow!("REST API health check failed: {}", e))?;

        Ok(response.status().is_success())
    }
}

/// Storage manager for managing multiple storage backends
pub struct StorageManager {
    backends: RwLock<HashMap<String, Arc<dyn StorageService>>>,
}

impl StorageManager {
    pub fn new() -> Self {
        Self {
            backends: RwLock::new(HashMap::new()),
        }
    }

    pub async fn add_backend(&self, name: &str, backend: Arc<dyn StorageService>) {
        let mut backends = self.backends.write().await;
        backends.insert(name.to_string(), backend);
    }

    pub async fn get_backend(&self, name: &str) -> Option<Arc<dyn StorageService>> {
        let backends = self.backends.read().await;
        backends.get(name).cloned()
    }

    pub async fn remove_backend(&self, name: &str) {
        let mut backends = self.backends.write().await;
        backends.remove(name);
    }

    pub async fn list_backends(&self) -> Vec<String> {
        let backends = self.backends.read().await;
        backends.keys().cloned().collect()
    }

    pub async fn create_from_config(&self, name: &str, config: &StorageConfig) -> Result<()> {
        let backend: Arc<dyn StorageService> = match &config.backend {
            StorageBackend::WebDAV { endpoint, username, password, base_path } => {
                Arc::new(WebDAVStorage::new(
                    endpoint.clone(),
                    username.clone(),
                    password.clone(),
                    base_path.clone(),
                ))
            }
            StorageBackend::S3 { endpoint, access_key, secret_key, bucket, region } => {
                Arc::new(S3Storage::new(
                    endpoint.clone(),
                    access_key.clone(),
                    secret_key.clone(),
                    bucket.clone(),
                    region.clone(),
                ))
            }
            StorageBackend::RestApi { endpoint, api_key, headers } => {
                Arc::new(RestApiStorage::new(
                    endpoint.clone(),
                    api_key.clone(),
                    headers.clone(),
                ))
            }
        };

        self.add_backend(name, backend).await;
        Ok(())
    }
}

impl Default for StorageManager {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

use crate::errors::StorageError;

/// Tauri command: Initialize storage backend from config
#[tauri::command]
#[allow(dead_code)]
pub async fn storage_init(
    _state: State<'_, SharedStateType>,
    backend_type: String,
    endpoint: String,
    _username: Option<String>,
    _password: Option<String>,
    _api_key: Option<String>,
    _base_path: Option<String>,
    _bucket: Option<String>,
    _region: Option<String>,
) -> Result<bool, StorageError> {
    tracing::info!(backend = %backend_type, endpoint = %endpoint, "storage_init called");
    Ok(true)
}

/// Tauri command: Check storage connection health
#[tauri::command]
pub async fn storage_health_check(
    _state: State<'_, SharedStateType>,
) -> Result<bool, StorageError> {
    // TODO: Implement health check using stored config
    tracing::debug!("storage_health_check called");
    Ok(true)
}

/// Tauri command: Upload data to storage
#[tauri::command]
#[allow(dead_code)]
pub async fn storage_upload(
    _state: State<'_, SharedStateType>,
    path: String,
    _data: String,
) -> Result<StorageResult, StorageError> {
    tracing::debug!(path = %path, "storage_upload called");
    // TODO: Implement actual upload using initialized backend
    Ok(StorageResult {
        success: false,
        message: "Storage backend not configured".to_string(),
        timestamp: chrono::Utc::now().timestamp(),
    })
}

/// Tauri command: Download data from storage
#[tauri::command]
pub async fn storage_download(
    _state: State<'_, SharedStateType>,
    path: String,
) -> Result<String, StorageError> {
    tracing::debug!(path = %path, "storage_download called");
    // TODO: Implement actual download using initialized backend
    Err(StorageError::NotConfigured)
}

/// Tauri command: List storage items
#[tauri::command]
pub async fn storage_list(
    _state: State<'_, SharedStateType>,
    path: String,
) -> Result<Vec<StorageItem>, StorageError> {
    tracing::debug!(path = %path, "storage_list called");
    // TODO: Implement actual list using initialized backend
    Ok(vec![])
}

/// Tauri command: Delete storage item
#[tauri::command]
pub async fn storage_delete(
    _state: State<'_, SharedStateType>,
    path: String,
) -> Result<StorageResult, StorageError> {
    tracing::debug!(path = %path, "storage_delete called");
    // TODO: Implement actual delete using initialized backend
    Ok(StorageResult {
        success: false,
        message: "Storage backend not configured".to_string(),
        timestamp: chrono::Utc::now().timestamp(),
    })
}
