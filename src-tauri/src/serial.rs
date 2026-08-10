use crate::errors::SerialError;
use crate::state::{SerialPortInfo, SerialSession, SharedStateType, ShellOutput};
use serialport::{DataBits, FlowControl, Parity, StopBits};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter};

fn write_serial_data(writer: &mut dyn Write, data: &[u8]) -> std::io::Result<()> {
    writer.write_all(data)
}

async fn write_serial_session(
    state: &SharedStateType,
    session_id: &str,
    data: Vec<u8>,
) -> Result<(), SerialError> {
    let port = {
        let sessions = state.serial_sessions.lock().await;
        Arc::clone(
            &sessions
                .get(session_id)
                .ok_or(SerialError::SessionNotFound)?
                .port,
        )
    };

    tokio::task::spawn_blocking(move || {
        let mut port = port.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        write_serial_data(port.as_mut(), &data)
            .map_err(|error| SerialError::WriteFailed(format!("Failed to write: {error}")))
    })
    .await
    .map_err(|error| SerialError::WriteFailed(format!("Serial write task failed: {error}")))?
}

#[tauri::command]
pub async fn serial_list() -> Result<Vec<SerialPortInfo>, SerialError> {
    tokio::task::spawn_blocking(serialport::available_ports)
        .await
        .map_err(|error| {
            SerialError::ListFailed(format!("Failed to join serial enumeration task: {error}"))
        })?
        .map(|ports| {
            ports
                .into_iter()
                .map(|port| {
                    let name = port.port_name.clone();
                    let port_type = match port.port_type {
                        serialport::SerialPortType::UsbPort(usb_info) => {
                            let vid = usb_info.vid;
                            let pid = usb_info.pid;
                            let vid_pid = if vid != 0 || pid != 0 {
                                format!("{:04X}:{:04X}", vid, pid)
                            } else {
                                String::new()
                            };
                            let desc = if let (Some(mfg), Some(prod)) = (
                                usb_info.manufacturer.as_deref(),
                                usb_info.product.as_deref(),
                            ) {
                                format!("USB ({mfg} {prod}, {vid_pid})")
                            } else if !vid_pid.is_empty() {
                                format!("USB ({vid_pid})")
                            } else {
                                "USB".to_string()
                            };
                            desc
                        }
                        serialport::SerialPortType::PciPort => "PCI".to_string(),
                        serialport::SerialPortType::BluetoothPort => "Bluetooth".to_string(),
                        serialport::SerialPortType::Unknown => {
                            // On Windows, unknown ports are usually COM ports
                            if name.starts_with("COM") || name.starts_with("\\\\.\\COM") {
                                "Serial Port".to_string()
                            } else {
                                "Unknown".to_string()
                            }
                        }
                    };
                    SerialPortInfo { name, port_type }
                })
                .collect()
        })
        .map_err(|e| SerialError::ListFailed(format!("Failed to list serial ports: {}", e)))
}

/// Common baud rates for UI dropdown
#[tauri::command]
pub fn serial_baud_rates() -> Vec<u32> {
    vec![
        300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600,
    ]
}

/// Connect to a serial port
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn serial_connect(
    app: AppHandle,
    state: tauri::State<'_, SharedStateType>,
    name: String,
    baud_rate: u32,
    data_bits: u8,
    stop_bits: u8,
    parity: String,
    flow_control: String,
) -> Result<String, SerialError> {
    if name.is_empty() {
        return Err(SerialError::ConnectFailed(String::from(
            "Port name cannot be empty",
        )));
    }
    if baud_rate == 0 {
        return Err(SerialError::ConnectFailed(String::from(
            "Invalid baud rate",
        )));
    }

    let session_id = format!("serial-{}", uuid::Uuid::new_v4());

    // Convert config to serialport types
    let data_bits = match data_bits {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        8 => DataBits::Eight,
        _ => DataBits::Eight,
    };

    let stop_bits = match stop_bits {
        1 => StopBits::One,
        2 => StopBits::Two,
        _ => StopBits::One,
    };

    let parity = match parity.to_lowercase().as_str() {
        "none" | "" => Parity::None,
        "odd" => Parity::Odd,
        "even" => Parity::Even,
        _ => Parity::None,
    };

    let flow_control = match flow_control.to_lowercase().as_str() {
        "hardware" | "rts/cts" => FlowControl::Hardware,
        "software" | "xon/xoff" => FlowControl::Software,
        _ => FlowControl::None,
    };

    let port_name = name.clone();
    let (port, mut port_reader) = tokio::task::spawn_blocking(move || {
        let port = serialport::new(&port_name, baud_rate)
            .data_bits(data_bits)
            .stop_bits(stop_bits)
            .parity(parity)
            .flow_control(flow_control)
            .timeout(std::time::Duration::from_millis(100))
            .open()
            .map_err(|error| {
                SerialError::ConnectFailed(format!(
                    "Failed to open serial port {}: {}",
                    port_name, error
                ))
            })?;
        let reader = port
            .try_clone()
            .map_err(|error| SerialError::CloneFailed(format!("Failed to clone port: {error}")))?;
        Ok::<_, SerialError>((port, reader))
    })
    .await
    .map_err(|error| {
        SerialError::ConnectFailed(format!("Failed to join serial open task: {error}"))
    })??;

    // Store the session
    let stop = Arc::new(AtomicBool::new(false));
    let session = SerialSession {
        port: Arc::new(StdMutex::new(port)),
        stop: Arc::clone(&stop),
    };
    {
        let mut serial_sessions = state.serial_sessions.lock().await;
        serial_sessions.insert(session_id.clone(), session);
    }

    // A serial port is blocking on every supported platform. Keep the complete
    // read loop on the blocking pool and only use the async task for cleanup.
    let session_id_clone = session_id.clone();
    let shared_state = Arc::clone(state.inner());
    tokio::spawn(async move {
        let read_session_id = session_id_clone.clone();
        let app_for_reader = app.clone();
        let stop_for_reader = Arc::clone(&stop);
        let read_result = tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 4096];
            while !stop_for_reader.load(Ordering::Acquire) {
                match port_reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let output = ShellOutput {
                            session_id: read_session_id.clone(),
                            data: String::from_utf8_lossy(&buf[..n]).to_string(),
                            is_stderr: false,
                        };
                        let _ = app_for_reader.emit("serial-data", output);
                    }
                    Err(ref error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::TimedOut | std::io::ErrorKind::Interrupted
                        ) => {}
                    Err(error) => {
                        tracing::warn!(
                            session_id = %read_session_id,
                            %error,
                            "serial read loop stopped"
                        );
                        break;
                    }
                }
            }
        })
        .await;

        if let Err(error) = read_result {
            tracing::warn!(
                session_id = %session_id_clone,
                %error,
                "serial reader task failed"
            );
        }

        shared_state
            .serial_sessions
            .lock()
            .await
            .remove(&session_id_clone);
        let _ = app.emit("serial-close", &session_id_clone);
    });

    Ok(session_id)
}

/// Write data to serial port
#[tauri::command]
pub async fn serial_write(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    data: String,
) -> Result<(), SerialError> {
    if session_id.is_empty() {
        return Err(SerialError::SessionNotFound);
    }

    write_serial_session(state.inner(), &session_id, data.into_bytes()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct OneByteWriter {
        bytes: Vec<u8>,
    }

    impl Write for OneByteWriter {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            if let Some(byte) = data.first() {
                self.bytes.push(*byte);
                Ok(1)
            } else {
                Ok(0)
            }
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn serial_write_preserves_exact_input_even_when_writer_short_writes() {
        let mut writer = OneByteWriter::default();

        write_serial_data(&mut writer, b"hello").unwrap();

        assert_eq!(writer.bytes, b"hello");
    }
}

/// Write raw data to serial port. Kept for IPC compatibility; both write
/// commands preserve the exact byte sequence supplied by the terminal.
#[tauri::command]
pub async fn serial_write_raw(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    data: String,
) -> Result<(), SerialError> {
    if session_id.is_empty() {
        return Err(SerialError::SessionNotFound);
    }

    write_serial_session(state.inner(), &session_id, data.into_bytes()).await
}

/// Check if serial port is still connected
#[tauri::command]
pub async fn serial_is_connected(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
) -> Result<bool, SerialError> {
    if session_id.is_empty() {
        return Err(SerialError::SessionNotFound);
    }

    let serial_sessions = state.serial_sessions.lock().await;
    Ok(serial_sessions.contains_key(&session_id))
}

/// Disconnect from serial port
#[tauri::command]
pub async fn serial_disconnect(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
) -> Result<(), SerialError> {
    if session_id.is_empty() {
        return Err(SerialError::SessionNotFound);
    }

    let session = state
        .serial_sessions
        .lock()
        .await
        .remove(&session_id)
        .ok_or(SerialError::SessionNotFound)?;
    session.stop.store(true, Ordering::Release);
    Ok(())
}
