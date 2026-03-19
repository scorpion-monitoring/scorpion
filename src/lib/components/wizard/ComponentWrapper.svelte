<script>
	export let component;
	export let jsonPath = undefined;
	export let componentConfig = {};

	import { serviceObj } from '../../../lib/service';

	let value;

	if (jsonPath && serviceObj.keyed) {
		if (jsonPath === '.') {
			value = serviceObj;
		} else {
			value = serviceObj.keyed(jsonPath);
		}
	}
</script>

<svelte:component this={component} bind:value={$value} {jsonPath} {componentConfig} />
