import assert from "node:assert/strict";
import test from "node:test";
import { THEMES } from "./themes.ts";

test("built-in themes use Min labels without changing persisted IDs", () => {
  assert.deepEqual(
    THEMES.filter(({ id }) => id === "dark" || id === "light"),
    [
      { id: "dark", label: "Min Dark", base: "dark" },
      { id: "light", label: "Min Light", base: "light" },
    ],
  );
});
