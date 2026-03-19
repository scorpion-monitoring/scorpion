import { db } from '$lib/server/db';
import { session } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import * as jose from 'jose';
import { JWT_SECRET } from '$env/static/private';

const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET.toString());

export const GET: RequestHandler = async ({ cookies }) => {
	const token = cookies.get('access_token');

	if (!token) {
		return new Response(null, { status: 400 });
	}

	var jwt = await jose.jwtVerify(token, JWT_SECRET_BYTES);

	const { payload } = jwt;
	if (!payload.sessionId) {
		return new Response(null, { status: 400 });
	}

	await db.delete(session).where(eq(session.id, payload.sessionId as string));

	cookies.delete('access_token', { path: '/' });

	return new Response();
};
