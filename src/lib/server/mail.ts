// @ts-ignore
import nodemailer from 'nodemailer';
import { db } from './db';
import { settings } from './db/schema';
import { eq } from 'drizzle-orm';

let transporterPromise: Promise<nodemailer.Transporter> | null = null;

async function getTransporter() {
	if (transporterPromise) {
		return transporterPromise;
	}

	transporterPromise = (async () => {
		const generalSettings = (await db
			.select()
			.from(settings)
			.where(eq(settings.key, 'general')))[0] as
			| { value?: { 'Mail Relay'?: string } }
			| undefined;

		const mailRelay = generalSettings?.value?.['Mail Relay'];
		if (!mailRelay) {
			throw new Error('Missing "Mail Relay" in general settings');
		}

		return nodemailer.createTransport({
			host: mailRelay,
			port: 25
		});
	})();

	return transporterPromise;
}

export async function sendMail(
	type: 'html' | 'plain',
	options: {
		to: string;
		from: string;
		replyTo: string;
		subject: string;
		body: string;
	}
) {
	try {
		const transporter = await getTransporter();
		await transporter.verify();

		if (type === 'plain') {
			await transporter.sendMail({
				to: options.to,
				from: options.from,
				replyTo: options.replyTo,
				subject: options.subject,
				text: options.body
			});
		} else {
			await transporter.sendMail({
				to: options.to,
				from: options.from,
				replyTo: options.replyTo,
				subject: options.subject,
				html: options.body
			});
		}
	} catch (error) {
		console.error(error);
	}
}
