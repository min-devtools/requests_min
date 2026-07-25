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

/// Splits a Postman gRPC URL into (endpoint, service, method, insecure).
///
/// The endpoint keeps an `https://` prefix for TLS targets: `grpc::channel` decides TLS purely
/// from that prefix and ignores the `insecure` flag, so handing it a bare `host:443` would
/// silently downgrade an imported `grpcs://` request to plaintext. Same convention the grpcurl
/// parser uses (`src/lib/grpcurl.ts`): `https://host` = TLS, bare host = plaintext.
fn parse_grpc_url(url: &str) -> (String, String, String, bool) {
    let (insecure, rest) = if let Some(r) = url.strip_prefix("grpcs://") {
        (false, r)
    } else if let Some(r) = url.strip_prefix("grpc://") {
        (true, r)
    } else if let Some(r) = url.strip_prefix("https://") {
        (false, r)
    } else if let Some(r) = url.strip_prefix("http://") {
        (true, r)
    } else {
        (true, url)
    };

    let with_scheme = |host: &str| if insecure { host.to_string() } else { format!("https://{host}") };

    let parts: Vec<&str> = rest.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        (with_scheme(rest), String::new(), String::new(), insecure)
    } else if parts.len() == 1 {
        (with_scheme(parts[0]), String::new(), String::new(), insecure)
    } else if parts.len() == 2 {
        (with_scheme(parts[0]), parts[1].to_string(), String::new(), insecure)
    } else {
        let endpoint = with_scheme(parts[0]);
        let service = parts[1..parts.len() - 1].join("/");
        let method = parts[parts.len() - 1].to_string();
        (endpoint, service, method, insecure)
    }
}

fn build_request(name: &str, reqv: &Value) -> Request {
    let method = reqv.get("method").and_then(|m| m.as_str()).unwrap_or("GET").to_string();
    let url = match reqv.get("url") {
        Some(Value::String(s)) => s.clone(),
        Some(o) => o.get("raw").and_then(|r| r.as_str()).unwrap_or("").to_string(),
        None => String::new(),
    };
    let is_grpc = url.starts_with("grpc://") || url.starts_with("grpcs://") || method.eq_ignore_ascii_case("grpc");
    let is_ws = url.starts_with("ws://") || url.starts_with("wss://") || method.eq_ignore_ascii_case("ws") || method.eq_ignore_ascii_case("websocket");

    let mut headers: Vec<KV> = reqv.get("header").and_then(|h| h.as_array()).map(|arr| arr.iter().filter_map(|x| {
        let k = x.get("key")?.as_str()?.to_string();
        let v = x.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let enabled = !x.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false);
        Some(KV { key: k, value: v, enabled: Some(enabled) })
    }).collect()).unwrap_or_default();

    if is_grpc {
        let (endpoint, service, method_name, insecure) = parse_grpc_url(&url);
        let message = reqv.get("body").and_then(|b| b.get("raw")).and_then(|r| r.as_str()).unwrap_or("").to_string();
        let grpc_opts = reqv.get("grpcOptions");
        let proto_files: Vec<String> = grpc_opts.and_then(|g| g.get("protoFiles")).and_then(|f| f.as_array()).map(|arr| {
            arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
        }).unwrap_or_default();
        let proto_source: String = grpc_opts.and_then(|g| g.get("protoSource")).and_then(|s| s.as_str()).map(|s| s.to_string())
            .unwrap_or_else(|| if !proto_files.is_empty() { "files".to_string() } else { "reflection".to_string() });
        let source_id: Option<String> = grpc_opts.and_then(|g| g.get("sourceId")).and_then(|s| s.as_str().map(|v| v.to_string()));

        use crate::collection::GrpcPart;
        return Request {
            name: name.to_string(),
            protocol: "grpc".into(),
            http: None,
            grpc: Some(GrpcPart {
                endpoint,
                source_id,
                proto_source,
                proto_files,
                service,
                method: method_name,
                message,
                metadata: headers,
                insecure,
            }),
            ws: None,
        };
    }

    if is_ws {
        use crate::collection::WsPart;
        return Request {
            name: name.to_string(),
            protocol: "ws".into(),
            http: None,
            grpc: None,
            ws: Some(WsPart {
                url,
                headers,
                saved_messages: vec![],
            }),
        };
    }

    let body = build_body(reqv.get("body"));
    let mut auth = build_auth(reqv.get("auth"));
    // a postman `auth` block wins over an Authorization header on the same request
    super::hoist_auth_header(&mut headers, &mut auth);
    Request {
        name: name.to_string(), protocol: "http".into(),
        http: Some(HttpPart { method, url, headers, path_params: vec![], params: vec![], auth, body, insecure: false }),
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
    if req.protocol == "grpc" {
        if let Some(g) = &req.grpc {
            let header: Vec<Value> = g.metadata.iter().filter(|k| k.enabled.unwrap_or(true))
                .map(|kv| json!({ "key": kv.key, "value": kv.value })).collect();
            // always emit a grpc:// or grpcs:// scheme — an https:// URL would come back through
            // the importer as a plain HTTP request, since is_grpc only recognises the grpc schemes
            let endpoint = if g.endpoint.starts_with("grpc://") || g.endpoint.starts_with("grpcs://") {
                g.endpoint.clone()
            } else if let Some(host) = g.endpoint.strip_prefix("https://") {
                format!("grpcs://{host}")
            } else if let Some(host) = g.endpoint.strip_prefix("http://") {
                format!("grpc://{host}")
            } else if g.insecure {
                format!("grpc://{}", g.endpoint)
            } else {
                format!("grpcs://{}", g.endpoint)
            };
            let raw_url = if !g.service.is_empty() && !g.method.is_empty() {
                format!("{}/{}/{}", endpoint, g.service, g.method)
            } else {
                endpoint
            };
            let mut request = json!({
                "method": "POST",
                "header": header,
                "url": { "raw": raw_url },
            });
            if !g.message.is_empty() {
                request["body"] = json!({ "mode": "raw", "raw": g.message });
            }
            if !g.proto_files.is_empty() || g.source_id.is_some() || g.proto_source != "reflection" {
                request["grpcOptions"] = json!({
                    "protoFiles": g.proto_files,
                    "protoSource": g.proto_source,
                    "sourceId": g.source_id,
                });
            }
            return json!({ "name": req.name, "request": request });
        }
    } else if req.protocol == "ws" {
        if let Some(w) = &req.ws {
            let header: Vec<Value> = w.headers.iter().filter(|k| k.enabled.unwrap_or(true))
                .map(|kv| json!({ "key": kv.key, "value": kv.value })).collect();
            let request = json!({
                "method": "GET",
                "header": header,
                "url": { "raw": w.url },
            });
            return json!({ "name": req.name, "request": request });
        }
    }

    if let Some(h) = &req.http {
        let header: Vec<Value> = h.headers.iter().filter(|k| k.enabled.unwrap_or(true))
            .map(|kv| json!({ "key": kv.key, "value": kv.value })).collect();
        let mut request = json!({ "method": h.method, "header": header, "url": { "raw": h.url } });
        if let Some(c) = h.body.get("content").and_then(|v| v.as_str()) {
            if !c.is_empty() { request["body"] = json!({ "mode": "raw", "raw": c }); }
        }
        return json!({ "name": req.name, "request": request });
    }

    json!({ "name": req.name, "request": { "method": "GET", "url": { "raw": "" } } })
}

pub fn export(root: &Path, collection_id: &str) -> Result<String, String> {
    let meta_text = std::fs::read_to_string(root.join("collections").join(collection_id).join("collection.json"))
        .map_err(|e| e.to_string())?;
    let meta: CollectionMeta = serde_json::from_str(&meta_text).map_err(|e| e.to_string())?;

    let mut tree = Folder::default();
    for entry in list_requests(root, collection_id)? {
        let req = read_request(root, collection_id, &entry.rel_path)?;
        let comps: Vec<&str> = entry.rel_path.trim_end_matches(".json").split('/').collect();
        insert(&mut tree, &comps, req_to_item(&req));
    }
    let out = json!({
        "info": { "name": meta.name, "schema": SCHEMA },
        "item": to_items(tree),
    });
    serde_json::to_string_pretty(&out).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::parse_grpc_url;

    #[test]
    fn grpcs_url_keeps_the_tls_scheme_on_the_endpoint() {
        // grpc::channel turns TLS on only for an https:// endpoint, so importing grpcs:// must
        // produce one — a bare host:443 here would silently downgrade the request to plaintext
        let (endpoint, service, method, insecure) =
            parse_grpc_url("grpcs://api.example.com:443/pkg.Svc/Method");
        assert_eq!(endpoint, "https://api.example.com:443");
        assert_eq!(service, "pkg.Svc");
        assert_eq!(method, "Method");
        assert!(!insecure);
    }

    #[test]
    fn plaintext_grpc_url_stays_bare() {
        let (endpoint, service, method, insecure) =
            parse_grpc_url("grpc://localhost:50051/pkg.Svc/Method");
        assert_eq!(endpoint, "localhost:50051");
        assert_eq!(service, "pkg.Svc");
        assert_eq!(method, "Method");
        assert!(insecure);
    }

    #[test]
    fn endpoint_only_urls_still_carry_their_scheme() {
        assert_eq!(parse_grpc_url("grpcs://api.example.com").0, "https://api.example.com");
        assert_eq!(parse_grpc_url("localhost:50051").0, "localhost:50051");
    }
}
