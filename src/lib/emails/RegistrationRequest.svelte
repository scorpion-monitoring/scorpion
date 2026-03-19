<script lang="ts">
	import {
		Body,
		Container,
		Head,
		Heading,
		Html,
		Section,
		Text
	} from '@sveltelaunch/svelte-5-email';

	export let userName: string;
	export let userEmail: string;

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
			<Heading style={{ color: '#333' }}>New Registration Request</Heading>
			<Text><strong>Name:</strong> {userName}</Text>
			<Text><strong>Email:</strong> {userEmail}</Text>
		</Container>
	</Body>
</Html>
