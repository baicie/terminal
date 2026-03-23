import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Host, PortForwardConfig } from "@/types";
import { addCommandHistory, addConnectionLog } from "@/service/database";

export interface SSHConnectionResult {
  success: boolean;
  message: string;
  sessionId?: string;
}

export interface SSHOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ShellOutput {
  session_id: string;
  data: string;
  is_stderr: boolean;
}

// Active connection log tracking
const activeConnectionLogs = new Map<string, { logId: string; startTime: number }>();

export class SSHService {
  async connect(host: Host): Promise<SSHConnectionResult> {
    try {
      // Check if this host uses a jump host
      if (host.jumpHostId) {
        return { success: false, message: "Jump host connection requires special setup" };
      }

      if (host.authType === "password") {
        const sessionId = await invoke<string>("ssh_connect", {
          host: host.hostname,
          port: host.port,
          username: host.username,
          password: host.password,
        });
        return { success: true, message: "Connected successfully", sessionId };
      } else if (host.authType === "key") {
        const sessionId = await invoke<string>("ssh_connect_key", {
          host: host.hostname,
          port: host.port,
          username: host.username,
          privateKey: host.privateKey,
          password: host.password,
        });
        return { success: true, message: "Connected successfully", sessionId };
      } else if (host.authType === "agent") {
        const sessionId = await invoke<string>("ssh_connect_agent", {
          host: host.hostname,
          port: host.port,
          username: host.username,
        });
        return { success: true, message: "Connected successfully", sessionId };
      }
      return { success: false, message: "Unsupported auth type" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Start shell and record connection log
   */
  async startShell(
    sessionId: string,
    cols: number = 80,
    rows: number = 24,
    hostInfo?: { id?: string; name: string; hostname: string; username: string }
  ): Promise<SSHConnectionResult> {
    try {
      await invoke("ssh_shell", {
        sessionId,
        cols,
        rows,
      });

      // Record connection log
      if (hostInfo) {
        const logId = await addConnectionLog({
          host_id: hostInfo.id || null,
          host_name: hostInfo.name,
          host_address: hostInfo.hostname,
          username: hostInfo.username,
          connection_type: "ssh",
          started_at: Date.now(),
          ended_at: null,
          duration_seconds: null,
          is_saved: 0,
          notes: null,
        });
        activeConnectionLogs.set(sessionId, { logId, startTime: Date.now() });
      }

      return { success: true, message: "Shell started" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async write(sessionId: string, data: string): Promise<void> {
    await invoke("ssh_write", {
      sessionId,
      data,
    });
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await invoke("ssh_resize", {
      sessionId,
      cols,
      rows,
    });
  }

  async disconnect(sessionId: string): Promise<void> {
    await invoke("ssh_disconnect", { sessionId });
    // Update connection log with end time
    const logInfo = activeConnectionLogs.get(sessionId);
    if (logInfo) {
      const endTime = Date.now();
      const durationSeconds = Math.round((endTime - logInfo.startTime) / 1000);
      await import("@/service/database").then(({ updateConnectionLog }) => {
        updateConnectionLog(logInfo.logId, {
          ended_at: endTime,
          duration_seconds: durationSeconds,
        });
      });
      activeConnectionLogs.delete(sessionId);
    }
  }

  async execute(
    host: Host,
    command: string
  ): Promise<SSHOutput> {
    try {
      if (host.authType === "password") {
        const stdout = await invoke<string>("ssh_execute", {
          host: host.hostname,
          port: host.port,
          username: host.username,
          password: host.password,
          command,
        });
        return { stdout, stderr: "", exitCode: 0 };
      } else if (host.authType === "key") {
        const stdout = await invoke<string>("ssh_execute", {
          host: host.hostname,
          port: host.port,
          username: host.username,
          password: host.password,
          command,
        });
        return { stdout, stderr: "", exitCode: 0 };
      } else if (host.authType === "agent") {
        const stdout = await invoke<string>("ssh_execute", {
          host: host.hostname,
          port: host.port,
          username: host.username,
          password: "",
          command,
        });
        return { stdout, stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "Unsupported auth type", exitCode: 1 };
    } catch (error) {
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      };
    }
  }

  async onData(callback: (output: ShellOutput) => void): Promise<UnlistenFn> {
    return listen<ShellOutput>("ssh-data", (event) => {
      callback(event.payload);
    });
  }

  async onClose(callback: (sessionId: string) => void): Promise<UnlistenFn> {
    return listen<string>("ssh-close", (event) => {
      callback(event.payload);
    });
  }

  async onExit(callback: (sessionId: string, exitCode: number) => void): Promise<UnlistenFn> {
    return listen<[string, number]>("ssh-exit", (event) => {
      const [sessionId, exitCode] = event.payload;
      callback(sessionId, exitCode);
    });
  }

  // Local terminal methods

  async startLocalShell(
    cols: number = 80,
    rows: number = 24
  ): Promise<SSHConnectionResult> {
    try {
      const sessionId = await invoke<string>("local_shell", {
        cols,
        rows,
      });
      return { success: true, message: "Local shell started", sessionId };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async writeLocal(sessionId: string, data: string): Promise<void> {
    await invoke("local_write", {
      sessionId,
      data,
    });
  }

  async resizeLocal(sessionId: string, cols: number, rows: number): Promise<void> {
    await invoke("local_resize", {
      sessionId,
      cols,
      rows,
    });
  }

  async disconnectLocal(sessionId: string): Promise<void> {
    await invoke("local_disconnect", { sessionId });
  }

  async onLocalData(callback: (output: ShellOutput) => void): Promise<UnlistenFn> {
    return listen<ShellOutput>("local-data", (event) => {
      callback(event.payload);
    });
  }

  async onLocalClose(callback: (sessionId: string) => void): Promise<UnlistenFn> {
    return listen<string>("local-close", (event) => {
      callback(event.payload);
    });
  }

  // SFTP methods

  async sftpConnect(sessionId: string): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke("sftp_connect", { sessionId });
      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async sftpList(sessionId: string, path: string): Promise<{ success: boolean; files?: FileItem[]; message?: string }> {
    try {
      const files = await invoke<FileItem[]>("sftp_list", { sessionId, path });
      return { success: true, files };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async sftpUpload(sessionId: string, localPath: string, remotePath: string): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke("sftp_upload", { sessionId, localPath, remotePath });
      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async sftpDownload(sessionId: string, remotePath: string, localPath: string): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke("sftp_download", { sessionId, remotePath, localPath });
      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async sftpMkdir(sessionId: string, path: string): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke("sftp_mkdir", { sessionId, path });
      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async sftpDelete(sessionId: string, path: string, isDirectory: boolean): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke("sftp_delete", { sessionId, path, isDirectory });
      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async sftpRename(sessionId: string, oldPath: string, newPath: string): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke("sftp_rename", { sessionId, oldPath, newPath });
      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  // Command history methods

  async saveCommandHistory(hostId: string, command: string, sessionId?: string): Promise<void> {
    try {
      await addCommandHistory({
        host_id: hostId,
        command,
        executed_at: Date.now(),
        session_id: sessionId,
      });
    } catch (error) {
      console.error("Failed to save command history:", error);
    }
  }

  // Port forward methods

  async portForwardStart(sessionId: string, config: PortForwardConfig): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke("port_forward_start", { sessionId, config });
      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async portForwardStop(forwardId: string): Promise<{ success: boolean; message?: string }> {
    try {
      await invoke("port_forward_stop", { forwardId });
      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async portForwardList(): Promise<string[]> {
    try {
      return await invoke<string[]>("port_forward_list");
    } catch (error) {
      console.error("Failed to list port forwards:", error);
      return [];
    }
  }
}

export interface FileItem {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  modified_time: number;
  permissions: string;
}

export const sshService = new SSHService();
