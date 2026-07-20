use crate::import::DraftEntry;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use walkdir::{DirEntry, WalkDir};

const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "vendor",
    ".next",
    "venv",
    "__pycache__",
];
const EXTS: &[&str] = &[
    "ts", "js", "tsx", "jsx", "py", "rs", "go", "java", "kt", "rb", "php", "cs",
];
const NAME_MARKERS: &[&str] = &[
    "route",
    "controller",
    "handler",
    "api",
    "endpoint",
    "urls",
    "views",
];
const CONTENT_MARKERS: &[&str] = &[
    "@app.route",
    "@router.",
    "router.get",
    "router.post",
    "app.get(",
    "app.post(",
    "@GetMapping",
    "@RequestMapping",
    "#[get(",
    "#[post(",
    "http.HandleFunc",
    "resources :",
    "Route::",
];
const MAX_BATCH_BYTES: usize = 120 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanHit {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub files: Vec<ScanHit>,
    pub truncated: bool,
}

fn is_skipped_dir(e: &DirEntry) -> bool {
    e.file_type().is_dir()
        && e.file_name()
            .to_str()
            .map(|n| SKIP_DIRS.contains(&n))
            .unwrap_or(false)
}

pub fn scan_source(dir: &Path, cap: usize) -> ScanResult {
    let mut files = Vec::new();
    let mut truncated = false;
    for entry in WalkDir::new(dir)
        .into_iter()
        .filter_entry(|e| !is_skipped_dir(e))
    {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let ext_ok = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| EXTS.contains(&e))
            .unwrap_or(false);
        if !ext_ok {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        let name_hit = NAME_MARKERS.iter().find(|m| stem.contains(*m));

        let reason = if let Some(m) = name_hit {
            format!("filename: {m}")
        } else {
            let Ok(content) = std::fs::read_to_string(path) else {
                continue;
            };
            match CONTENT_MARKERS.iter().find(|m| content.contains(*m)) {
                Some(m) => format!("marker: {m}"),
                None => continue,
            }
        };

        if files.len() >= cap {
            truncated = true;
            break;
        }
        files.push(ScanHit {
            path: path.display().to_string(),
            reason,
        });
    }
    ScanResult { files, truncated }
}

#[tauri::command]
pub fn ai_scan(dir: String) -> Result<ScanResult, String> {
    let p = Path::new(&dir);
    if !p.is_dir() {
        return Err(format!("not a directory: {dir}"));
    }
    Ok(scan_source(p, usize::MAX))
}

const SYSTEM_PROMPT: &str = r#"You extract HTTP API endpoints from source code. Return ONLY a JSON array, each item: {"relPath": "module/action.json", "request": {"name": "[Module] Action", "protocol": "http", "http": {"method": "POST", "url": "{{baseUrl}}/path", "headers": [], "params": [], "auth": {"type": "none"}, "body": {"type": "json", "content": "{\n  \"field\": \"example\"\n}"}, "insecure": false}}}. Infer Module from the source module, controller, route group, or parent folder. Every request name must use exactly [Module] Action. Use {{baseUrl}} as the URL prefix and a safe relative JSON relPath. For endpoints that accept a payload, generate an example JSON body with every inferable field using source examples, defaults, validators, DTOs, schemas, and types. For endpoints without a payload, use {"type":"none"}. Include query parameters in params. No prose, no markdown fences."#;

fn strip_fences(s: &str) -> &str {
    let t = s.trim();
    let t = t
        .strip_prefix("```json")
        .or_else(|| t.strip_prefix("```"))
        .unwrap_or(t);
    t.trim().strip_suffix("```").unwrap_or(t).trim()
}

fn source_batches(files: &[String], max_bytes: usize) -> Vec<String> {
    if max_bytes == 0 {
        return Vec::new();
    }
    let mut batches = Vec::new();
    let mut current = String::new();
    for file in files {
        let Ok(content) = std::fs::read_to_string(file) else {
            continue;
        };
        let section = format!("\n// ===== FILE: {file} =====\n{content}");
        let mut rest = section.as_str();
        while !rest.is_empty() {
            let room = max_bytes.saturating_sub(current.len());
            if room == 0 {
                batches.push(std::mem::take(&mut current));
                continue;
            }
            let end = if rest.len() <= room {
                rest.len()
            } else {
                rest.char_indices()
                    .map(|(i, _)| i)
                    .take_while(|i| *i <= room)
                    .last()
                    .unwrap_or(0)
            };
            if end == 0 {
                batches.push(std::mem::take(&mut current));
                continue;
            }
            current.push_str(&rest[..end]);
            rest = &rest[end..];
            if !rest.is_empty() {
                batches.push(std::mem::take(&mut current));
            }
        }
    }
    if !current.is_empty() {
        batches.push(current);
    }
    batches
}

fn merge_drafts(target: &mut Vec<DraftEntry>, incoming: Vec<DraftEntry>) {
    let mut paths: HashSet<String> = target.iter().map(|draft| draft.rel_path.clone()).collect();
    target.extend(
        incoming
            .into_iter()
            .filter(|draft| paths.insert(draft.rel_path.clone())),
    );
}

fn ensure_module_prefix(draft: &mut DraftEntry) {
    if draft.request.name.starts_with('[') {
        return;
    }
    let module = draft.rel_path.split('/').next().unwrap_or("API");
    let module = module
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ");
    draft.request.name = format!(
        "[{}] {}",
        if module.is_empty() { "API" } else { &module },
        draft.request.name
    );
}

/// Cancel flag for the in-flight generation — one generation runs at a time.
#[derive(Default)]
pub struct AiCancel(pub std::sync::atomic::AtomicBool);

#[tauri::command]
pub fn ai_generate_cancel(cancel: tauri::State<'_, AiCancel>) {
    cancel.0.store(true, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
pub async fn ai_generate(
    cancel: tauri::State<'_, AiCancel>,
    files: Vec<String>,
    endpoint: String,
    api_key: String,
    model: String,
) -> Result<Vec<DraftEntry>, String> {
    use std::sync::atomic::Ordering;
    cancel.0.store(false, Ordering::Relaxed);
    let batches = source_batches(&files, MAX_BATCH_BYTES);
    if batches.is_empty() {
        return Err("no readable source files".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let mut all_drafts = Vec::new();
    for (index, corpus) in batches.into_iter().enumerate() {
        let body = serde_json::json!({
            "model": model,
            "messages": [
                { "role": "system", "content": SYSTEM_PROMPT },
                { "role": "user", "content": corpus },
            ],
            "temperature": 0,
        });
        // A transient network error or 5xx/429 on batch N must not throw away
        // batches 1..N-1 — retry the batch a few times before giving up.
        // ponytail: cancel is checked between attempts/batches only, so an
        // in-flight request can take up to its 120s timeout to actually stop.
        let mut resp = None;
        let mut last_err = String::new();
        for attempt in 0..3u64 {
            if cancel.0.load(Ordering::Relaxed) {
                return Err("generation cancelled".into());
            }
            if attempt > 0 {
                tokio::time::sleep(std::time::Duration::from_secs(2 * attempt)).await;
            }
            match client
                .post(format!(
                    "{}/chat/completions",
                    endpoint.trim_end_matches('/')
                ))
                .header("Authorization", format!("Bearer {api_key}"))
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
            {
                Ok(r) if r.status().is_server_error() || r.status().as_u16() == 429 => {
                    last_err = format!("AI batch {} endpoint {}", index + 1, r.status());
                }
                Ok(r) => {
                    resp = Some(r);
                    break;
                }
                Err(e) => last_err = format!("AI batch {} failed: {e}", index + 1),
            }
        }
        let Some(resp) = resp else {
            return Err(last_err);
        };
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("AI batch {} failed: {e}", index + 1))?;
        if !status.is_success() {
            return Err(format!("AI batch {} endpoint {status}: {text}", index + 1));
        }
        let parsed: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("AI batch {} returned an invalid response: {e}", index + 1))?;
        let content = parsed
            .pointer("/choices/0/message/content")
            .and_then(|value| value.as_str())
            .ok_or_else(|| {
                format!(
                    "AI batch {} response missing choices[0].message.content",
                    index + 1
                )
            })?;
        let mut drafts: Vec<DraftEntry> = serde_json::from_str(strip_fences(content))
            .map_err(|e| format!("AI batch {} returned invalid JSON: {e}", index + 1))?;
        for draft in &mut drafts {
            if draft.request.protocol != "http" {
                return Err(format!(
                    "AI batch {} produced non-http request: {}",
                    index + 1,
                    draft.rel_path
                ));
            }
            ensure_module_prefix(draft);
        }
        merge_drafts(&mut all_drafts, drafts);
    }
    Ok(all_drafts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_finds_route_files_skips_junk() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("node_modules/x")).unwrap();
        std::fs::write(
            dir.path().join("node_modules/x/routes.js"),
            "app.get('/no')",
        )
        .unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/routes.ts"), "router.get('/users', h)").unwrap();
        std::fs::write(dir.path().join("src/util.ts"), "export const x = 1").unwrap();
        let r = scan_source(dir.path(), 50);
        assert_eq!(r.files.len(), 1);
        assert!(r.files[0].path.ends_with("src/routes.ts"));
    }

    #[test]
    fn scan_keeps_large_route_files_for_batching() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("routes.ts"),
            format!("router.get('/users', h);{}", "x".repeat(300 * 1024)),
        )
        .unwrap();

        let result = scan_source(dir.path(), 50);

        assert_eq!(result.files.len(), 1);
    }

    #[test]
    fn source_batches_include_every_readable_file() {
        let dir = tempfile::tempdir().unwrap();
        let files: Vec<String> = (0..3)
            .map(|i| {
                let path = dir.path().join(format!("routes-{i}.ts"));
                std::fs::write(&path, format!("marker-{i}\n{}", "x".repeat(40))).unwrap();
                path.display().to_string()
            })
            .collect();

        let batches = source_batches(&files, 80);

        assert!(batches.len() > 1);
        let corpus = batches.concat();
        for i in 0..3 {
            assert_eq!(corpus.matches(&format!("marker-{i}")).count(), 1);
        }
    }

    #[test]
    fn merge_drafts_keeps_first_relative_path() {
        let draft = |path: &str, name: &str| DraftEntry {
            rel_path: path.into(),
            request: crate::collection::Request {
                name: name.into(),
                protocol: "http".into(),
                http: None,
                grpc: None,
                ws: None,
            },
        };
        let mut target = vec![draft("auth/login.json", "[Auth] Login")];

        merge_drafts(
            &mut target,
            vec![
                draft("auth/login.json", "duplicate"),
                draft("user/ping.json", "[User] Ping me"),
            ],
        );

        assert_eq!(target.len(), 2);
        assert_eq!(target[0].request.name, "[Auth] Login");
        assert_eq!(target[1].rel_path, "user/ping.json");
    }

    #[test]
    fn missing_module_prefix_uses_relative_path_folder() {
        let mut draft = DraftEntry {
            rel_path: "user-profile/ping.json".into(),
            request: crate::collection::Request {
                name: "Ping me".into(),
                protocol: "http".into(),
                http: None,
                grpc: None,
                ws: None,
            },
        };

        ensure_module_prefix(&mut draft);

        assert_eq!(draft.request.name, "[User Profile] Ping me");
    }
}
