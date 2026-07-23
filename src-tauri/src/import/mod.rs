pub mod curl;
pub mod openapi;
pub mod postman;

use crate::collection::{create_collection, root_dir, write_request, CollectionMeta, Request, KV};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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

/// An `Authorization` header belongs in the Auth tab, not the Headers tab. Removes it
/// (case-insensitively) and, when the import carried no auth of its own, fills auth from it.
/// An auth block that is already set wins, matching send-time precedence in `http::prepare_http`.
pub fn hoist_auth_header(headers: &mut Vec<KV>, auth: &mut Value) {
    let Some(i) = headers.iter().position(|h| h.key.eq_ignore_ascii_case("authorization")) else { return };
    let value = headers.remove(i).value;
    if auth.get("type").and_then(|t| t.as_str()).unwrap_or("none") == "none" {
        *auth = auth_from_header(&value);
    }
}

fn auth_from_header(value: &str) -> Value {
    let (scheme, rest) = value.split_once(' ').unwrap_or((value, ""));
    let rest = rest.trim();
    if scheme.eq_ignore_ascii_case("bearer") && !rest.is_empty() {
        return json!({ "type": "bearer", "token": rest });
    }
    if scheme.eq_ignore_ascii_case("basic") {
        let decoded = base64::engine::general_purpose::STANDARD.decode(rest).ok()
            .and_then(|b| String::from_utf8(b).ok());
        if let Some((user, pass)) = decoded.as_deref().and_then(|s| s.split_once(':')) {
            return json!({ "type": "basic", "username": user, "password": pass });
        }
    }
    // unknown scheme (or a `{{var}}` we can't decode) — keep it verbatim as a named header
    json!({ "type": "apiKey", "key": "Authorization", "value": value })
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

/// Add a draft to an existing collection without overwriting a request that shares its path.
#[tauri::command]
pub fn col_merge_draft(collection_id: String, draft: CollectionDraft) -> Result<(), String> {
    let root = root_dir();
    let mut existing: std::collections::HashSet<String> = crate::collection::list_requests(&root, &collection_id)?
        .into_iter().map(|entry| entry.rel_path).collect();
    for entry in &draft.requests {
        let (stem, ext) = entry.rel_path.rsplit_once('.').unwrap_or((entry.rel_path.as_str(), "json"));
        let mut rel_path = entry.rel_path.clone();
        let mut n = 2;
        while existing.contains(&rel_path) {
            rel_path = format!("{stem}-{n}.{ext}");
            n += 1;
        }
        write_request(&root, &collection_id, &rel_path, &entry.request)?;
        existing.insert(rel_path);
    }
    Ok(())
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
        // the Authorization header is hoisted into the auth block, leaving only Content-Type
        assert_eq!(h.headers.len(), 1);
        assert_eq!(h.headers[0].key, "Content-Type");
        assert_eq!(h.auth, serde_json::json!({ "type": "bearer", "token": "T" }));
        assert_eq!(h.body["content"], "{\"q\":1}");
    }

    #[test]
    fn curl_parse_cookie_flag() {
        let r = curl::parse("curl 'https://x.com/' -b 'a=1; b=2' --cookie 'c=3'").unwrap();
        let h = r.http.unwrap();
        assert_eq!(h.headers.len(), 1);
        assert_eq!(h.headers[0].key, "Cookie");
        assert_eq!(h.headers[0].value, "a=1; b=2; c=3");

        // -b without '=' is a cookie-jar filename, not a cookie string
        let r = curl::parse("curl 'https://x.com/' -b cookies.txt").unwrap();
        assert!(r.http.unwrap().headers.is_empty());
    }

    #[test]
    fn curl_parse_hoists_auth_header() {
        let basic = base64::engine::general_purpose::STANDARD.encode("me:pw");
        let r = curl::parse(&format!("curl 'https://x.com/' -H 'authorization: Basic {basic}'")).unwrap();
        let h = r.http.unwrap();
        assert!(h.headers.is_empty());
        assert_eq!(h.auth, json!({ "type": "basic", "username": "me", "password": "pw" }));

        // unknown scheme round-trips verbatim as a named header
        let r = curl::parse("curl 'https://x.com/' -H 'Authorization: Token abc'").unwrap();
        assert_eq!(r.http.unwrap().auth, json!({ "type": "apiKey", "key": "Authorization", "value": "Token abc" }));

        // an explicit `-u` wins; the header is dropped, not merged
        let r = curl::parse("curl 'https://x.com/' -u 'a:b' -H 'Authorization: Bearer T'").unwrap();
        let h = r.http.unwrap();
        assert!(h.headers.is_empty());
        assert_eq!(h.auth, json!({ "type": "basic", "username": "a", "password": "b" }));
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
