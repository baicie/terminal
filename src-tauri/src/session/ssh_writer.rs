use async_trait::async_trait;
use russh::{client, ChannelWriteHalf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::Instant;

#[cfg(test)]
use tokio::sync::Mutex;

use super::types::SessionError;

pub(crate) const SSH_WRITER_QUEUE_CAPACITY: usize = 64;

#[async_trait]
pub(crate) trait SshChannelWriter: Send {
    async fn write_data(&mut self, data: Vec<u8>) -> Result<(), SessionError>;
    async fn resize(&mut self, cols: u16, rows: u16) -> Result<(), SessionError>;
    async fn close(&mut self) -> Result<(), SessionError>;
}

#[async_trait]
impl SshChannelWriter for ChannelWriteHalf<client::Msg> {
    async fn write_data(&mut self, data: Vec<u8>) -> Result<(), SessionError> {
        let bytes = bytes::Bytes::from(data);
        self.data(bytes.as_ref()).await.map_err(|error| {
            SessionError::ChannelError(format!("failed to write SSH data: {error}"))
        })
    }

    async fn resize(&mut self, cols: u16, rows: u16) -> Result<(), SessionError> {
        self.window_change(cols.into(), rows.into(), 0, 0)
            .await
            .map_err(|error| {
                SessionError::ChannelError(format!("failed to resize SSH terminal: {error}"))
            })
    }

    async fn close(&mut self) -> Result<(), SessionError> {
        ChannelWriteHalf::close(self).await.map_err(|error| {
            SessionError::ChannelError(format!("failed to close SSH terminal: {error}"))
        })
    }
}

/// How a timeout affects the writer, decided per command kind.
#[derive(Clone, Copy)]
struct TimeoutPolicy {
    /// The command never started, so nothing could have been written/closed.
    queued: bool,
    /// The command was already running: its bytes may have reached the peer.
    started: bool,
}

/// Whether a queued command ever reached the channel.
///
/// It is the only evidence the caller has when its deadline passes: a command
/// that never started cannot have written anything, while one that started may
/// have delivered some or all of its bytes. The two must not share a fate.
#[derive(Default)]
struct CommandState {
    started: AtomicBool,
}

enum SshWriterCommand {
    Write {
        data: Vec<u8>,
        deadline: Instant,
        state: Arc<CommandState>,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    Resize {
        cols: u16,
        rows: u16,
        deadline: Instant,
        state: Arc<CommandState>,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    Close {
        deadline: Instant,
        state: Arc<CommandState>,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
}

#[derive(Clone)]
pub(crate) struct SshWriterHandle {
    sender: mpsc::Sender<SshWriterCommand>,
    timeouts: SshWriterTimeouts,
    running: Arc<AtomicBool>,
    completion_tx: watch::Sender<Option<Result<(), SessionError>>>,
}

pub(crate) struct SshWriterCompletion {
    completion_rx: watch::Receiver<Option<Result<(), SessionError>>>,
}

#[derive(Clone, Copy)]
pub(crate) struct SshWriterTimeouts {
    pub(crate) write: Duration,
    pub(crate) resize: Duration,
    pub(crate) close: Duration,
}

impl SshWriterHandle {
    pub(crate) async fn write(&self, data: Vec<u8>) -> Result<(), SessionError> {
        let deadline = command_deadline(self.timeouts.write);
        let (reply, response) = oneshot::channel();
        let state = Arc::new(CommandState::default());
        self.send(
            SshWriterCommand::Write {
                data,
                deadline,
                state: Arc::clone(&state),
                reply,
            },
            &state,
            response,
            deadline,
            SessionError::WriteFailed("SSH writer queue is unavailable".to_string()),
            TimeoutPolicy {
                queued: false,
                // A write that started may have put bytes on the wire. The
                // session cannot know whether the peer saw them, so it is
                // retired rather than left in a state where a retry would
                // duplicate input.
                started: true,
            },
        )
        .await
    }

    pub(crate) async fn resize(&self, cols: u16, rows: u16) -> Result<(), SessionError> {
        let deadline = command_deadline(self.timeouts.resize);
        let (reply, response) = oneshot::channel();
        let state = Arc::new(CommandState::default());
        self.send(
            SshWriterCommand::Resize {
                cols,
                rows,
                deadline,
                state: Arc::clone(&state),
                reply,
            },
            &state,
            response,
            deadline,
            SessionError::ResizeFailed("SSH writer queue is unavailable".to_string()),
            TimeoutPolicy {
                queued: false,
                // A resize carries no user input; an expiring one does not make
                // the write channel untrustworthy.
                started: false,
            },
        )
        .await
    }

    pub(crate) async fn close(&self) -> Result<(), SessionError> {
        let deadline = command_deadline(self.timeouts.close);
        let (reply, response) = oneshot::channel();
        let state = Arc::new(CommandState::default());
        self.send(
            SshWriterCommand::Close {
                deadline,
                state: Arc::clone(&state),
                reply,
            },
            &state,
            response,
            deadline,
            SessionError::CloseFailed("SSH writer queue is unavailable".to_string()),
            TimeoutPolicy {
                queued: true,
                started: true,
            },
        )
        .await
    }

    pub(crate) fn is_running(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }

    pub(crate) fn completion(&self) -> SshWriterCompletion {
        SshWriterCompletion {
            completion_rx: self.completion_tx.subscribe(),
        }
    }

    async fn send(
        &self,
        command: SshWriterCommand,
        state: &Arc<CommandState>,
        response: oneshot::Receiver<Result<(), SessionError>>,
        deadline: Instant,
        queue_error: SessionError,
        policy: TimeoutPolicy,
    ) -> Result<(), SessionError> {
        if !self.is_running() {
            return Err(queue_error);
        }

        match tokio::time::timeout_at(deadline, self.sender.send(command)).await {
            Err(_) => {
                // The command never entered the queue, so the channel is untouched and
                // the writer stays usable. Only a terminal command may retire it here.
                return Err(
                    self.retire_on_timeout(queue_timeout_error(&queue_error), policy.queued)
                );
            }
            Ok(Err(_)) => {
                complete_writer(&self.running, &self.completion_tx, Err(queue_error.clone()));
                return Err(queue_error);
            }
            Ok(Ok(())) => {}
        }

        match tokio::time::timeout_at(deadline, response).await {
            Err(_) => {
                if state.started.load(Ordering::Acquire) {
                    // The operation was already running when the deadline passed:
                    // some or all of it may have reached the channel, and no
                    // caller can tell. Retiring the writer is what keeps a retry
                    // from sending the same input twice.
                    let error = uncertain_timeout_error(&queue_error);
                    return Err(self.retire_on_timeout(error, policy.started));
                }
                // The command was still queued (or never left the queue), so
                // nothing was written: a single timed-out write or resize must
                // not end the whole write channel.
                let error = command_timeout_error(&queue_error);
                Err(self.retire_on_timeout(error, policy.queued))
            }
            Ok(Err(_)) => {
                let error = SessionError::ChannelError(
                    "SSH writer task stopped before completing the command".to_string(),
                );
                complete_writer(&self.running, &self.completion_tx, Err(error.clone()));
                Err(error)
            }
            Ok(Ok(result)) => result,
        }
    }

    /// Retire the writer on a timeout only when the timed-out command makes it unusable.
    fn retire_on_timeout(&self, error: SessionError, timeout_is_fatal: bool) -> SessionError {
        if timeout_is_fatal {
            complete_writer(&self.running, &self.completion_tx, Err(error.clone()));
        }
        error
    }
}

impl SshWriterCompletion {
    pub(crate) async fn wait(mut self) -> Result<(), SessionError> {
        loop {
            if let Some(result) = self.completion_rx.borrow_and_update().clone() {
                return result;
            }
            if self.completion_rx.changed().await.is_err() {
                return Err(SessionError::ChannelError(
                    "SSH writer task stopped without a completion status".to_string(),
                ));
            }
        }
    }
}

fn complete_writer(
    running: &AtomicBool,
    completion_tx: &watch::Sender<Option<Result<(), SessionError>>>,
    result: Result<(), SessionError>,
) {
    if running
        .compare_exchange(true, false, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
    {
        completion_tx.send_replace(Some(result));
    }
}

fn queue_timeout_error(error: &SessionError) -> SessionError {
    match error {
        SessionError::WriteFailed(message) => {
            SessionError::WriteFailed(format!("{message} (queue timeout)"))
        }
        SessionError::ResizeFailed(message) => {
            SessionError::ResizeFailed(format!("{message} (queue timeout)"))
        }
        SessionError::CloseFailed(message) => {
            SessionError::CloseFailed(format!("{message} (queue timeout)"))
        }
        _ => SessionError::ChannelError("SSH writer queue timed out".to_string()),
    }
}

/// The operation was running when its deadline passed, so whether its bytes
/// reached the peer is unknown. The message says so instead of pretending the
/// write failed cleanly.
fn uncertain_timeout_error(error: &SessionError) -> SessionError {
    match error {
        SessionError::WriteFailed(message) => SessionError::WriteFailed(format!(
            "{message} (timed out after it started; the bytes may have been partially delivered)"
        )),
        SessionError::ResizeFailed(message) => {
            SessionError::ResizeFailed(format!("{message} (timed out after it started)"))
        }
        SessionError::CloseFailed(message) => SessionError::CloseFailed(format!(
            "{message} (timed out after it started; the channel may be partially closed)"
        )),
        _ => SessionError::ChannelError(
            "SSH writer operation timed out after it started".to_string(),
        ),
    }
}

fn command_timeout_error(error: &SessionError) -> SessionError {
    match error {
        SessionError::WriteFailed(message) => {
            SessionError::WriteFailed(format!("{message} (command timeout)"))
        }
        SessionError::ResizeFailed(message) => {
            SessionError::ResizeFailed(format!("{message} (command timeout)"))
        }
        SessionError::CloseFailed(message) => {
            SessionError::CloseFailed(format!("{message} (command timeout)"))
        }
        _ => SessionError::ChannelError("SSH writer command timed out".to_string()),
    }
}

pub(crate) fn spawn_ssh_writer<W>(
    writer: W,
    queue_capacity: usize,
    timeouts: SshWriterTimeouts,
) -> (SshWriterHandle, tokio::task::JoinHandle<()>)
where
    W: SshChannelWriter + 'static,
{
    let (sender, mut receiver) = mpsc::channel(queue_capacity.max(1));
    let (completion_tx, _) = watch::channel(None);
    let running = Arc::new(AtomicBool::new(true));
    let handle = SshWriterHandle {
        sender,
        timeouts,
        running: Arc::clone(&running),
        completion_tx: completion_tx.clone(),
    };
    let worker = tokio::spawn(async move {
        let mut writer = writer;
        let mut close_attempted = false;
        while let Some(command) = receiver.recv().await {
            if !running.load(Ordering::Acquire) {
                break;
            }
            match command {
                SshWriterCommand::Write {
                    data,
                    deadline,
                    state,
                    reply,
                } => {
                    if reply.is_closed() {
                        continue;
                    }
                    if deadline <= Instant::now() {
                        // Expired before it started: nothing was written, so the
                        // caller must not be told the writer is broken.
                        let _ = reply.send(Err(SessionError::WriteFailed(
                            "SSH write expired before it started".to_string(),
                        )));
                        continue;
                    }
                    state.started.store(true, Ordering::Release);
                    let outcome =
                        run_until_deadline(deadline, writer.write_data(data), "write").await;
                    let fatal = outcome.as_ref().err().is_some_and(CommandFailure::is_fatal);
                    let result = outcome.map_err(CommandFailure::into_error);
                    if fatal {
                        if let Err(error) = &result {
                            complete_writer(&running, &completion_tx, Err(error.clone()));
                        }
                    }
                    let _ = reply.send(result);
                    if fatal {
                        break;
                    }
                }
                SshWriterCommand::Resize {
                    cols,
                    rows,
                    deadline,
                    state,
                    reply,
                } => {
                    if reply.is_closed() {
                        continue;
                    }
                    if deadline <= Instant::now() {
                        let _ = reply.send(Err(SessionError::ResizeFailed(
                            "SSH resize expired before it started".to_string(),
                        )));
                        continue;
                    }
                    state.started.store(true, Ordering::Release);
                    let outcome =
                        run_until_deadline(deadline, writer.resize(cols, rows), "resize").await;
                    let fatal = outcome.as_ref().err().is_some_and(CommandFailure::is_fatal);
                    let result = outcome.map_err(CommandFailure::into_error);
                    if fatal {
                        if let Err(error) = &result {
                            complete_writer(&running, &completion_tx, Err(error.clone()));
                        }
                    }
                    let _ = reply.send(result);
                    if fatal {
                        break;
                    }
                }
                SshWriterCommand::Close {
                    deadline,
                    state,
                    reply,
                } => {
                    if reply.is_closed() {
                        break;
                    }
                    if deadline <= Instant::now() {
                        let _ = reply.send(Err(SessionError::CloseFailed(
                            "SSH close expired before it started".to_string(),
                        )));
                        break;
                    }
                    state.started.store(true, Ordering::Release);
                    close_attempted = true;
                    let result = run_until_deadline(deadline, writer.close(), "close")
                        .await
                        .map_err(CommandFailure::into_error);
                    complete_writer(&running, &completion_tx, result.clone());
                    let _ = reply.send(result);
                    break;
                }
            }
        }

        if !close_attempted {
            let deadline = command_deadline(timeouts.close);
            let result = run_until_deadline(deadline, writer.close(), "close")
                .await
                .map_err(CommandFailure::into_error);
            complete_writer(&running, &completion_tx, result);
        }
    });
    (handle, worker)
}

fn command_deadline(timeout: Duration) -> Instant {
    Instant::now() + timeout.max(Duration::from_millis(1))
}

/// Outcome of one channel operation run under its deadline.
enum CommandFailure {
    /// The channel itself failed, so the writer can no longer be trusted.
    Fatal(SessionError),
    /// The operation outlived its deadline; the writer itself is still usable.
    TimedOut(SessionError),
}

impl CommandFailure {
    fn is_fatal(&self) -> bool {
        matches!(self, Self::Fatal(_))
    }

    fn into_error(self) -> SessionError {
        match self {
            Self::Fatal(error) | Self::TimedOut(error) => error,
        }
    }
}

async fn run_until_deadline<F>(
    deadline: Instant,
    operation: F,
    name: &'static str,
) -> Result<(), CommandFailure>
where
    F: std::future::Future<Output = Result<(), SessionError>>,
{
    match tokio::time::timeout_at(deadline, operation).await {
        Ok(result) => result.map_err(CommandFailure::Fatal),
        Err(_) => Err(CommandFailure::TimedOut(SessionError::ChannelError(
            format!("SSH terminal {name} timed out"),
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::Notify;

    #[derive(Clone, Default)]
    struct FakeWriter {
        operations: Arc<Mutex<Vec<String>>>,
        active: Arc<AtomicUsize>,
        max_active: Arc<AtomicUsize>,
    }

    impl FakeWriter {
        async fn record(&self, operation: String) {
            let active = self.active.fetch_add(1, Ordering::AcqRel) + 1;
            self.max_active.fetch_max(active, Ordering::AcqRel);
            self.operations.lock().await.push(operation);
            tokio::task::yield_now().await;
            self.active.fetch_sub(1, Ordering::AcqRel);
        }
    }

    #[async_trait]
    impl SshChannelWriter for FakeWriter {
        async fn write_data(&mut self, data: Vec<u8>) -> Result<(), SessionError> {
            self.record(format!("write:{}", String::from_utf8_lossy(&data)))
                .await;
            Ok(())
        }

        async fn resize(&mut self, cols: u16, rows: u16) -> Result<(), SessionError> {
            self.record(format!("resize:{cols}x{rows}")).await;
            Ok(())
        }

        async fn close(&mut self) -> Result<(), SessionError> {
            self.record("close".to_string()).await;
            Ok(())
        }
    }

    #[tokio::test]
    async fn writer_serializes_write_resize_and_close_in_fifo_order() {
        let fake = FakeWriter::default();
        let operations = Arc::clone(&fake.operations);
        let timeouts = SshWriterTimeouts {
            write: Duration::from_secs(1),
            resize: Duration::from_secs(1),
            close: Duration::from_secs(1),
        };
        let (writer, worker) = spawn_ssh_writer(fake, 8, timeouts);

        let first = writer.write(b"a".to_vec());
        let resize = writer.resize(100, 30);
        let second = writer.write(b"b".to_vec());
        let close = writer.close();
        let (first, resize, second, close) = tokio::join!(first, resize, second, close);
        first.expect("first write should succeed");
        resize.expect("resize should succeed");
        second.expect("second write should succeed");
        close.expect("close should succeed");
        worker.await.expect("writer worker should join");

        assert_eq!(
            *operations.lock().await,
            vec!["write:a", "resize:100x30", "write:b", "close"]
        );
    }

    #[tokio::test]
    async fn writer_never_runs_two_channel_operations_concurrently() {
        let fake = FakeWriter::default();
        let max_active = Arc::clone(&fake.max_active);
        let timeouts = SshWriterTimeouts {
            write: Duration::from_secs(1),
            resize: Duration::from_secs(1),
            close: Duration::from_secs(1),
        };
        let (writer, worker) = spawn_ssh_writer(fake, 8, timeouts);

        let first = writer.write(b"a".to_vec());
        let second = writer.write(b"b".to_vec());
        let close = writer.close();
        let (first, second, close) = tokio::join!(first, second, close);
        first.expect("first write should succeed");
        second.expect("second write should succeed");
        close.expect("close should succeed");
        worker.await.expect("writer worker should join");

        assert_eq!(max_active.load(Ordering::Acquire), 1);
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum BlockedOperation {
        Write,
        Resize,
    }

    struct BlockingWriter {
        operations: Arc<Mutex<Vec<String>>>,
        blocked_operation: BlockedOperation,
        operation_started: Arc<Notify>,
        release_operation: Arc<Notify>,
    }

    impl BlockingWriter {
        async fn record_and_maybe_block(&self, operation: BlockedOperation, description: String) {
            self.operations.lock().await.push(description);
            if operation == self.blocked_operation {
                self.operation_started.notify_one();
                self.release_operation.notified().await;
            }
        }
    }

    #[async_trait]
    impl SshChannelWriter for BlockingWriter {
        async fn write_data(&mut self, data: Vec<u8>) -> Result<(), SessionError> {
            self.record_and_maybe_block(
                BlockedOperation::Write,
                format!("write:{}", String::from_utf8_lossy(&data)),
            )
            .await;
            Ok(())
        }

        async fn resize(&mut self, cols: u16, rows: u16) -> Result<(), SessionError> {
            self.record_and_maybe_block(BlockedOperation::Resize, format!("resize:{cols}x{rows}"))
                .await;
            Ok(())
        }

        async fn close(&mut self) -> Result<(), SessionError> {
            self.operations.lock().await.push("close".to_string());
            Ok(())
        }
    }

    struct FailingWriteWriter {
        operations: Arc<Mutex<Vec<String>>>,
    }

    #[async_trait]
    impl SshChannelWriter for FailingWriteWriter {
        async fn write_data(&mut self, _data: Vec<u8>) -> Result<(), SessionError> {
            self.operations.lock().await.push("write".to_string());
            Err(SessionError::WriteFailed("injected failure".to_string()))
        }

        async fn resize(&mut self, _cols: u16, _rows: u16) -> Result<(), SessionError> {
            Ok(())
        }

        async fn close(&mut self) -> Result<(), SessionError> {
            self.operations.lock().await.push("close".to_string());
            Ok(())
        }
    }

    #[tokio::test]
    async fn timed_out_queued_write_is_not_executed() {
        let operations = Arc::new(Mutex::new(Vec::new()));
        let operation_started = Arc::new(Notify::new());
        let release_operation = Arc::new(Notify::new());
        let fake = BlockingWriter {
            operations: Arc::clone(&operations),
            blocked_operation: BlockedOperation::Resize,
            operation_started: Arc::clone(&operation_started),
            release_operation: Arc::clone(&release_operation),
        };
        let timeouts = SshWriterTimeouts {
            write: Duration::from_millis(10),
            resize: Duration::from_secs(1),
            close: Duration::from_secs(1),
        };
        let (writer, worker) = spawn_ssh_writer(fake, 8, timeouts);
        let resize = tokio::spawn({
            let writer = writer.clone();
            async move { writer.resize(120, 40).await }
        });
        operation_started.notified().await;

        let error = writer
            .write(b"expired".to_vec())
            .await
            .expect_err("write waiting past its deadline must time out");
        assert!(matches!(
            error,
            SessionError::WriteFailed(message) if message.contains("command timeout")
        ));

        release_operation.notify_one();
        resize
            .await
            .expect("resize task should join")
            .expect("blocking resize should complete");
        drop(writer);
        worker.await.expect("writer worker should join");

        assert_eq!(*operations.lock().await, vec!["resize:120x40", "close"]);
    }

    #[tokio::test]
    async fn timed_out_queued_resize_is_not_executed() {
        let operations = Arc::new(Mutex::new(Vec::new()));
        let operation_started = Arc::new(Notify::new());
        let release_operation = Arc::new(Notify::new());
        let fake = BlockingWriter {
            operations: Arc::clone(&operations),
            blocked_operation: BlockedOperation::Write,
            operation_started: Arc::clone(&operation_started),
            release_operation: Arc::clone(&release_operation),
        };
        let timeouts = SshWriterTimeouts {
            write: Duration::from_secs(1),
            resize: Duration::from_millis(10),
            close: Duration::from_secs(1),
        };
        let (writer, worker) = spawn_ssh_writer(fake, 8, timeouts);
        let write = tokio::spawn({
            let writer = writer.clone();
            async move { writer.write(b"blocking".to_vec()).await }
        });
        operation_started.notified().await;

        let error = writer
            .resize(90, 25)
            .await
            .expect_err("resize waiting past its deadline must time out");
        assert!(matches!(
            error,
            SessionError::ResizeFailed(message) if message.contains("command timeout")
        ));

        release_operation.notify_one();
        write
            .await
            .expect("write task should join")
            .expect("blocking write should complete");
        drop(writer);
        worker.await.expect("writer worker should join");

        assert_eq!(*operations.lock().await, vec!["write:blocking", "close"]);
    }

    #[tokio::test]
    async fn operation_error_still_performs_bounded_close() {
        let operations = Arc::new(Mutex::new(Vec::new()));
        let fake = FailingWriteWriter {
            operations: Arc::clone(&operations),
        };
        let timeouts = SshWriterTimeouts {
            write: Duration::from_secs(1),
            resize: Duration::from_secs(1),
            close: Duration::from_secs(1),
        };
        let (writer, worker) = spawn_ssh_writer(fake, 8, timeouts);

        writer
            .write(b"fail".to_vec())
            .await
            .expect_err("injected write error should be returned");
        worker.await.expect("writer worker should join");

        assert_eq!(*operations.lock().await, vec!["write", "close"]);
    }

    #[tokio::test]
    async fn operation_error_marks_writer_stopped_and_notifies_completion() {
        let operations = Arc::new(Mutex::new(Vec::new()));
        let fake = FailingWriteWriter {
            operations: Arc::clone(&operations),
        };
        let timeouts = SshWriterTimeouts {
            write: Duration::from_secs(1),
            resize: Duration::from_secs(1),
            close: Duration::from_secs(1),
        };
        let (writer, worker) = spawn_ssh_writer(fake, 8, timeouts);
        let completion = writer.completion();

        writer
            .write(b"fail".to_vec())
            .await
            .expect_err("injected write error should be returned");

        assert!(!writer.is_running());
        let error = completion
            .wait()
            .await
            .expect_err("writer completion must retain the fatal operation error");
        assert!(matches!(
            error,
            SessionError::WriteFailed(message) if message == "injected failure"
        ));
        worker.await.expect("writer worker should join");
    }

    #[tokio::test]
    async fn explicit_close_notifies_clean_writer_completion() {
        let fake = FakeWriter::default();
        let timeouts = SshWriterTimeouts {
            write: Duration::from_secs(1),
            resize: Duration::from_secs(1),
            close: Duration::from_secs(1),
        };
        let (writer, worker) = spawn_ssh_writer(fake, 8, timeouts);
        let completion = writer.completion();

        writer.close().await.expect("writer close should succeed");

        completion
            .wait()
            .await
            .expect("explicit close should be reported as clean completion");
        assert!(!writer.is_running());
        worker.await.expect("writer worker should join");
    }

    #[tokio::test]
    async fn expired_close_stops_worker_and_rejects_later_commands() {
        let operations = Arc::new(Mutex::new(Vec::new()));
        let operation_started = Arc::new(Notify::new());
        let release_operation = Arc::new(Notify::new());
        let fake = BlockingWriter {
            operations: Arc::clone(&operations),
            blocked_operation: BlockedOperation::Write,
            operation_started: Arc::clone(&operation_started),
            release_operation: Arc::clone(&release_operation),
        };
        let timeouts = SshWriterTimeouts {
            write: Duration::from_secs(1),
            resize: Duration::from_secs(1),
            close: Duration::from_millis(5),
        };
        let (writer, worker) = spawn_ssh_writer(fake, 8, timeouts);
        let write_handle = tokio::spawn({
            let writer = writer.clone();
            async move { writer.write(b"slow".to_vec()).await }
        });
        operation_started.notified().await;

        let error = tokio::time::timeout(Duration::from_millis(50), writer.close())
            .await
            .expect("the public close deadline must include time spent waiting in the queue")
            .expect_err("close queued behind a slow write must time out");

        assert!(matches!(
            error,
            SessionError::CloseFailed(message) if message.contains("command timeout")
        ));
        writer
            .resize(132, 43)
            .await
            .expect_err("commands after a close timeout must fail without entering the queue");

        release_operation.notify_one();
        write_handle
            .await
            .expect("slow write task should join")
            .expect("slow write should complete");
        worker.await.expect("writer worker should join");

        assert_eq!(*operations.lock().await, vec!["write:slow", "close"]);
    }

    struct StallingWriter {
        operations: Arc<Mutex<Vec<String>>>,
        calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl SshChannelWriter for StallingWriter {
        async fn write_data(&mut self, data: Vec<u8>) -> Result<(), SessionError> {
            let call = self.calls.fetch_add(1, Ordering::AcqRel);
            self.operations
                .lock()
                .await
                .push(format!("write:{}", String::from_utf8_lossy(&data)));
            if call == 0 {
                // Only the writer deadline can end this operation.
                std::future::pending::<()>().await;
            }
            Ok(())
        }

        async fn resize(&mut self, _cols: u16, _rows: u16) -> Result<(), SessionError> {
            Ok(())
        }

        async fn close(&mut self) -> Result<(), SessionError> {
            self.operations.lock().await.push("close".to_string());
            Ok(())
        }
    }

    #[tokio::test]
    async fn a_write_that_times_out_after_it_started_retires_the_writer() {
        let operations = Arc::new(Mutex::new(Vec::new()));
        let calls = Arc::new(AtomicUsize::new(0));
        let fake = StallingWriter {
            operations: Arc::clone(&operations),
            calls,
        };
        let timeouts = SshWriterTimeouts {
            write: Duration::from_millis(60),
            resize: Duration::from_secs(1),
            close: Duration::from_secs(1),
        };
        let (writer, worker) = spawn_ssh_writer(fake, 8, timeouts);

        let error = writer
            .write(b"slow".to_vec())
            .await
            .expect_err("a write that never completes must time out");
        assert!(
            error
                .to_string()
                .contains("may have been partially delivered"),
            "the caller must be told the outcome is unknown: {error}"
        );
        assert!(
            !writer.is_running(),
            "a write that started and then timed out must retire the writer: its bytes may have reached the peer"
        );
        let later = writer.write(b"retry".to_vec()).await;
        assert!(
            later.is_err(),
            "a retired writer must not accept a retry that could duplicate input"
        );

        drop(writer);
        worker.await.expect("writer worker should join");

        assert_eq!(*operations.lock().await, vec!["write:slow", "close"]);
    }

    struct PanickingWriter;

    #[async_trait]
    impl SshChannelWriter for PanickingWriter {
        async fn write_data(&mut self, _data: Vec<u8>) -> Result<(), SessionError> {
            panic!("simulated channel failure");
        }

        async fn resize(&mut self, _cols: u16, _rows: u16) -> Result<(), SessionError> {
            Ok(())
        }

        async fn close(&mut self) -> Result<(), SessionError> {
            Ok(())
        }
    }

    fn uniform_timeouts(timeout: Duration) -> SshWriterTimeouts {
        SshWriterTimeouts {
            write: timeout,
            resize: timeout,
            close: timeout,
        }
    }

    #[tokio::test]
    async fn a_dropped_write_future_does_not_stall_the_writer() {
        // The caller abandons a queued write (its reply receiver is dropped).
        // The worker must skip it and keep serving; a panicking or blocked worker
        // here would freeze the terminal for every later keystroke.
        let operations = Arc::new(Mutex::new(Vec::new()));
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let fake = BlockingWriter {
            operations: Arc::clone(&operations),
            blocked_operation: BlockedOperation::Resize,
            operation_started: Arc::clone(&started),
            release_operation: Arc::clone(&release),
        };
        let (writer, worker) = spawn_ssh_writer(fake, 1, uniform_timeouts(Duration::from_secs(1)));

        let resize_handle = {
            let writer = writer.clone();
            tokio::spawn(async move { writer.resize(80, 24).await })
        };
        started.notified().await;

        let abandoned = {
            let writer = writer.clone();
            tokio::spawn(async move { writer.write(b"abandoned".to_vec()).await })
        };
        tokio::task::yield_now().await;
        abandoned.abort();
        let _ = abandoned.await;

        release.notify_one();
        resize_handle.await.expect("resize task").expect("resize");

        writer
            .write(b"after".to_vec())
            .await
            .expect("the writer must keep serving after a dropped caller");
        writer.close().await.expect("close");
        worker.await.expect("writer worker should join");

        assert_eq!(
            *operations.lock().await,
            vec!["resize:80x24", "write:after", "close"]
        );
    }

    #[tokio::test]
    async fn a_panicking_writer_fails_the_command_and_retires_the_channel() {
        let (writer, worker) =
            spawn_ssh_writer(PanickingWriter, 1, uniform_timeouts(Duration::from_secs(1)));

        let error = writer
            .write(b"boom".to_vec())
            .await
            .expect_err("a panicking channel operation must surface as an error");
        assert!(
            !writer.is_running(),
            "a writer whose task died must not claim to be running"
        );
        assert!(error.to_string().contains("stopped"), "{error}");
        assert!(
            writer.write(b"later".to_vec()).await.is_err(),
            "no command may be accepted after the worker is gone"
        );
        assert!(worker.await.is_err(), "the worker task must have panicked");
    }

    #[tokio::test]
    async fn queue_capacity_one_keeps_the_writer_usable_after_queued_timeouts() {
        let operations = Arc::new(Mutex::new(Vec::new()));
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let fake = BlockingWriter {
            operations: Arc::clone(&operations),
            blocked_operation: BlockedOperation::Resize,
            operation_started: Arc::clone(&started),
            release_operation: Arc::clone(&release),
        };
        let timeouts = SshWriterTimeouts {
            write: Duration::from_millis(100),
            resize: Duration::from_secs(5),
            close: Duration::from_secs(5),
        };
        let (writer, worker) = spawn_ssh_writer(fake, 1, timeouts);

        let resize_handle = {
            let writer = writer.clone();
            tokio::spawn(async move { writer.resize(80, 24).await })
        };
        started.notified().await;

        // One write fits the single queue slot; the next one cannot be accepted
        // while the worker is busy, and both deadlines pass in the queue.
        let buffered = {
            let writer = writer.clone();
            tokio::spawn(async move { writer.write(b"buffered".to_vec()).await })
        };
        let rejected = writer.write(b"rejected".to_vec()).await;
        assert!(rejected.is_err(), "the second write cannot fit the queue");
        assert!(
            writer.is_running(),
            "a queue timeout happens before anything is written and must not retire the writer"
        );
        let _ = buffered.await;
        release.notify_one();
        resize_handle.await.expect("resize task").expect("resize");

        writer
            .write(b"after".to_vec())
            .await
            .expect("the writer must still accept writes after queued timeouts");
        writer.close().await.expect("close");
        worker.await.expect("writer worker should join");

        let recorded = operations.lock().await.clone();
        assert_eq!(recorded.first().map(String::as_str), Some("resize:80x24"));
        assert!(!recorded.iter().any(|op| op == "write:buffered"));
        assert!(!recorded.iter().any(|op| op == "write:rejected"));
        assert!(recorded.iter().any(|op| op == "write:after"));
    }

    #[tokio::test]
    async fn queue_timeout_keeps_writer_alive_for_later_commands() {
        let operations = Arc::new(Mutex::new(Vec::new()));
        let operation_started = Arc::new(Notify::new());
        let release_operation = Arc::new(Notify::new());
        let fake = BlockingWriter {
            operations: Arc::clone(&operations),
            blocked_operation: BlockedOperation::Resize,
            operation_started: Arc::clone(&operation_started),
            release_operation: Arc::clone(&release_operation),
        };
        let timeouts = SshWriterTimeouts {
            write: Duration::from_millis(30),
            resize: Duration::from_secs(5),
            close: Duration::from_secs(1),
        };
        let (writer, worker) = spawn_ssh_writer(fake, 1, timeouts);
        let resize = tokio::spawn({
            let writer = writer.clone();
            async move { writer.resize(120, 40).await }
        });
        operation_started.notified().await;

        // The queue holds a single command, so these two writes contend for its only slot.
        let queued = tokio::spawn({
            let writer = writer.clone();
            async move { writer.write(b"queued".to_vec()).await }
        });
        tokio::task::yield_now().await;
        let overflow = writer.write(b"overflow".to_vec()).await;
        let queued = queued.await.expect("the queued write task should join");

        let mut queue_timeouts = 0;
        for outcome in [&overflow, &queued] {
            if let Err(SessionError::WriteFailed(message)) = outcome {
                if message.contains("queue timeout") {
                    queue_timeouts += 1;
                }
            }
        }
        assert_eq!(
            queue_timeouts, 1,
            "exactly one write must fail waiting for the full queue"
        );
        assert!(
            writer.is_running(),
            "a queue timeout must not retire the SSH write channel"
        );

        release_operation.notify_one();
        resize
            .await
            .expect("resize task should join")
            .expect("blocking resize should complete");
        drop(writer);
        worker.await.expect("writer worker should join");

        assert_eq!(*operations.lock().await, vec!["resize:120x40", "close"]);
    }
}
