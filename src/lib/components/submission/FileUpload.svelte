<script lang="ts">
	// @ts-ignore
	import { DataFrame } from 'dataframe-js';
	import { resolve } from '$app/paths';

	let { services = $bindable() } = $props();

	let selectedService = $state('');
	let indicators: Array<{ name: string; necessity: string; type: string }> = $state([]);

	function handleFileDrop(event: DragEvent) {
		event.preventDefault();
		const file = event.dataTransfer?.files?.[0];
		if (!file) {
			return;
		}
		loadFile(file);
	}

	let submitDisabled = $state(true);
	function checkMapping() {
		const mandatoryFields = indicators
			.filter((i) => i.necessity === 'mandatory')
			.map((i) => i.name);
		mandatoryFields.push('Date');
		submitDisabled = !mandatoryFields.every((field) =>
			fileHeader.some((header) => header.mapping === field)
		);
	}

	function handleFileSelection() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.csv, .tsv'; // Specify the accepted file type(s) here
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (!file) {
				return;
			}
			loadFile(file);
		});
		input.click();
	}

	async function loadIndicators() {
		const response = await fetch(resolve('/api/indicators') + `?serviceId=${selectedService}`);
		indicators = (await response.json()).indicators;
		indicators.forEach((indicator) => {
			indicator.necessity === 'additional' ? (indicator.necessity = 'optional') : null;
		});
	}

	let fileContent: Array<Array<string>> = $state([]);
	let fileHeader: Array<{ name: string; mapping: string }> = $state([]);
	let fileTypeError = $state('');

	function detectFileKind(file: File): 'csv' | 'tsv' | null {
		const fileName = file.name.toLowerCase();
		const fileType = file.type.toLowerCase();

		if (
			fileName.endsWith('.csv') ||
			fileType === 'text/csv' ||
			fileType === 'application/vnd.ms-excel'
		) {
			return 'csv';
		}

		if (fileName.endsWith('.tsv') || fileType === 'text/tab-separated-values') {
			return 'tsv';
		}

		return null;
	}

	function parseNumericCell(value: unknown): number | null {
		if (typeof value === 'number') {
			return Number.isFinite(value) ? value : null;
		}

		if (typeof value !== 'string') {
			return null;
		}

		const trimmedValue = value.trim();
		if (trimmedValue === '') {
			return null;
		}

		const parsedValue = Number(trimmedValue);
		return Number.isFinite(parsedValue) ? parsedValue : null;
	}

	function isIntegerCell(value: unknown): boolean {
		const parsedValue = parseNumericCell(value);
		return parsedValue !== null && Number.isInteger(parsedValue);
	}

	function isFloatCell(value: unknown): boolean {
		return parseNumericCell(value) !== null;
	}

	function isMappingTaken(mapping: string, currentIndex: number): boolean {
		if (!mapping) {
			return false;
		}

		return fileHeader.some((header, index) => index !== currentIndex && header.mapping === mapping);
	}

	async function loadFile(file: File) {
		const fileKind = detectFileKind(file);
		if (!fileKind) {
			fileTypeError = 'Only CSV and TSV files are allowed.';
			return;
		}

		fileTypeError = '';
		let df: any;
		if (fileKind === 'csv') {
			df = await DataFrame.fromCSV(file, true).then((df: any) => df);
		} else {
			df = await DataFrame.fromTSV(file, true).then((df: any) => df);
		}
		fileContent = df.toArray();
		fileHeader = df.listColumns().map((c: string) => ({ name: c, mapping: '' }));
	}

	async function submit() {
		const dateIndex = fileHeader.findIndex((h) => h.mapping === 'Date');

		const results = fileContent.map((row) => {
			const parsedDate = new Date(row[dateIndex]);
			const date = `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}`;
			const values: Record<string, string> = {};

			fileHeader.forEach((header, i) => {
				if (header.mapping && header.mapping !== 'Date') {
					values[header.mapping] = row[i];
				}
			});

			return { serviceAbbreviation: selectedService, date, values };
		});

		console.log(results);

		const response = await fetch(resolve('/api/measurements'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(results)
		});

		if (response.ok) {
			fileHeader = [];
			fileContent = [];
		}
		return;
	}
</script>

<fieldset class="fieldset">
	<legend class="fieldset-legend">Select Service</legend>
	<select class="select w-full" bind:value={selectedService} onchange={loadIndicators}>
		<option value="" disabled selected>Select a service</option>
		{#each services as service}
			<option value={service.abbreviation}>{service.name}</option>
		{/each}
	</select>
</fieldset>

{#if selectedService}
	<fieldset class="fieldset">
		<legend class="fieldset-legend">File Upload</legend>
		<div
			class="mt-2 flex min-h-25 flex-col items-center justify-center rounded-lg border-2 border-dashed border-base-content/30 bg-base-200 p-4 text-center"
			role="button"
			tabindex="0"
			ondrop={handleFileDrop}
			ondragover={(event) => event.preventDefault()}
		>
			<button class="link" onclick={handleFileSelection}
				>Drag and drop your KPI measurement file</button
			>
		</div>
		<p class="label">Allowed: text/csv, text/tab-separated-values</p>
		{#if fileTypeError}
			<p class="label text-error">{fileTypeError}</p>
		{/if}
	</fieldset>

	{#if fileContent.length > 0}
		<div class="overflow-x-auto">
			<table class="table w-full">
				<thead>
					<tr>
						{#each fileHeader as header}
							<th>{header.name}</th>
						{/each}
					</tr>
					<tr>
						{#each fileHeader as header, headerIndex}
							<th>
								<select class="select w-full" bind:value={header.mapping} onchange={checkMapping}>
									<option value="">Unmapped</option>
									<option disabled={isMappingTaken('Date', headerIndex)}>Date</option>
									{#each indicators as indicator}
										<option disabled={isMappingTaken(indicator.name, headerIndex)}>
											{indicator.name}
										</option>
									{/each}
								</select>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each fileContent as row}
						<tr>
							{#each row as cell, i}
								<td>
									{#if fileHeader[i].mapping === 'Date'}
										{new Date(cell).toLocaleDateString()}
									{:else}
										{#await indicators.find((ind) => ind.name === fileHeader[i].mapping)}
											<span></span>
										{:then indicator}
											{#if indicator}
												{#if indicator.type === 'number'}
													<span class:text-error={!isIntegerCell(cell)}>{cell}</span>
												{:else if indicator.type === 'float'}
													<span class:text-error={!isFloatCell(cell)}>{cell}</span>
												{:else}
													<span>{cell}</span>
												{/if}
											{:else}
												<span class="text-base-content/50">{cell}</span>
											{/if}
										{/await}
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr>
						<td colspan={fileHeader.length}>
							<button disabled={submitDisabled} class="btn w-full btn-primary" onclick={submit}
								>Submit</button
							>
						</td>
					</tr>
				</tfoot>
			</table>
		</div>
	{/if}
{/if}
