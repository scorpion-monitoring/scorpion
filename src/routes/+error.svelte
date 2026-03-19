<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import { mdiInformation } from '@mdi/js';
</script>

<div class="flex min-h-screen items-center justify-center p-6">
	<div
		class="bg-opacity-80 w-full max-w-4xl overflow-hidden rounded-2xl border border-base-200 bg-base-100 shadow-2xl"
	>
		<div class="flex flex-col md:flex-row">
			<div class="flex items-center justify-center bg-primary/10 p-8 md:w-48">
				<SvgIcon type="mdi" path={mdiInformation} class="h-24 w-24" />
			</div>

			<div class="flex-1 p-8">
				<div class="flex items-start justify-between">
					<div>
						<div class="flex items-baseline gap-4 text-4xl font-extrabold md:text-5xl">
							<span class="text-primary">{page.status ?? 'Error'}</span>
							<span class="text-2xl">Something went wrong</span>
						</div>
						<p class="mt-3">
							{page.error?.message ?? 'An unexpected error occurred.'}
						</p>
					</div>
				</div>

				<div class="mt-6 flex flex-wrap gap-3">
					<button class="btn btn-primary" onclick={() => goto(resolve('/'))}>Go home</button>
				</div>
			</div>
		</div>
	</div>
</div>
