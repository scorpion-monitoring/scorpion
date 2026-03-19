<script lang="ts">
	import Schemas from '$lib/schemas.svelte';
	import generalSettingsSchema from '$lib/schemas/general_settings.json';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	let { settings = $bindable(), onsave } = $props();

	let originalSettings = $state(undefined);
	onMount(async () => {
		const response = await fetch(resolve('/api/settings') + `?key=${'general'}`);
		if (response.ok) {
			let data = await response.json();
			originalSettings = data.settings.general;
		}
	});
	let changes = $derived.by(() => {
		return JSON.stringify(settings) !== JSON.stringify(originalSettings);
	});

	function addEntity(key: string) {
		const schemaKey = (generalSettingsSchema as { properties: Record<string, any> }).properties[key]
			.items['$ref'];
		settings[key] = [...settings[key], Schemas.getObjectFromSchema(schemaKey)];
	}

	function removeEntity(key: string, index: number) {
		settings[key] = settings[key].filter((_: any, i: number) => i !== index);
	}
</script>

{#if settings}
	<div class="form-control w-full space-y-2">
		{#each Object.keys(settings) as key}
			<div class="grid grid-cols-[1fr_3fr] gap-4">
				<span class="label mb-auto">{key}</span>
				{#if typeof settings[key] === 'string'}
					{#if (generalSettingsSchema as { properties: Record<string, any> }).properties?.[key]?.['enum']}
						<select class="select w-full" bind:value={settings[key]}>
							{#each (generalSettingsSchema as { properties: Record<string, any> }).properties[key].enum as enumValue}
								<option>{enumValue}</option>
							{/each}
						</select>
					{:else}
						<input class="input w-full" bind:value={settings[key]} />
					{/if}
				{:else if typeof settings[key] === 'number'}
					<input type="number" class="input w-full" bind:value={settings[key]} />
				{:else if Array.isArray(settings[key])}
					<div
						class="space-y-4 rounded border p-2"
						style="border-color: color-mix(in oklab, var(--color-base-content) 20%, #0000);"
					>
						{#each settings[key] as obj, i}
							<div
								class="space-y-2 rounded border bg-base-200 p-2"
								style="border-color: color-mix(in oklab, var(--color-base-content) 20%, #0000);"
							>
								{#each Object.keys(obj) as objKey}
									<div class="grid grid-cols-[1fr_3fr] gap-4">
										<span class="label mb-auto">{objKey}</span>
										{#if typeof obj[objKey] === 'string'}
											<input
												type={objKey === 'Client Secret' ? 'password' : 'text'}
												class="input w-full"
												bind:value={obj[objKey]}
											/>
										{:else if typeof obj[objKey] === 'number'}
											<input type="number" class="input w-full" bind:value={obj[objKey]} />
										{:else}
											<pre>{JSON.stringify(obj[objKey], null, 2)}</pre>
										{/if}
									</div>
								{/each}
								<div class="flex justify-end">
									<button class="btn btn-xs btn-error" onclick={() => removeEntity(key, i)}
										>Remove {key.slice(0, key.length - 1)}</button
									>
								</div>
							</div>
						{/each}
						<div class="flex justify-end">
							<button class="btn btn-sm btn-primary" onclick={() => addEntity(key)}
								>Add {key.slice(0, key.length - 1)}</button
							>
						</div>
					</div>
				{/if}
			</div>
		{/each}
		<div>
			<button
				disabled={!changes}
				class="btn w-full btn-primary"
				onclick={() => {
					onsave();
					changes = false;
				}}>Save Changes</button
			>
		</div>
	</div>
{/if}
