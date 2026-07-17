use super::{sanitize, CollectionDraft, DraftEntry};
use crate::collection::{list_requests, read_request, CollectionMeta, HttpPart, Request, KV};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

const SCHEMA: &str = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

// ---- import ----

pub fn import(json_text: &str) -> Result<CollectionDraft, String> {
    let v: Value = serde_json::from_str(json_text).map_err(|e| e.to_string())?;
    let name = v.get("info").and_then(|i| i.get("name")).and_then(|n| n.as_str())
        .unwrap_or("Imported").to_string();
    let mut requests = Vec::new();
    if let Some(items) = v.get("item").and_then(|i| i.as_array()) {
        walk(items, "", &mut requests);
    }
    Ok(CollectionDraft { name, requests })
}

fn walk(items: &[Value], prefix: &str, out: &mut Vec<DraftEntry>) {
    for item in items {
        let iname = item.get("name").and_then(|n| n.as_str()).unwrap_or("item");
        if let Some(sub) = item.get("item").and_then(|i| i.as_array()) {
            let np = if prefix.is_empty() { sanitize(iname) } else { format!("{prefix}/{}", sanitize(iname)) };
            walk(sub, &np, out);
        } else if let Some(reqv) = item.get("request") {
            let request = build_request(iname, reqv);
            let rel = if prefix.is_empty() { format!("{}.json", sanitize(iname)) }
                      else { format!("{prefix}/{}.json", sanitize(iname)) };
            out.push(DraftEntry { rel_path: rel, request });
        }
    }
}

fn build_request(name: &str, reqv: &Value) -> Request {
    let method = reqv.get("method").and_then(|m| m.as_str()).unwrap_or("GET").to_string();
    let url = match reqv.get("url") {
        Some(Value::String(s)) => s.clone(),
        Some(o) => o.get("raw").and_then(|r| r.as_str()).unwrap_or("").to_string(),
        None => String::new(),
    };
    let mut headers: Vec<KV> = reqv.get("header").and_then(|h| h.as_array()).map(|arr| arr.iter().filter_map(|x| {
        let k = x.get("key")?.as_str()?.to_string();
        let v = x.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let enabled = !x.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false);
        Some(KV { key: k, value: v, enabled: Some(enabled) })
    }).collect()).unwrap_or_default();
    let body = build_body(reqv.get("body"));
    let mut auth = build_auth(reqv.get("auth"));
    // a postman `auth` block wins over an Authorization header on the same request
    super::hoist_auth_header(&mut headers, &mut auth);
    Request {
        name: name.to_string(), protocol: "http".into(),
        http: Some(HttpPart { method, url, headers, params: vec![], auth, body, insecure: false }),
        grpc: None, ws: None,
    }
}

fn build_body(body: Option<&Value>) -> Value {
    let Some(b) = body else { return json!({ "type": "none" }); };
    match b.get("mode").and_then(|m| m.as_str()) {
        Some("raw") => {
            let raw = b.get("raw").and_then(|r| r.as_str()).unwrap_or("");
            let t = if raw.trim_start().starts_with('{') || raw.trim_start().starts_with('[') { "json" } else { "text" };
            json!({ "type": t, "content": raw })
        }
        Some("urlencoded") => {
            let kvs: Vec<KV> = b.get("urlencoded").and_then(|u| u.as_array()).map(|arr| arr.iter().filter_map(|x| {
                let k = x.get("key")?.as_str()?.to_string();
                let v = x.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string();
                Some(KV { key: k, value: v, enabled: Some(true) })
            }).collect()).unwrap_or_default();
            json!({ "type": "form", "content": serde_json::to_string(&kvs).unwrap_or_default() })
        }
        _ => json!({ "type": "none" }),
    }
}

fn build_auth(auth: Option<&Value>) -> Value {
    let Some(a) = auth else { return json!({ "type": "none" }); };
    let pick = |kind: &str, field: &str| a.get(kind).and_then(|x| x.as_array())
        .and_then(|arr| arr.iter().find(|e| e.get("key").and_then(|k| k.as_str()) == Some(field)))
        .and_then(|e| e.get("value")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    match a.get("type").and_then(|t| t.as_str()) {
        Some("bearer") => json!({ "type": "bearer", "token": pick("bearer", "token") }),
        Some("basic") => json!({ "type": "basic", "username": pick("basic", "username"), "password": pick("basic", "password") }),
        _ => json!({ "type": "none" }),
    }
}

// ---- export ----

#[derive(Default)]
struct Folder { subfolders: BTreeMap<String, Folder>, requests: Vec<Value> }

fn insert(folder: &mut Folder, comps: &[&str], item: Value) {
    if comps.len() <= 1 { folder.requests.push(item); }
    else { insert(folder.subfolders.entry(comps[0].to_string()).or_default(), &comps[1..], item); }
}

fn to_items(folder: Folder) -> Vec<Value> {
    let mut items = Vec::new();
    for (name, sub) in folder.subfolders {
        items.push(json!({ "name": name, "item": to_items(sub) }));
    }
    items.extend(folder.requests);
    items
}

fn req_to_item(req: &Request) -> Value {
    let h = req.http.as_ref().unwrap();
    let header: Vec<Value> = h.headers.iter().filter(|k| k.enabled.unwrap_or(true))
        .map(|kv| json!({ "key": kv.key, "value": kv.value })).collect();
    let mut request = json!({ "method": h.method, "header": header, "url": { "raw": h.url } });
    if let Some(c) = h.body.get("content").and_then(|v| v.as_str()) {
        if !c.is_empty() { request["body"] = json!({ "mode": "raw", "raw": c }); }
    }
    json!({ "name": req.name, "request": request })
}

pub fn export(root: &Path, collection_id: &str) -> Result<String, String> {
    let meta_text = std::fs::read_to_string(root.join("collections").join(collection_id).join("collection.json"))
        .map_err(|e| e.to_string())?;
    let meta: CollectionMeta = serde_json::from_str(&meta_text).map_err(|e| e.to_string())?;

    let mut tree = Folder::default();
    for entry in list_requests(root, collection_id)? {
        let req = read_request(root, collection_id, &entry.rel_path)?;
        if req.protocol != "http" { continue; } // grpc/ws not representable in Postman v2.1
        let comps: Vec<&str> = entry.rel_path.trim_end_matches(".json").split('/').collect();
        insert(&mut tree, &comps, req_to_item(&req));
    }
    let out = json!({
        "info": { "name": meta.name, "schema": SCHEMA },
        "item": to_items(tree),
    });
    serde_json::to_string_pretty(&out).map_err(|e| e.to_string())
}
