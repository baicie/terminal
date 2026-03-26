//! SSH Agent Protocol Implementation
//!
//! This module implements the SSH Agent protocol for communicating with ssh-agent.
//! The protocol is documented in RFC 4716 and OpenSSH documentation.

#[cfg(unix)]
use anyhow::{anyhow, Result};
#[cfg(unix)]
use bytes::{Buf, BufMut, Bytes, BytesMut};
#[cfg(unix)]
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::net::UnixStream;
#[cfg(unix)]
use std::path::Path;

/// SSH Agent message types
#[derive(Debug, Clone, Copy)]
#[repr(u8)]
#[allow(dead_code)]
pub enum AgentMessageType {
    RequestIdentities = 11,
    SignRequest = 13,
    SignResponse = 14,
    IdentitiesAnswer = 12,
    Failure = 5,
    Success = 6,
    Extension = 27,
    AddIdentity = 17,
    RemoveIdentity = 18,
    RemoveAllIdentities = 19,
    AddIdConstrained = 25,
    AddSmartcardKey = 20,
    RemoveSmartcardKey = 21,
    Lock = 22,
    Unlock = 23,
    ExtensionRequest = 28,
}

#[cfg(unix)]
#[allow(dead_code)]
impl AgentMessageType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            11 => Some(Self::RequestIdentities),
            12 => Some(Self::IdentitiesAnswer),
            13 => Some(Self::SignRequest),
            14 => Some(Self::SignResponse),
            5 => Some(Self::Failure),
            6 => Some(Self::Success),
            27 => Some(Self::Extension),
            17 => Some(Self::AddIdentity),
            18 => Some(Self::RemoveIdentity),
            19 => Some(Self::RemoveAllIdentities),
            25 => Some(Self::AddIdConstrained),
            20 => Some(Self::AddSmartcardKey),
            21 => Some(Self::RemoveSmartcardKey),
            22 => Some(Self::Lock),
            23 => Some(Self::Unlock),
            28 => Some(Self::ExtensionRequest),
            _ => None,
        }
    }
}

/// Represents a public key from the agent
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct AgentPublicKey {
    pub key_blob: Vec<u8>,
    pub comment: String,
}

/// SSH Agent client for communicating with ssh-agent
#[allow(dead_code)]
#[cfg(unix)]
pub struct SshAgentClient {
    stream: UnixStream,
}

#[allow(dead_code)]
#[cfg(unix)]
impl SshAgentClient {
    /// Connect to the SSH agent via socket path
    pub fn connect(socket_path: &Path) -> Result<Self> {
        let stream = UnixStream::connect(socket_path)?;
        Ok(Self { stream })
    }

    /// Request all identities from the agent
    pub fn request_identities(&mut self) -> Result<Vec<AgentPublicKey>> {
        // Build request: length (4 bytes) + message type (1 byte)
        let msg_type = AgentMessageType::RequestIdentities as u8;
        let length: u32 = 1;

        // Send request
        let mut request = BytesMut::with_capacity(4 + 1);
        request.put_u32(length);
        request.put_u8(msg_type);

        self.stream.write_all(&request)?;
        self.stream.flush()?;

        // Read response
        let response = self.read_message()?;

        if response.is_empty() {
            return Err(anyhow!("Empty response from agent"));
        }

        let msg_type = response[0];
        let body = &response[1..];

        match AgentMessageType::from_u8(msg_type) {
            Some(AgentMessageType::IdentitiesAnswer) => {
                self.parse_identities_answer(body)
            }
            Some(AgentMessageType::Failure) => {
                Err(anyhow!("Agent returned failure"))
            }
            _ => Err(anyhow!("Unexpected message type: {}", msg_type)),
        }
    }

    /// Sign data using a key from the agent
    pub fn sign_request(
        &mut self,
        key_blob: &[u8],
        data: &[u8],
        flags: u32,
    ) -> Result<Vec<u8>> {
        // Build sign request
        let mut body = BytesMut::new();

        // Key blob
        body.put_u32(key_blob.len() as u32);
        body.put(key_blob);

        // Data to sign
        body.put_u32(data.len() as u32);
        body.put(data);

        // Flags
        body.put_u32(flags);

        // Build full message
        let msg_type = AgentMessageType::SignRequest as u8;
        let length = 1 + body.len() as u32;

        let mut request = BytesMut::with_capacity(4 + length as usize);
        request.put_u32(length);
        request.put_u8(msg_type);
        request.put(body);

        self.stream.write_all(&request)?;
        self.stream.flush()?;

        // Read response
        let response = self.read_message()?;

        if response.is_empty() {
            return Err(anyhow!("Empty response from agent"));
        }

        let msg_type = response[0];
        let body = &response[1..];

        match AgentMessageType::from_u8(msg_type) {
            Some(AgentMessageType::SignResponse) => {
                // Parse signature response
                let mut buf = Bytes::copy_from_slice(body);
                let sig_len = buf.get_u32() as usize;
                if sig_len > body.len() - 4 {
                    return Err(anyhow!("Invalid signature length"));
                }
                let signature = buf.copy_to_bytes(sig_len).to_vec();
                Ok(signature)
            }
            Some(AgentMessageType::Failure) => {
                Err(anyhow!("Agent failed to sign data"))
            }
            _ => Err(anyhow!("Unexpected message type: {}", msg_type)),
        }
    }

    /// Read a message from the agent
    fn read_message(&mut self) -> Result<Vec<u8>> {
        // Read length (4 bytes)
        let mut length_buf = [0u8; 4];
        self.stream.read_exact(&mut length_buf)?;
        let length = u32::from_be_bytes(length_buf) as usize;

        if length == 0 || length > 256 * 1024 {
            return Err(anyhow!("Invalid message length: {}", length));
        }

        // Read message body
        let mut body = vec![0u8; length];
        self.stream.read_exact(&mut body)?;

        Ok(body)
    }

    /// Parse identities answer message
    fn parse_identities_answer(&self, body: &[u8]) -> Result<Vec<AgentPublicKey>> {
        let mut buf = Bytes::copy_from_slice(body);

        // Number of keys
        let num_keys = buf.get_u32() as usize;

        let mut keys = Vec::with_capacity(num_keys);

        for _ in 0..num_keys {
            // Key blob length
            let key_len = buf.get_u32() as usize;
            if key_len > buf.remaining() {
                return Err(anyhow!("Invalid key blob length"));
            }

            // Key blob
            let key_blob = buf.copy_to_bytes(key_len).to_vec();

            // Comment
            let comment_len = buf.get_u32() as usize;
            if comment_len > buf.remaining() {
                return Err(anyhow!("Invalid comment length"));
            }
            let comment = String::from_utf8_lossy(&buf.copy_to_bytes(comment_len)).to_string();

            keys.push(AgentPublicKey {
                key_blob,
                comment,
            });
        }

        Ok(keys)
    }
}

/// Get the SSH_AUTH_SOCK path from environment
#[allow(dead_code)]
pub fn get_auth_sock() -> Option<String> {
    #[cfg(unix)]
    {
        std::env::var("SSH_AUTH_SOCK").ok()
    }
    #[cfg(not(unix))]
    {
        None
    }
}
