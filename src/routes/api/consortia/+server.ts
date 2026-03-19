import { db } from '$lib/server/db';
import { consortium } from '$lib/server/db/schema';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	const db_consortia = await db.select().from(consortium).orderBy(consortium.name);
	const consortia = db_consortia.map((c) => ({
		abbreviation: c.abbreviation,
		name: c.name
	}));
	return json(consortia);
};

export const POST: RequestHandler = async ({ request }) => {
	const consortia = await request.json();

	for (const c of consortia) {
		const existingByName = await db.select().from(consortium).where(eq(consortium.name, c.name));
		const existingByAbbreviation = await db
			.select()
			.from(consortium)
			.where(eq(consortium.abbreviation, c.abbreviation));

		if (existingByName.length > 0 || existingByAbbreviation.length > 0) {
			continue;
		}

		await db.insert(consortium).values({
			name: c.name,
			abbreviation: c.abbreviation
		});
	}

	return new Response('Consortia added', { status: 201 });
};
