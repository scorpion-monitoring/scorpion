import { and, eq, gte, lte } from 'drizzle-orm';
import { indicator, measurements, service } from './schema';
import { db } from '.';

export const loadDashboardData = async (
	pService: string | null,
	pDuration: string | null,
	pFilter: string | null
) => {
	let endDate = new Date();
	let startDate = new Date();
	if (pDuration) {
		if (pDuration.endsWith('d')) {
			const value = parseInt(pDuration.slice(0, -1));
			startDate.setDate(endDate.getDate() - value);
		} else if (pDuration.endsWith('mo')) {
			const value = parseInt(pDuration.slice(0, -2));
			startDate.setMonth(endDate.getMonth() - value);
		} else if (pDuration.endsWith('y')) {
			const value = parseInt(pDuration.slice(0, -1));
			startDate.setFullYear(endDate.getFullYear() - value);
		} else if (pDuration === 'all') {
			startDate = new Date(0); // Earliest possible date to include all measurements
		}
	} else {
		// Default to last year
		// FIXME: seems to have no effect on the query results
		startDate.setMonth(endDate.getMonth() - 3);
	}

	if (!pService) {
		// Default to first service if not provided
		const firstService = await db.select().from(service).limit(1);
		if (firstService.length > 0) {
			pService = firstService[0].abbreviation;
		} else {
			pService = null; // No valid service found, so don't filter by service
		}
	}

	const validCategories = ['Bibliographic', 'Usage', 'Technical', 'Satisfaction'] as const;
	type Category = (typeof validCategories)[number];
	let categoryFilter: Category | undefined = undefined;
	if (pFilter && pFilter !== 'All' && validCategories.includes(pFilter as Category)) {
		categoryFilter = pFilter as Category;
	}

	let dbMeasurements = (
		await db
			.select()
			.from(measurements)
			.innerJoin(indicator, eq(measurements.indicatorId, indicator.id))
			.innerJoin(service, eq(measurements.serviceId, service.id))
			.where(
				and(
					pService ? eq(service.abbreviation, pService) : undefined,
					categoryFilter ? eq(indicator.category, categoryFilter) : undefined,
					pDuration
						? and(
								gte(measurements.date, startDate.toISOString()),
								lte(measurements.date, endDate.toISOString())
							)
						: undefined
				)
			)
			.orderBy(measurements.date)
	).reverse();

	let cards: { id: number; title: string; value: string; change: number; trend: number[] }[] = [];
	let traces: { x: string[]; y: number[]; mode: 'lines+markers'; name: string }[] = [];
	let mapeScores: { name: string; value: number }[] = [];

	for (const m of dbMeasurements) {
		if (!cards.find((c) => c.id === m.indicator.id)) {
			try {
				let trendValue = parseFloat(m.measurements.value);
				if (/^\d{2}-\d{2}-\d{2}$/.test(m.measurements.value)) {
					const toSeconds = (timeStr: string) => {
						const parts = timeStr.split('-').map((part) => parseInt(part, 10));
						return parts[0] * 3600 + parts[1] * 60 + parts[2];
					};
					trendValue = toSeconds(m.measurements.value);
				}
				cards.push({
					id: m.indicator.id,
					title: m.indicator.name,
					value: m.measurements.value,
					change: 0,
					trend: [trendValue]
				});
			} catch (error) {
				console.error('Error processing measurement:', error);
			}
		} else {
			let card = cards.find((c) => c.id === m.indicator.id);
			if (card) {
				try {
					let trendValue = parseFloat(m.measurements.value);
					if (/^\d{2}-\d{2}-\d{2}$/.test(m.measurements.value)) {
						const toSeconds = (timeStr: string) => {
							const parts = timeStr.split('-').map((part) => parseInt(part, 10));
							return parts[0] * 3600 + parts[1] * 60 + parts[2];
						};
						trendValue = toSeconds(m.measurements.value);
					}
					card.trend.push(trendValue);
				} catch (error) {
					console.error('Error processing measurement for trend:', error);
				}
			}
		}

		if (!traces.find((t) => t.name === m.indicator.name)) {
			if (/^\d{2}-\d{2}-\d{2}$/.test(m.measurements.value)) {
				const toSeconds = (timeStr: string) => {
					const parts = timeStr.split('-').map((part) => parseInt(part, 10));
					return parts[0] * 3600 + parts[1] * 60 + parts[2];
				};
				m.measurements.value = toSeconds(m.measurements.value).toString();
			}
			traces.push({
				x: [new Date(m.measurements.date).toLocaleDateString()],
				y: [parseFloat(m.measurements.value)],
				mode: 'lines+markers',
				name: m.indicator.name
			});
		} else {
			let trace = traces.find((t) => t.name === m.indicator.name);
			if (trace) {
				if (/^\d{2}-\d{2}-\d{2}$/.test(m.measurements.value)) {
					const toSeconds = (timeStr: string) => {
						const parts = timeStr.split('-').map((part) => parseInt(part, 10));
						return parts[0] * 3600 + parts[1] * 60 + parts[2];
					};
					m.measurements.value = toSeconds(m.measurements.value).toString();
				}
				trace.x = [new Date(m.measurements.date).toLocaleDateString(), ...trace.x];
				trace.y = [parseFloat(m.measurements.value), ...trace.y];
			}
		}
	}
	for (let card of cards) {
		if (Array.isArray(card.trend) && card.trend.length >= 2) {
			const first = card.trend[0];
			const last = card.trend[card.trend.length - 1];
			if (first === 0) {
				card.change = 0;
			} else {
				card.change = ((first - last) / Math.abs(last)) * 100;
			}
		}
	}

	for (const trace of traces) {
		// compute MAPE while skipping actual==0 or non-finite values to avoid division-by-zero or Infinity; use average as prediction
		const predicted = trace.y.reduce((a, b) => a + b, 0) / trace.y.length; // Use average of all values as prediction for simplicity
		const { errorSum, count } = trace.y.reduce(
			(acc, actual) => {
				if (actual === 0 || !isFinite(actual)) return acc;
				acc.errorSum += Math.abs(actual - predicted) / Math.abs(actual);
				acc.count += 1;
				return acc;
			},
			{ errorSum: 0, count: 0 }
		);
		const mape = count > 0 ? errorSum / count : 0;
		mapeScores.push({ name: trace.name, value: mape });
	}

	// The card trends are in backwards
	for (let card of cards) {
		card.trend.reverse();
	}

	return { cards, traces, mapeScores };
};
