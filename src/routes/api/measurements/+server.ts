import { db } from '$lib/server/db';
import { indicator, measurements, service } from '$lib/server/db/schema';
import { and, eq, gt, inArray, lte } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const data = await request.json();

	for (const measurement of data) {
		const { serviceAbbreviation, date, values } = measurement;
		var db_service = await db
			.select()
			.from(service)
			.where(eq(service.abbreviation, serviceAbbreviation));

		if (db_service.length === 0) {
			console.warn(
				`Service with abbreviation ${serviceAbbreviation} not found. Skipping measurement.`
			);
			continue;
		}

		var db_indicators = await db
			.select()
			.from(indicator)
			.where(inArray(indicator.name, Object.keys(values)));

		for (const ind of db_indicators) {
			if (values[ind.name] != undefined && values[ind.name] != null) {
				let lastDayOfMonth = new Date(date);
				lastDayOfMonth.setMonth(lastDayOfMonth.getMonth() + 1);
				lastDayOfMonth.setDate(0);

				await db.insert(measurements).values({
					serviceId: db_service[0].id,
					indicatorId: ind.id,
					date: lastDayOfMonth.toISOString(),
					value: values[ind.name]
				});
			}
		}
	}

	return new Response();
};

export const GET: RequestHandler = async ({ url }) => {
	const query_service = url.searchParams.get('service');
	const query_indicator = url.searchParams.get('indicator')?.split(',');
	const query_date_from = url.searchParams.get('date_from');
	const query_date_to = url.searchParams.get('date_to');

	const db_measurements = await db
		.select()
		.from(measurements)
		.innerJoin(service, eq(measurements.serviceId, service.id))
		.innerJoin(indicator, eq(measurements.indicatorId, indicator.id))
		.where(
			and(
				query_service ? eq(service.abbreviation, query_service) : undefined,
				query_indicator ? inArray(indicator.name, query_indicator) : undefined,
				query_date_from
					? gt(
							measurements.date,
							new Date(new Date(query_date_from).getTime() + 86400000).toISOString()
						)
					: undefined,
				query_date_to
					? lte(
							measurements.date,
							new Date(new Date(query_date_to).getTime() + 86400000).toISOString()
						)
					: undefined
			)
		);

	const response: Array<{
		service: string;
		indicator: string;
		values: Array<{ date: string; value: string }>;
	}> = [];
	for (const row of db_measurements) {
		//TODO: Measurements should be grouped by month
		if (
			response.find(
				(m) => m.service === row.service.abbreviation && m.indicator === row.indicator.name
			)
		) {
			response
				.find((m) => m.service === row.service.abbreviation && m.indicator === row.indicator.name)!
				.values.push({ date: row.measurements.date, value: row.measurements.value });
		} else {
			response.push({
				service: row.service.abbreviation,
				indicator: row.indicator.name,
				values: [{ date: row.measurements.date, value: row.measurements.value }]
			});
		}
	}

	for (const measurement of response) {
		measurement.values.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
	}

	return new Response(JSON.stringify(response));
};
