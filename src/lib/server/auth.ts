import { encodeBase32LowerCase } from '@oslojs/encoding';
import { and, eq, or } from 'drizzle-orm';
import { db } from './db';
import * as table from './db/schema';
import { hash, verify } from '@node-rs/argon2';
import * as jose from 'jose';
import { JWT_SECRET } from '$env/static/private';
import { sendMail } from './mail';
import { htmlRender } from '@sveltelaunch/svelte-5-email';
import Welcome from '$lib/emails/Welcome.svelte';
import { PUBLIC_CONTACT_EMAIL } from '$env/static/public';
import RegistrationRequest from '$lib/emails/RegistrationRequest.svelte';
import { SESSION_TTL_MS } from './constants';

if (!JWT_SECRET) {
	throw new Error('Missing JWT_SECRET environment variable');
}
const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET);
export async function authenticateUser(username: string, password: string) {
	var userRecord = await db
		.select()
		.from(table.user)
		.innerJoin(table.authenticationMethod, eq(table.user.id, table.authenticationMethod.userId))
		.where(and(eq(table.user.username, username), eq(table.authenticationMethod.method, 'local')))
		.limit(1);

	if (userRecord.length === 0) {
		return null;
	}

	const user = userRecord[0];
	const isPasswordValid = await verify(
		(user.authentication_method.details as { passwordHash: string })['passwordHash'],
		password
	);
	if (!isPasswordValid) {
		return null;
	}

	return user;
}

export async function createJWTSession(user: { id: string; username: string }) {
	try {
		var session = await db
			.insert(table.session)
			.values({
				id: crypto.randomUUID(),
				userId: user.id,
				createdAt: new Date().toUTCString(),
				expiresAt: new Date(Date.now() + SESSION_TTL_MS).toUTCString() // 7 days from now
			} as any)
			.returning();
	} catch (error) {
		console.error('Error creating session:', error);
		throw new Error('Failed to create session');
	}

	var jwt_payload = {
		sessionId: session[0].id,
		userId: user.id,
		username: user.username
	};

	const jwt = await new jose.SignJWT(jwt_payload)
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime('7d')
		.sign(JWT_SECRET_BYTES);

	return jwt;
}

export async function verifyJWT(token: string | undefined) {
	if (!token) {
		return false;
	} else {
		try {
			const { payload } = await jose.jwtVerify(token, JWT_SECRET_BYTES);
			const sessionId = payload.sessionId;
			const userId: string = payload.userId as string;

			const userRecord = await db.select().from(table.user).where(eq(table.user.id, userId));

			return userRecord[0].approved;
		} catch {
			return false;
		}
	}
}

export async function getUserFromJWT(token: string | undefined) {
	if (!token) {
		return null;
	} else {
		try {
			const { payload } = await jose.jwtVerify(token, JWT_SECRET_BYTES);
			const userId: string = payload.userId as string;

			const userRecord = await db.select().from(table.user).where(eq(table.user.id, userId));

			if (userRecord.length === 0) {
				return null;
			}

			return userRecord[0];
		} catch {
			return null;
		}
	}
}

export function generateUserId() {
	// ID with 120 bits of entropy, or about the same as UUID v4.
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	const id = encodeBase32LowerCase(bytes);
	return id;
}

export async function registerUser(username: string, email: string, password: string) {
	const existingUser = await db
		.select()
		.from(table.user)
		.innerJoin(table.authenticationMethod, eq(table.user.id, table.authenticationMethod.userId))
		.where(
			and(
				or(eq(table.user.username, username), eq(table.user.email, email)),
				eq(table.authenticationMethod.method, 'local')
			)
		)
		.limit(1);

	if (existingUser.length > 0) {
		throw new Error('Username or email already exists');
	}

	const userId = generateUserId();
	// const passwordHash = jose.base64url.encode(password);
	const passwordHash = await hash(password);

	await db.insert(table.user).values({
		id: userId,
		username,
		email,
		approved: false, // New users require admin approval
		createdAt: new Date().toUTCString()
	} as any);

	await db.insert(table.authenticationMethod).values({
		userId,
		method: 'local',
		details: { passwordHash }
	} as any);

	// @ts-ignore
	let html = htmlRender({
		template: Welcome,
		props: {
			name: username
		}
	});

	sendMail('html', {
		to: email,
		from: '\"Scorpion\" noreply@scorpion.bi.denbi.de',
		replyTo: PUBLIC_CONTACT_EMAIL,
		subject: 'Welcome to Scorpion',
		body: html
	});

	const adminMails = await db
		.select({ mail: table.user.email })
		.from(table.user)
		.where(eq(table.user.role, 'Admin'));

	// @ts-ignore
	html = htmlRender({
		template: RegistrationRequest,
		props: {
			userName: username,
			userEmail: email
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

	const jwt = await createJWTSession({ id: userId, username });

	return jwt;
}
