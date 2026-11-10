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
 * Chart palette per appearance, drawn from the design tokens.
 *
 * SVG presentation attributes cannot read CSS custom properties, so the values are
 * duplicated here as literals. `muted` is the one deliberate choice: the previous
 * near-surface greys were 1.71:1 in light and 1.50:1 in dark, which made the
 * de-emphasised historical bars effectively invisible. De-emphasis is now carried
 * by bar width and fill opacity over the series hue, so the bars stay legible.
 *
 * The light series colour is the darkened accent (#1565c0), not the palette's
 * brighter #2196f3: a chart label has to be readable, and the bright blue is only
 * 3.13:1 on white. In dark mode the accent is the light blue, which is 9.5:1 on
 * the dark canvas.
 */
export const CHART_COLORS = {
  light: {
    grid: 'rgba(0, 0, 0, 0.14)',
    axis: '#000000',
    series: '#1565c0',
    accent: '#1565c0',
    muted: '#1565c0',
    surface: '#ffffff',
    text: '#000000',
  },
  dark: {
    grid: 'rgba(255, 255, 255, 0.22)',
    axis: '#ffffff',
    series: '#64b5f6',
    accent: '#64b5f6',
    muted: '#64b5f6',
    surface: '#1a1a1a',
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
