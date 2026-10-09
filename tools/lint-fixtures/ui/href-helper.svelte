<script lang="ts">
  const href = (path: string) => `/base${path}`;
</script>

<a href={href('/login')}>Sign in</a>
<a href="https://example.org/docs">Docs</a>
<a href="#main">Skip</a>
<a href="mailto:a@example.org">Mail</a>
