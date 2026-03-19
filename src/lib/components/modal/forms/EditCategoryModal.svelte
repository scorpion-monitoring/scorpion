<script lang="ts">
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import { mdiPlus } from '@mdi/js';

	let { onclose, category = null, indicators = [] } = $props();

	async function submit() {
		const response = await fetch('./api/categories/' + encodeURIComponent(category.name), {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				indicators: category.indicators.reduce(
					(acc: Record<string, string>, indicator: { name: string; necessity: string }) => {
						acc[indicator.name] = indicator.necessity;
						return acc;
					},
					{}
				)
			})
		});
		if (!response.ok) {
			alert('Error updating category.');
		}
		onclose();
		return;
	}

	function addIndicator(indicator: { name: string }) {
		if (category) {
			if (category.indicators.find((ind: { name: string }) => ind.name === indicator.name)) {
				return;
			}
			category.indicators.push({
				name: indicator.name,
				necessity: ''
			});
		}
	}

	let page = $state(0);
	let pageSize = 5;
</script>

{#if category}
	<div class="flex flex-col gap-4">
		<h2 class="text-xl font-bold">Edit Category</h2>
		<form>
			<div class="space-y-2 p-4">
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Category Name</legend>
					<input
						disabled
						type="text"
						name="name"
						class="input w-full"
						placeholder="Databases"
						bind:value={category.name}
					/>
					<p class="label">A short descriptive name for the Category</p>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Extend Indicators</legend>
					<div>
						<table class="table w-full">
							<tbody>
								{#each indicators.filter((ind: { name: string }) => !category.indicators.find((ci: { name: string }) => ci.name === ind.name)) as indicator, i}
									{#if i >= page * pageSize && i < (page + 1) * pageSize}
										<tr>
											<td>{indicator.name}</td>
											<td>
												<button
													class="btn btn-circle btn-xs"
													onclick={(e) => {
														e.preventDefault();
														addIndicator(indicator);
													}}><SvgIcon type="mdi" path={mdiPlus} /></button
												>
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
							<tfoot>
								<tr>
									<td colspan="2">
										<div class="flex justify-between">
											<button
												class="btn btn-sm"
												onclick={() => (page = Math.max(page - 1, 0))}
												disabled={page === 0}>Previous</button
											>
											<span
												>Page {page + 1} / {Math.ceil(
													indicators.filter(
														(ind: { name: string }) =>
															!category.indicators.find(
																(ci: { name: string }) => ci.name === ind.name
															)
													).length / pageSize
												)}</span
											>
											<button
												class="btn btn-sm"
												onclick={() => (page = page + 1)}
												disabled={(page + 1) * pageSize >=
													indicators.filter(
														(ind: { name: string }) =>
															!category.indicators.find(
																(ci: { name: string }) => ci.name === ind.name
															)
													).length}>Next</button
											>
										</div>
									</td>
								</tr>
							</tfoot>
						</table>
					</div>
					<p class="label">Select indicators to be added to the KPI set</p>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Assign Indicators</legend>
					<table class="table w-full">
						<thead>
							<tr>
								<th>Indicator Name</th>
								<th>Mandatory</th>
								<th>Recommended</th>
								<th>Optional</th>
								<th>Unused</th>
							</tr>
						</thead>
						<tbody>
							{#each category.indicators as indicator}
								<tr>
									<td>{indicator.name}</td>
									<td>
										<input
											type="radio"
											class="checkbox"
											name={'indicator_' + indicator.name}
											value="mandatory"
											bind:group={indicator.necessity}
										/>
									</td>
									<td>
										<input
											type="radio"
											class="checkbox"
											name={'indicator_' + indicator.name}
											value="recommended"
											bind:group={indicator.necessity}
										/>
									</td>
									<td>
										<input
											type="radio"
											class="checkbox"
											name={'indicator_' + indicator.name}
											value="optional"
											bind:group={indicator.necessity}
										/>
									</td>
									<td>
										<input
											type="radio"
											class="checkbox"
											name={'indicator_' + indicator.name}
											value=""
											bind:group={indicator.necessity}
										/>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<p class="label">Select indicators to be included in this category</p>
				</fieldset>
			</div>
			<div class="form-control flex justify-between">
				<button type="button" class="btn btn-secondary" onclick={onclose}>Cancel</button>
				<button type="submit" class="btn btn-primary" onclick={submit}>Save Category</button>
			</div>
		</form>
	</div>
{/if}
