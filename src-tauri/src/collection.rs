use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KV { pub key: String, pub value: String, #[serde(default)] pub enabled: Option<bool> }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HttpPart {
    pub method: String,
    pub url: String,
    pub headers: Vec<KV>,
    pub path_params: Vec<KV>,
    pub params: Vec<KV>,
    pub auth: serde_json::Value,      // { "type": "none|bearer|basic|apiKey", ... }
    pub body: serde_json::Value,      // { "type": "json|text|form|none", "content": "..." }
    pub insecure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GrpcPart {
    pub endpoint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,    // → shared ProtoSource; None = legacy inline (proto_source/proto_files)
    pub proto_source: String,         // legacy: "reflection" | "files"
    pub proto_files: Vec<String>,     // legacy
    pub service: String,
    pub method: String,
    pub message: String,              // JSON text
    pub metadata: Vec<KV>,
    pub insecure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WsPart { pub url: String, pub headers: Vec<KV>, pub saved_messages: Vec<String> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub name: String,
    pub protocol: String,             // "http" | "grpc" | "ws"
    #[serde(skip_serializing_if = "Option::is_none")] pub http: Option<HttpPart>,
    #[serde(skip_serializing_if = "Option::is_none")] pub grpc: Option<GrpcPart>,
    #[serde(skip_serializing_if = "Option::is_none")] pub ws: Option<WsPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionMeta {
    pub id: String,
    pub name: String,
    #[serde(default)] pub order: Vec<String>,
    /// user-assigned identity color, drawn as the dot on every tab bound to this collection
    #[serde(default, skip_serializing_if = "Option::is_none")] pub color: Option<String>,
}

pub fn root_dir() -> PathBuf {
    std::env::var("REQUESTS_MIN_HOME").map(PathBuf::from)
        .unwrap_or_else(|_| dirs::home_dir().expect("no home dir").join("RequestsMin"))
}
pub fn collections_dir() -> PathBuf { root_dir().join("collections") }
pub fn environments_dir() -> PathBuf { root_dir().join("environments") }

fn sort_value(v: &serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::Object(m) => {
            let mut sorted: Vec<_> = m.iter().collect();
            sorted.sort_by(|a, b| a.0.cmp(b.0));
            serde_json::Value::Object(sorted.into_iter().map(|(k, v)| (k.clone(), sort_value(v))).collect())
        }
        serde_json::Value::Array(a) => serde_json::Value::Array(a.iter().map(sort_value).collect()),
        other => other.clone(),
    }
}

pub fn write_sorted_json(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let mut s = serde_json::to_string_pretty(&sort_value(value)).map_err(|e| e.to_string())?;
    s.push('\n');
    std::fs::write(path, s).map_err(|e| e.to_string())
}

pub fn interpolate(text: &str, ctx: &HashMap<String, String>) -> Result<String, String> {
    let mut out = String::with_capacity(text.len());
    let mut missing: Vec<String> = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        match rest[start + 2..].find("}}") {
            Some(end) => {
                let name = rest[start + 2..start + 2 + end].trim();
                match ctx.get(name) {
                    Some(v) => out.push_str(v),
                    None => missing.push(name.to_string()),
                }
                rest = &rest[start + 2 + end + 2..];
            }
            None => { out.push_str(&rest[start..]); rest = ""; }
        }
    }
    out.push_str(rest);
    if missing.is_empty() { Ok(out) } else { Err(format!("missing variables: {}", missing.join(", "))) }
}

pub fn build_ctx(env_vars: HashMap<String, String>, secrets: HashMap<String, String>) -> HashMap<String, String> {
    let mut ctx = env_vars;
    ctx.extend(secrets); // secrets overwrite env
    ctx
}

// ---- collection / request / env file operations (pure; root passed in) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReqEntry { pub rel_path: String, pub name: String, pub protocol: String, pub method: String }

fn col_path(root: &Path, id: &str) -> PathBuf { root.join("collections").join(id) }

/// Join `rel` onto `base`, rejecting anything that escapes `base` (`..`, absolute).
fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.starts_with('/') || rel.starts_with('\\') { return Err("path must be relative".into()); }
    let mut p = base.to_path_buf();
    for comp in Path::new(rel).components() {
        use std::path::Component::*;
        match comp {
            Normal(c) => p.push(c),
            CurDir => {}
            _ => return Err(format!("invalid path: {rel}")),
        }
    }
    Ok(p)
}

pub fn create_collection(root: &Path, name: &str) -> Result<CollectionMeta, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let meta = CollectionMeta { id: id.clone(), name: name.to_string(), order: vec![], color: None };
    let dir = col_path(root, &id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_sorted_json(&dir.join("collection.json"), &serde_json::to_value(&meta).map_err(|e| e.to_string())?)?;
    Ok(meta)
}

pub fn list_collections(root: &Path) -> Result<Vec<CollectionMeta>, String> {
    let base = root.join("collections");
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(&base) { Ok(r) => r, Err(_) => return Ok(out) };
    for entry in rd.flatten() {
        if !entry.path().is_dir() { continue; }
        let mf = entry.path().join("collection.json");
        if let Ok(text) = std::fs::read_to_string(&mf) {
            if let Ok(meta) = serde_json::from_str::<CollectionMeta>(&text) { out.push(meta); }
        }
    }
    let order: Vec<String> = std::fs::read_to_string(base.join("order.json"))
        .ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
    out.sort_by(|a, b| {
        let ai = order.iter().position(|id| id == &a.id).unwrap_or(usize::MAX);
        let bi = order.iter().position(|id| id == &b.id).unwrap_or(usize::MAX);
        ai.cmp(&bi).then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
}

pub fn reorder_collections(root: &Path, order: &[String]) -> Result<(), String> {
    write_sorted_json(&root.join("collections/order.json"), &serde_json::to_value(order).map_err(|e| e.to_string())?)
}

pub fn rename_collection(root: &Path, id: &str, name: &str) -> Result<(), String> {
    let mf = col_path(root, id).join("collection.json");
    let text = std::fs::read_to_string(&mf).map_err(|e| e.to_string())?;
    let mut meta: CollectionMeta = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    meta.name = name.to_string();
    write_sorted_json(&mf, &serde_json::to_value(&meta).map_err(|e| e.to_string())?)
}

pub fn set_collection_color(root: &Path, id: &str, color: Option<String>) -> Result<(), String> {
    let mf = col_path(root, id).join("collection.json");
    let text = std::fs::read_to_string(&mf).map_err(|e| e.to_string())?;
    let mut meta: CollectionMeta = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    meta.color = color;
    write_sorted_json(&mf, &serde_json::to_value(&meta).map_err(|e| e.to_string())?)
}

pub fn delete_collection(root: &Path, id: &str) -> Result<(), String> {
    let dir = col_path(root, id);
    if dir.exists() { std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?; }
    // drop matching secrets too (they live outside collections/)
    let sdir = root.join("secrets").join(id);
    if sdir.exists() { let _ = std::fs::remove_dir_all(&sdir); }
    Ok(())
}

pub fn list_requests(root: &Path, id: &str) -> Result<Vec<ReqEntry>, String> {
    let base = col_path(root, id);
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(&base).into_iter().flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let rel = path.strip_prefix(&base).map_err(|e| e.to_string())?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if rel_str == "collection.json" || rel_str.starts_with("environments/") { continue; }
        if !rel_str.ends_with(".json") { continue; }
        let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let req: Request = serde_json::from_str(&text).map_err(|e| format!("{rel_str}: {e}"))?;
        let method = match req.protocol.as_str() {
            "http" => req.http.as_ref().map(|h| h.method.clone()).unwrap_or_else(|| "HTTP".into()),
            "grpc" => "RPC".into(),
            "ws" => "WS".into(),
            other => other.to_uppercase(),
        };
        out.push(ReqEntry { rel_path: rel_str, name: req.name, protocol: req.protocol, method });
    }
    let order = std::fs::read_to_string(base.join("collection.json")).ok()
        .and_then(|text| serde_json::from_str::<CollectionMeta>(&text).ok())
        .map(|meta| meta.order).unwrap_or_default();
    out.sort_by(|a, b| {
        let ai = order.iter().position(|path| path == &a.rel_path).unwrap_or(usize::MAX);
        let bi = order.iter().position(|path| path == &b.rel_path).unwrap_or(usize::MAX);
        ai.cmp(&bi).then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    Ok(out)
}

pub fn reorder_requests(root: &Path, id: &str, order: &[String]) -> Result<(), String> {
    let mf = col_path(root, id).join("collection.json");
    let text = std::fs::read_to_string(&mf).map_err(|e| e.to_string())?;
    let mut meta: CollectionMeta = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    meta.order = order.to_vec();
    write_sorted_json(&mf, &serde_json::to_value(meta).map_err(|e| e.to_string())?)
}

pub fn read_request(root: &Path, id: &str, rel_path: &str) -> Result<Request, String> {
    let p = safe_join(&col_path(root, id), rel_path)?;
    let text = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

pub fn write_request(root: &Path, id: &str, rel_path: &str, request: &Request) -> Result<(), String> {
    let p = safe_join(&col_path(root, id), rel_path)?;
    write_sorted_json(&p, &serde_json::to_value(request).map_err(|e| e.to_string())?)
}

pub fn delete_request(root: &Path, id: &str, rel_path: &str) -> Result<(), String> {
    let p = safe_join(&col_path(root, id), rel_path)?;
    if p.exists() { std::fs::remove_file(&p).map_err(|e| e.to_string())?; }
    Ok(())
}

pub fn move_request(root: &Path, id: &str, from: &str, to: &str) -> Result<(), String> {
    let src = safe_join(&col_path(root, id), from)?;
    let dst = safe_join(&col_path(root, id), to)?;
    if let Some(parent) = dst.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    std::fs::rename(&src, &dst).map_err(|e| e.to_string())
}

fn env_path(root: &Path, env: &str) -> Result<PathBuf, String> {
    safe_join(&root.join("environments"), &format!("{env}.json"))
}

pub fn list_envs(root: &Path) -> Result<Vec<String>, String> {
    let dir = root.join("environments");
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(&dir) { Ok(r) => r, Err(_) => return Ok(out) };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(stem) = name.strip_suffix(".json") { out.push(stem.to_string()); }
    }
    out.sort();
    Ok(out)
}

pub fn read_env(root: &Path, env: &str) -> Result<HashMap<String, String>, String> {
    let p = env_path(root, env)?;
    let text = match std::fs::read_to_string(&p) { Ok(t) => t, Err(_) => return Ok(HashMap::new()) };
    let val: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(serde_json::from_value(val.get("vars").cloned().unwrap_or_default()).unwrap_or_default())
}

pub fn write_env(root: &Path, env: &str, vars: &HashMap<String, String>) -> Result<(), String> {
    let p = env_path(root, env)?;
    write_sorted_json(&p, &serde_json::json!({ "vars": vars }))
}

pub fn delete_env(root: &Path, env: &str) -> Result<(), String> {
    let p = env_path(root, env)?;
    if p.exists() { std::fs::remove_file(&p).map_err(|e| e.to_string())?; }
    Ok(())
}

// ---- Tauri command wrappers (resolve root_dir themselves) ----

#[tauri::command]
pub fn col_list() -> Result<Vec<CollectionMeta>, String> { list_collections(&root_dir()) }
#[tauri::command]
pub fn col_create(name: String) -> Result<CollectionMeta, String> { create_collection(&root_dir(), &name) }
#[tauri::command]
pub fn col_rename(id: String, name: String) -> Result<(), String> { rename_collection(&root_dir(), &id, &name) }
#[tauri::command]
pub fn col_set_color(id: String, color: Option<String>) -> Result<(), String> { set_collection_color(&root_dir(), &id, color) }
#[tauri::command]
pub fn col_delete(id: String) -> Result<(), String> { delete_collection(&root_dir(), &id) }
#[tauri::command]
pub fn col_reorder(order: Vec<String>) -> Result<(), String> { reorder_collections(&root_dir(), &order) }
#[tauri::command]
pub fn req_list(collection_id: String) -> Result<Vec<ReqEntry>, String> { list_requests(&root_dir(), &collection_id) }
#[tauri::command]
pub fn req_read(collection_id: String, rel_path: String) -> Result<Request, String> { read_request(&root_dir(), &collection_id, &rel_path) }
#[tauri::command]
pub fn req_write(collection_id: String, rel_path: String, request: Request) -> Result<(), String> { write_request(&root_dir(), &collection_id, &rel_path, &request) }
#[tauri::command]
pub fn req_delete(collection_id: String, rel_path: String) -> Result<(), String> { delete_request(&root_dir(), &collection_id, &rel_path) }
#[tauri::command]
pub fn req_move(collection_id: String, from: String, to: String) -> Result<(), String> { move_request(&root_dir(), &collection_id, &from, &to) }
#[tauri::command]
pub fn req_reorder(collection_id: String, order: Vec<String>) -> Result<(), String> { reorder_requests(&root_dir(), &collection_id, &order) }
#[tauri::command]
pub fn env_list() -> Result<Vec<String>, String> { list_envs(&root_dir()) }
#[tauri::command]
pub fn env_read(env: String) -> Result<HashMap<String, String>, String> { read_env(&root_dir(), &env) }
#[tauri::command]
pub fn env_write(env: String, vars: HashMap<String, String>) -> Result<(), String> { write_env(&root_dir(), &env, &vars) }
#[tauri::command]
pub fn env_delete(env: String) -> Result<(), String> { delete_env(&root_dir(), &env) }

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn interpolate_replaces_vars() {
        let mut ctx = HashMap::new();
        ctx.insert("baseUrl".into(), "http://x".into());
        assert_eq!(interpolate("{{baseUrl}}/orders", &ctx).unwrap(), "http://x/orders");
    }

    #[test]
    fn interpolate_errors_listing_missing() {
        let err = interpolate("{{a}}/{{b}}", &HashMap::new()).unwrap_err();
        assert!(err.contains("a") && err.contains("b"));
    }

    #[test]
    fn secrets_win_over_env() {
        let mut env = HashMap::new(); env.insert("t".into(), "env".into());
        let mut sec = HashMap::new(); sec.insert("t".into(), "secret".into());
        assert_eq!(build_ctx(env, sec).get("t").unwrap(), "secret");
    }

    #[test]
    fn sorted_json_stable_output() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.json");
        write_sorted_json(&p, &serde_json::json!({"b":1,"a":{"z":1,"y":2}})).unwrap();
        let s = std::fs::read_to_string(&p).unwrap();
        assert!(s.ends_with('\n'));
        assert!(s.find("\"a\"").unwrap() < s.find("\"b\"").unwrap());
    }

    #[test]
    fn request_roundtrip() {
        let r = Request {
            name: "n".into(), protocol: "http".into(),
            http: Some(HttpPart { method: "GET".into(), url: "u".into(), ..Default::default() }),
            grpc: None, ws: None,
        };
        let j = serde_json::to_value(&r).unwrap();
        let back: Request = serde_json::from_value(j).unwrap();
        assert_eq!(back.name, "n");
    }

    #[test]
    fn col_and_req_crud() {
        let dir = tempfile::tempdir().unwrap();
        let meta = create_collection(dir.path(), "My API").unwrap();
        assert_eq!(list_collections(dir.path()).unwrap().len(), 1);
        let req = Request { name: "get".into(), protocol: "http".into(),
            http: Some(HttpPart { method: "GET".into(), url: "{{baseUrl}}/x".into(), ..Default::default() }),
            grpc: None, ws: None };
        write_request(dir.path(), &meta.id, "orders/get.json", &req).unwrap();
        let entries = list_requests(dir.path(), &meta.id).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(read_request(dir.path(), &meta.id, "orders/get.json").unwrap().name, "get");
        move_request(dir.path(), &meta.id, "orders/get.json", "orders/get-one.json").unwrap();
        delete_request(dir.path(), &meta.id, "orders/get-one.json").unwrap();
        assert!(list_requests(dir.path(), &meta.id).unwrap().is_empty());
    }

    #[test]
    fn collection_order_persists_across_listing() {
        let dir = tempfile::tempdir().unwrap();
        let first = create_collection(dir.path(), "Zebra").unwrap();
        let second = create_collection(dir.path(), "Alpha").unwrap();
        reorder_collections(dir.path(), &[first.id.clone(), second.id.clone()]).unwrap();
        assert_eq!(list_collections(dir.path()).unwrap().iter().map(|c| c.id.clone()).collect::<Vec<_>>(), vec![first.id, second.id]);
    }

    #[test]
    fn request_order_persists_across_listing() {
        let dir = tempfile::tempdir().unwrap();
        let meta = create_collection(dir.path(), "API").unwrap();
        let req = |name: &str| Request { name: name.into(), protocol: "http".into(), http: None, grpc: None, ws: None };
        write_request(dir.path(), &meta.id, "a.json", &req("A")).unwrap();
        write_request(dir.path(), &meta.id, "b.json", &req("B")).unwrap();
        reorder_requests(dir.path(), &meta.id, &["b.json".into(), "a.json".into()]).unwrap();
        assert_eq!(list_requests(dir.path(), &meta.id).unwrap().iter().map(|r| r.rel_path.clone()).collect::<Vec<_>>(), vec!["b.json", "a.json"]);
    }

    #[test]
    fn rel_path_escape_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let meta = create_collection(dir.path(), "c").unwrap();
        assert!(read_request(dir.path(), &meta.id, "../evil.json").is_err());
    }

    #[test]
    fn env_crud() {
        let dir = tempfile::tempdir().unwrap();
        let mut vars = std::collections::HashMap::new();
        vars.insert("baseUrl".into(), "http://localhost".into());
        write_env(dir.path(), "dev", &vars).unwrap();
        assert_eq!(read_env(dir.path(), "dev").unwrap()["baseUrl"], "http://localhost");
        assert_eq!(list_envs(dir.path()).unwrap(), vec!["dev"]);
    }
}
