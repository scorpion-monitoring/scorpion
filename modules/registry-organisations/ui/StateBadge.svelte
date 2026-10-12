<script lang="ts">
  // The state of a membership as a word in a badge ("Pending", "Member", "Manager", "Rejected", "Left").
  import { getShell } from '@scorpion/ui-kit';
  import { badgeClass, badgeKey } from './membership-rows.ts';

  let {
    state,
    role,
  }: {
    state: 'requested' | 'approved' | 'rejected' | 'left';
    role: 'member' | 'manager';
  } = $props();
  const { t } = getShell();
</script>

<span class="badge {badgeClass(state, role)}">{t(badgeKey(state, role))}</span>
