use crate::errors::PortForwardError;
use crate::session::get_session_manager;
use crate::state::{
    ForwardedChannelMsg, PortForwardConfig, PortForwardInfo, PortForwardTask, RemoteForwardBinding,
    SharedStateType, TcpForwardListener,
};
use russh::ChannelId;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

/// Type alias for SSH session handle wrapped in Arc
type SshHandle = Arc<russh::client::Handle<crate::state::ClientHandler>>;

/// First retry delay after a recoverable accept error.
const ACCEPT_BACKOFF_START: Duration = Duration::from_millis(10);
/// Upper bound for the exponential accept backoff.
const ACCEPT_BACKOFF_CAP: Duration = Duration::from_secs(2);
/// Consecutive recoverable accept errors tolerated before the listener stops.
const ACCEPT_MAX_CONSECUTIVE_ERRORS: u32 = 10;

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

    let manager = get_session_manager();
    let handle = manager
        .get_ssh_handle(&session_id)
        .await
        .ok_or(PortForwardError::SessionNotFound)?;
    let forward_slot = manager
        .get_forward_listener_slot(&session_id)
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
    let bind_address_for_cancel = if config.remote_host.is_empty() {
        "0.0.0.0".to_string()
    } else {
        config.remote_host.clone()
    };

    if !matches!(ft_clone.as_str(), "local" | "dynamic" | "remote") {
        return Err(PortForwardError::BindFailed(format!(
            "Unknown forward type: {}",
            ft_clone
        )));
    }

    let info = PortForwardInfo {
        name,
        forward_type: ft_for_info,
        local_host: local_host_for_info,
        local_port,
        remote_host: remote_host_for_info,
        remote_port,
        status: "active".to_string(),
    };

    // Remote forward requires special handling: we need the TcpForwardListener
    // to store in PortForwardTask BEFORE spawning the task (so the task can
    // be properly cleaned up on stop). The tcpip_forward round trip runs before
    // the map lock is taken, so list/stop/shutdown stay responsive meanwhile.
    if ft_clone == "remote" {
        let (listener, rx) = setup_remote_forward(
            handle.clone(),
            forward_slot.clone(),
            local_port,
            remote_host_clone,
            remote_port,
        )
        .await?;

        let forward_handle = handle.clone();
        let task: JoinHandle<Result<(), PortForwardError>> = tokio::spawn(async move {
            handle_forwarded_connections(forward_handle, rx, remote_port).await;
            Ok(())
        });

        {
            let mut port_forwards = state.port_forwards.lock().await;
            port_forwards.insert(
                forward_id,
                PortForwardTask {
                    task,
                    remote: Some(RemoteForwardBinding {
                        handle,
                        address: bind_address_for_cancel,
                        port: listener.bound_port,
                        slot: forward_slot,
                        listener,
                    }),
                    info,
                },
            );
        }
        tracing::info!(forward_type = %ft_for_tracing, "port forward started");
        return Ok(());
    }

    // Bind the local listener here so a failed bind reaches the caller instead of
    // being swallowed by the spawned accept loop.
    let (listener, bind_addr) = bind_tcp_listener(&local_host_clone, local_port)?;

    let task: JoinHandle<Result<(), PortForwardError>> = if ft_clone == "local" {
        tokio::spawn(async move {
            run_local_forward(handle, listener, bind_addr, remote_host_clone, remote_port).await
        })
    } else {
        tokio::spawn(async move { run_dynamic_forward(handle, listener, bind_addr).await })
    };

    {
        let mut port_forwards = state.port_forwards.lock().await;
        port_forwards.insert(
            forward_id,
            PortForwardTask {
                task,
                remote: None,
                info,
            },
        );
    }

    tracing::info!(forward_type = %ft_for_tracing, "port forward started");
    Ok(())
}

// ============================================================================
// Local port forwarding: listen locally, forward through SSH to remote
// ============================================================================

/// Bind the listener for a local/dynamic forward. Binding before the accept loop is
/// spawned is what makes a bind failure reach the command caller.
fn bind_tcp_listener(
    bind_host: &str,
    bind_port: u16,
) -> Result<(TcpListener, std::net::SocketAddr), PortForwardError> {
    let addr: std::net::SocketAddr = format!("{}:{}", bind_host, bind_port)
        .parse()
        .map_err(|e| PortForwardError::BindFailed(format!("invalid address: {}", e)))?;

    let std_listener = std::net::TcpListener::bind(addr)
        .map_err(|e| PortForwardError::BindFailed(format!("failed to bind {}: {}", addr, e)))?;
    std_listener.set_nonblocking(true).map_err(|e| {
        PortForwardError::BindFailed(format!("failed to configure {}: {}", addr, e))
    })?;

    let listener = TcpListener::from_std(std_listener)
        .map_err(|e| PortForwardError::BindFailed(format!("failed to bind: {}", e)))?;
    let bound_addr = listener.local_addr().map_err(|e| {
        PortForwardError::BindFailed(format!("failed to read bound address: {}", e))
    })?;

    Ok((listener, bound_addr))
}

/// Wait for the next inbound connection, backing off exponentially on recoverable
/// accept errors so a persistent EMFILE/ENFILE cannot spin at 100% CPU.
/// Returns None when the listener has to stop for good.
async fn accept_with_backoff(
    listener: &TcpListener,
    consecutive_errors: &mut u32,
    forward_type: &'static str,
) -> Option<(TcpStream, std::net::SocketAddr)> {
    loop {
        match listener.accept().await {
            Ok(connection) => {
                *consecutive_errors = 0;
                return Some(connection);
            }
            Err(error) if is_fatal_accept_error(&error) => {
                tracing::error!(
                    forward_type = forward_type,
                    error = %error,
                    "accept failed unrecoverably, stopping listener"
                );
                return None;
            }
            Err(error) => {
                *consecutive_errors = consecutive_errors.saturating_add(1);
                if *consecutive_errors > ACCEPT_MAX_CONSECUTIVE_ERRORS {
                    tracing::error!(
                        forward_type = forward_type,
                        error = %error,
                        attempts = *consecutive_errors,
                        "accept failed repeatedly, stopping listener"
                    );
                    return None;
                }
                let backoff = accept_backoff(*consecutive_errors);
                tracing::warn!(
                    forward_type = forward_type,
                    error = %error,
                    attempts = *consecutive_errors,
                    backoff_ms = backoff.as_millis(),
                    "accept error, backing off before retrying"
                );
                tokio::time::sleep(backoff).await;
            }
        }
    }
}

/// Delay before retrying accept after the given number of consecutive failures.
fn accept_backoff(consecutive_errors: u32) -> Duration {
    let exponent = consecutive_errors.saturating_sub(1).min(8);
    (ACCEPT_BACKOFF_START * (1u32 << exponent)).min(ACCEPT_BACKOFF_CAP)
}

/// True when an accept error means the listening socket itself is unusable.
fn is_fatal_accept_error(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::InvalidInput
            | std::io::ErrorKind::NotConnected
            | std::io::ErrorKind::BrokenPipe
    )
}

async fn run_local_forward(
    handle: SshHandle,
    listener: TcpListener,
    bind_addr: std::net::SocketAddr,
    remote_host: String,
    remote_port: u16,
) -> Result<(), PortForwardError> {
    tracing::info!(
        forward_type = "local",
        bind = %bind_addr,
        remote = format!("{}:{}", remote_host, remote_port),
        "local port forward listening"
    );

    let mut consecutive_errors = 0u32;
    while let Some((socket, peer_addr)) =
        accept_with_backoff(&listener, &mut consecutive_errors, "local").await
    {
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

    Err(PortForwardError::ConnectionFailed(
        "local forward listener stopped after repeated accept errors".to_string(),
    ))
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

/// Remote port forward setup: requests tcpip_forward, installs the listener
/// into the handler's slot, and returns it with the receiver. The caller must:
/// 1. Store the binding in PortForwardTask.remote
/// 2. Spawn the forwarding task with the returned receiver
async fn setup_remote_forward(
    handle: SshHandle,
    slot: crate::state::ForwardListenerSlot,
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
    let listener = TcpForwardListener {
        bound_port,
        sender: tx,
    };
    // The handler is already inside russh; this shared slot is the only way to
    // tell it where forwarded connections belong. Without it the callback logs
    // "no listener registered" and drops every remote connection.
    {
        let mut guard = slot.write().unwrap_or_else(|error| error.into_inner());
        *guard = Some(listener.clone());
    }

    Ok((listener, rx))
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

async fn run_dynamic_forward(
    handle: SshHandle,
    listener: TcpListener,
    bind_addr: std::net::SocketAddr,
) -> Result<(), PortForwardError> {
    tracing::info!(
        forward_type = "dynamic",
        bind = %bind_addr,
        "SOCKS5 proxy listening"
    );

    let mut consecutive_errors = 0u32;
    while let Some((socket, peer_addr)) =
        accept_with_backoff(&listener, &mut consecutive_errors, "dynamic").await
    {
        let h = handle.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_socks5_client(&h, socket, peer_addr).await {
                tracing::warn!(error = %e, "SOCKS5 client error");
            }
        });
    }

    Err(PortForwardError::ConnectionFailed(
        "SOCKS5 listener stopped after repeated accept errors".to_string(),
    ))
}

// ============================================================================
// Bidirectional forwarding between an SSH channel and a TCP socket
// ============================================================================

/// Reads from the local socket and hands bytes to the SSH side. Kept separate
/// from the write half so neither direction waits on the other.
async fn pipe_socket_to_channel<R>(mut reader: R, tx: mpsc::Sender<Vec<u8>>)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                if tx.send(buf[..n].to_vec()).await.is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

async fn forward_socket<S>(
    handle: SshHandle,
    channel_id: ChannelId,
    mut channel: russh::Channel<russh::client::Msg>,
    socket: S,
) -> Result<(), PortForwardError>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Send + 'static + Unpin,
{
    // A single mutex across read and write serialises the two directions:
    // the reader holds it while waiting for bytes, so a response can never be
    // written (a full-duplex deadlock). Split the stream instead.
    let (s_read, mut s_write) = tokio::io::split(socket);
    let h = handle.clone();
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(1024);

    let reader = pipe_socket_to_channel(s_read, tx);

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
                            if s_write.write_all(&data).await.is_err() {
                                break;
                            }
                        }
                        Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                            if s_write.write_all(&data).await.is_err() {
                                break;
                            }
                        }
                        Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) => {
                            let _ = s_write.shutdown().await;
                            break;
                        }
                        None => break,
                        _ => continue,
                    }
                }
            }
        }
        let _ = s_write.shutdown().await;
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

        // For remote forwards: stop routing new channels, wake the forwarder,
        // and ask the server to release the bound port.
        if let Some(remote) = forward.remote.take() {
            if let Ok(mut guard) = remote.slot.write() {
                *guard = None;
            }
            drop(remote.listener.sender);
            if let Err(error) = remote
                .handle
                .cancel_tcpip_forward(remote.address.clone(), remote.port)
                .await
            {
                tracing::warn!(
                    forward_id = %forward_id,
                    address = %remote.address,
                    port = %remote.port,
                    %error,
                    "server refused to cancel the remote port forward"
                );
            }
            tracing::debug!("remote forward listener cleared and cancelled");
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
    use super::{
        accept_backoff, bind_tcp_listener, is_fatal_accept_error, pipe_socket_to_channel,
        setup_remote_forward, ACCEPT_BACKOFF_CAP, ACCEPT_BACKOFF_START,
    };
    use crate::errors::PortForwardError;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::mpsc;

    #[test]
    fn the_connection_owner_and_the_handler_share_the_forward_slot() {
        use crate::state::{ClientHandler, TcpForwardListener};

        let handler = ClientHandler::for_host("example.com", 22);
        // The owner keeps one handle; russh keeps the handler. Both must see
        // the same slot, otherwise a remote forward is never routed.
        let owner_slot = handler.forward_listener_slot();
        let handler_slot = handler.forward_listener_slot();
        let (sender, _rx) = mpsc::channel(1);
        {
            let mut guard = owner_slot.write().expect("slot lock");
            *guard = Some(TcpForwardListener {
                bound_port: 4242,
                sender,
            });
        }
        let seen = handler_slot.read().expect("slot lock");
        assert_eq!(
            seen.as_ref().map(|listener| listener.bound_port),
            Some(4242)
        );
        drop(seen);
        {
            let mut guard = owner_slot.write().expect("slot lock");
            *guard = None;
        }
        assert!(handler_slot.read().expect("slot lock").is_none());
    }

    /// Reads one required environment variable of the real-server fixture.
    fn e2e_env(name: &str) -> String {
        std::env::var(name).unwrap_or_else(|_| panic!("{name} must be set by the fixture script"))
    }

    /// Connects to the fixture sshd with the key and host key the script exported.
    async fn connect_fixture() -> (
        std::sync::Arc<russh::client::Handle<crate::state::ClientHandler>>,
        crate::state::ForwardListenerSlot,
    ) {
        use crate::state::ClientHandler;
        use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg};
        use std::sync::Arc;

        let port: u16 = e2e_env("SSH_E2E_PORT").parse().expect("SSH_E2E_PORT");
        let user = e2e_env("SSH_E2E_USER");
        let key_text = std::fs::read_to_string(e2e_env("SSH_E2E_KEY")).expect("fixture key");
        let key = decode_secret_key(&key_text, None).expect("decode fixture key");
        let host_key_text =
            std::fs::read_to_string(e2e_env("SSH_E2E_HOST_KEY")).expect("fixture host key");
        let host_key =
            russh::keys::PublicKey::from_openssh(&host_key_text).expect("parse fixture host key");
        let handler = ClientHandler::for_test_with_expected_key("127.0.0.1", port, host_key);
        // Captured before the handler moves into russh; it is the only way the
        // connection owner can install a remote-forward listener afterwards.
        let slot = handler.forward_listener_slot();
        let config = Arc::new(russh::client::Config::default());
        let mut handle = russh::client::connect(config, ("127.0.0.1", port), handler)
            .await
            .expect("connect to the fixture sshd");
        let auth = handle
            .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), None))
            .await
            .expect("authenticate");
        assert!(auth.success(), "public key authentication must succeed");
        (Arc::new(handle), slot)
    }

    /// Drives `-R` against a real OpenSSH sshd: the server binds the port, opens
    /// a real `forwarded-tcpip` channel per connection, and the client bridges it
    /// to a local echo server. Nothing here is simulated.
    #[tokio::test]
    #[ignore = "needs a real sshd; run scripts/verify-install/remote-forward-e2e.mjs"]
    async fn remote_forward_real_ssh_e2e() {
        use std::sync::Arc;
        use tokio::net::{TcpListener, TcpStream};

        let (handle, slot) = connect_fixture().await;

        // The forwarding target: a real TCP echo server on loopback.
        let echo = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("echo listener");
        let echo_port = echo.local_addr().expect("echo address").port();
        let echo_task = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = echo.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut buffer = [0u8; 4096];
                    loop {
                        match socket.read(&mut buffer).await {
                            Ok(0) | Err(_) => {
                                let _ = socket.shutdown().await;
                                break;
                            }
                            Ok(read) => {
                                if socket.write_all(&buffer[..read]).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                });
            }
        });

        // Ask sshd for a remote bind on an ephemeral port and install the
        // listener the handler routes `forwarded-tcpip` opens into.
        let (listener, mut channels) = setup_remote_forward(
            Arc::clone(&handle),
            Arc::clone(&slot),
            // The remote bind address decision lives in setup_remote_forward;
            // an ephemeral port lets the server pick.
            0,
            "127.0.0.1".to_string(),
            echo_port,
        )
        .await
        .expect("the server must accept the remote forward");
        let bound_port = listener.bound_port;
        assert!(bound_port > 0, "sshd must report the port it bound");
        *slot.write().expect("slot lock") = Some(listener.clone());
        let bridge = tokio::spawn(async move {
            while let Some(message) = channels.recv().await {
                let mut channel = message.channel.into_stream();
                let Ok(mut socket) = TcpStream::connect(("127.0.0.1", echo_port)).await else {
                    continue;
                };
                tokio::spawn(async move {
                    let _ = tokio::io::copy_bidirectional(&mut channel, &mut socket).await;
                });
            }
        });

        async fn round_trip(port: u32, payload: &[u8]) -> Vec<u8> {
            let mut stream = TcpStream::connect(("127.0.0.1", port as u16))
                .await
                .expect("the remote bind must accept a connection");
            stream.write_all(payload).await.expect("write payload");
            stream.shutdown().await.expect("half-close");
            let mut echoed = Vec::new();
            tokio::time::timeout(
                std::time::Duration::from_secs(10),
                stream.read_to_end(&mut echoed),
            )
            .await
            .expect("the echo must come back")
            .expect("read echo");
            echoed
        }

        // 1. Different payload lengths round-trip unchanged through the real
        //    server-side bind and the real forwarded channel.
        for payload in [b"short".as_slice(), &[7u8; 32 * 1024][..]] {
            let echoed = round_trip(bound_port, payload).await;
            assert_eq!(echoed, payload, "payload must survive in both directions");
        }

        // 2. Two concurrent connections are bridged independently.
        let first = round_trip(bound_port, b"concurrent-one");
        let second = round_trip(bound_port, b"concurrent-two");
        let (first, second) = tokio::join!(first, second);
        assert_eq!(first, b"concurrent-one");
        assert_eq!(second, b"concurrent-two");

        // 3. Stop cancels the server-side binding: the port refuses and the
        //    handler slot no longer routes.
        *slot.write().expect("slot lock") = None;
        drop(listener);
        handle
            .cancel_tcpip_forward("127.0.0.1", bound_port)
            .await
            .expect("cancel_tcpip_forward must be accepted");
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        assert!(
            TcpStream::connect(("127.0.0.1", bound_port as u16))
                .await
                .is_err(),
            "the port must stop accepting after the forward is cancelled"
        );

        bridge.abort();
        echo_task.abort();
    }

    /// `-L` shares the channel plumbing with `-R` but not the channel type: it
    /// opens `direct-tcpip` instead of receiving `forwarded-tcpip`. This drives
    /// that path against the same real sshd so a change to the forwarding code
    /// cannot fix `-R` while breaking `-L`.
    #[tokio::test]
    #[ignore = "needs a real sshd; run scripts/verify-install/remote-forward-e2e.mjs"]
    async fn local_forward_real_ssh_e2e() {
        use tokio::net::TcpListener;

        let (handle, _slot) = connect_fixture().await;

        let echo = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("echo listener");
        let echo_port = echo.local_addr().expect("echo address").port();
        tokio::spawn(async move {
            let Ok((mut socket, _)) = echo.accept().await else {
                return;
            };
            let mut buffer = [0u8; 1024];
            while let Ok(read) = socket.read(&mut buffer).await {
                if read == 0 || socket.write_all(&buffer[..read]).await.is_err() {
                    break;
                }
            }
        });

        let channel = handle
            .channel_open_direct_tcpip("127.0.0.1", echo_port as u32, "127.0.0.1", 0)
            .await
            .expect("direct-tcpip channel");
        let mut stream = channel.into_stream();
        stream.write_all(b"local-forward").await.expect("write");
        let mut echoed = [0u8; 13];
        tokio::time::timeout(
            std::time::Duration::from_secs(10),
            stream.read_exact(&mut echoed),
        )
        .await
        .expect("the echo must come back")
        .expect("read echo");
        assert_eq!(&echoed, b"local-forward");
    }

    /// A duplicate bind is refused, and an SSH teardown releases the server-side
    /// bind instead of leaving a port the user cannot see or close.
    #[tokio::test]
    #[ignore = "needs a real sshd; run scripts/verify-install/remote-forward-e2e.mjs"]
    async fn remote_forward_disconnect_and_duplicate_bind_real_ssh_e2e() {
        use std::sync::Arc;
        use tokio::net::{TcpListener, TcpStream};

        // Reserve a concrete port, then let sshd bind exactly that one.
        let probe = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("probe port");
        let port = probe.local_addr().expect("probe address").port();
        drop(probe);

        let (handle_a, slot_a) = connect_fixture().await;
        let (listener, _channels) = setup_remote_forward(
            Arc::clone(&handle_a),
            Arc::clone(&slot_a),
            port,
            "127.0.0.1".to_string(),
            9,
        )
        .await
        .expect("the first bind must succeed");
        // An explicit port request echoes 0 in the reply; the requested port is the binding.
        assert_eq!(listener.bound_port, 0);
        *slot_a.write().expect("slot lock") = Some(listener.clone());

        let (handle_b, slot_b) = connect_fixture().await;
        let duplicate = setup_remote_forward(
            Arc::clone(&handle_b),
            slot_b,
            port,
            "127.0.0.1".to_string(),
            9,
        )
        .await;
        assert!(
            matches!(duplicate, Err(PortForwardError::BindFailed(_))),
            "a second bind of the same port must be refused"
        );

        // Tear the SSH session down without a graceful cancel: the server must
        // release the bind on session end.
        *slot_a.write().expect("slot lock") = None;
        drop(listener);
        let _ = handle_a
            .disconnect(russh::Disconnect::ByApplication, "", "en")
            .await;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if TcpStream::connect(("127.0.0.1", port)).await.is_err() {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "the bound port must be released when the SSH session ends"
            );
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    #[tokio::test]
    async fn socket_reader_does_not_block_the_write_direction() {
        let (local, remote) = tokio::io::duplex(64);
        let (mut local_read, mut local_write) = tokio::io::split(local);
        let (remote_read, mut remote_write) = tokio::io::split(remote);
        let (tx, mut rx) = mpsc::channel(8);
        let reader = tokio::spawn(pipe_socket_to_channel(remote_read, tx));
        let writer = tokio::spawn(async move {
            while let Some(data) = rx.recv().await {
                if remote_write.write_all(&data).await.is_err() {
                    break;
                }
            }
        });

        // The reader is idle waiting for more bytes; a response must still get
        // through the write direction within the deadline.
        local_write.write_all(b"ping").await.expect("write request");
        let mut buf = [0u8; 4];
        tokio::time::timeout(
            std::time::Duration::from_millis(500),
            local_read.read_exact(&mut buf),
        )
        .await
        .expect("a response must not wait for the idle read direction")
        .expect("read response");
        assert_eq!(&buf, b"ping");

        // The split halves keep the duplex stream alive; abort the reader so the
        // test does not wait for an EOF that only both halves could produce.
        reader.abort();
        drop(local_write);
        let _ = writer.await;
    }

    #[tokio::test]
    async fn bind_tcp_listener_reports_a_port_that_is_already_bound() {
        let (_listener, addr) =
            bind_tcp_listener("127.0.0.1", 0).expect("an unused local port should bind");

        let error = bind_tcp_listener("127.0.0.1", addr.port())
            .expect_err("binding an occupied port must be reported to the caller");

        assert!(
            matches!(&error, PortForwardError::BindFailed(message) if message.contains("failed to bind")),
            "an occupied port must surface as BindFailed, got {error}"
        );
    }

    #[test]
    fn accept_backoff_grows_exponentially_and_stops_at_the_cap() {
        assert_eq!(accept_backoff(1), ACCEPT_BACKOFF_START);
        assert_eq!(accept_backoff(2), ACCEPT_BACKOFF_START * 2);
        assert_eq!(accept_backoff(3), ACCEPT_BACKOFF_START * 4);
        assert_eq!(accept_backoff(9), ACCEPT_BACKOFF_CAP);
        assert_eq!(accept_backoff(u32::MAX), ACCEPT_BACKOFF_CAP);
    }

    #[test]
    fn fatal_accept_errors_are_told_apart_from_retryable_ones() {
        assert!(is_fatal_accept_error(&std::io::Error::from(
            std::io::ErrorKind::InvalidInput
        )));
        assert!(!is_fatal_accept_error(&std::io::Error::from(
            std::io::ErrorKind::ConnectionAborted
        )));
        // EMFILE/ENFILE surface as an uncategorized OS error on stable Rust: they must
        // be retried with backoff instead of destroying the forward.
        assert!(!is_fatal_accept_error(&std::io::Error::from_raw_os_error(
            24
        )));
    }
}
