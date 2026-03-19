<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData } from './$types';
	import light_background from '$lib/assets/scorpion-light-background.png';
	import dark_background from '$lib/assets/scorpion-dark-background.png';

	async function handleLogin(provider: {
		Name: string;
		'Client ID': string;
		'Specification URL': string;
	}) {
		window.location.href = resolve('/login/oidc/start') + `?provider=${provider.Name}`;
	}

	let { form, data }: { form: ActionData & { message?: string }; data: any } = $props();

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

<div
	class="flex min-h-screen items-center justify-center bg-base-300 p-6"
	style="background-image: url({prefersDark
		? dark_background
		: light_background}); background-size: 40% auto; background-repeat: no-repeat; background-position: 0% 25%;"
>
	<div class="card w-full {data.allowLocal && data.oidc_providers.length > 0 ? 'max-w-2xl' : 'max-w-96'} bg-base-100 shadow-xl">
		<div class="card-body">
			<!-- <h2 class="card-title mb-6">Login / Register</h2> -->
			<div class="flex gap-4">
				<!-- Login Form -->
				{#if data.allowLocal}
					<form method="post" action="?/login" use:enhance class="h-fit {data.oidc_providers.length > 0 ? 'w-1/2' : 'w-full'} space-y-4">
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

						<button type="submit" class="btn w-full btn-primary">Login</button>
						<a href={resolve('/register')} class="float-right link"> Register </a>
					</form>
				{/if}

				{#if data.oidc_providers.length > 0 && data.allowLocal}
					<div class="divider divider-horizontal">OR</div>
				{/if}

				{#if data.oidc_providers.length > 0}
					<div class="flex {data.allowLocal ? 'w-1/2' : 'w-full'} items-center justify-center">
						{#if data.oidc_providers.length === 1}
						{#if data.oidc_providers[0]['Display Icon']} <!-- If the single provider has a display icon, show it as a button -->
							<button
								class="hover:cursor-pointer"
								onclick={() => handleLogin(data.oidc_providers[0])}
							>
								<img
									class={data.allowLocal ? 'w-full' : 'mx-auto w-1/2'}
									src={data.oidc_providers[0]['Display Icon']}
									alt={data.oidc_providers[0]['Name']}
								/>
							</button>
							{:else} <!-- Otherwise, show a regular button with the provider's name -->
							<button
								class="btn w-full btn-outline"
								onclick={() => handleLogin(data.oidc_providers[0])}
							>
								{data.oidc_providers[0].Name}
							</button>
						{/if}
						{:else}
							<div class="grid grid-cols-2">
								{#each data.oidc_providers as provider}
								{#if provider['Display Icon']} <!-- Only show providers with a display icon -->
									<button class="hover:cursor-pointer" onclick={() => handleLogin(provider)}>
										<img class="w-full" src={provider['Display Icon']} alt={provider['Name']} />
									</button>
									{:else}
									<button
										class="btn w-full btn-outline"
										onclick={() => handleLogin(provider)}
									>
										{provider.Name}
									</button>
								{/if}
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>

			{#if form?.message}
				<div class="mt-6 alert alert-error">
					<span>{form.message}</span>
				</div>
			{/if}
		</div>
	</div>
</div>
