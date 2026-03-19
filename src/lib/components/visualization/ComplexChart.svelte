<script lang="ts">
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import { mdiChevronDown } from '@mdi/js';
	import Chart from './Chart.svelte';

	let { traces = $bindable() } = $props();

	type IndicatorOption = {
		accumulate: boolean;
		hidden: boolean;
		useY2: boolean;
	};

	let indicatorOptions = $state<IndicatorOption[]>([]);
	let lastTraceSignature = '';
	let controlsOffset = $state(0);
	const controlsPageSize = 3;

	function defaultIndicatorOption(): IndicatorOption {
		return {
			accumulate: false,
			hidden: false,
			useY2: false
		};
	}

	$effect(() => {
		if (!Array.isArray(traces)) {
			indicatorOptions = [];
			lastTraceSignature = '';
			controlsOffset = 0;
			return;
		}

		const traceSignature = traces.map((trace: { name?: string }) => trace?.name ?? '').join('|');
		if (traceSignature !== lastTraceSignature) {
			indicatorOptions = traces.map(() => defaultIndicatorOption());
			lastTraceSignature = traceSignature;
			controlsOffset = 0;
		}

		const maxOffset = Math.max(traces.length - controlsPageSize, 0);
		if (controlsOffset > maxOffset) {
			controlsOffset = maxOffset;
		}
	});

	function toggleOption(index: number, optionKey: keyof IndicatorOption) {
		const current = indicatorOptions[index] ?? defaultIndicatorOption();
		indicatorOptions[index] = { ...current, [optionKey]: !current[optionKey] };
		indicatorOptions = [...indicatorOptions];
	}

	function accumulateValues(values: number[]): number[] {
		let runningTotal = 0;
		return values.map((value) => {
			console.log('Value:', value, 'Running Total Before:', runningTotal);
			runningTotal += value;
			return runningTotal;
		});
	}

	function previousTraceControls() {
		controlsOffset = Math.max(controlsOffset - 1, 0);
	}

	function nextTraceControls() {
		if (!Array.isArray(traces)) return;
		controlsOffset = Math.min(controlsOffset + 1, Math.max(traces.length - controlsPageSize, 0));
	}

	const visibleTraceControls = $derived.by(() => {
		if (!Array.isArray(traces)) return [];

		return traces
			.map((trace, index) => ({ trace, index }))
			.sort((a, b) => (a.trace?.name ?? '').localeCompare(b.trace?.name ?? ''))
			.slice(controlsOffset, controlsOffset + controlsPageSize);
	});

	const displayTraces = $derived.by(() => {
		if (!Array.isArray(traces)) {
			return [];
		}

		return traces.map((trace: { y?: number[]; name?: string }, index: number) => {
			const current = indicatorOptions[index] ?? defaultIndicatorOption();
			const numericValues = Array.isArray(trace?.y)
				? trace.y.map((value) => {
						const numericValue = Number(value);
						return Number.isFinite(numericValue) ? numericValue : 0;
					})
				: [];
			const isY2 = current.useY2;

			return {
				...trace,
				name: `${trace.name ?? ''}${isY2 ? ' (y2)' : ''}`,
				y: current.accumulate ? accumulateValues(numericValues) : numericValues,
				visible: current.hidden ? 'legendonly' : true,
				yaxis: isY2 ? 'y2' : 'y'
			};
		});
	});

	const layout = $derived.by(() => {
		const hasY2Trace = displayTraces.some((trace: { yaxis?: string }) => trace.yaxis === 'y2');

		return {
			paper_bgcolor: 'rgba(0,0,0,0)',
			plot_bgcolor: 'rgba(0,0,0,0)',
			xaxis: {
				color: '#808080',
				gridcolor: 'rgba(0,0,0,0.12)',
				zerolinecolor: 'rgba(0,0,0,0.20)'
			},
			yaxis: {
				color: '#808080',
				gridcolor: 'rgba(0,0,0,0.12)',
				zerolinecolor: 'rgba(0,0,0,0.20)'
			},
			...(hasY2Trace
				? {
						yaxis2: {
							title: 'y2',
							overlaying: 'y',
							side: 'right',
							showgrid: false,
							color: '#808080'
						}
					}
				: {})
		};
	});
</script>

<div class="w-full space-y-3">
	{#if Array.isArray(traces) && traces.length > 0}
		<div class="relative overflow-visible rounded-md bg-base-200 p-2">
			<div class="flex items-center gap-2">
				<button
					class="btn btn-circle btn-xs"
					onclick={previousTraceControls}
					disabled={controlsOffset === 0}
				>
					❮
				</button>
				<div class="flex flex-1 gap-2 overflow-visible py-1">
					{#each visibleTraceControls as { trace, index }}
						<div class="min-w-0 flex-1 rounded-md bg-base-100 p-1">
							<div class="dropdown w-full">
								<button class="btn w-full justify-between normal-case btn-ghost btn-sm">
									<span class="truncate text-left text-base-content">{trace.name}</span>
									<SvgIcon type="mdi" path={mdiChevronDown} class="h-4 w-4" />
								</button>
								<ul
									class="dropdown-content menu z-20 mt-1 w-full rounded-box bg-base-100 p-2 shadow"
								>
									<li>
										<label class="label cursor-pointer justify-start gap-2 px-2">
											<input
												type="checkbox"
												class="checkbox checkbox-xs"
												checked={indicatorOptions[index]?.accumulate ?? false}
												onchange={() => toggleOption(index, 'accumulate')}
											/>
											<span class="text-sm text-base-content">Toggle accumulation</span>
										</label>
									</li>
									<li>
										<label class="label cursor-pointer justify-start gap-2 px-2">
											<input
												type="checkbox"
												class="checkbox checkbox-xs"
												checked={indicatorOptions[index]?.hidden ?? false}
												onchange={() => toggleOption(index, 'hidden')}
											/>
											<span class="text-sm text-base-content">Hide trace</span>
										</label>
									</li>
									<li>
										<label class="label cursor-pointer justify-start gap-2 px-2">
											<input
												type="checkbox"
												class="checkbox checkbox-xs"
												checked={indicatorOptions[index]?.useY2 ?? false}
												onchange={() => toggleOption(index, 'useY2')}
											/>
											<span class="text-sm text-base-content">Move to y2</span>
										</label>
									</li>
								</ul>
							</div>
						</div>
					{/each}
				</div>
				<button
					class="btn btn-circle btn-xs"
					onclick={nextTraceControls}
					disabled={!Array.isArray(traces) ||
						controlsOffset >= Math.max(traces.length - controlsPageSize, 0)}
				>
					❯
				</button>
			</div>
		</div>
	{/if}
	<div class="h-full min-h-[45vh] w-full">
		<Chart traces={displayTraces} {layout} />
	</div>
</div>
