import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createToken, verifyToken } from '$lib/server/db/tokens';
import { db } from '$lib/server/db';
import { token, userToToken } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	return new Response();
};

export const POST: RequestHandler = async ({ request }) => {
	const requestBody = await request.json();

	const userId = request.url.split('/')[request.url.split('/').length - 2];

	const tokenName = requestBody.name;

	const token = await createToken(userId, tokenName);

	return json(token);
};

export const DELETE: RequestHandler = async ({ url }) => {
	const tokenId = url.searchParams.get('token');
	if (!tokenId) {
		return new Response(null, { status: 400 });
	}
	await db.delete(userToToken).where(eq(userToToken.tokenId, Number(tokenId)));
	await db.delete(token).where(eq(token.id, Number(tokenId)));
	return new Response(null, { status: 200 });
};
