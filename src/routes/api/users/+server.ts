import type { User } from '$lib/openapi/schemas';
import { db } from '$lib/server/db';
import { provider, user, userToProvider } from '$lib/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
	const users: Array<User> = [];
	var db_users = await db
		.select({
			id: user.id,
			name: user.username,
			email: user.email,
			role: user.role,
			approved: user.approved
		})
		.from(user);

	var user_providers = await db
		.select({
			userId: userToProvider.userId,
			approved: userToProvider.approved,
			providerAbbreviation: provider.abbreviation,
			providerName: provider.name
		})
		.from(userToProvider)
		.innerJoin(provider, eq(userToProvider.providerId, provider.id));

	const userProvidersMap: Map<string, { abbreviation: string; name: string; approved: boolean }[]> =
		new Map();
	for (const up of user_providers) {
		if (!userProvidersMap.has(up.userId)) {
			userProvidersMap.set(up.userId, []);
		}
		userProvidersMap.get(up.userId)!.push({
			abbreviation: up.providerAbbreviation,
			name: up.providerName,
			approved: Boolean(up.approved)
		});
	}

	for (const u of db_users) {
		users.push({
			id: u.id,
			approved: u.approved ?? false,
			username: u.name,
			email: u.email,
			role: u.role,
			providers: userProvidersMap.get(u.id) || []
		});
	}

	return json({ users });
};
