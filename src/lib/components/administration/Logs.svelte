<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import { mdiChevronLeft, mdiChevronRight, mdiRefresh } from '@mdi/js';

	let logs: Array<{
		timestamp: string;
		method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
		endpoint: string;
		user: string;
		body: string | null;
		query: string | null;
		expanded: boolean;
	}> = $state([]);
	let totalLogs = $state(0);
	let currentPage = $state(0);
	let pageSize = $state(20);

	const methodColorMapping: Record<
		'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD',
		string
	> = {
		GET: 'bg-blue-500/50 text-base-100 font-bold',
		POST: 'bg-green-500/50 text-base-100 font-bold',
		PUT: 'bg-yellow-500/50 text-base-100 font-bold',
		DELETE: 'bg-red-500/50 text-base-100 font-bold',
		PATCH: 'bg-teal-500/50 text-base-100 font-bold',
		OPTIONS: 'bg-blue-500 text-base-100 font-bold',
		HEAD: 'bg-purple-500 text-base-100 font-bold'
	};

	// Fetch logs whenever the current page changes
	$effect(() => {
		if (currentPage >= 0) {
			fetchLogs();
		}
	});

	async function fetchLogs() {
		const response = await fetch(
			resolve('/api/logs') + `?page=${currentPage}&pageSize=${pageSize}`
		);
		const body = await response.json();
		logs = body.logs;
		totalLogs = body.count;
		logs.map((log) => (log.expanded = false));
	}

	onMount(async () => {
		const response = await fetch(
			resolve('/api/logs') + `?page=${currentPage}&pageSize=${pageSize}`
		);
		const body = await response.json();
		logs = body.logs;
		totalLogs = body.count;
		logs.map((log) => (log.expanded = false));
		return;
	});
</script>

<div class="p-4">
	<h1 class="mb-4 text-2xl font-bold">Logs</h1>
	<button class="btn float-end mb-4 btn-ghost btn-xs" onclick={fetchLogs}>
		<SvgIcon class="h-6 w-6" type="mdi" path={mdiRefresh} />
	</button>
	<table class="table w-full">
		<thead>
			<tr>
				<th>Timestamp</th>
				<th>Method</th>
				<th>Endpoint</th>
				<th>User</th>
			</tr>
		</thead>
		<tbody>
			{#each logs as log}
				<tr
					class="cursor-pointer hover:bg-primary/10"
					onclick={() => (log.expanded = !log.expanded)}
				>
					<td>{new Date(log.timestamp).toLocaleString()}</td>
					<td>
						<span
							class={`badge ${methodColorMapping[log.method] || 'bg-gray-500/10 text-gray-500'}`}
							>{log.method}</span
						>
					</td>
					<td>{log.endpoint}</td>
					<td>{log.user}</td>
				</tr>
				{#if log.expanded}
					<tr>
						<td colspan="4" class="bg-primary/5 p-4">
							<div class="space-y-2">
								<div>
									<strong>Query:</strong>
									<pre>?{log.query}</pre>
								</div>
								{#if log.body}<div>
										<strong>Body:</strong>
										<pre>{JSON.stringify(log.body, null, 2)}</pre>
									</div>{/if}
							</div>
						</td>
					</tr>
				{/if}
			{/each}
		</tbody>
		<tfoot>
			<tr>
				<td colspan="4" class="text-center">
					<button
						disabled={currentPage === 0}
						class="btn mr-2 btn-ghost btn-xs"
						onclick={() => (currentPage = Math.max(0, currentPage - 1))}
					>
						<SvgIcon type="mdi" path={mdiChevronLeft} />
					</button>
					<span>Page {currentPage + 1} of {Math.ceil(totalLogs / pageSize)}</span>
					<button
						disabled={currentPage >= Math.ceil(totalLogs / pageSize) - 1}
						class="btn ml-2 btn-ghost btn-xs"
						onclick={() =>
							(currentPage = Math.min(Math.ceil(totalLogs / pageSize) - 1, currentPage + 1))}
					>
						<SvgIcon type="mdi" path={mdiChevronRight} />
					</button>
					<div class="float-right">
						<span class="mr-1">Page Size: </span>
						{#each [10, 20, 50] as size}
							<button
								class={`btn btn-ghost btn-xs ${pageSize === size ? 'btn-active' : ''}`}
								onclick={() => {
									pageSize = size;
									currentPage = 0;
								}}
							>
								{size}
							</button>
						{/each}
					</div>
				</td>
			</tr>
		</tfoot>
	</table>
</div>
