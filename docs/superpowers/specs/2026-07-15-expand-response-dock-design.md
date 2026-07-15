# Expand Response Dock Design

## Goal

Allow the vertically docked response panel to grow upward until it reaches the
request editor's tab bar (`Body`, `Headers`, `Params`, `Auth`).

## Scope

- Apply only to the stacked request layout, where the response is below the
  editor.
- Keep the editor tab bar visible while allowing its content area to collapse.
- Keep a minimal visible response area containing the resize handle, response
  header, and a small scrollable body area.
- Leave the side-by-side response layout unchanged.

## Implementation Direction

- Change the stacked request grid's editor-row minimum from `220px` to the
  `39px` tab-bar height.
- Update the vertical resize clamp so the upper drag limit reserves only the
  resize handle, response header, and a `37px` response body minimum.
- Persisted layout values continue to use the existing `requestsmin:request-top`
  local-storage key; previously saved values remain valid and can be adjusted
  into the new range by dragging.

## Behavior

Dragging the bottom response divider upward makes the response occupy all
space below the editor tab bar. The selected editor tab remains usable, while
its content area collapses to zero height. Dragging downward restores editor
content space. The response body remains scrollable at every allowed size.

## Verification

- Drag the stacked response divider to its highest position and confirm it
  stops directly below the editor tab bar.
- Confirm each editor tab can still be selected at the minimum editor height.
- Confirm response content scrolls at the minimum and expanded response sizes.
- Confirm the horizontal split layout retains its current behavior.
