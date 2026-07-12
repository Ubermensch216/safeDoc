import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 최종 산출물: 모든 JS/CSS/자원이 인라인된 단일 HTML 파일 (FR-001)
// 외부 CDN·외부 URL 자원을 사용하지 않는다 (NFR-002)
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
