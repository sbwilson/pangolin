import type { ThemeMode, ThemeName } from "../api.ts";
import { useTheme } from "../theme.tsx";

export const THEME_OPTIONS: readonly {
  readonly id: ThemeName;
  readonly name: string;
  readonly description: string;
  readonly primaryColor: string;
}[] = [
  { id: "clay-linen", name: "Clay & Linen", description: "Warm terracotta & linen", primaryColor: "#A3441D" },
  { id: "harbour-morning", name: "Harbour Morning", description: "Crisp blue & white", primaryColor: "#0A5CBD" },
  { id: "fern-gully", name: "Fern Gully", description: "Earthy green & eucalyptus", primaryColor: "#2B7446" },
  { id: "galah-party", name: "Galah Party", description: "Vibrant berry pink", primaryColor: "#C11574" },
  { id: "gelato-bar", name: "Gelato Bar", description: "Playful violet & pastels", primaryColor: "#6A4FCF" },
  { id: "black-opal", name: "Black Opal", description: "Deep teal & Australian stone", primaryColor: "#0D6669" },
];

export const MODE_OPTIONS: readonly { readonly id: ThemeMode; readonly label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

export function ThemeSwitcher() {
  const { theme, mode, setTheme, setMode } = useTheme();

  return (
    <section aria-labelledby="theme-heading" className="space-y-6">
      <div>
        <h2 id="theme-heading" className="text-base font-semibold">
          Appearance
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose a color palette and light or dark display mode.
        </p>
      </div>

      <div className="space-y-2">
        <div id="mode-label" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Mode
        </div>
        <div
          role="radiogroup"
          aria-labelledby="mode-label"
          className="inline-flex rounded-lg border border-border p-1 bg-muted"
        >
          {MODE_OPTIONS.map((opt) => {
            const isSelected = mode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setMode(opt.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  isSelected
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div id="theme-label" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Theme
        </div>
        <div
          role="radiogroup"
          aria-labelledby="theme-label"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {THEME_OPTIONS.map((opt) => {
            const isSelected = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setTheme(opt.id)}
                className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${
                  isSelected
                    ? "border-primary bg-accent ring-1 ring-primary"
                    : "border-border bg-card hover:border-muted-foreground/30"
                }`}
              >
                <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="6" fill={opt.primaryColor} />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">{opt.name}</div>
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
