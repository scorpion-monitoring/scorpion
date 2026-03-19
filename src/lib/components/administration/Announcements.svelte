<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import Modal from '$lib/components/modal/Modal.svelte';
	import AnnouncementModal from '$lib/components/modal/forms/AnnouncementModal.svelte';
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon';
	import { mdiTrashCan } from '@mdi/js';

	type Announcement = {
		id: number;
		from: string;
		title: string;
		message: string;
		date: string;
	};

	let announcements: Array<Announcement> = [];

	onMount(async () => {
		await refresh();
	});

	async function refresh() {
		const response = await fetch(resolve('/api/announcements'));
		announcements = await response.json();
	}

	async function closeModal() {
		(document.getElementById('announcement') as HTMLDialogElement)?.close();
		await refresh();
	}

	async function deleteAnnouncement(i: number) {
		const response = await fetch(resolve('/api/announcements') + `?id=${i}`, {
			method: 'DELETE'
		});

		if (response.ok) {
			await refresh();
			console.log('Announcement deleted');
		} else {
			console.error(response);
		}
	}
</script>

<div class="flex w-full justify-end">
	<button
		class="btn btn-sm btn-primary"
		onclick={() => (document.getElementById('announcement') as HTMLDialogElement)?.showModal()}
		>Create Announcement</button
	>
</div>

<table class="table w-full">
	<thead>
		<tr>
			<th>From</th>
			<th>Title</th>
			<th>Message</th>
			<th>Date</th>
			<th>Actions</th>
		</tr>
	</thead>
	<tbody>
		{#each announcements as announcement}
			<tr class="hover:bg-primary/10">
				<td>{announcement.from}</td>
				<td>{announcement.title}</td>
				<td>{announcement.message}</td>
				<td>{new Date(announcement.date).toLocaleString()}</td>
				<td>
					<button
						class="btn btn-square btn-outline btn-sm btn-error"
						onclick={() => deleteAnnouncement(announcement.id)}
					>
						<SvgIcon type="mdi" path={mdiTrashCan} />
					</button>
				</td>
			</tr>
		{/each}
	</tbody>
</table>

<Modal id="announcement">
	<AnnouncementModal onclose={closeModal} />
</Modal>
