import { db } from '$lib/server/db';
import { serviceView } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
	const consortium = url.searchParams.get('consortium');

	const db_services = await db
		.select()
		.from(serviceView)
		.where(
			sql`EXISTS (
                SELECT 1 FROM jsonb_array_elements(${serviceView.consortia}) elem
                WHERE elem ->> 'abbreviation' = ${consortium}
            )`
		)
		.orderBy(serviceView.name);

	const licenses = await fetch(
		'https://raw.githubusercontent.com/spdx/license-list-data/refs/heads/main/json/licenses.json'
	).then((res) => res.json());

	let i_nb_users_all_services = 0;
	let i_nb_registered_users = 0;
	let i_nb_services_reused = 0;
	let i_nb_open_source_services = 0;
	let i_nb_services_dev = 0;
	let i_nb_services_prot = 0;
	let i_nb_services_oper = 0;
	let i_nb_services_term = 0;

	for (const service of db_services) {
		if (
			licenses.licenses.find(
				(l: { licenseId: string; isOsiApproved: boolean }) =>
					l.licenseId === service.license && l.isOsiApproved
			)
		) {
			i_nb_open_source_services++;
		}
		if (service.stage === 'DEV') {
			i_nb_services_dev++;
		} else if (service.stage === 'DEMO') {
			i_nb_services_prot++;
		} else if (service.stage === 'PROD') {
			i_nb_services_oper++;
		} else if (service.stage === 'TERM') {
			i_nb_services_term++;
		}
	}

	return json({
		'Total Services': db_services.length,
		'Open Source Services': i_nb_open_source_services,
		'Developmental Services': i_nb_services_dev,
		'Prototyped Services': i_nb_services_prot,
		'Operational Services': i_nb_services_oper,
		'Terminated Services': i_nb_services_term
	});
};
