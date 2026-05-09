import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  site: 'https://tfrey7.github.io',
  base: '/personal-profile',
  trailingSlash: 'ignore',
  integrations: [svelte(), tailwind({ applyBaseStyles: false })],
});
