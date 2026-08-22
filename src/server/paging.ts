export function pageRange(page = 0, size = 20) {
  const from = page * size;
  return { from, to: from + size - 1, page, size };
}

export function toPaged<T>(rows: T[], count: number | null, page: number, size: number) {
  const total = count ?? 0;
  return { content: rows, totalElements: total,
           totalPages: Math.ceil(total / size), number: page, size };
}
