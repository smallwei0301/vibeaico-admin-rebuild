import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/settings/page.tsx');
const service = read('src/services/upload.ts');
const route = read('src/app/api/upload/route.ts');
const storage = read('src/server/storage.ts');
const migration = read('supabase/migrations/0069_welcome_card_images.sql');
const retirementMigration = read('supabase/migrations/0070_welcome_card_image_retirement.sql');
const settingsRoute = read('src/app/api/settings/route.ts');

describe('welcome card image upload #28⑥', () => {
  it('opens a real file input instead of showing success on button click', () => {
    expect(page).toContain('id="welcomeCardImageFile"');
    expect(page).toContain('type="file"');
    expect(page).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(page).toContain('onClick={() => welcomeImageFileRef.current?.click()}');
    expect(page).not.toContain('onClick={() => toast.show(t.notification.welcomeCardImageUpdated)}');
  });

  it('uploads through the service and persists before showing success', () => {
    const upload = page.slice(
      page.indexOf('const uploadWelcomeCardImage'),
      page.indexOf('const removeWelcomeCardImage'),
    );
    expect(page).toContain("uploadImage } from '@/services/upload';");
    expect(upload).toContain("await uploadImage(file, 'welcome-card-images')");
    expect(upload).toContain('const notify = { ...draft.notify, welcomeCardImageUrl: url };');
    expect(upload).toContain('await saveTenantSettings({ notify });');
    expect(upload.indexOf('await saveTenantSettings({ notify })')).toBeLessThan(
      upload.indexOf('t.notification.welcomeCardImageUpdated'),
    );
    expect(upload).toContain("t.notification.validation.uploadFailedPrefix");
    expect(upload).toContain('await removeWelcomeCardImageAsset(uploadedUrl)');
    expect(upload).toContain('welcomeCardImageCleanupPending');
  });

  it('persists removal before showing the removal confirmation', () => {
    const remove = page.slice(
      page.indexOf('const removeWelcomeCardImage'),
      page.indexOf('const savePoints'),
    );
    expect(remove).toContain("welcomeCardImageUrl: ''");
    expect(remove).toContain('await saveTenantSettings({ notify });');
    expect(remove.indexOf('await saveTenantSettings({ notify })')).toBeLessThan(
      remove.indexOf('t.notification.welcomeCardImageRemoved'),
    );
    expect(remove).toContain("t.notification.validation.removeFailedPrefix");
    expect(remove).toContain('await removeWelcomeCardImageAsset(previousUrl)');
    expect(remove).toContain('welcomeCardImageCleanupPending');
  });

  it('keeps the bucket allowlist and storage policy aligned', () => {
    expect(service).toContain("'welcome-card-images'");
    expect(route).toContain("'welcome-card-images'");
    expect(migration).toContain("'welcome-card-images', 'welcome-card-images', true");
    expect(migration).toContain("bucket_id in (");
    expect(migration).toContain("'welcome-card-images'");
    expect(route).toContain("await requireTenant('MANAGER')");
    expect(route).toContain('tenantOwnedPublicStoragePath');
    expect(route).toContain('tenantOwnedPublicStorageUrl');
    expect(route).toContain('export const DELETE');
    expect(route).not.toContain('currentNotify?.welcomeCardImageUrl === body.url');
    expect(storage).toContain('canonicalUrl');
    expect(storage).toContain('p_image_url: object.canonicalUrl');
    expect(migration).toContain("tenant_role_at_least((storage.foldername(name))[1]::uuid, 'MANAGER')");
    expect(retirementMigration).toContain('create table if not exists public.welcome_card_image_retirements');
    expect(retirementMigration).toContain('create or replace function public.retire_welcome_card_image');
    expect(retirementMigration).toContain('trg_prevent_retired_welcome_card_image');
    expect(settingsRoute).toContain('welcome_card_image_not_retired');
    expect(settingsRoute).toContain('welcomeCardImageCleanupPending');
  });
});
