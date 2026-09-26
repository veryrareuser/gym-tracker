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

/** Chart palette per appearance. Grid and label values clear 4.5:1 on their surface. */
export const CHART_COLORS = {
  light: {
    grid: 'rgba(60,60,67,0.15)',
    axis: '#6b6b70',
    series: '#0066cc',
    accent: '#0066cc',
    muted: '#c6c6c8',
    surface: '#ffffff',
    text: '#000000',
  },
  dark: {
    grid: 'rgba(84,84,88,0.5)',
    axis: '#98989f',
    series: '#0a84ff',
    accent: '#0a84ff',
    muted: '#3a3a3c',
    surface: '#1c1c1e',
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
