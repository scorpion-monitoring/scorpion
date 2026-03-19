import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
	const key = url.searchParams.get('key')?.split(',') || [];

	const settingsData = await db.select().from(settings).where(inArray(settings.key, key));

	const parsedSettings = settingsData.reduce(
		(acc, s) => {
			acc[s.key] = s.value ? s.value : null;
			return acc;
		},
		{} as Record<string, any>
	);

	return json({ settings: parsedSettings });
};

export const PUT: RequestHandler = async ({ request }) => {
	const { key, value } = await request.json();

	// Check if settings for key already exists
	const exisingSettings = await db.select().from(settings).where(eq(settings.key, key)).limit(1);

	if (exisingSettings.length > 0) {
		await db
			.update(settings)
			.set({ value: JSON.stringify(value) })
			.where(eq(settings.key, key));
	} else {
		await db.insert(settings).values({ key, value: JSON.stringify(value) });
	}

	return new Response();
};
