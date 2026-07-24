# JSON Template Variable Handling and Validation Spec

## Overview
Support template variables (`{{...}}`) inside JSON inputs (both quoted in strings and unquoted as values/keys), allowing Format, Minify, and Validate to succeed seamlessly. Enable Monaco JSON syntax error validation (`validate: true`) so real syntax errors display red squiggles while ignoring false-positive errors caused by template variables.

## Detailed Design

### 1. Template Variable Sanitization (`src/lib/jsonTemplate.ts`)
Implement helper functions:
- `prepareJsonWithTemplates(text: string)`:
  - Scans `text` character by character, tracking `inString` state.
  - Replaces `{{...}}` inside strings with a unique string token `__REQMIN_STR_TOK_N__`.
  - Replaces `{{...}}` outside strings with a quoted raw token `"__REQMIN_RAW_TOK_N__"`.
  - Returns `sanitizedText` and `restore(jsonOutput: string): string`.
- `formatJsonWithTemplates(text: string, indent = 2): string`:
  - Sanitizes `text`, parses & stringifies JSON with `indent`, then restores original `{{...}}` tokens.
- `minifyJsonWithTemplates(text: string): string`:
  - Sanitizes `text`, parses & stringifies JSON compactly, then restores original `{{...}}` tokens.
- `validateJsonWithTemplates(text: string): { valid: boolean; error?: string }`:
  - Sanitizes `text`, attempts `JSON.parse`. Returns `{ valid: true }` if clean, or `{ valid: false, error }` if genuine JSON error.

### 2. JsonEditor Integration (`src/ui/JsonEditor.tsx`)
- Update `format`, `minify`, and `validate` functions to use `formatJsonWithTemplates`, `minifyJsonWithTemplates`, and `validateJsonWithTemplates`.

### 3. Re-enable Monaco Validation & Marker Filtering (`src/lib/monaco.ts` & `src/ui/JsonEditor.tsx`)
- In `src/lib/monaco.ts`: set `jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: true })`.
- In `JsonEditor.tsx` on editor mount:
  - Add marker listener (`monaco.editor.onDidChangeMarkers`).
  - Filter markers: ignore markers positioned inside `{{...}}` template tokens or caused by unquoted template variables.
  - Set filtered markers using `monaco.editor.setModelMarkers(model, "json-template-filter", filteredMarkers)`.

## Testing Strategy
- Unit tests in `src/lib/jsonTemplate.test.mjs` for:
  - Formatting JSON with quoted and unquoted `{{...}}` variables.
  - Minifying JSON with quoted and unquoted `{{...}}` variables.
  - Validating valid JSON with template variables vs. genuinely invalid JSON.
- Verify `npm run build` and `node --test` pass.
