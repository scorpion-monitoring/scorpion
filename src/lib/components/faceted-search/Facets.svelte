<script lang="ts">
	let { facets = $bindable({}), onupdate } = $props();
</script>

<div
	class="border-r p-4"
	style="border-color: color-mix(in oklab, var(--color-base-content) 20%, #0000);"
>
	{#each Object.entries(facets) as [facetName, facetData]}
		<div class="mb-4">
			<h2 class="mb-2 text-lg font-semibold">{facetName}</h2>
			<ul>
				{#each facetData as value}
					<li class="my-1">
						<label class="flex cursor-pointer items-center gap-2">
							<input
								type="checkbox"
								class="checkbox"
								onchange={() => onupdate(`+${facetName}:${value.value}`)}
							/>
							<span class="text-sm">{value.value} ({value.count})</span>
						</label>
					</li>
				{/each}
			</ul>
		</div>
	{/each}
</div>
