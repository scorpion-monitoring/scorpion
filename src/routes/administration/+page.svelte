<script lang="ts">
	import type { PageProps } from './$types';
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon';
	import {
		mdiAccountGroup,
		mdiTune,
		mdiPoll,
		mdiTextBoxOutline,
		mdiHomeGroup,
		mdiRadar,
		mdiBullhornVariant
	} from '@mdi/js';
	import IndicatorManagement from '$lib/components/administration/IndicatorManagement.svelte';
	import UserManagement from '$lib/components/administration/UserManagement.svelte';
	import SettingsManagement from '$lib/components/administration/SettingsManagement.svelte';
	import GroupManagement from '$lib/components/administration/GroupManagement.svelte';
	import MaturityModelManagement from '$lib/components/administration/MaturityModelManagement.svelte';
	import Logs from '$lib/components/administration/Logs.svelte';
	import Announcements from '$lib/components/administration/Announcements.svelte';

	let { data }: PageProps = $props();

	const menuItems = [
		'users',
		'groups',
		'indicators',
		'maturity',
		'announcements',
		'settings',
		'logs'
	];
	const headlines: Record<string, string> = {
		users: 'User Management',
		indicators: 'KPI Framework',
		groups: 'Group Management',
		maturity: 'Maturity Model',
		settings: 'Settings',
		logs: 'Logs',
		announcements: 'Announcements'
	};

	const icons = {
		users: mdiAccountGroup,
		indicators: mdiPoll,
		groups: mdiHomeGroup,
		maturity: mdiRadar,
		settings: mdiTune,
		logs: mdiTextBoxOutline,
		announcements: mdiBullhornVariant
	};

	let active:
		| 'users'
		| 'indicators'
		| 'groups'
		| 'maturity'
		| 'settings'
		| 'logs'
		| 'announcements' = $state('users');
	let extended: boolean = $state(false);
</script>

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
			<div class="px-4">
				<h1 class="text-xl font-bold">{headlines[active]}</h1>
			</div>
		</nav>
		<div class="p-4">
			{#if active === 'users'}
				<UserManagement />
			{:else if active === 'indicators'}
				<IndicatorManagement />
			{:else if active === 'groups'}
				<GroupManagement />
			{:else if active === 'settings'}
				<SettingsManagement />
			{:else if active === 'logs'}
				<Logs />
			{:else if active === 'maturity'}
				<MaturityModelManagement />
			{:else if active === 'announcements'}
				<Announcements />
			{/if}
		</div>
	</div>

	<div class="drawer-side is-drawer-close:overflow-visible">
		<label for="my-drawer-4" aria-label="close sidebar" class="drawer-overlay"></label>
		<div
			class="flex min-h-full flex-col items-start bg-base-200 is-drawer-close:w-14 is-drawer-open:w-64"
		>
			<ul class="menu w-full grow">
				{#each menuItems as item}
					<li>
						<button
							class="is-drawer-close:tooltip is-drawer-close:tooltip-right {active === item
								? 'bg-accent text-accent-content'
								: ''}"
							data-tip={headlines[item]}
							onclick={() => (active = item as typeof active)}
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
