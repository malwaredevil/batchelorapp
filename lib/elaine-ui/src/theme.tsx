import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "batchelor-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Single source of truth for light/dark mode, shared across every sub-app
 * (Hub, Pottery, Quilting, Travels, Elaine) via @workspace/elaine-ui so the
 * choice never desyncs between them. Persists to localStorage under one key
 * shared across the whole domain, and listens for cross-tab/cross-app
 * `storage` events so switching apps in the same browser session carries the
 * choice over instantly, even before the account-level preference syncs.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    window.localStorage.setItem(STORAGE_KEY, t);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // React to changes made by the hub or other sub-apps on the same origin
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (
        e.key === STORAGE_KEY &&
        (e.newValue === "light" || e.newValue === "dark")
      ) {
        setThemeState(e.newValue);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider
      value={{ theme, setTheme, toggleTheme, isDark: theme === "dark" }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
