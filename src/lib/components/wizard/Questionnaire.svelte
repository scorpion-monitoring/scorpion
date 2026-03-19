<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import FieldWrapper from './FieldWrapper.svelte';
	import ComponentWrapper from './ComponentWrapper.svelte';
	import Text from './fields/Text.svelte';
	import License from './fields/License.svelte';
	import Multiselect from './fields/Multiselect.svelte';
	import Provider from './fields/Provider.svelte';
	import Select from './fields/Select.svelte';
	import KpiSet from './components/KpiSet.svelte';
	import Image from './fields/Image.svelte';

	let { onfinish } = $props();

	type Field = {
		type: string;
		label: string;
		mapping: {
			jsonPath: string;
		};
	};

	type Step = {
		title: string;
		text?: string[];
		fields?: Field[];
		component?: string;
		jsonPath?: string;
		componentConfig?: any;
	};

	let steps: Step[] = $state([]);
	let currentStep = $state(0);

	const fieldTypes = {
		text: Text,
		license: License,
		'multi-select': Multiselect,
		provider: Provider,
		select: Select,
		image: Image
	};

	const componentTypes = {
		'kpi-set': KpiSet
	};

	function handleKeypress(event: KeyboardEvent) {}

	function next() {
		if (currentStep < steps.length - 1) {
			currentStep += 1;
		}
	}

	function prev() {
		if (currentStep > 0) {
			currentStep -= 1;
		}
	}

	onMount(async () => {
		// @ts-ignore
		const response = await fetch(resolve('/steps.json'));
		steps = await response.json();
		return;
	});
</script>

{#if steps.length > 0}
	<section class="rounded-lg border border-neutral-300 p-4">
		<h2 class="text-2xl font-bold">Step {currentStep + 1} of {steps.length}</h2>
		<p class="m-2 font-semibold text-neutral-500">{steps[currentStep].title}</p>

		<div class="p-0">
			<div onkeypress={handleKeypress} role="button" tabindex="0" aria-pressed="false">
				{#key currentStep}
					{#if steps[currentStep].text}
						{#each steps[currentStep].text as paragraph}
							<p>{paragraph}</p>
						{/each}
					{/if}

					{#if steps[currentStep].fields}
						{#each steps[currentStep].fields as field}
							<FieldWrapper
								component={fieldTypes[field.type as keyof typeof fieldTypes]}
								jsonPath={field.mapping.jsonPath}
								{field}
							/>
						{/each}
					{/if}

					{#if steps[currentStep].component}
						<ComponentWrapper
							component={componentTypes[
								steps[currentStep].component as keyof typeof componentTypes
							]}
							jsonPath={steps[currentStep].jsonPath}
							componentConfig={steps[currentStep].componentConfig}
						/>
					{/if}
				{/key}
			</div>
		</div>

		<div class="m-2 flow-root">
			{#if currentStep > 0}
				<button class="btn btn-secondary" onclick={prev}>Previous</button>
			{/if}

			{#if currentStep < steps.length - 1}
				<button class="btn float-right btn-primary" onclick={next}>Next</button>
			{:else}
				<button class="btn float-right btn-primary" onclick={onfinish}>Finish</button>
			{/if}
		</div>
	</section>
{/if}
