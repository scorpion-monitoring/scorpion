<script lang="ts">
	import { PUBLIC_CONTACT_EMAIL, PUBLIC_DOCS_URL, PUBLIC_GITHUB_REPO } from '$env/static/public';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
</script>

<footer class="footer-center footer rounded bg-base-200 p-10 text-base-content border-t border-base-300">
	<div>
		<div class="grid grid-flow-col justify-center gap-4">
			<a
				href={PUBLIC_GITHUB_REPO}
				class="inline-flex link items-center gap-2 link-hover"
				target="_blank"
				rel="noopener noreferrer"
				aria-label="GitHub repository"
			>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
					><path
						d="M12 .5C5.7.5.9 5.3.9 11.6c0 4.7 3 8.7 7.2 10.1.5.1.7-.2.7-.5v-1.9c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.5-1.2-1.5-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 .1.9-1.1 2-1.6.1-.8.4-1.3.7-1.6-2.3-.3-4.7-1.2-4.7-5.3 0-1.2.4-2.2 1.1-3-.1-.3-.5-1.6.1-3.4 0 0 .9-.3 3 .9.9-.2 1.9-.3 2.9-.3s2 .1 2.9.3c2.1-1.2 3-.9 3-.9.6 1.8.2 3.1.1 3.4.7.8 1.1 1.8 1.1 3 0 4.1-2.4 5-4.7 5.3.4.3.8 1 .8 2v3c0 .3.2.6.7.5 4.2-1.4 7.2-5.4 7.2-10.1C23.1 5.3 18.3.5 12 .5z"
					/></svg
				>
				<span>GitHub</span>
			</a>

			<a
				href={PUBLIC_DOCS_URL}
				class="inline-flex link items-center gap-2 link-hover"
				target="_blank"
				rel="noopener noreferrer"
				aria-label="Documentation"
			>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
					><path
						d="M3 4v16a1 1 0 0 0 1.555.832L12 16l7.445 4.832A1 1 0 0 0 21 20V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z"
					/></svg
				>
				<span>Docs</span>
			</a>

			<button
				onclick={() => goto(resolve('/terms'))}
				class="inline-flex link items-center gap-2 link-hover"
				aria-label="Terms of Service"
			>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
					><path d="M12 1l7 4v6c0 5-3.6 9.7-7 11-3.4-1.3-7-6-7-11V5l7-4z" /></svg
				>
				<span>Terms</span>
			</button>

			<button
				onclick={() => goto(resolve('/privacy'))}
				class="inline-flex link items-center gap-2 link-hover"
				aria-label="Privacy Policy"
			>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
					><path d="M12 1l8 4v6c0 6-4.8 11.6-8 12-3.2-.4-8-6-8-12V5l8-4z" /></svg
				>
				<span>Privacy</span>
			</button>

			<a
				href={`mailto:${PUBLIC_CONTACT_EMAIL}`}
				class="inline-flex link items-center gap-2 link-hover"
				aria-label="Contact"
			>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
					><path
						d="M2 6v12h20V6l-10 6L2 6zM22 4H2a1 1 0 0 0-1 1v.8l11 6.6 11-6.6V5a1 1 0 0 0-1-1z"
					/></svg
				>
				<span>Contact</span>
			</a>
		</div>

		<p class="mt-4 text-center text-sm">
			© {new Date().getFullYear()} Scorpion •
			<a href="https://github.com/IPK-BIT/scorpion/blob/main/LICENSE" class="link link-hover">MIT</a
			>
		</p>
	</div>
</footer>
