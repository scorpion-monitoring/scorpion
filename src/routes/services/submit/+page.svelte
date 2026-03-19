<script lang="ts">
	import { resolve } from '$app/paths';
	import FileUpload from '$lib/components/submission/FileUpload.svelte';
	import type { PageProps } from './$types';
	import { onMount } from 'svelte';

	let { data }: PageProps = $props();

	let fileUploadMode = $state(false);

	let supportsMonth = $state(false);
	let monthValue = $state(
		String(new Date().getFullYear()) + '-' + String(new Date().getMonth() + 1).padStart(2, '0')
	);
	let fallbackMonth = $state(String(new Date().getMonth() + 1).padStart(2, '0'));
	let fallbackYear = $state(String(new Date().getFullYear()));
	let selectedService: string = $state('');
	const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
	const years = Array.from({ length: 10 }, (_, i) => String(new Date().getFullYear() - 9 + i));

	let indicators: Array<{ name: string; necessity: string; type: string }> = $state([]);
	let values: Record<string, number> = $state({});
	const necessities = [
		{ value: 'mandatory', label: 'Mandatory' },
		{ value: 'recommended', label: 'Recommended' },
		{ value: 'optional', label: 'Optional' }
	];

	onMount(() => {
		const i = document.createElement('input');
		i.setAttribute('type', 'month');
		supportsMonth = i.type === 'month';
	});

	async function loadIndicators() {
		const response = await fetch(resolve('/api/indicators') + `?serviceId=${selectedService}`);
		indicators = (await response.json()).indicators;
		indicators.forEach((indicator) => {
			indicator.necessity === 'additional' ? (indicator.necessity = 'optional') : null;
		});
	}

	let submitDisabled = $state(true);
	function checkMandatoryKpis() {
		submitDisabled = indicators
			.filter((ind) => ind.necessity === 'mandatory')
			.some((ind) => values[ind.name] === undefined || values[ind.name] === null);
	}

	async function submit() {
		let submissionDate: string;
		if (supportsMonth) {
			submissionDate = monthValue;
		} else {
			submissionDate = `${fallbackYear}-${fallbackMonth.padStart(2, '0')}`;
		}

		const payload = [
			{
				serviceAbbreviation: selectedService,
				date: submissionDate,
				values: values
			}
		];

		const response = await fetch(resolve('/api/measurements'), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});

		if (response.ok) {
			selectedService = '';
			indicators = [];
			values = {};
			submitDisabled = true;
		} else {
			alert('KPI submission failed. Please try again.');
		}
	}
</script>

<section class="mx-auto my-4 w-2/3">
	<div class="flex w-full justify-between">
		<h3 class="text-xl font-bold">KPI Submission Form</h3>
		<button
			class="btn btn-outline btn-sm btn-primary"
			onclick={() => (fileUploadMode = !fileUploadMode)}
			>{fileUploadMode ? 'Submission Form' : 'File Upload'}</button
		>
	</div>
	{#if fileUploadMode}
		<div class="mt-4 space-y-4">
			<FileUpload bind:services={data.services} />
		</div>
	{:else}
		<div class="mt-4 space-y-4">
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Select Service</legend>
				<select class="select w-full" bind:value={selectedService} onchange={loadIndicators}>
					<option value="" disabled selected>Select a service</option>
					{#each data.services as service}
						<option value={service.abbreviation}>{service.name}</option>
					{/each}
				</select>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Date</legend>
				{#if supportsMonth}
					<input type="month" bind:value={monthValue} class="input w-full" />
				{:else}
					<div class="flex space-x-2">
						<select bind:value={fallbackMonth} class="input w-1/2">
							<option value="" disabled>Month</option>
							{#each months as m}
								<option value={m}>{m}</option>
							{/each}
						</select>
						<select bind:value={fallbackYear} class="input w-1/2">
							<option value="" disabled>Year</option>
							{#each years as y}
								<option value={y}>{y}</option>
							{/each}
						</select>
					</div>
				{/if}
			</fieldset>
		</div>
		{#if (selectedService && monthValue) || (selectedService && fallbackMonth && fallbackYear)}
			<div class="divider"></div>
			<div class="mb-4 space-y-4">
				{#each necessities as necessity}
					<h4 class="mt-4 text-lg font-semibold">{necessity.label} Indicators</h4>
					<div class="mt-2 space-y-2">
						{#each indicators.filter((ind) => ind.necessity === necessity.value) as indicator}
							<div class="flex items-center space-x-2">
								<label for={indicator.name} class="w-1/2">{indicator.name}</label>
								<input
									id={indicator.name}
									type={indicator.type === 'float' ? 'number' : indicator.type}
									step={indicator.type === 'float' ? 0.01 : undefined}
									class="validator input w-1/2"
									min="0"
									bind:value={values[indicator.name]}
									onchange={checkMandatoryKpis}
								/>
							</div>
						{/each}
					</div>
				{/each}
			</div>
			<button class="btn w-full btn-primary" disabled={submitDisabled} onclick={submit}>
				Submit
			</button>
		{/if}
	{/if}
</section>
