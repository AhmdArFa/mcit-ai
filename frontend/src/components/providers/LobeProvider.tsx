'use client'

import { useEffect, useState } from 'react'
import { ConfigProvider, ThemeProvider } from '@lobehub/ui'
import { motion } from 'motion/react'

import { useTheme } from '@/lib/stores/theme-store'

/**
 * Lobe UI context for the whole app. Global styles stay off so Tailwind keeps
 * owning the base layer; Lobe components get their tokens, light/dark mode
 * follows the app theme toggle.
 *
 * The provider mounts on the client only: its CSS-in-JS output depends on the
 * persisted theme, which the server cannot know, and rendering it during SSR
 * caused a hydration mismatch. Lobe components only appear after the auth
 * check, which already runs client side, so nothing renders without it.
 */
export function LobeProvider({ children }: { children: React.ReactNode }) {
  const { isDark } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <>{children}</>
  return (
    <ConfigProvider motion={motion}>
      <ThemeProvider
        themeMode={isDark ? 'dark' : 'light'}
        enableGlobalStyle={false}
        enableCustomFonts={false}
        style={{ minHeight: '100%', background: 'transparent' }}
      >
        {children}
      </ThemeProvider>
    </ConfigProvider>
  )
}

/**
 * Lobe/antd tokens are CSS variables scoped to the ThemeProvider's `.ant-app`
 * element. Content portaled elsewhere (Radix dialogs) must carry the same
 * classes, or Lobe controls render without their colors.
 */
export function useLobeScopeClass() {
  const [cls, setCls] = useState('')
  useEffect(() => {
    const app = document.querySelector('.ant-app')
    if (app) setCls(Array.from(app.classList).filter((c) => c.startsWith('css-')).join(' '))
  }, [])
  return cls
}
