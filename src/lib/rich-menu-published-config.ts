/**
 * 已發布 Rich Menu 設定的前端解碼。
 *
 * 固定版型與 create-custom 共用 `rich_menu_designs.config`，但後者存的是任意 bounds。
 * 不能因為畫面只會畫規則格線，就把任意座標假裝成固定 3+4；無法忠實表示時回傳
 * UNSUPPORTED_CUSTOM，讓頁面停在明確的唯讀未知狀態。
 */
import { customGridBounds } from '@/config/rich-menu-custom-grid';
import type { RichMenuBounds } from '@/config/rich-menu-layouts';

export type RichMenuPublishedCell = {
  label: string;
  action: 'SEND_TEXT' | 'OPEN_URL' | 'OPEN_URL_AD' | 'FLEX_POPUP';
  value: string;
  icon: string;
};

export type RichMenuCustomAreaPayload = RichMenuPublishedCell & { bounds: RichMenuBounds };

/** create-custom 寫入 PUBLISHED config 的實際形狀。 */
export type RichMenuCustomPublishedConfig = {
  kind: 'CUSTOM';
  theme: string;
  areas: RichMenuCustomAreaPayload[];
  bgImageUrl?: string;
  chatBarText?: string;
  name?: string;
};

export type PublishedRichMenuDecode =
  | { kind: 'FIXED'; theme: string; layout: string; cells: RichMenuPublishedCell[] }
  | { kind: 'CUSTOM_GRID'; theme: string; grid: { rows: number; columns: number }; cells: RichMenuPublishedCell[] }
  | { kind: 'UNSUPPORTED_CUSTOM' }
  | { kind: 'UNSUPPORTED_CONFIG' };

const ACTIONS = new Set<RichMenuPublishedCell['action']>([
  'SEND_TEXT', 'OPEN_URL', 'OPEN_URL_AD', 'FLEX_POPUP',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isCell = (value: unknown): value is RichMenuPublishedCell =>
  isRecord(value)
  && typeof value.label === 'string'
  && typeof value.value === 'string'
  && typeof value.icon === 'string'
  && typeof value.action === 'string'
  && ACTIONS.has(value.action as RichMenuPublishedCell['action']);

const isBounds = (value: unknown): value is RichMenuBounds =>
  isRecord(value)
  && ['x', 'y', 'width', 'height'].every((key) => typeof value[key] === 'number' && Number.isInteger(value[key]));

const isCustomArea = (value: unknown): value is RichMenuCustomAreaPayload => {
  if (!isRecord(value)) return false;
  if (!isCell(value)) return false;
  return isBounds((value as unknown as Record<string, unknown>).bounds);
};

const sameBounds = (left: RichMenuBounds, right: RichMenuBounds): boolean =>
  left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;

/**
 * 從 create-custom 的 areas 判定是否為本頁能畫出的「等分 rows × columns」格線。
 * 匹配失敗不是錯誤：端點合法支援任意矩形，而本頁不能編輯它，就必須如實回報。
 */
function decodeCustomGrid(config: Record<string, unknown>): PublishedRichMenuDecode {
  if (typeof config.theme !== 'string' || !Array.isArray(config.areas))
    return { kind: 'UNSUPPORTED_CONFIG' };
  if (!config.areas.every(isCustomArea))
    return { kind: 'UNSUPPORTED_CONFIG' };

  const areas = config.areas;
  for (let rows = 1; rows <= 4; rows += 1) {
    for (let columns = 1; columns <= 5; columns += 1) {
      const expected = customGridBounds(rows, columns);
      if (expected.length === areas.length && expected.every((bounds, index) => sameBounds(bounds, areas[index].bounds))) {
        return {
          kind: 'CUSTOM_GRID',
          theme: config.theme,
          grid: { rows, columns },
          cells: areas.map(({ bounds: _bounds, ...cell }) => cell),
        };
      }
    }
  }
  return { kind: 'UNSUPPORTED_CUSTOM' };
}

/** 將 advanced-config 的 published.config 還原為頁面可忠實呈現的狀態。 */
export function decodePublishedRichMenuConfig(config: unknown): PublishedRichMenuDecode {
  if (!isRecord(config)) return { kind: 'UNSUPPORTED_CONFIG' };
  if (config.kind === 'CUSTOM') return decodeCustomGrid(config);
  if (typeof config.theme === 'string' && typeof config.layout === 'string' && Array.isArray(config.cells)
      && config.cells.every(isCell)) {
    return { kind: 'FIXED', theme: config.theme, layout: config.layout, cells: config.cells };
  }
  return { kind: 'UNSUPPORTED_CONFIG' };
}
