<script lang="ts">
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import { mdiChevronDown, mdiChevronUp, mdiTrashCan } from '@mdi/js';

	function moveBy(index: number, by: number) {
		const newIndex = index + by;
		if (newIndex < 0 || newIndex >= value.length) return;

		const temp = value[newIndex];
		value[newIndex] = value[index];
		value[index] = temp;
	}

	let { value = $bindable() } = $props();
</script>

<div
	class="rounded-lg border p-4"
	style="border-color: color-mix(in oklab, var(--color-base-content) 20%, #0000);"
>
	{#each value as level, i}
		<div class="card mb-4 bg-base-200 shadow-lg">
			<div class="card-body flex flex-row items-center justify-between">
				<input type="text" class="input w-full" bind:value={value[i]} />
				<button class="btn btn-ghost btn-xs btn-error" onclick={() => value.splice(i, 1)}>
					<SvgIcon type="mdi" path={mdiTrashCan} />
				</button>
				<div class="ml-4 flex flex-col">
					<button class="hover:cursor-pointer" onclick={() => moveBy(i, -1)}>
						<SvgIcon type="mdi" path={mdiChevronUp} />
					</button>
					<button class="hover:cursor-pointer" onclick={() => moveBy(i, 1)}>
						<SvgIcon type="mdi" path={mdiChevronDown} />
					</button>
				</div>
			</div>
		</div>
	{/each}
</div>
