<script lang="ts">
  // The search box of the looks `sidebar` and `bar`: it searches as one types (after a short rest), Enter sends
  // at once, and there is no button. A search landmark, as before.
  import type { FacetSearchView } from './types.ts';
  import { MAX_TEXT } from './model.ts';

  let { view }: { view: FacetSearchView } = $props();
</script>

<form
  role="search"
  class="flex flex-col gap-1"
  onsubmit={(event) => {
    event.preventDefault();
    view.flushText();
  }}
>
  <label class="text-sm font-medium" for="{view.id}-search">{view.label}</label>
  <input
    id="{view.id}-search"
    type="search"
    class="input input-bordered w-full sm:max-w-md"
    maxlength={MAX_TEXT}
    autocomplete="off"
    value={view.text}
    oninput={(event) => view.setText(event.currentTarget.value)}
    onblur={() => view.endTyping()}
  />
</form>
