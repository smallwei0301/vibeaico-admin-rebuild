import type { Config } from 'tailwindcss';

/**
 * Tailwind theme 全部指向 src/styles/tokens.css 的 CSS 變數。
 * 改主題 = 只改 tokens.css，不需要動這支檔案。
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--primary-color)',
          hover: 'var(--primary-hover)',
          deep: 'var(--primary-deep)',
          light: 'var(--primary-light)',
        },
        secondary: 'var(--secondary-color)',
        success: 'var(--success-color)',
        info: 'var(--info-color)',
        warning: 'var(--warning-color)',
        danger: 'var(--danger-color)',
        light: 'var(--light-color)',
        dark: 'var(--dark-color)',
        line: { DEFAULT: 'var(--line-green)', dark: 'var(--line-green-dark)' },
        neutral: {
          0: 'var(--neutral-0)', 25: 'var(--neutral-25)', 50: 'var(--neutral-50)',
          100: 'var(--neutral-100)', 150: 'var(--neutral-150)', 200: 'var(--neutral-200)',
          250: 'var(--neutral-250)', 300: 'var(--neutral-300)', 400: 'var(--neutral-400)',
          500: 'var(--neutral-500)', 600: 'var(--neutral-600)', 700: 'var(--neutral-700)',
          800: 'var(--neutral-800)', 900: 'var(--neutral-900)',
        },
      },
      backgroundImage: {
        'gradient-primary': 'var(--bg-gradient-primary)',
        'gradient-success': 'var(--bg-gradient-success)',
        'gradient-info': 'var(--bg-gradient-info)',
        'gradient-warning': 'var(--bg-gradient-warning)',
        'gradient-danger': 'var(--bg-gradient-danger)',
      },
      borderRadius: {
        xs: 'var(--radius-xs)', sm: 'var(--radius-sm)', DEFAULT: 'var(--radius)',
        md: 'var(--radius-md)', lg: 'var(--radius-lg)', pill: 'var(--radius-pill)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)', DEFAULT: 'var(--shadow)', md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)', xl: 'var(--shadow-xl)', focus: 'var(--shadow-focus)',
        'nav-active': 'var(--shadow-nav-active)',
      },
      fontFamily: { sans: 'var(--font-family)', mono: 'var(--font-mono)' },
      fontSize: {
        '2xs': 'var(--text-2xs)', xs: 'var(--text-xs)', sm: 'var(--text-sm)',
        base: 'var(--text-base)', md: 'var(--text-md)', lg: 'var(--text-lg)',
        xl: 'var(--text-xl)', '2xl': 'var(--text-2xl)', '3xl': 'var(--text-3xl)',
        '4xl': 'var(--text-4xl)',
      },
      spacing: {
        content: 'var(--content-padding)',
        sidebar: 'var(--sidebar-width)',
        'sidebar-collapsed': 'var(--sidebar-collapsed-width)',
        topbar: 'var(--topbar-height)',
      },
      zIndex: {
        sidebar: '1', topbar: '1020', backdrop: '1040',
        modal: '1050', toast: '1080', flyout: '1090',
      },
      transitionDuration: { fast: '150ms', base: '200ms', slow: '300ms' },
      keyframes: {
        spin: { to: { transform: 'rotate(360deg)' } },
        'pulse-dot': {
          '0%':   { boxShadow: '0 0 0 0 rgba(255,68,68,0.3)' },
          '70%':  { boxShadow: '0 0 0 6px rgba(255,68,68,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(255,68,68,0)' },
        },
        'pulse-dot-green': {
          '0%':   { boxShadow: '0 0 0 0 rgba(52,199,89,0.35)' },
          '70%':  { boxShadow: '0 0 0 6px rgba(52,199,89,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(52,199,89,0)' },
        },
        'pending-pulse': {
          '0%,100%': { opacity: '1' },
          '50%':     { opacity: '0.55' },
        },
        'pwa-slide-up': {
          from: { transform: 'translateY(100%)', opacity: '0' },
          to:   { transform: 'translateY(0)', opacity: '1' },
        },
        'lt-bounce': {
          '0%,100%': { transform: 'translateY(0)' },
          '50%':     { transform: 'translateY(-4px)' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        spin: 'spin 1s linear infinite',
        'pulse-dot': 'pulse-dot 2s infinite',
        'pulse-dot-green': 'pulse-dot-green 2s infinite',
        'pending-pulse': 'pending-pulse 1.6s ease-in-out infinite',
        'pwa-slide-up': 'pwa-slide-up 0.3s ease',
        'lt-bounce': 'lt-bounce 1.2s ease-in-out infinite',
        'fade-in': 'fade-in 0.2s ease',
      },
      screens: { xs: '576px', sm: '576px', md: '768px', lg: '992px', xl: '1200px' },
      maxWidth: { content: 'var(--content-max-width)' },
    },
  },
  plugins: [],
};
export default config;
