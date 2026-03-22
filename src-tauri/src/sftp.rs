use crate::ssh::get_ssh_sessions;
use crate::state::{SftpFileItem, SharedStateType};
use russh_sftp::client::SftpSession;

fn format_permissions(perms: &russh_sftp::protocol::FilePermissions) -> String {
    format!("{}", perms)
}

#[tauri::command]
pub async fn sftp_connect(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
) -> Result<(), String> {
    let sessions = get_ssh_sessions();
    let mut sessions = sessions.lock().await;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "SSH session not found".to_string())?;

    // Open a channel for SFTP
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    // Request SFTP subsystem
    channel
        .request_subsystem(false, "sftp")
        .await
        .map_err(|e| format!("Failed to request SFTP subsystem: {}", e))?;

    // Create SFTP session from the channel stream
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

    // Store the SFTP session
    let mut sftp_sessions = state.sftp_sessions.lock().await;
    sftp_sessions.insert(session_id.clone(), sftp);

    Ok(())
}

#[tauri::command]
pub async fn sftp_list(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    path: String,
) -> Result<Vec<SftpFileItem>, String> {
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found. Call sftp_connect first.".to_string())?;

    let mut items = Vec::new();

    // Normalize path - ensure it ends with / for directory listing
    let dir_path = if path.ends_with('/') {
        path.trim_end_matches('/').to_string()
    } else {
        path.clone()
    };

    match sftp.read_dir(&dir_path).await {
        Ok(entries) => {
            for entry in entries {
                let name = entry.file_name();
                let full_path = format!("{}/{}", dir_path.trim_end_matches('/'), name);

                let metadata = entry.metadata();

                let is_directory = metadata.is_dir();
                let size = metadata.len();
                let modified_time = metadata
                    .accessed()
                    .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64)
                    .unwrap_or(0);

                let permissions = format_permissions(&metadata.permissions());

                items.push(SftpFileItem {
                    name,
                    path: full_path,
                    is_directory,
                    size,
                    modified_time,
                    permissions,
                });
            }
            Ok(items)
        }
        Err(e) => Err(format!("Failed to read directory: {}", e)),
    }
}

#[tauri::command]
pub async fn sftp_upload(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found. Call sftp_connect first.".to_string())?;

    // Read local file
    let data = tokio::fs::read(&local_path)
        .await
        .map_err(|e| format!("Failed to read local file: {}", e))?;

    // Write to remote path
    sftp
        .write(&remote_path, &data)
        .await
        .map_err(|e| format!("Failed to upload file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn sftp_download(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found. Call sftp_connect first.".to_string())?;

    // Read remote file
    let data = sftp
        .read(&remote_path)
        .await
        .map_err(|e| format!("Failed to read remote file: {}", e))?;

    // Write to local path
    tokio::fs::write(&local_path, data)
        .await
        .map_err(|e| format!("Failed to write local file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found. Call sftp_connect first.".to_string())?;

    sftp
        .create_dir(&path)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn sftp_delete(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    path: String,
    is_directory: bool,
) -> Result<(), String> {
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found. Call sftp_connect first.".to_string())?;

    if is_directory {
        sftp
            .remove_dir(&path)
            .await
            .map_err(|e| format!("Failed to remove directory: {}", e))?;
    } else {
        sftp
            .remove_file(&path)
            .await
            .map_err(|e| format!("Failed to remove file: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_rename(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or_else(|| "SFTP session not found. Call sftp_connect first.".to_string())?;

    sftp
        .rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("Failed to rename: {}", e))?;

    Ok(())
}
