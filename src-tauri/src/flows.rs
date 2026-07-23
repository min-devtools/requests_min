use crate::collection::{root_dir, write_sorted_json};
use std::path::{Path, PathBuf};

fn flows_dir(root: &Path) -> PathBuf { root.join("flows") }

/// IDs are frontend-generated slugs; reject anything that could traverse paths.
fn flow_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(format!("invalid flow id: {id}"));
    }
    Ok(flows_dir(root).join(format!("{id}.json")))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowMeta { pub id: String, pub name: String, pub node_count: usize }

pub fn list_flows(root: &Path) -> Result<Vec<FlowMeta>, String> {
    let dir = flows_dir(root);
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(format!("failed to list flows at '{}': {error}", dir.display())),
    };
    let mut flows = Vec::new();
    for entry in entries {
        let path = entry
            .map_err(|error| format!("failed to list flows at '{}': {error}", dir.display()))?
            .path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") { continue; }
        let Some(file_id) = path.file_stem().and_then(|stem| stem.to_str()).map(str::to_string) else { continue };
        if flow_path(root, &file_id).is_err() { continue; }
        let text = std::fs::read_to_string(&path)
            .map_err(|error| format!("failed to list flow '{file_id}' at '{}': {error}", path.display()))?;
        let Ok(flow) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        if flow.get("id").and_then(serde_json::Value::as_str) != Some(&file_id) { continue; }
        flows.push(FlowMeta {
            id: file_id,
            name: flow.get("name").and_then(|name| name.as_str()).unwrap_or("(unnamed)").to_string(),
            node_count: flow.get("nodes").and_then(|nodes| nodes.as_array()).map_or(0, |nodes| nodes.len()),
        });
    }
    flows.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(flows)
}

#[tauri::command]
pub fn flow_list() -> Result<Vec<FlowMeta>, String> { list_flows(&root_dir()) }

fn operation_flow_path(root: &Path, id: &str, operation: &str) -> Result<PathBuf, String> {
    flow_path(root, id).map_err(|error| {
        format!("failed to {operation} flow '{id}' under '{}': {error}", flows_dir(root).display())
    })
}

fn read_flow(root: &Path, id: &str) -> Result<serde_json::Value, String> {
    let path = operation_flow_path(root, id, "read")?;
    let text = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read flow '{id}' at '{}': {error}", path.display()))?;
    serde_json::from_str(&text)
        .map_err(|error| format!("failed to read flow '{id}' at '{}': {error}", path.display()))
}

fn write_flow(root: &Path, id: &str, flow: &serde_json::Value) -> Result<(), String> {
    let path = operation_flow_path(root, id, "write")?;
    let embedded_id = flow.get("id").and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("failed to write flow '{id}' at '{}': top-level id must be a string", path.display()))?;
    flow_path(root, embedded_id).map_err(|error| {
        format!("failed to write flow '{id}' at '{}': invalid embedded id '{embedded_id}': {error}", path.display())
    })?;
    if embedded_id != id {
        return Err(format!(
            "failed to write flow '{id}' at '{}': embedded id '{embedded_id}' does not match",
            path.display()
        ));
    }
    write_sorted_json(&path, flow)
        .map_err(|error| format!("failed to write flow '{id}' at '{}': {error}", path.display()))
}

fn delete_flow(root: &Path, id: &str) -> Result<(), String> {
    let path = operation_flow_path(root, id, "delete")?;
    std::fs::remove_file(&path)
        .map_err(|error| format!("failed to delete flow '{id}' at '{}': {error}", path.display()))
}

fn export_flow(root: &Path, id: &str, dest: &Path) -> Result<(), String> {
    let path = operation_flow_path(root, id, "export")?;
    std::fs::copy(&path, dest).map_err(|error| {
        format!(
            "failed to export flow '{id}' from '{}' to '{}': {error}",
            path.display(),
            dest.display()
        )
    })?;
    Ok(())
}

#[tauri::command]
pub fn flow_read(id: String) -> Result<serde_json::Value, String> {
    read_flow(&root_dir(), &id)
}

#[tauri::command]
pub fn flow_write(id: String, flow: serde_json::Value) -> Result<(), String> {
    write_flow(&root_dir(), &id, &flow)
}

#[tauri::command]
pub fn flow_delete(id: String) -> Result<(), String> {
    delete_flow(&root_dir(), &id)
}

#[tauri::command]
pub fn flow_export(id: String, dest: String) -> Result<(), String> {
    export_flow(&root_dir(), &id, Path::new(&dest))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("rm-flow-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn roundtrip_and_list() {
        let root = temp_root("rt");
        let export_path = root.join("exported-flow.json");
        let flow = serde_json::json!({"id":"f1","name":"Login flow","nodes":[{"id":"n1"}],"edges":[]});
        write_flow(&root, "f1", &flow).unwrap();

        assert_eq!(read_flow(&root, "f1").unwrap(), flow);
        let flows = list_flows(&root).unwrap();
        assert_eq!(flows.len(), 1);
        assert_eq!(flows[0].id, "f1");
        assert_eq!(flows[0].name, "Login flow");
        assert_eq!(flows[0].node_count, 1);

        export_flow(&root, "f1", &export_path).unwrap();
        let exported: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(export_path).unwrap()).unwrap();
        assert_eq!(exported, flow);

        delete_flow(&root, "f1").unwrap();
        assert!(!flow_path(&root, "f1").unwrap().exists());
    }

    #[test]
    fn list_skips_mismatched_embedded_ids() {
        let root = temp_root("mismatched-list-id");
        let flow = serde_json::json!({"id":"../evil","name":"Unsafe","nodes":[],"edges":[]});
        write_sorted_json(&flow_path(&root, "f1").unwrap(), &flow).unwrap();

        assert!(list_flows(&root).unwrap().is_empty());
    }

    #[test]
    fn write_rejects_mismatched_embedded_id() {
        let root = temp_root("mismatched-write-id");
        let flow = serde_json::json!({"id":"f2","name":"Wrong ID","nodes":[],"edges":[]});

        let error = write_flow(&root, "f1", &flow).unwrap_err();

        assert!(error.contains("f1"));
        assert!(error.contains("f2"));
        assert!(!flow_path(&root, "f1").unwrap().exists());
    }

    #[test]
    fn list_reports_non_directory_storage() {
        let root = temp_root("list-io-error");
        std::fs::write(root.join("flows"), "not a directory").unwrap();

        let error = match list_flows(&root) {
            Err(error) => error,
            Ok(_) => panic!("listing a regular file must fail"),
        };

        assert!(error.contains("list flows"));
        assert!(error.contains(root.join("flows").to_string_lossy().as_ref()));
    }

    #[test]
    fn rejects_bad_ids() {
        assert!(flow_path(Path::new("/x"), "../evil").is_err());
        assert!(flow_path(Path::new("/x"), "a/b").is_err());
        assert!(flow_path(Path::new("/x"), "").is_err());
    }
}
