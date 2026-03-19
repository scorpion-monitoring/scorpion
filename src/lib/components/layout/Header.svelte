<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import light_favicon from '$lib/assets/scorpion-light-favicon.png';
	import dark_favicon from '$lib/assets/scorpion-dark-favicon.png';
	import light_powered from '$lib/assets/scorpion-light-powered.png';
	import dark_powered from '$lib/assets/scorpion-dark-powered.png';
	import { onMount } from 'svelte';

	let { prefersdark = $bindable(), user } = $props();

	let config: any = $state({});

	onMount(async () => {
		const response = await fetch(resolve('/api/settings') + `?key=${'general'}`);
		if (response.ok) {
			config = (await response.json()).settings.general;
		}
	});

	async function logout() {
		const response = await fetch(resolve('/api/logout'));
		if (response.ok) {
			location.reload();
		}
	}

	let toggle = $state(false);
</script>

<div class="navbar border-b border-base-300 bg-base-200 shadow-lg">
	<div class="navbar-start space-x-1">
		<div class="drawer w-fit">
			<input id="my-drawer-1" type="checkbox" class="drawer-toggle" bind:checked={toggle} />
			<div class="drawer-content">
				<label
					for="my-drawer-1"
					class="drawer-button btn btn-square btn-ghost"
					aria-label="open sidebar"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 6h16M4 12h16M4 18h7"
						/>
					</svg>
				</label>
			</div>
			<div class="drawer-side">
				<label for="my-drawer-1" aria-label="close sidebar" class="drawer-overlay"></label>
				<ul class="menu min-h-full w-80 bg-base-200 p-4">
					<li>
						<button
							class="hover:bg-accent hover:text-accent-content"
							onclick={() => {
								goto(resolve('/services'));
								toggle = false;
							}}>Portfolio</button
						>
					</li>
					<li>
						<button
							class="hover:bg-accent hover:text-accent-content"
							onclick={() => {
								goto(resolve('/administration'));
								toggle = false;
							}}>Administration</button
						>
					</li>
				</ul>
			</div>
		</div>
		<button
			class="flex items-center space-x-2 text-xl font-semibold hover:cursor-pointer"
			onclick={() => goto(resolve('/'))}
		>
			{#if config && config.Name}
				<h1>{config?.Name}</h1>
				<img
					class="w-26"
					src={prefersdark ? dark_powered : light_powered}
					alt="Powered by Scorpion"
				/>
			{:else}
				<img class="w-10" src={prefersdark ? dark_favicon : light_favicon} alt="Scorpion Icon" />
				<span>Scorpion</span>
			{/if}
		</button>
	</div>
	<div class="navbar-end">
		<div class="dropdown dropdown-end">
			<div tabindex="0" role="button" class="btn avatar btn-circle btn-ghost">
				<div class="avatar">
					{#if user}
						{#if user.icon}
							<div class="w-8 rounded-full">
								<img src={user.icon} alt="User Avatar" />
							</div>
						{:else}
							<div
								class="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-lg font-bold text-base-100"
							>
								{(user.username || '').trim().charAt(0).toUpperCase()}
							</div>
						{/if}
					{/if}
				</div>
			</div>
			<ul
				tabindex="-1"
				class="dropdown-content menu z-10 mt-3 w-52 menu-sm rounded-box bg-base-100 p-2 shadow"
			>
				<li><button onclick={() => goto(resolve('/profile'))}>Profile</button></li>
				<li><button onclick={() => goto(resolve('/docs'))}>API Documentation</button></li>
				<li>
					<button class="hover:bg-error" onclick={logout}>Logout</button>
				</li>
			</ul>
		</div>
	</div>
</div>
