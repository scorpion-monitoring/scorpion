<script lang="ts">
	import { onMount } from 'svelte';
	import Modal from '../modal/Modal.svelte';
	import IndicatorModal from '../modal/forms/IndicatorModal.svelte';
	import CategoryModal from '../modal/forms/CategoryModal.svelte';
	import EditCategoryModal from '../modal/forms/EditCategoryModal.svelte';
	import EvaluationModal from '../modal/forms/EvaluationModal.svelte';

	let categories: Array<{
		name: string;
		indicators: { id: number; name: string; necessity: string }[];
	}> = $state([]);
	let indicators: Array<{ name: string }> = $state([]);
	let selectedCategory: {
		name: string;
		indicators: { id: number; name: string; necessity: string }[];
	} | null = $state(null);

	onMount(async () => {
		await reload();
		return;
	});

	async function reload() {
		try {
			let response = await fetch('./api/categories');
			if (response.ok) {
				const result = await response.json();
				categories = result.categories;
			} else {
				throw new Error('Failed to fetch categories');
			}

			response = await fetch('./api/indicators');
			if (response.ok) {
				const result = await response.json();
				indicators = result.indicators;
			} else {
				throw new Error('Failed to fetch indicators');
			}
		} catch (error) {
			console.error('Error fetching categories:', error);
		}
	}

	function updateCategory(categoryName: string) {
		// Deep copy to avoid direct mutation
		const category = categories.find((cat) => cat.name === categoryName);
		if (category) {
			selectedCategory = JSON.parse(JSON.stringify(category));
		} else {
			selectedCategory = null;
		}
		openModal('edit-category-modal');
	}

	function openModal(id: string) {
		const modal = document.getElementById(id) as HTMLDialogElement;
		modal.showModal();
	}

	function closeModal(id: string) {
		const modal = document.getElementById(id) as HTMLDialogElement;
		modal.close();
	}

	let page = $state(0);
	let pageSize = $state(5);
</script>

<section class="space-x-2">
	<div class="flex justify-end gap-2">
		<button class="btn btn-sm btn-accent" onclick={() => openModal('evaluation-modal')}>
			Configure Evaluation
		</button>
		<button class="btn btn-sm btn-primary" onclick={() => openModal('category-modal')}>
			New Category
		</button>
		<button class="btn btn-sm btn-secondary" onclick={() => openModal('indicator-modal')}>
			New Indicator
		</button>
	</div>

	<table class="table">
		<thead>
			<tr>
				<th>Name</th>
				<th>Indicators</th>
				<th>Action</th>
			</tr>
		</thead>
		<tbody>
			{#each categories as category, i}
				{#if i >= page * pageSize && i < (page + 1) * pageSize}
					<tr class="hover:bg-primary/10">
						<td>{category.name}</td>
						<td>
							<table class="table">
								<tbody>
									{#each JSON.parse(JSON.stringify(category.indicators)).sort( (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name) ) as indicator}
										{#if indicator.necessity !== ''}
											<tr>
												<td class="w-1/2">{indicator.name}</td>
												<td class="w-1/2">
													<span
														class="badge badge-outline badge-sm {indicator.necessity === 'mandatory'
															? 'badge-primary'
															: indicator.necessity === 'recommended'
																? 'badge-secondary'
																: indicator.necessity === 'optional'
																	? 'badge-accent'
																	: 'badge-ghost'}">{indicator.necessity}</span
													>
												</td>
											</tr>
										{/if}
									{/each}
								</tbody>
							</table>
						</td>
						<td>
							<button class="btn btn-sm btn-warning" onclick={() => updateCategory(category.name)}
								>Edit KPI Set</button
							>
						</td>
					</tr>
				{/if}
			{/each}
		</tbody>
		<tfoot>
			<tr>
				<th colspan="3">
					<div class="flex justify-between space-x-2">
						<button
							class="btn btn-sm"
							onclick={() => (page = Math.max(page - 1, 0))}
							disabled={page === 0}>Previous</button
						>
						<span>Page {page + 1} / {Math.ceil(categories.length / pageSize)}</span>
						<button
							class="btn btn-sm"
							onclick={() => (page = page + 1)}
							disabled={(page + 1) * pageSize >= categories.length}>Next</button
						>
					</div>
				</th>
			</tr>
		</tfoot>
	</table>
</section>

<Modal id="indicator-modal">
	<IndicatorModal
		onclose={() => {
			closeModal('indicator-modal');
			reload();
		}}
		{categories}
	/>
</Modal>

<Modal id="category-modal">
	<CategoryModal
		onclose={() => {
			closeModal('category-modal');
			reload();
		}}
		{indicators}
	/>
</Modal>

<Modal id="edit-category-modal">
	<EditCategoryModal
		onclose={() => {
			closeModal('edit-category-modal');
			reload();
		}}
		category={selectedCategory}
		{indicators}
	/>
</Modal>

<Modal id="evaluation-modal">
	<EvaluationModal
		onclose={() => {
			closeModal('evaluation-modal');
			reload();
		}}
		{categories}
	/>
</Modal>
