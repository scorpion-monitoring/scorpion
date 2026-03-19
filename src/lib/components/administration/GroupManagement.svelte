<script lang="ts">
	import type { Provider } from '$lib/openapi/schemas';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import Group from './Group.svelte';

	let providers: Provider[] = $state([]);
	let consortia: { abbreviation: string; name: string }[] = $state([]);

	async function fetchProviders() {
		const res = await fetch(resolve('/api/providers'));
		if (res.ok) {
			providers = await res.json();
		}
	}

	async function fetchConsortia() {
		const res = await fetch(resolve('/api/consortia'));
		if (res.ok) {
			consortia = await res.json();
		}
	}

	async function refreshAll() {
		await fetchProviders();
		await fetchConsortia();
	}

	async function saveProviders() {
		await fetch(resolve('/api/providers'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(providers)
		});
		refreshAll();
	}

	async function saveConsortia() {
		// await fetch(resolve("/api/consortia"), {
		//     method: "POST",
		//     headers: { "Content-Type": "application/json" },
		//     body: JSON.stringify(consortia)
		// });
		refreshAll();
	}

	onMount(async () => {
		await refreshAll();
	});
</script>

<div class="space-y-2 p-2">
	<Group
		label="Service Providers"
		bind:group={providers}
		onchange={saveProviders}
		onreset={fetchProviders}
	/>

	<Group
		label="Consortia"
		bind:group={consortia}
		onchange={saveConsortia}
		onreset={fetchConsortia}
	/>
</div>
