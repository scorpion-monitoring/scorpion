<!-- src/routes/docs/+page.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { dev } from '$app/environment';
	import 'swagger-ui-dist/swagger-ui.css';

	let containerElement: HTMLElement | undefined;
	let spec: any = $state();

	// Get the current server URL reactively
	let currentOrigin = $derived(page.url.origin);

	// Create a modified spec with the current server URL
	let specWithServer = $derived({
		...spec,
		servers: [
			{
				url: currentOrigin,
				description: dev ? 'Development server' : 'Production server'
			}
		]
	});

	async function initializeSwaggerUI() {
		if (!containerElement) return;

		try {
			// Attempt to load a virtual spec module (Vite plugin) first
			try {
				// @ts-ignore - virtual import may not exist in all environments
				const virtualSpec = await import('virtual:openapi-spec');
				spec = virtualSpec?.default ?? virtualSpec;
			} catch (e) {
				// Fallback: fetch the openapi spec from the dev middleware
				try {
					const res = await fetch('/openapi-spec.json');
					if (res.ok) spec = await res.json();
					else spec = { openapi: '3.0.0', info: { title: 'API' }, paths: {} };
				} catch (fetchErr) {
					spec = { openapi: '3.0.0', info: { title: 'API' }, paths: {} };
				}
			}

			// @ts-ignore - swagger-ui-dist doesn't have types
			const { SwaggerUIBundle, SwaggerUIStandalonePreset } = await import('swagger-ui-dist');

			SwaggerUIBundle({
				spec: specWithServer,
				domNode: containerElement,
				deepLinking: true,
				presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset]
			});
		} catch (error) {
			console.error('Failed to initialize Swagger UI:', error);
		}
	}

	onMount(() => {
		initializeSwaggerUI();
	});
</script>

<svelte:head>
	<title>API Documentation</title>
</svelte:head>

<div class="swagger-container">
	<div id="swagger-ui-container" bind:this="{containerElement}"></div>
</div>

<style>
	.swagger-container {
		min-height: 600px;
		padding: 2rem;
	}

	/* Hide the default Swagger UI top bar */
	:global(.swagger-ui .topbar) {
		display: none;
	}

	/* Dark mode support for Swagger UI */
	@media (prefers-color-scheme: dark) {
		:global(.swagger-ui) {
			filter: invert(0.9) hue-rotate(180deg);
		}
	}
</style>