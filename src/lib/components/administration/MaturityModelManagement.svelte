<script lang="ts">
	import { onMount } from 'svelte';
	import Topic from './Topic.svelte';
	import Schemas from '$lib/schemas.svelte';
	import { resolve } from '$app/paths';

	let maturityModel: any = $state([]);
	let models: Array<string> = $state([]);
	let selectedModel: string = $state('');

	onMount(async () => {
		const response = await fetch(resolve('/api/maturitymodel'));
		maturityModel = await response.json();
		models = Array.from(new Set(maturityModel.map((m: { name: string }) => m.name)));
	});

	function addBuildingBlock(domain: string) {
		var schema = Schemas.getObjectFromSchema('maturity_model');
		schema.topic = `Topic ${maturityModel.filter((t: { name: string; domain: string }) => t.domain === domain && t.name === selectedModel).length + 1}`;
		schema.domain = domain;
		schema.name = selectedModel;
		maturityModel.push(schema);
	}

	function addDomain() {
		let domainName = prompt('Enter domain name:');
		if (!domainName) return;
		var schema = Schemas.getObjectFromSchema('maturity_model');
		schema.topic = `Topic 1`;
		schema.domain = domainName;
		schema.name = selectedModel;
		maturityModel.push(schema);
	}

	function addMaturityModel() {
		const modelName = prompt('Enter maturity model name:');
		const domainName = prompt('Enter domain name for the first topic:');
		if (!modelName) return;
		selectedModel = modelName;
		models.push(modelName);
		var schema = Schemas.getObjectFromSchema('maturity_model');
		schema.topic = `Topic 1`;
		schema.domain = domainName;
		schema.name = modelName;
		maturityModel.push(schema);
	}
</script>

<div class="">
	<div class="mb-4 flex flex-row items-center justify-between space-x-2">
		<select class="select w-full" bind:value={selectedModel}>
			<option value="" disabled selected>Select a maturity model</option>
			{#each models as model}
				<option value={model}>{model}</option>
			{/each}
		</select>
		<button
			class="btn btn-outline btn-sm btn-primary"
			onclick={() => {
				addMaturityModel();
			}}
		>
			Add Maturity Model
		</button>
	</div>

	{#if selectedModel}
		<div class="space-y-2">
			{#await maturityModel
				.filter((topic: { name: string }) => topic.name === selectedModel)
				.sort((a: { id: number }, b: { id: number }) => a.id - b.id)}
				<span>Loading...</span>
			{:then filteredDomains}
				{#await filteredDomains.reduce((acc: any, curr: any) => {
					const domain = curr.domain;
					if (!acc[domain]) {
						acc[domain] = [];
					}
					acc[domain].push(curr);
					return acc;
				}, {})})}
					<span>Loading...</span>
				{:then groupedTopics}
					<div class="flex flex-row justify-end">
						<button class="btn mb-2 btn-outline btn-sm btn-secondary" onclick={addDomain}
							>Add domain</button
						>
					</div>
					{#each Object.keys(groupedTopics) as domain}
						<details class="collapse rounded-box bg-base-200 p-4" name={`acc-${domain}`}>
							<summary class="flex flex-row items-center justify-between">
								<h2 class="mb-2 text-xl font-bold">{domain}</h2>
								<div>
									<button
										class="btn mb-2 btn-outline btn-sm btn-accent"
										onclick={() => addBuildingBlock(domain)}
									>
										Add Topic
									</button>
								</div>
							</summary>
							<div class="space-y-2">
								{#each groupedTopics[domain] as topic, i}
									<Topic
										bind:value={groupedTopics[domain][i]}
										onremove={(topic: { topic: string }) =>
											(maturityModel = maturityModel.filter(
												(t: { topic: string }) => t.topic !== topic.topic
											))}
									/>
								{/each}
								<button
									class="btn mt-4 w-full btn-ghost btn-sm btn-error"
									onclick={() =>
										(maturityModel = maturityModel.filter(
											(t: { domain: string }) => t.domain !== domain
										))}
								>
									Delete Domain
								</button>
							</div>
						</details>
					{/each}
				{/await}
			{/await}
		</div>
		<button
			class="btn mt-4 w-full btn-sm btn-success"
			onclick={() => {
				fetch(resolve(`/api/maturitymodel/${selectedModel}`), {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(
						maturityModel.filter((t: { name: string }) => t.name === selectedModel)
					)
				});
			}}
		>
			Save Changes
		</button>
	{/if}
</div>
