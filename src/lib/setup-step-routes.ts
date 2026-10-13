import { MODE_PRESETS, type BusinessType, type SetupStepKey } from '@/config/modes';

/** 設定進度某一步的前往頁面（含 hash）；該模式沒有可前往的頁面時回 null。 */
export function getSetupStepHref(key: SetupStepKey, businessType: BusinessType): string | null {
  return MODE_PRESETS[businessType].setupStepRoutes[key];
}
