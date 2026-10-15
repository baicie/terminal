use crate::errors::SerialError;
use crate::session::terminal_output::Utf8StreamDecoder;
use crate::state::{SerialPortInfo, SerialSession, SharedStateType, ShellOutput};
use serialport::{DataBits, FlowControl, Parity, StopBits};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

const SERIAL_READER_CLOSE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

fn write_serial_data(writer: &mut dyn Write, data: &[u8]) -> std::io::Result<()> {
    writer.write_all(data)
}

fn unknown_serial_port_type(name: &str, is_windows: bool) -> &'static str {
    if is_windows && (name.starts_with("COM") || name.starts_with(r"\\.\COM")) {
        "Serial Port"
    } else {
        "Unknown"
    }
}

/// Runs the serial read loop until the port reports EOF, the reader fails, or
/// `stop` is set, returning whatever incomplete UTF-8 tail was still pending.
///
/// Extracted so tests can drive the loop's real conversion and termination
/// behaviour with a scripted reader instead of a real device.
fn run_serial_read_loop(
    port_reader: &mut dyn Read,
    stop: &AtomicBool,
    mut emit: impl FnMut(&str),
) -> String {
    let mut buf = [0u8; 4096];
    // A serial read returns whatever the OS buffer happens to hold, so a
    // multi-byte UTF-8 character can straddle two reads. Decoding each chunk on
    // its own would turn the halves into replacement characters and corrupt
    // the text; the decoder keeps the incomplete tail until the remaining
    // bytes arrive.
    let mut decoder = Utf8StreamDecoder::default();
    loop {
        if stop.load(Ordering::Acquire) {
            break;
        }
        match port_reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let data = decoder.push(&buf[..n]);
                if !data.is_empty() {
                    emit(&data);
                }
            }
            Err(ref error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::Interrupted
                ) => {}
            Err(error) => {
                tracing::warn!(%error, "serial read loop stopped");
                break;
            }
        }
    }
    decoder.finish()
}

async fn write_serial_session(
    state: &SharedStateType,
    session_id: &str,
    data: Vec<u8>,
) -> Result<(), SerialError> {
    let (port, write_gate) = {
        let sessions = state.serial_sessions.lock().await;
        let session = sessions
            .get(session_id)
            .ok_or(SerialError::SessionNotFound)?;
        // Clone the handles while the map is protected, then release the map
        // lock before waiting for the per-device gate. A blocked write must
        // never prevent disconnect or the reader cleanup from removing this
        // session from the map.
        (Arc::clone(&session.port), Arc::clone(&session.write_gate))
    };

    let write_guard = write_gate.read_owned().await;
    tokio::task::spawn_blocking(move || {
        // Keep the gate in the blocking task. Tokio cannot abort a blocking
        // operation after it has started, so an async caller being cancelled
        // must not release the gate while the device write is still running.
        let _write_guard = write_guard;
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
                            unknown_serial_port_type(&name, cfg!(windows)).to_string()
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
    // Starts with zero permits: the read loop adds one when it has returned
    // and dropped its clone of the port, which is the moment the OS releases
    // the device. `serial_disconnect` waits for that permit so an immediate
    // reconnect of the same port cannot race the reader's exit and lose the
    // open with "device busy".
    let closed = Arc::new(tokio::sync::Semaphore::new(0));
    let session = SerialSession {
        port: Arc::new(StdMutex::new(port)),
        stop: Arc::clone(&stop),
        closed: Arc::clone(&closed),
        write_gate: Arc::new(tokio::sync::RwLock::new(())),
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
        // Hold a handle so the release below still runs if the join future is
        // dropped early; a disconnect waiting on the permit must never be
        // left waiting for a signal that can no longer be sent.
        let closed_on_exit = Arc::clone(&closed);
        let read_session_id = session_id_clone.clone();
        let app_for_reader = app.clone();
        let stop_for_reader = Arc::clone(&stop);
        let read_result = tokio::task::spawn_blocking(move || {
            let tail = run_serial_read_loop(port_reader.as_mut(), &stop_for_reader, |data| {
                let _ = app_for_reader.emit(
                    "serial-data",
                    ShellOutput {
                        session_id: read_session_id.clone(),
                        data: data.to_string(),
                        is_stderr: false,
                    },
                );
            });
            // A device yanked mid-character leaves an incomplete tail that
            // never completes. Flushing it keeps the terminal from silently
            // swallowing the last bytes it did receive, matching what the SSH
            // path does at EOF.
            if !tail.is_empty() {
                let _ = app_for_reader.emit(
                    "serial-data",
                    ShellOutput {
                        session_id: read_session_id.clone(),
                        data: tail,
                        is_stderr: false,
                    },
                );
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

        // Remove the session before waiting on the write gate so no new writes
        // can join the drain. Existing writes keep their cloned gate and are
        // allowed to finish before the close event makes reconnect possible.
        let removed_session = shared_state
            .serial_sessions
            .lock()
            .await
            .remove(&session_id_clone);
        if let Some(session) = removed_session {
            finish_serial_session(&session.write_gate).await;
        }
        closed_on_exit.add_permits(1);
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

    /// A reader that hands back one scripted chunk per call, then EOF.
    struct ScriptedReader {
        chunks: Vec<Vec<u8>>,
    }

    impl Read for ScriptedReader {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            match self.chunks.first() {
                Some(chunk) => {
                    let len = chunk.len().min(buf.len());
                    buf[..len].copy_from_slice(&chunk[..len]);
                    self.chunks[0].drain(..len);
                    if self.chunks[0].is_empty() {
                        self.chunks.remove(0);
                    }
                    Ok(len)
                }
                None => Ok(0),
            }
        }
    }

    fn drive(chunks: &[&[u8]]) -> String {
        let mut reader = ScriptedReader {
            chunks: chunks.iter().map(|chunk| chunk.to_vec()).collect(),
        };
        let mut emitted = String::new();
        let tail = run_serial_read_loop(&mut reader, &AtomicBool::new(false), |data| {
            emitted.push_str(data);
        });
        emitted.push_str(&tail);
        emitted
    }

    #[test]
    fn serial_read_loop_reassembles_a_character_split_across_reads() {
        // U+4E2D is three bytes; the read boundary lands after two of them.
        assert_eq!(drive(&[&[0xE4, 0xB8], &[0xAD]]), "中");
    }

    #[test]
    fn serial_read_loop_flushes_an_incomplete_tail_at_eof() {
        // A device yanked mid-character leaves bytes that can never complete.
        // Dropping them silently loses output the terminal already received;
        // the SSH path surfaces them as U+FFFD at EOF and this must match.
        assert_eq!(drive(&[b"ok\xe4", b"\xb8"]), "ok\u{fffd}");
    }

    #[test]
    fn serial_read_loop_stops_without_reading_once_the_stop_flag_is_set() {
        // `serial_disconnect` flips this flag; the loop must observe it rather
        // than keep pulling bytes from a device the user just closed.
        let stop = AtomicBool::new(true);
        let mut reader = ScriptedReader {
            chunks: vec![b"late".to_vec()],
        };
        let mut emitted = String::new();
        let tail = run_serial_read_loop(&mut reader, &stop, |data| emitted.push_str(data));
        assert_eq!(emitted, "");
        assert_eq!(tail, "");
    }

    /// Runs the same conversion the read loop performs on each `read()` result.
    ///
    /// The tests drive this rather than the decoder directly so that a change
    /// back to per-chunk `from_utf8_lossy` in the loop actually fails them.
    fn decode_serial_reads(chunks: &[&[u8]]) -> String {
        let mut decoder = Utf8StreamDecoder::default();
        let mut data = String::new();
        for chunk in chunks {
            data.push_str(&decoder.push(chunk));
        }
        data.push_str(&decoder.finish());
        data
    }

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

    #[test]
    fn unknown_com_names_are_only_windows_serial_ports() {
        assert_eq!(unknown_serial_port_type("COM3", true), "Serial Port");
        assert_eq!(unknown_serial_port_type(r"\\.\COM10", true), "Serial Port");
        assert_eq!(unknown_serial_port_type("COM3", false), "Unknown");
        assert_eq!(unknown_serial_port_type("/dev/ttyUSB0", false), "Unknown");
    }

    #[tokio::test]
    async fn disconnect_returns_only_after_the_read_loop_released_the_port() {
        // The disconnect used to flip the stop flag and return immediately,
        // while the blocking reader still held its clone of the port. A user
        // closing and reopening the same device in quick succession then had
        // the reopen race the reader's exit and fail to claim the port.
        let stop = Arc::new(AtomicBool::new(false));
        let closed = Arc::new(Semaphore::new(0));
        let reader_closed = Arc::clone(&closed);
        let reader_stop = Arc::clone(&stop);
        let released = Arc::new(AtomicBool::new(false));
        let reader_released = Arc::clone(&released);

        let reader = tokio::spawn(async move {
            tokio::task::spawn_blocking({
                let stop = reader_stop;
                move || {
                    // Stands in for a blocking read that only returns once
                    // the stop flag is observed.
                    while !stop.load(Ordering::Acquire) {
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                    // The device is only actually free once the reader has
                    // returned and dropped its clone of the port.
                    reader_released.store(true, Ordering::Release);
                }
            })
            .await
            .expect("reader task should not panic");
            reader_closed.add_permits(1);
        });

        stop.store(true, Ordering::Release);
        await_serial_reader_closed(&closed).await;
        assert!(
            released.load(Ordering::Acquire),
            "disconnect must not return before the read loop released the port"
        );
        reader.await.expect("reader task should not panic");
    }

    #[tokio::test]
    async fn disconnect_waits_for_an_in_flight_write_to_finish() {
        // `serial_write` clones the port out of the session map and writes
        // without holding that map, so before the write gate a disconnect
        // could return "success" while a write still had the device open --
        // and the reconnect that followed would race that write just as it
        // used to race the read loop.
        let gate = Arc::new(tokio::sync::RwLock::new(()));
        let write_finished = Arc::new(AtomicBool::new(false));

        // Hold the read side on this task, so it is provably already acquired
        // when the drain runs below.
        let write_guard = Arc::clone(&gate).read_owned().await;
        let state = Arc::clone(&write_finished);
        let writer = tokio::spawn(async move {
            let _write_guard = write_guard;
            tokio::time::sleep(std::time::Duration::from_millis(40)).await;
            state.store(true, Ordering::Release);
        });

        finish_serial_session(&gate).await;
        assert!(
            write_finished.load(Ordering::Acquire),
            "disconnect must not return while a write still holds the device"
        );
        writer.await.expect("writer task should not panic");
    }

    #[test]
    fn serial_reads_reassemble_utf8_characters_split_across_reads() {
        // A serial read returns whatever the OS buffer holds, so a multi-byte
        // character can straddle two reads. Decoding each chunk separately
        // turned the halves into replacement characters, so a device printing
        // Chinese text produced mojibake at whatever boundary the reads landed
        // on -- intermittently, and only for non-ASCII output.
        // U+4E2D is three bytes; the read boundary lands after two of them.
        let split = [0xE4u8, 0xB8, 0xAD];
        assert_eq!(decode_serial_reads(&[&split[..2], &split[2..]]), "中");
    }

    #[test]
    fn serial_reads_keep_text_that_surrounds_a_split_character_intact() {
        assert_eq!(
            decode_serial_reads(&["你".as_bytes(), "好".as_bytes()]),
            "你好"
        );
    }

    #[test]
    fn serial_reads_still_replace_genuinely_invalid_bytes() {
        // Reassembly must not swallow real garbage: bytes that can never begin
        // a valid sequence still have to surface as U+FFFD.
        assert_eq!(decode_serial_reads(&[&[0xFFu8, 0xFE]]), "��");
    }
}

/// Write raw data to serial port without converting it through UTF-8.
#[tauri::command]
pub async fn serial_write_raw(
    state: tauri::State<'_, SharedStateType>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), SerialError> {
    if session_id.is_empty() {
        return Err(SerialError::SessionNotFound);
    }

    write_serial_session(state.inner(), &session_id, data).await
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
    close_serial_session(&session).await;
    Ok(())
}

/// Finishes a reader-owned session after it has been removed from the map.
///
/// Removing first prevents new writers from acquiring the cloned gate. Taking
/// the write side then waits for every in-flight blocking write to release its
/// read permit before the caller announces that the device is available again.
async fn finish_serial_session(gate: &Arc<tokio::sync::RwLock<()>>) {
    let _guard = gate.write().await;
}

async fn await_serial_reader_closed(closed: &Arc<Semaphore>) {
    match tokio::time::timeout(SERIAL_READER_CLOSE_TIMEOUT, closed.acquire()).await {
        Ok(Ok(permit)) => permit.forget(),
        Ok(Err(error)) => tracing::warn!(%error, "serial reader close signal was closed"),
        Err(_) => tracing::warn!(
            timeout_ms = SERIAL_READER_CLOSE_TIMEOUT.as_millis(),
            "serial reader did not release the port before the cleanup deadline"
        ),
    }
}

/// Stops a session and waits for both its reader and any in-flight writes.
pub(crate) async fn close_serial_session(session: &SerialSession) {
    // Setting the flag alone is not a disconnect: the blocking reader holds its
    // own clone of the port handle, so the device stays open until that read
    // returns. The read loop uses a 100ms serial timeout, but the outer bound
    // keeps shutdown and explicit disconnect from hanging forever on a driver
    // that ignores it.
    let stop = &session.stop;
    let closed = &session.closed;
    stop.store(true, Ordering::Release);
    await_serial_reader_closed(closed).await;
    finish_serial_session(&session.write_gate).await;
}
