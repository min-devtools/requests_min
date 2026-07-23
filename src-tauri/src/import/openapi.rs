use super::{sanitize, CollectionDraft, DraftEntry};
use crate::collection::{HttpPart, Request};
use serde_json::{json, Value};

const HTTP_METHODS: &[&str] = &["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

fn path_to_template(path: &str) -> String {
    // OpenAPI path params {id} -> our {{id}}
    path.replace('{', "{{").replace('}', "}}")
}

fn body_from_op(op: &Value) -> Value {
    let example = op.get("requestBody").and_then(|b| b.get("content"))
        .and_then(|c| c.get("application/json")).and_then(|j| j.get("example"));
    match example {
        Some(ex) => json!({ "type": "json", "content": serde_json::to_string(ex).unwrap_or_default() }),
        None if op.get("requestBody").is_some() => json!({ "type": "json", "content": "{}" }),
        None => json!({ "type": "none" }),
    }
}

pub fn import(text: &str) -> Result<CollectionDraft, String> {
    // serde_yaml parses JSON too (JSON ⊂ YAML), so one path covers both formats.
    let v: Value = serde_yaml::from_str(text).map_err(|e| e.to_string())?;
    let name = v.get("info").and_then(|i| i.get("title")).and_then(|t| t.as_str())
        .unwrap_or("Imported OpenAPI").to_string();
    let base = v.get("servers").and_then(|s| s.as_array()).and_then(|a| a.first())
        .and_then(|s| s.get("url")).and_then(|u| u.as_str()).unwrap_or("")
        .trim_end_matches('/').to_string();

    let mut requests = Vec::new();
    if let Some(paths) = v.get("paths").and_then(|p| p.as_object()) {
        for (path, methods) in paths {
            let Some(mobj) = methods.as_object() else { continue };
            for (method, op) in mobj {
                let m = method.to_uppercase();
                if !HTTP_METHODS.contains(&m.as_str()) { continue; }
                let url = format!("{base}{}", path_to_template(path));
                let body = body_from_op(op);
                let name = op.get("operationId").and_then(|o| o.as_str()).map(str::to_string)
                    .unwrap_or_else(|| format!("{m} {path}"));
                let request = Request {
                    name, protocol: "http".into(),
                    http: Some(HttpPart { method: m.clone(), url, headers: vec![], path_params: vec![], params: vec![],
                        auth: json!({ "type": "none" }), body, insecure: false }),
                    grpc: None, ws: None,
                };
                let folder = sanitize(path.trim_start_matches('/'));
                let rel = if folder.is_empty() { format!("{}.json", m.to_lowercase()) }
                          else { format!("{}/{}.json", folder, m.to_lowercase()) };
                requests.push(DraftEntry { rel_path: rel, request });
            }
        }
    }
    Ok(CollectionDraft { name, requests })
}
