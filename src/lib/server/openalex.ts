import { OPENALEX_API_KEY } from '$env/static/private';
import { OPENALEX_MAX_OR_FILTER_VALUES, OPENALEX_PER_PAGE } from './constants';

async function fetchWithRetries(url: string, init: RequestInit, maxRetries = 3) {
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const resp = await fetch(url, init);
		if (resp.status !== 429) return resp;
		// simple exponential backoff on 429
		const waitMs = Math.pow(2, attempt) * 1000;
		await new Promise((r) => setTimeout(r, waitMs));
	}
	// final try
	return fetch(url, init);
}

export async function bulkSearch(dois: string[]) {
	if (!Array.isArray(dois) || dois.length === 0) return [];

	const base = 'https://api.openalex.org/works';
	const results: any[] = [];
	const chunkSize = OPENALEX_MAX_OR_FILTER_VALUES;

	for (let i = 0; i < dois.length; i += chunkSize) {
		const chunk = dois.slice(i, i + chunkSize);
		// prefer canonical DOI URL form and URL-encode each DOI
		const filterVal = chunk.join('|');

		const params = new URLSearchParams({
			filter: `doi:${filterVal}`,
			per_page: OPENALEX_PER_PAGE.toString()
		});
		if (OPENALEX_API_KEY) params.set('api_key', OPENALEX_API_KEY);

		const url = `${base}?${params.toString()}`;

		const resp = await fetchWithRetries(url, {
			method: 'GET',
			headers: { 'Content-Type': 'application/json' }
		});
		if (!resp.ok) {
			throw new Error(`OpenAlex API error: ${resp.status} ${resp.statusText}`);
		}

		const data = await resp.json();
		if (Array.isArray(data.results)) results.push(...data.results);
	}

	return results;
}
