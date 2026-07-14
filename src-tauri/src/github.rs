use crate::collection::{collections_dir, root_dir};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use walkdir::WalkDir;

const STORE_FILE: &str = "gh.json";
const API: &str = "https://api.github.com";
const DEFAULT_BRANCH: &str = "main";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeEntry { pub path: String, pub content: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhStatus {
    pub connected: bool,
    pub login: Option<String>,
    pub repo: Option<String>,
    pub last_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResult { pub updated: bool, pub conflict: bool, pub remote_sha: String }

/// Walk a directory into forward-slash-relative (path, content) entries. Pure.
pub fn collect_tree_entries(root: &Path) -> Result<Vec<TreeEntry>, String> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root).into_iter().flatten() {
        if !entry.file_type().is_file() { continue; }
        let rel = entry.path().strip_prefix(root).map_err(|e| e.to_string())?
            .to_string_lossy().replace('\\', "/");
        let content = std::fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
        out.push(TreeEntry { path: rel, content });
    }
    Ok(out)
}

// ---- store helpers ----

fn store_get(app: &AppHandle, key: &str) -> Option<String> {
    let store = app.store(STORE_FILE).ok()?;
    store.get(key).and_then(|v| v.as_str().map(|s| s.to_string()))
}
fn store_set(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(key, serde_json::Value::String(value.to_string()));
    store.save().map_err(|e| e.to_string())
}
fn token(app: &AppHandle) -> Result<String, String> {
    store_get(app, "token").filter(|t| !t.is_empty()).ok_or("no GitHub token set".into())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().build().map_err(|e| e.to_string())
}
fn auth(rb: reqwest::RequestBuilder, tok: &str) -> reqwest::RequestBuilder {
    rb.header("Authorization", format!("Bearer {tok}"))
        .header("User-Agent", "RequestsMin")
        .header("Accept", "application/vnd.github+json")
}

async fn get_json(c: &reqwest::Client, tok: &str, url: &str) -> Result<(u16, serde_json::Value), String> {
    let resp = auth(c.get(url), tok).send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let val = resp.json::<serde_json::Value>().await.unwrap_or(serde_json::Value::Null);
    Ok((status, val))
}
async fn post_json(c: &reqwest::Client, tok: &str, url: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let resp = auth(c.post(url), tok).json(&body).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let val = resp.json::<serde_json::Value>().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() { return Err(format!("GitHub {status}: {val}")); }
    Ok(val)
}
async fn patch_json(c: &reqwest::Client, tok: &str, url: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let resp = auth(c.patch(url), tok).json(&body).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let val = resp.json::<serde_json::Value>().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() { return Err(format!("GitHub {status}: {val}")); }
    Ok(val)
}
async fn put_json(c: &reqwest::Client, tok: &str, url: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let resp = auth(c.put(url), tok).json(&body).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let val = resp.json::<serde_json::Value>().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() { return Err(format!("GitHub {status}: {val}")); }
    Ok(val)
}

async fn login_of(c: &reqwest::Client, tok: &str) -> Result<String, String> {
    let (status, v) = get_json(c, tok, &format!("{API}/user")).await?;
    if status != 200 { return Err(format!("GitHub auth failed ({status})")); }
    v.get("login").and_then(|l| l.as_str()).map(|s| s.to_string()).ok_or("no login in /user response".into())
}

fn now_ts() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
}

// ---- commands ----

#[tauri::command]
pub fn gh_set_token(app: AppHandle, token: String) -> Result<(), String> {
    store_set(&app, "token", &token)
}

#[tauri::command]
pub async fn gh_status(app: AppHandle) -> Result<GhStatus, String> {
    let tok = match token(&app) { Ok(t) => t, Err(_) => return Ok(GhStatus { connected: false, login: None, repo: None, last_sha: None }) };
    let c = client()?;
    let login = login_of(&c, &tok).await.ok();
    Ok(GhStatus {
        connected: login.is_some(),
        login,
        repo: store_get(&app, "repo"),
        last_sha: store_get(&app, "last_sha"),
    })
}

#[tauri::command]
pub async fn gh_configure(app: AppHandle, repo: String) -> Result<(), String> {
    let tok = token(&app)?;
    let c = client()?;
    let (owner, name) = match repo.split_once('/') {
        Some((o, n)) => (o.to_string(), n.to_string()),
        None => (login_of(&c, &tok).await?, repo.clone()),
    };
    let (status, mut details) = get_json(&c, &tok, &format!("{API}/repos/{owner}/{name}")).await?;
    if status == 404 {
        post_json(&c, &tok, &format!("{API}/user/repos"),
            serde_json::json!({ "name": name, "private": true, "auto_init": true })).await?;
        let (_, created) = get_json(&c, &tok, &format!("{API}/repos/{owner}/{name}")).await?;
        details = created;
    } else if status != 200 {
        return Err(format!("GitHub repo check failed ({status})"));
    }
    let branch = details.get("default_branch").and_then(|v| v.as_str()).unwrap_or(DEFAULT_BRANCH);
    let (ref_status, _) = get_json(&c, &tok, &format!("{API}/repos/{owner}/{name}/git/ref/heads/{branch}")).await?;
    // 404 = branch missing, 409 = repository has no commits at all.
    // Omit "branch": on an empty repo GitHub rejects an explicit branch that has
    // no commits yet; without it the commit lands on the default branch.
    if ref_status == 404 || ref_status == 409 {
        put_json(&c, &tok, &format!("{API}/repos/{owner}/{name}/contents/.requestsmin"), serde_json::json!({
            "message": "Initialize RequestsMin collections",
            "content": base64::engine::general_purpose::STANDARD.encode("RequestsMin collection storage\n"),
        })).await?;
    } else if ref_status != 200 {
        return Err(format!("GitHub branch check failed ({ref_status})"));
    }
    store_set(&app, "repo", &format!("{owner}/{name}"))
        .and_then(|_| store_set(&app, "branch", branch))
}

fn owner_name(app: &AppHandle) -> Result<(String, String), String> {
    let repo = store_get(app, "repo").ok_or("no repo configured — call gh_configure first")?;
    repo.split_once('/').map(|(o, n)| (o.to_string(), n.to_string())).ok_or("bad repo format".into())
}
fn branch(app: &AppHandle) -> String { store_get(app, "branch").unwrap_or_else(|| DEFAULT_BRANCH.into()) }

#[tauri::command]
pub async fn gh_push(app: AppHandle, message: Option<String>) -> Result<String, String> {
    let tok = token(&app)?;
    let (owner, name) = owner_name(&app)?;
    let c = client()?;
    let base = format!("{API}/repos/{owner}/{name}");
    let branch = branch(&app);

    // base commit from ref
    let (rs, rv) = get_json(&c, &tok, &format!("{base}/git/ref/heads/{branch}")).await?;
    if rs != 200 { return Err(format!("cannot read branch {branch} ({rs})")); }
    let base_sha = rv.pointer("/object/sha").and_then(|s| s.as_str()).ok_or("no base sha")?.to_string();

    // blobs
    let entries = collect_tree_entries(&collections_dir())?;
    if entries.is_empty() { return Err("no local collections to push".into()); }
    let mut tree = Vec::new();
    for e in &entries {
        let b64 = base64::engine::general_purpose::STANDARD.encode(e.content.as_bytes());
        let blob = post_json(&c, &tok, &format!("{base}/git/blobs"),
            serde_json::json!({ "content": b64, "encoding": "base64" })).await?;
        let sha = blob.get("sha").and_then(|s| s.as_str()).ok_or("no blob sha")?;
        tree.push(serde_json::json!({ "path": format!("collections/{}", e.path), "mode": "100644", "type": "blob", "sha": sha }));
    }

    // tree (full, no base_tree) → commit → move ref
    let tree_resp = post_json(&c, &tok, &format!("{base}/git/trees"), serde_json::json!({ "tree": tree })).await?;
    let tree_sha = tree_resp.get("sha").and_then(|s| s.as_str()).ok_or("no tree sha")?;
    let msg = message.unwrap_or_else(|| "RequestsMin sync".into());
    let commit = post_json(&c, &tok, &format!("{base}/git/commits"),
        serde_json::json!({ "message": msg, "tree": tree_sha, "parents": [base_sha] })).await?;
    let commit_sha = commit.get("sha").and_then(|s| s.as_str()).ok_or("no commit sha")?.to_string();
    patch_json(&c, &tok, &format!("{base}/git/refs/heads/{branch}"), serde_json::json!({ "sha": commit_sha })).await?;

    store_set(&app, "last_sha", &commit_sha)?;
    store_set(&app, "last_push_ts", &now_ts().to_string())?;
    Ok(commit_sha)
}

fn any_local_change_since(ts: u64) -> bool {
    WalkDir::new(collections_dir()).into_iter().flatten()
        .filter(|e| e.file_type().is_file())
        .any(|e| e.metadata().ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() > ts).unwrap_or(false))
}

#[tauri::command]
pub async fn gh_pull(app: AppHandle, force: bool) -> Result<PullResult, String> {
    let tok = token(&app)?;
    let (owner, name) = owner_name(&app)?;
    let c = client()?;
    let base = format!("{API}/repos/{owner}/{name}");
    let branch = branch(&app);

    let (rs, rv) = get_json(&c, &tok, &format!("{base}/git/ref/heads/{branch}")).await?;
    if rs != 200 { return Err(format!("cannot read branch {branch} ({rs})")); }
    let remote_sha = rv.pointer("/object/sha").and_then(|s| s.as_str()).ok_or("no remote sha")?.to_string();

    let last_sha = store_get(&app, "last_sha");
    if last_sha.as_deref() == Some(remote_sha.as_str()) {
        return Ok(PullResult { updated: false, conflict: false, remote_sha });
    }

    // conflict: remote moved AND local edited since last push
    let last_ts: u64 = store_get(&app, "last_push_ts").and_then(|s| s.parse().ok()).unwrap_or(0);
    let local_changed = any_local_change_since(last_ts);
    if last_sha.is_some() && local_changed && !force {
        return Ok(PullResult { updated: false, conflict: true, remote_sha });
    }

    // fetch full remote tree
    let (ts_s, tree) = get_json(&c, &tok, &format!("{base}/git/trees/{remote_sha}?recursive=1")).await?;
    if ts_s != 200 { return Err(format!("cannot read tree ({ts_s})")); }
    let items = tree.get("tree").and_then(|t| t.as_array()).cloned().unwrap_or_default();

    let root = root_dir();
    let mut remote_paths: HashSet<String> = HashSet::new();
    for item in &items {
        if item.get("type").and_then(|t| t.as_str()) != Some("blob") { continue; }
        let path = match item.get("path").and_then(|p| p.as_str()) { Some(p) if p.starts_with("collections/") => p, _ => continue };
        let sha = item.get("sha").and_then(|s| s.as_str()).ok_or("no blob sha in tree")?;
        let (bs, bv) = get_json(&c, &tok, &format!("{base}/git/blobs/{sha}")).await?;
        if bs != 200 { return Err(format!("cannot read blob ({bs})")); }
        let b64: String = bv.get("content").and_then(|x| x.as_str()).unwrap_or("").split_whitespace().collect();
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
        let dest = root.join(path);
        if let Some(parent) = dest.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
        remote_paths.insert(path.to_string());
    }

    // delete local files under collections/ that no longer exist remotely
    for e in WalkDir::new(collections_dir()).into_iter().flatten().filter(|e| e.file_type().is_file()) {
        let rel = e.path().strip_prefix(&root).map_err(|x| x.to_string())?.to_string_lossy().replace('\\', "/");
        if !remote_paths.contains(&rel) { let _ = std::fs::remove_file(e.path()); }
    }

    store_set(&app, "last_sha", &remote_sha)?;
    store_set(&app, "last_push_ts", &now_ts().to_string())?;
    Ok(PullResult { updated: true, conflict: false, remote_sha })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_tree_entries_lists_files_rel_paths() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("collections/c1/orders")).unwrap();
        std::fs::write(dir.path().join("collections/c1/collection.json"), "{}\n").unwrap();
        std::fs::write(dir.path().join("collections/c1/orders/get.json"), "{}\n").unwrap();
        let entries = collect_tree_entries(&dir.path().join("collections")).unwrap();
        let paths: Vec<_> = entries.iter().map(|e| e.path.as_str()).collect();
        assert!(paths.contains(&"c1/collection.json"));
        assert!(paths.contains(&"c1/orders/get.json"));
    }
}
