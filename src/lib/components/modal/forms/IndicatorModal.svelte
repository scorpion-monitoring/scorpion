<script lang="ts">
	let { onclose, categories = [] } = $props();

	async function submit(event: Event) {
		event.preventDefault();
		// Logic to handle form submission
		try {
			const form = event.currentTarget as HTMLFormElement;
			const data = new FormData(form);
			const name = String(data.get('name') ?? '');
			const type = String(data.get('type') ?? 'number');
			const indicator_category = String(data.get('category') ?? '');
			const description = String(data.get('description') ?? '');
			const necessityMap: Record<string, string> = {};
			categories.forEach((category) => {
				const necessity = data.get(`necessity_${category.name}`);
				if (necessity) {
					necessityMap[category.name] = String(necessity);
				}
			});
			const response = await fetch('./api/indicators', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					name,
					type,
					indicator_category,
					description,
					categories: necessityMap
				})
			});
			if (!response.ok) {
				throw new Error('Failed to save indicator');
			}
		} catch (error) {
			alert('Error saving indicator.');
		}
		onclose();
		return;
	}
</script>

<div class="flex max-h-[75vh] flex-col gap-4">
	<h2 class="text-xl font-bold">Add New Indicator</h2>
	<form onsubmit={submit}>
		<div class="space-y-2 p-4">
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Indicator Name</legend>
				<input type="text" name="name" class="input w-full" placeholder="Downloads" />
				<p class="label">A short descriptive name for the indicator</p>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Indicator Type</legend>
				<select name="type" class="select w-full">
					<option value="number">Number</option>
					<option value="float">Float</option>
					<option value="text">String</option>
				</select>
				<p class="label">The type of indicator (number, float, or string)</p>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Indicator Category</legend>
				<select name="category" class="select w-full">
					<option value="Bibliographic">Bibliographic</option>
					<option value="Usage">Usage</option>
					<option value="Technical">Technical</option>
					<option value="Satisfaction">Satisfaction</option>
				</select>
				<p class="label">The category of the indicator</p>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Description</legend>
				<textarea
					name="description"
					class="textarea w-full"
					placeholder="With this indicator, the number of downloads are tracked."
				></textarea>
				<p class="label">A detailed description of the indicator</p>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Categories</legend>
				<div>
					<table class="table w-full">
						<thead>
							<tr>
								<th class="text-left font-bold">Category</th>
								<th>Mandatory</th>
								<th>Recommended</th>
								<th>Optional</th>
								<th>Unused</th>
							</tr>
						</thead>
						<tbody>
							{#each categories as category}
								<tr>
									<td>{category.name}</td>
									<td>
										<input
											type="radio"
											class="checkbox"
											name="necessity_{category.name}"
											value="mandatory"
										/>
									</td>
									<td>
										<input
											type="radio"
											class="checkbox"
											name="necessity_{category.name}"
											value="recommended"
										/>
									</td>
									<td>
										<input
											type="radio"
											class="checkbox"
											name="necessity_{category.name}"
											value="optional"
										/>
									</td>
									<td>
										<input
											type="radio"
											class="checkbox"
											name="necessity_{category.name}"
											value=""
											checked
										/>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</fieldset>
		</div>
		<div class="form-control mb-2 flex justify-between">
			<button type="button" class="btn btn-secondary" onclick={onclose}>Cancel</button>
			<button type="submit" class="btn btn-primary">Save Indicator</button>
		</div>
	</form>
</div>
