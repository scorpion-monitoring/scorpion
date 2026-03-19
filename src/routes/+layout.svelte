<script lang="ts">
	import './layout.css';
	import light_favicon from '$lib/assets/scorpion-light-favicon.png';
	import dark_favicon from '$lib/assets/scorpion-dark-favicon.png';
	import Header from '$lib/components/layout/Header.svelte';
	import Footer from '$lib/components/layout/Footer.svelte';

	import { page } from '$app/state';

	let { children } = $props();

	let prefersDark = $state(false);

	$effect(() => {
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		prefersDark = mediaQuery.matches;

		const handleChange = (e: { matches: boolean }) => {
			prefersDark = e.matches;
		};

		mediaQuery.addEventListener('change', handleChange);

		return () => {
			mediaQuery.removeEventListener('change', handleChange);
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={prefersDark ? dark_favicon : light_favicon} />
	<title>Scorpion</title>
</svelte:head>

<main class="min-h-svh">
	{#if page.data.user}
		<Header bind:prefersdark={prefersDark} user={page.data.user} />
	{/if}
	{@render children()}
</main>
<Footer />
