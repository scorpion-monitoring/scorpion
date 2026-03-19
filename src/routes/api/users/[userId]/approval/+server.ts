import { db } from '$lib/server/db';
import { authenticationMethod, session, user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { sendMail } from '$lib/server/mail';
import { PUBLIC_CONTACT_EMAIL } from '$env/static/public';
import { htmlRender } from '@sveltelaunch/svelte-5-email';
import RegistrationRejected from '$lib/emails/RegistrationRejected.svelte';
import RegistrationApproved from '$lib/emails/RegistrationApproved.svelte';

export const POST: RequestHandler = async ({ request }) => {
	const { approved, role } = await request.json();

	const userId = request.url.split('/')[request.url.split('/').length - 2];

	if (!approved) {
		await db.delete(authenticationMethod).where(eq(authenticationMethod.userId, userId));

		await db.delete(session).where(eq(session.userId, userId));

		const deleted = await db.delete(user).where(eq(user.id, userId)).returning();

		// @ts-ignore
		const rejectionHtml = htmlRender({
			template: RegistrationRejected,
			props: {
				name: deleted[0].username,
				contactEmail: PUBLIC_CONTACT_EMAIL
			}
		});

		sendMail('html', {
			to: deleted[0].email,
			from: '\"Scorpion\" noreply@scorpion.bi.denbi.de',
			replyTo: PUBLIC_CONTACT_EMAIL,
			subject: 'Update regarding your Scorpion registration',
			body: rejectionHtml
		});

		return new Response('User rejected', { status: 200 });
	}

	const userRecord = await db.select().from(user).where(eq(user.id, userId)).limit(1);

	if (userRecord.length === 0) {
		return new Response('User not found', { status: 404 });
	}

	await db
		.update(user)
		.set({
			approved: approved,
			role: role
		})
		.where(eq(user.id, userId));

	// @ts-ignore
	const approvalHtml = htmlRender({
		template: RegistrationApproved,
		props: {
			name: userRecord[0].username,
			signInUrl: `${request.url.split('/api')[0]}/login`
		}
	});

	sendMail('html', {
		to: userRecord[0].email,
		from: '\"Scorpion\" noreply@scorpion.bi.denbi.de',
		replyTo: PUBLIC_CONTACT_EMAIL,
		subject: 'Update regarding your Scorpion registration',
		body: approvalHtml
	});

	return new Response();
};
