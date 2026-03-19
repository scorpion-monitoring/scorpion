<script lang="ts">
	import { onMount } from 'svelte';
	import Chart from './Chart.svelte';

	let { model, value = $bindable() } = $props();

	const data: Record<string, any[]> = $state({});
	const layout = {
		paper_bgcolor: 'rgba(0,0,0,0)',
		bgcolor: 'rgba(0,0,0,0)',
		polar: {
			bgcolor: 'rgba(0,0,0,0)',
			radialaxis: {
				visible: true,
				range: [0, 1],
				gridcolor: 'rgba(0,0,0,0.12)'
			},
			angularaxis: {
				gridcolor: 'rgba(0,0,0,0.12)'
			}
		},
		showlegend: false
	};
	onMount(async () => {
		const domains = Array.from(new Set(model.map((item: { domain: string }) => item.domain)));
		const topics: Record<string, any[]> = {};
		model.forEach((item: { domain: string; topic: string; levels: string[] }) => {
			if (!topics[item.domain]) {
				topics[item.domain] = [];
			}
			if (!topics[item.domain].includes(item.topic)) {
				topics[item.domain].push({
					title: item.topic,
					levelCount: item.levels.length,
					levels: item.levels
				});
			}
		});
		currentPages = Object.fromEntries(domains.map((domain) => [domain, 0]));

		for (const domain of domains) {
			data[domain as string] = [
				{
					type: 'scatterpolar',
					r: topics[domain as string].map((topic) => {
						const val = value ? value.formData[0][domain as string][topic.title] : null;
						if (val) {
							return val / topic.levelCount;
						} else {
							return 0;
						}
					}),
					theta: topics[domain as string].map((topic) => topic.title),
					text: topics[domain as string].map((topic) => {
						const val = value ? value.formData[0][domain as string][topic.title] : null;
						return `${topic.levels[val - 1] || 'Not assessed'}`;
					}),
					hoverinfo: 'theta+text',
					fill: 'toself',
					name: domain
				}
			];
			data[domain as string][0].r.push(data[domain as string][0].r[0]);
			data[domain as string][0].theta.push(data[domain as string][0].theta[0]);
			data[domain as string][0].text.push(data[domain as string][0].text[0]);
		}
		return;
	});

	let currentPages: Record<string, number> = $state({});
</script>

<div class="space-y-4">
	{#each Object.keys(data) as domain}
		<div class="card card-side border border-base-300 bg-base-200 shadow-sm">
			<div class="w-2/3 p-2">
				<Chart traces={data[domain as string]} {layout} />
			</div>
			<div class="card-body w-1/3">
				<h2 class="card-title">{domain}</h2>
				<div>
					{#await model.filter((rule: { domain: string }) => rule.domain === domain)}
						<p>Loading topics...</p>
					{:then topics}
						{#each topics as topic, i}
							<!-- {JSON.stringify(currentPages)} -->
							{#if i === currentPages[domain as string]}
								<h3 class="font-bold">Topic: {topic.topic}</h3>
								<table class="table">
									<thead>
										<tr>
											<th>Level</th>
											<th>Description</th>
										</tr>
									</thead>
									<tbody>
										{#each topic.levels as level, j}
											<tr
												class:text-accent-content={j + 1 ===
													value?.formData[0][domain as string][topic.topic]}
												class:bg-accent={j + 1 ===
													value?.formData[0][domain as string][topic.topic]}
											>
												<td>{j + 1}</td>
												<td>{level}</td>
											</tr>
										{/each}
									</tbody>
									<tfoot>
										<tr>
											<td colspan="2">
												<div class="flex items-center justify-between gap-2">
													<button
														class="btn btn-sm"
														onclick={() =>
															(currentPages[domain as string] =
																(currentPages[domain as string] - 1 + topics.length) %
																topics.length)}
													>
														Previous topic
													</button>
													<button
														class="btn btn-sm"
														onclick={() =>
															(currentPages[domain as string] =
																(currentPages[domain as string] + 1) % topics.length)}
													>
														Next topic
													</button>
												</div>
											</td>
										</tr>
									</tfoot>
								</table>
							{/if}
						{/each}
					{/await}
				</div>
			</div>
		</div>
	{/each}
</div>
