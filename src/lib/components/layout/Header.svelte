<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
</script>

<div class="navbar bg-base-100 shadow-lg border-b border-base-300">
	<div class="navbar-start">
		<div class="dropdown">
			<div tabindex="0" role="button" class="btn btn-circle btn-ghost">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M4 6h16M4 12h16M4 18h7"
					/>
				</svg>
			</div>
			<ul
				tabindex="-1"
				class="dropdown-content menu z-1 mt-3 w-52 menu-sm rounded-box bg-base-100 p-2 shadow"
			>
				<li><button onclick={() => goto(resolve('/services'))}>Portfolio</button></li>
				<li><button onclick={() => goto(resolve('/administration'))}>Administration</button></li>
			</ul>
		</div>
		<button class="btn text-xl btn-ghost" onclick={() => goto(resolve('/'))}>daisyUI</button>
	</div>
	<div class="navbar-end">
		<div class="dropdown dropdown-end">
			<div tabindex="0" role="button" class="btn avatar btn-circle btn-ghost">
				<div class="w-10 rounded-full">
					<img
						alt="Tailwind CSS Navbar component"
						src="https://img.daisyui.com/images/stock/photo-1534528741775-53994a69daeb.webp"
					/>
				</div>
			</div>
			<ul
				tabindex="-1"
				class="dropdown-content menu z-1 mt-3 w-52 menu-sm rounded-box bg-base-100 p-2 shadow"
			>
				<li>
					<button onclick={() => goto(resolve('/profile'))}> Profile </button>
				</li>
				<li><button onclick={() => goto(resolve('/settings'))}>Settings</button></li>
				<li><button class="hover:bg-error">Logout</button></li>
			</ul>
		</div>
	</div>
</div>
