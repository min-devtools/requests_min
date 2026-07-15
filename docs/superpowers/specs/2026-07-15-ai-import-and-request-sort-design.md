# AI Import and Request Sort Design

## Scope

- Add a native folder picker to AI Import and keep the existing manual path input.
- Generate HTTP drafts from every selected readable source file by splitting large input into bounded batches.
- Require generated request names to use `[Module] Action` and include example JSON payloads when the endpoint accepts a body.
- Add persistent A-Z and Z-A request sorting for the active collection.

## Design

The frontend folder button uses the installed Tauri dialog plugin, writes the selected directory into the existing path field, and immediately scans it. The existing scan result and file selection remain unchanged.

The Rust generator reads selected files, groups complete files into batches below a fixed corpus limit, and sends each batch to the configured OpenAI-compatible endpoint. Oversized individual files are included as their own bounded chunk. Results are validated as HTTP requests, merged in batch order, and de-duplicated by relative path so large sources are not silently ignored.

The AI system prompt explicitly requires module-prefixed names, route-preserving relative paths, and JSON example bodies inferred from source schemas, validators, DTOs, examples, defaults, and types. GET/HEAD requests use no body unless source code explicitly requires one.

The Collections toolbar exposes A-Z and Z-A actions. Each action sorts the current `ReqEntry` list case-insensitively by request name, persists the resulting relative-path order through the existing `req_reorder` command, and updates local state. The sidebar receives the same order through the existing mutation refresh flow.

## Errors and Tests

- A failed AI batch aborts generation with its batch number in the error.
- Unreadable files are skipped; generation fails if no readable source remains.
- Rust unit tests cover batching without dropping files and stable draft de-duplication.
- Frontend source tests cover the native folder picker, generation requirements, and both persistent sort directions.
