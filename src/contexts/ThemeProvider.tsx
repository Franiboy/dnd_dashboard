import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { ThemeContext, type ThemePreview } from '../hooks/useTheme';
import { buildTheme, isValidHexColor } from '../lib/color';

// Every variable buildTheme can emit, used to clear overrides when switching
// back to the default theme. The key set is deterministic per valid input.
const THEME_VARIABLES = Object.keys(buildTheme('#000000'));

/**
 * Owns the runtime theming: derives CSS variables from the logged-in user's
 * saved primary color and writes them as inline overrides on <html> (same
 * mechanism as --header-height). While the color picker is open, a preview
 * can override the saved value and is reverted on endPreview().
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [preview, setPreview] = useState<ThemePreview | null>(null);

  const saved = isValidHexColor(user?.themePrimary) ? user!.themePrimary : null;
  const effectiveHex = preview ? preview.hex : saved;

  useEffect(() => {
    const style = document.documentElement.style;
    const tokens = buildTheme(effectiveHex);
    for (const name of THEME_VARIABLES) {
      const value = tokens[name];
      if (value) style.setProperty(name, value);
      else style.removeProperty(name);
    }
  }, [effectiveHex]);

  const previewTheme = useCallback((hex: string | null) => {
    setPreview({ hex });
  }, []);

  const endPreview = useCallback(() => setPreview(null), []);

  const value = useMemo(
    () => ({ themePrimary: saved, preview, previewTheme, endPreview }),
    [saved, preview, previewTheme, endPreview]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
