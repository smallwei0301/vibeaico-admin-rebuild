/** Return the next zero-based tail without assuming the rows are dense. */
export function nextOrderValue(values: readonly (number | null | undefined)[]): number {
  const maximum = values.reduce<number>((current, value) => {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : -1;
    return Math.max(current, numeric);
  }, -1);
  return Math.floor(maximum) + 1;
}

export type CatalogPosition = {
  sortOrder: number;
  lineSortOrder: number;
};
