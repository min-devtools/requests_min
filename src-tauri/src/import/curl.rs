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

fn percent_decode(s: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = s.bytes().enumerate();
    while let Some((i, b)) = chars.next() {
        if b == b'%' && i + 2 < s.len() {
            let hex = &s[i + 1..i + 3];
            if let Ok(val) = u8::from_str_radix(hex, 16) {
                bytes.push(val);
                chars.next();
                chars.next();
                continue;
            }
        }
        if b == b'+' {
            bytes.push(b' ');
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8_lossy(&bytes).to_string()
}

fn parse_kv_param(s: &str) -> (String, String) {
    if let Some(rest) = s.strip_prefix('=') {
        ("".to_string(), rest.to_string())
    } else if let Some((k, v)) = s.split_once('=') {
        (k.to_string(), v.to_string())
    } else {
        (s.to_string(), "".to_string())
    }
}

fn url_name(url: &str) -> String {
    let no_query = url.split('?').next().unwrap_or(url);
    no_query.trim_end_matches('/').rsplit('/').next().filter(|s| !s.is_empty())
        .unwrap_or("request").to_string()
}

pub fn parse(text: &str) -> Result<Request, String> {
    let tokens = tokenize(text.trim());
    let mut method: Option<String> = None;
    let mut is_get = false;
    let mut url = String::new();
    let mut headers: Vec<KV> = Vec::new();
    let mut data_items: Vec<String> = Vec::new();
    let mut auth = serde_json::json!({ "type": "none" });
    let mut insecure = false;

    let mut i = if tokens.first().map(|t| t == "curl").unwrap_or(false) { 1 } else { 0 };
    while i < tokens.len() {
        let tok = &tokens[i];
        if tok == "-G" || tok == "--get" {
            is_get = true;
        } else if tok == "-X" || tok == "--request" {
            i += 1;
            if let Some(m) = tokens.get(i) { method = Some(m.to_uppercase()); }
        } else if let Some(m) = tok.strip_prefix("--request=") {
            method = Some(m.to_uppercase());
        } else if tok == "-H" || tok == "--header" {
            i += 1;
            if let Some(h) = tokens.get(i) {
                if let Some((k, v)) = h.split_once(':') {
                    headers.push(KV { key: k.trim().into(), value: v.trim().into(), enabled: Some(true) });
                }
            }
        } else if let Some(h) = tok.strip_prefix("--header=").or_else(|| if tok.starts_with("-H") && tok.len() > 2 { Some(&tok[2..]) } else { None }) {
            if let Some((k, v)) = h.split_once(':') {
                headers.push(KV { key: k.trim().into(), value: v.trim().into(), enabled: Some(true) });
            }
        } else if tok == "-A" || tok == "--user-agent" {
            i += 1;
            if let Some(a) = tokens.get(i) {
                headers.push(KV { key: "User-Agent".into(), value: a.clone(), enabled: Some(true) });
            }
        } else if let Some(a) = tok.strip_prefix("--user-agent=").or_else(|| if tok.starts_with("-A") && tok.len() > 2 { Some(&tok[2..]) } else { None }) {
            headers.push(KV { key: "User-Agent".into(), value: a.into(), enabled: Some(true) });
        } else if tok == "-e" || tok == "--referer" {
            i += 1;
            if let Some(r) = tokens.get(i) {
                headers.push(KV { key: "Referer".into(), value: r.clone(), enabled: Some(true) });
            }
        } else if let Some(r) = tok.strip_prefix("--referer=").or_else(|| if tok.starts_with("-e") && tok.len() > 2 { Some(&tok[2..]) } else { None }) {
            headers.push(KV { key: "Referer".into(), value: r.into(), enabled: Some(true) });
        } else if tok == "-k" || tok == "--insecure" {
            insecure = true;
        } else if tok == "-d" || tok == "--data" || tok == "--data-raw" || tok == "--data-binary" || tok == "--data-ascii" || tok == "--data-urlencode" || tok == "--url-query" {
            i += 1;
            if let Some(d) = tokens.get(i) { data_items.push(d.clone()); }
        } else if let Some(d) = tok.strip_prefix("--data=")
            .or_else(|| tok.strip_prefix("--data-raw="))
            .or_else(|| tok.strip_prefix("--data-binary="))
            .or_else(|| tok.strip_prefix("--data-ascii="))
            .or_else(|| tok.strip_prefix("--data-urlencode="))
            .or_else(|| tok.strip_prefix("--url-query="))
            .or_else(|| if tok.starts_with("-d") && tok.len() > 2 { Some(&tok[2..]) } else { None })
        {
            data_items.push(d.to_string());
        } else if tok == "-b" || tok == "--cookie" {
            i += 1;
            if let Some(c) = tokens.get(i).filter(|c| c.contains('=')) {
                match headers.iter_mut().find(|h| h.key.eq_ignore_ascii_case("cookie")) {
                    Some(h) => { h.value.push_str("; "); h.value.push_str(c); }
                    None => headers.push(KV { key: "Cookie".into(), value: c.clone(), enabled: Some(true) }),
                }
            }
        } else if let Some(c) = tok.strip_prefix("--cookie=").or_else(|| if tok.starts_with("-b") && tok.len() > 2 { Some(&tok[2..]) } else { None }) {
            if c.contains('=') {
                match headers.iter_mut().find(|h| h.key.eq_ignore_ascii_case("cookie")) {
                    Some(h) => { h.value.push_str("; "); h.value.push_str(c); }
                    None => headers.push(KV { key: "Cookie".into(), value: c.to_string(), enabled: Some(true) }),
                }
            }
        } else if tok == "-u" || tok == "--user" {
            i += 1;
            if let Some(u) = tokens.get(i) {
                let (user, pass) = u.split_once(':').unwrap_or((u.as_str(), ""));
                auth = serde_json::json!({ "type": "basic", "username": user, "password": pass });
            }
        } else if let Some(u) = tok.strip_prefix("--user=").or_else(|| if tok.starts_with("-u") && tok.len() > 2 { Some(&tok[2..]) } else { None }) {
            let (user, pass) = u.split_once(':').unwrap_or((u, ""));
            auth = serde_json::json!({ "type": "basic", "username": user, "password": pass });
        } else if tok == "--url" {
            i += 1;
            if let Some(u) = tokens.get(i) { url = u.clone(); }
        } else if let Some(u) = tok.strip_prefix("--url=") {
            url = u.to_string();
        } else if tok.starts_with("http://") || tok.starts_with("https://") {
            url = tok.clone();
        } else if tok.starts_with('-') {
            if matches!(tok.as_str(), "-o" | "--output" | "-m" | "--max-time" | "--connect-timeout" | "--retry" | "-x" | "--proxy" | "--cacert" | "--cert" | "--key" | "-F" | "--form") {
                i += 1;
            }
        } else if url.is_empty() {
            url = tok.clone();
        }
        i += 1;
    }

    if url.is_empty() { return Err("no URL found in curl command".into()); }
    // `-u` already filled auth; it wins over any `-H 'Authorization: ...'`
    super::hoist_auth_header(&mut headers, &mut auth);

    let method = method.unwrap_or_else(|| {
        if is_get {
            "GET".into()
        } else if !data_items.is_empty() {
            "POST".into()
        } else {
            "GET".into()
        }
    });

    let (params, body) = if is_get {
        let params = data_items.iter().map(|item| {
            let (k, v) = parse_kv_param(item);
            KV { key: percent_decode(&k), value: percent_decode(&v), enabled: Some(true) }
        }).collect();
        (params, serde_json::json!({ "type": "none" }))
    } else {
        let body = if data_items.is_empty() {
            serde_json::json!({ "type": "none" })
        } else {
            let content = data_items.join("&");
            let t = if content.trim_start().starts_with('{') || content.trim_start().starts_with('[') { "json" } else { "text" };
            serde_json::json!({ "type": t, "content": content })
        };
        (vec![], body)
    };

    Ok(Request {
        name: url_name(&url),
        protocol: "http".into(),
        http: Some(HttpPart { method, url, headers, path_params: vec![], params, auth, body, insecure }),
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
