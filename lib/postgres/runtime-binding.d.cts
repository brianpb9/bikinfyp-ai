export function postgresRuntimeBinding(queryable: {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<{ sha256: string; components: string[] }>;
