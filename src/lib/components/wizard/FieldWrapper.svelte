<script>
	export let component;
	export let field;
	export let jsonPath = undefined;

	import { serviceObj } from '../../../lib/service';

	let value;

	if (jsonPath && serviceObj.keyed) {
		value = serviceObj.keyed(jsonPath);
	}
</script>

<svelte:component
	this={component}
	bind:value={$value}
	showLabel={true}
	label={field.label}
	mapping={field.mapping}
	attr={field.explanation}
	componentConfig={field.componentConfig}
/>
