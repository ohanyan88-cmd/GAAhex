import React, { useEffect } from 'react'
import type { Decorator } from '@storybook/react'

// The app loads these globally in main.tsx; Storybook's preview does not, so we
// import them here. `color-tokens.css` defines the --gx-* palette and
// `styles.css` defines the unprefixed semantic tokens (--primary, --surface,
// --text, …) that every primitive consumes.
import '../../color-tokens.css'
import '../../styles.css'

/**
 * Mirrors the app's runtime behaviour (`<html data-theme="dark">`, the app
 * default) and paints a matching canvas so the primitives sit on a real
 * surface instead of Storybook's white default.
 */
export const withTheme: Decorator = (Story) => {
  useEffect(() => {
    const prev = document.documentElement.getAttribute('data-theme')
    document.documentElement.setAttribute('data-theme', 'dark')
    return () => {
      if (prev) document.documentElement.setAttribute('data-theme', prev)
    }
  }, [])

  return (
    <div
      data-theme="dark"
      style={{
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-body)',
        padding: 'var(--gx-space-16)',
        minHeight: '100vh',
      }}
    >
      <Story />
    </div>
  )
}
