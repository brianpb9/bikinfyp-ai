// Narrow test seam for the A6 route. Production always sees an empty object;
// tests install explicit boundary doubles and reset them in t.after().
let overrides: Record<string, unknown> | undefined;

export function setDashboardJobPostDependenciesForTests(value?: Record<string, unknown>): void {
  overrides = value;
}

export function dashboardJobPostOverridesForTests(): Record<string, unknown> {
  return overrides ?? {};
}
