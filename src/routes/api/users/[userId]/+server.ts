import { db } from '$lib/server/db';
import { provider, user, userToProvider } from '$lib/server/db/schema';
import { and, eq, notInArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { htmlRender } from '@sveltelaunch/svelte-5-email';
import ProviderRequest from '$lib/emails/ProviderRequest.svelte';
import { sendMail } from '$lib/server/mail';

export const PUT: RequestHandler = async ({ request, params }) => {
	const userId = params.userId;
	const data = await request.json();

	const providers: Array<{ abbreviation: string; name: string; approved: boolean }> = [
		...data.providers
	];

	const providerRequests = [];
	for (const api_provider of data.providers) {
		const db_provider = await db
			.select()
			.from(provider)
			.where(eq(provider.abbreviation, api_provider.abbreviation))
			.limit(1);

		if (db_provider.length === 0) {
			return new Response('Provider not found', { status: 404 });
		}

		if (api_provider.approved) {
			await db
				.update(userToProvider)
				.set({ approved: api_provider.approved })
				.where(
					and(eq(userToProvider.userId, userId), eq(userToProvider.providerId, db_provider[0].id))
				);
			providers.find((p) => p.abbreviation === api_provider.abbreviation)!.approved = true;
		} else {
			if (data.username) {
				// ensure no existing mapping
				const existing = await db
					.select()
					.from(userToProvider)
					.where(
						and(eq(userToProvider.userId, userId), eq(userToProvider.providerId, db_provider[0].id))
					)
					.limit(1);

				if (existing.length === 0) {
					await db.insert(userToProvider).values({
						userId: userId,
						providerId: db_provider[0].id,
						approved: false
					});
					providerRequests.push(db_provider[0].name);
				}
			} else {
				await db
					.delete(userToProvider)
					.where(
						and(eq(userToProvider.userId, userId), eq(userToProvider.providerId, db_provider[0].id))
					);
			}
		}
	}

	if (providerRequests.length > 0) {
		// @ts-ignore
		const html = htmlRender({
			template: ProviderRequest,
			props: {
				userName: data.username,
				providerNames: providerRequests
			}
		});

		const adminMails = await db
			.select({ mail: user.email })
			.from(user)
			.where(eq(user.role, 'Admin'));

		// Notify admins of new registration
		sendMail('html', {
			to: adminMails.map((m) => m.mail).join(','),
			from: '\"Scorpion\" noreply@scorpion.bi.denbi.de',
			replyTo: '',
			subject: 'New provider membership request',
			body: html
		});
	}

	if (data.username) {
		let providerIds = data.providers.map((p: { abbreviation: string }) => p.abbreviation);
		let db_providers = await db
			.select()
			.from(userToProvider)
			.leftJoin(provider, eq(userToProvider.providerId, provider.id))
			.where(
				and(eq(userToProvider.userId, userId), notInArray(provider.abbreviation, providerIds))
			);

		if (db_providers.length > 0) {
			for (const dbp of db_providers) {
				await db.delete(userToProvider).where(eq(userToProvider.id, dbp.user_to_provider.id));
			}
		}

		var db_user = await db
			.update(user)
			.set({
				username: data.username,
				email: data.email,
				bio: data.bio,
				icon: data.icon
			})
			.where(eq(user.id, userId))
			.returning();
	}

	if (data.role) {
		await db.update(user).set({ role: data.role }).where(eq(user.id, userId));
	}

	return json({ providers: providers.filter((p) => p.approved) });
};
