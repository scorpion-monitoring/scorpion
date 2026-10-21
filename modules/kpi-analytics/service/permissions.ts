/**
 * Read the analytics of a service on the signed-in pages (`GET /kpi/analytics/series` and `/summary`). Plain, no resource: the role `user`
 * holds it and every holder reads every service, as the measurements are readable (decision 4 of M10, decision 13 of the M11 plan). Never
 * anonymous, never public v1.
 */
export const PERMISSION_READ = 'kpi.analytics.read';
