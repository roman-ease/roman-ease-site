import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://www.roman-ease.com',
  integrations: [],
  markdown: {
    shikiConfig: {
      theme: 'github-light',
      wrap: true,
    },
  },
});
