import type { LayoutServerLoad } from './$types';
import * as jose from 'jose';
import { JWT_SECRET } from '$env/static/private';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const load: LayoutServerLoad = async ({ cookies }) => {
	const token = cookies.get('access_token');

	if (!token) {
		return { user: null };
	}

	try {
		const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET);
		const { payload } = await (jose as any).jwtVerify(token, JWT_SECRET_BYTES);

		const userDetail = await db
			.select({ icon: user.icon, approved: user.approved })
			.from(user)
			.where(eq(user.id, (payload as any).userId));

		return {
			user: {
				id: (payload as any).userId ?? null,
				username: (payload as any).username ?? null,
				icon: userDetail[0]?.icon ?? null,
				approved: userDetail[0]?.approved ?? null
			}
		};
	} catch (err) {
		return { user: null };
	}
};
