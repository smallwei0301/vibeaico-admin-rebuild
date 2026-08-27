/**
 * Service 層 — 頁面只透過這裡取資料。
 * 每個函式都用 adapt(mock, real) 包起來：骨架階段回假資料，
 * 把 NEXT_PUBLIC_USE_MOCK 設成 false 就自動改打真實後端，頁面元件一行都不用改。
 */
export * from './auth';
export * from './bookings';
export * from './customers';
export * from './demo-data';
export * from './catalog';
export * from './chat';
export * from './coupons';
export * from './points';
export * from './products';
export * from './reports';
export * from './settings';
export * from './shell';
export * from './tours';
