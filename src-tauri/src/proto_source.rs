// Shared, workspace-global proto definitions. A request references one by id
// (GrpcPart.source_id) instead of carrying its own absolute .proto paths, so the
// same schema is defined once and reused everywhere. Stored flat in one file for
// easy reordering; describe results are cached separately (see grpc::describe_source).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::collection::root_dir;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProtoSource {
    pub id: String,
    pub name: String,
    pub kind: String,               // "files" | "reflection"
    pub files: Vec<String>,         // kind=files: entry .proto paths
    pub import_paths: Vec<String>,  // kind=files: extra -I dirs
    pub endpoint: String,           // kind=reflection: supports {{var}}
    pub insecure: bool,
}

fn sources_path() -> PathBuf { root_dir().join("proto-sources.json") }
pub(crate) fn cache_dir() -> PathBuf { root_dir().join("proto-cache") }
pub(crate) fn cache_path(id: &str) -> PathBuf { cache_dir().join(format!("{id}.json")) }

pub fn read_sources() -> Result<Vec<ProtoSource>, String> {
    let p = sources_path();
    if !p.exists() { return Ok(Vec::new()); }
    let s = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

fn write_sources(list: &[ProtoSource]) -> Result<(), String> {
    let p = sources_path();
    if let Some(parent) = p.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let mut s = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    s.push('\n');
    std::fs::write(&p, s).map_err(|e| e.to_string())
}

pub fn find_source(id: &str) -> Result<ProtoSource, String> {
    read_sources()?.into_iter().find(|s| s.id == id)
        .ok_or_else(|| format!("proto source '{id}' not found"))
}

#[tauri::command]
pub fn proto_source_list() -> Result<Vec<ProtoSource>, String> { read_sources() }

/// Upsert by id (the frontend generates the id).
#[tauri::command]
pub fn proto_source_save(source: ProtoSource) -> Result<(), String> {
    let mut list = read_sources()?;
    match list.iter_mut().find(|s| s.id == source.id) {
        Some(existing) => *existing = source,
        None => list.push(source),
    }
    write_sources(&list)
}

#[tauri::command]
pub fn proto_source_delete(id: String) -> Result<(), String> {
    let mut list = read_sources()?;
    list.retain(|s| s.id != id);
    write_sources(&list)?;
    let _ = std::fs::remove_file(cache_path(&id)); // stale cache is harmless, ignore errors
    Ok(())
}
