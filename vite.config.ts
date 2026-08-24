import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs. GitHub Pages serves the project from a sub-path
  // (/street_tree_recorder/), and "./" resolves correctly there without hard
  // coding the repository name, so the same build also works locally.
  base: './',

  // getUserMedia and Geolocation only work in a secure context, and "localhost"
  // does not count once the phone loads the app over the LAN. basicSsl serves a
  // self-signed certificate so the dev server is https:// on every device.
  plugins: [react(), basicSsl()],
  server: {
    host: true,
  },
})
