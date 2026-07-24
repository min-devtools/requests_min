# JSON Template Variable Handling and Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow JSON Format, Minify, and Validate to support `{{...}}` template variables, and re-enable Monaco JSON error reporting (`validate: true`) with template marker filtering.

**Architecture:** Create `src/lib/jsonTemplate.ts` to handle sanitizing/restoring `{{...}}` tokens for JSON operations. Enable Monaco JSON diagnostics in `monaco.ts` and add marker filtering in `JsonEditor.tsx`.

**Tech Stack:** TypeScript, React, Monaco Editor, Node Test runner.

## Global Constraints

- Preserve all original `{{...}}` token contents and unquoted/quoted placement when formatting or minifying.
- Re-enable Monaco JSON error reporting (`validate: true`) while ignoring false-positive markers on `{{...}}` tokens.

---

### Task 1: Implement jsonTemplate.ts and unit tests

**Files:**
- Create: `src/lib/jsonTemplate.ts`
- Create: `src/lib/jsonTemplate.test.mjs`

- [ ] **Step 1: Write failing tests in jsonTemplate.test.mjs**

Cover:
- Formatting JSON with `{{...}}` inside strings and unquoted values.
- Minifying JSON with `{{...}}` inside strings and unquoted values.
- Validating JSON with `{{...}}` template variables (returns valid: true).
- Validating invalid JSON (returns valid: false).

- [ ] **Step 2: Run test to verify failure**

Run: `node --test src/lib/jsonTemplate.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement src/lib/jsonTemplate.ts**

Write `prepareJsonWithTemplates`, `formatJsonWithTemplates`, `minifyJsonWithTemplates`, `validateJsonWithTemplates`.

- [ ] **Step 4: Run test to verify pass**

Run: `node --test src/lib/jsonTemplate.test.mjs`
Expected: PASS.

---

### Task 2: Integrate into JsonEditor and re-enable Monaco validation

**Files:**
- Modify: `src/lib/monaco.ts`
- Modify: `src/ui/JsonEditor.tsx`

- [ ] **Step 1: Update monaco.ts to enable JSON validation**

In `src/lib/monaco.ts`:
Change `setDiagnosticsOptions({ validate: false })` to `setDiagnosticsOptions({ validate: true, allowComments: true })`.

- [ ] **Step 2: Update JsonEditor.tsx to use jsonTemplate functions and filter markers**

In `src/ui/JsonEditor.tsx`:
- Import `formatJsonWithTemplates`, `minifyJsonWithTemplates`, `validateJsonWithTemplates` from `../lib/jsonTemplate`.
- Update `format()`, `minify()`, and `validate()` to use these functions.
- Add marker filter listener on `onMount` to filter out worker markers overlapping with `{{...}}` ranges.

- [ ] **Step 3: Run all node tests**

Run: `node --test src/**/*.test.mjs src/**/**/*.test.mjs`
Expected: PASS.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: PASS with exit code 0.

- [ ] **Step 5: Commit changes**

```bash
git add src/lib/jsonTemplate.ts src/lib/jsonTemplate.test.mjs src/lib/monaco.ts src/ui/JsonEditor.tsx docs/superpowers
git commit -m "feat: support template variables in JSON editor format/minify and re-enable monaco validation"
```
