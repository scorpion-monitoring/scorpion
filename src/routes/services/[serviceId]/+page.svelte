<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import {
		mdiLockOpen,
		mdiLock,
		mdiPlus,
		mdiMinus,
		mdiFloppy,
		mdiChevronLeft,
		mdiChevronRight
	} from '@mdi/js';

	let { data, params }: PageProps = $props();
	let doi: string = $state('');
	let publicationPage = $state(0);
	let publicationPageSize = $state(5);

	let publications: {
		id?: number;
		doi: string;
		title: string | null;
		authors: string | null;
		serviceId: number | null;
		publicationDate: string | null;
	}[] = $state([]);

	async function addPublication() {
		const doiMatch = doi.split('doi.org/').pop()?.trim();

		const response = await fetch(`https://doi.org/${doiMatch}`, {
			headers: {
				Accept: 'application/vnd.citationstyles.csl+json'
			}
		});
		if (!response.ok) {
			alert('Error retrieving publication metadata. Please check the DOI and try again.');
			return;
		} else {
			const body = await response.json();
			const addResponse = await fetch(resolve('/api/publications'), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					doi: doiMatch,
					title: body.title,
					authors: body.author
						.map((a: { given: string; family: string }) => `${a.given} ${a.family}`)
						.join(', '),
					publicationDate: body.issued['date-parts'][0].join('-'),
					serviceId: params.serviceId
				})
			});
			doi = '';
			if (addResponse.ok) {
				const newPublication = (await addResponse.json())['publication'];
				publications = [...publications, newPublication];
			}
		}
	}

	let service:
		| {
				abbreviation: string;
				name: string;
				category: string;
				provider: string;
				consortia: string[];
				stage: string;
				icon?: string;
		  }
		| undefined = $state();
	let indicators: { name: string; necessity: string }[] = $state([]);

	let editMode: boolean = $state(false);
	let changes: boolean = $state(false);

	onMount(async () => {
		await refresh();
		return;
	});

	function removeItem(name: string) {
		if (service) {
			service.consortia = service.consortia.filter((c: string) => c !== name);
			changes = true;
		}
	}

	function addItem(consortium: { abbreviation: string; name: string }) {
		if (service) {
			service.consortia = [...service.consortia, consortium.name];
			changes = true;
		}
	}

	function removeIndicator(name: string) {
		indicators = indicators.filter((i) => i.name !== name);
		changes = true;
	}

	function addIndicator(name: string) {
		indicators = [...indicators, { name, necessity: 'additional' }].sort((a, b) =>
			a.name.localeCompare(b.name)
		);
		changes = true;
	}

	function updateIcon(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files[0] && service) {
			const reader = new FileReader();
			reader.onload = (e) => {
				if (service) {
					service.icon = e.target?.result as string;
					changes = true;
				}
			};
			reader.readAsDataURL(target.files[0]);
		}
	}

	function removeIcon() {
		if (service) {
			service.icon = '';
			changes = true;
		}
	}

	async function updateIndicators() {
		if (service) {
			let response = await fetch(resolve(`/api/categories/${service.category}`));
			const indicatorsData = await response.json();
			indicators = indicatorsData.category.indicators.sort(
				(a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
			);
			changes = true;
		}
	}

	async function refresh() {
		let response = await fetch(resolve(`/api/services/${params.serviceId}`));
		const data = await response.json();
		service = data.service;
		response = await fetch(resolve('/api/indicators') + `?serviceId=${params.serviceId}`);
		const indicatorsData = await response.json();
		indicators = indicatorsData.indicators;
	}

	async function cancel() {
		editMode = false;
		changes = false;
		await refresh();
		return;
	}

	async function save() {
		const response = await fetch(resolve(`/api/services/${params.serviceId}`), {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				service,
				indicators
			})
		});
		if (response.ok) {
			goto(resolve(`/services/${service?.abbreviation}`));
		} else {
			alert('Error saving service');
		}

		changes = false;
		editMode = false;
		return;
	}
</script>

{#if service}
	<section class="mx-auto w-2/3 p-4">
		<div class="breadcrumbs text-sm">
			<ul>
				<li><button onclick={() => goto(resolve('/services'))}>Services</button></li>
				<li>{service?.name}</li>
			</ul>
		</div>
		<div class="flex items-center justify-between">
			<h1 class="mb-4 text-2xl font-bold">{service?.name}</h1>
			{#if Array.isArray(data.userProviders) && data.userProviders.find((p: { abbreviation: string }) => p.abbreviation === service?.provider)}
				<div>
					{#if editMode}
						{#if changes}
							<button class="btn mr-2 btn-sm btn-primary" onclick={save}>
								<SvgIcon type="mdi" path={mdiFloppy} class="mr-1 h-4 w-4" />
								Save Changes
							</button>
						{/if}
						<button class="btn btn-sm btn-secondary" onclick={cancel}>
							<SvgIcon type="mdi" path={mdiLockOpen} class="mr-1 h-4 w-4" />
							Stop Editing
						</button>
					{:else}
						<button class="btn btn-sm btn-secondary" onclick={() => (editMode = true)}>
							<SvgIcon type="mdi" path={mdiLock} class="mr-1 h-4 w-4" />
							Edit Service
						</button>
					{/if}
				</div>
			{/if}
		</div>
		<table class="table w-full">
			<tbody>
				<tr>
					<th>Icon</th>
					<td>
						{#if editMode}
							<div class="space-y-2">
								{#if service.icon}
									<div class="flex items-center gap-3">
										<div class="avatar">
											<div class="h-12 w-12 rounded">
												<img src={service.icon} alt="Service Icon" />
											</div>
										</div>
										<button class="btn btn-sm btn-error" onclick={removeIcon}>Remove</button>
									</div>
								{/if}
								<input
									type="file"
									class="file-input w-full"
									accept="image/png, image/jpeg, image/svg+xml"
									onchange={updateIcon}
								/>
							</div>
						{:else if service?.icon}
							<div class="avatar">
								<div class="h-12 w-12 rounded">
									<img src={service.icon} alt="Service Icon" />
								</div>
							</div>
						{:else}
							<span class="opacity-60">No icon</span>
						{/if}
					</td>
				</tr>
				<tr>
					<th>Name</th>
					<td>
						{#if editMode}
							<input
								type="text"
								class="input w-full"
								bind:value={service.name}
								onchange={() => (changes = true)}
							/>
						{:else}
							<span>{service?.name}</span>
						{/if}
					</td>
				</tr>
				<tr>
					<th>Abbreviation</th>
					<td>
						{#if editMode}
							<input
								type="text"
								class="input w-full"
								bind:value={service.abbreviation}
								onchange={() => (changes = true)}
							/>
						{:else}
							<span>{service?.abbreviation}</span>
						{/if}
					</td>
				</tr>
				<tr>
					<th>Lifecycle Stage</th>
					<td>
						{#if editMode}
							<select
								class="select w-full"
								bind:value={service.stage}
								onchange={() => (changes = true)}
							>
								<option value="DEV">Development</option>
								<option value="DEMO">Demonstrator</option>
								<option value="PROD">Production</option>
							</select>
						{:else}
							<span>
								{#if service.stage === 'DEV'}
									Development
								{:else if service.stage === 'DEMO'}
									Demonstrator
								{:else if service.stage === 'PROD'}
									Production
								{:else}
									{service.stage}
								{/if}
							</span>
						{/if}
					</td>
				</tr>
				<tr>
					<th>Provider</th>
					<td>
						{#if editMode}
							<select
								class="select w-full"
								bind:value={service.provider}
								onchange={() => (changes = true)}
							>
								{#if Array.isArray(data?.userProviders)}
									{#each data.userProviders as provider}
										<option value={provider.abbreviation}>{provider.name}</option>
									{/each}
								{/if}
							</select>
						{:else if Array.isArray(data?.providers)}
							<span
								>{data.providers.find(
									(provider: { abbreviation: string }) =>
										provider.abbreviation === service?.provider
								)?.name}</span
							>
						{/if}
					</td>
				</tr>
				<tr>
					<th class="align-top">Consortia</th>
					<td>
						{#if editMode}
							<ul
								class="rounded-md border"
								style="border-color: color-mix(in oklab, var(--color-base-content) 20%, #0000);"
							>
								{#each data.consortia as consortium}
									<li class="m-1 flex items-center justify-between rounded p-2 hover:bg-primary/10">
										<span>{consortium.name}</span>
										{#if service.consortia.find((c: string) => c === consortium.name)}
											<button
												class="btn btn-circle btn-xs btn-error"
												aria-label="Remove"
												onclick={() => removeItem(consortium.name)}
											>
												<SvgIcon type="mdi" path={mdiMinus} class="h-4 w-4" />
											</button>
										{:else}
											<button
												class="btn btn-circle btn-xs btn-success"
												aria-label="Add"
												onclick={() => addItem(consortium)}
											>
												<SvgIcon type="mdi" path={mdiPlus} class="h-4 w-4" />
											</button>
										{/if}
									</li>
								{/each}
							</ul>
						{:else}
							<ul class="list">
								{#each service.consortia as consortium}
									<li>{consortium}</li>
								{/each}
							</ul>
						{/if}
					</td>
				</tr>
				<tr>
					<th>Category</th>
					<td>
						{#if editMode}
							<select
								class="select w-full"
								bind:value={service.category}
								onchange={updateIndicators}
							>
								{#if Array.isArray(data?.categories)}
									{#each data.categories as category}
										<option value={category.name}>{category.name}</option>
									{/each}
								{/if}
							</select>
						{:else}
							<span>{service?.category}</span>
						{/if}
					</td>
				</tr>
				<tr>
					<th class="align-top">Service KPI Set</th>
					<td>
						{#if editMode}
							<table class="table w-full">
								<thead>
									<tr>
										<th>Indicator Name</th>
										<th>Necessity</th>
										<th></th>
									</tr>
								</thead>
								<tbody>
									{#each indicators as indicator}
										<tr>
											<td>{indicator.name}</td>
											<td>
												{#if indicator.necessity === 'additional'}
													optional
												{:else}
													{indicator.necessity}
												{/if}
											</td>
											<td>
												<button
													class="btn btn-circle btn-xs btn-error"
													aria-label="Remove"
													disabled={indicator.necessity != 'additional'}
													onclick={() => removeIndicator(indicator.name)}
												>
													<SvgIcon type="mdi" path={mdiMinus} class="h-4 w-4" />
												</button>
											</td>
										</tr>
									{/each}
									{#each data.indicators.filter((ind: { name: string }) => !indicators.find((i) => i.name === ind.name)) as ind}
										<tr>
											<td>{ind.name}</td>
											<td>optional</td>
											<td>
												{#if true}
													<button
														class="btn btn-circle btn-xs btn-success"
														aria-label="Add"
														onclick={() => addIndicator(ind.name)}
													>
														<SvgIcon type="mdi" path={mdiPlus} class="h-4 w-4" />
													</button>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{:else}
							<table class="table w-full">
								<thead>
									<tr>
										<th>Indicator Name</th>
										<th>Necessity</th>
									</tr>
								</thead>
								<tbody>
									{#each indicators as indicator}
										<tr>
											<td>{indicator.name}</td>
											<td>
												{#if indicator.necessity === 'additional'}
													optional
												{:else}
													{indicator.necessity}
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
					</td>
				</tr>
				<tr>
					<th class="align-top">Publications</th>
					<td>
						{#if editMode}
							<div class="join w-full">
								<input class="input join-item w-full" bind:value={doi} />
								<button class="btn join-item btn-primary" onclick={addPublication}>
									<SvgIcon type="mdi" path={mdiPlus} class="mr-1 h-4 w-4" />
									Add Publication
								</button>
							</div>
						{/if}
						<table class="table w-full">
							<tbody>
								{#each [...data.publications, ...publications].sort((a, b) => {
									const dateA = a.publicationDate || '';
									const dateB = b.publicationDate || '';
									return dateA.localeCompare(dateB);
								}) as publication, i}
									{#if i >= publicationPage * publicationPageSize && i < (publicationPage + 1) * publicationPageSize}
										<tr>
											<td>
												<a href={`https://doi.org/${publication.doi}`} target="_blank" class="link">
													{publication.title || publication.doi}
												</a>
												{#if publication.authors}
													<div class="text-sm text-base-content/50">{publication.authors}</div>
												{/if}
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
							<tfoot>
								<tr>
									<td>
										{#if [...data.publications, ...publications].length > 0}
											<div class="flex items-center justify-between">
												<button
													disabled={publicationPage <= 0}
													class="btn btn-ghost"
													onclick={() => publicationPage--}
												>
													<SvgIcon type="mdi" path={mdiChevronLeft} />
												</button>
												<span
													>Page {publicationPage + 1} / {Math.ceil(
														[...data.publications, ...publications].length / publicationPageSize
													)}</span
												>
												<button
													disabled={publicationPage >=
														Math.ceil(
															[...data.publications, ...publications].length / publicationPageSize
														) -
															1}
													class="btn btn-ghost"
													onclick={() => publicationPage++}
												>
													<SvgIcon type="mdi" path={mdiChevronRight} />
												</button>
											</div>
										{:else}
											<span class="font-semibold text-base-content/50">No publications found.</span>
										{/if}
									</td>
								</tr>
							</tfoot>
						</table>
					</td>
				</tr>
			</tbody>
		</table>
	</section>
{/if}
