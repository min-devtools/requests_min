use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::client::IntoClientRequest, tungstenite::Message};

pub enum WsCmd { Send(String), Close }
#[derive(Default)]
pub struct WsState(pub Mutex<HashMap<String, mpsc::UnboundedSender<WsCmd>>>);

#[derive(serde::Serialize, Clone)]
struct WsEvent { kind: String, data: String, ts: u64 }

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
}
fn emit(app: &AppHandle, sid: &str, kind: &str, data: String) {
    let _ = app.emit(&format!("ws:{sid}"), WsEvent { kind: kind.into(), data, ts: now_ms() });
}

#[tauri::command]
pub async fn ws_connect(app: AppHandle, state: State<'_, WsState>, session_id: String,
                        url: String, headers: Vec<crate::collection::KV>) -> Result<(), String> {
    let mut req = url.clone().into_client_request().map_err(|e| e.to_string())?;
    for h in headers.iter().filter(|h| h.enabled.unwrap_or(true)) {
        req.headers_mut().insert(
            h.key.parse::<tokio_tungstenite::tungstenite::http::header::HeaderName>().map_err(|e| e.to_string())?,
            h.value.parse().map_err(|_| format!("bad header value for {}", h.key))?,
        );
    }
    let (stream, _) = connect_async(req).await.map_err(|e| e.to_string())?;
    let (mut sink, mut source) = stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<WsCmd>();
    state.0.lock().unwrap().insert(session_id.clone(), tx);
    emit(&app, &session_id, "open", String::new());

    let sid = session_id.clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                cmd = rx.recv() => match cmd {
                    Some(WsCmd::Send(t)) => { if sink.send(Message::Text(t)).await.is_err() { break } }
                    Some(WsCmd::Close) | None => { let _ = sink.send(Message::Close(None)).await; break }
                },
                msg = source.next() => match msg {
                    Some(Ok(Message::Text(t))) => emit(&app2, &sid, "message", t.to_string()),
                    Some(Ok(Message::Binary(b))) => emit(&app2, &sid, "message", format!("<binary {} bytes>", b.len())),
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(e)) => { emit(&app2, &sid, "error", e.to_string()); break }
                    _ => {}
                },
            }
        }
        emit(&app2, &sid, "closed", String::new());
    });
    Ok(())
}

#[tauri::command]
pub fn ws_send(state: State<'_, WsState>, session_id: String, text: String) -> Result<(), String> {
    state.0.lock().unwrap().get(&session_id)
        .ok_or("no such session")?.send(WsCmd::Send(text)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ws_close(state: State<'_, WsState>, session_id: String) -> Result<(), String> {
    if let Some(tx) = state.0.lock().unwrap().remove(&session_id) { let _ = tx.send(WsCmd::Close); }
    Ok(())
}
