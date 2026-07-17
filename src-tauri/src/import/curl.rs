use crate::collection::{HttpPart, Request, KV};

/// Split a command line into shell words (single/double quotes, backslash escapes, line continuations).
fn tokenize(s: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut has = false;
    let mut in_single = false;
    let mut in_double = false;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\'' if !in_double => { in_single = !in_single; has = true; }
            '"' if !in_single => { in_double = !in_double; has = true; }
            '\\' if !in_single => match chars.next() {
                Some('\n') => {}                 // line continuation
                Some(n) => { cur.push(n); has = true; }
                None => {}
            },
            c if c.is_whitespace() && !in_single && !in_double => {
                if has || !cur.is_empty() { tokens.push(std::mem::take(&mut cur)); has = false; }
            }
            c => { cur.push(c); has = true; }
        }
    }
    if has || !cur.is_empty() { tokens.push(cur); }
    tokens
}

fn url_name(url: &str) -> String {
    let no_query = url.split('?').next().unwrap_or(url);
    no_query.trim_end_matches('/').rsplit('/').next().filter(|s| !s.is_empty())
        .unwrap_or("request").to_string()
}

pub fn parse(text: &str) -> Result<Request, String> {
    let tokens = tokenize(text.trim());
    let mut method: Option<String> = None;
    let mut url = String::new();
    let mut headers: Vec<KV> = Vec::new();
    let mut body_content: Option<String> = None;
    let mut auth = serde_json::json!({ "type": "none" });

    let mut i = if tokens.first().map(|t| t == "curl").unwrap_or(false) { 1 } else { 0 };
    while i < tokens.len() {
        match tokens[i].as_str() {
            "-X" | "--request" => { i += 1; method = tokens.get(i).cloned(); }
            "-H" | "--header" => {
                i += 1;
                if let Some(h) = tokens.get(i) {
                    if let Some((k, v)) = h.split_once(':') {
                        headers.push(KV { key: k.trim().into(), value: v.trim().into(), enabled: Some(true) });
                    }
                }
            }
            "-d" | "--data" | "--data-raw" | "--data-binary" | "--data-ascii" => {
                i += 1; body_content = tokens.get(i).cloned();
            }
            "-u" | "--user" => {
                i += 1;
                if let Some(u) = tokens.get(i) {
                    let (user, pass) = u.split_once(':').unwrap_or((u.as_str(), ""));
                    auth = serde_json::json!({ "type": "basic", "username": user, "password": pass });
                }
            }
            "--url" => { i += 1; if let Some(u) = tokens.get(i) { url = u.clone(); } }
            s if s.starts_with("http://") || s.starts_with("https://") => { url = s.to_string(); }
            _ => {} // unknown flags ignored
        }
        i += 1;
    }

    if url.is_empty() { return Err("no URL found in curl command".into()); }
    // `-u` already filled auth; it wins over any `-H 'Authorization: ...'`
    super::hoist_auth_header(&mut headers, &mut auth);
    let method = method.unwrap_or_else(|| if body_content.is_some() { "POST".into() } else { "GET".into() });
    let body = match &body_content {
        Some(c) => {
            let t = if c.trim_start().starts_with('{') || c.trim_start().starts_with('[') { "json" } else { "text" };
            serde_json::json!({ "type": t, "content": c })
        }
        None => serde_json::json!({ "type": "none" }),
    };

    Ok(Request {
        name: url_name(&url),
        protocol: "http".into(),
        http: Some(HttpPart { method, url, headers, params: vec![], auth, body, insecure: false }),
        grpc: None, ws: None,
    })
}

pub fn to_curl(req: &Request) -> Result<String, String> {
    let h = req.http.as_ref().ok_or("not an http request")?;
    let mut out = format!("curl -X {} '{}'", if h.method.is_empty() { "GET" } else { &h.method }, h.url);
    for kv in h.headers.iter().filter(|k| k.enabled.unwrap_or(true)) {
        out.push_str(&format!(" \\\n  -H '{}: {}'", kv.key, kv.value));
    }
    if h.auth.get("type").and_then(|v| v.as_str()) == Some("bearer") {
        if let Some(t) = h.auth.get("token").and_then(|v| v.as_str()) {
            out.push_str(&format!(" \\\n  -H 'Authorization: Bearer {t}'"));
        }
    }
    if h.auth.get("type").and_then(|v| v.as_str()) == Some("basic") {
        let u = h.auth.get("username").and_then(|v| v.as_str()).unwrap_or("");
        let p = h.auth.get("password").and_then(|v| v.as_str()).unwrap_or("");
        out.push_str(&format!(" \\\n  -u '{u}:{p}'"));
    }
    if let Some(c) = h.body.get("content").and_then(|v| v.as_str()) {
        if !c.is_empty() { out.push_str(&format!(" \\\n  -d '{c}'")); }
    }
    Ok(out)
}
