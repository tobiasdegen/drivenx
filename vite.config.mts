import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: 'drivenx-csp',
      transformIndexHtml(html) {
        const connect =
          command === 'serve' ? "'self' http://127.0.0.1:5173 ws://127.0.0.1:5173" : "'self'";
        return html.replace('__CONNECT_SRC__', connect);
      },
    },
  ],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
