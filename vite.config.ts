import tailwindcss from '@tailwindcss/vite';
import openapiPlugin from 'sveltekit-openapi-generator';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

function readDotenv(): Record<string, string> {
	try {
		const envPath = path.resolve(process.cwd(), '.env');
		if (!fs.existsSync(envPath)) return {};
		const content = fs.readFileSync(envPath, 'utf8');
		const out: Record<string, string> = {};
		for (const line of content.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const idx = trimmed.indexOf('=');
			if (idx === -1) continue;
			const key = trimmed.slice(0, idx).trim();
			let val = trimmed.slice(idx + 1).trim();
			if (
				(val.startsWith('"') && val.endsWith('"')) ||
				(val.startsWith("'") && val.endsWith("'"))
			) {
				val = val.slice(1, -1);
			}
			out[key] = val;
		}
		return out;
	} catch {
		return {};
	}
}

const DOTENV = readDotenv();
const rawBase = DOTENV.BASE_PATH || process.env.BASE_PATH || '';
const normalizedBase = rawBase
	? (rawBase.startsWith('/') ? rawBase.replace(/\/$/, '') : '/' + rawBase.replace(/\/$/, '')) + '/'
	: '/';

export default defineConfig({
	plugins: [
		openapiPlugin({
			// OpenAPI info section
			info: {
				title: 'Scorpion API',
				version: '2.0.0',
				description: 'Documentation for the Scorpion API'
			},
			// OpenAPI servers configuration
			servers: [
				{ url: 'https://scorpion.bi.denbi.de', description: 'Production' },
				{ url: 'http://localhost:5173', description: 'Development' }
			],
			// Path to shared schema definitions
			baseSchemasPath: 'src/lib/openapi/schemas.ts',
			// Additional YAML files to include
			yamlFiles: ['src/lib/extra-specs.yaml'],
			// Path prefix for all routes
			prependPath: normalizedBase.slice(0, -1),
			// Glob patterns to include
			include: ['src/routes/**/{+server,+page.server}.{js,ts}'],
			// Glob patterns to exclude
			exclude: ['**/node_modules/**', '**/.svelte-kit/**'],
			// Whether to fail on JSDoc parsing errors
			failOnErrors: false,
			// Output path for the spec file during build
			outputPath: 'static/openapi.json',
			// Debounce delay in milliseconds for file watching
			debounceMs: 200
		}),
		tailwindcss(),
		sveltekit()
	]
});
