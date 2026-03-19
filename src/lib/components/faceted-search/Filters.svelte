<script lang="ts">
	let { activeFilters = $bindable([]) } = $props();
</script>

{#if activeFilters.length > 0}
	<div class="flex flex-wrap gap-2 border-b p-4">
		{#each activeFilters as filter}
			<div class="mb-2">
				<span class="badge badge-sm badge-secondary">
					{filter}
				</span>
			</div>
		{/each}
	</div>
{/if}
