use crate::collection::{build_ctx, interpolate, read_env, root_dir, HttpPart, Request, KV};
use crate::secrets::read_secrets;
use base64::Engine;
use reqwest::cookie::{CookieStore, Jar};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Shared cookie jar so Set-Cookie from one response is auto-sent on later requests
/// (Postman-style). Inner Arc is swapped out to clear all cookies.
pub struct CookieState(pub Mutex<Arc<Jar>>);
impl Default for CookieState {
    fn default() -> Self { CookieState(Mutex::new(Arc::new(Jar::default()))) }
}

pub struct PreparedHttp {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<(String, String)>, // (content-type, content)
}

fn enabled(kv: &KV) -> bool { kv.enabled.unwrap_or(true) }

/// Interpolate url/params/headers/auth/body into a ready-to-send request. Pure.
pub fn prepare_http(part: &HttpPart, ctx: &HashMap<String, String>) -> Result<PreparedHttp, String> {
    let method = if part.method.is_empty() { "GET".to_string() } else { part.method.clone() };

    let mut url = reqwest::Url::parse(&interpolate(&part.url, ctx)?).map_err(|e| e.to_string())?;
    let params: Vec<(String, String)> = part.params.iter().filter(|p| enabled(p))
        .map(|p| Ok((interpolate(&p.key, ctx)?, interpolate(&p.value, ctx)?)))
        .collect::<Result<_, String>>()?;
    if !params.is_empty() {
        let mut qp = url.query_pairs_mut();
        for (k, v) in &params { qp.append_pair(k, v); }
    }

    let mut headers: Vec<(String, String)> = Vec::new();
    for h in part.headers.iter().filter(|h| enabled(h)) {
        headers.push((interpolate(&h.key, ctx)?, interpolate(&h.value, ctx)?));
    }

    // auth
    let auth_type = part.auth.get("type").and_then(|v| v.as_str()).unwrap_or("none");
    let auth_str = |k: &str| part.auth.get(k).and_then(|v| v.as_str()).unwrap_or("");
    match auth_type {
        "bearer" => {
            let tok = interpolate(auth_str("token"), ctx)?;
            headers.push(("Authorization".into(), format!("Bearer {tok}")));
        }
        "basic" => {
            let user = interpolate(auth_str("username"), ctx)?;
            let pass = interpolate(auth_str("password"), ctx)?;
            let enc = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}"));
            headers.push(("Authorization".into(), format!("Basic {enc}")));
        }
        "apiKey" => {
            let k = interpolate(auth_str("key"), ctx)?;
            let v = interpolate(auth_str("value"), ctx)?;
            if !k.is_empty() { headers.push((k, v)); }
        }
        _ => {}
    }

    // body
    let body_type = part.body.get("type").and_then(|v| v.as_str()).unwrap_or("none");
    let content = part.body.get("content").and_then(|v| v.as_str()).unwrap_or("");
    let body = match body_type {
        "json" => Some(("application/json".to_string(), interpolate(content, ctx)?)),
        "text" => Some(("text/plain".to_string(), interpolate(content, ctx)?)),
        "form" => {
            // content = JSON array of KV; encode via Url query serializer
            let kvs: Vec<KV> = serde_json::from_str(content).unwrap_or_default();
            let mut u = reqwest::Url::parse("http://x/").map_err(|e| e.to_string())?;
            {
                let mut qp = u.query_pairs_mut();
                for kv in kvs.iter().filter(|k| enabled(k)) {
                    qp.append_pair(&interpolate(&kv.key, ctx)?, &interpolate(&kv.value, ctx)?);
                }
            }
            Some(("application/x-www-form-urlencoded".to_string(), u.query().unwrap_or("").to_string()))
        }
        _ => None,
    };

    Ok(PreparedHttp { method, url: url.to_string(), headers, body })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<KV>,
    pub body: String,
    pub time_ms: u64,
    pub size_bytes: u64,
}

#[tauri::command]
pub async fn http_request(env: Option<String>, request: Request, cookies: tauri::State<'_, CookieState>) -> Result<HttpResponse, String> {
    let part = request.http.ok_or("not an http request")?;
    let root = root_dir();
    let (env_vars, secret_vars) = match &env {
        Some(e) => (read_env(&root, e)?, read_secrets(&root, e)?),
        None => (HashMap::new(), HashMap::new()),
    };
    let ctx = build_ctx(env_vars, secret_vars);
    let prepared = prepare_http(&part, &ctx)?;

    let jar = { cookies.0.lock().unwrap().clone() };
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(60))
        .danger_accept_invalid_certs(part.insecure)
        .cookie_provider(jar)
        .build()
        .map_err(|e| e.to_string())?;
    let method = reqwest::Method::from_bytes(prepared.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut rb = client.request(method, &prepared.url);
    for (k, v) in &prepared.headers { rb = rb.header(k, v); }
    if let Some((ct, content)) = prepared.body { rb = rb.header("content-type", ct).body(content); }

    let t0 = Instant::now();
    let resp = rb.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let headers = resp.headers().iter()
        .map(|(k, v)| KV { key: k.to_string(), value: v.to_str().unwrap_or("").to_string(), enabled: None })
        .collect();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let size_bytes = bytes.len() as u64;
    let body = String::from_utf8_lossy(&bytes).to_string();
    let time_ms = t0.elapsed().as_millis() as u64;
    Ok(HttpResponse { status, headers, body, time_ms, size_bytes })
}

/// Cookies the jar would send for `url` (what the next request attaches). Empty on
/// unparseable url (e.g. still has {{template}} vars) or no matching cookies.
#[tauri::command]
pub fn cookies_for(url: String, cookies: tauri::State<'_, CookieState>) -> Vec<KV> {
    let jar = cookies.0.lock().unwrap().clone();
    let Ok(u) = reqwest::Url::parse(&url) else { return vec![] };
    let Some(h) = jar.cookies(&u) else { return vec![] };
    h.to_str().unwrap_or("").split("; ").filter(|p| !p.is_empty())
        .filter_map(|p| p.split_once('=').map(|(k, v)| KV { key: k.into(), value: v.into(), enabled: None }))
        .collect()
}

#[tauri::command]
pub fn cookies_clear(cookies: tauri::State<'_, CookieState>) {
    *cookies.0.lock().unwrap() = Arc::new(Jar::default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepare_applies_interpolation_auth_params() {
        let mut ctx = std::collections::HashMap::new();
        ctx.insert("baseUrl".into(), "http://h".into());
        ctx.insert("tok".into(), "T".into());
        let part = HttpPart {
            method: "GET".into(), url: "{{baseUrl}}/x".into(),
            params: vec![KV { key: "q".into(), value: "1".into(), enabled: Some(true) }],
            auth: serde_json::json!({"type":"bearer","token":"{{tok}}"}),
            ..Default::default()
        };
        let p = prepare_http(&part, &ctx).unwrap();
        assert_eq!(p.url, "http://h/x?q=1");
        assert!(p.headers.iter().any(|(k, v)| k == "Authorization" && v == "Bearer T"));
    }
}
