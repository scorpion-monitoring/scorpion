// @ts-ignore
import nodemailer from 'nodemailer';
import { db } from './db';
import { settings } from './db/schema';
import { eq } from 'drizzle-orm';

const mailRelay = ((await db
	.select()
	.from(settings)
	.where(
		eq(settings.key, 'general')
	))[0] as { value: { 'Mail Relay': string } })?.value['Mail Relay'] as string;;

const transporter = nodemailer.createTransport({
	host: mailRelay,
	port: 25
});

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
	await transporter.verify();

	if (type === 'plain') {
		try {
			await transporter.sendMail({
				to: options.to,
				from: options.from,
				replyTo: options.replyTo,
				subject: options.subject,
				text: options.body
			});
		} catch (error) {
			console.error(error);
		}
	} else {
		try {
			await transporter.sendMail({
				to: options.to,
				from: options.from,
				replyTo: options.replyTo,
				subject: options.subject,
				html: options.body
			});
		} catch (error) {
			console.error(error);
		}
	}
}
