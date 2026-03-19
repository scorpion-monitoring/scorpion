import { db } from '$lib/server/db';
import { indicator, measurements, indicatorCategory, service } from '$lib/server/db/schema';
import { and, eq, gte, lte } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { loadDashboardData } from '$lib/server/db/measurements';

export const GET: RequestHandler = async ({ url }) => {
	const pService = url.searchParams.get('service');
	const pDuration = url.searchParams.get('duration');
	const pFilter = url.searchParams.get('filter');

	const data = await loadDashboardData(pService, pDuration, pFilter);

	return json(data);
};
