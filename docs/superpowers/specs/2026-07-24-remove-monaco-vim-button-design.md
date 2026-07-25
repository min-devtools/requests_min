# Remove Monaco JSON Editor Vim Button Design Spec

## Overview
Remove the inline `[vim]` toggle button from the JSON editor (`JsonEditor`) toolbar. Users will manage Vim mode toggling exclusively through the Settings tab.

## Detailed Changes

1. **`src/ui/JsonEditor.tsx`**:
   - Remove `const toggleVimMode = useApp((state) => state.toggleVimMode);` import/hook usage.
   - Remove `<button type="button" className={vimMode ? "active" : ""} onClick={toggleVimMode} title="Vim mode" aria-label="Vim mode" aria-pressed={vimMode}>vim</button>` element from the `.json-editor-tools` toolbar header.
   - Retain `vimMode` subscription and the `useEffect` initialization for `monaco-vim`, as well as the `.vim-status` container element when Vim mode is active.

2. **`src/components/views/SettingsView.tsx`**:
   - Update description for Vim mode to remove stale reference to editor footer toggle.

## Testing Strategy
- Verify JSON editor toolbar no longer displays `[vim]` button.
- Verify Vim mode can still be toggled on/off in Settings and functions as expected in Monaco JSON editor when enabled.
