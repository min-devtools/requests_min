pub mod curl;
pub mod openapi;
pub mod postman;

use crate::collection::{create_collection, root_dir, write_request, CollectionMeta, Request};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDraft { pub name: String, pub requests: Vec<DraftEntry> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftEntry { pub rel_path: String, pub request: Request }

/// Sanitize a display name into a safe path segment.
pub fn sanitize(name: &str) -> String {
    let s: String = name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '-' })
        .collect();
    let s = s.trim().to_string();
    if s.is_empty() { "request".into() } else { s }
}

#[tauri::command]
pub fn import_curl(text: String) -> Result<Request, String> { curl::parse(&text) }

#[tauri::command]
pub fn import_postman(text: String) -> Result<CollectionDraft, String> { postman::import(&text) }

#[tauri::command]
pub fn import_openapi(text: String) -> Result<CollectionDraft, String> { openapi::import(&text) }

#[tauri::command]
pub fn export_postman(collection_id: String) -> Result<String, String> { postman::export(&root_dir(), &collection_id) }

#[tauri::command]
pub fn export_curl(collection_id: String, rel_path: String) -> Result<String, String> {
    let req = crate::collection::read_request(&root_dir(), &collection_id, &rel_path)?;
    curl::to_curl(&req)
}

/// Persist a draft as a brand-new collection (never overwrites an existing one).
#[tauri::command]
pub fn col_save_draft(draft: CollectionDraft) -> Result<CollectionMeta, String> {
    let root = root_dir();
    let meta = create_collection(&root, &draft.name)?;
    for entry in &draft.requests {
        write_request(&root, &meta.id, &entry.rel_path, &entry.request)?;
    }
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collection::{create_collection, write_request, HttpPart, Request};
    use crate::secrets::write_secrets;
    use std::path::{Path, PathBuf};

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
    }

    #[test]
    fn curl_parse_basic() {
        let r = curl::parse(r#"curl -X POST 'https://api.x.com/v1/orders?a=1' -H 'Authorization: Bearer T' -H 'Content-Type: application/json' -d '{"q":1}'"#).unwrap();
        let h = r.http.unwrap();
        assert_eq!(h.method, "POST");
        assert_eq!(h.url, "https://api.x.com/v1/orders?a=1");
        assert_eq!(h.headers.len(), 2);
        assert_eq!(h.body["content"], "{\"q\":1}");
    }

    #[test]
    fn postman_import_nested_folders() {
        let text = std::fs::read_to_string(fixture("postman21.json")).unwrap();
        let d = postman::import(&text).unwrap();
        assert_eq!(d.name, "Demo");
        assert!(d.requests.iter().any(|e| e.rel_path == "Orders/create.json"));
    }

    #[test]
    fn openapi_import_paths() {
        let text = std::fs::read_to_string(fixture("openapi3.yaml")).unwrap();
        let d = openapi::import(&text).unwrap();
        assert!(d.requests.iter().any(|e| {
            let h = e.request.http.as_ref().unwrap();
            h.method == "POST" && h.url.contains("/pets")
        }));
    }

    #[test]
    fn postman_export_contains_requests_no_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let meta = create_collection(dir.path(), "Demo").unwrap();
        let req = Request { name: "get users".into(), protocol: "http".into(),
            http: Some(HttpPart { method: "GET".into(), url: "{{baseUrl}}/users".into(), ..Default::default() }),
            grpc: None, ws: None };
        write_request(dir.path(), &meta.id, "users/get.json", &req).unwrap();
        let mut sec = std::collections::HashMap::new();
        sec.insert("token".into(), "LEAKME".into());
        write_secrets(dir.path(), "dev", &sec).unwrap();
        let out = postman::export(dir.path(), &meta.id).unwrap();
        assert!(out.contains("get users"));
        assert!(!out.contains("LEAKME"));
    }
}
