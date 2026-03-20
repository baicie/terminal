import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ShellOutput } from "@/service/ssh";

export interface SerialPortInfo {
  name: string;
  port_type: string;
}

export interface SerialConfig {
  name: string;
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: string;
  flowControl: string;
}

export interface SerialConnectionResult {
  success: boolean;
  message: string;
  sessionId?: string;
}

export class SerialService {
  /**
   * List available serial ports
   */
  async listPorts(): Promise<SerialPortInfo[]> {
    try {
      return await invoke<SerialPortInfo[]>("serial_list");
    } catch (error) {
      console.error("Failed to list serial ports:", error);
      return [];
    }
  }

  /**
   * Get common baud rates for UI dropdown
   */
  async getBaudRates(): Promise<number[]> {
    try {
      return await invoke<number[]>("serial_baud_rates");
    } catch (error) {
      console.error("Failed to get baud rates:", error);
      return [9600, 115200, 57600, 38400, 19200, 4800, 2400, 1200, 300];
    }
  }

  /**
   * Connect to a serial port
   */
  async connect(config: SerialConfig): Promise<SerialConnectionResult> {
    try {
      const sessionId = await invoke<string>("serial_connect", {
        name: config.name,
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        stopBits: config.stopBits,
        parity: config.parity,
        flowControl: config.flowControl,
      });
      return { success: true, message: "Connected successfully", sessionId };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Write data to serial port
   */
  async write(sessionId: string, data: string): Promise<void> {
    await invoke("serial_write", {
      sessionId,
      data,
    });
  }

  /**
   * Write raw data to serial port (without adding CR)
   */
  async writeRaw(sessionId: string, data: string): Promise<void> {
    await invoke("serial_write_raw", {
      sessionId,
      data,
    });
  }

  /**
   * Check if serial port is still connected
   */
  async isConnected(sessionId: string): Promise<boolean> {
    try {
      return await invoke<boolean>("serial_is_connected", { sessionId });
    } catch {
      return false;
    }
  }

  /**
   * Disconnect from serial port
   */
  async disconnect(sessionId: string): Promise<void> {
    await invoke("serial_disconnect", { sessionId });
  }

  /**
   * Listen for serial data events
   */
  async onData(callback: (output: ShellOutput) => void): Promise<UnlistenFn> {
    return listen<ShellOutput>("serial-data", (event) => {
      callback(event.payload);
    });
  }

  /**
   * Listen for serial close events
   */
  async onClose(callback: (sessionId: string) => void): Promise<UnlistenFn> {
    return listen<string>("serial-close", (event) => {
      callback(event.payload);
    });
  }
}

export const serialService = new SerialService();
