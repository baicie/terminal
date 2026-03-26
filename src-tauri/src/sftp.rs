use crate::errors::SftpError;
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
) -> Result<(), SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }

    let sessions = get_ssh_sessions();
    let mut sessions = sessions.lock().await;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or(SftpError::SessionNotFound)?;

    // Open a channel for SFTP
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|_e| SftpError::SessionNotFound)?;

    // Request SFTP subsystem
    channel
        .request_subsystem(false, "sftp")
        .await
        .map_err(|_e| SftpError::SessionNotFound)?;

    // Create SFTP session from the channel stream
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|_e| SftpError::SessionNotFound)?;

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
) -> Result<Vec<SftpFileItem>, SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }
    if path.is_empty() {
        return Err(SftpError::InvalidPath(String::from("Path cannot be empty")));
    }

    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or(SftpError::SessionNotFound)?;

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
                let modified_time = match metadata.accessed() {
                    Ok(time) => match time.duration_since(std::time::UNIX_EPOCH) {
                        Ok(duration) => duration.as_secs() as i64,
                        Err(_) => 0,
                    },
                    Err(_) => 0,
                };

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
        Err(e) => Err(SftpError::ReadDirFailed(format!("Failed to read directory: {}", e))),
    }
}

#[tauri::command]
pub async fn sftp_upload(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }
    if local_path.is_empty() {
        return Err(SftpError::InvalidPath(String::from("Local path cannot be empty")));
    }
    if remote_path.is_empty() {
        return Err(SftpError::InvalidPath(String::from("Remote path cannot be empty")));
    }

    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or(SftpError::SessionNotFound)?;

    // Read local file
    let data = tokio::fs::read(&local_path)
        .await
        .map_err(|e| SftpError::UploadFailed(format!("Failed to read local file: {}", e)))?;

    // Write to remote path
    sftp
        .write(&remote_path, &data)
        .await
        .map_err(|e| SftpError::UploadFailed(format!("Failed to upload file: {}", e)))?;

    Ok(())
}

#[tauri::command]
pub async fn sftp_download(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }
    if remote_path.is_empty() {
        return Err(SftpError::InvalidPath(String::from("Remote path cannot be empty")));
    }
    if local_path.is_empty() {
        return Err(SftpError::InvalidPath(String::from("Local path cannot be empty")));
    }

    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or(SftpError::SessionNotFound)?;

    // Read remote file
    let data = sftp
        .read(&remote_path)
        .await
        .map_err(|e| SftpError::DownloadFailed(format!("Failed to read remote file: {}", e)))?;

    // Write to local path
    tokio::fs::write(&local_path, data)
        .await
        .map_err(|e| SftpError::DownloadFailed(format!("Failed to write local file: {}", e)))?;

    Ok(())
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    path: String,
) -> Result<(), SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }
    if path.is_empty() {
        return Err(SftpError::InvalidPath(String::from("Path cannot be empty")));
    }

    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or(SftpError::SessionNotFound)?;

    sftp
        .create_dir(&path)
        .await
        .map_err(|e| SftpError::MkdirFailed(format!("Failed to create directory: {}", e)))?;

    Ok(())
}

#[tauri::command]
pub async fn sftp_delete(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    path: String,
    is_directory: bool,
) -> Result<(), SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }
    if path.is_empty() {
        return Err(SftpError::InvalidPath(String::from("Path cannot be empty")));
    }

    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or(SftpError::SessionNotFound)?;

    if is_directory {
        sftp
            .remove_dir(&path)
            .await
            .map_err(|e| SftpError::DeleteFailed(format!("Failed to remove directory: {}", e)))?;
    } else {
        sftp
            .remove_file(&path)
            .await
            .map_err(|e| SftpError::DeleteFailed(format!("Failed to remove file: {}", e)))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_rename(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), SftpError> {
    if session_id.is_empty() {
        return Err(SftpError::SessionNotFound);
    }
    if old_path.is_empty() {
        return Err(SftpError::InvalidPath(String::from("Old path cannot be empty")));
    }
    if new_path.is_empty() {
        return Err(SftpError::InvalidPath(String::from("New path cannot be empty")));
    }

    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or(SftpError::SessionNotFound)?;

    sftp
        .rename(&old_path, &new_path)
        .await
        .map_err(|e| SftpError::RenameFailed(format!("Failed to rename: {}", e)))?;

    Ok(())
}
