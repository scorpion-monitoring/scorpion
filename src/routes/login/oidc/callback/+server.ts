import { resolve } from '$app/paths';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { authCodes, authenticationMethod, user } from '$lib/server/db/schema';
import * as auth from '$lib/server/auth';
import { and, eq, sql } from 'drizzle-orm';
import { sendMail } from '$lib/server/mail';
import { htmlRender } from '@sveltelaunch/svelte-5-email';
import Welcome from '$lib/emails/Welcome.svelte';
import RegistrationRequest from '$lib/emails/RegistrationRequest.svelte';
import { PUBLIC_CONTACT_EMAIL } from '$env/static/public';

export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	const request = await db.select().from(authCodes).where(eq(authCodes.state, state!));

	const payload: Record<string, string> = {
		grant_type: 'authorization_code',
		client_id: (request[0].provider as { 'Client ID': string })['Client ID'],
		client_secret: (request[0].provider as { 'Client Secret': string })['Client Secret'],
		code: code!,
		redirect_uri: new URL(resolve('/login/oidc/callback/'), url).href
	};

	const config = await fetch(
		(request[0].provider as { 'Specification URL': string })['Specification URL']
	).then((res) => res.json());
	const tokenEndpoint = config.token_endpoint;

	const tokenResponse = await fetch(tokenEndpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams(payload)
	});

	if (!tokenResponse.ok) {
		console.error(await tokenResponse.text());
		return new Response('Failed to exchange code for token', { status: 500 });
	}

	const tokenData = await tokenResponse.json();

	// Fetch userinfo using the access token
	const userInfoResponse = await fetch(config.userinfo_endpoint, {
		headers: {
			Authorization: `Bearer ${tokenData.access_token}`
		}
	});

	if (!userInfoResponse.ok) {
		console.error(await userInfoResponse.text());
		return new Response('Failed to fetch user info', { status: 500 });
	}

	await db.delete(authCodes).where(eq(authCodes.state, state!));

	const userInfo = await userInfoResponse.json();

	const existing = await db
		.select()
		.from(user)
		.innerJoin(authenticationMethod, eq(user.id, authenticationMethod.userId))
		.where(
			and(
				eq(authenticationMethod.method, 'oidc'),
				eq(sql`${authenticationMethod.details} ->> 'subject'`, userInfo.sub),
				eq(
					sql`${authenticationMethod.details} ->> 'provider'`,
					(request[0].provider as { Name: string }).Name
				)
			)
		);

	if (existing.length > 0) {
		const jwt = await auth.createJWTSession(existing[0].user);
		// set JWT in cookie
		return new Response(null, {
			status: 302,
			headers: {
				'Set-Cookie': `access_token=${jwt}; HttpOnly; Path=/; Max-Age=${7 * 24 * 60 * 60}`,
				Location: resolve('/login/fallback')
			}
		});
	} else {
		const newUser = await db
			.insert(user)
			.values({
				id: auth.generateUserId(),
				username: userInfo.preferred_username || userInfo.sub,
				email: userInfo.email
			})
			.returning();

		await db.insert(authenticationMethod).values({
			method: 'oidc',
			userId: newUser[0].id,
			details: {
				provider: (request[0].provider as { Name: string }).Name,
				subject: userInfo.sub
			}
		});

		// @ts-ignore
		let html = htmlRender({
			template: Welcome,
			props: {
				name: newUser[0].username,
				email: userInfo.email
			}
		});

		sendMail('html', {
			to: newUser[0].email,
			from: '\"Scorpion\" noreply@scorpion.bi.denbi.de',
			replyTo: PUBLIC_CONTACT_EMAIL,
			subject: 'Welcome to Scorpion',
			body: html
		});

		const adminMails = await db
			.select({ mail: user.email })
			.from(user)
			.where(eq(user.role, 'Admin'));

		// @ts-ignore
		html = htmlRender({
			template: RegistrationRequest,
			props: {
				userName: newUser[0].username,
				userEmail: newUser[0].email
			}
		});

		// Notify admins of new registration
		sendMail('html', {
			to: adminMails.map((m) => m.mail).join(','),
			from: '\"Scorpion\" noreply@scorpion.bi.denbi.de',
			replyTo: '',
			subject: 'New user registration request',
			body: html
		});

		const jwt = await auth.createJWTSession(newUser[0]);
		// set JWT in cookie
		return new Response(null, {
			status: 302,
			headers: {
				'Set-Cookie': `access_token=${jwt}; HttpOnly; Path=/; Max-Age=${7 * 24 * 60 * 60}`,
				Location: resolve('/login/fallback')
			}
		});
	}
};
