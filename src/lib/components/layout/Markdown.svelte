<script lang="ts">
	import { marked } from 'marked';
	import { onMount } from 'svelte';

	let { url = '' } = $props();

	let markdown: string = $state('');

	onMount(async () => {
		if (url) {
			const res = await fetch(url);
			if (res.ok) {
				const text = await res.text();
				markdown = await marked.parse(text);
			} else {
				console.error(`Failed to fetch markdown from ${url}: ${res.statusText}`);
			}
		}
	});

	function attachShadow(node: HTMLElement) {
		if (!node.shadowRoot) {
			const shadow = node.attachShadow({ mode: 'open' });
			while (node.firstChild) {
				shadow.appendChild(node.firstChild);
			}
		}
	}
</script>

<div use:attachShadow>
	{@html marked.parse(markdown)}
</div>
