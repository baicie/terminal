mod errors;
mod local;
mod port_forward;
mod serial;
mod sftp;
mod ssh;
mod state;
mod terminal;
mod vault;

use local::{local_disconnect, local_resize, local_shell, local_write};
use port_forward::{port_forward_list, port_forward_start, port_forward_stop};
use serial::{serial_baud_rates, serial_connect, serial_disconnect, serial_is_connected, serial_list, serial_write, serial_write_raw};
use sftp::{sftp_connect, sftp_delete, sftp_download, sftp_list, sftp_mkdir, sftp_rename, sftp_upload};
use ssh::{generate_ssh_key, greet, ssh_connect, ssh_connect_agent, ssh_connect_key, ssh_disconnect, ssh_execute, ssh_resize, ssh_shell, ssh_write};
use state::create_shared_state;
use vault::{
    vault_change_password, vault_create, vault_delete, vault_exists, vault_get, vault_is_unlocked,
    vault_list, vault_lock, vault_set, vault_unlock,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared_state = create_shared_state();

    tauri::Builder::default()
        .manage(shared_state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            // SSH commands
            greet,
            ssh_connect,
            ssh_connect_key,
            ssh_connect_agent,
            ssh_shell,
            ssh_write,
            ssh_resize,
            ssh_disconnect,
            ssh_execute,
            generate_ssh_key,
            // Local shell commands
            local_shell,
            local_write,
            local_resize,
            local_disconnect,
            // SFTP commands
            sftp_connect,
            sftp_list,
            sftp_upload,
            sftp_download,
            sftp_mkdir,
            sftp_delete,
            sftp_rename,
            // Port forwarding commands
            port_forward_start,
            port_forward_stop,
            port_forward_list,
            // Vault commands
            vault_exists,
            vault_create,
            vault_unlock,
            vault_lock,
            vault_is_unlocked,
            vault_set,
            vault_get,
            vault_list,
            vault_delete,
            vault_change_password,
            // Serial commands
            serial_list,
            serial_baud_rates,
            serial_connect,
            serial_write,
            serial_write_raw,
            serial_is_connected,
            serial_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
