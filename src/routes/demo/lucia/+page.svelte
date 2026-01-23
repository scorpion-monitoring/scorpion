<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-base-200 p-6">
	<div class="card w-full max-w-2xl bg-base-100 shadow-xl">
		<div class="card-body">
			<div class="flex items-center gap-4">
				<div class="avatar">
					<div
						class="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-content"
					>
						{data.user.username?.[0]?.toUpperCase() ?? 'U'}
					</div>
				</div>
				<div>
					<h1 class="text-2xl font-semibold">Hi, {data.user.username}!</h1>
					<p class="text-sm text-base-content/70">
						Your user ID is <span class="font-mono">{data.user.id}</span>.
					</p>
				</div>
			</div>

			<pre class="mt-4 overflow-auto rounded-lg bg-base-200 p-3 text-sm">{JSON.stringify(
					data.user,
					null,
					2
				)}</pre>

			<form method="post" action="?/logout" use:enhance class="mt-4 card-actions justify-end">
				<button type="submit" class="btn btn-primary">Sign out</button>
			</form>
		</div>
	</div>
</div>
