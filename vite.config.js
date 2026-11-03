import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  assetsInclude: ['**/*.glb'],
  resolve: {
    alias: {
      // Create an alias for 'three' to ensure modules are resolved correctly
      'three': path.resolve(__dirname, './node_modules/three')
    }
    
  }, // Added a comma here!
  build: {
    rollupOptions: {
      output: {
        assetFileNames: assetInfo => {
          if (assetInfo.name.endsWith('.ttf')) {
            return 'fonts/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  },
  server: {
    watch: {
      ignored: ['**/dist/**', '**/node_modules/**'],
    },
  },
});
