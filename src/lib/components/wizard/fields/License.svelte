<script lang="ts">
	import { onMount } from 'svelte';
	import Svelecte from 'svelecte';
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import { mdiClose } from '@mdi/js';

	let { label = '', attr, value = $bindable(), showLabel = true } = $props();

	let licenses: { licenseId: string; name: string, isOsiApproved: boolean, isDeprecatedLicenseId: boolean, seeAlso: string[] }[] = $state([]);

	onMount(async () => {
		if (!label) {
			label = attr;
		}

		const response = await fetch('https://raw.githubusercontent.com/spdx/license-list-data/refs/heads/main/json/licenses.json');
		licenses = (await response.json()).licenses;
		return;
	});
</script>

<section class="px-4">
	<fieldset class="fieldset">
		{#if showLabel}
			<legend class="fieldset-legend">{label}</legend>
		{/if}
		{#if value}
		<div class="flex items-center gap-2 justify-between border rounded p-1 pl-2" 
			style="border-color: color-mix(in oklab, var(--color-base-content) 20%, #0000);">
			<span>{value}</span>
			<button class="ml-2 btn btn-error btn-sm" onclick={() => value = ''}>
				<SvgIcon type="mdi" path={mdiClose} class="w-4 h-4"/> 
			</button>
		</div>
		{:else}
		<Svelecte
			bind:value
			class="w-full"
			placeholder={`Select a ${label}`}
			options={licenses.map((license) => ({ value: license.licenseId, label: license.name, osiApproved: license.isOsiApproved, deprecated: license.isDeprecatedLicenseId, seeAlso: license.seeAlso }))}
		>
		{#snippet option(opt: any, inputValue)}
			<div class="flex items-center gap-2">
				<span>{opt.label}</span>
				{#if opt.osiApproved}
					<span class="text-xs text-green-500 bg-green-100 px-2 py-1 rounded">OSI Approved</span>
				{/if}
				{#if opt.deprecated}
					<span class="text-xs text-red-500 bg-red-100 px-2 py-1 rounded">Deprecated</span>
				{/if}
			</div>		
		{/snippet}
		</Svelecte>		
		{/if}
	</fieldset>
</section>
