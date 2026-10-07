import type { Trip } from '@/lib/types';

/** 已上架 Midao（LISTED）的行程不可刪除（#42）；mock 分支、列表頁按鈕與後端同一規則。 */
export const canDeleteTrip = (trip: Pick<Trip, 'midaoListing'>): boolean =>
  trip.midaoListing !== 'LISTED';
