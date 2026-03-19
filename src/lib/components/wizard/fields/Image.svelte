<script lang="ts">
	import { onMount } from 'svelte';

	let { label = '', attr, value = $bindable(), showLabel = true } = $props();

	function updateIcon(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			const file = input.files[0];
			const reader = new FileReader();
			reader.onload = (e) => {
				value = e.target?.result as string;
			};
			reader.readAsDataURL(file);
		}
	}

	function removeIcon() {
		value = '';
	}

	onMount(() => {
		if (!label) {
			label = attr;
		}
	});
</script>

<section class="px-4">
	<fieldset class="fieldset">
		{#if showLabel}
			<legend class="fieldset-legend">{label}</legend>
		{/if}
		{#if value}
			<div class="flex items-center gap-3">
				<div class="avatar">
					<div class="h-12 w-12 rounded">
						<img src={value} alt="Service Icon" />
					</div>
				</div>
				<button class="btn btn-sm btn-error" onclick={removeIcon}>Remove</button>
			</div>
		{:else}
			<input
				type="file"
				class="file-input w-full"
				accept="image/png, image/jpeg, image/svg+xml"
				onchange={updateIcon}
			/>
		{/if}
	</fieldset>
</section>
