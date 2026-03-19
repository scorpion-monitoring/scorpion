<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-base-200 p-4">
	<div class="card w-full max-w-md bg-base-100 shadow-xl">
		<div class="card-body text-center">
			<h1 class="mb-4 card-title justify-center text-2xl">Pending Approval</h1>
			<p class="text-base-content/70">
				Thank you for logging in. Your account is awaiting administrator approval.
			</p>
			<p class="text-base-content/70">
				You'll be able to access the full application once approved. Please check back soon.
			</p>

			<div class="divider"></div>

			<details class="collapse-arrow collapse border border-base-300 bg-base-100">
				<summary class="collapse-title font-medium">User Information</summary>
				<div class="collapse-content">
					<ul class="space-y-2 text-start">
						{#each Object.keys(data.user!) as key}
							<li class="flex justify-between gap-4 rounded bg-base-200 p-2">
								<span class="font-semibold text-base-content/80">{key}:</span>
								<span class="break-all text-base-content/60"
									>{data.user![key as keyof typeof data.user]}</span
								>
							</li>
						{/each}
					</ul>
				</div>
			</details>
		</div>
	</div>
</div>
