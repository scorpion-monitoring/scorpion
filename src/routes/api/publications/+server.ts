import { db } from '$lib/server/db';
import { publication, service } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request }) => {
	const { doi, title, authors, publicationDate, serviceId } = await request.json();

	const serviceRecord = await db.select().from(service).where(eq(service.abbreviation, serviceId!));

	if (serviceRecord.length === 0) {
		return new Response('Service not found', { status: 404 });
	}

	const publicationRecord = await db
		.insert(publication)
		.values({
			doi,
			title,
			authors,
			publicationDate,
			serviceId: serviceRecord[0].id
		})
		.returning();

	return json({ publication: publicationRecord[0] });
};
