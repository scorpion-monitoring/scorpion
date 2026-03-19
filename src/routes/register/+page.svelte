<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import type { ActionData } from './$types';
	import light_background from '$lib/assets/scorpion-light-background.png';
	import dark_background from '$lib/assets/scorpion-dark-background.png';
	import { onMount } from 'svelte';

	let { form, data }: { form: ActionData & { message?: string }; data: any } = $props();

	let prefersDark = $state(false);

	onMount(() => {
		if (!data.allowLocal) {
			goto(resolve('/login'));
		}
	});

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

<div
	class="flex min-h-screen items-center justify-center bg-base-300 p-6"
	style="background-image: url({prefersDark
		? dark_background
		: light_background}); background-size: 40% auto; background-repeat: no-repeat; background-position: 0% 25%;"
>
	<div class="card w-full max-w-lg bg-base-100 shadow-xl">
		<div class="card-body">
			<!-- <h2 class="card-title mb-6">Login / Register</h2> -->
			<div class="flex gap-4">
				<!-- Login Form -->
				<form method="post" action="?/register" use:enhance class="h-fit w-full space-y-4">
					<div>
						<label for="username" class="label">
							<span class="label-text">Username</span>
						</label>
						<input id="username" name="username" class="input-bordered input w-full" />
					</div>

					<div>
						<label for="email" class="label">
							<span class="label-text">Email</span>
						</label>
						<input id="email" name="email" class="input-bordered input w-full" />
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

					<div>
						<label for="repeat" class="label">
							<span class="label-text">Repeat Password</span>
						</label>
						<input id="repeat" type="password" name="repeat" class="input-bordered input w-full" />
					</div>

					<button type="submit" class="btn w-full btn-primary">Register</button>
					<a href={resolve('/login')} class="float-right link"> Login </a>
				</form>
			</div>

			{#if form?.message}
				<div class="mt-6 alert alert-error">
					<span>{form.message}</span>
				</div>
			{/if}
		</div>
	</div>
</div>
