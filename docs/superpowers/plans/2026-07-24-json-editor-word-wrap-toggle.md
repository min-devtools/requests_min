# JsonEditor Word Wrap Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable Word Wrap button next to the Format JSON button in `JsonEditor` toolbar (default ON).

**Architecture:** Add `WrapText` icon mapping to `Icon.tsx`, add `wordWrap` state and toolbar button to `JsonEditor.tsx`, and pass `wordWrap: wordWrap ? "on" : "off"` to Monaco editor options.

**Tech Stack:** React, TypeScript, Lucide Icons, Monaco Editor.

## Global Constraints

- Default state for `wordWrap` is `true` (ON).
- Place button next to Format JSON (`wand` icon) button in `JsonEditor` toolbar.

---

### Task 1: Add wrap icon and wordWrap toggle state to JsonEditor

**Files:**
- Modify: `src/ui/Icon.tsx:53,106`
- Modify: `src/ui/JsonEditor.tsx:22,100,127`
- Test: `src/ui/jsonEditor.test.mjs`

- [ ] **Step 1: Write failing test in jsonEditor.test.mjs**

Add assertion in `src/ui/jsonEditor.test.mjs` checking that `Icon.tsx` includes `"wrap"` icon and `JsonEditor.tsx` renders the wrap toggle button.

- [ ] **Step 2: Run test to verify failure**

Run: `node --test src/ui/jsonEditor.test.mjs`
Expected: FAIL on missing wrap icon / toggle button.

- [ ] **Step 3: Update Icon.tsx and JsonEditor.tsx**

In `src/ui/Icon.tsx`:
Import `WrapText` from `lucide-react` and add `"wrap": WrapText` to `ICONS`.

In `src/ui/JsonEditor.tsx`:
Add state `const [wordWrap, setWordWrap] = useState(true);`.
In `.json-editor-tools`:
Add `<button type="button" className={wordWrap ? "active" : ""} onClick={() => setWordWrap((v) => !v)} title={wordWrap ? "Disable Word Wrap" : "Enable Word Wrap"} aria-label="Toggle Word Wrap" aria-pressed={wordWrap}><Icon name="wrap" size={14} /></button>` right next to the format button (`<button type="button" onClick={format}...`).
Update Monaco options: `wordWrap: wordWrap ? "on" : "off"`.

- [ ] **Step 4: Run test to verify pass**

Run: `node --test src/ui/jsonEditor.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run full build check**

Run: `npm run build`
Expected: PASS with exit code 0.

- [ ] **Step 6: Commit changes**

```bash
git add src/ui/Icon.tsx src/ui/JsonEditor.tsx src/ui/jsonEditor.test.mjs docs/superpowers
git commit -m "feat: add word wrap toggle button to JsonEditor toolbar"
```
