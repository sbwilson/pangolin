import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchPreferences,
  type Preferences,
  type ThemeMode,
  type ThemeName,
  updatePreferences,
} from "./api.ts";

export const PREFERENCES_QUERY_KEY = ["preferences"] as const;

export interface ThemeContextValue {
  readonly theme: ThemeName;
  readonly mode: ThemeMode;
  readonly resolvedMode: "light" | "dark";
  readonly setTheme: (theme: ThemeName) => void;
  readonly setMode: (mode: ThemeMode) => void;
  readonly isPending: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY_THEME = "pangolin_theme";
const STORAGE_KEY_MODE = "pangolin_mode";

function getInitialTheme(): ThemeName {
  if (typeof window === "undefined") return "clay-linen";
  try {
    const stored = window.localStorage?.getItem(STORAGE_KEY_THEME) as ThemeName | null;
    if (stored) return stored;
  } catch {}
  return "clay-linen";
}

function getInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage?.getItem(STORAGE_KEY_MODE) as ThemeMode | null;
    if (stored) return stored;
  } catch {}
  return "system";
}

function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const [theme, setLocalTheme] = useState<ThemeName>(getInitialTheme);
  const [mode, setLocalMode] = useState<ThemeMode>(getInitialMode);
  const [systemDark, setSystemDark] = useState<boolean>(getSystemPrefersDark);

  const { data } = useQuery({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: fetchPreferences,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (data) {
      if (data.theme) {
        setLocalTheme(data.theme);
        try {
          window.localStorage?.setItem(STORAGE_KEY_THEME, data.theme);
        } catch {}
      }
      if (data.mode) {
        setLocalMode(data.mode);
        try {
          window.localStorage?.setItem(STORAGE_KEY_MODE, data.mode);
        } catch {}
      }
    }
  }, [data]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  const resolvedMode: "light" | "dark" = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-mode", mode);
    root.setAttribute("data-resolved-mode", resolvedMode);
  }, [theme, mode, resolvedMode]);

  const mutation = useMutation({
    mutationFn: (patch: Partial<Preferences>) => updatePreferences(patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(PREFERENCES_QUERY_KEY, updated);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: PREFERENCES_QUERY_KEY });
    },
  });

  const setTheme = useCallback(
    (newTheme: ThemeName) => {
      setLocalTheme(newTheme);
      try {
        window.localStorage?.setItem(STORAGE_KEY_THEME, newTheme);
      } catch {}
      mutation.mutate({ theme: newTheme });
    },
    [mutation],
  );

  const setMode = useCallback(
    (newMode: ThemeMode) => {
      setLocalMode(newMode);
      try {
        window.localStorage?.setItem(STORAGE_KEY_MODE, newMode);
      } catch {}
      mutation.mutate({ mode: newMode });
    },
    [mutation],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      mode,
      resolvedMode,
      setTheme,
      setMode,
      isPending: mutation.isPending,
    }),
    [theme, mode, resolvedMode, setTheme, setMode, mutation.isPending],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
