<script lang="ts">
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import { mdiClose } from '@mdi/js';

	let { id = `modal_${Math.random().toString(36).slice(2, 9)}`, children } = $props();
</script>

<dialog {id} class="modal">
	<div class="modal-box w-5/6 max-w-3xl">
		<form method="dialog">
			<button class="btn absolute top-2 right-2 btn-circle btn-ghost btn-sm">
				<SvgIcon type="mdi" path={mdiClose} />
			</button>
		</form>
		{@render children()}
	</div>
	<form method="dialog" class="modal-backdrop">
		<button>close</button>
	</form>
</dialog>
