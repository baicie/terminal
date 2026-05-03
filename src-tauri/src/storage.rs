//! Storage service module
//!
//! Provides unified storage abstraction for WebDAV, S3, and custom REST API backends.
//!
//! `StorageManager` 由 `lib.rs` 以 `Arc<StorageManager>` 注入 Tauri State；所有
//! `storage_*` 命令使用固定后端名 `default`（与设置里「测试连接」一致）。

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

/// Storage backend types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
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

/// S3 SigV4 signing helpers
/// Implements AWS Signature Version 4 for authenticating S3 API requests.
use hmac::{Hmac, Mac};
use sha2::Sha256;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

type HmacSha256 = Hmac<Sha256>;

fn hmac_sign(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn sha256_hex(data: &[u8]) -> String {
    use sha2::Digest;
    let hash = Sha256::digest(data);
    hex::encode(hash)
}

fn signed_headers() -> &'static str {
    "host;x-amz-content-sha256;x-amz-date"
}

fn credential_scope(date: &str) -> String {
    format!("{}/s3/aws4_request", date)
}

/// Add SigV4 Authorization header to a reqwest RequestBuilder.
fn sign_request(
    req_builder: reqwest::RequestBuilder,
    method: &str,
    url: &str,
    _payload: Option<&[u8]>,
    access_key: &str,
    secret_key: &str,
    region: &str,
    payload_hash: &str,
) -> reqwest::RequestBuilder {
    use std::time::{SystemTime, UNIX_EPOCH};

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let datetime = OffsetDateTime::from_unix_timestamp(now as i64).unwrap();
    let amz_date = datetime.format(&Rfc3339).unwrap().replace([':', '-'], "").replace("+", "Z");
    let date_stamp = &amz_date[..8];

    let host = url.split('/').nth(2).unwrap_or("");
    let canonical_uri = format!("/{}", url.splitn(3, '/').nth(2).unwrap_or("/"));
    let canonical_querystring = "";

    let canonical_headers = format!(
        "host:{}\nx-amz-content-sha256:{}\nx-amz-date:{}\n",
        host, payload_hash, amz_date
    );

    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        method,
        canonical_uri,
        canonical_querystring,
        canonical_headers,
        signed_headers(),
        payload_hash
    );
    let cs = credential_scope(date_stamp);
    let canonical_request_hash = sha256_hex(canonical_request.as_bytes());

    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}\n{}",
        amz_date, cs, date_stamp, canonical_request_hash
    );

    // Build signing key
    let k_date = hmac_sign(format!("AWS4{}", secret_key).as_bytes(), date_stamp.as_bytes());
    let k_region = hmac_sign(&k_date, region.as_bytes());
    let k_service = hmac_sign(&k_region, b"s3");
    let k_signing = hmac_sign(&k_service, b"aws4_request");

    let signature = hex::encode(hmac_sign(&k_signing, string_to_sign.as_bytes()));

    let auth_header = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        access_key, cs, signed_headers(), signature
    );

    req_builder
        .header("x-amz-date", &amz_date)
        .header("x-amz-content-sha256", payload_hash)
        .header("Authorization", &auth_header)
}

/// S3 storage implementation with full AWS SigV4 signing
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

    /// Build the full S3 URL (path-style: https://endpoint/bucket/key)
    fn make_url(&self, key: &str) -> String {
        let endpoint = self.endpoint.trim_end_matches('/');
        let bucket = self.bucket.trim_start_matches('/');
        let p = key.trim_start_matches('/');
        if p.is_empty() {
            format!("{}/{}", endpoint, bucket)
        } else {
            format!("{}/{}/{}", endpoint, bucket, p)
        }
    }

    /// Sign and send an S3 request with the given method and body.
    fn signed_request(&self, method: &str, key: &str, data: Option<&[u8]>) -> reqwest::RequestBuilder {
        let url = self.make_url(key);
        let payload_hash = sha256_hex(data.unwrap_or(&[]));
        let req = match method {
            "PUT" => self.client.put(&url).body(data.map(|b| b.to_vec()).unwrap_or_default()),
            "GET" => self.client.get(&url),
            "DELETE" => self.client.delete(&url),
            "HEAD" => self.client.head(&url),
            _ => self.client.get(&url),
        };
        sign_request(req, method, &url, data, &self.access_key, &self.secret_key, &self.region, &payload_hash)
    }
}

#[async_trait::async_trait]
impl StorageService for S3Storage {
    async fn upload(&self, path: &str, data: &[u8]) -> Result<StorageResult> {
        let response = self.signed_request("PUT", path, Some(data)).send().await
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
        let response = self.signed_request("GET", path, None).send().await
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
        let response = self.signed_request("DELETE", path, None).send().await
            .map_err(|e| anyhow!("S3 delete failed: {}", e))?;

        if response.status().is_success() || response.status().as_u16() == 204 {
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
        let prefix = path.trim_start_matches('/');
        let encoded_prefix = percent_encode_rfc3986(prefix);
        // Build virtual-hosted-style list URL: https://{host}/{bucket}?list-type=2&prefix={prefix}
        let host = self.endpoint.trim_start_matches("https://").trim_start_matches("http://");
        let key = format!("{}/{}?list-type=2&prefix={}", host, self.bucket, encoded_prefix);

        let response = self.signed_request("GET", &key, None).send().await
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
        let response = self.signed_request("HEAD", "", None).send().await
            .map_err(|e| anyhow!("S3 health check failed: {}", e))?;
        Ok(response.status().is_success())
    }
}

/// RFC 3986 percent encoding for S3 signing
fn percent_encode_rfc3986(s: &str) -> String {
    s.chars().map(|c| {
        match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        }
    }).collect()
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

    /// 预留：设置 UI「已配置后端列表」或诊断命令。
    #[allow(dead_code)]
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

/// 与设置页「测试连接」共用的默认后端实例名。
const DEFAULT_STORAGE_NAME: &str = "default";

#[allow(clippy::too_many_arguments)]
fn build_storage_backend(
    backend_type: &str,
    endpoint: String,
    username: Option<String>,
    password: Option<String>,
    api_key: Option<String>,
    base_path: Option<String>,
    bucket: Option<String>,
    region: Option<String>,
) -> Result<StorageBackend, StorageError> {
    let t = backend_type.to_ascii_lowercase();
    match t.as_str() {
        "webdav" => {
            if endpoint.trim().is_empty() {
                return Err(StorageError::ConnectionFailed(
                    "WebDAV endpoint required".to_string(),
                ));
            }
            Ok(StorageBackend::WebDAV {
                endpoint,
                username: username.unwrap_or_default(),
                password: password.unwrap_or_default(),
                base_path,
            })
        }
        "s3" => {
            let bucket = bucket.ok_or_else(|| {
                StorageError::ConnectionFailed("S3 bucket name required".to_string())
            })?;
            if bucket.trim().is_empty() {
                return Err(StorageError::ConnectionFailed(
                    "S3 bucket name cannot be empty".to_string(),
                ));
            }
            Ok(StorageBackend::S3 {
                endpoint,
                access_key: username.unwrap_or_default(),
                secret_key: password.unwrap_or_default(),
                bucket,
                region,
            })
        }
        "custom" => {
            if endpoint.trim().is_empty() {
                return Err(StorageError::ConnectionFailed(
                    "REST API endpoint required".to_string(),
                ));
            }
            Ok(StorageBackend::RestApi {
                endpoint,
                api_key,
                headers: None,
            })
        }
        _ => Err(StorageError::ConnectionFailed(format!(
            "Unknown storage backend type: {backend_type}"
        ))),
    }
}

/// Tauri command: Initialize storage backend from config
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn storage_init(
    manager: State<'_, Arc<StorageManager>>,
    backend_type: String,
    endpoint: String,
    username: Option<String>,
    password: Option<String>,
    api_key: Option<String>,
    base_path: Option<String>,
    bucket: Option<String>,
    region: Option<String>,
) -> Result<bool, StorageError> {
    tracing::info!(backend = %backend_type, endpoint = %endpoint, "storage_init");
    let backend = build_storage_backend(
        &backend_type,
        endpoint,
        username,
        password,
        api_key,
        base_path,
        bucket,
        region,
    )?;
    let config = StorageConfig {
        backend,
        enabled: true,
    };
    manager
        .remove_backend(DEFAULT_STORAGE_NAME)
        .await;
    manager
        .create_from_config(DEFAULT_STORAGE_NAME, &config)
        .await
        .map_err(|e| StorageError::ConnectionFailed(e.to_string()))?;
    Ok(true)
}

/// Tauri command: Check storage connection health
#[tauri::command]
pub async fn storage_health_check(
    manager: State<'_, Arc<StorageManager>>,
) -> Result<bool, StorageError> {
    let backend = manager
        .get_backend(DEFAULT_STORAGE_NAME)
        .await
        .ok_or(StorageError::NotConfigured)?;
    backend
        .health_check()
        .await
        .map_err(|e| StorageError::ConnectionFailed(e.to_string()))
}

/// Tauri command: Upload data to storage
#[tauri::command]
pub async fn storage_upload(
    manager: State<'_, Arc<StorageManager>>,
    path: String,
    data: String,
) -> Result<StorageResult, StorageError> {
    let backend = manager
        .get_backend(DEFAULT_STORAGE_NAME)
        .await
        .ok_or(StorageError::NotConfigured)?;
    backend
        .upload(&path, data.as_bytes())
        .await
        .map_err(|e| StorageError::UploadFailed(e.to_string()))
}

/// Tauri command: Download data from storage
#[tauri::command]
pub async fn storage_download(
    manager: State<'_, Arc<StorageManager>>,
    path: String,
) -> Result<String, StorageError> {
    let backend = manager
        .get_backend(DEFAULT_STORAGE_NAME)
        .await
        .ok_or(StorageError::NotConfigured)?;
    let bytes = backend
        .download(&path)
        .await
        .map_err(|e| StorageError::DownloadFailed(e.to_string()))?;
    String::from_utf8(bytes).map_err(|e| {
        StorageError::DownloadFailed(format!("Response is not valid UTF-8: {e}"))
    })
}

/// Tauri command: List storage items
#[tauri::command]
pub async fn storage_list(
    manager: State<'_, Arc<StorageManager>>,
    path: String,
) -> Result<Vec<StorageItem>, StorageError> {
    let backend = manager
        .get_backend(DEFAULT_STORAGE_NAME)
        .await
        .ok_or(StorageError::NotConfigured)?;
    backend
        .list(&path)
        .await
        .map_err(|e| StorageError::ListFailed(e.to_string()))
}

/// Tauri command: Delete storage item
#[tauri::command]
pub async fn storage_delete(
    manager: State<'_, Arc<StorageManager>>,
    path: String,
) -> Result<StorageResult, StorageError> {
    let backend = manager
        .get_backend(DEFAULT_STORAGE_NAME)
        .await
        .ok_or(StorageError::NotConfigured)?;
    backend
        .delete(&path)
        .await
        .map_err(|e| StorageError::DeleteFailed(e.to_string()))
}
