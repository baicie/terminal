use async_trait::async_trait;
use russh::ChannelMsg;
use std::time::Duration;

#[cfg(test)]
use std::collections::VecDeque;

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
    request_timeout: Duration,
) -> Result<(), SessionError> {
    request_with_confirmation(
        channel,
        ShellRequest::Pty { cols, rows },
        "request SSH PTY",
        request_timeout,
    )
    .await?;

    for (name, value) in environment {
        channel
            .send_request(ShellRequest::Env {
                name: name.clone(),
                value: value.clone(),
            })
            .await
            .map_err(|error| {
                SessionError::ChannelError(format!("set SSH environment failed: {error}"))
            })?;
    }

    if agent_forwarding {
        request_with_confirmation(
            channel,
            ShellRequest::AgentForward,
            "request SSH agent forwarding",
            request_timeout,
        )
        .await?;
    }

    request_with_confirmation(
        channel,
        ShellRequest::Shell,
        "request SSH shell",
        request_timeout,
    )
    .await
}

async fn request_with_confirmation<C: ShellChannel>(
    channel: &mut C,
    request: ShellRequest,
    operation: &'static str,
    request_timeout: Duration,
) -> Result<(), SessionError> {
    tokio::time::timeout(request_timeout.max(Duration::from_millis(1)), async {
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
    .map_err(|_| {
        SessionError::ChannelError(format!(
            "{operation} timed out after {} ms",
            request_timeout.as_millis()
        ))
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct FakeShellChannel {
        requests: Mutex<Vec<ShellRequest>>,
        replies: VecDeque<Option<ChannelMsg>>,
        stall_send: bool,
        stall_reply: bool,
    }

    impl FakeShellChannel {
        fn with_replies(replies: impl IntoIterator<Item = Option<ChannelMsg>>) -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                replies: replies.into_iter().collect(),
                stall_send: false,
                stall_reply: false,
            }
        }

        fn stalled_reply() -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                replies: VecDeque::new(),
                stall_send: false,
                stall_reply: true,
            }
        }

        fn stalled_send() -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                replies: VecDeque::new(),
                stall_send: true,
                stall_reply: false,
            }
        }
    }

    #[async_trait]
    impl ShellChannel for FakeShellChannel {
        async fn send_request(&self, request: ShellRequest) -> Result<(), String> {
            self.requests.lock().expect("request mutex").push(request);
            if self.stall_send {
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
            Duration::from_secs(1),
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
            Duration::from_secs(1),
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
            Duration::from_secs(1),
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
            Duration::from_secs(1),
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
            Duration::from_millis(5),
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
                Duration::from_millis(5),
            ),
        )
        .await;

        assert!(matches!(
            result,
            Ok(Err(SessionError::ChannelError(message)))
                if message.contains("request SSH PTY") && message.contains("timed out")
        ));
    }
}
