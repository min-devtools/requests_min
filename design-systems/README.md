# App Design System

A dark-first, native-macOS-inspired design system for developer tools.

## Philosophy

- **Dark-first**: default theme is a near-black app chrome. Light mode is opt-in via `body.light`.
- **Native desktop feel**: subtle 1px borders, rounded 8–10px corners, frosted overlays, minimal shadows.
- **Information-dense**: 13px base UI font, compact 28–32px controls, tabular numerics, monospace for code/IDs.
- **Restrained color**: grayscale surfaces + one primary accent (`--blue` / `--blue-2`) + semantic status colors.
- **Keyboard-first**: command palette, shortcuts, editable query headers, Vim-friendly editor.

## For Open Design / AI assistant

When building a new app with this design system:

1. Read `TOKENS.md` first — it defines the full token vocabulary.
2. Read `COMPONENTS.md` second — it lists every reusable class and component.
3. Use `tokens.css`, `base.css`, `layout.css`, `components.css` as the CSS foundation.
4. Open `index.html` as the visual reference for how tokens/components render.

### Non-negotiable rules

- Default theme is **dark**. Add `class="light"` to `<body>` for light mode.
- Surfaces are layered: `app-bg` → `window` → `pane` → `pane-2` → `pane-3`.
- Borders are 1px `var(--line)` or `var(--line-2)`.
- Border radius is 8px for controls, 9–10px for panels/cards.
- One accent family only: `--blue` / `--blue-2` for primary actions; `--green`, `--orange`, `--red` for status.
- No dashboard-style cards, no Material Design, no heavy shadows, no gradient hero backgrounds.

## File map

| File | Purpose |
|------|---------|
| `tokens.css` | Core CSS custom properties (dark + light) |
| `base.css` | Reset, body, typography base |
| `layout.css` | App shell: titlebar, sidebar, workspace, inspector, tabs, statusbar, resize handles |
| `components.css` | Primitives: buttons, inputs, badges, tables, modals, command palette, toasts, JSON tree |
| `TOKENS.md` | Token dictionary with names, values, and usage |
| `COMPONENTS.md` | Class-by-class usage guide |
| `index.html` | Interactive showcase |

## How to use in a new project

### Option A: Copy CSS files

Copy `tokens.css`, `base.css`, `layout.css`, `components.css` into the new project and import them in this order:

```css
@import "tokens.css";
@import "base.css";
@import "layout.css";
@import "components.css";
```

### Option B: Link this folder in Open Design

In the new Open Design project, link this `design-systems` folder as a read-only reference. The assistant will read `README.md`, `TOKENS.md`, and `COMPONENTS.md` before designing.

## License

Same as the source project.
