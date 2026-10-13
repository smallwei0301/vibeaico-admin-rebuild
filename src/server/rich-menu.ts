import { MODE_PRESETS, type BusinessType } from '@/config/modes';

/** 六格（3×2）格線：833+833+834 = 2500；843+843 = 1686 */
export const RICH_MENU_CELL_BOUNDS = [
  { x: 0, y: 0, w: 833, h: 843 }, { x: 833, y: 0, w: 833, h: 843 }, { x: 1666, y: 0, w: 834, h: 843 },
  { x: 0, y: 843, w: 833, h: 843 }, { x: 833, y: 843, w: 833, h: 843 }, { x: 1666, y: 843, w: 834, h: 843 },
] as const;

/** 不合法或缺漏的營業模式一律回退 LOCAL_SHOP，不讓發布失敗（與 line-events 的 businessTypeOf 同規則）。 */
export function resolveRichMenuBusinessType(value: unknown): BusinessType {
  const bt = String(value ?? '');
  return Object.prototype.hasOwnProperty.call(MODE_PRESETS, bt) ? (bt as BusinessType) : 'LOCAL_SHOP';
}

/** 基本圖文選單 body：六格 label／text 取自 MODE_PRESETS[businessType].richMenuCells。 */
export function buildRichMenuBody(theme: string, businessType?: unknown) {
  const cells = MODE_PRESETS[resolveRichMenuBusinessType(businessType)].richMenuCells;
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: `vibeai-${theme.toLowerCase()}`,
    chatBarText: '選單',
    areas: RICH_MENU_CELL_BOUNDS.map((c, i) => ({
      bounds: { x: c.x, y: c.y, width: c.w, height: c.h },
      action: { type: 'message' as const, label: cells[i].label, text: cells[i].text },
    })),
  };
}
