/**
 * Read the impact figures of a consortium (`GET /kpi/impact/consortia` and `/summary`). Plain, no resource: the role `reviewer` and Admin hold
 * it, the role `user` does not (FEATURES §3.9: "Reviewer or Admin"; decision 20 of the M12 plan). Never anonymous, never public v1.
 */
export const PERMISSION_READ = 'kpi.impact.read';
