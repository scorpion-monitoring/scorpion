<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import { serviceObj } from '$lib/service';
	import Schemas from '$lib/schemas.svelte';
	import Console from '$lib/components/wizard/Console.svelte';
	import Questionnaire from '$lib/components/wizard/Questionnaire.svelte';
	import { goto } from '$app/navigation';

	$serviceObj = Schemas.getObjectFromSchema('service');
	($serviceObj as any).metadata = {
		stage: ''
	};

	let { data }: PageProps = $props();

	async function storeService() {
		const response = await fetch(resolve('/api/services'), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify($serviceObj)
		});

		if (response.ok) {
			const result = await response.json();
			goto(resolve(`/services/${result.service.abbreviation}`));
		} else {
			console.error('Failed to create service');
			// Optionally, show an error message
		}
	}
</script>

<div class="mx-auto w-2/3 p-2">
	<div class="breadcrumbs text-sm">
		<ul>
			<li><button onclick={() => goto(resolve('/services'))}>Services</button></li>
			<li>Add Service</li>
		</ul>
	</div>
	{#if typeof window !== 'undefined' && window.location.hostname === 'localhost'}
		<Console />
	{/if}
	<Questionnaire onfinish={storeService} />
</div>
