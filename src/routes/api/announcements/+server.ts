import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { announcement } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const announcements = await db.select().from(announcement).orderBy(desc(announcement.date));

	return json(announcements);
};

export const POST: RequestHandler = async ({ request }) => {
	const data = await request.json();

	const inserted = await db
		.insert(announcement)
		.values({
			from: data.from,
			title: data.title,
			message: data.message,
			date: new Date().toISOString()
		})
		.returning();

	return json(inserted[0]);
};

export const DELETE: RequestHandler = async ({ url }) => {
	const announcementId = url.searchParams.get('id');

	if (!announcementId) {
		return json({ error: 'Announcement ID is required' }, { status: 400 });
	}

	const deleted = await db
		.delete(announcement)
		.where(eq(announcement.id, Number(announcementId)))
		.returning();

	return json(deleted[0]);
};
