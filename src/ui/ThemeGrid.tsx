import themesCss from "../styles/themes.css?raw";
import tokensCss from "../styles/tokens.css?raw";
import { THEMES } from "../lib/themes";
import { parseThemeSwatches, swatchFor } from "../lib/themeSwatches";

// probed once at module load — swatches can never drift from the real palettes
const SWATCHES = parseThemeSwatches(themesCss, tokensCss);

/** Chip grid with live swatches — the theme control for Settings and the palette picker. */
export function ThemeGrid({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="theme-grid" role="listbox" aria-label="Theme">
      {(["dark", "light"] as const).map((base) => (
        <div key={base} className="theme-grid-base">
          <div className="theme-grid-group">{base === "dark" ? "Dark" : "Light"}</div>
          <div className="theme-grid-chips">
            {THEMES.filter((theme) => theme.base === base).map((theme) => {
              const swatch = swatchFor(SWATCHES, theme.id);
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="option"
                  aria-selected={theme.id === value}
                  className={`theme-chip ${theme.id === value ? "active" : ""}`}
                  onClick={() => onChange(theme.id)}
                >
                  <span className="theme-swatch" style={{ background: swatch?.bg }}>
                    <span style={{ background: swatch?.accent }} />
                    <span style={{ background: swatch?.text }} />
                  </span>
                  <span className="theme-chip-label">{theme.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
