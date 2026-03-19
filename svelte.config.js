import adapter from '@sveltejs/adapter-node';
import fs from 'fs';
import path from 'path';

function readDotenv() {
	try {
		const envPath = path.resolve(process.cwd(), '.env');
		if (!fs.existsSync(envPath)) return {};
		const content = fs.readFileSync(envPath, 'utf8');
		const out = {};
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

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// Use adapter-node explicitly to avoid environment auto-detection differences.
		adapter: adapter(),
		paths: (function () {
			const raw = DOTENV.BASE_PATH || process.env.BASE_PATH || '';
			if (!raw) return undefined;
			// ensure leading slash, no trailing slash
			const base = raw.startsWith('/') ? raw.replace(/\/$/, '') : '/' + raw.replace(/\/$/, '');
			return { base };
		})()
	}
};

export default config;
