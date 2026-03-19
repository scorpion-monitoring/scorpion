<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import FacetedSearch from '$lib/components/faceted-search/FacetedSearch.svelte';
	import { onMount } from 'svelte';

	// let services: {
	// 	abbreviation: string;
	// 	name: string;
	// 	category: string;
	// 	provider: { abbreviation: string };
	// 	consortia: { abbreviation: string }[];
	// 	stage: string;
	// }[] = $state([]);

	// onMount(async () => {
	// 	const response = await fetch(resolve('/api/services'));
	// 	services = (await response.json()).services;
	// });
	let services = $state([]);
	let facets = $state({});
	let filters = $state([]);
	let pagination = $state({ currentPage: 0, pageSize: 10, totalPages: 0 });

	onMount(async () => {
		await fetchServices();
	});

	async function fetchServices() {
		const response = await fetch(resolve('/api/services/search'), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				page: pagination.currentPage,
				pageSize: pagination.pageSize,
				facets: config.facets,
				filters: filters
			})
		});
		const body = await response.json();

		console.log(body.services);

		services = body.services || [];
		facets = body.facets || {};
		pagination = body.metadata || { currentPage: 0, pageSize: 10, totalPages: 0 };

		return;
	}

	const config = {
		headers: {
			Name: {
				type: 'avatar',
				headers: ['name', 'provider.abbreviation', 'icon'],
				sortable: true
			},
			Category: {
				type: 'text',
				headers: ['category'],
				sortable: true
			},
			Consortia: {
				type: 'tags',
				headers: ['consortia'],
				sortable: false
			}
		},
		facets: {
			Category: {
				type: 'checkbox',
				mapping: 'category'
			},
			Consortia: {
				type: 'checkbox',
				mapping: 'consortia'
			},
			Stage: {
				type: 'checkbox',
				mapping: 'stage'
			},
			License: {
				type: 'checkbox',
				mapping: 'license'
			}
		}
	};
</script>

<div class="float-end p-4">
	<button class="btn btn-sm btn-primary" onclick={() => goto(resolve('/services/new'))}
		>Add New Service</button
	>
</div>
<FacetedSearch
	bind:facets
	bind:filters
	bind:services
	bind:pagination
	{config}
	onupdate={fetchServices}
/>
