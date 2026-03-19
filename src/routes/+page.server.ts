import * as jose from 'jose';
import { JWT_SECRET } from '$env/static/private';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { announcement, service, settings, userView } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { resolve } from '$app/paths';
import { loadDashboardData } from '$lib/server/db/measurements';

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

	const services = (await db.select().from(service).orderBy(service.name)) || [];

	const userSettings = (
		await db
			.select()
			.from(settings)
			.where(eq(settings.key, payload.userId as string))
	)[0]?.value;
	let measurementPayload: { service: string; duration: string; filter: string } = {
		service: '',
		duration: '',
		filter: ''
	};
	if (userSettings) {
		measurementPayload = userSettings as { service: string; duration: string; filter: string };
	} else {
		measurementPayload = {
			service: services[0]?.abbreviation || '',
			duration: '6mo',
			filter: 'All'
		};
	}

	const data = await loadDashboardData(
		measurementPayload.service,
		measurementPayload.duration,
		measurementPayload.filter
	);

	let userId = payload.userId as string;
	return {
		user: (await db.select().from(userView).where(eq(userView.id, userId)))[0] || null,
		announcements: (await db.select().from(announcement).orderBy(desc(announcement.date))) || [],
		services,
		userSettings: userSettings,
		cards: data.cards,
		traces: data.traces,
		mapeScores: data.mapeScores
	} as {
		user: any;
		announcements: any[];
		services: any[];
		userSettings: { service: string; filter: string; duration: string } | null;
		cards: any[];
		traces: any[];
		mapeScores: any[];
	};
};
