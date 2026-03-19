<script lang="ts">
	import {
		PUBLIC_CONTACT_EMAIL,
		PUBLIC_DOCS_URL,
		PUBLIC_GITHUB_REPO,
		PUBLIC_IMPRINT_URL
	} from '$env/static/public';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	// @ts-ignore
	import SvgIcon from '@jamescoyle/svelte-icon/src/svg-icon.svelte';
	import { mdiGithub, mdiFileDocument, mdiScaleBalance, mdiSecurity, mdiMail } from '@mdi/js';
	import { onMount } from 'svelte';

	let licenseName = $state('');
	let licenseLink = $state('');
	onMount(async () => {
		const response = await fetch('https://api.github.com/repos/ipk-bit/scorpion/license');
		const data = await response.json();
		licenseName = data.license.spdx_id;
		licenseLink = data.html_url;
	});
</script>

<footer
	class="footer-center footer rounded border-t border-base-300 bg-base-200 p-10 text-base-content"
>
	<div>
		<div class="grid grid-flow-col justify-center gap-4">
			<a
				href={PUBLIC_GITHUB_REPO}
				class="inline-flex link items-center gap-2 link-hover"
				target="_blank"
				rel="noopener noreferrer"
				aria-label="GitHub repository"
			>
				<SvgIcon type="mdi" path={mdiGithub} width="20" height="20" />
				<span>GitHub</span>
			</a>

			<a
				href={PUBLIC_DOCS_URL}
				class="inline-flex link items-center gap-2 link-hover"
				target="_blank"
				rel="noopener noreferrer"
				aria-label="Documentation"
			>
				<SvgIcon type="mdi" path={mdiFileDocument} width="20" height="20" />
				<span>Docs</span>
			</a>

			<button
				onclick={() => goto(resolve('/terms'))}
				class="inline-flex link items-center gap-2 link-hover"
				aria-label="Terms of Service"
			>
				<SvgIcon type="mdi" path={mdiScaleBalance} width="20" height="20" />
				<span>Terms</span>
			</button>

			<button
				onclick={() => goto(resolve('/privacy'))}
				class="inline-flex link items-center gap-2 link-hover"
				aria-label="Privacy Policy"
			>
				<SvgIcon type="mdi" path={mdiSecurity} width="20" height="20" />
				<span>Privacy</span>
			</button>

			<a
				href={`mailto:${PUBLIC_CONTACT_EMAIL}`}
				class="inline-flex link items-center gap-2 link-hover"
				aria-label="Contact"
			>
				<SvgIcon type="mdi" path={mdiMail} width="20" height="20" />
				<span>Contact</span>
			</a>
		</div>

		<p class="mt-4 text-center text-sm">
			© {new Date().getFullYear()} Scorpion •
			<a href={licenseLink} class="link link-hover">{licenseName}</a>
			•
			<a href={PUBLIC_IMPRINT_URL} class="link link-hover">Imprint</a>
		</p>
	</div>
</footer>
