<script lang="ts">
	import { Body, Container, Heading, Html, Text, Link } from '@sveltelaunch/svelte-5-email';

	const footerLink = { color: '#067df7', textDecoration: 'none' };

	export let name;
	export let contactEmail;

	const main = {
		fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
		backgroundColor: '#f6f9fc',
		padding: '20px 0'
	};

	const container = {
		backgroundColor: '#ffffff',
		border: '1px solid #f0f0f0',
		padding: '45px',
		maxWidth: '600px',
		margin: '0 auto'
	};
</script>

<Html lang="en">
	<Body style={main}>
		<Container style={container}>
			<Heading style={{ color: '#333' }}>Registration Update</Heading>
			<Text>Hello {name},</Text>
			<Text>
				After reviewing your application for <strong>Scorpion</strong>, we are unable to approve
				your account at this time.
			</Text>
			<Text>
				If you believe this was a mistake, please reach out to our team:
				<Link href={`mailto:${contactEmail}`} style={footerLink}>Contact Mail</Link>
			</Text>
		</Container>
	</Body>
</Html>
