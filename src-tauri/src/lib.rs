mod terminal;
mod vault;

use terminal::{
    create_shared_state, greet, local_disconnect, local_resize, local_shell, local_write,
    ssh_connect, ssh_connect_agent, ssh_connect_key, ssh_disconnect, ssh_execute, ssh_resize,
    ssh_shell, ssh_write, sftp_connect, sftp_delete, sftp_download, sftp_list, sftp_mkdir,
    sftp_rename, sftp_upload, port_forward_start, port_forward_stop, port_forward_list,
};
use vault::{
    vault_exists, vault_create, vault_unlock, vault_lock, vault_is_unlocked,
    vault_set, vault_get, vault_list, vault_delete, vault_change_password,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared_state = create_shared_state();

    tauri::Builder::default()
        .manage(shared_state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            ssh_connect,
            ssh_connect_key,
            ssh_connect_agent,
            ssh_shell,
            ssh_write,
            ssh_resize,
            ssh_disconnect,
            ssh_execute,
            local_shell,
            local_write,
            local_resize,
            local_disconnect,
            sftp_connect,
            sftp_list,
            sftp_upload,
            sftp_download,
            sftp_mkdir,
            sftp_delete,
            sftp_rename,
            port_forward_start,
            port_forward_stop,
            port_forward_list,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
