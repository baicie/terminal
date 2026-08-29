use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Notify};
use tokio::task::JoinHandle;

use super::types::{SessionError, SessionOutput, TerminalError};

pub(crate) const OUTPUT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
pub(crate) const OUTPUT_MAX_BATCH_BYTES: usize = 32 * 1024;
pub(crate) const OUTPUT_QUEUE_CAPACITY: usize = 128;
pub(crate) const OUTPUT_PAUSE_HIGH_WATERMARK_BYTES: usize = 1024 * 1024;
pub(crate) const OUTPUT_RESUME_LOW_WATERMARK_BYTES: usize = 128 * 1024;
pub(crate) const OUTPUT_ACK_TIMEOUT: Duration = Duration::from_secs(10);

fn terminal_smoke_diagnostics_enabled() -> bool {
    std::env::var_os("TERMINAL_SMOKE").as_deref() == Some(std::ffi::OsStr::new("1"))
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct TerminalOutputFlowControl {
    pause_high_watermark_bytes: usize,
    resume_low_watermark_bytes: usize,
    ack_timeout: Duration,
}

impl TerminalOutputFlowControl {
    pub(crate) fn new(
        pause_high_watermark_bytes: usize,
        resume_low_watermark_bytes: usize,
        ack_timeout: Duration,
    ) -> Self {
        Self {
            pause_high_watermark_bytes,
            resume_low_watermark_bytes,
            ack_timeout,
        }
    }
}

impl Default for TerminalOutputFlowControl {
    fn default() -> Self {
        Self::new(
            OUTPUT_PAUSE_HIGH_WATERMARK_BYTES,
            OUTPUT_RESUME_LOW_WATERMARK_BYTES,
            OUTPUT_ACK_TIMEOUT,
        )
    }
}

static SESSION_OUTPUT_CONTROLS: OnceLock<Mutex<HashMap<String, TerminalOutputControl>>> =
    OnceLock::new();

#[derive(Debug, Default)]
struct TerminalOutputControlState {
    pending_ack_bytes: AtomicUsize,
    ack_overflowed: AtomicBool,
    finish: AtomicBool,
    notify: Notify,
}

#[derive(Clone, Debug)]
pub(crate) struct TerminalOutputControl {
    state: Arc<TerminalOutputControlState>,
}

#[derive(Clone, Copy, Debug)]
struct TerminalOutputControlUpdate {
    acknowledged_bytes: usize,
    finishing: bool,
}

impl TerminalOutputControl {
    pub(crate) fn ack(&self, bytes: usize) {
        if bytes == 0 {
            return;
        }
        if self
            .state
            .pending_ack_bytes
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |pending| {
                pending.checked_add(bytes)
            })
            .is_err()
        {
            self.state.ack_overflowed.store(true, Ordering::Release);
        }
        self.state.notify.notify_one();
    }

    pub(crate) fn finish(&self) {
        self.state.finish.store(true, Ordering::Release);
        self.state.notify.notify_one();
    }

    fn apply(&self, unacked_bytes: &mut usize) -> Result<TerminalOutputControlUpdate, String> {
        if self.state.ack_overflowed.swap(false, Ordering::AcqRel) {
            return Err("frontend output ACK byte counter overflowed".to_string());
        }
        let acknowledged = self.state.pending_ack_bytes.swap(0, Ordering::AcqRel);
        if acknowledged > *unacked_bytes {
            return Err(format!(
                "frontend output ACK {acknowledged} exceeds {unacked_bytes} outstanding bytes"
            ));
        }
        *unacked_bytes -= acknowledged;
        Ok(TerminalOutputControlUpdate {
            acknowledged_bytes: acknowledged,
            finishing: self.state.finish.load(Ordering::Acquire),
        })
    }

    async fn notified(&self) {
        self.state.notify.notified().await;
    }
}

fn session_output_controls() -> &'static Mutex<HashMap<String, TerminalOutputControl>> {
    SESSION_OUTPUT_CONTROLS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn with_session_output_controls<T>(
    update: impl FnOnce(&mut HashMap<String, TerminalOutputControl>) -> T,
) -> T {
    let mut controls = session_output_controls()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    update(&mut controls)
}

pub(crate) fn session_output_control_keys() -> Vec<String> {
    let Some(controls) = SESSION_OUTPUT_CONTROLS.get() else {
        return Vec::new();
    };
    controls
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .keys()
        .cloned()
        .collect()
}

pub(crate) fn ack_session_output(session_id: &str, bytes: usize) -> Result<(), SessionError> {
    if bytes == 0 {
        return Ok(());
    }
    if let Some(control) =
        with_session_output_controls(|controls| controls.get(session_id).cloned())
    {
        control.ack(bytes);
    }
    // xterm callbacks are asynchronous.  A callback from the last frame can
    // arrive after EOF removed the control entry; ACK is advisory and must not
    // turn that normal race into a visible I/O error.
    Ok(())
}

pub(crate) fn finish_session_output(session_id: &str) {
    if let Some(control) =
        with_session_output_controls(|controls| controls.get(session_id).cloned())
    {
        control.finish();
    }
}

#[derive(Debug)]
pub(crate) struct TerminalOutputChunk {
    pub(crate) bytes: Vec<u8>,
    pub(crate) is_stderr: bool,
}

impl TerminalOutputChunk {
    pub(crate) fn new(bytes: &[u8], is_stderr: bool) -> Self {
        Self {
            bytes: bytes.to_vec(),
            is_stderr,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct DecodedTerminalOutput {
    pub(crate) data: String,
    pub(crate) is_stderr: bool,
}

#[derive(Default)]
struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut output = String::new();
        let mut consumed = 0;

        loop {
            let remaining = &self.pending[consumed..];
            if remaining.is_empty() {
                break;
            }
            match std::str::from_utf8(remaining) {
                Ok(valid) => {
                    output.push_str(valid);
                    consumed = self.pending.len();
                    break;
                }
                Err(error) => {
                    let valid_length = error.valid_up_to();
                    if valid_length > 0 {
                        output.push_str(&String::from_utf8_lossy(&remaining[..valid_length]));
                        consumed += valid_length;
                    }
                    let Some(invalid_length) = error.error_len() else {
                        break;
                    };
                    output.push('\u{fffd}');
                    consumed += invalid_length;
                }
            }
        }

        if consumed > 0 {
            self.pending.drain(..consumed);
        }
        output
    }

    fn finish(&mut self) -> String {
        let output = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        output
    }
}

struct TerminalOutputBatcher {
    stdout_decoder: Utf8StreamDecoder,
    stderr_decoder: Utf8StreamDecoder,
    data: String,
    raw_bytes: usize,
    is_stderr: bool,
    max_batch_bytes: usize,
}

impl TerminalOutputBatcher {
    fn new(max_batch_bytes: usize) -> Self {
        Self {
            stdout_decoder: Utf8StreamDecoder::default(),
            stderr_decoder: Utf8StreamDecoder::default(),
            data: String::new(),
            raw_bytes: 0,
            is_stderr: false,
            max_batch_bytes: max_batch_bytes.max(1),
        }
    }

    fn push<F>(&mut self, chunk: TerminalOutputChunk, emit: &mut F) -> Result<(), String>
    where
        F: FnMut(DecodedTerminalOutput) -> Result<(), String>,
    {
        if self.raw_bytes > 0 && self.is_stderr != chunk.is_stderr {
            self.flush(emit)?;
        }
        self.is_stderr = chunk.is_stderr;

        let mut offset = 0;
        while offset < chunk.bytes.len() {
            let available = self.max_batch_bytes - self.raw_bytes;
            let take = available.min(chunk.bytes.len() - offset);
            let bytes = &chunk.bytes[offset..offset + take];
            let decoded = if chunk.is_stderr {
                self.stderr_decoder.push(bytes)
            } else {
                self.stdout_decoder.push(bytes)
            };
            self.data.push_str(&decoded);
            self.raw_bytes += take;
            offset += take;
            if self.raw_bytes == self.max_batch_bytes {
                self.flush(emit)?;
                self.is_stderr = chunk.is_stderr;
            }
        }
        Ok(())
    }

    fn flush<F>(&mut self, emit: &mut F) -> Result<(), String>
    where
        F: FnMut(DecodedTerminalOutput) -> Result<(), String>,
    {
        self.raw_bytes = 0;
        if self.data.is_empty() {
            return Ok(());
        }
        emit(DecodedTerminalOutput {
            data: std::mem::take(&mut self.data),
            is_stderr: self.is_stderr,
        })
    }

    fn finish<F>(&mut self, emit: &mut F) -> Result<(), String>
    where
        F: FnMut(DecodedTerminalOutput) -> Result<(), String>,
    {
        self.flush(emit)?;
        for (data, is_stderr) in [
            (self.stdout_decoder.finish(), false),
            (self.stderr_decoder.finish(), true),
        ] {
            if !data.is_empty() {
                emit(DecodedTerminalOutput { data, is_stderr })?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) fn spawn_terminal_output_pump<F>(
    flush_interval: Duration,
    max_batch_bytes: usize,
    queue_capacity: usize,
    emit: F,
) -> (
    mpsc::Sender<TerminalOutputChunk>,
    JoinHandle<Result<(), String>>,
)
where
    F: FnMut(DecodedTerminalOutput) -> Result<(), String> + Send + 'static,
{
    let (sender, _control, handle) = spawn_terminal_output_pump_with_flow_control(
        flush_interval,
        max_batch_bytes,
        queue_capacity,
        TerminalOutputFlowControl::default(),
        emit,
    );
    (sender, handle)
}

pub(crate) fn spawn_terminal_output_pump_with_flow_control<F>(
    flush_interval: Duration,
    max_batch_bytes: usize,
    queue_capacity: usize,
    flow_control: TerminalOutputFlowControl,
    mut emit: F,
) -> (
    mpsc::Sender<TerminalOutputChunk>,
    TerminalOutputControl,
    JoinHandle<Result<(), String>>,
)
where
    F: FnMut(DecodedTerminalOutput) -> Result<(), String> + Send + 'static,
{
    let (sender, mut receiver) = mpsc::channel(queue_capacity.max(1));
    let control = TerminalOutputControl {
        state: Arc::new(TerminalOutputControlState::default()),
    };
    let pump_control = control.clone();
    let handle = tokio::spawn(async move {
        let mut batcher = TerminalOutputBatcher::new(max_batch_bytes);
        let period = flush_interval.max(Duration::from_millis(1));
        let pause_high_watermark_bytes = flow_control.pause_high_watermark_bytes.max(1);
        let resume_low_watermark_bytes = flow_control
            .resume_low_watermark_bytes
            .min(pause_high_watermark_bytes);
        let mut ticker = tokio::time::interval(period);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        ticker.tick().await;
        let mut unacked_bytes = 0usize;
        let mut emitted_bytes = 0usize;
        let mut acknowledged_bytes = 0usize;
        let mut paused = false;
        let mut pause_deadline = None;
        let mut finishing = false;

        loop {
            let update = pump_control.apply(&mut unacked_bytes)?;
            acknowledged_bytes = acknowledged_bytes
                .checked_add(update.acknowledged_bytes)
                .ok_or_else(|| "terminal output ACK diagnostic counter overflowed".to_string())?;
            if terminal_smoke_diagnostics_enabled() && update.acknowledged_bytes > 0 {
                tracing::info!(
                    acknowledged_bytes,
                    outstanding_bytes = unacked_bytes,
                    "terminal smoke output ACK progress"
                );
            }
            if update.finishing {
                finishing = true;
                paused = false;
                pause_deadline = None;
            } else if paused {
                if unacked_bytes <= resume_low_watermark_bytes {
                    paused = false;
                    pause_deadline = None;
                    if terminal_smoke_diagnostics_enabled() {
                        tracing::info!(
                            emitted_bytes,
                            acknowledged_bytes,
                            outstanding_bytes = unacked_bytes,
                            "terminal smoke output resumed"
                        );
                    }
                } else if update.acknowledged_bytes > 0 {
                    pause_deadline = Some(
                        tokio::time::Instant::now()
                            + flow_control.ack_timeout.max(Duration::from_millis(1)),
                    );
                }
            }

            if paused && !finishing {
                // A natural EOF closes the producer while the frontend may
                // still have unacknowledged bytes.  Keep the queue bounded,
                // but do not wait forever for ACKs that can never arrive.
                if receiver.is_closed() {
                    finishing = true;
                    paused = false;
                    pause_deadline = None;
                    continue;
                }
                let deadline = pause_deadline.unwrap_or_else(|| {
                    tokio::time::Instant::now()
                        + flow_control.ack_timeout.max(Duration::from_millis(1))
                });
                tokio::select! {
                    _ = pump_control.notified() => {}
                    // Keep EOF detection independent from the output flush
                    // interval; tests and slow-output configurations may use
                    // a long ticker period.
                    _ = tokio::time::sleep(Duration::from_millis(16)) => {}
                    _ = tokio::time::sleep_until(deadline) => {
                        return Err(format!(
                            "frontend output ACK timed out after {} ms (emitted_bytes={emitted_bytes}, acknowledged_bytes={acknowledged_bytes}, outstanding_bytes={unacked_bytes})",
                            flow_control.ack_timeout.as_millis(),
                        ));
                    }
                }
                continue;
            }

            {
                let mut tracking_emit = |output: DecodedTerminalOutput| {
                    unacked_bytes = unacked_bytes
                        .checked_add(output.data.len())
                        .ok_or_else(|| "terminal output byte counter overflowed".to_string())?;
                    emitted_bytes =
                        emitted_bytes
                            .checked_add(output.data.len())
                            .ok_or_else(|| {
                                "terminal output diagnostic counter overflowed".to_string()
                            })?;
                    emit(output)
                };
                tokio::select! {
                    biased;
                    _ = pump_control.notified() => {}
                    message = receiver.recv() => {
                        let Some(chunk) = message else {
                            break;
                        };
                        batcher.push(chunk, &mut tracking_emit)?;
                    }
                    _ = ticker.tick() => batcher.flush(&mut tracking_emit)?,
                }
            }
            if !finishing && !paused && unacked_bytes >= pause_high_watermark_bytes {
                paused = true;
                pause_deadline = Some(
                    tokio::time::Instant::now()
                        + flow_control.ack_timeout.max(Duration::from_millis(1)),
                );
                if terminal_smoke_diagnostics_enabled() {
                    tracing::info!(
                        emitted_bytes,
                        acknowledged_bytes,
                        outstanding_bytes = unacked_bytes,
                        "terminal smoke output paused"
                    );
                }
            }
        }

        batcher.finish(&mut emit)
    });
    (sender, control, handle)
}

pub(crate) fn spawn_session_output_pump(
    app: AppHandle,
    session_id: String,
    event_name: &'static str,
) -> (
    mpsc::Sender<TerminalOutputChunk>,
    JoinHandle<Result<(), String>>,
) {
    let registry_session_id = session_id.clone();
    let (sender, control, output_handle) = spawn_terminal_output_pump_with_flow_control(
        OUTPUT_FLUSH_INTERVAL,
        OUTPUT_MAX_BATCH_BYTES,
        OUTPUT_QUEUE_CAPACITY,
        TerminalOutputFlowControl::default(),
        move |output| {
            let bytes = output.data.len();
            app.emit(
                event_name,
                SessionOutput {
                    session_id: session_id.clone(),
                    data: output.data,
                    is_stderr: output.is_stderr,
                    bytes,
                },
            )
            .map_err(|error| format!("failed to emit {event_name}: {error}"))
        },
    );
    with_session_output_controls(|controls| {
        controls.insert(registry_session_id.clone(), control);
    });
    let handle = tokio::spawn(async move {
        let result = match output_handle.await {
            Ok(result) => result,
            Err(error) => Err(format!("terminal output pump task failed: {error}")),
        };
        with_session_output_controls(|controls| {
            controls.remove(&registry_session_id);
        });
        result
    });
    (sender, handle)
}

pub(crate) fn emit_terminal_error(app: &AppHandle, session_id: &str, message: impl Into<String>) {
    let message = message.into();
    if let Err(error) = app.emit(
        "terminal-error",
        TerminalError {
            session_id: session_id.to_string(),
            message,
        },
    ) {
        tracing::error!(session_id, %error, "failed to emit terminal error");
    }
}

#[cfg(test)]
#[path = "terminal_output_tests.rs"]
mod tests;
