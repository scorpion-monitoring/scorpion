<script lang="ts">
	import { resolve } from '$app/paths';
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import { mdiMinus, mdiPlus } from '@mdi/js';
	import { onMount } from 'svelte';

	let { value = $bindable() } = $props();

	let categories: {
		name: string;
		indicators: { id: number; name: string; necessity: 'mandatory' | 'recommended' | 'optional' }[];
	}[] = $state([]);
	let indicators: { name: string }[] = $state([]);

	onMount(async () => {
		let response = await fetch(resolve('/api/categories'));
		categories = (await response.json()).categories;
		response = await fetch(resolve('/api/indicators'));
		indicators = (await response.json()).indicators;
		return;
	});
</script>

<section class="px-4">
	<fieldset class="fieldset">
		<legend class="fieldset-legend">Service Category</legend>
		<select
			bind:value={value.category}
			class="input w-full"
			onchange={() => (value.optionalKpis = [])}
		>
			<option value="" disabled>Select a category</option>
			{#each categories as category}
				<option value={category.name}>{category.name}</option>
			{/each}
		</select>
	</fieldset>
	{#if value.category}
		<fieldset class="fieldset">
			<legend class="fieldset-legend">KPI Set</legend>
			<div class="p-4">
				<span class="text-sm font-medium">Mandatory KPI</span>
				<ul>
					{#if categories
						.find((c) => c.name === value.category)
						?.indicators.filter((i) => i.necessity === 'mandatory').length === 0}
						<li class="m-1 p-2">No mandatory KPIs for this category.</li>
					{/if}
					{#each categories
						.find((c) => c.name === value.category)
						?.indicators.filter((i) => i.necessity === 'mandatory') || [] as indicator}
						<li class="m-1 flex items-center justify-between rounded p-2 hover:bg-primary/10">
							<span>{indicator.name}</span>
							<button class="btn btn-circle btn-xs btn-error" aria-label="Remove" disabled>
								<SvgIcon type="mdi" path={mdiMinus} class="h-4 w-4" />
							</button>
						</li>
					{/each}
				</ul>
				<span class="text-sm font-medium">Recommended KPI</span>
				<ul>
					{#if categories
						.find((c) => c.name === value.category)
						?.indicators.filter((i) => i.necessity === 'recommended').length === 0}
						<li class="m-1 p-2">No recommended KPIs for this category.</li>
					{:else}
						{#each categories
							.find((c) => c.name === value.category)
							?.indicators.filter((i) => i.necessity === 'recommended') || [] as indicator}
							<li class="m-1 flex items-center justify-between rounded p-2 hover:bg-primary/10">
								<span>{indicator.name}</span>
								<button class="btn btn-circle btn-xs btn-error" aria-label="Remove" disabled>
									<SvgIcon type="mdi" path={mdiMinus} class="h-4 w-4" />
								</button>
							</li>
						{/each}
					{/if}
				</ul>
				<span class="text-sm font-medium">Optional KPI</span>
				<ul>
					{#if categories
						.find((c) => c.name === value.category)
						?.indicators.filter((i) => i.necessity === 'optional').length === 0}
						<li class="m-1 p-2">No optional KPIs for this category.</li>
					{:else}
						{#each categories
							.find((c) => c.name === value.category)
							?.indicators.filter((i) => i.necessity === 'optional') || [] as indicator}
							<li class="m-1 flex items-center justify-between rounded p-2 hover:bg-primary/10">
								<span>{indicator.name}</span>
								<button class="btn btn-circle btn-xs btn-error" aria-label="Remove" disabled>
									<SvgIcon type="mdi" path={mdiMinus} class="h-4 w-4" />
								</button>
							</li>
						{/each}
					{/if}
				</ul>
				<span class="text-sm font-medium">Additional KPI</span>
				<ul>
					{#each indicators.filter((i) => !categories
								.find((c) => c.name === value.category)
								?.indicators.map((ind) => ind.name)
								.includes(i.name)) as indicator}
						<li class="m-1 flex items-center justify-between rounded p-2 hover:bg-primary/10">
							<span>{indicator.name}</span>
							{#if !value.optionalKpis.includes(indicator.name)}
								<button
									class="btn btn-circle btn-xs btn-success"
									aria-label="Add"
									onclick={() => (value.optionalKpis = [...value.optionalKpis, indicator.name])}
								>
									<SvgIcon type="mdi" path={mdiPlus} class="h-4 w-4" />
								</button>
							{:else}
								<button
									class="btn btn-circle btn-xs btn-error"
									aria-label="Remove"
									onclick={() =>
										(value.optionalKpis = value.optionalKpis.filter(
											(name: string) => name !== indicator.name
										))}
								>
									<SvgIcon type="mdi" path={mdiMinus} class="h-4 w-4" />
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		</fieldset>
	{/if}
</section>
