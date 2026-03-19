<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';

	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import { mdiChevronLeft, mdiChevronRight } from '@mdi/js';

	let {
		headers = $bindable({}),
		data = $bindable([]),
		currentPage = $bindable(0),
		pageSize = $bindable(10),
		totalPages,
		onupdate
	} = $props();

	function getNestedValue(obj: Record<string, any>, path: string): any {
		return path.split('.').reduce((current, prop) => current?.[prop], obj);
	}
</script>

<div class="p-4">
	{#if data.length === 0}
		<p>No data available.</p>
	{:else}
		<table class="table">
			<thead>
				<tr>
					{#each Object.keys(headers) as key}
						<th>{key}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each data as row}
					<tr
						class="hover:cursor-pointer hover:bg-primary/10"
						onclick={() => goto(resolve(`/services/${row.abbreviation}`))}
					>
						{#each Object.values(headers) as header}
							{#if header.type === 'text'}
								<td>{getNestedValue(row, header.headers[0])}</td>
							{:else if header.type === 'avatar'}
								<td>
									<div class="flex items-center gap-3">
										<div class="avatar">
											<div class="mask h-12 w-12 mask-squircle">
												{#if getNestedValue(row, header.headers[2])}
													<img src={getNestedValue(row, header.headers[2])} alt="Avatar" />
												{:else}
													<div class="h-32 w-32 skeleton"></div>
												{/if}
											</div>
										</div>
										<div>
											<div class="font-bold">{getNestedValue(row, header.headers[0])}</div>
											<div class="text-sm opacity-50">{getNestedValue(row, header.headers[1])}</div>
										</div>
									</div>
								</td>
							{:else if header.type === 'tags'}
								<td>
									{#each getNestedValue(row, header.headers[0]) as tag}
										{#if tag.abbreviation}
											<span class="badge badge-outline badge-sm">{tag.abbreviation}</span>
										{:else}
											<span class="badge badge-outline badge-sm">{tag}</span>
										{/if}
									{/each}
								</td>
							{/if}
						{/each}
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<td colspan={Object.keys(headers).length} class="text-center">
						<div class="float-end mr-2">
							<span class="mr-2 text-xs">Page Size:</span>
							{#each [10, 20, 50] as pageSizeOption}
								<button
									class="btn btn-ghost btn-sm {pageSize === pageSizeOption ? 'btn-primary' : ''}"
									onclick={() => {
										pageSize = pageSizeOption;
										currentPage = 0;
										onupdate();
									}}
								>
									{pageSizeOption}
								</button>
							{/each}
						</div>
						<button
							class="btn btn-ghost btn-sm"
							disabled={currentPage === 0}
							onclick={() => {
								currentPage--;
								onupdate();
							}}
						>
							<SvgIcon type="mdi" path={mdiChevronLeft} />
						</button>
						<span class="">{currentPage + 1} / {totalPages}</span>
						<button
							class="btn btn-ghost btn-sm"
							disabled={currentPage === totalPages - 1}
							onclick={() => {
								currentPage++;
								onupdate();
							}}
						>
							<SvgIcon type="mdi" path={mdiChevronRight} />
						</button>
					</td>
				</tr>
			</tfoot>
		</table>
	{/if}
</div>
