use crate::errors::PortForwardError;
use crate::session::get_session_manager;
use crate::state::{
    ForwardedChannelMsg, PortForwardConfig, PortForwardInfo, PortForwardTask, SharedStateType,
    TcpForwardListener,
};
use russh::ChannelId;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::sync::Mutex as TokioMutex;
use tokio::task::JoinHandle;

/// Type alias for SSH session handle wrapped in Arc
type SshHandle = Arc<russh::client::Handle<crate::state::ClientHandler>>;

// ============================================================================
// Command: start port forward (local, remote, or dynamic)
// ============================================================================

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
    if config.local_host.is_empty() && config.forward_type != "remote" {
        return Err(PortForwardError::BindFailed(
            "Local host cannot be empty for local/dynamic forwards".to_string(),
        ));
    }
    if config.forward_type != "remote" && !(1..=65535).contains(&config.local_port) {
        return Err(PortForwardError::BindFailed(
            "Invalid local port (must be 1-65535, or 0 for remote)".to_string(),
        ));
    }

    let handle = get_session_manager()
        .get_ssh_handle(&session_id)
        .await
        .ok_or(PortForwardError::SessionNotFound)?;

    // Extract all config fields BEFORE the async move block.
    let forward_id = config.id.clone();
    let name = config.name.clone();
    let ft_for_info = config.forward_type.clone();
    let ft_for_tracing = config.forward_type.clone();
    let local_host_for_info = config.local_host.clone();
    let remote_host_for_info = config.remote_host.clone();
    let local_port = config.local_port;
    let remote_port = config.remote_port;
    let local_host_clone = config.local_host.clone();
    let remote_host_clone = config.remote_host.clone();
    let ft_clone = config.forward_type.clone();

    let mut port_forwards = state.port_forwards.lock().await;

    // Remote forward requires special handling: we need the TcpForwardListener
    // to store in PortForwardTask BEFORE spawning the task (so the task can
    // be properly cleaned up on stop).
    if ft_clone == "remote" {
        let (listener, rx) =
            setup_remote_forward(handle.clone(), local_port, remote_host_clone, remote_port)
                .await?;

        let task: JoinHandle<Result<(), PortForwardError>> = tokio::spawn(async move {
            handle_forwarded_connections(handle, rx, remote_port).await;
            Ok(())
        });

        let info = PortForwardInfo {
            name,
            forward_type: ft_for_info,
            local_host: local_host_for_info,
            local_port,
            remote_host: remote_host_for_info,
            remote_port,
            status: "active".to_string(),
        };

        port_forwards.insert(
            forward_id,
            PortForwardTask {
                task,
                listener: Some(listener),
                info,
            },
        );
        tracing::info!(forward_type = %ft_for_tracing, "port forward started");
        return Ok(());
    }

    let task: JoinHandle<Result<(), PortForwardError>> = tokio::spawn(async move {
        match ft_clone.as_str() {
            "local" => {
                start_local_forward(
                    handle,
                    local_host_clone,
                    local_port,
                    remote_host_clone,
                    remote_port,
                )
                .await
            }
            "dynamic" => start_dynamic_forward(handle, config.local_host, local_port).await,
            _ => Err(PortForwardError::BindFailed(format!(
                "Unknown forward type: {}",
                ft_clone
            ))),
        }
    });

    let info = PortForwardInfo {
        name,
        forward_type: ft_for_info,
        local_host: local_host_for_info,
        local_port,
        remote_host: remote_host_for_info,
        remote_port,
        status: "active".to_string(),
    };

    port_forwards.insert(
        forward_id,
        PortForwardTask {
            task,
            listener: None,
            info,
        },
    );

    tracing::info!(forward_type = %ft_for_tracing, "port forward started");
    Ok(())
}

// ============================================================================
// Local port forwarding: listen locally, forward through SSH to remote
// ============================================================================

async fn start_local_forward(
    handle: SshHandle,
    local_host: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<(), PortForwardError> {
    let addr: std::net::SocketAddr = format!("{}:{}", local_host, local_port)
        .parse()
        .map_err(|e| PortForwardError::BindFailed(format!("invalid address: {}", e)))?;

    let std_listener = std::net::TcpListener::bind(addr)
        .map_err(|e| PortForwardError::BindFailed(format!("failed to bind {}: {}", addr, e)))?;
    std_listener.set_nonblocking(true).ok();

    let listener = TcpListener::from_std(std_listener)
        .map_err(|e| PortForwardError::BindFailed(format!("failed to bind: {}", e)))?;

    tracing::info!(
        forward_type = "local",
        bind = %addr,
        remote = format!("{}:{}", remote_host, remote_port),
        "local port forward listening"
    );

    loop {
        match listener.accept().await {
            Ok((socket, peer_addr)) => {
                let h = handle.clone();
                let rh = remote_host.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_direct_forward(
                        &h,
                        &rh,
                        remote_port,
                        peer_addr.ip().to_string(),
                        peer_addr.port() as u32,
                        socket,
                    )
                    .await
                    {
                        tracing::warn!(error = %e, "local forward error");
                    }
                });
            }
            Err(e) => {
                tracing::warn!(error = %e, "accept error");
            }
        }
    }
}

// ============================================================================
// Remote port forwarding: request SSH server to bind a port, bridge to local
//
// SSH remote port forwarding (-R):
// 1. Client sends `tcpip_forward` global request → server binds a port
// 2. When a connection arrives at the server's bound port, the server sends
//    `CHANNEL_OPEN` with type `forwarded-tcpip`
// 3. Client receives it in `server_channel_open_forwarded_tcpip` callback
// 4. Client connects to local target and bridges the two sides
// ============================================================================

/// Remote port forward setup: requests tcpip_forward, registers the sender,
/// and returns the TcpForwardListener + receiver pair. The caller must:
/// 1. Store the TcpForwardListener in PortForwardTask.listener
/// 2. Spawn the forwarding task with the returned receiver
async fn setup_remote_forward(
    handle: SshHandle,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<(TcpForwardListener, mpsc::Receiver<ForwardedChannelMsg>), PortForwardError> {
    let bind_address = if remote_host.is_empty() {
        "0.0.0.0".to_string()
    } else {
        remote_host.clone()
    };

    tracing::info!(
        forward_type = "remote",
        bind_address = %bind_address,
        bind_port = %local_port,
        target = format!("127.0.0.1:{}", remote_port),
        "requesting tcpip_forward on SSH server"
    );

    let bound_port = handle
        .tcpip_forward(&bind_address, local_port as u32)
        .await
        .map_err(|e| {
            tracing::error!(
                error = %e,
                bind_address = %bind_address,
                port = %local_port,
                "tcpip_forward denied by server"
            );
            PortForwardError::BindFailed(format!(
                "server denied remote port forward ({}:{}): {}",
                bind_address, local_port, e
            ))
        })?;

    tracing::info!(
        forward_type = "remote",
        bound_port = %bound_port,
        target = format!("127.0.0.1:{}", remote_port),
        "SSH server listening on port {}, forwarding to 127.0.0.1:{}",
        bound_port, remote_port
    );

    let (tx, rx) = mpsc::channel::<ForwardedChannelMsg>(16);
    register_forward_sender(&handle, tx.clone()).await;

    let listener = TcpForwardListener {
        bound_port,
        sender: tx,
        registry_key: handle_key(&handle),
    };

    Ok((listener, rx))
}

// ----------------------------------------------------------------------------
// Global registry of TCP forward senders + handles
//
// Keyed by handle pointer address. Stores the mpsc Sender and SshHandle so the
// registry entry can be cleaned up when a remote port forward is stopped.
//
// Key invariants:
// - Registered in `setup_remote_forward` after `tcpip_forward` succeeds
// - Unregistered in `port_forward_stop` by calling `unregister_forward_sender`
// - Registry entry is removed when forward is stopped (prevents memory leaks)
type RegistryMap = std::collections::HashMap<usize, Box<(ForwardedChannelSender, SshHandle)>>;
static FORWARD_REGISTRY: std::sync::LazyLock<std::sync::RwLock<RegistryMap>> =
    std::sync::LazyLock::new(|| std::sync::RwLock::new(std::collections::HashMap::new()));

pub type ForwardedChannelSender = mpsc::Sender<ForwardedChannelMsg>;

fn handle_key(handle: &SshHandle) -> usize {
    Arc::as_ptr(handle) as usize
}

/// Register a sender + handle for remote port forwarding.
/// Called by `setup_remote_forward` after `tcpip_forward` succeeds.
async fn register_forward_sender(handle: &SshHandle, sender: ForwardedChannelSender) {
    let key = handle_key(handle);
    let cell: Box<(ForwardedChannelSender, SshHandle)> = Box::new((sender, handle.clone()));
    if let Ok(mut reg) = FORWARD_REGISTRY.write() {
        reg.insert(key, cell);
    } else {
        tracing::warn!("FORWARD_REGISTRY poisoned, registration skipped");
    }
}

/// Unregister a remote forward entry by its stored registry key (usize).
pub fn unregister_forward_sender_by_key(key: usize) {
    if let Ok(mut reg) = FORWARD_REGISTRY.write() {
        if reg.remove(&key).is_some() {
            tracing::debug!("unregistered forward sender by key {:x}", key);
        }
    }
}

/// Handle each forwarded connection arriving from the SSH server.
async fn handle_forwarded_connections(
    handle: SshHandle,
    mut rx: mpsc::Receiver<ForwardedChannelMsg>,
    local_target_port: u16,
) {
    while let Some(msg) = rx.recv().await {
        let h = handle.clone();
        let target = format!("127.0.0.1:{}", local_target_port);
        tokio::spawn(async move {
            tracing::debug!(
                origin = format!("{}:{}", msg.originator_address, msg.originator_port),
                connected = format!("{}:{}", msg.connected_address, msg.connected_port),
                "forwarded connection from server"
            );

            match tokio::time::timeout(
                std::time::Duration::from_secs(10),
                TcpStream::connect(&target),
            )
            .await
            {
                Ok(Ok(socket)) => {
                    let cid = msg.channel.id();
                    if let Err(e) = forward_socket(h, cid, msg.channel, socket).await {
                        tracing::warn!(error = %e, "remote forward bridge error");
                    }
                }
                Ok(Err(e)) => {
                    tracing::warn!(target = %target, error = %e,
                        "failed to connect to local target");
                }
                Err(_) => {
                    tracing::warn!(target = %target,
                        "connection to local target timed out");
                }
            }
        });
    }
}

// ============================================================================
// Dynamic port forwarding: SOCKS5 proxy over SSH
// ============================================================================

async fn start_dynamic_forward(
    handle: SshHandle,
    local_host: String,
    local_port: u16,
) -> Result<(), PortForwardError> {
    let addr: std::net::SocketAddr = format!("{}:{}", local_host, local_port)
        .parse()
        .map_err(|e| PortForwardError::BindFailed(format!("invalid address: {}", e)))?;

    let std_listener = std::net::TcpListener::bind(addr)
        .map_err(|e| PortForwardError::BindFailed(format!("failed to bind {}: {}", addr, e)))?;
    std_listener.set_nonblocking(true).ok();

    let listener = TcpListener::from_std(std_listener)
        .map_err(|e| PortForwardError::BindFailed(format!("failed to bind: {}", e)))?;

    tracing::info!(
        forward_type = "dynamic",
        bind = %addr,
        "SOCKS5 proxy listening"
    );

    loop {
        match listener.accept().await {
            Ok((socket, peer_addr)) => {
                let h = handle.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_socks5_client(&h, socket, peer_addr).await {
                        tracing::warn!(error = %e, "SOCKS5 client error");
                    }
                });
            }
            Err(e) => {
                tracing::warn!(error = %e, "SOCKS5 accept error");
            }
        }
    }
}

// ============================================================================
// Bidirectional forwarding between an SSH channel and a TCP socket
// ============================================================================

async fn forward_socket<S>(
    handle: SshHandle,
    channel_id: ChannelId,
    mut channel: russh::Channel<russh::client::Msg>,
    socket: S,
) -> Result<(), PortForwardError>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Send + 'static + Unpin,
{
    let socket = Arc::new(TokioMutex::new(socket));
    let s_read = socket.clone();
    let s_write = socket.clone();
    let h = handle.clone();
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(1024);

    let reader = async move {
        let mut buf = [0u8; 8192];
        loop {
            match s_read.lock().await.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        drop(tx);
    };

    let writer = async move {
        loop {
            tokio::select! {
                biased;

                data = rx.recv() => {
                    match data {
                        Some(d) => {
                            if h.data(channel_id, d).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    }
                }

                msg = channel.wait() => {
                    match msg {
                        Some(russh::ChannelMsg::Data { data }) => {
                            if s_write.lock().await.write_all(&data).await.is_err() {
                                break;
                            }
                        }
                        Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                            if s_write.lock().await.write_all(&data).await.is_err() {
                                break;
                            }
                        }
                        Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) => {
                            let _ = s_write.lock().await.shutdown().await;
                            break;
                        }
                        None => break,
                        _ => continue,
                    }
                }
            }
        }
        let _ = s_write.lock().await.shutdown().await;
    };

    tokio::join!(reader, writer);
    Ok(())
}

/// Open a direct-tcpip SSH channel to the target.
async fn handle_direct_forward(
    handle: &SshHandle,
    target_host: &str,
    target_port: u16,
    origin_host: String,
    origin_port: u32,
    socket: TcpStream,
) -> Result<(), PortForwardError> {
    let channel = handle
        .channel_open_direct_tcpip(target_host, target_port as u32, &origin_host, origin_port)
        .await
        .map_err(|e| PortForwardError::ChannelFailed(format!("SSH channel open failed: {}", e)))?;

    let cid = channel.id();
    forward_socket(handle.clone(), cid, channel, socket).await
}

// ============================================================================
// SOCKS5: handle a single client connection
// ============================================================================

/// Handle a SOCKS5 client connection.
///
/// Supported:
/// - NO_AUTH (0x00) only
/// - CONNECT (0x01) for IPv4 (0x01), domain name (0x03), IPv6 (0x04)
///
/// Not supported: GSSAPI, USERNAME/PASSWORD auth, BIND, UDP ASSOCIATE.
async fn handle_socks5_client(
    handle: &SshHandle,
    mut socket: TcpStream,
    peer_addr: std::net::SocketAddr,
) -> Result<(), PortForwardError> {
    let mut buf = [0u8; 262];

    // --- Greeting: VER + NMETHODS + METHODS ---
    let n = socket
        .read(&mut buf)
        .await
        .map_err(|e| PortForwardError::ConnectionFailed(format!("read error: {}", e)))?;

    if n < 2 {
        return Err(PortForwardError::SocksUnsupported(
            "greeting too short".to_string(),
        ));
    }
    if buf[0] != 0x05 {
        return Err(PortForwardError::SocksUnsupported(format!(
            "unsupported SOCKS version: {}",
            buf[0]
        )));
    }

    let nmethods: usize = buf[1] as usize;
    if n < 2usize.saturating_add(nmethods) {
        return Err(PortForwardError::SocksUnsupported(
            "greeting method list truncated".to_string(),
        ));
    }

    let has_no_auth = buf[2..2usize.saturating_add(nmethods)].contains(&0x00);

    // --- Method selection ---
    if has_no_auth {
        socket
            .write_all(&[0x05, 0x00])
            .await
            .map_err(|e| PortForwardError::ConnectionFailed(format!("write error: {}", e)))?;
    } else {
        socket
            .write_all(&[0x05, 0xFF])
            .await
            .map_err(|e| PortForwardError::ConnectionFailed(format!("write error: {}", e)))?;
        return Err(PortForwardError::SocksAuthFailed(
            "no supported SOCKS5 auth (only NO_AUTH is supported)".to_string(),
        ));
    }

    // --- CONNECT request: VER + CMD + RSV + ATYP + DST.ADDR + DST.PORT ---
    let n = socket
        .read(&mut buf)
        .await
        .map_err(|e| PortForwardError::ConnectionFailed(format!("read error: {}", e)))?;

    if n < 4 {
        return Err(PortForwardError::SocksUnsupported(
            "CONNECT request too short".to_string(),
        ));
    }
    if buf[0] != 0x05 {
        return Err(PortForwardError::SocksUnsupported(format!(
            "unsupported SOCKS version in request: {}",
            buf[0]
        )));
    }

    let cmd = buf[1];
    if cmd != 0x01 {
        // Only CONNECT is supported. BIND (0x02) and UDP ASSOCIATE (0x03) are not.
        let _ = socket
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
            .await;
        return Err(PortForwardError::SocksUnsupported(format!(
            "unsupported SOCKS command: {} (only CONNECT is supported)",
            cmd
        )));
    }

    let atyp = buf[3];

    // --- Parse destination address per ATYP ---
    let (target_host, target_port) = match atyp {
        0x01 => {
            // IPv4: 4 bytes + 2 bytes port
            if n < 10 {
                return Err(PortForwardError::SocksUnsupported(
                    "IPv4 CONNECT request truncated".to_string(),
                ));
            }
            let ip = format!("{}.{}.{}.{}", buf[4], buf[5], buf[6], buf[7]);
            let port = u16::from_be_bytes([buf[8], buf[9]]);
            (ip, port)
        }
        0x03 => {
            // Domain name: 1 byte length + N bytes + 2 bytes port
            let domain_len = buf[4] as usize;
            let base = 5usize;
            let end = base.saturating_add(domain_len).saturating_add(2);
            if n < end {
                return Err(PortForwardError::SocksUnsupported(
                    "domain name CONNECT request truncated".to_string(),
                ));
            }
            let domain = std::str::from_utf8(&buf[base..base.saturating_add(domain_len)])
                .map_err(|_| {
                    PortForwardError::SocksUnsupported("invalid domain name encoding".to_string())
                })?
                .to_string();
            let port_idx = base.saturating_add(domain_len);
            let port = u16::from_be_bytes([buf[port_idx], buf[port_idx.saturating_add(1)]]);
            (domain, port)
        }
        0x04 => {
            // IPv6: 16 bytes + 2 bytes port
            if n < 22 {
                return Err(PortForwardError::SocksUnsupported(
                    "IPv6 CONNECT request truncated".to_string(),
                ));
            }
            let ip = std::net::Ipv6Addr::new(
                u16::from_be_bytes([buf[4], buf[5]]),
                u16::from_be_bytes([buf[6], buf[7]]),
                u16::from_be_bytes([buf[8], buf[9]]),
                u16::from_be_bytes([buf[10], buf[11]]),
                u16::from_be_bytes([buf[12], buf[13]]),
                u16::from_be_bytes([buf[14], buf[15]]),
                u16::from_be_bytes([buf[16], buf[17]]),
                u16::from_be_bytes([buf[18], buf[19]]),
            )
            .to_string();
            let port = u16::from_be_bytes([buf[20], buf[21]]);
            (ip, port)
        }
        _ => {
            let _ = socket
                .write_all(&[0x05, 0x08, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
                .await;
            return Err(PortForwardError::SocksUnsupported(format!(
                "unsupported SOCKS address type: {}",
                atyp
            )));
        }
    };

    tracing::debug!(
        cmd = %cmd,
        atyp = %atyp,
        target = format!("{}:{}", target_host, target_port),
        peer = %peer_addr,
        "SOCKS5 CONNECT request"
    );

    // --- Open SSH channel to the target ---
    match handle
        .channel_open_direct_tcpip(
            &target_host,
            target_port as u32,
            &peer_addr.ip().to_string(),
            peer_addr.port() as u32,
        )
        .await
    {
        Ok(channel) => {
            // Send success reply. BND.ADDR/BND.PORT are 0.0.0.0:0 (we don't know server-assigned addr).
            let mut reply = [0u8; 22];
            reply[0] = 0x05; // VER
            reply[1] = 0x00; // REP = success
            reply[2] = 0x00; // RSV
            reply[3] = if atyp == 0x04 { 0x04 } else { 0x01 }; // ATYP
            let _ = socket.write_all(&reply).await;

            let cid = channel.id();
            if let Err(e) = forward_socket(handle.clone(), cid, channel, socket).await {
                tracing::warn!(error = %e, "SOCKS5 bridge error");
            }
        }
        Err(e) => {
            tracing::warn!(
                target = format!("{}:{}", target_host, target_port),
                error = %e,
                "SSH channel for SOCKS5 failed"
            );
            // REP=0x01: general SOCKS server failure
            let _ = socket
                .write_all(&[0x05, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
                .await;
            return Err(PortForwardError::ChannelFailed(format!(
                "SSH channel for {}:{} failed: {}",
                target_host, target_port, e
            )));
        }
    }

    Ok(())
}

// ============================================================================
// Command: stop port forward
// ============================================================================

/// Stop a port forward and clean up all resources.
#[tauri::command]
pub async fn port_forward_stop(
    state: tauri::State<'_, SharedStateType>,
    forward_id: String,
) -> Result<(), PortForwardError> {
    if forward_id.is_empty() {
        return Err(PortForwardError::ForwardNotFound);
    }

    let mut port_forwards = state.port_forwards.lock().await;

    if let Some(mut forward) = port_forwards.remove(&forward_id) {
        forward.info.status = "stopped".to_string();

        // For remote forwards: close the sender channel and unregister from the
        // registry so handle_forwarded_connections wakes up and exits cleanly.
        if let Some(listener) = forward.listener.take() {
            // Drop sender to close the mpsc channel and wake rx.recv()
            drop(listener.sender);
            // Remove registry entry by key so no stale entries remain
            unregister_forward_sender_by_key(listener.registry_key);
            tracing::debug!(
                forward_id = %forward_id,
                registry_key = %listener.registry_key,
                "remote forward listener dropped, registry cleaned"
            );
        }

        forward.task.abort();
        tracing::info!(forward_id = %forward_id, "port forward stopped");
    } else {
        return Err(PortForwardError::ForwardNotFound);
    }

    Ok(())
}

// ============================================================================
// Command: list active port forwards
// ============================================================================

/// List active port forwards with their current status.
#[tauri::command]
pub async fn port_forward_list(
    state: tauri::State<'_, SharedStateType>,
) -> Result<Vec<PortForwardInfo>, PortForwardError> {
    let port_forwards = state.port_forwards.lock().await;
    Ok(port_forwards.values().map(|f| f.info.clone()).collect())
}

#[cfg(test)]
mod tests {
    use super::unregister_forward_sender_by_key;

    #[test]
    fn unregister_forward_sender_by_key_is_synchronous() {
        assert_eq!(unregister_forward_sender_by_key(usize::MAX), ());
    }
}
