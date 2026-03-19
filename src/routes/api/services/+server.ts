import { db } from '$lib/server/db';
import {
	category,
	consortium,
	consortiumToService,
	indicator,
	provider,
	providerToService,
	service,
	serviceToIndicator,
	serviceView
} from '$lib/server/db/schema';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq, inArray, sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const consortium = url.searchParams.get('consortium');

	var db_services;
	if (consortium) {
		db_services = await db
			.select()
			.from(serviceView)
			.where(
				sql`EXISTS (
					SELECT 1 FROM jsonb_array_elements(${serviceView.consortia}) elem
					WHERE elem ->> 'abbreviation' = ${consortium}
				)`
			)
			.orderBy(serviceView.name);
	} else {
		db_services = await db.select().from(serviceView).orderBy(serviceView.name);
	}

	return json({ services: db_services });
};

export const POST: RequestHandler = async ({ request }) => {
	const data = await request.json();

	// Check if service provider exists
	var db_provider = await db
		.select()
		.from(provider)
		.where(eq(data.provider, provider.abbreviation))
		.limit(1);
	if (db_provider.length === 0) {
		// Return error if provider does not exist
		return json({ error: 'Provider does not exist' }, { status: 400 });
	}

	// Check if category exists
	var db_category = await db
		.select()
		.from(category)
		.where(eq(data.category, category.name))
		.limit(1);
	if (db_category.length === 0) {
		// Return error if category does not exist
		return json({ error: 'Category does not exist' }, { status: 400 });
	}

	// Check if all consortia.identifier exist
	var consortia_ids = data.consortia.map((c: { identifier: string }) => c.identifier);
	var db_consortia = await db
		.select()
		.from(consortium)
		.where(inArray(consortium.abbreviation, consortia_ids));
	if (db_consortia.length !== consortia_ids.length) {
		// Return error if any consortium does not exist
		return json({ error: 'One or more consortia do not exist' }, { status: 400 });
	}

	// Check if all optionalKpis exist
	var db_indicators: { id: number; name: string }[] = [];
	if (data.optionalKpis) {
		db_indicators = await db
			.select()
			.from(indicator)
			.where(inArray(indicator.name, data.optionalKpis));
		if (db_indicators.length !== data.optionalKpis.length) {
			// Return error if any indicator does not exist
			return json({ error: 'One or more indicators do not exist' }, { status: 400 });
		}
	}

	// Insert new service
	const newService = await db
		.insert(service)
		.values({
			abbreviation: data.shortName,
			license: data.license,
			icon: data.icon,
			name: data.name,
			stage: data.metadata.stage,
			category: db_category[0].id
		})
		.returning();

	const service_id = newService[0].id;

	// Link service to provider
	try {
		await db.insert(providerToService).values({
			providerId: db_provider[0].id,
			serviceId: service_id
		});
	} catch (e) {
		console.error(e);
		return json({ error: 'Service already linked to provider' }, { status: 400 });
	}

	// Link service to consortia
	for (const c of db_consortia) {
		await db.insert(consortiumToService).values({
			consortiumId: c.id as number,
			serviceId: service_id as number
		});
	}

	// Link service to optionalKpis
	if (data.optionalKpis) {
		for (const kpi_name of data.optionalKpis) {
			let indicator_id = db_indicators.find((ind) => ind.name === kpi_name)!.id;
			await db.insert(serviceToIndicator).values({
				serviceId: service_id,
				indicatorId: indicator_id
			});
		}
	}

	/*
	abbreviation: TEXT
	license: TEXT
	name: TEXT NOT NULL
	stage: PROD|DEV|TEST
	category: INTEGER NOT NULL
	
	provider2service
	provider_id: INTEGER NOT NULL
	service_id: INTEGER NOT NULL

	consortium2service
	consortium_id: INTEGER NOT NULL
	service_id: INTEGER NOT NULL

	service2indicator
	service_id: INTEGER NOT NULL
	indicator_id: INTEGER NOT NULL

	*/

	return json({ service: newService[0] });
};
