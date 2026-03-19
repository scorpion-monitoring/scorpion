<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import GeneralSettings from './GeneralSettings.svelte';
	import SecuritySettings from './SecuritySettings.svelte';
	import Schemas from '$lib/schemas.svelte';

	const tabs = [
		{ label: 'General', value: 'general', content: GeneralSettings },
		{ label: 'Security', value: 'security', content: SecuritySettings }
	];

	let activeTab = $state(tabs[0].value);

	let settings: Record<string, any> = $state({});

	async function saveSettings(key: string) {
		console.log(key, settings[key]);
		const response = await fetch(resolve('/api/settings'), {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ key, value: settings[key] })
		});
		if (!response.ok) {
			// Handle error
			console.error('Failed to save settings');
		}
		return;
	}

	onMount(async () => {
		const response = await fetch(
			resolve('/api/settings') + `?key=${tabs.flatMap((tab) => tab.value)}`
		);
		const data = await response.json();

		for (const { value } of tabs) {
			if (!data.settings[value]) {
				settings[value] = Schemas.getObjectFromSchema(value);
			} else {
				settings[value] = data.settings[value];
			}
		}
		return;
	});
</script>

<!-- name of each tab group should be unique -->
<div class="tabs-box tabs">
	{#each tabs as { label, content, value }}
		<input
			type="radio"
			name="settings"
			class="tab"
			aria-label={label}
			checked={activeTab === value}
		/>
		<div class="tab-content border-base-300 bg-base-100 p-6">
			{#if content}
				{#key activeTab}
					{@const Component = content}
					<Component
						bind:settings={settings[value as keyof typeof settings]}
						onsave={() => saveSettings(value)}
					/>
				{/key}
			{/if}
		</div>
	{/each}
</div>
