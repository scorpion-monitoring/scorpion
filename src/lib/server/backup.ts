import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
// import { authenticationMethod, category, categoryToIndicator, consortium, consortiumToService, evaluation, indicator, measurements, provider, providerToService, service, serviceToIndicator, settings, token, user, userToProvider, userToToken } from '$lib/server/db/schema';
import { env } from '$env/dynamic/private';
import { eq, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

import { RawRsaKeyringNode, buildClient, CommitmentPolicy } from '@aws-crypto/client-node';
import { generateKeyPair } from 'crypto';
import { promisify } from 'util';
import fs from 'fs';
const generateKeyPairAsync = promisify(generateKeyPair);

const { encrypt, decrypt } = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT);

type BackupSettings = {
	Endpoint?: string;
	Region?: string;
	Bucket?: string;
	'Access Key ID'?: string;
	'Secret Access Key'?: string;
};

type SecuritySettings = {
	Backup?: BackupSettings;
};

export async function backupDatabase() {
	const backupDate = new Date().toISOString().replace(/[:.]/g, '-');
	if (!env.DATABASE_URL) {
		throw new Error('DATABASE_URL is not set');
	}

	const securitySettingsRecord = await db
		.select({ value: table.settings.value })
		.from(table.settings)
		.where(eq(table.settings.key, 'security'))
		.limit(1);

	if (securitySettingsRecord.length === 0) {
		throw new Error('Missing security settings record');
	}

	const rawValue = securitySettingsRecord[0].value;
	const parsedValue =
		typeof rawValue === 'string'
			? (JSON.parse(rawValue) as SecuritySettings)
			: (rawValue as SecuritySettings);

	const backupConfig = parsedValue?.Backup;

	if (!backupConfig) {
		throw new Error('Missing Backup configuration in security settings');
	}

	const endpoint = backupConfig.Endpoint?.trim();
	const region = backupConfig.Region?.trim();
	const bucket = backupConfig.Bucket?.trim();
	const accessKeyId = backupConfig['Access Key ID']?.trim();
	const secretAccessKey = backupConfig['Secret Access Key']?.trim();

	if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
		throw new Error('Backup configuration is incomplete');
	}

	const s3Client = new S3Client({
		region,
		endpoint,
		credentials: {
			accessKeyId,
			secretAccessKey
		},
		forcePathStyle: true
	});

	const keyName = 'scorpion-backup-key';
	const keyNamespace = 'scorpion-backup';

	if (!env.BACKUP_RSA_PUBLIC_KEY_PATH || !env.BACKUP_RSA_PRIVATE_KEY_PATH) {
		throw new Error('RSA key paths are not configured');
	}
	let rsaKey;
	try {
		const publicKey = await fs.promises.readFile(env.BACKUP_RSA_PUBLIC_KEY_PATH, 'utf-8');
		const privateKey = await fs.promises.readFile(env.BACKUP_RSA_PRIVATE_KEY_PATH, 'utf-8');
		rsaKey = {
			publicKey,
			privateKey
		};
	} catch {
		rsaKey = await generateRsaKeys();
		await fs.promises.writeFile(env.BACKUP_RSA_PUBLIC_KEY_PATH!, rsaKey.publicKey);
		await fs.promises.writeFile(env.BACKUP_RSA_PRIVATE_KEY_PATH!, rsaKey.privateKey);
	}

	const keyring = new RawRsaKeyringNode({
		keyName,
		keyNamespace,
		rsaKey
	});

	const context = {
		stage: env.NODE_ENV === 'production' ? 'prod' : 'dev',
		purpose: 'database-backup',
		origin: 'scorpion-backup-service',
		timestamp: new Date().toISOString()
	};

	try {
		// const tables = [table.measurements, table.service, table.category, table.indicator, table.serviceToIndicator, table.categoryToIndicator, table.consortium, table.consortiumToService, table.evaluation, table.provider, table.providerToService, table.user, table.userToProvider, table.token, table.userToToken, table.authenticationMethod];
		// list all tables in the database
		const tables = Object.values(table).filter((t) => is(t, PgTable));

		for (const tbl of tables) {
			const data = await db.select().from(tbl as any);
			const jsonData = JSON.stringify(data);

			const { result } = await encrypt(keyring, Buffer.from(jsonData), {
				encryptionContext: context
			});

			const putCommand = new PutObjectCommand({
				Bucket: bucket,
				Key: `backup-${backupDate}/${getTableName(tbl as any)}.json`,
				Body: result,
				ContentType: 'application/json'
			});
			const putResponse = await s3Client.send(putCommand);
		}
	} catch (error) {
		console.error('Error listing objects in bucket:', error);
		throw new Error('Failed to connect to S3 bucket with provided credentials');
	}

	return;
}

async function generateRsaKeys() {
	const modulusLength = 3072;
	const publicKeyEncoding = {
		type: 'pkcs1',
		format: 'pem'
	};
	const privateKeyEncoding = {
		type: 'pkcs1',
		format: 'pem'
	};
	// @ts-ignore
	return generateKeyPairAsync('rsa', {
		modulusLength,
		publicKeyEncoding,
		privateKeyEncoding
	});
}
