<script lang="ts">
	import Levels from './Levels.svelte';

	let { value = $bindable(), onremove = () => {} } = $props();
</script>

<div class="collapse-arrow collapse rounded-box bg-base-300">
	<input type="checkbox" />
	<div class="collapse-title text-xl font-medium">
		{value.topic}
	</div>
	<div class="collapse-content px-8">
		<fieldset class="fieldset">
			<legend class="fieldset-legend">Topic</legend>
			<input type="text" class="input w-full" bind:value={value.topic} />
		</fieldset>
		<fieldset class="fieldset">
			<div class="flex flex-row items-center justify-between">
				<legend class="fieldset-legend">Levels</legend>
				<button
					class="btn btn-outline btn-xs btn-primary"
					onclick={() => value.levels.push(`Level ${value.levels.length + 1}`)}
				>
					Add Level
				</button>
			</div>
			<Levels bind:value={value.levels} />
		</fieldset>
		<button class="btn mt-4 w-full btn-ghost btn-sm btn-error" onclick={() => onremove(value)}>
			Delete Topic
		</button>
	</div>
</div>
