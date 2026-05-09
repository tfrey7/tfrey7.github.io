/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // navy used for the name + section headings + company names —
        // matches the resume PDF, slightly tuned for screen.
        navy: {
          DEFAULT: '#1e3a8a',
          deep: '#172554',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      maxWidth: {
        page: '46rem',
      },
    },
  },
  plugins: [],
};
