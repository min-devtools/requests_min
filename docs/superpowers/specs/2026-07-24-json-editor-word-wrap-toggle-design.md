# JsonEditor Word Wrap Toggle Button Design Spec

## Overview
Add a toggle button for Word Wrap in the JSON editor (`JsonEditor`) header toolbar next to the Format JSON button. The toggle defaults to ON (`true`), allowing users to toggle line wrapping between `"on"` and `"off"` dynamically.

## Detailed Changes

1. **`src/ui/Icon.tsx`**:
   - Import `WrapText` from `lucide-react`.
   - Add `"wrap": WrapText` to the `ICONS` map.

2. **`src/ui/JsonEditor.tsx`**:
   - Add state `const [wordWrap, setWordWrap] = useState(true);`.
   - In `.json-editor-tools`, add a button next to the format button:
     ```tsx
     <button
       type="button"
       className={wordWrap ? "active" : ""}
       onClick={() => setWordWrap((v) => !v)}
       title={wordWrap ? "Disable Word Wrap" : "Enable Word Wrap"}
       aria-label="Toggle Word Wrap"
       aria-pressed={wordWrap}
     >
       <Icon name="wrap" size={14} />
     </button>
     ```
   - Update Monaco options: `wordWrap: wordWrap ? "on" : "off"`.

## Testing Strategy
- Verify icon mapping in `Icon.tsx`.
- Add test case in `src/ui/jsonEditor.test.mjs` verifying that `JsonEditor` renders the word wrap toggle button next to format.
- Verify `npm run build` passes.
