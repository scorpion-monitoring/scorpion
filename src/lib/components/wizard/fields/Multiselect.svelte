<script lang="ts">
	import Schemas from '$lib/schemas.svelte';
	import { onMount } from 'svelte';
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import { mdiPlus, mdiMinus } from '@mdi/js';

	let { label = '', attr, value = $bindable(), showLabel = true, mapping = {} } = $props();

	onMount(() => {
		if (!label) {
			label = attr;
		}
	});

	function removeItem(identifier: string) {
		value = value.filter((_: any) => _['identifier'] !== identifier);
	}

	function addItem(item: { value: string; label: string }) {
		let org = Schemas.getObjectFromSchema('organization');
		org['identifier'] = item.value;
		org['name'] = item.label;
		value = [...value, org];
	}
</script>

<section class="px-4">
	<fieldset class="fieldset">
		{#if showLabel}
			<legend class="fieldset-legend">{label}</legend>
		{/if}
		<div
			class="rounded-lg border p-2"
			style="border-color: color-mix(in oklab, var(--color-base-content) 20%, #0000);"
		>
			<ul>
				{#each mapping.options as item}
					<li class="m-1 flex items-center justify-between rounded p-2 hover:bg-primary/10">
						<span>{item.label}</span>
						{#if value.find((v: { [x: string]: any }) => v['identifier'] === item.value)}
							<button
								class="btn btn-circle btn-xs btn-error"
								aria-label="Remove"
								onclick={() => removeItem(item.value)}
							>
								<SvgIcon type="mdi" path={mdiMinus} class="h-4 w-4" />
							</button>
						{:else}
							<button
								class="btn btn-circle btn-xs btn-success"
								aria-label="Add"
								onclick={() => addItem(item)}
							>
								<SvgIcon type="mdi" path={mdiPlus} class="h-4 w-4" />
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	</fieldset>
</section>
