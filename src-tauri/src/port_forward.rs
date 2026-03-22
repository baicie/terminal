use crate::ssh::get_ssh_sessions;
use crate::state::{PortForwardConfig, PortForwardTask, SharedStateType};
use tokio::net::TcpListener;

#[tauri::command]
pub async fn port_forward_start(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    config: PortForwardConfig,
) -> Result<(), String> {
    // Get SSH session handle
    let sessions = get_ssh_sessions();
    let mut sessions = sessions.lock().await;
    let _handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "SSH session not found".to_string())?;
    drop(sessions);

    let forward_id = config.id.clone();
    let local_host = config.local_host.clone();
    let local_port = config.local_port;
    let _remote_host = config.remote_host.clone();
    let _remote_port = config.remote_port;
    let forward_type = config.forward_type.clone();

    // Spawn the port forwarding task
    let task = tokio::spawn(async move {
        match forward_type.as_str() {
            "local" | "dynamic" => {
                // For simplicity, we start a TCP listener
                let addr = format!("{}:{}", local_host, local_port);
                match TcpListener::bind(&addr).await {
                    Ok(listener) => {
                        println!("Port forward listening on {}", addr);
                        // In a full implementation, this would handle connections
                        // and forward them through the SSH channel
                        loop {
                            if listener.accept().await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to bind port: {}", e);
                    }
                }
            }
            "remote" => {
                eprintln!("Remote port forwarding not implemented")
            }
            _ => {
                eprintln!("Unknown forward type: {}", forward_type)
            }
        }
    });

    // Store the task
    let mut port_forwards = state.port_forwards.lock().await;
    port_forwards.insert(forward_id, PortForwardTask { task });

    Ok(())
}

/// Stop a port forward
#[tauri::command]
pub async fn port_forward_stop(
    state: tauri::State<'_, SharedStateType>,
    forward_id: String,
) -> Result<(), String> {
    let mut port_forwards = state.port_forwards.lock().await;
    if let Some(forward) = port_forwards.remove(&forward_id) {
        forward.task.abort();
    }
    Ok(())
}

/// List active port forwards
#[tauri::command]
pub async fn port_forward_list(
    state: tauri::State<'_, SharedStateType>,
) -> Result<Vec<String>, String> {
    let port_forwards = state.port_forwards.lock().await;
    Ok(port_forwards.keys().cloned().collect())
}
