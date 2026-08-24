import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // getUserMedia and Geolocation only work in a secure context, and "localhost"
  // does not count once the phone loads the app over the LAN. basicSsl serves a
  // self-signed certificate so the dev server is https:// on every device.
  plugins: [react(), basicSsl()],
  server: {
    host: true,
  },
})
