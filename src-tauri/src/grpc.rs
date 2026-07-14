use prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor, SerializeOptions};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tonic::transport::{Channel, ClientTlsConfig};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcCatalog { pub services: Vec<GrpcService> }

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
    let includes: Vec<PathBuf> = paths.iter()
        .filter_map(|p| Path::new(p).parent().map(|x| x.to_path_buf()))
        .collect();
    let fds = protox::compile(paths, includes).map_err(|e| e.to_string())?;
    DescriptorPool::from_file_descriptor_set(fds).map_err(|e| e.to_string())
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
    GrpcCatalog { services }
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

#[tauri::command]
pub async fn grpc_describe(endpoint: Option<String>, proto_files: Vec<String>, insecure: bool) -> Result<GrpcCatalog, String> {
    if !proto_files.is_empty() {
        describe_from_files(&proto_files)
    } else if let Some(ep) = endpoint {
        describe_via_reflection(&ep, insecure).await
    } else {
        Err("provide endpoint or protoFiles".into())
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

async fn build_pool(part: &GrpcPart, endpoint: &str) -> Result<DescriptorPool, String> {
    if part.proto_source == "files" {
        pool_from_files(&part.proto_files)
    } else {
        let ch = channel(endpoint, part.insecure).await?;
        let svcs = reflect_list_services(ch.clone()).await?;
        let bytes = reflect_files_for_symbols(ch, &svcs).await?;
        pool_from_fd_bytes(bytes)
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
    let pool = build_pool(&part, &endpoint).await?;
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
}
