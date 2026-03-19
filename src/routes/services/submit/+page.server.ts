import type { PageServerLoad } from './$types';
import * as jose from 'jose';
import { JWT_SECRET } from '$env/static/private';
import { db } from '$lib/server/db';
import { userToProvider, providerToService, service } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET.toString());

export const load: PageServerLoad = async ({ cookies }) => {
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

	const services = await db
		.select()
		.from(userToProvider)
		.where(eq(userToProvider.userId, userId))
		.innerJoin(providerToService, eq(userToProvider.providerId, providerToService.providerId))
		.innerJoin(service, eq(providerToService.serviceId, service.id));

	return { services: services.map((s) => s.service) };
};
