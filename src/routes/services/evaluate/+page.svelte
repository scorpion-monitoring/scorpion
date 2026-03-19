<script lang="ts">
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';

	let { data }: PageProps = $props();

	let selectedConsortium: string = $state('');
	let selectedYear: number = $state(new Date().getFullYear());
</script>

<div class="mx-auto mt-8 w-2/3">
	<h2 class="text-xl font-bold">Impact Evaluation</h2>
	<div class="mt-4 space-y-4">
		<fieldset class="fieldset">
			<legend class="fieldset-legend">Select Consortium</legend>
			<select class="select w-full" bind:value={selectedConsortium}>
				<option disabled value="">Select a consortium</option>
				{#each data?.consortia as consortium}
					<option value={consortium.abbreviation}>{consortium.name}</option>
				{/each}
			</select>
		</fieldset>
	</div>
</div>

{#if selectedConsortium}
	{#await fetch(resolve(`/api/services`) + `?consortium=${selectedConsortium}`).then( async (response) => {
			if (!response.ok) {
				throw new Error(`Failed to fetch services: ${response.statusText}`);
			}
			return await response.json();
		} )}
		<div class="mx-auto mt-8 w-2/3 text-center">
			<p>Loading services...</p>
		</div>
	{:then body}
		{#if body}
			{#if body.services.length > 0}
				<div class="mx-auto mt-8 w-2/3 space-y-4">
					<section>
						<h3 class="text-lg font-semibold">Overview of the services of {selectedConsortium}</h3>
						{#await fetch(resolve('/api/consortia/evaluation') + `?consortium=${selectedConsortium}`).then( async (response) => {
								if (!response.ok) {
									throw new Error(`Failed to fetch evaluation indicators: ${response.statusText}`);
								}
								return await response.json();
							} )}
							<div class="flex items-center space-x-2">
								<span class="loading loading-xs loading-spinner"></span>
								<span>Loading evaluation indicators...</span>
							</div>
						{:then evaluationData}
							<div class="stats mx-auto w-full shadow">
								{#each Object.keys(evaluationData) as key}
									<div class="stat">
										<div class="stat-title">{key}</div>
										<div class="stat-value text-primary">{evaluationData[key]}</div>
									</div>
								{/each}
							</div>
						{/await}
					</section>

					<section>
						<h3 class="text-lg font-semibold">
							Information about each individual service of {selectedConsortium}
						</h3>
						<table class="table w-full">
							<thead>
								<tr>
									<th>Service</th>
									{#each new Array(12).fill(null).map((_, i) => i) as month}
										<th class="text-center"
											>{new Date(0, month).toLocaleString('default', { month: 'short' })}</th
										>
									{/each}
									<th>
										<select class="select" bind:value={selectedYear}>
											{#each Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - i) as year}
												<option value={year}>{year}</option>
											{/each}
										</select>
									</th>
								</tr>
							</thead>
							<tbody>
								{#each body.services as service}
									{#if data.evaluationIndicators && service.category in data.evaluationIndicators}
										{#await fetch(resolve(`/api/measurements`) + `?service=${service.abbreviation}&indicator=${data.evaluationIndicators[service.category as keyof typeof data.evaluationIndicators].indicator}&date_from=${new Date(selectedYear, 0, 1).toISOString().split('T')[0]}&date_to=${new Date(selectedYear + 1, 0, 1).toISOString().split('T')[0]}`).then( async (response) => {
												const body = await response.json();
												if (!response.ok) {
													throw new Error(`Failed to fetch KPI measurements for service ${service.name}: ${response.statusText}`);
												}
												return body;
											} )}
											<tr>
												<td colspan="14" class="text-center">
													<div class="flex items-center space-x-2">
														<span class="loading loading-xs loading-spinner"></span>
														<span>Loading KPI measurements...</span>
													</div>
												</td>
											</tr>
										{:then usageData}
											{#if usageData.length > 0}
												<tr>
													<td>
														<div>
															<div class="font-bold">{service.name}</div>
															<div class="text-sm opacity-50">{service.category}</div>
														</div>
													</td>
													{#each new Array(12).fill(null).map((_, i) => i) as month}
														<td class="text-center">
															{#if usageData[0].values.find((v: { date: string; value: string }) => new Date(v.date).getMonth() === month)}
																{Number(
																	usageData[0].values.find(
																		(v: { date: string; value: string }) =>
																			new Date(v.date).getMonth() === month
																	)?.value
																).toLocaleString()}
															{:else}
																-
															{/if}
														</td>
													{/each}
													<td class="text-center font-semibold">
														{#if usageData[0].values.length > 0}
															{#if data.evaluationIndicators[service.category as keyof typeof data.evaluationIndicators].aggregate === 'sum'}
																<!--TODO: Indicator does not need to be number-->
																{Number(
																	usageData[0].values.reduce(
																		(sum: number, v: { value: number }) => sum + Number(v.value),
																		0
																	)
																).toLocaleString()}
															{:else if data.evaluationIndicators[service.category as keyof typeof data.evaluationIndicators].aggregate === 'avg'}
																<!--TODO: Indicator does not need to be number-->
																{Number(
																	(
																		usageData[0].values.reduce(
																			(sum: number, v: { value: number }) => sum + Number(v.value),
																			0
																		) / usageData[0].values.length
																	).toFixed(2)
																).toLocaleString()}
															{:else if data.evaluationIndicators[service.category as keyof typeof data.evaluationIndicators].aggregate === 'min'}
																<!--TODO: Indicator does not need to be number-->
																{Math.min(
																	...usageData[0].values.map((v: { value: number }) =>
																		Number(v.value)
																	)
																).toLocaleString()}
															{:else if data.evaluationIndicators[service.category as keyof typeof data.evaluationIndicators].aggregate === 'max'}
																<!--TODO: Indicator does not need to be number-->
																{Math.max(
																	...usageData[0].values.map((v: { value: number }) =>
																		Number(v.value)
																	)
																).toLocaleString()}
															{:else}
																-
															{/if}
														{:else}
															-
														{/if}
													</td>
												</tr>
											{:else}
												<tr>
													<td>
														<div>
															<div class="font-bold">{service.name}</div>
															<div class="text-sm opacity-50">{service.category}</div>
														</div>
													</td>
													<td colspan="12" class="text-center text-gray-500"
														>No KPI measurements available</td
													>
													<td class="text-center">-</td>
												</tr>
											{/if}
										{:catch error}
											<tr>
												<td colspan="14" class="text-center text-red-500">
													Error loading KPI measurements: {error.message}
												</td>
											</tr>
										{/await}
									{:else}
										<tr>
											<td colspan="14" class="text-center text-gray-500"
												>No evaluation indicator configured for {service.category}</td
											>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</section>
				</div>
			{:else}
				<div class="mx-auto mt-8 w-2/3 text-center">
					<p>No services found for {selectedConsortium}.</p>
				</div>
			{/if}
		{/if}
	{:catch error}
		<p>Error loading services: {error.message}</p>
	{/await}
{/if}
