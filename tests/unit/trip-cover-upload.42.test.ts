import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploadImage = vi.fn();
const updateTrip = vi.fn();
vi.mock('@/services/upload', () => ({ uploadImage: (...a: unknown[]) => uploadImage(...a) }));
vi.mock('@/services/tours', () => ({ updateTrip: (...a: unknown[]) => updateTrip(...a) }));

import { removeTripCover, uploadTripCover, validateTripCoverFile } from '@/lib/trip-cover';

beforeEach(() => { uploadImage.mockReset(); updateTrip.mockReset(); });

describe('#42 行程封面上傳', () => {
  it('使用 service-images bucket，並以 coverImageUrl 寫入行程', async () => {
    uploadImage.mockResolvedValue({ url: 'https://x/c.png' });
    updateTrip.mockResolvedValue(undefined);
    const file = new File(['a'], 'c.png', { type: 'image/png' });
    expect(await uploadTripCover('t1', file)).toBe('https://x/c.png');
    expect(uploadImage).toHaveBeenCalledWith(file, 'service-images');
    expect(updateTrip).toHaveBeenCalledWith('t1', { coverImageUrl: 'https://x/c.png' });
  });
  it('上傳失敗不寫入行程；寫入失敗會 throw', async () => {
    uploadImage.mockRejectedValue(new Error('boom'));
    await expect(uploadTripCover('t1', new File(['a'], 'c.png', { type: 'image/png' }))).rejects.toThrow('boom');
    expect(updateTrip).not.toHaveBeenCalled();
    uploadImage.mockResolvedValue({ url: 'u' });
    updateTrip.mockRejectedValue(new Error('db'));
    await expect(uploadTripCover('t1', new File(['a'], 'c.png', { type: 'image/png' }))).rejects.toThrow('db');
  });
  it('移除封面送空字串', async () => {
    updateTrip.mockResolvedValue(undefined);
    await removeTripCover('t1');
    expect(updateTrip).toHaveBeenCalledWith('t1', { coverImageUrl: '' });
  });
  it('檔案驗證：型別與 5MB', () => {
    expect(validateTripCoverFile({ type: 'image/gif', size: 1 })).toBe('type');
    expect(validateTripCoverFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toBe('size');
    expect(validateTripCoverFile({ type: 'image/webp', size: 100 })).toBeNull();
  });
});
