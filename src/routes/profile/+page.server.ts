import type { PageServerLoad } from './$types';
import * as jose from 'jose';
import { JWT_SECRET } from '$env/static/private';
import { db } from '$lib/server/db';
import {
	userToProvider,
	providerToService,
	service,
	user,
	userView,
	provider,
	userToToken,
	token
} from '$lib/server/db/schema';
import { count, eq } from 'drizzle-orm';

const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET.toString());

export const load: PageServerLoad = async ({ cookies }) => {
	let access_token = cookies.get('access_token');
	if (!access_token) {
		return new Response(null, { status: 400 });
	}

	var jwt = await jose.jwtVerify(access_token, JWT_SECRET_BYTES);
	const { payload } = jwt;
	if (!payload.userId) {
		return new Response(null, { status: 400 });
	}

	let userId = payload.userId as string;

	return {
		user: (await db.select().from(userView).where(eq(userView.id, userId)))[0] || null,
		providers: await db
			.select({
				id: provider.id,
				abbreviation: provider.abbreviation,
				name: provider.name,
				members: count(userToProvider.userId)
			})
			.from(provider)
			.leftJoin(userToProvider, eq(provider.id, userToProvider.providerId))
			.groupBy(provider.id, provider.abbreviation, provider.name),
		tokens: await db
			.select({ id: token.id, name: token.name, created: token.created, lastUsed: token.lastUsed })
			.from(userToToken)
			.innerJoin(token, eq(userToToken.tokenId, token.id))
			.where(eq(userToToken.userId, userId))
	};
};
