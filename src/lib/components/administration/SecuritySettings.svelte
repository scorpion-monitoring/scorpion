<script lang="ts">
	import securitySettingsSchema from '$lib/schemas/security_settings.json';
	import Schemas from '$lib/schemas.svelte';
	//@ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import { mdiClose } from '@mdi/js';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';

	let { settings = $bindable(), onsave } = $props();

	let originalSettings = $state(undefined);
	onMount(async () => {
		const response = await fetch(resolve('/api/settings') + `?key=${'security'}`);
		if (response.ok) {
			let data = await response.json();
			originalSettings = data.settings.security;
		}
	});

	let changes = $derived.by(() => {
		return JSON.stringify(settings) !== JSON.stringify(originalSettings);
	});

	function addEntity(key: string) {
		const schemaKey = (securitySettingsSchema as { properties: Record<string, any> }).properties[
			key
		].items['$ref'];
		settings[key] = [...settings[key], Schemas.getObjectFromSchema(schemaKey)];
	}

	function removeEntity(key: string, index: number) {
		settings[key] = settings[key].filter((_: any, i: number) => i !== index);
	}

	function updateImage(key: string, index: number, event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			const reader = new FileReader();
			reader.onload = (e) => {
				settings[key][index]['Display Icon'] = e.target?.result;
			};
			reader.readAsDataURL(target.files[0]);
		}
	}
</script>

{#if settings}
	<div class="form-control w-full space-y-2">
		{#each Object.keys(settings) as key}
			<div class="grid grid-cols-[1fr_3fr] gap-4">
				<span class="label mb-auto">{key}</span>
				{#if typeof settings[key] === 'string'}
					{#if (securitySettingsSchema as { properties: Record<string, any> }).properties?.[key]?.['enum']}
						<select class="select w-full" bind:value={settings[key]}>
							{#each (securitySettingsSchema as { properties: Record<string, any> }).properties[key].enum as enumValue}
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
										{#if objKey === 'Display Icon'}
											{#if settings[key][i]['Display Icon']}
												<div class="pt-2">
													<div
														class="relative inline-flex rounded border"
														style="border-color: color-mix(in oklab, var(--color-base-content) 20%, #0000);"
													>
														<img class="h-20" src={settings[key][i]['Display Icon']} alt="Icon" />
														<button
															class="btn absolute -top-3 -right-3 z-1 btn-circle btn-xs hover:btn-error"
															onclick={() => (settings[key][i]['Display Icon'] = '')}
														>
															<SvgIcon type="mdi" path={mdiClose} />
														</button>
													</div>
												</div>
											{:else}
												<input
													type="file"
													class="file-input w-full"
													accept="image/png, image/svg+xml"
													onchange={(event) => {
														updateImage(key, i, event);
													}}
												/>
											{/if}
										{:else if typeof obj[objKey] === 'string'}
											<input
												type={objKey === 'Client Secret' ? 'password' : 'text'}
												class="input w-full"
												bind:value={obj[objKey]}
											/>
										{:else if typeof obj[objKey] === 'number'}
											<input type="number" class="input w-full" bind:value={obj[objKey]} />
										{:else}
											{JSON.stringify(obj, null, 2)}
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
				{:else if typeof settings[key] === 'object'}
					<div
						class="space-y-2 rounded border p-2"
						style="border-color: color-mix(in oklab, var(--color-base-content) 20%, #0000);"
					>
						{#each Object.keys(settings[key]) as objKey}
							<div class="grid grid-cols-[1fr_3fr] gap-4">
								<span class="label mb-auto">{objKey}</span>
								{#if objKey === 'Secret Access Key'}
									<input type="password" class="input w-full" bind:value={settings[key][objKey]} />
								{:else if typeof settings[key][objKey] === 'string'}
									<input class="input w-full" bind:value={settings[key][objKey]} />
								{:else if typeof settings[key][objKey] === 'number'}
									<input type="number" class="input w-full" bind:value={settings[key][objKey]} />
								{:else}
									<pre>{JSON.stringify(settings[key][objKey], null, 2)}</pre>
								{/if}
							</div>
						{/each}
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
