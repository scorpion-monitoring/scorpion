<script lang="ts">
	import systemAnnouncement from '$lib/assets/system-announcement.png';
	import reviewerAnnouncement from '$lib/assets/reviewer-announcement.png';
	import UserSettingsModal from '$lib/components/modal/forms/UserSettingsModal.svelte';
	import Modal from '$lib/components/modal/Modal.svelte';
	import { resolve } from '$app/paths';
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import {
		mdiChevronDown,
		mdiChevronLeft,
		mdiChevronRight,
		mdiInformationSlabCircle
	} from '@mdi/js';
	import type { PageData } from './$types';
	import Chart from '$lib/components/visualization/Chart.svelte';
	import { createPDFReport } from '$lib/pdf-export';
	import ComplexChart from '$lib/components/visualization/ComplexChart.svelte';

	let { data }: { data: PageData } = $props();

	// Mock data and simple helpers
	const ranges: string[] = ['3mo', '6mo', '1y', '2y', 'all'];
	let filters: string[] = ['All', 'Bibliographic', 'Usage', 'Technical', 'Satisfaction'];

	// svelte-ignore state_referenced_locally
	let mapScores = $state(data.mapeScores || []);
	// svelte-ignore state_referenced_locally
	let traces = $state(data.traces || []);
	// svelte-ignore state_referenced_locally
	let selectedService: string = $state(
		data.userSettings?.service || data.services?.[0]?.abbreviation || ''
	);
	// svelte-ignore state_referenced_locally
	let dateRange: string = $state(data.userSettings?.duration || ranges[0]);
	// svelte-ignore state_referenced_locally
	let activeFilter: string = $state(data.userSettings?.filter || filters[0]);
	// svelte-ignore state_referenced_locally
	let cards = $state(data.cards || []);

	function timeAgo(date: string): string {
		const now = new Date();
		const past = new Date(date);
		const diffMs = now.getTime() - past.getTime();

		const seconds = Math.floor(diffMs / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);
		const weeks = Math.floor(days / 7);
		const months = Math.floor(days / 30);
		const years = Math.floor(days / 365);

		if (seconds < 60) return 'Just now';
		if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
		if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
		if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
		if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
		if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
		return `${years} year${years === 1 ? '' : 's'} ago`;
	}

	let announcementPage = $state(0);
	let announcementPageSize = $state(2);

	function closeSettings() {
		(document.getElementById('user-settings-modal') as HTMLDialogElement)?.close();
		location.reload();
	}

	function setRange(r: string) {
		dateRange = r;
		refreshDashboard();
	}

	function setFilter(f: string) {
		activeFilter = f;
		refreshDashboard();
	}

	async function refreshDashboard() {
		const searchParams = new URLSearchParams({
			service: selectedService,
			duration: dateRange,
			filter: activeFilter
		});
		const response = await fetch(
			resolve('/api/measurements/dashboard') + '?' + searchParams.toString()
		);
		const data = await response.json();
		cardPage = 0;
		cards = data.cards;
		traces = data.traces;
		mapScores = data.mapeScores;
	}

	function polyPoints(values: number[], w = 120, h = 30): string {
		const max = Math.max(...values);
		const min = Math.min(...values);
		const len = values.length;
		const step = len > 1 ? w / (len - 1) : w;
		return values
			.map((v: number, i: number) => {
				const x = (i * step).toFixed(2);
				const y = (h - ((v - min) / (max - min || 1)) * h).toFixed(2);
				return `${x},${y}`;
			})
			.join(' ');
	}

	async function exportToCSV() {
		let csvContent = 'data:text/csv;charset=utf-8,';
		csvContent += `KPI,${traces[0].x.join(',')}\n`;
		for (const trace of traces) {
			csvContent += `${trace.name},${trace.y.join(',')}\n`;
		}
		const encodedUri = encodeURI(csvContent);
		const link = document.createElement('a');
		link.setAttribute('href', encodedUri);
		link.setAttribute('download', `dashboard_${selectedService}_${dateRange}_${activeFilter}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	}

	async function exportToPDF() {
		const pdfBytes = await createPDFReport(traces, cards, mapScores, {
			service: data.services?.find((s) => s.abbreviation === selectedService)?.name ?? '',
			dateRange,
			activeFilter
		});
		// Download the PDF
		// @ts-ignore
		const blob = new Blob([pdfBytes], { type: 'application/pdf' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `dashboard_${selectedService}_${dateRange}_${activeFilter}.pdf`;
		a.click();
		URL.revokeObjectURL(url);
		return;
	}

	let cardPage = $state(0);
	let cardPageSize = $state(4);

	let traceOffset = $state(0);
	let traceLimit = $state(5);
</script>

<div class="space-y-6 p-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold">
				Home - {data.services?.find((s) => s.abbreviation === selectedService)?.name ?? ''}
			</h1>
			<p class="mt-1 text-sm text-base-content/60">Overview of key performance indicators</p>
		</div>

		<div class="flex items-center gap-3">
			<div class="join">
				{#each ranges as r}
					<button
						class="btn join-item btn-sm"
						class:text-accent-content={dateRange === r}
						class:btn-accent={dateRange === r}
						onclick={() => setRange(r)}>{r}</button
					>
				{/each}
			</div>

			<!-- Service select added -->
			<div class="flex items-center gap-2">
				<label for="service-select" class="text-sm text-base-content/70">Service</label>
				<select
					id="service-select"
					class="select select-sm"
					bind:value={selectedService}
					onchange={refreshDashboard}
				>
					{#each data.services as s}
						<option value={s.abbreviation}>{s.name}</option>
					{/each}
				</select>
			</div>

			<div class="dropdown dropdown-end">
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<span tabindex="0" class="btn btn-ghost btn-sm"
					>Export
					<SvgIcon type="mdi" path={mdiChevronDown} class="ml-1 h-4 w-4" />
				</span>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<ul tabindex="0" class="dropdown-content menu w-40 rounded-box bg-base-100 p-2 shadow">
					<li><button onclick={exportToCSV}>CSV</button></li>
					<li>
						<button onclick={exportToPDF}
							>PDF <span class="badge badge-outline badge-xs badge-info">Beta</span></button
						>
					</li>
				</ul>
			</div>
		</div>
	</div>

	<!-- Filters -->
	<div class="join">
		{#each filters as f}
			<button
				class="btn join-item btn-sm"
				class:text-accent-content={activeFilter === f}
				class:btn-accent={activeFilter === f}
				onclick={() => setFilter(f)}>{f}</button
			>
		{/each}
	</div>

	<!-- Main grid -->
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
		<!-- Left: KPIs and chart (span 2) -->
		<div class="space-y-6 lg:col-span-2">
			<!-- KPI Cards -->
			{#if cards.length === 0}
				<div class="card bg-base-100 shadow">
					<div class="card-body p-4">
						<div
							class="flex h-32 w-full items-center justify-center rounded-md bg-base-200 text-base-content/40"
						>
							No data available for the selected settings.
						</div>
					</div>
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					{#each cards as card, i}
						{#if i >= cardPage * cardPageSize && i < (cardPage + 1) * cardPageSize}
							<div class="card bg-base-100 shadow">
								<div class="card-body p-4">
									<div class="flex items-start justify-between gap-3">
										<div>
											<h3 class="text-sm text-base-content/70">{card.title}</h3>
											<div class="text-2xl font-semibold">
												{(() => {
													const v = card.value;
													if (typeof v === 'number') return new Intl.NumberFormat().format(v);
													const s = String(v);
													const m = s.match(/-?\d+([.,]\d+)?/);
													if (!m) return s;
													const num = Number(m[0].replace(',', '.'));
													return s.replace(m[0], new Intl.NumberFormat().format(num));
												})()}
											</div>
											<div class="mt-1 text-xs">
												<span class={card.change >= 0 ? 'text-success' : 'text-error'}>
													{card.change >= 0 ? '▲' : '▼'}
													{Math.abs(card.change ?? 0).toFixed(1)}%
												</span>
												<span class="ml-2 text-base-content/50">vs last {dateRange}</span>
											</div>
										</div>
										<div class="h-10 w-28">
											<svg viewBox="0 0 120 30" class="h-full w-full">
												<polyline
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													class="text-base-content/40"
													points={polyPoints(card.trend)}
												/>
											</svg>
										</div>
									</div>
								</div>
							</div>
						{/if}
					{/each}
					<div class="col-span-2 flex w-full items-center justify-center space-x-4">
						<button
							class="btn btn-sm"
							onclick={() => (cardPage = Math.max(cardPage - 1, 0))}
							disabled={cardPage === 0}>Previous</button
						>
						<span>Page {cardPage + 1} / {Math.ceil(cards!.length / cardPageSize)}</span>
						<button
							class="btn btn-sm"
							onclick={() => (cardPage = cardPage + 1)}
							disabled={(cardPage + 1) * cardPageSize >= cards!.length}>Next</button
						>
					</div>
				</div>
			{/if}
			<!-- Big chart / trends -->
			<div class="card bg-base-100 shadow">
				<div class="card-body p-4">
					<div class="mb-3 flex items-center justify-between">
						<h3 class="font-semibold">Trends</h3>
						<div class="text-sm text-base-content/50">
							Showing: {activeFilter} • {dateRange} • {selectedService}
						</div>
					</div>

					<div
						class="flex h-fit w-full items-center justify-center rounded-md text-base-content/40"
					>
						{#if traces.length === 0}
							<div
								class="flex h-32 w-full items-center justify-center rounded-md bg-base-200 text-base-content/40"
							>
								No data available for the selected settings.
							</div>
						{:else}
							<ComplexChart bind:traces />
						{/if}
					</div>

					<div class="mt-3 flex items-center gap-4">
						<button
							disabled={traceOffset === 0}
							class="btn btn-circle btn-xs"
							onclick={() => (traceOffset = Math.max(traceOffset - 1, 0))}
						>
							<SvgIcon type="mdi" path={mdiChevronLeft} class="h-4 w-4" />
						</button>
						{#each traces as trace, i}
							{#if i >= traceOffset && i < traceOffset + traceLimit}
								<div class="w-full rounded bg-base-200 p-2">
									<div class="text-xs text-base-content/50">Avg. {trace.name}</div>
									<div class="font-medium">
										{new Intl.NumberFormat(undefined, {
											minimumFractionDigits: 2,
											maximumFractionDigits: 2
										}).format(
											trace.y.length
												? trace.y.reduce((s: number, n: number) => s + (+n || 0), 0) /
														trace.y.length
												: 0
										)}
									</div>
								</div>
							{/if}
						{/each}
						<button
							disabled={traceOffset >= traces.length - traceLimit}
							class="btn btn-circle btn-xs"
							onclick={() => (traceOffset = Math.min(traceOffset + 1, traces.length - traceLimit))}
						>
							<SvgIcon type="mdi" path={mdiChevronRight} class="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>
		</div>

		<!-- Right sidebar -->
		<div class="space-y-6">
			<div class="card overflow-visible bg-base-100 shadow">
				<div class="card-body p-4">
					<div class="flex items-center justify-between">
						<h3 class="font-semibold">Announcements</h3>
					</div>

					<div class="mt-3 space-y-3">
						{#if data.announcements!.length === 0}
							<div
								class="flex h-16 w-full items-center justify-center rounded-md bg-base-200 text-base-content/40"
							>
								No announcements yet.
							</div>
						{:else}
							{#each data.announcements as a, i}
								{#if i >= announcementPage * announcementPageSize && i < (announcementPage + 1) * announcementPageSize}
									<div class="flex items-start gap-3">
										<div
											class="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-content"
										>
											{#if a.from === 'System'}
												<img src={systemAnnouncement} alt={a.from} />
											{:else if a.from === 'Reviewer'}
												<img src={reviewerAnnouncement} alt={a.from} />
											{:else}
												<span title={a.from}>{a.from[0].toUpperCase()}</span>
											{/if}
										</div>
										<div class="flex-1">
											<div class="text-sm font-medium">{a.title}</div>
											<div class="mt-1 text-xs text-base-content/50">{a.message}</div>
											<div class="mt-1 text-xs text-base-content/40">{timeAgo(a.date!)}</div>
										</div>
									</div>
								{/if}
							{/each}
							<div class="col-span-2 flex w-full items-center justify-center space-x-4">
								<button
									class="btn btn-circle btn-sm"
									onclick={() => (announcementPage = Math.max(announcementPage - 1, 0))}
									disabled={announcementPage === 0}
								>
									<SvgIcon type="mdi" path={mdiChevronLeft} class="h-4 w-4" /></button
								>
								<span
									>Page {announcementPage + 1} / {Math.ceil(
										data.announcements!.length / announcementPageSize
									)}</span
								>
								<button
									class="btn btn-circle btn-sm"
									onclick={() => (announcementPage = announcementPage + 1)}
									disabled={(announcementPage + 1) * announcementPageSize >=
										data.announcements!.length}
								>
									<SvgIcon type="mdi" path={mdiChevronRight} class="h-4 w-4" />
								</button>
							</div>
						{/if}
					</div>
				</div>
			</div>

			<div class="card bg-base-100 shadow">
				<div class="card-body p-4">
					<h3 class="flex items-center font-semibold">
						MAPE
						<span
							class="mr-2 cursor-help text-sm text-base-content/50"
							aria-label="MAPE tooltip"
							title="The Mean Absolute Percentage Error is a statistical technique that can help establish if a forecast is reliable."
						>
							<SvgIcon type="mdi" path={mdiInformationSlabCircle} class="h-4 w-4" />
						</span>
						Scores
					</h3>

					<div class="mt-3 space-y-3">
						{#each mapScores as mapScore}
							<div>
								<div class="text-sm">
									{mapScore.name}<span class="float-right text-xs text-base-content/50"
										>{(mapScore.value * 100).toFixed(2)}%</span
									>
								</div>
								<progress
									class="progress w-full"
									class:progress-success={mapScore.value < 0.4}
									class:progress-warning={mapScore.value >= 0.4 && mapScore.value < 0.8}
									class:progress-error={mapScore.value >= 0.8}
									value={mapScore.value * 100}
									max="100"
								></progress>
							</div>
						{/each}
					</div>
				</div>
			</div>

			<div class="card bg-base-100 shadow">
				<div class="card-body p-4">
					<h3 class="font-semibold">Quick Actions</h3>
					<div class="mt-3 flex flex-col gap-2">
						<button class="btn btn-sm" onclick={exportToPDF}
							>Create Report <span class="badge badge-outline badge-xs badge-info">Beta</span
							></button
						>
						<button
							class="btn btn-sm"
							onclick={() =>
								(document.getElementById('user-settings-modal') as HTMLDialogElement)?.showModal()}
							>Settings</button
						>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

<Modal id="user-settings-modal">
	<UserSettingsModal user={data.user} services={data.services} onclose={closeSettings} />
</Modal>
