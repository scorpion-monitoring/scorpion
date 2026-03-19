import { db } from '$lib/server/db';
import { apiLogs, user } from '$lib/server/db/schema';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { count, desc, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const page = Number(url.searchParams.get('page') ?? '0');
	const pageSize = Number(url.searchParams.get('pageSize') ?? '50');

	const totalCount = await db
		.select({
			count: count()
		})
		.from(apiLogs)
		.innerJoin(user, eq(apiLogs.userId, user.id));

	const logs = await db
		.select({
			timestamp: apiLogs.timestamp,
			method: apiLogs.method,
			endpoint: apiLogs.endpoint,
			body: apiLogs.body,
			query: apiLogs.query,
			user: user.username
		})
		.from(apiLogs)
		.innerJoin(user, eq(apiLogs.userId, user.id))
		.offset(page * pageSize)
		.limit(pageSize)
		.orderBy(desc(apiLogs.timestamp));

	return json({ logs, count: totalCount[0].count });
};
