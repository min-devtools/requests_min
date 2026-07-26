mod ai;
mod collection;
mod dynamic;
mod flows;
mod github;
mod grpc;
mod http;
mod import;
mod proto_source;
mod secrets;
mod ws;

#[tauri::command]
fn ping() -> String { "pong".into() }

#[cfg(target_os = "macos")]
#[tauri::command]
async fn list_fonts() -> Result<Vec<String>, String> {
    let out = std::process::Command::new("osascript")
        .args(["-l", "JavaScript", "-e", r#"ObjC.import("AppKit"); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))"#])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).into_owned()); }
    let mut fonts: Vec<String> = serde_json::from_str(String::from_utf8_lossy(&out.stdout).trim()).map_err(|e| e.to_string())?;
    fonts.retain(|font| !font.starts_with('.'));
    fonts.sort();
    Ok(fonts)
}

/// Windows PowerShell (not pwsh — System.Drawing is not guaranteed on .NET Core)
/// enumerates installed families, one name per line. `OutputEncoding` is forced
/// to UTF-8 first: the default is the console codepage, which mangles the
/// non-ASCII family names shipped with non-English Windows.
#[cfg(target_os = "windows")]
#[tauri::command]
async fn list_fonts() -> Result<Vec<String>, String> {
    use std::os::windows::process::CommandExt;
    /// CREATE_NO_WINDOW — without it this GUI app flashes a console window per call.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("powershell.exe")
        .args(["-NoLogo", "-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).trim().to_owned()); }
    let mut fonts: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines().map(|line| line.trim().to_owned()).filter(|line| !line.is_empty()).collect();
    fonts.sort();
    fonts.dedup(); // a family installed both machine-wide and per-user is listed twice
    Ok(fonts)
}

/// Nothing to enumerate without a platform API — the picker falls back to the
/// families the webview already knows.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
async fn list_fonts() -> Result<Vec<String>, String> { Ok(Vec::new()) }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(ws::WsState::default())
        .manage(http::CookieState::default())
        .manage(ai::AiCancel::default())
        .invoke_handler(tauri::generate_handler![
            ping, list_fonts,
            collection::col_list, collection::col_create, collection::col_rename, collection::col_set_color, collection::col_delete, collection::col_reorder,
            collection::req_list, collection::req_read, collection::req_write, collection::req_delete, collection::req_move, collection::req_reorder,
            collection::env_list, collection::env_read, collection::env_write, collection::env_delete,
            secrets::secret_read, secrets::secret_write,
            http::http_request, http::cookies_for, http::cookies_clear,
            ws::ws_connect, ws::ws_send, ws::ws_close,
            grpc::grpc_describe, grpc::grpc_unary,
            proto_source::proto_source_list, proto_source::proto_source_save, proto_source::proto_source_delete,
            import::import_curl, import::import_postman, import::import_openapi,
            import::export_postman, import::export_curl, import::col_save_draft, import::col_merge_draft,
            ai::ai_scan, ai::ai_generate, ai::ai_generate_cancel,
            flows::flow_list, flows::flow_read, flows::flow_write, flows::flow_delete, flows::flow_export,
            github::gh_set_token, github::gh_status, github::gh_configure, github::gh_push, github::gh_pull
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
