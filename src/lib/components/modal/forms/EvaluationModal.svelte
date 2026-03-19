<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	let evaluationMapping: Array<{
		category: string;
		indicator: string | null;
		aggregate: string | null;
	}> = $state([]);

	let { onclose, categories = [] } = $props();

	onMount(async () => {
		const response = await fetch(resolve('/api/categories/evaluation'));
		if (!response.ok) {
			console.error('Failed to fetch evaluation data:', await response.text());
			alert('Failed to load evaluation data. Please try again.');
			return;
		} else {
			evaluationMapping = await response.json();
		}
		return;
	});

	$effect(() => {
		for (const category of categories) {
			const mapping = evaluationMapping.find((m) => m.category === category.name);
			if (!mapping) {
				evaluationMapping.push({
					category: category.name,
					indicator: '',
					aggregate: ''
				});
			}
		}
		evaluationMapping.sort((a, b) => a.category.localeCompare(b.category));
	});

	const aggregateFunctions = [
		{ name: 'Sum', value: 'sum' },
		{ name: 'Average', value: 'avg' },
		{ name: 'Maximum', value: 'max' },
		{ name: 'Minimum', value: 'min' }
	];

	async function handleSubmit(e: Event) {
		e.preventDefault();
		const formData = new FormData(e.target as HTMLFormElement);
		const result = [];
		for (const category of categories) {
			const indicatorName = formData.get(`indicator-${category.name}`);
			const aggregateFunc = formData.get(`aggregate-${category.name}`);
			if (indicatorName && aggregateFunc) {
				result.push({
					category: category.name,
					indicator: indicatorName,
					aggregate: aggregateFunc
				});
			}
		}

		const response = await fetch(resolve('/api/categories/evaluation'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ evaluations: result })
		});

		if (!response.ok) {
			console.error('Failed to save evaluation:', await response.text());
			alert('Failed to save evaluation. Please try again.');
			return;
		}
		onclose();
		return;
	}
</script>

<div class="p-4">
	<form onsubmit={handleSubmit}>
		<table class="table w-full">
			<thead>
				<tr>
					<th>Category</th>
					<th>Indicator</th>
					<th>Aggregate Function</th>
				</tr>
			</thead>
			<tbody>
				{#each evaluationMapping as row}
					<tr>
						<td>{row.category}</td>
						<td>
							<select class="select" name={`indicator-${row.category}`} bind:value={row.indicator}>
								<option disabled selected value="">Select an indicator</option>
								{#await categories.find((c) => c.name === row.category)}
									<p>Loading category indicators...</p>
								{:then category}
									{#if category}
										{#each category.indicators as indicator}
											<option value={indicator.name}>{indicator.name}</option>
										{/each}
									{:else}
										<option disabled value="">No indicators available for {row.category}</option>
									{/if}
								{:catch error}
									<p>Failed to load indicators</p>
								{/await}
							</select>
						</td>
						<td>
							<select class="select" name={`aggregate-${row.category}`} bind:value={row.aggregate}>
								<option disabled selected value="">Select an aggregate function</option>
								{#each aggregateFunctions as func}
									<option value={func.value}>{func.name}</option>
								{/each}
							</select>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<div class="mt-4 flex justify-end">
			<button class="btn btn-primary">Save</button>
		</div>
	</form>
</div>
