# Design Tokens

## Surface layers

Surface tokens are stacked from deep background to raised hover states.

| Token | Default dark | Light | Usage |
|-------|--------------|-------|-------|
| `--app-bg` | `#08090c` | `#e8e9ed` | Deepest app background |
| `--window` | `#111216` | `#f7f7f8` | Window/pane background |
| `--pane` | `#15171c` | `#ffffff` | Sidebar, inspector, panels |
| `--pane-2` | `#191b21` | `#f1f2f4` | Inputs, raised cards, hovered rows |
| `--pane-3` | `#20232a` | `#e8eaee` | Stronger hover/pressed states |
| `--editor-bg` | `#0d0f14` | `#fbfbfc` | Code editor background |
| `--glass` | `rgba(26,28,34,.78)` | `rgba(255,255,255,.78)` | Modal/palette backdrop |

## Text colors

| Token | Default dark | Light | Usage |
|-------|--------------|-------|-------|
| `--text` | `#f4f5f7` | `#101217` | Primary text |
| `--text-2` | `#a4a8b2` | `#3e4550` | Secondary text, labels |
| `--text-3` | `#717680` | `#626975` | Muted text, placeholders |

## Semantic surface aliases

Use these when you want theme-agnostic naming:

| Token | Maps to |
|-------|---------|
| `--surface-app` | `--app-bg` |
| `--surface-window` | `--window` |
| `--surface-panel` | `--pane` |
| `--surface-raised` | `--pane-2` |
| `--surface-hover` | `--pane-3` |
| `--surface-editor` | `--editor-bg` |
| `--surface-overlay` | `--glass` |
| `--text-primary` | `--text` |
| `--text-secondary` | `--text-2` |
| `--text-muted` | `--text-3` |
| `--text-on-accent` | `--editor-bg` |
| `--border-default` | `--line` |
| `--border-strong` | `--line-2` |

## Borders

| Token | Default dark | Light |
|-------|--------------|-------|
| `--line` | `rgba(255,255,255,.075)` | `rgba(0,0,0,.09)` |
| `--line-2` | `rgba(255,255,255,.11)` | `rgba(0,0,0,.14)` |

## Accent colors

| Token | Default dark | Light | Usage |
|-------|--------------|-------|-------|
| `--accent` | `#ff5f5f` | inherited | Brand accent (used sparingly) |
| `--accent-primary` | `--blue` | `--blue` | Primary action color |
| `--accent-secondary` | `--blue-2` | `--blue-2` | Primary button fill, strong accent |
| `--accent-focus` | `--blue` | `--blue` | Focus rings |

## Status colors

| Token | Default dark | Light | Usage |
|-------|--------------|-------|-------|
| `--status-success` / `--green` | `#58d68d` | `#14852a` | Success, healthy, OK |
| `--status-warning` / `--orange` | `#f7b267` | `#bc7400` | Warning, pending, retry |
| `--status-danger` / `--red` | `#ff6b75` | `#ac2121` | Error, danger, failed |
| `--status-info` / `--blue-2` | `#1f6feb` | `#0073d1` | Info, links, numbers |

## Syntax highlighting

| Token | Default dark | Usage |
|-------|--------------|-------|
| `--syntax-key` | `--blue` | JSON keys |
| `--syntax-string` | `--green` | Strings |
| `--syntax-number` | `--blue-2` | Numbers |
| `--syntax-boolean` | `--purple` | Booleans |
| `--syntax-null` | `--red` | Null |
| `--syntax-punctuation` | `--text-3` | Brackets, commas |

## Typography

| Token | Value | Usage |
|-------|-------|-------|
| `--font-body` | `"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif` | UI text, body |
| `--font-mono` | `"Berkeley Mono", ui-monospace, Menlo, Consolas, monospace` | Code, IDs, status bar, tables |

Base UI font: `13px/1.45 var(--font-body)`.

## Layout dimensions

| Token | Value | Usage |
|-------|-------|-------|
| `--left-w` | `258px` | Sidebar width |
| `--right-w` | `328px` | Inspector width |
| `--query-top` | `48vh` | Query editor default height |

## Effects

| Token | Value |
|-------|-------|
| `--shadow` | `0 18px 60px color-mix(in oklab, var(--surface-app), transparent 45%)` |
| `--focus-ring` | `color-mix(in oklab, var(--accent-focus), transparent 84%)` |
| `--surface-selected` | `color-mix(in oklab, var(--accent-primary), transparent 86%)` |
| `--modal-backdrop` | `color-mix(in oklab, var(--surface-app), transparent 28%)` |

## Row backgrounds for tables

| Token | Default dark | Light |
|-------|--------------|-------|
| `--row` | `rgba(255,255,255,.025)` | `rgba(0,0,0,.015)` |
| `--row-alt` | `rgba(255,255,255,.04)` | `rgba(0,0,0,.035)` |

## Switching themes

Default is dark. Add `class="light"` to `<body>` to switch to light mode.

For extended themes, add `body[data-theme="..."]` overrides in a separate `themes.css` file (the source app ships 70+ editor themes generated from VS Code themes).
