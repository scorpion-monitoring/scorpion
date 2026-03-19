import { error, redirect, type Handle } from '@sveltejs/kit';
// @ts-ignore
import schedule from 'node-schedule';
import * as auth from '$lib/server/auth';
import { apiLogs, publication } from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { verifyToken } from '$lib/server/db/tokens';
import { bulkSearch } from '$lib/server/openalex';
import { backupDatabase } from '$lib/server/backup';

const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
	'Access-Control-Max-Age': '3600'
};

// schedule.scheduleJob('* * * * *', async () => {
// 	console.log('Running backup job');
// 	try {
// 		await backupDatabase();
// 	} catch (err) {
// 		console.error('Error during backup:', err);
// 	}
// });

// const job = schedule.scheduleJob('* * * * *', async () => {

// 	const publicationRecords = await db
// 		.select({
// 			serviceId: publication.serviceId,
// 			dois: sql<string[]>`
// 			coalesce(
// 				array_agg(distinct ${publication.doi}) filter (where ${publication.doi} is not null),
// 				'{}'::text[]
// 			)
// 		`.as('dois')
// 		})
// 		.from(publication)
// 		.groupBy(publication.serviceId);

// 	for (const record of publicationRecords) {
// 		const openAlexData = await bulkSearch(record.dois as string[]);
// 		const citationCount = openAlexData.reduce((sum, item) => sum + (item.cited_by_count || 0), 0);
// 		console.log(`Total citations for service ${record.serviceId}: ${citationCount}`);
// 	}

// });

const handleAuth: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	if (pathname.includes('/api/v1') || pathname.includes('/api/v2')) {
		// Retrieve the X-API-Key header from the request
		const apiKey = event.request.headers.get('X-API-Key');
		if (!apiKey) {
			return new Response(JSON.stringify({ error: 'Missing API key' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
			});
		}

		// Validate the API key against the database
		const userId = await verifyToken(apiKey);
		if (!userId) {
			return new Response(JSON.stringify({ error: 'Invalid API key' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
			});
		}

		// Handle preflight
		if (event.request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: CORS_HEADERS
			});
		}

		// Add userId to the event for use in API route handlers
		(event.locals as any).userId = userId;

		// TODO: Log the request details (method, path, userId) for monitoring and debugging
		let bodyText = '';
		if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
			bodyText = await event.request.text();
		}
		const logEntry = await db
			.insert(apiLogs)
			.values({
				method: event.request.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS',
				endpoint: pathname,
				userId: userId,
				body: bodyText,
				query: event.url.searchParams.toString(),
				timestamp: new Date().toISOString()
			})
			.returning();

		// Clone request with body for downstream handlers
		if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
			const clonedRequest = new Request(event.request, { body: bodyText });
			event.request = clonedRequest;
		}

		// Resolve the request, then attach CORS headers to the response
		const response = await resolve(event);
		const headers = new Headers(response.headers);
		Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));

		const body = await response.arrayBuffer();

		return new Response(body, {
			status: response.status,
			statusText: response.statusText,
			headers
		});
	}

	const token = event.cookies.get('access_token');
	if (pathname.split('/')[2] === 'login' || pathname.split('/')[2] === 'register') {
		// get the token from cookies
		if (await auth.verifyJWT(token)) {
			// user is already authenticated, redirect to home
			return redirect(302, './');
		}
	} else if (pathname.endsWith('/services/onboarding')) {
		return resolve(event);
	} else {
		if (await auth.verifyJWT(token)) {
			// TODO: Additional validation logic
			return resolve(event);
		} else {
			// No token, redirect to login
			return redirect(302, './login');
		}
	}

	return resolve(event);
};

export const handle: Handle = handleAuth;
