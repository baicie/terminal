use russh::client::*;
use russh::*;
use russh_keys::*;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;

#[tokio::main]
async fn main() {
    // 配置客户端
    let config = Arc::new(client::Config {
        keys: vec![],
        ..Default::default()
    });

    // 创建SSH客户端会话
    let client = MyClient {};
    let mut session = client::connect(config, "127.0.0.1:22", client)
        .await
        .unwrap();

    // 使用macOS用户名和密码进行身份验证
    session
        .authenticate_password("your_mac_username", "your_mac_password")
        .await
        .unwrap();

    // 检查是否成功认证
    if session.is_authenticated() {
        let mut channel = session.channel_open_session().await.unwrap();

        // 在终端上执行命令，例如 `ls`
        channel.exec(true, "ls").await.unwrap();

        // 读取并输出命令结果
        let mut output = Vec::new();
        channel.read_to_end(&mut output).await.unwrap();
        println!("Output: {}", String::from_utf8_lossy(&output));

        // 关闭通道
        channel.close().await.unwrap();
    } else {
        println!("Authentication failed.");
    }
}

// 定义客户端结构体
struct MyClient {}

impl client::Handler for MyClient {
    type Error = anyhow::Error;
    type FutureUnit = futures::future::Ready<Result<(Self, Session), anyhow::Error>>;
    type FutureBool = futures::future::Ready<Result<(Self, bool), anyhow::Error>>;

    // 当连接成功时会调用此方法
    fn finished(self, session: Session) -> Self::FutureUnit {
        futures::future::ready(Ok((self, session)))
    }
}
