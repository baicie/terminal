use crate::errors::PortForwardError;
use crate::session::get_ssh_sessions;
use crate::state::{PortForwardConfig, PortForwardInfo, PortForwardTask, SharedStateType};
use futures::channel::mpsc;
use futures::SinkExt;
use log::{info, warn};
use russh::ChannelId;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex as TokioMutex;
use tokio::task::JoinHandle;

/// Type alias for SSH session handle wrapped in Arc
type SshHandle = Arc<russh::client::Handle<crate::state::ClientHandler>>;

/// Start a port forward (local, remote, or dynamic)
#[tauri::command]
pub async fn port_forward_start(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    config: PortForwardConfig,
) -> Result<(), PortForwardError> {
    if session_id.is_empty() {
        return Err(PortForwardError::SessionNotFound);
    }
    if config.local_host.is_empty() {
        return Err(PortForwardError::BindFailed(String::from("Local host cannot be empty")));
    }
    if !(1..=65535).contains(&config.local_port) {
        return Err(PortForwardError::BindFailed(String::from("Invalid local port")));
    }

    // Get SSH session handle
    let sessions = get_ssh_sessions();
    let sessions_lock = sessions.lock().await;
    let handle: SshHandle = sessions_lock
        .get(&session_id)
        .ok_or(PortForwardError::SessionNotFound)?
        .clone();
    drop(sessions_lock);

    let forward_id = config.id.clone();
    let local_host = config.local_host.clone();
    let local_port = config.local_port;
    let remote_host = config.remote_host.clone();
    let remote_port = config.remote_port;
    let forward_type = config.forward_type.clone();
    let name = config.name.clone();
    let config_local_host = config.local_host.clone();
    let config_remote_host = config.remote_host.clone();

    // Spawn the port forwarding task
    let task: JoinHandle<Result<(), PortForwardError>> = tokio::spawn(async move {
        match forward_type.as_str() {
            "local" => {
                start_local_forward(handle, local_host, local_port, remote_host, remote_port).await
            }
            "remote" => {
                start_remote_forward(handle, local_port, remote_host, remote_port).await
            }
            "dynamic" => {
                start_dynamic_forward(handle, local_host, local_port).await
            }
            _ => Err(PortForwardError::BindFailed(format!(
                "Unknown forward type: {}",
                forward_type
            ))),
        }
    });

    // Store the task with additional info
    let mut port_forwards = state.port_forwards.lock().await;
    let info = PortForwardInfo {
        name,
        forward_type: config.forward_type,
        local_host: config.local_host,
        local_port: config.local_port,
        remote_host: config.remote_host,
        remote_port: config.remote_port,
        status: "active".to_string(),
    };
    port_forwards.insert(forward_id.clone(), PortForwardTask { task, info });

    info!(
        "Port forward started: {} ({}:{} -> {}:{})",
        forward_id, config_local_host, local_port, config_remote_host, remote_port
    );
    Ok(())
}

/// Local port forwarding: listen locally and forward through SSH to remote
async fn start_local_forward(
    handle: SshHandle,
    local_host: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<(), PortForwardError> {
    let addr = format!("{}:{}", local_host, local_port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| PortForwardError::BindFailed(format!("Failed to bind {}: {}", addr, e)))?;

    info!("Local port forward listening on {}", addr);

    loop {
        match listener.accept().await {
            Ok((socket, peer_addr)) => {
                let handle_clone = handle.clone();
                let remote_host_clone = remote_host.clone();

                tokio::spawn(async move {
                    match handle_clone
                        .channel_open_direct_tcpip(&remote_host_clone, remote_port as u32, &peer_addr.ip().to_string(), peer_addr.port() as u32)
                        .await
                    {
                        Ok(channel) => {
                            let channel_id = channel.id();
                            if let Err(e) = forward_socket(handle_clone, channel_id, channel, socket).await {
                                warn!("Local forward error: {:?}", e);
                            }
                        }
                        Err(e) => {
                            warn!("Failed to open SSH channel for forward: {:?}", e);
                        }
                    }
                });
            }
            Err(e) => {
                warn!("Failed to accept connection: {:?}", e);
            }
        }
    }
}

/// Remote port forwarding: request server to listen and forward back to us
async fn start_remote_forward(
    handle: SshHandle,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<(), PortForwardError> {
    info!(
        "Remote port forward: connecting to {}:{} via local port {}",
        remote_host, remote_port, local_port
    );

    // For remote forwarding, we connect to local port and forward through SSH
    loop {
        let local_addr = format!("127.0.0.1:{}", local_port);
        match TcpStream::connect(&local_addr).await {
            Ok(socket) => {
                let handle_clone = handle.clone();
                let target_host = if remote_host.is_empty() {
                    "127.0.0.1".to_string()
                } else {
                    remote_host.clone()
                };

                tokio::spawn(async move {
                    match handle_clone
                        .channel_open_direct_tcpip(&target_host, remote_port as u32, "127.0.0.1", local_port as u32)
                        .await
                    {
                        Ok(channel) => {
                            let channel_id = channel.id();
                            if let Err(e) = forward_socket(handle_clone, channel_id, channel, socket).await {
                                warn!("Remote forward error: {:?}", e);
                            }
                        }
                        Err(e) => {
                            warn!("Failed to open SSH channel for remote forward: {:?}", e);
                        }
                    }
                });
            }
            Err(e) => {
                warn!("Failed to connect to local port {}: {:?}", local_addr, e);
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            }
        }
    }
}

/// Dynamic port forwarding: SOCKS5 proxy over SSH
async fn start_dynamic_forward(
    handle: SshHandle,
    local_host: String,
    local_port: u16,
) -> Result<(), PortForwardError> {
    let addr = format!("{}:{}", local_host, local_port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| PortForwardError::BindFailed(format!("Failed to bind {}: {}", addr, e)))?;

    info!("Dynamic (SOCKS5) port forward listening on {}", addr);

    loop {
        match listener.accept().await {
            Ok((socket, peer_addr)) => {
                let handle_clone = handle.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_socks5_client(&handle_clone, socket, peer_addr).await {
                        warn!("SOCKS5 client error: {:?}", e);
                    }
                });
            }
            Err(e) => {
                warn!("Failed to accept SOCKS5 connection: {:?}", e);
            }
        }
    }
}

/// Bidirectional data forwarding between SSH channel and TCP socket
async fn forward_socket<S: AsyncRead + AsyncWrite + Send + 'static + std::marker::Unpin>(
    handle: SshHandle,
    channel_id: ChannelId,
    mut channel: russh::Channel<russh::client::Msg>,
    socket: S,
) -> Result<(), PortForwardError> {
    // Use Arc<Mutex<>> for socket halves sharing
    let socket = Arc::new(TokioMutex::new(socket));
    let socket_read = socket.clone();
    let socket_write = socket.clone();

    // Create mpsc channel for passing data from socket to SSH
    let (mut tx, mut rx) = mpsc::channel::<Vec<u8>>(1024);

    // Spawn task to read from socket and send to SSH
    let socket_reader = async move {
        let socket = socket_read;
        let mut buf = [0u8; 8192];
        loop {
            match socket.lock().await.read(&mut buf).await {
                Ok(0) => {
                    break;
                }
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    if tx.send(data).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    };

    // Read from SSH and write to socket
    let socket_writer = async move {
        let socket = socket_write;
        loop {
            tokio::select! {
                // Handle data from socket reader
                result = rx.recv() => {
                    match result {
                        Ok(data) => {
                            if handle.data(channel_id, data).await.is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }

                // Handle data from SSH channel
                msg = channel.wait() => {
                    match msg {
                        Some(russh::ChannelMsg::Data { data }) => {
                            if socket.lock().await.write_all(&data).await.is_err() {
                                break;
                            }
                        }
                        Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                            if socket.lock().await.write_all(&data).await.is_err() {
                                break;
                            }
                        }
                        Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close { .. }) => {
                            let _ = socket.lock().await.shutdown().await;
                            break;
                        }
                        None => break,
                        _ => continue,
                    }
                }
            }
        }
        let _ = socket.lock().await.shutdown().await;
    };

    // Run both tasks concurrently
    tokio::join!(socket_reader, socket_writer);

    Ok(())
}

/// Handle a SOCKS5 client connection
async fn handle_socks5_client(
    handle: &SshHandle,
    mut socket: TcpStream,
    peer_addr: std::net::SocketAddr,
) -> Result<(), PortForwardError> {
    let mut buf = [0u8; 262];
    let n = socket
        .read(&mut buf)
        .await
        .map_err(|e| PortForwardError::ConnectionFailed(format!("Read error: {}", e)))?;

    if n < 2 {
        return Err(PortForwardError::SocksUnsupported("Invalid SOCKS greeting".to_string()));
    }

    // SOCKS5 greeting: VER(1) + NMETHODS(1) + METHODS(n)
    let ver = buf[0];
    if ver != 0x05 {
        return Err(PortForwardError::SocksUnsupported(format!(
            "Unsupported SOCKS version: {}",
            ver
        )));
    }

    let nmethods = buf[1] as usize;
    if n < 2 + nmethods {
        return Err(PortForwardError::SocksUnsupported("Invalid SOCKS methods".to_string()));
    }

    // Check for NO_AUTH method (0x00)
    let has_no_auth = buf[2..2 + nmethods].contains(&0x00);

    // SOCKS5 response: VER(1) + METHOD(1)
    if has_no_auth {
        socket
            .write_all(&[0x05, 0x00])
            .await
            .map_err(|e| PortForwardError::ConnectionFailed(format!("Write error: {}", e)))?;
    } else {
        socket
            .write_all(&[0x05, 0xFF])
            .await
            .map_err(|e| PortForwardError::ConnectionFailed(format!("Write error: {}", e)))?;
        return Err(PortForwardError::SocksAuthFailed(
            "No supported authentication method".to_string(),
        ));
    }

    // Read CONNECT request: VER(1) + CMD(1) + RSV(1) + ATYP(1) + DST.ADDR + DST.PORT(2)
    let n = socket
        .read(&mut buf)
        .await
        .map_err(|e| PortForwardError::ConnectionFailed(format!("Read error: {}", e)))?;

    if n < 4 {
        return Err(PortForwardError::SocksUnsupported(
            "Invalid CONNECT request".to_string(),
        ));
    }

    let ver = buf[0];
    if ver != 0x05 {
        return Err(PortForwardError::SocksUnsupported(format!(
            "Unsupported SOCKS version: {}",
            ver
        )));
    }

    let cmd = buf[1];
    let atyp = buf[3];

    // Parse destination address
    let (target_host, target_port) = match atyp {
        0x01 => {
            // IPv4: DST.ADDR(4) + DST.PORT(2)
            if n < 10 {
                return Err(PortForwardError::SocksUnsupported("Invalid IPv4 request".to_string()));
            }
            let ip = format!(
                "{}.{}.{}.{}",
                buf[4], buf[5], buf[6], buf[7]
            );
            let port = ((buf[8] as u16) << 8) | (buf[9] as u16);
            (ip, port)
        }
        0x03 => {
            // Domain name: DST.ADDR(1) + DOMAIN-LEN(1) + DOMAIN + DST.PORT(2)
            let domain_len = buf[4] as usize;
            if n < 7 + domain_len {
                return Err(PortForwardError::SocksUnsupported(
                    "Invalid domain request".to_string(),
                ));
            }
            let domain = std::str::from_utf8(&buf[5..5 + domain_len])
                .map_err(|_| PortForwardError::SocksUnsupported("Invalid domain name".to_string()))?
                .to_string();
            let port = ((buf[5 + domain_len] as u16) << 8) | (buf[6 + domain_len] as u16);
            (domain, port)
        }
        0x04 => {
            // IPv6: DST.ADDR(16) + DST.PORT(2)
            if n < 22 {
                return Err(PortForwardError::SocksUnsupported("Invalid IPv6 request".to_string()));
            }
            let ip = "ipv6".to_string();
            let port = ((buf[20] as u16) << 8) | (buf[21] as u16);
            (ip, port)
        }
        _ => {
            socket
                .write_all(&[0x05, 0x08, 0x00, 0x01])
                .await
                .ok();
            return Err(PortForwardError::SocksUnsupported(format!(
                "Unsupported address type: {}",
                atyp
            )));
        }
    };

    if cmd != 0x01 {
        // Only CONNECT (0x01) is supported
        socket
            .write_all(&[0x05, 0x07, 0x00, 0x01])
            .await
            .ok();
        return Err(PortForwardError::SocksUnsupported("Unsupported command".to_string()));
    }

    // Open SSH channel for this connection
    match handle
        .channel_open_direct_tcpip(&target_host, target_port as u32, &peer_addr.ip().to_string(), peer_addr.port() as u32)
        .await
    {
        Ok(channel) => {
            // Send success reply: VER(1) + REP(1) + RSV(1) + ATYP(1) + BND.ADDR + BND.PORT(2)
            socket
                .write_all(&[0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
                .await
                .ok();

            let channel_id = channel.id();
            if let Err(e) = forward_socket(handle.clone(), channel_id, channel, socket).await {
                warn!("SOCKS5 forward error: {:?}", e);
            }
        }
        Err(e) => {
            // Send failure reply
            socket
                .write_all(&[0x05, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
                .await
                .ok();
            return Err(PortForwardError::ChannelFailed(format!(
                "Failed to open SSH channel: {}",
                e
            )));
        }
    }

    Ok(())
}

/// Stop a port forward
#[tauri::command]
pub async fn port_forward_stop(
    state: tauri::State<'_, SharedStateType>,
    forward_id: String,
) -> Result<(), PortForwardError> {
    if forward_id.is_empty() {
        return Err(PortForwardError::ForwardNotFound);
    }

    let mut port_forwards = state.port_forwards.lock().await;
    if let Some(forward) = port_forwards.remove(&forward_id) {
        forward.task.abort();
        info!("Port forward stopped: {}", forward_id);
    }
    Ok(())
}

/// List active port forwards with detailed info
#[tauri::command]
pub async fn port_forward_list(
    state: tauri::State<'_, SharedStateType>,
) -> Result<Vec<PortForwardInfo>, PortForwardError> {
    let port_forwards = state.port_forwards.lock().await;
    Ok(port_forwards.values().map(|f| f.info.clone()).collect())
}
