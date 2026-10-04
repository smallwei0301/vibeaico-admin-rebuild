/** UI request lifecycle only; the service retains aggregation, ordering and tenant authorization. */
export type GuideInboxLoadState<T> =
  | { tenantId: string; status: 'loading' | 'error' }
  | { tenantId: string; status: 'success'; items: T[] };

/** Hide previous-tenant data during render, before the new tenant's effect starts. */
export function guideInboxForTenant<T>(state: GuideInboxLoadState<T>, tenantId: string): GuideInboxLoadState<T> {
  return state.tenantId === tenantId ? state : { tenantId, status: 'loading' };
}

export function createGuideInboxLoader<T>(publish: (state: GuideInboxLoadState<T>) => void) {
  let generation = 0;
  return {
    invalidate() { generation += 1; },
    async load(tenantId: string, read: () => Promise<T[]>): Promise<void> {
      const request = ++generation;
      publish({ tenantId, status: 'loading' });
      try {
        const items = await read();
        if (request === generation) publish({ tenantId, status: 'success', items });
      } catch {
        if (request === generation) publish({ tenantId, status: 'error' });
      }
    },
  };
}
