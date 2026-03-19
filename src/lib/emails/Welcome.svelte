<script lang="ts">
	import {
		Body,
		Container,
		Head,
		Heading,
		Hr,
		Html,
		Preview,
		Section,
		Text
	} from '@sveltelaunch/svelte-5-email';

	export let name;

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
			<Heading style={{ color: '#333' }}>Welcome to Scorpion!</Heading>
			<Text>Hello {name},</Text>
			<Text>
				Thank you for registering for <strong>Scorpion</strong>. We're excited to have you on board.
			</Text>
			<Heading as="h3">Next Steps: Account Review</Heading>
			<Text>To ensure security, all new accounts undergo a brief manual review.</Text>
			<Text style={{ color: '#555', fontSize: '14px' }}>
				• <strong>Status:</strong> Pending Review
			</Text>
			<Text style={{ color: '#555', fontSize: '14px' }}>
				• <strong>Timeline:</strong> Typically 1-2 business days
			</Text>
			<Hr style={{ margin: '20px 0', borderColor: '#e6ebf1' }} />
			<Text style={{ fontSize: '12px', color: '#8898aa' }}>
				You will receive a separate email once a decision has been made.
			</Text>
		</Container>
	</Body>
</Html>
