import crypto from 'crypto';
import { db } from '.';
import { settings, token, userToToken } from './schema';
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

export async function createToken(userId: string, tokenName: string) {
	// check that token name is not empty
	if (tokenName.trim() === '') {
		throw new Error('Token name cannot be empty');
	}

	// check if token with the same name already exists for the user
	const existingToken = await db
		.select()
		.from(token)
		.innerJoin(userToToken, eq(token.id, userToToken.tokenId))
		.where(and(eq(userToToken.userId, userId), eq(token.name, tokenName)))
		.limit(1);

	if (existingToken.length > 0) {
		throw new Error('Token with the same name already exists for this user');
	}

	const db_salt = await db.select().from(settings).where(eq(settings.key, 'token_salt')).limit(1);
	let salt: string;
	if (db_salt.length === 0) {
		salt = crypto.randomBytes(16).toString('hex');
		await db.insert(settings).values({
			key: 'token_salt',
			value: { salt }
		});
	} else {
		salt = (db_salt[0].value as { salt: string }).salt;
	}

	const bytes = crypto.getRandomValues(new Uint8Array(15));
	const v_token = `PAT_${encodeBase32LowerCase(bytes)}`;

	const tokenHash = crypto.pbkdf2Sync(v_token, salt, 100000, 64, 'sha512').toString('hex');

	const db_token = await db
		.insert(token)
		.values({
			name: tokenName,
			hash: tokenHash,
			created: new Date().toISOString()
		})
		.returning();

	await db.insert(userToToken).values({
		userId,
		tokenId: db_token[0].id
	});

	return { id: db_token[0].id, secret: v_token, name: tokenName, createdAt: db_token[0].created };
}

export async function verifyToken(tokenValue: string) {
	const db_salt = await db.select().from(settings).where(eq(settings.key, 'token_salt')).limit(1);
	if (db_salt.length === 0) {
		throw new Error('Token salt not found in database');
	}
	const salt = (db_salt[0].value as { salt: string }).salt;

	const hashToVerify = crypto.pbkdf2Sync(tokenValue, salt, 100000, 64, 'sha512').toString('hex');

	const db_token = await db
		.select()
		.from(token)
		.innerJoin(userToToken, eq(token.id, userToToken.tokenId))
		.where(eq(token.hash, hashToVerify))
		.limit(1);

	await db
		.update(token)
		.set({ lastUsed: new Date().toISOString() })
		.where(eq(token.id, db_token[0].token.id));

	if (db_token.length === 0) {
		return null;
	} else {
		return db_token[0].user_to_token.userId;
	}
}
