use prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor, SerializeOptions};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tonic::transport::{Channel, ClientTlsConfig};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcCatalog {
    pub services: Vec<GrpcService>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcService { pub name: String, pub methods: Vec<GrpcMethod> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcMethod {
    pub name: String,
    pub input_type: String,
    pub output_type: String,
    pub client_streaming: bool,
    pub server_streaming: bool,
    pub input_template: String,
}

/// Build a descriptor pool from local `.proto` files (pure-Rust compile via protox).
pub fn pool_from_files(paths: &[String]) -> Result<DescriptorPool, String> {
    pool_from_files_ex(paths, &[])
}

/// Same, plus explicit extra include dirs (`-I`) for imports that don't sit next to the entry files.
/// Entries in `paths` may be directories: they become include roots and every `.proto` under them
/// compiles with a consistent root-relative name, so package-style imports never double-load a file.
pub fn pool_from_files_ex(paths: &[String], import_paths: &[String]) -> Result<DescriptorPool, String> {
    let (entries, includes) = expand_entries(paths, import_paths);
    if entries.is_empty() { return Err("no .proto files found".into()); }
    compile_pool(&entries, includes, &entries)
}

/// Expand picked paths (files and/or folders) into concrete entry files + include roots.
fn expand_entries(paths: &[String], import_paths: &[String]) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut includes: Vec<PathBuf> = import_paths.iter().map(PathBuf::from).collect();
    let mut entries: Vec<PathBuf> = Vec::new();
    let mut loose: Vec<PathBuf> = Vec::new();
    for p in paths {
        let path = PathBuf::from(p);
        if path.is_dir() {
            includes.push(path.clone());
            collect_protos(&path, &mut entries);
        } else {
            loose.push(path);
        }
    }
    // Same file picked twice (loose + inside a picked folder) → keep one, or protox sees two names.
    let canon = |p: &PathBuf| std::fs::canonicalize(p).unwrap_or_else(|_| p.clone());
    let mut seen: std::collections::HashSet<PathBuf> = entries.iter().map(&canon).collect();
    for f in loose {
        if seen.insert(canon(&f)) {
            // Only loose files contribute their parent dir; folder-scanned files must resolve
            // via the folder root or they'd get a second (basename-only) identity.
            if let Some(parent) = f.parent() { includes.push(parent.to_path_buf()); }
            entries.push(f);
        }
    }
    entries.sort();
    includes.dedup();
    (entries, includes)
}

/// Compile with auto-derived include roots. Repos often import relative to an inner root
/// (Java: src/main/proto → `import "promotion-service.proto"`). On "import 'X' not found",
/// locate X among `derive_from`, derive the root that makes it resolve, and retry with that
/// root FIRST so every file keeps one consistent name (no double-load).
fn compile_pool(entry: &[PathBuf], mut includes: Vec<PathBuf>, derive_from: &[PathBuf]) -> Result<DescriptorPool, String> {
    let mut attempts = 0;
    loop {
        match protox::compile(entry, &includes) {
            Ok(fds) => return DescriptorPool::from_file_descriptor_set(fds).map_err(|e| e.to_string()),
            Err(e) => {
                let msg = e.to_string();
                attempts += 1;
                if attempts <= 20 {
                    if let Some(root) = missing_import_root(&msg, derive_from) {
                        if !includes.contains(&root) {
                            includes.insert(0, root);
                            continue;
                        }
                    }
                }
                return Err(friendly_protox_err(msg));
            }
        }
    }
}

/// Whole-source catalog. Fast path: everything in one pool. If the files conflict (no-package
/// proto trees with several versions side by side — same message names, different shapes),
/// fall back to compiling each file on its own and merge at the CATALOG level: every service
/// keeps its own self-consistent schema, broken/conflicting files become warnings, not errors.
/// Returns the catalog plus a service → entry-file map used at call time to rebuild the pool.
pub fn catalog_for_files(paths: &[String], import_paths: &[String])
    -> Result<(GrpcCatalog, HashMap<String, String>), String>
{
    let (entries, includes) = expand_entries(paths, import_paths);
    if entries.is_empty() { return Err("no .proto files found".into()); }
    if let Ok(pool) = compile_pool(&entries, includes.clone(), &entries) {
        return Ok((catalog_from_pool(&pool), HashMap::new()));
    }
    let mut services: Vec<GrpcService> = Vec::new();
    let mut service_files: HashMap<String, String> = HashMap::new();
    let mut warnings: Vec<String> = Vec::new();
    for f in &entries {
        let mut inc = includes.clone();
        if let Some(p) = f.parent() { inc.push(p.to_path_buf()); }
        match compile_pool(std::slice::from_ref(f), inc, &entries) {
            Ok(pool) => {
                for svc in catalog_from_pool(&pool).services {
                    // first entry wins on duplicates (imported services show up in several pools)
                    if !service_files.contains_key(&svc.name) {
                        service_files.insert(svc.name.clone(), f.to_string_lossy().into_owned());
                        services.push(svc);
                    }
                }
            }
            Err(e) => {
                let name = f.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                warnings.push(format!("{name}: {}", e.lines().next().unwrap_or("compile failed")));
            }
        }
    }
    if services.is_empty() {
        return Err(format!("no service compiled.\n{}", warnings.join("\n")));
    }
    Ok((GrpcCatalog { services, warnings }, service_files))
}

/// From `import 'x/y.proto' not found`, find a scanned file ending in `/x/y.proto`
/// and return the prefix dir — the include root that would make the import resolve.
fn missing_import_root(msg: &str, entries: &[PathBuf]) -> Option<PathBuf> {
    let name = msg.split("import '").nth(1)?.split('\'').next()?;
    let suffix = format!("/{name}");
    entries.iter().find_map(|p| p.to_string_lossy().strip_suffix(&suffix).map(PathBuf::from))
}

fn collect_protos(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name();
        let name = name.to_string_lossy();
        // skip dependency/VCS noise when scanning a folder source
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "vendor" {
            continue;
        }
        if p.is_dir() { collect_protos(&p, out); }
        else if p.extension().is_some_and(|x| x == "proto") { out.push(p); }
    }
}

fn friendly_protox_err(msg: String) -> String {
    if msg.contains("not found") {
        format!("{msg}\n\nHint: the imported file isn't inside this source. Add the folder that contains it with \"Add import path\".")
    } else if msg.contains("shadow") {
        format!("{msg}\n\nHint: two include roots contain the same file path — this source mixes two copies (or versions) of the same proto tree. Keep one copy per source: split them into separate proto sources and switch between them.")
    } else if msg.contains("already defined") || msg.contains("defined twice") {
        format!("{msg}\n\nHint: a .proto was loaded twice under two names. Files that other files import are resolved automatically — remove them from the source, or import the whole folder instead of individual files.")
    } else {
        msg
    }
}

fn template_for(desc: &MessageDescriptor) -> String {
    let msg = DynamicMessage::new(desc.clone());
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::new(&mut buf);
    let opts = SerializeOptions::new().skip_default_fields(false);
    let _ = msg.serialize_with_options(&mut ser, &opts);
    String::from_utf8(buf).unwrap_or_else(|_| "{}".into())
}

pub fn catalog_from_pool(pool: &DescriptorPool) -> GrpcCatalog {
    let mut services = Vec::new();
    for svc in pool.services() {
        let mut methods = Vec::new();
        for m in svc.methods() {
            let input = m.input();
            methods.push(GrpcMethod {
                name: m.name().to_string(),
                input_type: input.full_name().to_string(),
                output_type: m.output().full_name().to_string(),
                client_streaming: m.is_client_streaming(),
                server_streaming: m.is_server_streaming(),
                input_template: template_for(&input),
            });
        }
        services.push(GrpcService { name: svc.full_name().to_string(), methods });
    }
    GrpcCatalog { services, warnings: Vec::new() }
}

pub fn describe_from_files(paths: &[String]) -> Result<GrpcCatalog, String> {
    Ok(catalog_from_pool(&pool_from_files(paths)?))
}

/// gRPC channel: plaintext for `http://`, TLS (native roots) for `https://`.
pub(crate) async fn channel(endpoint: &str, insecure: bool) -> Result<Channel, String> {
    let mut ep = Channel::from_shared(endpoint.to_string()).map_err(|e| e.to_string())?;
    if endpoint.starts_with("https") {
        // ponytail: insecure TLS (skip cert verify) not wired; add a rustls custom verifier if a self-signed host needs it
        let _ = insecure;
        ep = ep.tls_config(ClientTlsConfig::new().with_native_roots()).map_err(|e| e.to_string())?;
    }
    ep.connect().await.map_err(|e| e.to_string())
}

// ---- reflection (v1) ----
// ponytail: v1 only. Some older servers expose only v1alpha reflection; add a fallback when a real server needs it.

async fn reflect_list_services(channel: Channel) -> Result<Vec<String>, String> {
    use tonic_reflection::pb::v1::{
        server_reflection_client::ServerReflectionClient,
        server_reflection_request::MessageRequest,
        server_reflection_response::MessageResponse,
        ServerReflectionRequest,
    };
    use futures_util::StreamExt;
    let mut client = ServerReflectionClient::new(channel);
    let req = ServerReflectionRequest { host: String::new(), message_request: Some(MessageRequest::ListServices(String::new())) };
    let mut stream = client.server_reflection_info(futures_util::stream::iter(vec![req]))
        .await.map_err(|e| e.to_string())?.into_inner();
    while let Some(resp) = stream.next().await {
        let resp = resp.map_err(|e| e.to_string())?;
        if let Some(MessageResponse::ListServicesResponse(l)) = resp.message_response {
            return Ok(l.service.into_iter().map(|s| s.name)
                .filter(|n| !n.starts_with("grpc.reflection.")).collect());
        }
    }
    Err("no ListServices response".into())
}

async fn reflect_files_for_symbols(channel: Channel, symbols: &[String]) -> Result<Vec<Vec<u8>>, String> {
    use tonic_reflection::pb::v1::{
        server_reflection_client::ServerReflectionClient,
        server_reflection_request::MessageRequest,
        server_reflection_response::MessageResponse,
        ServerReflectionRequest,
    };
    use futures_util::StreamExt;
    let mut client = ServerReflectionClient::new(channel);
    let reqs: Vec<_> = symbols.iter().map(|s| ServerReflectionRequest {
        host: String::new(),
        message_request: Some(MessageRequest::FileContainingSymbol(s.clone())),
    }).collect();
    let mut stream = client.server_reflection_info(futures_util::stream::iter(reqs))
        .await.map_err(|e| e.to_string())?.into_inner();
    let mut out = Vec::new();
    while let Some(resp) = stream.next().await {
        let resp = resp.map_err(|e| e.to_string())?;
        if let Some(MessageResponse::FileDescriptorResponse(f)) = resp.message_response {
            out.extend(f.file_descriptor_proto);
        }
    }
    Ok(out)
}

pub(crate) fn pool_from_fd_bytes(bytes: Vec<Vec<u8>>) -> Result<DescriptorPool, String> {
    use prost::Message;
    let mut by_name: HashMap<String, prost_types::FileDescriptorProto> = HashMap::new();
    for b in bytes {
        let fdp = prost_types::FileDescriptorProto::decode(b.as_slice()).map_err(|e| e.to_string())?;
        by_name.insert(fdp.name().to_string(), fdp);
    }
    let set = prost_types::FileDescriptorSet { file: by_name.into_values().collect() };
    // ponytail: from_file_descriptor_set expects dep order; if a server returns files out of order and this errors, topo-sort first
    DescriptorPool::from_file_descriptor_set(set).map_err(|e| e.to_string())
}

pub async fn describe_via_reflection(endpoint: &str, insecure: bool) -> Result<GrpcCatalog, String> {
    let ch = channel(endpoint, insecure).await?;
    let services = reflect_list_services(ch.clone()).await?;
    let bytes = reflect_files_for_symbols(ch, &services).await?;
    Ok(catalog_from_pool(&pool_from_fd_bytes(bytes)?))
}

fn describe_endpoint(endpoint: Option<String>, ctx: &HashMap<String, String>) -> Result<Option<String>, String> {
    endpoint.map(|ep| interpolate(&ep, ctx)).transpose()
}

fn ctx_for(env: &Option<String>) -> Result<HashMap<String, String>, String> {
    let root = root_dir();
    let (env_vars, secret_vars) = match env {
        Some(e) => (read_env(&root, e)?, read_secrets(&root, e)?),
        None => (HashMap::new(), HashMap::new()),
    };
    Ok(build_ctx(env_vars, secret_vars))
}

// ---- catalog cache (per proto source) ----
// Files sources cache against entry-file mtimes so an edited proto auto-re-describes on open.
// Folder entries expand to every .proto inside, so adds/edits/removals under a folder bust the
// cache too. ponytail: loose-file sources still don't track transitively-imported files outside
// their dirs; editing one of those needs a manual Re-describe.

use crate::proto_source::{cache_dir, cache_path, find_source};

#[derive(Serialize, Deserialize)]
struct CachedCatalog {
    catalog: GrpcCatalog,
    mtimes: HashMap<String, u64>,
    // service full-name → entry file, present when the source needed per-file compilation
    #[serde(default)]
    service_files: HashMap<String, String>,
}

fn file_mtimes(files: &[String]) -> HashMap<String, u64> {
    let mut expanded: Vec<PathBuf> = Vec::new();
    for f in files {
        let p = PathBuf::from(f);
        if p.is_dir() { collect_protos(&p, &mut expanded); } else { expanded.push(p); }
    }
    expanded.iter().filter_map(|f| {
        let secs = std::fs::metadata(f).ok()?
            .modified().ok()?
            .duration_since(std::time::UNIX_EPOCH).ok()?
            .as_secs();
        Some((f.to_string_lossy().into_owned(), secs))
    }).collect()
}

fn read_cache(id: &str) -> Option<CachedCatalog> {
    serde_json::from_str(&std::fs::read_to_string(cache_path(id)).ok()?).ok()
}

fn write_cache(id: &str, catalog: &GrpcCatalog, mtimes: HashMap<String, u64>, service_files: HashMap<String, String>) -> Result<(), String> {
    std::fs::create_dir_all(cache_dir()).map_err(|e| e.to_string())?;
    let payload = CachedCatalog { catalog: catalog.clone(), mtimes, service_files };
    std::fs::write(cache_path(id), serde_json::to_string(&payload).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

async fn describe_source(env: &Option<String>, id: &str, force: bool) -> Result<GrpcCatalog, String> {
    let src = find_source(id)?;
    if src.kind == "files" {
        let mtimes = file_mtimes(&src.files);
        if !force {
            if let Some(c) = read_cache(id) {
                if c.mtimes == mtimes { return Ok(c.catalog); } // fresh: files unchanged since describe
            }
        }
        let (cat, service_files) = catalog_for_files(&src.files, &src.import_paths)?;
        write_cache(id, &cat, mtimes, service_files)?;
        Ok(cat)
    } else {
        if !force {
            if let Some(c) = read_cache(id) { return Ok(c.catalog); } // reflection change can't be cheaply detected
        }
        let ep = interpolate(&src.endpoint, &ctx_for(env)?)?;
        let cat = describe_via_reflection(&ep, src.insecure).await?;
        write_cache(id, &cat, HashMap::new(), HashMap::new())?;
        Ok(cat)
    }
}

#[tauri::command]
pub async fn grpc_describe(
    env: Option<String>,
    source_id: Option<String>,
    force: bool,
    endpoint: Option<String>,
    proto_files: Vec<String>,
    insecure: bool,
) -> Result<GrpcCatalog, String> {
    if let Some(id) = source_id.filter(|s| !s.is_empty()) {
        return describe_source(&env, &id, force).await;
    }
    // legacy inline path (requests without a shared source, and the quick reflect-this-endpoint flow)
    if !proto_files.is_empty() {
        describe_from_files(&proto_files)
    } else {
        let Some(ep) = describe_endpoint(endpoint, &ctx_for(&env)?)? else {
            return Err("provide endpoint or protoFiles".into());
        };
        describe_via_reflection(&ep, insecure).await
    }
}

// ---- unary call ----

use crate::collection::{build_ctx, interpolate, read_env, root_dir, GrpcPart, KV};
use crate::secrets::read_secrets;
use prost::Message as _ProstMessage;
use std::time::Instant;
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::Status;

pub fn json_to_message(desc: &MessageDescriptor, json: &str) -> Result<DynamicMessage, String> {
    let mut de = serde_json::Deserializer::from_str(json);
    let msg = DynamicMessage::deserialize(desc.clone(), &mut de).map_err(|e| e.to_string())?;
    de.end().map_err(|e| e.to_string())?;
    Ok(msg)
}

#[cfg(test)]
pub fn message_to_bytes(msg: &DynamicMessage) -> Vec<u8> { msg.encode_to_vec() }

#[cfg(test)]
pub fn bytes_to_json(desc: &MessageDescriptor, bytes: &[u8]) -> Result<String, String> {
    let msg = DynamicMessage::decode(desc.clone(), bytes).map_err(|e| e.to_string())?;
    serde_json::to_string(&msg).map_err(|e| e.to_string())
}

struct DynamicCodec { output: MessageDescriptor }
struct DynamicEncoder;
struct DynamicDecoder { output: MessageDescriptor }

impl Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = Status;
    fn encode(&mut self, item: DynamicMessage, dst: &mut EncodeBuf<'_>) -> Result<(), Status> {
        item.encode(dst).map_err(|e| Status::internal(e.to_string()))
    }
}
impl Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = Status;
    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<DynamicMessage>, Status> {
        let msg = DynamicMessage::decode(self.output.clone(), src).map_err(|e| Status::internal(e.to_string()))?;
        Ok(Some(msg))
    }
}
impl Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;
    fn encoder(&mut self) -> Self::Encoder { DynamicEncoder }
    fn decoder(&mut self) -> Self::Decoder { DynamicDecoder { output: self.output.clone() } }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcResponse {
    pub status_code: String,
    pub headers: Vec<KV>,
    pub trailers: Vec<KV>,
    pub body_json: String,
    pub time_ms: u64,
}

fn md_to_kvs(md: &tonic::metadata::MetadataMap) -> Vec<KV> {
    md.iter().filter_map(|kv| match kv {
        tonic::metadata::KeyAndValueRef::Ascii(k, v) =>
            Some(KV { key: k.to_string(), value: v.to_str().unwrap_or("").to_string(), enabled: None }),
        _ => None,
    }).collect()
}

async fn reflect_pool(endpoint: &str, insecure: bool) -> Result<DescriptorPool, String> {
    let ch = channel(endpoint, insecure).await?;
    let svcs = reflect_list_services(ch.clone()).await?;
    let bytes = reflect_files_for_symbols(ch, &svcs).await?;
    pool_from_fd_bytes(bytes)
}

async fn build_pool(part: &GrpcPart, endpoint: &str, ctx: &HashMap<String, String>) -> Result<DescriptorPool, String> {
    if let Some(id) = part.source_id.as_deref().filter(|s| !s.is_empty()) {
        let src = find_source(id)?;
        return if src.kind == "files" {
            // Conflict-heavy sources (per-file catalogs) can't build one big pool — the
            // describe cache remembers which entry file this service came from.
            if let Some(f) = read_cache(id).and_then(|c| c.service_files.get(&part.service).cloned()) {
                let (entries, mut includes) = expand_entries(&src.files, &src.import_paths);
                let fp = PathBuf::from(f);
                if let Some(p) = fp.parent() { includes.push(p.to_path_buf()); }
                compile_pool(std::slice::from_ref(&fp), includes, &entries)
            } else {
                pool_from_files_ex(&src.files, &src.import_paths)
            }
        } else {
            reflect_pool(&interpolate(&src.endpoint, ctx)?, src.insecure).await
        };
    }
    // legacy inline
    if part.proto_source == "files" {
        pool_from_files(&part.proto_files)
    } else {
        reflect_pool(endpoint, part.insecure).await
    }
}

#[tauri::command]
pub async fn grpc_unary(env: Option<String>, part: GrpcPart) -> Result<GrpcResponse, String> {
    let root = root_dir();
    let (env_vars, secret_vars) = match &env {
        Some(e) => (read_env(&root, e)?, read_secrets(&root, e)?),
        None => (HashMap::new(), HashMap::new()),
    };
    let ctx = build_ctx(env_vars, secret_vars);

    let endpoint = interpolate(&part.endpoint, &ctx)?;
    let pool = build_pool(&part, &endpoint, &ctx).await?;
    let svc = pool.services().find(|s| s.full_name() == part.service).ok_or("service not found")?;
    let method = svc.methods().find(|m| m.name() == part.method).ok_or("method not found")?;
    let input_desc = method.input();
    let output_desc = method.output();

    let msg_json = interpolate(&part.message, &ctx)?;
    let input_msg = json_to_message(&input_desc, &msg_json)?;

    let mut md = tonic::metadata::MetadataMap::new();
    for kv in part.metadata.iter().filter(|k| k.enabled.unwrap_or(true)) {
        let k = interpolate(&kv.key, &ctx)?;
        let v = interpolate(&kv.value, &ctx)?;
        let key = tonic::metadata::MetadataKey::from_bytes(k.as_bytes()).map_err(|e| e.to_string())?;
        let val: tonic::metadata::MetadataValue<tonic::metadata::Ascii> = v.parse().map_err(|_| format!("bad metadata value for {k}"))?;
        md.insert(key, val);
    }

    let ch = channel(&endpoint, part.insecure).await?;
    let mut client = tonic::client::Grpc::new(ch);
    client.ready().await.map_err(|e| e.to_string())?;
    let codec = DynamicCodec { output: output_desc.clone() };
    let path = tonic::codegen::http::uri::PathAndQuery::try_from(format!("/{}/{}", part.service, part.method))
        .map_err(|e| e.to_string())?;
    let mut request = tonic::Request::new(input_msg);
    *request.metadata_mut() = md;

    let t0 = Instant::now();
    let result = client.unary(request, path, codec).await;
    let time_ms = t0.elapsed().as_millis() as u64;
    match result {
        Ok(resp) => {
            let headers = md_to_kvs(resp.metadata());
            let body_json = serde_json::to_string(resp.get_ref()).map_err(|e| e.to_string())?;
            // ponytail: tonic unary Response doesn't surface trailers separately; left empty
            Ok(GrpcResponse { status_code: "OK".into(), headers, trailers: vec![], body_json, time_ms })
        }
        Err(status) => Ok(GrpcResponse {
            status_code: format!("{:?}", status.code()),
            headers: md_to_kvs(status.metadata()),
            trailers: vec![],
            body_json: serde_json::json!({ "error": status.message() }).to_string(),
            time_ms,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_dynamic_roundtrip() {
        let p = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/greeter.proto");
        let pool = pool_from_files(&[p.to_string()]).unwrap();
        let desc = pool.get_message_by_name("demo.HelloReq").unwrap();
        let msg = json_to_message(&desc, r#"{"name":"x"}"#).unwrap();
        let bytes = message_to_bytes(&msg);
        let back = bytes_to_json(&desc, &bytes).unwrap();
        assert!(back.contains("\"x\""));
    }

    #[test]
    fn describe_proto_file() {
        let p = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/greeter.proto");
        let cat = describe_from_files(&[p.to_string()]).unwrap();
        assert_eq!(cat.services[0].name, "demo.Greeter");
        assert_eq!(cat.services[0].methods[0].name, "SayHello");
        assert!(!cat.services[0].methods[0].server_streaming);
    }

    #[test]
    fn import_path_resolves_cross_dir_import() {
        // main.proto imports base.proto which lives in a SEPARATE dir reachable only via -I.
        let main = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/imports/main.proto");
        let shared = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/shared");
        // without the import path it must fail (base.proto not next to main.proto)...
        assert!(pool_from_files(&[main.to_string()]).is_err());
        // ...with it, the pool builds and exposes the service.
        let pool = pool_from_files_ex(&[main.to_string()], &[shared.to_string()]).unwrap();
        assert!(pool.get_message_by_name("demo.Wrap").is_some());
    }

    #[test]
    fn folder_import_resolves_package_style_imports() {
        // svc.proto imports "app/v1/common.proto" (package-style). Importing the ROOT FOLDER
        // must compile both with consistent names — the exact case that broke file-picking.
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/tree");
        let pool = pool_from_files_ex(&[root.to_string()], &[]).unwrap();
        assert!(pool.services().any(|s| s.full_name() == "tree.v1.Tree"));
    }

    #[test]
    fn folder_plus_loose_duplicate_file_is_deduped() {
        // User picks the folder AND one file inside it — must not double-load.
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/tree");
        let dup = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/tree/app/v1/common.proto");
        let pool = pool_from_files_ex(&[root.to_string(), dup.to_string()], &[]).unwrap();
        assert!(pool.get_message_by_name("tree.v1.Base").is_some());
    }

    #[test]
    fn duplicate_load_error_gets_hint() {
        // Picking common.proto + entry.proto as loose files: common's parent include names it
        // "common.proto", but entry.proto's package-style import resolves the SAME file as
        // "app/v1/common.proto" via entry's parent dir → double define. Error must carry the hint.
        let common = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/tree/app/v1/common.proto");
        let entry = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/tree/entry.proto");
        let err = pool_from_files_ex(&[common.to_string(), entry.to_string()], &[]).unwrap_err();
        assert!(err.contains("Hint:"), "expected hint, got: {err}");
    }

    #[test]
    fn folder_import_derives_inner_include_root() {
        // Java-style repo: protos live under src/main/proto and import each other by
        // bare name. Importing the REPO ROOT must auto-derive the inner root and compile.
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/javaish");
        let pool = pool_from_files_ex(&[root.to_string()], &[]).unwrap();
        assert!(pool.services().any(|s| s.full_name() == "javaish.Gateway"));
    }

    #[test]
    fn conflicting_versions_merge_at_catalog_level() {
        // Two no-package protos both define `Spin` with different shapes (v1/v2 copies in one
        // folder). One pool is impossible — the catalog must fall back to per-file compilation
        // and expose BOTH services, each with its own schema.
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/versions");
        let (cat, map) = catalog_for_files(&[root.to_string()], &[]).unwrap();
        let names: Vec<_> = cat.services.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"SlotV1") && names.contains(&"SlotV2"), "got {names:?}");
        assert_eq!(map.len(), 2);
        // v2's template must show ITS OWN Spin (2 fields), not v1's
        let v2 = cat.services.iter().find(|s| s.name == "SlotV2").unwrap();
        assert!(v2.methods[0].input_template.contains("lines"));
        // call-time: the mapped entry file alone must yield a pool containing the service
        let f = PathBuf::from(&map["SlotV2"]);
        let (entries, mut inc) = expand_entries(&[root.to_string()], &[]);
        if let Some(p) = f.parent() { inc.push(p.to_path_buf()); }
        let pool = compile_pool(std::slice::from_ref(&f), inc, &entries).unwrap();
        assert!(pool.services().any(|s| s.full_name() == "SlotV2"));
    }

    #[test]
    fn empty_folder_errors_clearly() {
        let dir = std::env::temp_dir().join("rq_min_empty_proto_dir");
        let _ = std::fs::create_dir_all(&dir);
        let err = pool_from_files_ex(&[dir.to_string_lossy().into_owned()], &[]).unwrap_err();
        assert_eq!(err, "no .proto files found");
    }

    #[test]
    fn describe_endpoint_resolves_environment_variables() {
        let mut ctx = HashMap::new();
        ctx.insert("grpcHost".into(), "http://localhost".into());
        assert_eq!(describe_endpoint(Some("{{grpcHost}}:50051".into()), &ctx).unwrap(), Some("http://localhost:50051".into()));
    }
}
