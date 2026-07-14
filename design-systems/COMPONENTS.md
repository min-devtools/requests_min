# Components

Class-based CSS primitives. No JS framework required.

## Buttons

### `.tool-btn`

Standard toolbar button. Height 28px, 8px radius, 1px border.

```html
<button class="tool-btn">Run Query</button>
<button class="tool-btn icon-only">×</button>
<button class="tool-btn primary">Save</button>
<button class="tool-btn danger">Delete</button>
```

Modifiers:
- `.icon-only` — square 28×28, centered icon
- `.primary` — filled accent button
- `.danger` — red text
- `.panel-toggle` — toggle sidebar/inspector visibility
- `.panel-toggle.active` — active state

### `.action-btn`

Full-width action button inside panels/inspector.

```html
<button class="action-btn">Open in Query tab</button>
```

## Form elements

### `.form-row`

Label + input row with fixed left column (136px).

```html
<div class="form-row">
  <label>Name</label>
  <input type="text" />
</div>
```

### `.search`

Global search/palette input bar.

```html
<div class="search">
  <span>🔍</span>
  <span>Search indexes…</span>
  <kbd>⌘K</kbd>
</div>
```

### `.side-search`

Sidebar filter input.

```html
<input class="side-search" placeholder="Filter…" />
```

### `.query-path-input` + `.method-select`

Query editor header inputs.

```html
<select class="method-select"><option>POST</option></select>
<input class="query-path-input" value="/orders-v4/_search" />
```

### `.path-input`

Small mono input for chips/filters.

```html
<input class="path-input" placeholder="customer.email" />
```

### `.combobox`

Autocomplete dropdown wrapper.

```html
<div class="combobox">
  <input />
  <div class="combobox-list">
    <div class="combobox-item active"><span class="combobox-value">foo</span><span class="combobox-hint">keyword</span></div>
  </div>
</div>
```

## Badges & pills

### `.badge`

Small inline label.

```html
<span class="badge">12</span>
<span class="badge green">healthy</span>
<span class="badge yellow">warning</span>
<span class="badge red">error</span>
<span class="badge idle">—</span>
```

### `.type-pill`

Mapping/type chip.

```html
<span class="type-pill">keyword</span>
```

### `.field-chip`

Field/filter chip with subtle blue tint.

```html
<span class="field-chip">customer.email</span>
```

### `.path-chip`

Removable JSON-path chip.

```html
<span class="path-chip">customer.email <button>×</button></span>
```

### `.health-pill`

Cluster/index health status.

```html
<span class="health-pill green">green</span>
<span class="health-pill orange">yellow</span>
<span class="health-pill red">red</span>
```

## Status indicators

### `.status-dot`

7px status dot with glow ring.

```html
<span class="status-dot"></span>
<span class="status-dot orange"></span>
<span class="status-dot red"></span>
<span class="status-dot idle"></span>
```

### `.index-dot`

8px index health dot.

```html
<span class="index-dot"></span>
<span class="index-dot hot"></span>
<span class="index-dot red"></span>
```

## Navigation

### `.nav-item` / `.index-item`

Sidebar navigation row.

```html
<div class="nav-item active">
  <span>icon</span>
  <span>Query</span>
  <span class="badge">3</span>
</div>
```

### `.group` + `.group-title`

Sidebar section grouping.

```html
<div class="group">
  <div class="group-title">Indexes <span class="badge">12</span></div>
  …
</div>
```

## Tabs

### `.tabs`, `.tab`, `.tab-add`

Native-feeling workspace tabs.

```html
<div class="tabs">
  <div class="tab active"><span>Query</span><span class="tab-close">×</span></div>
  <div class="tab"><span>Documents</span><span class="tab-close">×</span></div>
  <button class="tab-add">+</button>
</div>
```

### `.mini-tabs`

Secondary tabs inside inspector/panels.

```html
<div class="mini-tabs">
  <button class="active">JSON</button>
  <button>Metadata</button>
</div>
```

## Tables

Dense data table with sticky header and alternating rows.

```html
<table>
  <thead><tr><th>ID</th><th>State</th></tr></thead>
  <tbody>
    <tr><td class="cell-id">#1</td><td class="cell-state">shipped</td></tr>
  </tbody>
</table>
```

Cell helpers:
- `.cell-id` — purple mono
- `.cell-email` — blue
- `.cell-money` — green
- `.cell-state` — orange
- `.cell-sku` — purple
- `.cell-number` — blue-2
- `.cell-keyword` — default text
- `.cell-date` — muted mono
- `.cell-country` — orange

Row selection: add `.selected` to `<tr>`.

## Panels & cards

### `.metric`

Small metric card.

```html
<div class="metric">
  <div class="label">Documents</div>
  <div class="value">1.2M</div>
</div>
```

### `.panel`

Generic bordered panel.

```html
<div class="panel">
  <h3>Cluster</h3>
  …
</div>
```

### `.path-card`

Field metadata card.

```html
<div class="path-card">
  <strong>customer.email</strong>
  <code>keyword</code>
</div>
```

## JSON

### `.json-tree`

Syntax-highlighted JSON block.

```html
<pre class="json-tree">
{
  <span class="syntax-key">"hits"</span>: <span class="syntax-number">42</span>
}
</pre>
```

Use classes: `.syntax-key`, `.syntax-string`, `.syntax-number`, `.syntax-bool`, `.syntax-null`, `.syntax-punc`.

## Overlays

### `.command` + `.palette`

Command palette modal.

```html
<div class="command">
  <div class="palette">
    <input placeholder="Type a command…" />
    <div class="cmd-list">
      <div class="cmd active"><span>icon</span><span>New Query</span><kbd>⌘N</kbd></div>
    </div>
  </div>
</div>
```

### `.modal` + `.prompt-dialog`

Confirmation dialog.

```html
<div class="modal">
  <div class="prompt-dialog">
    <p class="prompt-dialog-msg">Are you sure?</p>
    <div class="prompt-dialog-foot">
      <button class="tool-btn">Cancel</button>
      <button class="tool-btn danger">Delete</button>
    </div>
  </div>
</div>
```

### `.toast`

Inline notification.

```html
<div class="toast">
  <span>icon</span>
  <div class="toast-body">Query saved</div>
</div>
```

## Diff

### `.diff`

Side-by-side diff modal.

```html
<div class="diff">
  <div class="diff-head">Compare</div>
  <div class="diff-body">
    <pre class="diff-code">…old…</pre>
    <pre class="diff-code">…new…</pre>
  </div>
  <div class="diff-foot">
    <button class="tool-btn">Cancel</button>
    <button class="tool-btn primary">Save</button>
  </div>
</div>
```

Use `.added` and `.removed` to highlight inline changes.

## App shell layout

```html
<div class="app-frame">
  <div class="titlebar">…</div>
  <main class="main">
    <aside class="sidebar">…</aside>
    <section class="workspace">
      <div class="tabs">…</div>
      <div class="content active">…</div>
    </section>
    <aside class="inspector">…</aside>
  </main>
  <div class="statusbar">…</div>
</div>
```

Body state classes:
- `.light` — light theme
- `.left-collapsed` — collapse sidebar
- `.right-collapsed` — collapse inspector
- `.inspector-unavailable` — hide inspector
- `.compact` — tighter layout
- `.running` — query is executing

## Utility

- `.soft-blue`, `.soft-green`, `.soft-orange`, `.soft-red` — text color helpers
- `.kbd` — keyboard shortcut pill
- `.seg` — inline grouped segment
- `.risk-low`, `.risk-mid`, `.risk-high` — risk text colors
- `.empty-note` — centered empty state
- `.err-note` — error message block
