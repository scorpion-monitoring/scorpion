<script lang="ts">
	import type { Core } from 'cytoscape';
	import { onDestroy, onMount } from 'svelte';
	// @ts-ignore
	import cola from 'cytoscape-cola';
	import cytoscape from 'cytoscape';
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import {
		mdiCog,
		mdiCircleMedium,
		mdiMagnifyPlus,
		mdiMagnifyMinus,
		mdiGraphOutline
	} from '@mdi/js';

	cytoscape.use(cola);

	let { data } = $props();

	let container: HTMLDivElement;
	let cyInstance: Core | null = null;
	let colorSchemeQuery: MediaQueryList | null = null;
	let colorSchemeListener: ((event: MediaQueryListEvent) => void) | null = null;

	function getPalette(isDark: boolean) {
		if (isDark) {
			return {
				text: '#e2e8f0',
				nodeBase: '#334155',
				nodeBorder: '#475569',
				nodeCategory: '#166534',
				nodeService: '#1e3a8a',
				nodeProvider: '#78350f',
				nodeConsortium: '#4c1d95',
				nodeIndicator: '#881337',
				edgeBase: '#64748b',
				edgeServiceCategory: '#22c55e',
				edgeProviderService: '#f59e0b',
				edgeConsortiumService: '#a78bfa',
				edgeIndicatorService: '#fb7185',
				edgeCategoryIndicator: '#34d399'
			};
		}

		return {
			text: '#334155',
			nodeBase: '#dbeafe',
			nodeBorder: '#f8fafc',
			nodeCategory: '#bbf7d0',
			nodeService: '#bfdbfe',
			nodeProvider: '#fde68a',
			nodeConsortium: '#ddd6fe',
			nodeIndicator: '#fecdd3',
			edgeBase: '#cbd5e1',
			edgeServiceCategory: '#86efac',
			edgeProviderService: '#fde68a',
			edgeConsortiumService: '#c4b5fd',
			edgeIndicatorService: '#fda4af',
			edgeCategoryIndicator: '#6ee7b7'
		};
	}

	function buildStyles(isDark: boolean): any[] {
		const palette = getPalette(isDark);

		return [
			{
				selector: 'node',
				style: {
					label: 'data(label)',
					'text-valign': 'center',
					'text-halign': 'center',
					'text-wrap': 'wrap',
					'text-max-width': '120px',
					'font-size': 11,
					color: palette.text,
					'background-color': palette.nodeBase,
					width: 26,
					height: 26,
					'border-width': 1,
					'border-color': palette.nodeBorder
				}
			},
			{
				selector: 'node[id ^= "cat"]',
				style: {
					'background-color': palette.nodeCategory,
					shape: 'round-rectangle',
					width: 48,
					height: 30,
					'font-weight': 'bold'
				}
			},
			{
				selector: 'node[id ^= "ser"]',
				style: {
					'background-color': palette.nodeService,
					shape: 'ellipse',
					width: 34,
					height: 34
				}
			},
			{
				selector: 'node[id ^= "pro"]',
				style: {
					'background-color': palette.nodeProvider,
					shape: 'diamond',
					width: 30,
					height: 30
				}
			},
			{
				selector: 'node[id ^= "con"]',
				style: {
					'background-color': palette.nodeConsortium,
					shape: 'hexagon',
					width: 34,
					height: 34
				}
			},
			{
				selector: 'node[id ^= "ind"]',
				style: {
					'background-color': palette.nodeIndicator,
					shape: 'round-diamond',
					width: 32,
					height: 32
				}
			},
			{
				selector: 'edge',
				style: {
					width: 1.8,
					'curve-style': 'bezier',
					'line-color': palette.edgeBase,
					'target-arrow-shape': 'triangle',
					'target-arrow-color': palette.edgeBase,
					opacity: 0.8
				}
			},
			{
				selector: 'edge[id ^= "ser"][id *= "-cat"]',
				style: {
					'line-color': palette.edgeServiceCategory,
					'target-arrow-color': palette.edgeServiceCategory,
					width: 2.4
				}
			},
			{
				selector: 'edge[id ^= "pro"][id *= "-ser"]',
				style: {
					'line-color': palette.edgeProviderService,
					'target-arrow-color': palette.edgeProviderService,
					width: 2.2
				}
			},
			{
				selector: 'edge[id ^= "con"][id *= "-ser"]',
				style: {
					'line-color': palette.edgeConsortiumService,
					'target-arrow-color': palette.edgeConsortiumService,
					width: 2.2
				}
			},
			{
				selector: 'edge[id ^= "ind"][id *= "-ser"]',
				style: {
					'line-color': palette.edgeIndicatorService,
					'target-arrow-color': palette.edgeIndicatorService,
					width: 2.2
				}
			},
			{
				selector: 'edge[id ^= "cat"][id *= "-ind"]',
				style: {
					'line-color': palette.edgeCategoryIndicator,
					'target-arrow-color': palette.edgeCategoryIndicator,
					width: 2,
					'line-style': 'dashed'
				}
			}
		];
	}

	function resetZoom() {
		if (!cyInstance) return;
		cyInstance.fit(cyInstance.elements(), 40);
	}

	function zoom(direction: boolean) {
		if (!cyInstance) return;
		const zoomFactor = direction ? 1.2 : 0.8;
		const currentZoom = cyInstance.zoom();
		const newZoom = currentZoom * zoomFactor;
		cyInstance.zoom(newZoom);
	}

	onMount(async () => {
		const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

		const elements = [
			...data.services.map((service: { id: number; name: string }) => ({
				data: { id: `ser${service.id}`, label: service.name }
			})),
			...data.categories.map((category: { id: number; name: string }) => ({
				data: { id: `cat${category.id}`, label: category.name }
			})),
			...data.services.map((service: { category: number; id: number }) => ({
				data: {
					id: `ser${service.id}-cat${service.category}`,
					source: `cat${service.category}`,
					target: `ser${service.id}`
				}
			})),
			...data.providers.map((provider: { id: number; name: string }) => ({
				data: { id: `pro${provider.id}`, label: provider.name }
			})),
			...data.providerToServices.map((mapping: { providerId: number; serviceId: number }) => ({
				data: {
					id: `pro${mapping.providerId}-ser${mapping.serviceId}`,
					source: `ser${mapping.serviceId}`,
					target: `pro${mapping.providerId}`
				}
			})),
			...data.consortia.map((consortium: { id: number; name: string }) => ({
				data: { id: `con${consortium.id}`, label: consortium.name }
			})),
			...data.consortiumToServices.map((mapping: { consortiumId: number; serviceId: number|null }) => ({
				data: {
					id: `con${mapping.consortiumId}-ser${mapping.serviceId}`,
					source: `ser${mapping.serviceId}`,
					target: `con${mapping.consortiumId}`
				}
			})),
			...data.indicators.map((indicator: { id: number; name: string }) => ({
				data: { id: `ind${indicator.id}`, label: indicator.name }
			})),
			...data.serviceToIndicators.map((mapping: { indicatorId: number; serviceId: number }) => ({
				data: {
					id: `ind${mapping.indicatorId}-ser${mapping.serviceId}`,
					source: `ser${mapping.serviceId}`,
					target: `ind${mapping.indicatorId}`
				}
			})),
			...data.categoryToIndicators.map((mapping: { categoryId: number; indicatorId: number }) => ({
				data: {
					id: `cat${mapping.categoryId}-ind${mapping.indicatorId}`,
					source: `cat${mapping.categoryId}`,
					target: `ind${mapping.indicatorId}`
				}
			}))
		];

		cyInstance = cytoscape({
			container,
			elements: elements,
			style: buildStyles(isDark) as any
		});

		colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
		colorSchemeListener = (event: MediaQueryListEvent) => {
			if (!cyInstance) return;
			cyInstance.style(buildStyles(event.matches) as any);
		};
		colorSchemeQuery.addEventListener('change', colorSchemeListener);

		cyInstance.layout({ name: 'cola' }).run();
	});

	onDestroy(() => {
		if (colorSchemeQuery && colorSchemeListener) {
			colorSchemeQuery.removeEventListener('change', colorSchemeListener);
		}
		colorSchemeQuery = null;
		colorSchemeListener = null;
		cyInstance?.destroy();
		cyInstance = null;
	});
</script>

<div class="relative h-[85vh] w-full">
	<div class="fab fab-flower">
		<!-- a focusable div with tabindex is necessary to work on all browsers. role="button" is necessary for accessibility -->
		<div tabindex="0" role="button" class="btn btn-circle btn-lg btn-primary">
			<SvgIcon type="mdi" path={mdiCog} />
		</div>

		<!-- Main Action button replaces the original button when FAB is open -->
		<button class="fab-main-action btn btn-circle btn-lg">
			<SvgIcon type="mdi" path={mdiCog} />
		</button>

		<!-- buttons that show up when FAB is open -->
		<button
			type="button"
			class="btn btn-circle border-base-content/70 btn-outline btn-lg"
			onclick={() => zoom(true)}
		>
			<SvgIcon class="text-base-content/70" type="mdi" path={mdiMagnifyPlus} />
		</button>
		<button
			type="button"
			class="btn btn-circle border-base-content/70 btn-outline btn-lg"
			onclick={() => zoom(false)}
		>
			<SvgIcon class="text-base-content/70" type="mdi" path={mdiMagnifyMinus} />
		</button>
		<button
			type="button"
			class="btn btn-circle border-base-content/70 btn-outline btn-lg"
			onclick={resetZoom}
		>
			<SvgIcon class="text-base-content/70" type="mdi" path={mdiCircleMedium} />
		</button>
		<button
			type="button"
			class="btn btn-circle border-base-content/70 btn-outline btn-lg"
			onclick={() => cyInstance?.layout({ name: 'cola' }).run()}
		>
			<SvgIcon class="text-base-content/70" type="mdi" path={mdiGraphOutline} />
		</button>
	</div>

	<div id="container" class="h-full w-full" bind:this={container}></div>
</div>
