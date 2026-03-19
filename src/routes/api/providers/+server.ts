import { db } from '$lib/server/db';
import { provider, user, userToProvider } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';
import * as jose from 'jose';
import { JWT_SECRET } from '$env/static/private';
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';

const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET.toString());

export const GET: RequestHandler = async ({ cookies, url }) => {
	let is_member = Boolean(url.searchParams.get('is_member'));

	if (is_member) {
		let token = cookies.get('access_token');
		if (!token) {
			return new Response('Unauthorized', { status: 401 });
		}
		var jwt = await jose.jwtVerify(token, JWT_SECRET_BYTES);
		const { payload } = jwt;
		if (!payload.userId) {
			return new Response('Unauthorized', { status: 401 });
		}

		const userId = payload.userId as string;

		const userProviders = await db
			.select()
			.from(userToProvider)
			.where(eq(userToProvider.userId, userId))
			.innerJoin(provider, eq(provider.id, userToProvider.providerId));

		const providers = userProviders.map((up) => ({
			id: up.provider.id,
			name: up.provider.name,
			abbreviation: up.provider.abbreviation
		}));

		return json(providers);
	} else {
		const allProviders = await db.select().from(provider).orderBy(provider.name);
		const providers = allProviders.map((p) => ({
			name: p.name,
			abbreviation: p.abbreviation
		}));
		return json(providers);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const providers = await request.json();

	let inserted = [];
	for (const p of providers) {
		const existingByName = await db.select().from(provider).where(eq(provider.name, p.name));
		const existingByAbbreviation = await db
			.select()
			.from(provider)
			.where(eq(provider.abbreviation, p.abbreviation));

		if (existingByName.length > 0 || existingByAbbreviation.length > 0) {
			continue;
		}

		inserted.push(
			await db
				.insert(provider)
				.values({
					name: p.name,
					abbreviation: p.abbreviation
				})
				.returning()
		);
	}

	return json({ providers: inserted });
};
