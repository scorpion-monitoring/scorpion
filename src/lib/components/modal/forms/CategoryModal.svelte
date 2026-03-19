<script lang="ts">
	let { onclose, indicators = [] } = $props();

	async function submit(event: Event) {
		event.preventDefault();
		// Logic to handle form submission
		try {
			const form = event.currentTarget as HTMLFormElement;
			const data = new FormData(form);
			const name = String(data.get('name') ?? '');
			const necessityMap: Record<string, string> = {};
			indicators.forEach((indicator) => {
				const key = 'indicator_' + indicator.name;
				const value = String(data.get(key) ?? 'unused');
				necessityMap[indicator.name] = value;
			});

			// Here you would typically send 'name' and 'necessityMap' to your backend API
			const response = await fetch('./api/categories', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ name, indicators: necessityMap })
			});
			if (!response.ok) {
				throw new Error('Failed to save category');
			}
		} catch (error) {
			alert('Error saving category.');
		}

		onclose();
		return;
	}
</script>

<div class="flex flex-col gap-4">
	<h2 class="text-xl font-bold">Add New Category</h2>
	<form onsubmit={submit}>
		<div class="space-y-2 p-4">
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Category Name</legend>
				<input type="text" name="name" class="input w-full" placeholder="Databases" />
				<p class="label">A short descriptive name for the Category</p>
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
						{#each indicators as indicator}
							<tr>
								<td>{indicator.name}</td>
								<td>
									<input
										type="radio"
										class="checkbox"
										name={'indicator_' + indicator.name}
										value="mandatory"
									/>
								</td>
								<td>
									<input
										type="radio"
										class="checkbox"
										name={'indicator_' + indicator.name}
										value="recommended"
									/>
								</td>
								<td>
									<input
										type="radio"
										class="checkbox"
										name={'indicator_' + indicator.name}
										value="optional"
									/>
								</td>
								<td>
									<input
										type="radio"
										class="checkbox"
										name={'indicator_' + indicator.name}
										value=""
										checked
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
			<button type="submit" class="btn btn-primary">Save Category</button>
		</div>
	</form>
</div>
