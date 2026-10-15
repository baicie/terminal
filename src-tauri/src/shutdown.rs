use crate::port_forward::unregister_forward_sender_by_key;
use crate::serial::close_serial_session;
use crate::state::SharedStateType;

pub(crate) async fn close_shared_resources(state: &SharedStateType) {
    let forwards = {
        let mut forwards = state.port_forwards.lock().await;
        forwards
            .drain()
            .map(|(_, forward)| forward)
            .collect::<Vec<_>>()
    };
    for mut forward in forwards {
        if let Some(listener) = forward.listener.take() {
            unregister_forward_sender_by_key(listener.registry_key);
            drop(listener.sender);
        }
        forward.task.abort();
        if let Err(error) = forward.task.await {
            if !error.is_cancelled() {
                tracing::warn!(%error, "port forward task failed during application exit");
            }
        }
    }

    let serial_sessions = {
        let mut serial_sessions = state.serial_sessions.lock().await;
        serial_sessions
            .drain()
            .map(|(_, session)| session)
            .collect::<Vec<_>>()
    };
    for session in serial_sessions {
        close_serial_session(&session).await;
    }

    state.sftp_sessions.lock().await.clear();
}

#[cfg(test)]
mod tests {
    use super::close_shared_resources;
    use crate::state::{create_shared_state, PortForwardInfo, PortForwardTask, SerialSession};
    use std::io::{Read, Write};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex as StdMutex};
    use tokio::sync::Semaphore;

    /// A serial port handle that records whether it was ever opened, so a test
    /// can hold a real `SerialSession` without needing hardware.
    struct FakeSerialPort {
        open: Arc<AtomicBool>,
    }

    impl serialport::SerialPort for FakeSerialPort {
        fn name(&self) -> Option<String> {
            Some("fake".to_string())
        }
        fn baud_rate(&self) -> serialport::Result<u32> {
            Ok(9600)
        }
        fn try_clone(&self) -> serialport::Result<Box<dyn serialport::SerialPort>> {
            Ok(Box::new(FakeSerialPort {
                open: Arc::clone(&self.open),
            }))
        }
        fn data_bits(&self) -> serialport::Result<serialport::DataBits> {
            Ok(serialport::DataBits::Eight)
        }
        fn flow_control(&self) -> serialport::Result<serialport::FlowControl> {
            Ok(serialport::FlowControl::None)
        }
        fn parity(&self) -> serialport::Result<serialport::Parity> {
            Ok(serialport::Parity::None)
        }
        fn stop_bits(&self) -> serialport::Result<serialport::StopBits> {
            Ok(serialport::StopBits::One)
        }
        fn timeout(&self) -> std::time::Duration {
            std::time::Duration::from_millis(100)
        }
        fn set_baud_rate(&mut self, _baud_rate: u32) -> serialport::Result<()> {
            Ok(())
        }
        fn set_data_bits(&mut self, _data_bits: serialport::DataBits) -> serialport::Result<()> {
            Ok(())
        }
        fn set_flow_control(
            &mut self,
            _flow_control: serialport::FlowControl,
        ) -> serialport::Result<()> {
            Ok(())
        }
        fn set_parity(&mut self, _parity: serialport::Parity) -> serialport::Result<()> {
            Ok(())
        }
        fn set_stop_bits(&mut self, _stop_bits: serialport::StopBits) -> serialport::Result<()> {
            Ok(())
        }
        fn set_timeout(&mut self, _timeout: std::time::Duration) -> serialport::Result<()> {
            Ok(())
        }
        fn write_request_to_send(&mut self, _level: bool) -> serialport::Result<()> {
            Ok(())
        }
        fn write_data_terminal_ready(&mut self, _level: bool) -> serialport::Result<()> {
            Ok(())
        }
        fn read_clear_to_send(&mut self) -> serialport::Result<bool> {
            Ok(false)
        }
        fn read_data_set_ready(&mut self) -> serialport::Result<bool> {
            Ok(false)
        }
        fn read_ring_indicator(&mut self) -> serialport::Result<bool> {
            Ok(false)
        }
        fn read_carrier_detect(&mut self) -> serialport::Result<bool> {
            Ok(false)
        }
        fn bytes_to_read(&self) -> serialport::Result<u32> {
            Ok(0)
        }
        fn bytes_to_write(&self) -> serialport::Result<u32> {
            Ok(0)
        }
        fn clear(&self, _buffer_to_clear: serialport::ClearBuffer) -> serialport::Result<()> {
            Ok(())
        }
        fn set_break(&self) -> serialport::Result<()> {
            Ok(())
        }
        fn clear_break(&self) -> serialport::Result<()> {
            Ok(())
        }
    }

    impl Read for FakeSerialPort {
        fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
            Ok(0)
        }
    }

    impl Write for FakeSerialPort {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn fake_session() -> SerialSession {
        SerialSession {
            port: Arc::new(StdMutex::new(Box::new(FakeSerialPort {
                open: Arc::new(AtomicBool::new(true)),
            }))),
            stop: Arc::new(AtomicBool::new(false)),
            // The fake reader is already finished; the permit lets the
            // shutdown test exercise the shared cleanup without waiting for
            // the real two-second driver timeout.
            closed: Arc::new(Semaphore::new(1)),
            write_gate: Arc::new(tokio::sync::RwLock::new(())),
        }
    }

    #[tokio::test]
    async fn app_exit_clears_shared_resources_and_aborts_forward_tasks() {
        let state = create_shared_state();
        let task = tokio::spawn(std::future::pending::<
            Result<(), crate::errors::PortForwardError>,
        >());
        let abort_handle = task.abort_handle();
        state.port_forwards.lock().await.insert(
            "forward-on-exit".to_string(),
            PortForwardTask {
                task,
                listener: None,
                info: PortForwardInfo {
                    name: "exit probe".to_string(),
                    forward_type: "local".to_string(),
                    local_host: "127.0.0.1".to_string(),
                    local_port: 10022,
                    remote_host: "127.0.0.1".to_string(),
                    remote_port: 22,
                    status: "active".to_string(),
                },
            },
        );

        close_shared_resources(&state).await;
        tokio::task::yield_now().await;

        assert_eq!(
            (
                state.port_forwards.lock().await.len(),
                abort_handle.is_finished()
            ),
            (0, true),
            "application exit must remove and stop every registered port forward"
        );
    }

    #[tokio::test]
    async fn app_exit_signals_every_serial_session_to_stop() {
        // A serial read loop blocks on the port, so an application exit that
        // merely dropped the session would leave the reader holding the device
        // until its next read timed out. Setting the stop flag is what makes the
        // loop return, so this has to happen on the exit path and not only via
        // an explicit disconnect.
        let state = create_shared_state();
        let session = fake_session();
        let stop = Arc::clone(&session.stop);
        state
            .serial_sessions
            .lock()
            .await
            .insert("serial-on-exit".to_string(), session);

        close_shared_resources(&state).await;

        assert!(
            stop.load(Ordering::Acquire),
            "application exit must signal every serial read loop to stop"
        );
        assert!(
            state.serial_sessions.lock().await.is_empty(),
            "application exit must drop every registered serial session"
        );
    }
}
