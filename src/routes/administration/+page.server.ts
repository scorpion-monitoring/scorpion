import type { PageServerLoad } from './$types';
import * as jose from 'jose';
import { JWT_SECRET } from '$env/static/private';
import { error } from '@sveltejs/kit';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';

const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET.toString());

export const load = (async ({ cookies }) => {
	let token = cookies.get('access_token');
	if (!token) {
		return new Response(null, { status: 400 });
	}

	var jwt = await jose.jwtVerify(token, JWT_SECRET_BYTES);
	const { payload } = jwt;
	if (!payload.userId) {
		return new Response(null, { status: 400 });
	}

	let userId = payload.userId as string;

	const user = await checkAdmin(userId);
	return { user };
}) satisfies PageServerLoad;

async function checkAdmin(userId: string) {
	return await db
		.select()
		.from(user)
		.where(eq(user.id, userId))
		.limit(1)
		.then((users) => {
			if (users.length === 0 || users[0].role !== 'Admin') {
				throw error(401, 'Unauthorized');
			}
			return users[0];
		});
}
