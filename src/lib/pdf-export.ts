import { PDFDocument, rgb } from 'pdf-lib';

export async function createPDFReport(
	traces: any[],
	cards: any[],
	mapScores: any[],
	settings: any
): Promise<Uint8Array> {
	const pdfDoc = await PDFDocument.create();

	// First page of the PDF with the report title
	const page = pdfDoc.addPage();
	let { width, height } = page.getSize();
	const fontSize = 24;
	page.setFontSize(fontSize);
	page.drawText(`KPI Report for ${settings.service}`, {
		x: 50,
		y: height - 50
	});
	const columns = 3;
	const cardWidth = (width - 100) / columns;
	const cardHeight = 80;
	let cardIndex = 0;

	for (const card of cards) {
		const col = cardIndex % columns;
		const row = Math.floor(cardIndex / columns);

		const x = 50 + col * cardWidth;
		const y = height - 100 - row * (cardHeight + 20);

		const mapScore = mapScores.find((score) => score.name === card.title)?.value ?? 'N/A';

		page.setFontSize(18);
		page.drawText(card.title, {
			x,
			y
		});
		page.setFontSize(12);
		page.drawText(
			`Average value: ${
				card.trend && card.trend.length > 0
					? (
							card.trend.reduce((sum: number, val: number) => sum + val, 0) / card.trend.length
						).toFixed(2)
					: 'N/A'
			}`,
			{
				x,
				y: y - 20
			}
		);
		page.drawText(
			`Change: ${card.change >= 0 ? '+' : '-'}${Math.abs(card.change ?? 0).toFixed(1)}%`,
			{
				x,
				y: y - 40
			}
		);
		page.drawText(`MAPE Score: ${(mapScore * 100).toFixed(2)}%`, {
			x,
			y: y - 60
		});

		cardIndex++;
	}

	// @ts-ignore
	const Plotly = await import('plotly.js-dist');
	for (const trace of traces) {
		// Create a new Plotly plot with the trace data
		const plotData = [trace];
		const layout = {
			title: trace.name,
			xaxis: { title: 'X-axis' },
			yaxis: { title: 'Y-axis' }
		};
		const plotDiv = document.createElement('div');
		await Plotly.newPlot(plotDiv, plotData, layout);

		// Convert the plot to a PNG image
		const pngImageBytes = await Plotly.toImage(plotDiv, { format: 'png' });

		// Create a new PDF page and add the PNG image to it
		const page = pdfDoc.addPage([595.28, 842]);

		// Add a title for the trace
		page.setFontSize(18);
		page.drawText(trace.name, {
			x: 50,
			y: page.getHeight() - 50
		});

		const pngImage = await pdfDoc.embedPng(pngImageBytes);
		const pngDims = pngImage.scale(0.85);
		page.drawImage(pngImage, {
			...pngDims,
			x: 0,
			y: page.getHeight() - pngDims.height - 70
		});

		// Add a table with the trace data below the image
		const tableY = page.getHeight() - pngDims.height - 100;
		const cellPadding = 5;
		const cellWidth = (page.getWidth() - 100) / 2;
		const cellHeight = 20;

		// Draw table headers with bold font and background
		page.setFontSize(12);
		const headerBgHeight = cellHeight;
		const headerBgWidth = page.getWidth() - 100;

		// Draw header background
		page.drawRectangle({
			x: 50,
			y: tableY,
			width: headerBgWidth,
			height: headerBgHeight,
			color: rgb(0.9, 0.9, 0.9),
			borderColor: rgb(0.7, 0.7, 0.7),
			borderWidth: 1
		});

		// Draw header text (vertically centered in header row)
		const headerTextY = tableY + headerBgHeight / 2 - 6;
		page.drawText('Date', { x: 50 + cellPadding, y: headerTextY, size: 12, color: rgb(0, 0, 0) });
		page.drawText('Value', {
			x: 50 + cellWidth + cellPadding,
			y: headerTextY,
			size: 12,
			color: rgb(0, 0, 0)
		});

		// Draw table rows with alternating background color
		trace.x.forEach((xValue: any, index: number) => {
			const yValue = trace.y[index];
			const rowY = tableY - (index + 1) * cellHeight;
			// Alternate row background
			if (index % 2 === 0) {
				page.drawRectangle({
					x: 50,
					y: rowY,
					width: headerBgWidth,
					height: cellHeight,
					color: rgb(0.96, 0.96, 0.96)
				});
			}
			// Draw cell borders
			page.drawLine({
				start: { x: 50, y: rowY },
				end: { x: 50 + headerBgWidth, y: rowY },
				thickness: 0.5,
				color: rgb(0.8, 0.8, 0.8)
			});
			// Draw cell text (vertically centered)
			const cellTextY = rowY + cellHeight / 2 - 6;
			page.drawText(String(xValue), {
				x: 50 + cellPadding,
				y: cellTextY,
				size: 12,
				color: rgb(0, 0, 0)
			});
			page.drawText(String(yValue), {
				x: 50 + cellWidth + cellPadding,
				y: cellTextY,
				size: 12,
				color: rgb(0, 0, 0)
			});
		});

		// Draw bottom border after last row
		const lastRowY = tableY - (trace.x.length + 1) * cellHeight + cellHeight;
		page.drawLine({
			start: { x: 50, y: lastRowY },
			end: { x: 50 + headerBgWidth, y: lastRowY },
			thickness: 1,
			color: rgb(0.7, 0.7, 0.7)
		});

		// Draw vertical lines for columns
		page.drawLine({
			start: { x: 50, y: tableY + cellHeight },
			end: { x: 50, y: lastRowY },
			thickness: 1,
			color: rgb(0.7, 0.7, 0.7)
		});
		page.drawLine({
			start: { x: 50 + cellWidth, y: tableY + cellHeight },
			end: { x: 50 + cellWidth, y: lastRowY },
			thickness: 1,
			color: rgb(0.7, 0.7, 0.7)
		});
		page.drawLine({
			start: { x: 50 + headerBgWidth, y: tableY + cellHeight },
			end: { x: 50 + headerBgWidth, y: lastRowY },
			thickness: 1,
			color: rgb(0.7, 0.7, 0.7)
		});
	}
	const pdfBytes = await pdfDoc.save();
	return pdfBytes;
}
