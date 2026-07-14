use crate::import::DraftEntry;
use serde::{Deserialize, Serialize};
use std::path::Path;
use walkdir::{DirEntry, WalkDir};

const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "dist", "build", "vendor", ".next", "venv", "__pycache__"];
const EXTS: &[&str] = &["ts", "js", "tsx", "jsx", "py", "rs", "go", "java", "kt", "rb", "php", "cs"];
const NAME_MARKERS: &[&str] = &["route", "controller", "handler", "api", "endpoint", "urls", "views"];
const CONTENT_MARKERS: &[&str] = &[
    "@app.route", "@router.", "router.get", "router.post", "app.get(", "app.post(",
    "@GetMapping", "@RequestMapping", "#[get(", "#[post(", "http.HandleFunc", "resources :", "Route::",
];
const MAX_FILE_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanHit { pub path: String, pub reason: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult { pub files: Vec<ScanHit>, pub truncated: bool }

fn is_skipped_dir(e: &DirEntry) -> bool {
    e.file_type().is_dir()
        && e.file_name().to_str().map(|n| SKIP_DIRS.contains(&n)).unwrap_or(false)
}

pub fn scan_source(dir: &Path, cap: usize) -> ScanResult {
    let mut files = Vec::new();
    let mut truncated = false;
    for entry in WalkDir::new(dir).into_iter().filter_entry(|e| !is_skipped_dir(e)) {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() { continue; }
        let path = entry.path();
        let ext_ok = path.extension().and_then(|e| e.to_str())
            .map(|e| EXTS.contains(&e)).unwrap_or(false);
        if !ext_ok { continue; }
        if entry.metadata().map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(true) { continue; }

        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        let name_hit = NAME_MARKERS.iter().find(|m| stem.contains(*m));

        let reason = if let Some(m) = name_hit {
            format!("filename: {m}")
        } else {
            let Ok(content) = std::fs::read_to_string(path) else { continue };
            match CONTENT_MARKERS.iter().find(|m| content.contains(*m)) {
                Some(m) => format!("marker: {m}"),
                None => continue,
            }
        };

        if files.len() >= cap { truncated = true; break; }
        files.push(ScanHit { path: path.display().to_string(), reason });
    }
    ScanResult { files, truncated }
}

#[tauri::command]
pub fn ai_scan(dir: String) -> Result<ScanResult, String> {
    let p = Path::new(&dir);
    if !p.is_dir() { return Err(format!("not a directory: {dir}")); }
    Ok(scan_source(p, 400))
}

const SYSTEM_PROMPT: &str = r#"You extract HTTP API endpoints from source code. Return ONLY a JSON array, each item: {"relPath": "folder/name.json", "request": {"name": "...", "protocol": "http", "http": {"method": "GET", "url": "{{baseUrl}}/path", "headers": [], "params": [], "auth": {"type": "none"}, "body": {"type": "json", "content": ""}}}}. Use {{baseUrl}} as the URL prefix. No prose, no markdown fences."#;

fn strip_fences(s: &str) -> &str {
    let t = s.trim();
    let t = t.strip_prefix("```json").or_else(|| t.strip_prefix("```")).unwrap_or(t);
    t.trim().strip_suffix("```").unwrap_or(t).trim()
}

#[tauri::command]
pub async fn ai_generate(files: Vec<String>, endpoint: String, api_key: String, model: String) -> Result<Vec<DraftEntry>, String> {
    // concatenate source, capped ~120 KB
    let mut corpus = String::new();
    for f in &files {
        if corpus.len() > 120 * 1024 { break; }
        if let Ok(content) = std::fs::read_to_string(f) {
            corpus.push_str(&format!("\n// ===== FILE: {f} =====\n"));
            corpus.push_str(&content);
        }
    }
    if corpus.is_empty() { return Err("no readable source files".into()); }

    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": corpus },
        ],
        "temperature": 0,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build().map_err(|e| e.to_string())?;
    let resp = client.post(format!("{}/chat/completions", endpoint.trim_end_matches('/')))
        .header("Authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json")
        .json(&body).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(format!("AI endpoint {status}: {text}")); }

    let parsed: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let content = parsed.pointer("/choices/0/message/content").and_then(|c| c.as_str())
        .ok_or("AI response missing choices[0].message.content")?;
    let json = strip_fences(content);
    let drafts: Vec<DraftEntry> = serde_json::from_str(json)
        .map_err(|e| format!("AI returned invalid JSON: {e}"))?;
    for d in &drafts {
        if d.request.protocol != "http" {
            return Err(format!("AI produced non-http request: {}", d.rel_path));
        }
    }
    Ok(drafts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_finds_route_files_skips_junk() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("node_modules/x")).unwrap();
        std::fs::write(dir.path().join("node_modules/x/routes.js"), "app.get('/no')").unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/routes.ts"), "router.get('/users', h)").unwrap();
        std::fs::write(dir.path().join("src/util.ts"), "export const x = 1").unwrap();
        let r = scan_source(dir.path(), 50);
        assert_eq!(r.files.len(), 1);
        assert!(r.files[0].path.ends_with("src/routes.ts"));
    }
}
