<script lang="ts">
	let { label = '', group = $bindable(), onchange, onreset } = $props();

	let editMode = $state(group.map(() => false));
	let changes = $state(false);

	function addRow() {
		group = [...group, { abbreviation: '', name: '' }];
		// editMode = [...editMode, true];
		changes = true;
	}
</script>

<section>
	<div class="mb-2 flex items-center justify-between">
		<h3 class="text-xl font-semibold">{label}</h3>
		<div>
			{#if changes}
				<button
					class="btn mr-2 btn-outline btn-sm btn-secondary"
					onclick={() => {
						changes = false;
						onreset();
					}}>Reset</button
				>
				<button
					class="btn btn-sm btn-primary"
					onclick={() => {
						changes = false;
						onchange();
					}}>Save Changes</button
				>
			{/if}
		</div>
	</div>
	<table class="table w-full">
		<thead>
			<tr>
				<th class="text-left">Abbreviation</th>
				<th class="text-left">Name</th>
				<th>
					<button class="btn btn-outline btn-xs btn-primary" onclick={addRow}>Add</button>
				</th>
			</tr>
		</thead>
		<tbody>
			{#each group as item, i}
				<tr class="hover:cursor-pointer hover:bg-primary/10">
					<td>
						{#if editMode[i]}
							<input
								type="text"
								class="input input-sm w-full"
								bind:value={item.abbreviation}
								onchange={() => (changes = true)}
							/>
						{:else}
							{item.abbreviation}
						{/if}
					</td>
					<td>
						{#if editMode[i]}
							<input
								type="text"
								class="input input-sm w-full"
								bind:value={item.name}
								onchange={() => (changes = true)}
							/>
						{:else}
							{item.name}
						{/if}
					</td>
					<td>
						{#if editMode[i]}
							<button
								class="btn btn-outline btn-xs btn-secondary"
								onclick={() => (editMode[i] = false)}>Stop</button
							>
						{:else}
							<button
								class="btn btn-outline btn-xs btn-secondary"
								onclick={() => (editMode[i] = true)}>Edit</button
							>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>
