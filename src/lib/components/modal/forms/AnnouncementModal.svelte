<script lang="ts">
	import { resolve } from '$app/paths';

	let { onclose } = $props();

	let from = $state('');
	let title = $state('');
	let message = $state('');

	let fromValid = $derived(() => (submitted ? from.length > 0 : true));
	let titleValid = $derived(() => (submitted ? title.length > 0 : true));
	let messageValid = $derived(() => (submitted ? message.length > 0 : true));
	let submitted = $state(false);

	async function create() {
		submitted = true;
		if (!fromValid() || !titleValid() || !messageValid()) return;

		const response = await fetch(resolve('/api/announcements'), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				from,
				title,
				message
			})
		});

		if (response.ok) {
			console.log(await response.json());
			onclose();
		} else {
			console.error(response);
		}
	}
</script>

<h3 class="text-lg font-bold">Create Announcement</h3>
<form class="mt-4 flex flex-col gap-4">
	<select
		placeholder="From"
		class="select w-full {fromValid() ? '' : 'select-error'}"
		bind:value={from}
	>
		<option disabled value="">Select a Sender</option>
		<option>System</option>
		<option>Reviewer</option>
	</select>
	<input
		type="text"
		placeholder="Title"
		class="input w-full {titleValid() ? '' : 'input-error'}"
		bind:value={title}
	/>
	<textarea
		placeholder="Message"
		class="textarea w-full {messageValid() ? '' : 'textarea-error'}"
		bind:value={message}
	></textarea>
	<div class="modal-action justify-between">
		<button type="button" class="btn" onclick={onclose}>Cancel</button>
		<button type="submit" class="btn btn-primary" onclick={create}>Create</button>
	</div>
</form>
