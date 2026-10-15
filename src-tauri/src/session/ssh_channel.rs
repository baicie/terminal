use async_trait::async_trait;
use russh::ChannelMsg;

#[cfg(test)]
use std::collections::VecDeque;
#[cfg(test)]
use std::time::Duration;

use super::types::SessionError;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ShellRequest {
    Pty { cols: u16, rows: u16 },
    Env { name: String, value: String },
    AgentForward,
    Shell,
}

#[async_trait]
pub(crate) trait ShellChannel: Send {
    async fn send_request(&self, request: ShellRequest) -> Result<(), String>;
    async fn next_message(&mut self) -> Option<ChannelMsg>;
}

#[async_trait]
impl ShellChannel for russh::Channel<russh::client::Msg> {
    async fn send_request(&self, request: ShellRequest) -> Result<(), String> {
        match request {
            ShellRequest::Pty { cols, rows } => self
                .request_pty(true, "xterm-256color", cols.into(), rows.into(), 0, 0, &[])
                .await
                .map_err(|error| error.to_string()),
            ShellRequest::Env { name, value } => self
                .set_env(false, name, value)
                .await
                .map_err(|error| error.to_string()),
            ShellRequest::AgentForward => self
                .agent_forward(true)
                .await
                .map_err(|error| error.to_string()),
            ShellRequest::Shell => self
                .request_shell(true)
                .await
                .map_err(|error| error.to_string()),
        }
    }

    async fn next_message(&mut self) -> Option<ChannelMsg> {
        self.wait().await
    }
}

pub(crate) async fn configure_shell_channel<C: ShellChannel>(
    channel: &mut C,
    cols: u16,
    rows: u16,
    agent_forwarding: bool,
    environment: &std::collections::HashMap<String, String>,
    request_deadline: tokio::time::Instant,
) -> Result<(), SessionError> {
    request_with_confirmation(
        channel,
        ShellRequest::Pty { cols, rows },
        "request SSH PTY",
        request_deadline,
    )
    .await?;

    for (name, value) in environment {
        send_without_confirmation(
            channel,
            ShellRequest::Env {
                name: name.clone(),
                value: value.clone(),
            },
            "set SSH environment",
            request_deadline,
        )
        .await?;
    }

    if agent_forwarding {
        request_with_confirmation(
            channel,
            ShellRequest::AgentForward,
            "request SSH agent forwarding",
            request_deadline,
        )
        .await?;
    }

    request_with_confirmation(
        channel,
        ShellRequest::Shell,
        "request SSH shell",
        request_deadline,
    )
    .await
}

async fn send_without_confirmation<C: ShellChannel>(
    channel: &C,
    request: ShellRequest,
    operation: &'static str,
    request_deadline: tokio::time::Instant,
) -> Result<(), SessionError> {
    tokio::time::timeout_at(request_deadline, channel.send_request(request))
        .await
        .map_err(|_| shell_request_timeout_error(operation))?
        .map_err(|error| SessionError::ChannelError(format!("{operation} failed: {error}")))
}

async fn request_with_confirmation<C: ShellChannel>(
    channel: &mut C,
    request: ShellRequest,
    operation: &'static str,
    request_deadline: tokio::time::Instant,
) -> Result<(), SessionError> {
    tokio::time::timeout_at(request_deadline, async {
        channel
            .send_request(request)
            .await
            .map_err(|error| SessionError::ChannelError(format!("{operation} failed: {error}")))?;
        loop {
            match channel.next_message().await {
                Some(ChannelMsg::Success) => return Ok(()),
                Some(ChannelMsg::Failure) => {
                    return Err(SessionError::ChannelError(format!(
                        "{operation} was rejected by the SSH server"
                    )))
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                    return Err(SessionError::ChannelError(format!(
                        "{operation} ended before the SSH server confirmed it"
                    )))
                }
                // Window updates are transport bookkeeping and may arrive
                // while a request reply is in flight; they are safe to skip.
                Some(ChannelMsg::WindowAdjusted { .. }) => {}
                Some(message) => {
                    return Err(SessionError::ChannelError(format!(
                        "{operation} received unexpected channel message: {message:?}"
                    )))
                }
            }
        }
    })
    .await
    .map_err(|_| shell_request_timeout_error(operation))?
}

fn shell_request_timeout_error(operation: &'static str) -> SessionError {
    SessionError::ChannelError(format!(
        "{operation} timed out before the SSH shell setup deadline"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn deadline_after(timeout: Duration) -> tokio::time::Instant {
        tokio::time::Instant::now() + timeout
    }

    struct FakeShellChannel {
        requests: Mutex<Vec<ShellRequest>>,
        replies: VecDeque<Option<ChannelMsg>>,
        send_delay: Duration,
        stall_send: bool,
        stall_environment: bool,
        stall_reply: bool,
    }

    impl FakeShellChannel {
        fn with_replies(replies: impl IntoIterator<Item = Option<ChannelMsg>>) -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                replies: replies.into_iter().collect(),
                send_delay: Duration::ZERO,
                stall_send: false,
                stall_environment: false,
                stall_reply: false,
            }
        }

        fn stalled_reply() -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                replies: VecDeque::new(),
                send_delay: Duration::ZERO,
                stall_send: false,
                stall_environment: false,
                stall_reply: true,
            }
        }

        fn stalled_send() -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                replies: VecDeque::new(),
                send_delay: Duration::ZERO,
                stall_send: true,
                stall_environment: false,
                stall_reply: false,
            }
        }

        fn stalled_environment() -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                replies: VecDeque::from([Some(ChannelMsg::Success)]),
                send_delay: Duration::ZERO,
                stall_send: false,
                stall_environment: true,
                stall_reply: false,
            }
        }

        fn delayed_send(delay: Duration) -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                replies: VecDeque::from([Some(ChannelMsg::Success), Some(ChannelMsg::Success)]),
                send_delay: delay,
                stall_send: false,
                stall_environment: false,
                stall_reply: false,
            }
        }
    }

    #[async_trait]
    impl ShellChannel for FakeShellChannel {
        async fn send_request(&self, request: ShellRequest) -> Result<(), String> {
            let should_stall = self.stall_send
                || (self.stall_environment && matches!(request, ShellRequest::Env { .. }));
            self.requests.lock().expect("request mutex").push(request);
            tokio::time::sleep(self.send_delay).await;
            if should_stall {
                std::future::pending::<()>().await;
            }
            Ok(())
        }

        async fn next_message(&mut self) -> Option<ChannelMsg> {
            if self.stall_reply {
                std::future::pending().await
            } else {
                self.replies.pop_front().flatten()
            }
        }
    }

    #[tokio::test]
    async fn shell_setup_waits_for_each_server_confirmation_in_order() {
        let mut channel = FakeShellChannel::with_replies([
            Some(ChannelMsg::Success),
            Some(ChannelMsg::Success),
            Some(ChannelMsg::Success),
        ]);

        configure_shell_channel(
            &mut channel,
            120,
            40,
            true,
            &Default::default(),
            deadline_after(Duration::from_secs(1)),
        )
        .await
        .expect("all shell requests should be confirmed");

        assert_eq!(
            *channel.requests.lock().expect("request mutex"),
            vec![
                ShellRequest::Pty {
                    cols: 120,
                    rows: 40
                },
                ShellRequest::AgentForward,
                ShellRequest::Shell,
            ]
        );
    }

    #[tokio::test]
    async fn shell_setup_sends_profile_environment_before_shell() {
        let mut channel =
            FakeShellChannel::with_replies([Some(ChannelMsg::Success), Some(ChannelMsg::Success)]);
        let environment =
            std::collections::HashMap::from([(String::from("APP_ENV"), String::from("test"))]);

        configure_shell_channel(
            &mut channel,
            80,
            24,
            false,
            &environment,
            deadline_after(Duration::from_secs(1)),
        )
        .await
        .expect("profile environment should be sent before shell");

        assert_eq!(
            *channel.requests.lock().expect("request mutex"),
            vec![
                ShellRequest::Pty { cols: 80, rows: 24 },
                ShellRequest::Env {
                    name: String::from("APP_ENV"),
                    value: String::from("test"),
                },
                ShellRequest::Shell,
            ]
        );
    }

    #[tokio::test]
    async fn shell_setup_reports_server_request_failure() {
        let mut channel = FakeShellChannel::with_replies([Some(ChannelMsg::Failure)]);

        let error = configure_shell_channel(
            &mut channel,
            80,
            24,
            false,
            &Default::default(),
            deadline_after(Duration::from_secs(1)),
        )
        .await
        .expect_err("a rejected PTY request must fail setup");

        assert!(error.to_string().contains("request SSH PTY"));
        assert!(error.to_string().contains("rejected"));
    }

    #[tokio::test]
    async fn shell_setup_does_not_drop_unconfirmed_channel_messages_silently() {
        let mut channel = FakeShellChannel::with_replies([Some(ChannelMsg::Data {
            data: bytes::Bytes::from_static(b"unexpected"),
        })]);

        let error = configure_shell_channel(
            &mut channel,
            80,
            24,
            false,
            &Default::default(),
            deadline_after(Duration::from_secs(1)),
        )
        .await
        .expect_err("unexpected output before request confirmation must fail setup");

        assert!(error.to_string().contains("unexpected channel message"));
    }

    #[tokio::test]
    async fn shell_setup_times_out_when_server_never_replies() {
        let mut channel = FakeShellChannel::stalled_reply();

        let error = configure_shell_channel(
            &mut channel,
            80,
            24,
            false,
            &Default::default(),
            deadline_after(Duration::from_millis(5)),
        )
        .await
        .expect_err("a missing request confirmation must time out");

        assert!(error.to_string().contains("timed out"));
    }

    #[tokio::test]
    async fn shell_setup_deadline_includes_sending_the_request() {
        let mut channel = FakeShellChannel::stalled_send();

        let result = tokio::time::timeout(
            Duration::from_millis(50),
            configure_shell_channel(
                &mut channel,
                80,
                24,
                false,
                &Default::default(),
                deadline_after(Duration::from_millis(5)),
            ),
        )
        .await;

        assert!(matches!(
            result,
            Ok(Err(SessionError::ChannelError(message)))
                if message.contains("request SSH PTY") && message.contains("timed out")
        ));
    }

    #[tokio::test]
    async fn shell_setup_deadline_includes_sending_profile_environment() {
        let mut channel = FakeShellChannel::stalled_environment();
        let environment =
            std::collections::HashMap::from([(String::from("APP_ENV"), String::from("test"))]);

        let result = tokio::time::timeout(
            Duration::from_millis(50),
            configure_shell_channel(
                &mut channel,
                80,
                24,
                false,
                &environment,
                deadline_after(Duration::from_millis(5)),
            ),
        )
        .await;

        assert!(matches!(
            result,
            Ok(Err(SessionError::ChannelError(message)))
                if message.contains("set SSH environment") && message.contains("timed out")
        ));
    }

    #[tokio::test]
    async fn shell_setup_stages_share_one_absolute_deadline() {
        let mut channel = FakeShellChannel::delayed_send(Duration::from_millis(30));

        let result = configure_shell_channel(
            &mut channel,
            80,
            24,
            false,
            &Default::default(),
            deadline_after(Duration::from_millis(50)),
        )
        .await;

        assert!(matches!(
            result,
            Err(SessionError::ChannelError(message))
                if message.contains("request SSH shell") && message.contains("timed out")
        ));
    }
}
