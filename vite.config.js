import { defineConfig } from 'vite';

// Relative base so the built `dist/` folder works from any path (GitHub Pages, a subfolder...).
export default defineConfig({
  base: './',
  build: { target: 'es2020' },
});
