/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      spacing: {
        'gx-1': 'var(--gx-space-1)', 'gx-2': 'var(--gx-space-2)',
        'gx-3': 'var(--gx-space-3)', 'gx-4': 'var(--gx-space-4)',
        'gx-5': 'var(--gx-space-5)', 'gx-6': 'var(--gx-space-6)',
        'gx-7': 'var(--gx-space-7)', 'gx-8': 'var(--gx-space-8)',
        'gx-10': 'var(--gx-space-10)', 'gx-12': 'var(--gx-space-12)',
        'gx-16': 'var(--gx-space-16)', 'gx-20': 'var(--gx-space-20)',
      },
      borderRadius: {
        'gx-none': 'var(--gx-radius-none)', 'gx-sm': 'var(--gx-radius-sm)',
        'gx-md': 'var(--gx-radius-md)', 'gx-lg': 'var(--gx-radius-lg)',
        'gx-xl': 'var(--gx-radius-xl)', 'gx-full': 'var(--gx-radius-full)',
      },
      fontSize: {
        'gx-9':  ['var(--gx-text-9)',  { lineHeight: 'var(--gx-leading-normal)' }],
        'gx-10': ['var(--gx-text-10)', { lineHeight: 'var(--gx-leading-normal)' }],
        'gx-11': ['var(--gx-text-11)', { lineHeight: 'var(--gx-leading-snug)' }],
        'gx-12': ['var(--gx-text-12)', { lineHeight: 'var(--gx-leading-snug)' }],
        'gx-13': ['var(--gx-text-13)', { lineHeight: 'var(--gx-leading-tight)' }],
        'gx-14': ['var(--gx-text-14)', { lineHeight: 'var(--gx-leading-tight)' }],
        'gx-16': ['var(--gx-text-16)', { lineHeight: 'var(--gx-leading-snug)' }],
        'gx-18': ['var(--gx-text-18)', { lineHeight: 'var(--gx-leading-tight)' }],
        'gx-22': ['var(--gx-text-22)', { lineHeight: 'var(--gx-leading-none)' }],
        'gx-28': ['var(--gx-text-28)', { lineHeight: 'var(--gx-leading-none)' }],
      },
      boxShadow: {
        'gx-sm': 'var(--gx-shadow-sm)', 'gx-md': 'var(--gx-shadow-md)',
        'gx-lg': 'var(--gx-shadow-lg)', 'gx-focus': 'var(--gx-shadow-focus)',
      },
      transitionDuration: {
        'gx-instant': 'var(--gx-duration-instant)', 'gx-fast': 'var(--gx-duration-fast)',
        'gx-base': 'var(--gx-duration-base)', 'gx-slow': 'var(--gx-duration-slow)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
