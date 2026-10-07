<script lang="ts">
  import { Chart, type ChartSpec } from '@scorpion/ui-kit';

  const categories = ['2021', '2022', '2023', '2024'];
  const line: ChartSpec = {
    type: 'line',
    categories,
    series: [
      { name: 'Services', values: [4, 9, 15, 21] },
      { name: 'Users', values: [2, 5, null, 12] },
    ],
    unit: 'items',
  };
  const bar: ChartSpec = { ...line, type: 'bar' };
  const radar: ChartSpec = {
    type: 'radar',
    categories: ['Findable', 'Accessible', 'Interoperable', 'Reusable'],
    series: [{ name: 'Maturity', values: [3, 4, 2, 5] }],
    max: 5,
  };
</script>

<h1 class="mb-4 text-2xl font-bold">Charts</h1>
<div class="flex flex-col gap-8">
  <Chart spec={line} label="Services and users per year" />
  <Chart spec={bar} label="Services and users per year, as bars" size="sm" />
  <Chart spec={radar} label="Maturity per principle" size="sm" />
  <Chart
    spec={{ ...line, series: [{ name: 'Short', values: [1] }] }}
    label="A broken chart"
    size="sm"
  />
</div>
