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

/// Set a header, dropping any existing one with the same (case-insensitive) name.
/// Auth is applied through this, so the Auth tab overrides a hand-written header.
fn set_header(headers: &mut Vec<(String, String)>, key: &str, value: String) {
    headers.retain(|(k, _)| !k.eq_ignore_ascii_case(key));
    headers.push((key.to_string(), value));
}

/// Interpolate url/params/headers/auth/body into a ready-to-send request. Pure.
pub fn prepare_http(part: &HttpPart, ctx: &HashMap<String, String>) -> Result<PreparedHttp, String> {
    let method = if part.method.is_empty() { "GET".to_string() } else { part.method.clone() };

    let mut target = interpolate(&part.url, ctx)?;
    if !target.contains("://") {
        target = format!("http://{target}");
    }
    for path_param in part.path_params.iter().filter(|p| enabled(p)) {
        let value = interpolate(&path_param.value, ctx)?;
        target = target.replace(&format!(":{}", path_param.key), &value);
    }
    let mut url = reqwest::Url::parse(&target).map_err(|e| e.to_string())?;
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

    // auth — applied last so it overrides any Authorization header typed into the Headers tab
    let auth_type = part.auth.get("type").and_then(|v| v.as_str()).unwrap_or("none");
    let auth_str = |k: &str| part.auth.get(k).and_then(|v| v.as_str()).unwrap_or("");
    match auth_type {
        "bearer" => {
            let tok = interpolate(auth_str("token"), ctx)?;
            set_header(&mut headers, "Authorization", format!("Bearer {tok}"));
        }
        "basic" => {
            let user = interpolate(auth_str("username"), ctx)?;
            let pass = interpolate(auth_str("password"), ctx)?;
            let enc = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}"));
            set_header(&mut headers, "Authorization", format!("Basic {enc}"));
        }
        "apiKey" => {
            let k = interpolate(auth_str("key"), ctx)?;
            let v = interpolate(auth_str("value"), ctx)?;
            if !k.is_empty() {
                if auth_str("addTo") == "query" { url.query_pairs_mut().append_pair(&k, &v); }
                else { set_header(&mut headers, &k, v); }
            }
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
            // the UI stores form rows in `fields`; older saved requests kept a JSON array in `content`
            let kvs: Vec<KV> = part.body.get("fields")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_else(|| serde_json::from_str(content).unwrap_or_default());
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

    #[test]
    fn prepare_replaces_enabled_path_params_before_appending_query() {
        let mut ctx = std::collections::HashMap::new();
        ctx.insert("baseUrl".into(), "http://h".into());
        ctx.insert("projectId".into(), "p 1".into());
        let part = HttpPart {
            method: "GET".into(),
            url: "{{baseUrl}}/projects/:projectId/issues/:issueId".into(),
            path_params: vec![
                KV { key: "projectId".into(), value: "{{projectId}}".into(), enabled: Some(true) },
                KV { key: "issueId".into(), value: "42".into(), enabled: Some(false) },
            ],
            params: vec![KV { key: "include".into(), value: "comments".into(), enabled: Some(true) }],
            ..Default::default()
        };

        let p = prepare_http(&part, &ctx).unwrap();

        assert_eq!(p.url, "http://h/projects/p%201/issues/:issueId?include=comments");
    }

    #[test]
    fn prepare_defaults_missing_url_scheme_to_http() {
        let ctx = std::collections::HashMap::new();
        let part = HttpPart { method: "GET".into(), url: "10.104.0.3:3001/health".into(), ..Default::default() };

        let p = prepare_http(&part, &ctx).unwrap();

        assert_eq!(p.url, "http://10.104.0.3:3001/health");
    }

    #[test]
    fn auth_overrides_authorization_header() {
        let ctx = std::collections::HashMap::new();
        let part = HttpPart {
            method: "GET".into(), url: "http://h/x".into(),
            headers: vec![KV { key: "authorization".into(), value: "Bearer STALE".into(), enabled: Some(true) }],
            auth: serde_json::json!({"type":"bearer","token":"FRESH"}),
            ..Default::default()
        };
        let p = prepare_http(&part, &ctx).unwrap();
        let auth: Vec<_> = p.headers.iter().filter(|(k, _)| k.eq_ignore_ascii_case("authorization")).collect();
        assert_eq!(auth.len(), 1, "exactly one Authorization header is sent");
        assert_eq!(auth[0].1, "Bearer FRESH");
    }

    #[test]
    fn form_body_reads_fields() {
        let ctx = std::collections::HashMap::new();
        let part = HttpPart {
            method: "POST".into(), url: "http://h/x".into(),
            body: serde_json::json!({"type":"form","fields":[{"key":"a","value":"1 2"},{"key":"off","value":"x","enabled":false}]}),
            ..Default::default()
        };
        let p = prepare_http(&part, &ctx).unwrap();
        let (ct, content) = p.body.unwrap();
        assert_eq!(ct, "application/x-www-form-urlencoded");
        assert_eq!(content, "a=1+2");
    }

    #[test]
    fn api_key_add_to_query() {
        let ctx = std::collections::HashMap::new();
        let part = HttpPart {
            method: "GET".into(), url: "http://h/x".into(),
            auth: serde_json::json!({"type":"apiKey","key":"k","value":"v","addTo":"query"}),
            ..Default::default()
        };
        let p = prepare_http(&part, &ctx).unwrap();
        assert_eq!(p.url, "http://h/x?k=v");
        assert!(!p.headers.iter().any(|(k, _)| k == "k"));
    }

    #[test]
    fn auth_none_keeps_authorization_header() {
        let ctx = std::collections::HashMap::new();
        let part = HttpPart {
            method: "GET".into(), url: "http://h/x".into(),
            headers: vec![KV { key: "Authorization".into(), value: "Bearer H".into(), enabled: Some(true) }],
            ..Default::default()
        };
        let p = prepare_http(&part, &ctx).unwrap();
        assert!(p.headers.iter().any(|(k, v)| k == "Authorization" && v == "Bearer H"));
    }
}
