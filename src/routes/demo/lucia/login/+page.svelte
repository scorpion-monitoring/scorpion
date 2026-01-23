<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-base-200 p-6">
	<div class="card w-full max-w-md shadow-xl">
		<div class="card-body">
			<h2 class="card-title">Login / Register</h2>

			<form method="post" action="?/login" use:enhance class="space-y-4">
				<div>
					<label for="username" class="label">
						<span class="label-text">Username</span>
					</label>
					<input id="username" name="username" class="input-bordered input w-full" />
				</div>

				<div>
					<label for="password" class="label">
						<span class="label-text">Password</span>
					</label>
					<input
						id="password"
						type="password"
						name="password"
						class="input-bordered input w-full"
					/>
				</div>

				<div class="flex justify-end gap-2">
					<button type="submit" class="btn btn-primary">Login</button>
					<button type="submit" formaction="?/register" class="btn btn-outline">Register</button>
				</div>
			</form>

			{#if form?.message}
				<div class="mt-4 alert alert-error">
					<div>
						<span>{form.message}</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
