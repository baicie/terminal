use crate::errors::SerialError;
use crate::state::{SerialSession, SerialPortInfo, ShellOutput, SharedStateType};
use serialport::{DataBits, FlowControl, Parity, StopBits};
use std::io::Read;
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub async fn serial_list() -> Result<Vec<SerialPortInfo>, SerialError> {
    serialport::available_ports()
        .map(|ports| {
            ports
                .into_iter()
                .map(|port| SerialPortInfo {
                    name: port.port_name,
                    port_type: format!("{:?}", port.port_type),
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
        return Err(SerialError::ConnectFailed(String::from("Port name cannot be empty")));
    }
    if baud_rate == 0 {
        return Err(SerialError::ConnectFailed(String::from("Invalid baud rate")));
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

    // Open the serial port
    let port = serialport::new(&name, baud_rate)
        .data_bits(data_bits)
        .stop_bits(stop_bits)
        .parity(parity)
        .flow_control(flow_control)
        .timeout(std::time::Duration::from_millis(100))
        .open()
        .map_err(|e| SerialError::ConnectFailed(format!("Failed to open serial port {}: {}", name, e)))?;

    // Clone port for reader before storing in state
    let port_reader: Box<dyn serialport::SerialPort> = port
        .try_clone()
        .map_err(|e| SerialError::CloneFailed(format!("Failed to clone port: {}", e)))?;

    // Store the session
    let session = SerialSession { port };
    {
        let mut serial_sessions = state.serial_sessions.lock().await;
        serial_sessions.insert(session_id.clone(), session);
    }

    // Spawn a task to read from serial port and emit events
    let session_id_clone = session_id.clone();

    let mut port_reader = port_reader;
    tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match port_reader.read(&mut buf) {
                Ok(0) => {
                    let _ = app.emit("serial-close", &session_id_clone);
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let output = ShellOutput {
                        session_id: session_id_clone.clone(),
                        data,
                        is_stderr: false,
                    };
                    let _ = app.emit("serial-data", output);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    continue;
                }
                Err(_) => {
                    let _ = app.emit("serial-close", &session_id_clone);
                    break;
                }
            }
        }
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

    let mut serial_sessions = state.serial_sessions.lock().await;
    let session = serial_sessions
        .get_mut(&session_id)
        .ok_or(SerialError::SessionNotFound)?;

    session
        .port
        .write(data.as_bytes())
        .map_err(|e| SerialError::WriteFailed(format!("Failed to write to serial port: {}", e)))?;

    session
        .port
        .write(b"\r")
        .map_err(|e| SerialError::WriteFailed(format!("Failed to write CR: {}", e)))?;

    Ok(())
}

/// Write raw data to serial port (without adding CR)
#[tauri::command]
pub async fn serial_write_raw(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    data: String,
) -> Result<(), SerialError> {
    if session_id.is_empty() {
        return Err(SerialError::SessionNotFound);
    }

    let mut serial_sessions = state.serial_sessions.lock().await;
    let session = serial_sessions
        .get_mut(&session_id)
        .ok_or(SerialError::SessionNotFound)?;

    session
        .port
        .write(data.as_bytes())
        .map_err(|e| SerialError::WriteFailed(format!("Failed to write to serial port: {}", e)))?;

    Ok(())
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

    let mut serial_sessions = state.serial_sessions.lock().await;
    serial_sessions
        .remove(&session_id)
        .ok_or(SerialError::SessionNotFound)?;
    Ok(())
}
