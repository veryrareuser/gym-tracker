// src/lib/useColorScheme.js
import { createContext, useContext, useEffect, useState } from 'react'

/**
 * Resolved color scheme, following the OS.
 *
 * Needed because SVG presentation attributes cannot read CSS custom properties,
 * so charting libraries have to be handed literal hex values. Semantic tokens
 * still decide the colors; this only reports which set is active.
 */
export function useColorScheme() {
  const [scheme, setScheme] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  )

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = e => setScheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return scheme
}

/**
 * Chart palette per appearance, drawn from the DESIGN.md token set.
 *
 * SVG presentation attributes cannot read CSS custom properties, so the values are
 * duplicated here as literals. `muted` is the one deliberate choice: the previous
 * near-surface greys were 1.71:1 in light and 1.50:1 in dark, which made the
 * de-emphasised historical bars effectively invisible. De-emphasis is now carried
 * by bar width and fill opacity over the series hue, so the bars stay legible.
 */
export const CHART_COLORS = {
  light: {
    grid: 'rgba(0, 0, 0, 0.08)',
    axis: '#333333',
    series: '#0066cc',
    accent: '#0066cc',
    muted: '#0066cc',
    surface: '#ffffff',
    text: '#1d1d1f',
  },
  dark: {
    grid: 'rgba(255, 255, 255, 0.14)',
    axis: '#cccccc',
    series: '#2997ff',
    accent: '#2997ff',
    muted: '#2997ff',
    surface: '#252527',
    text: '#ffffff',
  },
}

/**
 * Chart colors are exposed as context so tooltip components can be declared once at
 * module scope. Defining them inside a render would remount them on every render.
 */
export const ChartThemeContext = createContext(CHART_COLORS.light)

export function useChartTheme() {
  return useContext(ChartThemeContext)
}
