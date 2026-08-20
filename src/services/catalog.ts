import { adapt, request } from '@/lib/api';
import type { Coupon, MembershipLevel, Product, ProductOrder, Service, Staff } from '@/lib/types';
import {
  MOCK_COUPONS, MOCK_MEMBERSHIP_LEVELS, MOCK_PRODUCTS,
  MOCK_PRODUCT_ORDERS, MOCK_SERVICES, MOCK_STAFF,
} from '@/mock';

export const listServices = () =>
  adapt<Service[]>(() => MOCK_SERVICES, () => request<Service[]>('/api/services'));

export const listStaff = () =>
  adapt<Staff[]>(() => MOCK_STAFF, () => request<Staff[]>('/api/staff'));

export const listProducts = () =>
  adapt<Product[]>(() => MOCK_PRODUCTS, () => request<Product[]>('/api/products'));

export const listProductOrders = () =>
  adapt<ProductOrder[]>(() => MOCK_PRODUCT_ORDERS, () => request<ProductOrder[]>('/api/product-orders'));

export const listCoupons = () =>
  adapt<Coupon[]>(() => MOCK_COUPONS, () => request<Coupon[]>('/api/coupons'));

export const listMembershipLevels = () =>
  adapt<MembershipLevel[]>(() => MOCK_MEMBERSHIP_LEVELS, () => request<MembershipLevel[]>('/api/membership-levels'));
