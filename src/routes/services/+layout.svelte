<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon';
	import {
		mdiFormatListText,
		mdiChartBar,
		mdiInvoiceTextSend,
		mdiListBox,
		mdiGraphOutline
	} from '@mdi/js';
	import { onMount } from 'svelte';

	let { children } = $props();

	const menuItems = ['services', 'submission', 'evaluation', 'network'];
	const headlines: Record<string, string> = {
		services: 'Service Management',
		submission: 'Data Submission',
		evaluation: 'Service Evaluation',
		network: 'Network Visualization',
		applications: 'Onboarding Applications'
	};
	const icons = {
		services: mdiFormatListText,
		submission: mdiInvoiceTextSend,
		evaluation: mdiChartBar,
		network: mdiGraphOutline,
		applications: mdiListBox
	};
	const routes: Record<
		'services' | 'submission' | 'evaluation' | 'network' | 'applications',
		string
	> = {
		services: '/services',
		submission: '/services/submit',
		evaluation: '/services/evaluate',
		network: '/services/network',
		applications: '/services/applications'
	};

	let active: 'services' | 'submission' | 'evaluation' | 'network' | 'applications' | undefined =
		$state();

	onMount(async () => {
		const pathname = window.location.pathname;
		if (pathname.endsWith('/submit')) {
			active = 'submission';
		} else if (pathname.endsWith('/evaluate')) {
			active = 'evaluation';
		} else if (pathname.includes('/services')) {
			active = 'services';
		} else if (pathname.includes('/network')) {
			active = 'network';
		} else if (pathname.includes('/applications')) {
			active = 'applications';
		}
	});

	let extended: boolean = $state(false);

	function changePath(item: string) {
		// @ts-ignore
		goto(resolve(routes[item as keyof typeof routes]));
		active = item as typeof active;
	}
</script>

{#if page.route.id === '/services/onboarding'}
	{@render children()}
{:else if active}
	<div class="drawer z-0 lg:drawer-open">
		<input id="my-drawer-4" type="checkbox" class="drawer-toggle" bind:checked={extended} />
		<div class="drawer-content">
			<!-- Navbar -->
			<nav class="navbar w-full bg-base-300">
				<label for="my-drawer-4" aria-label="open sidebar" class="btn btn-square btn-ghost">
					{#if extended}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							stroke-linejoin="round"
							stroke-linecap="round"
							stroke-width="2"
							fill="none"
							stroke="currentColor"
							class="my-1.5 inline-block size-4"
							><path
								d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"
							></path><path d="M15 4v16"></path><path d="M10 10l-2 2l2 2"></path></svg
						>
					{:else}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							stroke-linejoin="round"
							stroke-linecap="round"
							stroke-width="2"
							fill="none"
							stroke="currentColor"
							class="my-1.5 inline-block size-4"
							><path
								d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"
							></path><path d="M9 4v16"></path><path d="M14 10l2 2l-2 2"></path></svg
						>
					{/if}
				</label>
				<div class="px-4">{headlines[active]}</div>
			</nav>
			<!-- Page content here -->
			{@render children()}
		</div>

		<div class="drawer-side is-drawer-close:overflow-visible">
			<label for="my-drawer-4" aria-label="close sidebar" class="drawer-overlay"></label>
			<div
				class="flex min-h-full flex-col items-start bg-base-200 is-drawer-close:w-14 is-drawer-open:w-64"
			>
				<!-- Sidebar content here -->
				<ul class="menu w-full grow">
					{#each menuItems as item}
						<li>
							<button
								class="is-drawer-close:tooltip is-drawer-close:tooltip-right {active === item
									? 'bg-accent text-accent-content'
									: ''}"
								data-tip={headlines[item]}
								onclick={() => changePath(item)}
							>
								<SvgIcon
									type="mdi"
									path={icons[item as typeof active]}
									class="my-1.5 inline-block size-4"
								/>
								<span class="is-drawer-close:hidden">{headlines[item]}</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		</div>
	</div>
{/if}
