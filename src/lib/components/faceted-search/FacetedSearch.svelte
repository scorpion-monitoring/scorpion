<script lang="ts">
	import Facets from './Facets.svelte';
	import Filters from './Filters.svelte';
	import Table from './Table.svelte';

	function updateFilter(filter: string) {
		filters = filters.includes(filter) ? filters.filter((f) => f !== filter) : [...filters, filter];
		onupdate();
	}

	let {
		services = $bindable([]),
		facets = $bindable({}),
		filters = $bindable([]),
		pagination = $bindable({ currentPage: 0, pageSize: 10, totalPages: 0 }),
		config,
		onupdate
	} = $props();
</script>

<div class="p-4">
	<h1 class="mb-4 text-2xl font-bold">Services</h1>

	<div class="grid grid-cols-[1fr_3fr] gap-4">
		<Facets bind:facets onupdate={(filter: string) => updateFilter(filter)} />
		<div>
			<Filters bind:activeFilters={filters} />
			<Table
				headers={config.headers}
				bind:data={services}
				bind:currentPage={pagination.currentPage}
				bind:pageSize={pagination.pageSize}
				totalPages={pagination.totalPages}
				{onupdate}
			/>
		</div>
	</div>
</div>
