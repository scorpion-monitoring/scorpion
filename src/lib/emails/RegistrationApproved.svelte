<script lang="ts">
	import {
		Body,
		Button,
		Container,
		Head,
		Heading,
		Html,
		Preview,
		Section,
		Text
	} from '@sveltelaunch/svelte-5-email';

	export let name;
	export let signInUrl;

	const button = {
		backgroundColor: '#2b2b2b',
		borderRadius: '5px',
		color: '#fff',
		fontSize: '16px',
		textDecoration: 'none',
		textAlign: 'center' as const,
		display: 'block',
		padding: '12px',
		marginTop: '20px'
	};

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
			<Heading>Great News, {name}!</Heading>
			<Text>Your registration for <strong>Scorpion</strong> has been approved.</Text>
			<Button href={signInUrl} style={button}>Sign in to Scorpion</Button>
		</Container>
	</Body>
</Html>
