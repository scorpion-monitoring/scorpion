<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	let {
		traces = $bindable(),
		layout = {
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
			}
		},
		config = {}
	} = $props();

	$effect(() => {
		updatePlot(traces);
	});

	const id = 'chart-' + Math.floor(Math.random() * 1000000);

	async function updatePlot(data: any[]) {
		// @ts-ignore
		const Plotly = (await import('plotly.js-dist')) as any;
		const plotLayout = {
			...layout,
			legend: {
				...(layout?.legend ?? {}),
				itemclick: false,
				itemdoubleclick: false
			}
		};
		Plotly.newPlot(id, data, plotLayout, config);
		return;
	}

	async function resizePlot() {
		// @ts-ignore
		const Plotly = (await import('plotly.js-dist')) as any;
		Plotly.Plots.resize(document.getElementById(id));
		return;
	}

	function handleResize() {
		resizePlot();
	}

	onMount(async () => {
		await updatePlot(traces);
		if (typeof window !== 'undefined') {
			window.addEventListener('resize', handleResize);
		}
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('resize', handleResize);
		}
	});
</script>

<div {id} class="h-full min-h-[45vh] w-full bg-base-100"></div>
