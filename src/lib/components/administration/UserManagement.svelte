<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { User } from '$lib/openapi/schemas';
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon';
	import { mdiClose } from '@mdi/js';

	let users: Array<User> = $state([]);

	onMount(async () => {
		const response = await fetch(resolve('/api/users'));
		if (response.ok) {
			users = (await response.json()).users;
		} else {
			console.error('Failed to fetch users');
			console.error(await response.text());
		}
		return;
	});

	let selected: User | null = $state(null);
	let user_providers: Array<{ abbreviation: string; name: string; approved: boolean }> = $state([]);

	function selectUser(user: User) {
		user_providers = [];
		selected = user;
		for (const provider of user.providers ?? []) {
			user_providers.push({ ...provider });
		}
	}

	async function approveRequest(approval: boolean) {
		if (!selected) return;
		const response = await fetch(resolve(`/api/users/${selected.id}/approval`), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ approved: approval, role: selected.role })
		});
		if (response.ok) {
			if (approval) {
				selected.approved = approval;
				selected.role = (await response.json()).role;
			} else {
				users = users.filter((u) => u.id !== selected?.id);
				selected = null;
			}
		} else {
			console.error('Failed to update user approval');
			console.error(await response.text());
		}
	}

	async function save() {
		if (!selected) return;
		const response = await fetch(resolve(`/api/users/${selected.id}`), {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ role: selected.role, providers: user_providers })
		});
		if (response.ok) {
			selected.providers = (await response.json()).providers;
			selected = null;
		} else {
			console.error('Failed to save user changes');
			console.error(await response.text());
		}
	}
</script>

<section class="flex space-x-2">
	<div class={selected ? 'w-2/3' : 'w-full'}>
		<table class="table">
			<thead>
				<tr>
					<th>Name</th>
					<th>Providers</th>
					<th>Role</th>
				</tr>
			</thead>
			<tbody>
				{#each users as user}
					<tr
						class="hover:cursor-pointer hover:bg-primary/10 {user.approved
							? 'text-base-content'
							: 'text-base-content/50'}"
						onclick={() => selectUser(user)}
					>
						<td>
							{user.username}
							{#if user.providers?.find((p) => !p.approved) || user.approved === false}
								<div class="status animate-bounce status-info"></div>
							{/if}
						</td>
						<td class="space-x-1">
							{#each user.providers as provider}
								{#if provider.approved}
									<span class="badge badge-primary">{provider.abbreviation}</span>
								{:else}
									<span class="badge badge-ghost">{provider.abbreviation}</span>
								{/if}
							{/each}
						</td>
						<td>
							{user.role}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if selected}
		<div
			class="w-1/3 border-l pl-4"
			style="border-left-color: color-mix(in oklab, var(--color-base-content) 10%, transparent);"
		>
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-bold">User Details</h2>
				<button class="btn btn-square btn-sm hover:btn-error" onclick={() => (selected = null)}>
					<SvgIcon type="mdi" path={mdiClose} /></button
				>
			</div>
			<div class="ml-4">
				<p><strong>Name:</strong> {selected.username}</p>
				<p><strong>ID:</strong> {selected.id}</p>
				<p><strong>Email:</strong> {selected.email}</p>
				<div>
					<strong>Role:</strong>
					<div>
						<input type="radio" id="User" hidden value="User" bind:group={selected.role} />
						<input type="radio" id="Reviewer" hidden value="Reviewer" bind:group={selected.role} />
						<input type="radio" id="Admin" hidden value="Admin" bind:group={selected.role} />
						<label
							for="User"
							class="btn mr-2 btn-sm {selected.role === 'User' ? 'btn-primary' : 'btn-ghost'}"
							>User</label
						>
						<label
							for="Reviewer"
							class="btn mr-2 btn-sm {selected.role === 'Reviewer' ? 'btn-primary' : 'btn-ghost'}"
							>Reviewer</label
						>
						<label
							for="Admin"
							class="btn btn-sm {selected.role === 'Admin' ? 'btn-primary' : 'btn-ghost'}"
							>Admin</label
						>
					</div>
				</div>
				{#if selected.approved}
					<p class="mt-4"><strong>Service Providers:</strong></p>
					<ul class="mt-2 space-y-2">
						{#each user_providers as provider}
							<li class="flex items-center space-x-2">
								<input
									class="checkbox rounded-2xl checkbox-sm"
									type="checkbox"
									bind:checked={provider.approved}
								/>
								<span>{provider.name} ({provider.abbreviation})</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			{#if selected.approved}
				<button class="btn mt-6 w-full btn-primary" onclick={save}>Save Changes</button>
			{:else}
				<button class="btn mt-6 w-full btn-success" onclick={() => approveRequest(true)}
					>Approve</button
				>
				<button class="btn mt-6 w-full btn-error" onclick={() => approveRequest(false)}
					>Reject</button
				>
			{/if}
		</div>
	{/if}
</section>
