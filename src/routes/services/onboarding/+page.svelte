<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let applicationForm: any = $state({});
	let model: (typeof data.models)[0] | null = $state(null);
	let { data }: PageProps = $props();

	var currentStep = $state(0);

	function updateApplicationForm() {
		applicationForm = {
			modelName: model?.name,
			serviceName: ''
		};
		for (const key of (data.settings[0] as { additionalFields: string[] }).additionalFields) {
			if (!applicationForm[key]) {
				applicationForm[key] = null;
			}
		}
		for (const domain of model.domains) {
			if (!applicationForm[domain.name]) {
				applicationForm[domain.name] = {};
			}
			for (const topic of domain.topics) {
				if (!applicationForm[domain.name][topic.name]) {
					applicationForm[domain.name][topic.name] = null;
				}
			}
		}
	}

	async function startOnboarding() {
		const response = await fetch(resolve('/api/services/onboarding'), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(applicationForm)
		});
		if (response.ok) {
			model = null;
			applicationForm = {};
			currentStep = 0;
		}
		return;
	}
</script>

<div class="mx-auto mt-8 w-2/3 space-y-2">
	<h3 class="text-2xl font-bold">NFDI4Biodiversity Onboarding Service Application Form</h3>
	<select class="select" bind:value={model} onchange={updateApplicationForm}>
		<option disabled selected value={null}>Select maturity model</option>
		{#each data.models as model}
			<option value={model}>{model.name}</option>
		{/each}
	</select>
	{#if model}
		<div class="card my-4 bg-base-200 shadow-xl">
			<div class="card-body">
				{#key applicationForm}
					{#if currentStep >= model.domains.length}
						<h2 class="card-title">Additional Information</h2>
						<div class="flex items-center gap-3 rounded p-2 hover:bg-base-300">
							<span class="text-sm">Service Name</span>
							<input
								type="text"
								class="input-bordered input input-sm w-full max-w-xs"
								bind:value={applicationForm['serviceName']}
							/>
						</div>
						{#each (data.settings[0] as { additionalFields: string[] }).additionalFields as key}
							<div class="flex items-center gap-3 rounded p-2 hover:bg-base-300">
								<span class="text-sm">{key}</span>
								<input
									type="text"
									class="input-bordered input input-sm w-full max-w-xs"
									bind:value={applicationForm[key as string]}
								/>
							</div>
						{/each}
					{:else if applicationForm[model.domains[currentStep].name]}
						<h2 class="card-title">{model.domains[currentStep].name}</h2>
						{#each model.domains[currentStep].topics as topic}
							<fieldset class="fieldset">
								<legend class="fieldset-legend">{topic.name}</legend>
								<div class="space-y-2">
									<label
										class="flex cursor-pointer items-center gap-3 rounded p-2 hover:bg-base-300"
									>
										<input
											type="radio"
											id="not-applicable"
											name={topic.name}
											value={null}
											class="radio radio-sm"
											bind:group={applicationForm[model.domains[currentStep].name][topic.name]}
										/>
										<span class="text-sm">Not applicable</span>
									</label>
									{#each topic.levels as level, i}
										<label
											class="flex cursor-pointer items-center gap-3 rounded p-2 hover:bg-base-300"
										>
											<input
												type="radio"
												id={level}
												name={topic.name}
												value={i + 1}
												class="radio radio-sm"
												bind:group={applicationForm[model.domains[currentStep].name][topic.name]}
											/>
											<span class="text-sm">{level}</span>
										</label>
									{/each}
								</div>
							</fieldset>
						{/each}
					{/if}
				{/key}
			</div>
			<div class="card-actions flow-root p-2">
				{#if currentStep > 0}
					<button onclick={() => (currentStep = currentStep - 1)} class="btn btn-secondary"
						>Previous</button
					>
				{/if}
				{#if currentStep < model.domains.length}
					<button
						onclick={() => (currentStep = currentStep + 1)}
						class="btn float-right btn-primary">Next</button
					>
				{:else}
					<button onclick={startOnboarding} class="btn float-right btn-accent"
						>Start Onboarding</button
					>
				{/if}
			</div>
		</div>
	{/if}
</div>
