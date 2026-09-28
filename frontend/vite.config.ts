import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [react(), tailwindcss()],

	server: {
		host: 'localhost',
		port: 5173,
		strictPort: false,
		open: false,
		cors: true,
        allowedHosts: ['uncaroled-kaitlin-bookishly.ngrok-free.dev'],
	},

	preview: {
		host: 'localhost',
		port: 4173,
		strictPort: false,
	},

	build: {
		target: 'es2022',
		outDir: 'dist',
		emptyOutDir: true,
		sourcemap: true,
		minify: 'esbuild',
		chunkSizeWarningLimit: 1000,
	},

	resolve: {
		extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
	},

	optimizeDeps: {
		include: [
			'react',
			'react-dom',
			'react-router-dom',
			'axios',
			'zustand',
			'recharts',
			'socket.io-client',
		],
	},
})
