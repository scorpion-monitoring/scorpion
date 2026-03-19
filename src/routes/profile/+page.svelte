<script lang="ts">
	import type { User } from '$lib/openapi/schemas';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import { mdiContentCopy } from '@mdi/js';

	let { data }: PageProps = $props();
	const pageSize: number = 5;
	let groupPage: number = $state(0);
	let userGroupPage: number = $state(0);

	// svelte-ignore state_referenced_locally
	let tokens: {
		id: number;
		name: string | null;
		created: string | null;
		lastUsed: string | null;
	}[] = $state(data.tokens ?? []);
	let generatedTokenName: string = $state('');
	let generatedTokenValue: string = $state('');

	let groupSearch: string = $state('');

	let user: User | undefined = $state();

	onMount(() => {
		const u = data?.user;
		if (!u) {
			user = undefined;
			return;
		}
		user = {
			...u,
			id: u.id ?? '',
			username: u.username ?? '',
			email: u.email ?? '',
			bio: u.bio ?? '',
			icon: u.icon ?? '',
			providers: (u.providers ?? []) as any
		} as User;
	});

	function isMember(group: { id: number; abbreviation: string; name: string; members: number }) {
		return (
			user &&
			user.providers &&
			user.providers.some(
				(p: { approved: boolean; abbreviation: string; name: string }) =>
					p.abbreviation === group.abbreviation
			)
		);
	}

	function addGroup(group: { id: number; abbreviation: string; name: string; members: number }) {
		if (user && user.providers) {
			user.providers.push({ abbreviation: group.abbreviation, name: group.name, approved: false });
		}
		saveUser();
	}

	function removeGroup(ug: { abbreviation: string; name: string; approved?: boolean }) {
		if (user && user.providers) {
			const idx = user.providers.findIndex((p: any) => p.abbreviation === ug.abbreviation);
			if (idx !== -1) {
				user.providers.splice(idx, 1);
			}
		}
		saveUser();
	}

	async function saveUser() {
		const response = await fetch(resolve(`/api/users/${user?.id}`), {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(user)
		});
		if (!response.ok) {
			console.error('Failed to save user');
		}
		return;
	}

	async function generateToken(name: string) {
		const response = await fetch(resolve(`/api/users/${user?.id}/tokens`), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ name })
		});
		if (response.ok) {
			const token = await response.json();
			generatedTokenValue = token.secret;
			tokens.push({
				id: token.id,
				name: token.name,
				created: token.createdAt,
				lastUsed: null
			});
		} else {
			console.error('Failed to generate token');
		}
	}

	async function revokeToken(tokenId: number) {
		const response = await fetch(resolve(`/api/users/${user?.id}/tokens?token=${tokenId}`), {
			method: 'DELETE'
		});
		if (!response.ok) {
			console.error('Failed to revoke token');
			return;
		}
		tokens = tokens.filter((t) => t.id !== tokenId);
	}

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text);
	}

	function updateIcon(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			const reader = new FileReader();
			reader.onload = (e) => {
				if (user) {
					user.icon = e.target?.result as string;
				}
			};
			reader.readAsDataURL(target.files[0]);
		}
	}

	function removeIcon() {
		if (user) {
			user.icon = '';
		}
	}
</script>

{#if user}
	<div class="p-6 lg:p-12">
		<div class="grid gap-6 lg:grid-cols-3">
			<!-- Profile Card -->
			<div class="card bg-base-200 p-6 shadow-xl">
				<div class="flex items-center gap-4">
					<div class="relative">
						<button
							type="button"
							class="avatar cursor-pointer border-0 bg-transparent p-0 transition-opacity hover:opacity-75"
							onclick={() => document.getElementById('icon-upload')?.click()}
							title="Click to change icon"
						>
							{#if user.icon}
								<div class="w-20 rounded-full">
									<img src={user.icon} alt="User Avatar" />
								</div>
							{:else}
								<div
									class="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-2xl font-bold text-base-100"
								>
									{(user.username || '').trim().charAt(0).toUpperCase()}
								</div>
							{/if}
						</button>
						{#if user.icon}
							<button
								class="btn absolute -top-2 -right-2 btn-circle btn-xs btn-error"
								onclick={removeIcon}
								title="Remove icon"
							>
								×
							</button>
						{/if}
					</div>
					<input
						id="icon-upload"
						type="file"
						class="hidden"
						accept="image/png, image/jpeg, image/svg+xml"
						onchange={updateIcon}
					/>
					<div>
						<div class="text-xl font-semibold">{user.username}</div>
						<div class="text-sm opacity-70">{user.email}</div>
						<div class="mt-1 badge badge-outline text-xs">{user.role}</div>
					</div>
				</div>

				<div class="mt-6">
					<label for="username" class="label">
						<span class="label-text">Full name</span>
					</label>
					<input id="username" class="input-bordered input w-full" bind:value={user.username} />
					<label for="email" class="label mt-3">
						<span class="label-text">Email</span>
					</label>
					<input id="email" class="input-bordered input w-full" bind:value={user.email} />
					<label for="bio" class="label mt-3">
						<span class="label-text">Bio</span>
					</label>
					<textarea
						id="bio"
						class="textarea-bordered textarea w-full"
						rows="3"
						bind:value={user.bio}
					></textarea>

					<div class="mt-4 flex justify-end">
						<button class="btn btn-primary" onclick={saveUser}>Save</button>
					</div>
				</div>
			</div>

			<!-- Groups -->
			<div class="card bg-base-200 p-6 shadow-xl lg:col-span-2">
				<div class="flex items-center justify-between">
					<h3 class="text-lg font-semibold">Group Membership</h3>
					<div class="text-sm opacity-60">Manage which groups the user belongs to</div>
				</div>

				<div class="mt-4 grid gap-4 md:grid-cols-2">
					<div>
						<h4 class="font-medium">Available Groups</h4>
						<div class="mt-2 space-y-2">
							<div>
								<input
									type="text"
									placeholder="Search groups..."
									class="input-bordered input input-sm w-full"
									bind:value={groupSearch}
								/>
							</div>
							{#each (data.providers ?? []).filter((p) => {
								const q = (groupSearch || '').trim().toLowerCase();
								return q === '' || (p.name || '')
										.toLowerCase()
										.includes(q) || (p.abbreviation || '').toLowerCase().includes(q);
							}) as g, i}
								{#if i >= groupPage * pageSize && i < (groupPage + 1) * pageSize}
									<div class="flex items-center justify-between rounded-md bg-base-100 p-3">
										<div class="flex items-center gap-3">
											<div>
												<div class="font-medium">{g.name}</div>
												<div class="text-xs opacity-60">Members: {g.members}</div>
											</div>
										</div>
										<div class="flex items-center gap-2">
											{#if !isMember(g)}
												<button class="btn btn-ghost btn-sm" onclick={() => addGroup(g)}>Add</button
												>
											{/if}
										</div>
									</div>
								{/if}
							{/each}
							<div class="flex justify-between space-x-2">
								<button
									class="btn btn-sm"
									onclick={() => (groupPage = Math.max(groupPage - 1, 0))}
									disabled={groupPage === 0}>Previous</button
								>
								<span
									>Page {groupPage + 1} / {Math.ceil(
										(data.providers ?? []).filter((p) => {
											const q = (groupSearch || '').trim().toLowerCase();
											return (
												q === '' ||
												(p.name || '').toLowerCase().includes(q) ||
												(p.abbreviation || '').toLowerCase().includes(q)
											);
										}).length / pageSize
									)}</span
								>
								<button
									class="btn btn-sm"
									onclick={() => (groupPage = groupPage + 1)}
									disabled={(groupPage + 1) * pageSize >=
										(data.providers ?? []).filter((p) => {
											const q = (groupSearch || '').trim().toLowerCase();
											return (
												q === '' ||
												(p.name || '').toLowerCase().includes(q) ||
												(p.abbreviation || '').toLowerCase().includes(q)
											);
										}).length}>Next</button
								>
							</div>
							{#if data.providers && data.providers.length === 0}
								<div class="text-sm opacity-60">No groups available.</div>
							{/if}
						</div>
					</div>

					<div>
						<h4 class="font-medium">User's Groups</h4>
						<div class="mt-2 space-y-2">
							{#each user.providers as ug, i}
								{#if i >= userGroupPage * pageSize && i < (userGroupPage + 1) * pageSize}
									<div class="flex items-center justify-between rounded-md bg-base-100 p-3">
										<div class="flex items-center gap-3">
											<div
												class="flex h-8 w-8 items-center justify-center rounded-full bg-secondary font-bold text-white"
											>
												{ug.abbreviation}
											</div>
											<div>
												<div class="font-medium">{ug.name}</div>
												<div
													class="badge badge-outline badge-xs {ug.approved
														? 'badge-info'
														: 'badge-ghost'}"
												>
													Status: {ug.approved ? 'Member' : 'Pending'}
												</div>
											</div>
										</div>
										<div>
											<button class="btn btn-ghost btn-sm" onclick={() => removeGroup(ug)}
												>Remove</button
											>
										</div>
									</div>
								{/if}
							{/each}
							<div class="flex justify-between space-x-2">
								<button
									class="btn btn-sm"
									onclick={() => (groupPage = Math.max(groupPage - 1, 0))}
									disabled={groupPage === 0}>Previous</button
								>
								<span
									>Page {groupPage + 1} / {Math.ceil(
										(data.providers ?? []).filter((p) => {
											const q = (groupSearch || '').trim().toLowerCase();
											return (
												q === '' ||
												(p.name || '').toLowerCase().includes(q) ||
												(p.abbreviation || '').toLowerCase().includes(q)
											);
										}).length / pageSize
									)}</span
								>
								<button
									class="btn btn-sm"
									onclick={() => (groupPage = groupPage + 1)}
									disabled={(groupPage + 1) * pageSize >=
										(data.providers ?? []).filter((p) => {
											const q = (groupSearch || '').trim().toLowerCase();
											return (
												q === '' ||
												(p.name || '').toLowerCase().includes(q) ||
												(p.abbreviation || '').toLowerCase().includes(q)
											);
										}).length}>Next</button
								>
							</div>
							{#if user.providers?.length === 0}
								<div class="text-sm opacity-60">User is not a member of any groups.</div>
							{/if}
						</div>
					</div>
				</div>

				<!-- API Tokens -->
				<div class="mt-6 border-t pt-6">
					<div class="flex items-center justify-between">
						<div>
							<h4 class="font-medium">API Tokens</h4>
							<div class="text-sm opacity-60">Create, rotate or revoke personal access tokens.</div>
						</div>
						<div class="flex items-center gap-2">
							<input
								id="newtokname"
								class="input-bordered input input-sm"
								placeholder="Token name"
								bind:value={generatedTokenName}
							/>
							<button
								class="btn btn-sm btn-primary"
								onclick={() => generateToken(generatedTokenName)}>Generate Token</button
							>
						</div>
					</div>
					<div class="mt-1">
						{#if generatedTokenValue}
							<button
								class="border border-dashed border-warning bg-warning/10 p-1 font-mono text-sm text-warning-content"
								onclick={() => copyToClipboard(generatedTokenValue)}
							>
								{generatedTokenValue}
								<SvgIcon
									type="mdi"
									path={mdiContentCopy}
									class="ml-1 inline-block h-4 w-4 hover:cursor-pointer"
								/>
							</button>
							<div class="mt-1 text-sm opacity-60">
								Note: This token will only be shown once. Make sure to copy and store it securely.
							</div>
						{/if}
					</div>

					<div class="mt-4 space-y-3">
						{#if tokens.length === 0}
							<div class="text-sm opacity-60">No API tokens yet.</div>
						{/if}
						<table class="table w-full">
							<tbody>
								{#each tokens as t}
									<tr>
										<td>
											<div class="font-medium">{t.name}</div>
											<div class="text-xs opacity-60">
												Created: {new Date(t.created || 0).toLocaleString()}
											</div>
										</td>
										<td>
											<div class="flex flex-col text-xs opacity-60">
												<span class="font-bold">Last Used:</span>
												<span>{t.lastUsed ? new Date(t.lastUsed).toLocaleString() : 'Never'}</span>
											</div>
										</td>
										<td class="text-right">
											<button class="btn btn-sm btn-error" onclick={() => revokeToken(t.id)}
												>Revoke</button
											>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
