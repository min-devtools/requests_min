# Dynamic Variables — Design

**Date:** 2026-07-26
**Status:** Approved (chat) — occurrence semantics and faker-library decision confirmed by user.

## Goal

Postman-style dynamic variables: `{{$uuid}}`, `{{$timestamp}}`, `{{$randomEmail}}`, … generate a fresh value at send time, anywhere `{{var}}` interpolation already works (URL, headers, auth, query/path params, body, gRPC endpoint/message/metadata, WS, Flows — and the future CLI runner for free).

## Decisions

- **Resolved in Rust** inside `collection::interpolate()` — the single choke point every protocol runner already goes through. Frontend resolution was rejected: each call site would need to remember it, and a future Rust CLI would miss it entirely.
- **Each occurrence generates a fresh value** (Postman semantics). Two `{{$uuid}}` in one request produce two different UUIDs. Reusing one value across places is a job for pre-request scripts (planned next feature).
- **Fake data comes from a faker library, not hand-rolled word lists.** User asked for faker.js; resolution lives in Rust where a JS library cannot run, so we use the [`fake`](https://crates.io/crates/fake) crate — the Rust equivalent (same idea, maintained, tiny). Plus `uuid` (already a dependency), `rand`, `chrono` (already in the tree as transitives).
- **`$` namespace is reserved.** A `$`-prefixed name never consults env vars or secrets, so user variables cannot shadow built-ins. Unknown `$name` fails the send with `unknown dynamic variable: $name` via the existing missing-variables error path.
- **No parameterization** (`{{$randomInt(1,100)}}`), no pinning syntax, no seeded mode in v1.

## Variable set (v1)

| Group | Variables |
|---|---|
| ID | `$uuid`, `$guid` (alias) — UUID v4 |
| Time | `$timestamp` (Unix s), `$timestampMs` (Unix ms), `$isoTimestamp` (ISO 8601 UTC) |
| Numbers | `$randomInt` (0–1000), `$randomBoolean` |
| Strings | `$randomAlphaNumeric` (16 chars), `$randomHexColor`, `$randomPassword` |
| Internet | `$randomEmail`, `$randomUserName`, `$randomUrl`, `$randomIP`, `$randomIPv6`, `$randomUserAgent` |
| Person | `$randomFirstName`, `$randomLastName`, `$randomFullName`, `$randomPhoneNumber` |
| Address | `$randomCity`, `$randomCountry`, `$randomCountryCode`, `$randomStreetAddress`, `$randomZipCode` |
| Company/Lorem | `$randomCompanyName`, `$randomLoremWord`, `$randomLoremSentence`, `$randomLoremParagraph` |

Names follow Postman where an equivalent exists.

## Architecture

**Rust**
- New module `src-tauri/src/dynamic.rs`: `pub fn dynamic_value(name: &str) -> Option<String>` — registry mapping bare names (no `$`) to generators backed by `fake`/`uuid`/`rand`/`chrono`.
- `collection::interpolate()`: token names starting with `$` route to `dynamic_value()`; `Some` → substitute, `None` → collect as `"$name (unknown dynamic variable)"` in the existing missing list. ctx lookup skipped for `$` names.

**Frontend**
- New `src/lib/dynamicVariables.ts`: `DYNAMIC_VARIABLES: { name, description, example }[]` — single source of truth for all UI below.
- `EnvInput` merges dynamic names into its existing suggestion dropdown (typing `{{$` filters to them; description on hover).
- `JsonEditor` (Monaco) registers a JSON completion provider: typing `{{$` suggests the list with description + example; inserts closing `}}` when not already present.
- `Inspector` shows `$` variables under an "auto" badge instead of listing them as environment variables; they can never appear missing.
- `jsonTemplate.ts` validation needs no change (`{{…}}` already atomic).

## Testing

- Rust (`dynamic.rs` + `collection.rs` tests): every registered name yields a plausibly-formatted value (regex/parse checks); consecutive `{{$uuid}}` differ; unknown `$name` errors naming it; a ctx entry literally named `$uuid` cannot shadow the built-in.
- Frontend `.mjs` contract tests (existing pattern): dynamic variable list shape, EnvInput suggestion merge, Inspector separation, JsonEditor completion wiring.

## Out of scope (v1)

Parameterized generators, pinned/named instances, seeded reproducibility, value preview before send, locale selection.
