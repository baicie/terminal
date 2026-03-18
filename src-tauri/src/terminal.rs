use anyhow::Result;
use russh::client::Handler;
use russh::*;
use std::sync::Arc;

struct Client;

impl Handler for Client {
    type Error = anyhow::Error;
}

#[tauri::command]
pub async fn ssh_connect(
    host: String,
    port: u16,
    username: String,
    password: String,
) -> Result<String, String> {
    let config = Arc::new(client::Config::default());
    let addr = format!("{}:{}", host, port);

    let mut handle = client::connect(config, addr, Client)
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    handle
        .authenticate_password(&username, &password)
        .await
        .map_err(|e| format!("Authentication failed: {}", e))?;

    Ok("Connected successfully".to_string())
}

#[tauri::command]
pub async fn ssh_execute(
    host: String,
    port: u16,
    username: String,
    password: String,
    command: String,
) -> Result<String, String> {
    let config = Arc::new(client::Config::default());
    let addr = format!("{}:{}", host, port);

    let mut handle = client::connect(config, addr, Client)
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    handle
        .authenticate_password(&username, &password)
        .await
        .map_err(|e| format!("Authentication failed: {}", e))?;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    channel
        .exec(false, command.as_str())
        .await
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let mut output = String::new();
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => {
                output.push_str(&String::from_utf8_lossy(&data));
            }
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => break,
            None => break,
            _ => continue,
        }
    }

    Ok(output)
}

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
