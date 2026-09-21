import { createContext, useContext } from 'react';

/** Active live preview; `hex: null` previews the default theme (reset). */
export interface ThemePreview {
  hex: string | null;
}

export interface ThemeContextValue {
  /** Saved primary color of the logged-in user as #rrggbb; null = default theme. */
  themePrimary: string | null;
  /** Currently previewed color, if the picker is mid-edit. */
  preview: ThemePreview | null;
  /** Apply a color live without persisting it. */
  previewTheme: (hex: string | null) => void;
  /** Drop the preview and fall back to the saved value. */
  endPreview: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
