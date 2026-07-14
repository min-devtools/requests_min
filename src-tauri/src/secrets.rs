use crate::collection::{root_dir, write_sorted_json};
use std::collections::HashMap;
use std::path::Path;

fn secret_path(root: &Path, collection_id: &str, env: &str) -> std::path::PathBuf {
    root.join("secrets").join(collection_id).join(format!("{env}.json"))
}

pub fn read_secrets(root: &Path, collection_id: &str, env: &str) -> Result<HashMap<String, String>, String> {
    let p = secret_path(root, collection_id, env);
    let text = match std::fs::read_to_string(&p) { Ok(t) => t, Err(_) => return Ok(HashMap::new()) };
    let val: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(serde_json::from_value(val.get("vars").cloned().unwrap_or_default()).unwrap_or_default())
}

pub fn write_secrets(root: &Path, collection_id: &str, env: &str, vars: &HashMap<String, String>) -> Result<(), String> {
    write_sorted_json(&secret_path(root, collection_id, env), &serde_json::json!({ "vars": vars }))
}

#[tauri::command]
pub fn secret_read(collection_id: String, env: String) -> Result<HashMap<String, String>, String> {
    read_secrets(&root_dir(), &collection_id, &env)
}

#[tauri::command]
pub fn secret_write(collection_id: String, env: String, vars: HashMap<String, String>) -> Result<(), String> {
    write_secrets(&root_dir(), &collection_id, &env, &vars)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_roundtrip_and_missing_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_secrets(dir.path(), "c1", "dev").unwrap().is_empty());
        let mut v = std::collections::HashMap::new();
        v.insert("token".into(), "s3cr3t".into());
        write_secrets(dir.path(), "c1", "dev", &v).unwrap();
        assert_eq!(read_secrets(dir.path(), "c1", "dev").unwrap()["token"], "s3cr3t");
    }
}
