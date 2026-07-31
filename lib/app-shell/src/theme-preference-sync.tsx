import { useEffect } from "react";
import { useTheme } from "@workspace/elaine-ui";
import { useAuth } from "@workspace/web-core/auth";

/**
 * Applies the authenticated account's saved theme in every SPA.
 *
 * Keep this next to each SPA router (inside AuthProvider + ThemeProvider) so
 * a theme change made from Account settings follows the user across artifacts.
 */
export function ThemePreferenceSync() {
  const { user } = useAuth();
  const { setTheme } = useTheme();

  useEffect(() => {
    const preference = user?.themePreference;
    if (preference === "light" || preference === "dark") {
      setTheme(preference);
    }
  }, [setTheme, user?.themePreference]);

  return null;
}
