<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	let { user, services, onclose } = $props();

	let settings: Record<string, any> = $state({});
	const ranges: string[] = ['3mo', '6mo', '1y', '2y'];
	let filters: string[] = ['All', 'Bibliographic', 'Usage', 'User Experience'];

	async function save() {
		const response = await fetch(resolve(`/api/users/${user.id}/settings/`), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(settings)
		});
		if (response.ok) {
			onclose();
		} else {
			alert('Failed to save settings.');
		}
	}

	onMount(async () => {
		const response = await fetch(resolve(`/api/users/${user.id}/settings/`));
		if (response.ok) {
			settings = await response.json();
		}
	});
</script>

<div>
	<fieldset class="fieldset">
		<legend class="fieldset-legend">Preselected Service</legend>
		<select class="select w-full" bind:value={settings.service}>
			<option value="">No service selected</option>
			{#each services as service}
				<option value={service.abbreviation}>{service.name}</option>
			{/each}
		</select>
		<p class="label">
			Choose a service that will be preselected for you when you open the dashboard.
		</p>
	</fieldset>
	<fieldset class="fieldset">
		<legend class="fieldset-legend">Preselected Duration</legend>
		<select class="select w-full" bind:value={settings.duration}>
			<option value="">No duration selected</option>
			{#each ranges as range}
				<option value={range}>{range}</option>
			{/each}
		</select>
		<p class="label">
			Choose a duration that will be preselected for you when you open the dashboard.
		</p>
	</fieldset>
	<fieldset class="fieldset">
		<legend class="fieldset-legend">Preselected Category</legend>
		<select class="select w-full" bind:value={settings.filter}>
			<option value="">No category selected</option>
			{#each filters as filter}
				<option value={filter}>{filter}</option>
			{/each}
		</select>
		<p class="label">
			Choose a category that will be preselected for you when you open the dashboard.
		</p>
	</fieldset>
	<button class="btn mt-2 w-full btn-primary" onclick={save}>Save Settings</button>
</div>
