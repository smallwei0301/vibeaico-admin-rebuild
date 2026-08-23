'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Repeat, Settings, Trash2, Users,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { DataTableContainer, DataTableHeader } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import {
  FormError, FormGroup, FormText, Input, Label, Select,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import {
  clearShiftDay, createShiftTemplate, deleteShiftTemplate, listShifts,
  listShiftTemplates, listStaff, repeatShiftCycles, saveShifts, updateShiftTemplate,
} from '@/services/catalog';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { shiftsPage as t } from '@/i18n/zh-TW/pages/shifts';
import { formatDate } from '@/lib/utils';
import type { Staff } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

/** 原站 /api/settings 的營業時間，用於班別時間驗證 */
const BUSINESS_HOURS = { start: '10:00', end: '20:00', breakStart: '14:00', breakEnd: '15:00' };

/** 原站 /api/shift-templates */
type ShiftTemplate = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  color: string;
  breakStart: string;
  breakEnd: string;
};

const MOCK_TEMPLATES: ShiftTemplate[] = [
  { id: 'tpl_1', name: '早班', startTime: '10:00', endTime: '15:00', color: '#4361ee', breakStart: '', breakEnd: '' },
  { id: 'tpl_2', name: '晚班', startTime: '15:00', endTime: '20:00', color: '#ff9f0a', breakStart: '', breakEnd: '' },
];

/** 範本上限（原站：最多 10 組） */
const TEMPLATE_MAX = 10;

/** 原站 /api/shifts：key 為 `${staffId}|${yyyy-MM-dd}` */
type ShiftRecord = {
  type: 'WORKING' | 'OFF';
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
  note: string;
  templateId: string;
};

const MOCK_SHIFTS: Record<string, ShiftRecord> = {
  's_1|2026-08-20': { type: 'WORKING', startTime: '10:00', endTime: '15:00', breakStart: '', breakEnd: '', note: '', templateId: 'tpl_1' },
  's_1|2026-08-21': { type: 'OFF', startTime: '', endTime: '', breakStart: '', breakEnd: '', note: '', templateId: '' },
  's_2|2026-08-20': { type: 'WORKING', startTime: '15:00', endTime: '20:00', breakStart: '', breakEnd: '', note: '', templateId: 'tpl_2' },
  's_2|2026-08-22': { type: 'WORKING', startTime: '11:00', endTime: '19:00', breakStart: '14:00', breakEnd: '15:00', note: '加班', templateId: '' },
};

/** 排班模式：FIXED_REST 走週排班、ROTATING 逐日排班 */
type ScheduleMode = 'FIXED_REST' | 'ROTATING';

const MOCK_STAFF_MODES: Record<string, ScheduleMode> = {
  s_1: 'ROTATING',
  s_2: 'ROTATING',
  s_3: 'FIXED_REST',
};

/** 原站週排班：index 0–6 對應週日–週六 */
type WeeklyRow = {
  working: boolean;
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
};

const DEFAULT_WEEKLY: WeeklyRow[] = common.weekdays.map((_, i) => ({
  working: i !== 0,
  startTime: i === 0 ? '' : '10:00',
  endTime: i === 0 ? '' : '20:00',
  breakStart: '',
  breakEnd: '',
}));

/** 原站 /api/staff/${id}/leaves 的當日請假（供格子 tooltip） */
const MOCK_LEAVE_BY_KEY: Record<string, { fullDay: boolean; startTime: string; endTime: string; weekly: boolean }> = {
  's_3|2026-08-21': { fullDay: true, startTime: '', endTime: '', weekly: false },
  's_2|2026-08-23': { fullDay: false, startTime: '14:00', endTime: '18:00', weekly: true },
};

/** 店家封鎖時段（優先序最高） */
const MOCK_BLOCKED_DATES = new Set<string>(['2026-08-25']);

const VIEW_WEEK_OPTIONS = [
  { value: 1, label: t.toolbar.weeks1 },
  { value: 2, label: t.toolbar.weeks2 },
  { value: 4, label: t.toolbar.weeks4 },
];

/** 循環重複排班最多排到一年後 */
const REPEAT_MAX_DAYS = 365;

const TIME_OPTIONS = (() => {
  const out: { value: string; label: string }[] = [{ value: '', label: common.none }];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      out.push({ value: v, label: v });
    }
  }
  return out;
})();

const toKey = (staffId: string, date: string) => `${staffId}|${date}`;
const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 取某日所在週的週日 */
const startOfWeek = (d: Date) => {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay());
  return out;
};

/* -------------------------------------------------------------------------- */

export default function ShiftsPage() {
  const toast = useToast();

  const [staff, setStaff] = React.useState<Staff[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [modes, setModes] = React.useState<Record<string, ScheduleMode>>(MOCK_STAFF_MODES);
  const [templates, setTemplates] = React.useState<ShiftTemplate[]>(MOCK_TEMPLATES);
  const [shifts, setShifts] = React.useState<Record<string, ShiftRecord>>(MOCK_SHIFTS);
  const [weekly, setWeekly] = React.useState<Record<string, WeeklyRow[]>>({});

  /** 週起始日；render 期不可用 Date.now()，因此在 effect 內初始化 */
  const [anchor, setAnchor] = React.useState<string>('');
  const [viewWeeks, setViewWeeks] = React.useState(1);

  const [shiftTarget, setShiftTarget] = React.useState<{ staff: Staff; date: string } | null>(null);
  const [weeklyTarget, setWeeklyTarget] = React.useState<Staff | null>(null);
  const [templatesOpen, setTemplatesOpen] = React.useState(false);
  const [repeatOpen, setRepeatOpen] = React.useState(false);
  const [modeTarget, setModeTarget] = React.useState<{ staff: Staff; next: ScheduleMode } | null>(null);

  React.useEffect(() => {
    setAnchor(toIsoDate(startOfWeek(new Date())));
  }, []);

  React.useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const list = await listStaff();
        setStaff([...list].sort((a, b) => a.sortOrder - b.sortOrder));
      } catch {
        toast.show(t.messages.loadStaffFailed, 'danger');
        setStaff([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  /** 班別模板：mock 分支回 null → 沿用 MOCK_TEMPLATES（行為不變）；API 無休息時間欄位，補 '' */
  React.useEffect(() => {
    void (async () => {
      try {
        const list = await listShiftTemplates();
        if (list) setTemplates(list.map((tpl) => ({ ...tpl, breakStart: '', breakEnd: '' })));
      } catch {
        toast.show(t.templateModal.loadFailed, 'danger');
      }
    })();
  }, [toast]);

  const days = React.useMemo(() => {
    if (!anchor) return [] as string[];
    const base = new Date(`${anchor}T00:00:00`);
    return Array.from({ length: viewWeeks * 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      return toIsoDate(d);
    });
  }, [anchor, viewWeeks]);

  /**
   * 讀取檢視區間的班表（GET /api/shifts?from&to）。mock 分支回 null →
   * 維持現狀（MOCK_SHIFTS 與本地編輯不被覆蓋，行為不變）。
   * API 無 OFF／休息／備註欄位：載入的列一律為 WORKING、休息與備註為空；
   * 同員工同日多筆班（唯一鍵含 start_time）只取最早一筆顯示。
   */
  const loadShifts = React.useCallback(async () => {
    if (days.length === 0) return;
    try {
      const list = await listShifts(days[0], days[days.length - 1]);
      if (!list) return;
      const map: Record<string, ShiftRecord> = {};
      for (const item of list) {
        const key = toKey(item.staffId, item.workDate);
        if (key in map) continue;
        map[key] = {
          type: 'WORKING',
          startTime: item.startTime,
          endTime: item.endTime,
          breakStart: '',
          breakEnd: '',
          note: '',
          templateId: item.templateId ?? '',
        };
      }
      setShifts(map);
    } catch {
      toast.show(t.messages.loadShiftsFailed, 'danger');
    }
  }, [days, toast]);

  React.useEffect(() => { void loadShifts(); }, [loadShifts]);

  const shiftWeeks = (delta: number) => {
    if (!anchor) return;
    const d = new Date(`${anchor}T00:00:00`);
    d.setDate(d.getDate() + delta * 7 * viewWeeks);
    setAnchor(toIsoDate(d));
  };

  const jumpTo = (kind: 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'NEXT_MONTH') => {
    const now = new Date();
    if (kind === 'TODAY' || kind === 'THIS_WEEK') {
      setAnchor(toIsoDate(startOfWeek(now)));
      return;
    }
    const first = new Date(now.getFullYear(), now.getMonth() + (kind === 'NEXT_MONTH' ? 1 : 0), 1);
    setAnchor(toIsoDate(startOfWeek(first)));
  };

  const weeklyOf = (staffId: string) => weekly[staffId] ?? DEFAULT_WEEKLY;

  const saveShift = (staffId: string, date: string, record: ShiftRecord | null) => {
    setShifts((map) => {
      const next = { ...map };
      if (record) next[toKey(staffId, date)] = record;
      else delete next[toKey(staffId, date)];
      return next;
    });
  };

  return (
    <>
      <PageHeader
        eyebrow={nav.navOperation}
        title={t.title}
        actions={
          <>
            <Button size="sm" onClick={() => setRepeatOpen(true)}>
              <Repeat size={14} />{t.toolbar.repeatCycle}
            </Button>
            <Button variant="warning" onClick={() => setTemplatesOpen(true)}>
              <Settings size={15} />{t.toolbar.manageTemplates}
            </Button>
          </>
        }
      />

      <Alert tone="neutral" className="mb-3">
        <span className="font-semibold">{t.priorityNote.label}</span>
        {t.priorityNote.text}
      </Alert>

      {/* ---------------------------------------------------------- 工具列 */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="btn-group">
          <Button
            variant="ghost" size="icon" aria-label={t.toolbar.prev} title={t.toolbar.prev}
            onClick={() => shiftWeeks(-1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="ghost" size="icon" aria-label={t.toolbar.next} title={t.toolbar.next}
            onClick={() => shiftWeeks(1)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>

        <div className="btn-group">
          <Button variant="outline" size="sm" onClick={() => jumpTo('TODAY')}>{t.toolbar.today}</Button>
          <Button variant="outline" size="sm" onClick={() => jumpTo('THIS_WEEK')}>{t.toolbar.thisWeek}</Button>
          <Button variant="outline" size="sm" onClick={() => jumpTo('THIS_MONTH')}>{t.toolbar.thisMonth}</Button>
          <Button variant="outline" size="sm" onClick={() => jumpTo('NEXT_MONTH')}>{t.toolbar.nextMonth}</Button>
        </div>

        <div>
          <Label className="text-xs" htmlFor="jumpDate">{t.toolbar.jumpDate}</Label>
          <Input
            id="jumpDate" type="date" className="form-control-sm" value={anchor}
            onChange={(e) => {
              if (!e.target.value) return;
              setAnchor(toIsoDate(startOfWeek(new Date(`${e.target.value}T00:00:00`))));
            }}
          />
        </div>

        <div className="btn-group">
          {VIEW_WEEK_OPTIONS.map((o) => (
            <Button
              key={o.value} size="sm"
              variant={viewWeeks === o.value ? 'primary' : 'outline'}
              onClick={() => setViewWeeks(o.value)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------ 班表 */}
      <DataTableContainer>
        <DataTableHeader title={t.title} />

        <div className="data-table-body lg:max-h-[65vh] lg:overflow-y-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '200px' }}>{t.columns.staff}</th>
                <th style={{ width: '140px' }}>
                  {t.columns.mode}
                  <div className="text-2xs font-normal text-secondary">{t.modeHint}</div>
                </th>
                {days.map((d) => (
                  <th key={d} style={{ width: '110px' }}>
                    {formatDate(d)}
                    <div className="text-2xs font-normal text-secondary">
                      {common.weekdays[new Date(`${d}T00:00:00`).getDay()]}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={days.length + 2} className="!max-w-none py-8 text-center text-muted">
                    {common.loading}
                  </td>
                </tr>
              ) : staff.length === 0 ? (
                <tr>
                  <td colSpan={days.length + 2} className="!max-w-none p-0">
                    <EmptyState
                      icon={Users}
                      title={t.empty.title}
                      description={t.empty.description}
                      action={
                        <Link href="/tenant/staff" className="btn btn-primary">
                          {t.empty.goStaff}
                        </Link>
                      }
                    />
                  </td>
                </tr>
              ) : (
                staff.map((s) => {
                  const mode = modes[s.id] ?? 'ROTATING';
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="font-semibold text-dark">{s.name}</div>
                        {s.title ? <div className="text-xs text-secondary">{s.title}</div> : null}
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <Button
                            variant="outline" size="sm"
                            onClick={() => setModeTarget({
                              staff: s,
                              next: mode === 'FIXED_REST' ? 'ROTATING' : 'FIXED_REST',
                            })}
                          >
                            {t.modes[mode]}
                          </Button>
                          {mode === 'FIXED_REST' ? (
                            <Button variant="ghost" size="sm" onClick={() => setWeeklyTarget(s)}>
                              {t.weeklyModal.title}
                            </Button>
                          ) : null}
                        </div>
                      </td>

                      {days.map((d) => (
                        <ShiftCell
                          key={d}
                          staff={s}
                          date={d}
                          mode={mode}
                          shift={shifts[toKey(s.id, d)]}
                          weekly={weeklyOf(s.id)[new Date(`${d}T00:00:00`).getDay()]}
                          templates={templates}
                          onOpen={() => setShiftTarget({ staff: s, date: d })}
                        />
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </DataTableContainer>

      {/* -------------------------------------------------- modal 1：設定班別 */}
      <ShiftModal
        target={shiftTarget}
        templates={templates}
        record={shiftTarget ? shifts[toKey(shiftTarget.staff.id, shiftTarget.date)] : undefined}
        onClose={() => setShiftTarget(null)}
        onSave={(record) => {
          if (!shiftTarget) return;
          saveShift(shiftTarget.staff.id, shiftTarget.date, record);
          setShiftTarget(null);
          toast.show(record ? t.messages.shiftSaved : t.messages.cleared);
        }}
      />

      {/* ------------------------------------------------ modal 2：編輯週排班 */}
      <WeeklyScheduleModal
        staff={weeklyTarget}
        rows={weeklyTarget ? weeklyOf(weeklyTarget.id) : DEFAULT_WEEKLY}
        onClose={() => setWeeklyTarget(null)}
        onSave={(rows) => {
          if (!weeklyTarget) return;
          setWeekly((map) => ({ ...map, [weeklyTarget.id]: rows }));
          setWeeklyTarget(null);
          toast.show(t.messages.weeklySaved);
        }}
      />

      {/* -------------------------------------------- modal 3：班別範本管理 */}
      <TemplateModal
        open={templatesOpen}
        templates={templates}
        onClose={() => setTemplatesOpen(false)}
        onChange={setTemplates}
      />

      {/* -------------------------------------------- modal 4：循環重複排班 */}
      <RepeatCycleModal
        open={repeatOpen}
        staff={staff}
        weeks={viewWeeks}
        anchor={anchor}
        shifts={shifts}
        onApplied={() => { void loadShifts(); }}
        onClose={() => setRepeatOpen(false)}
      />

      {/* ------------------------------------------------ modal 5：切換模式 */}
      <ConfirmModal
        open={!!modeTarget}
        title={t.columns.mode}
        message={modeTarget ? t.modeSwitchConfirm(t.modes[modeTarget.next]) : common.confirm.message}
        onClose={() => setModeTarget(null)}
        onConfirm={() => {
          if (modeTarget) {
            setModes((map) => ({ ...map, [modeTarget.staff.id]: modeTarget.next }));
            toast.show(t.modeSwitched(t.modes[modeTarget.next]));
          }
          setModeTarget(null);
        }}
      />
    </>
  );
}

/* ========================================================================== */
/* 單一格子                                                                    */
/* ========================================================================== */

function ShiftCell({
  staff, date, mode, shift, weekly, templates, onOpen,
}: {
  staff: Staff;
  date: string;
  mode: ScheduleMode;
  shift?: ShiftRecord;
  weekly: WeeklyRow;
  templates: ShiftTemplate[];
  onOpen: () => void;
}) {
  const blocked = MOCK_BLOCKED_DATES.has(date);
  const leave = MOCK_LEAVE_BY_KEY[toKey(staff.id, date)];
  const template = shift?.templateId
    ? templates.find((tp) => tp.id === shift.templateId)
    : undefined;

  const tooltip = [
    `${t.tooltip.businessHoursLabel}${BUSINESS_HOURS.start}–${BUSINESS_HOURS.end}`,
    weekly.working
      ? `${t.tooltip.weeklyLabel(common.weekdays[new Date(`${date}T00:00:00`).getDay()])}${weekly.startTime}–${weekly.endTime}`
      : `${t.tooltip.weeklyLabel(common.weekdays[new Date(`${date}T00:00:00`).getDay()])}${t.cell.off}`,
    leave
      ? `${t.tooltip.onLeaveLabel}${leave.fullDay
        ? t.tooltip.fullDayLeave(leave.weekly ? t.tooltip.weeklyRecurrence : '')
        : t.tooltip.rangeLeave(leave.startTime, leave.endTime, leave.weekly ? t.tooltip.weeklyRecurrence : '')}`
      : '',
  ].filter(Boolean).join('\n');

  let body: React.ReactNode;
  if (blocked) {
    body = <Badge tone="danger">{t.cell.blocked}</Badge>;
  } else if (shift?.type === 'OFF') {
    body = <Badge tone="neutral">{t.cell.off}</Badge>;
  } else if (shift?.type === 'WORKING') {
    body = (
      <div className="flex flex-col items-start gap-0.5">
        <Badge tone="success">{template?.name ?? shift.note ?? t.cell.custom}</Badge>
        <span className="text-2xs text-secondary">{shift.startTime}–{shift.endTime}</span>
        {shift.breakStart && shift.breakEnd ? (
          <span className="text-2xs text-secondary">{shift.breakStart}–{shift.breakEnd}</span>
        ) : null}
      </div>
    );
  } else if (leave) {
    body = (
      <div className="flex flex-col items-start gap-0.5">
        <Badge tone="warning">{t.cell.leave}</Badge>
        {!leave.fullDay ? (
          <span className="text-2xs text-secondary">{t.cell.halfDayLeave}</span>
        ) : null}
      </div>
    );
  } else if (mode === 'FIXED_REST') {
    body = weekly.working
      ? (
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-xs text-neutral-700">{t.cell.working}</span>
          <span className="text-2xs text-secondary">{weekly.startTime}–{weekly.endTime}</span>
        </div>
      )
      : <span className="text-2xs text-secondary">{t.cell.notWorking}</span>;
  } else {
    body = <span className="text-2xs text-secondary">{t.cell.notScheduled}</span>;
  }

  return (
    <td>
      <button
        type="button"
        title={tooltip}
        aria-label={shift ? t.cell.editShift : t.cell.addShift}
        onClick={onOpen}
        className="w-full rounded-md px-1.5 py-1 text-left transition-colors hover:bg-neutral-100"
      >
        {body}
      </button>
    </td>
  );
}

/* ========================================================================== */
/* 設定班別                                                                    */
/* ========================================================================== */

function ShiftModal({
  target, templates, record, onClose, onSave,
}: {
  target: { staff: Staff; date: string } | null;
  templates: ShiftTemplate[];
  record?: ShiftRecord;
  onClose: () => void;
  onSave: (record: ShiftRecord | null) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = React.useState<ShiftRecord>({
    type: 'WORKING', startTime: '', endTime: '', breakStart: '', breakEnd: '', note: '', templateId: '',
  });
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [clearOpen, setClearOpen] = React.useState(false);

  React.useEffect(() => {
    if (!target) return;
    setError('');
    setDraft(record ?? {
      type: 'WORKING', startTime: BUSINESS_HOURS.start, endTime: BUSINESS_HOURS.end,
      breakStart: '', breakEnd: '', note: '', templateId: '',
    });
  }, [target, record]);

  const patch = (p: Partial<ShiftRecord>) => setDraft((d) => ({ ...d, ...p }));

  const validate = (): string => {
    if (draft.type === 'OFF') return '';
    const { startTime: s, endTime: e, breakStart: bs, breakEnd: be } = draft;
    if (!s || !e) return t.validation.timeRequired;
    if (e <= s) return t.validation.endAfterStartWith(s, e);
    if (s < BUSINESS_HOURS.start) return t.validation.shiftStartBeforeBusiness(s, BUSINESS_HOURS.start);
    if (e > BUSINESS_HOURS.end) return t.validation.shiftEndAfterBusiness(e, BUSINESS_HOURS.end);
    if (bs && !be) return t.validation.breakEndMissing;
    if (!bs && be) return t.validation.breakStartMissing;
    if (bs && be) {
      if (be <= bs) return t.validation.breakEndAfterStartWith(bs, be);
      if (bs < s) return t.validation.breakStartAfterWorkStart(bs, s);
      if (be > e) return t.validation.breakEndBeforeWorkEnd(be, e);
    }
    return '';
  };

  const applyTemplate = (tpl: ShiftTemplate) => {
    patch({
      type: 'WORKING',
      startTime: tpl.startTime,
      endTime: tpl.endTime,
      breakStart: tpl.breakStart,
      breakEnd: tpl.breakEnd,
      note: tpl.name,
      templateId: tpl.id,
    });
  };

  return (
    <>
      <Modal
        open={!!target}
        onClose={onClose}
        title={t.shiftModal.title}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
            <Button
              loading={saving} loadingText={common.saving}
              onClick={async () => {
                const err = validate();
                setError(err);
                if (err) return;
                if (!target) return;
                setSaving(true);
                try {
                  if (draft.type === 'WORKING') {
                    /* 批次端點單筆送出；休息／備註不在 API 契約內，僅留本地顯示 */
                    await saveShifts([{
                      staffId: target.staff.id,
                      workDate: target.date,
                      startTime: draft.startTime,
                      endTime: draft.endTime,
                      templateId: draft.templateId || null,
                    }]);
                  } else {
                    /* DB 無 OFF 概念（設休＝該日無班）：清掉當日既有班表 */
                    await clearShiftDay(target.staff.id, target.date);
                  }
                  onSave(draft);
                } catch (e) {
                  toast.show(
                    `${t.messages.saveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
                    'danger',
                  );
                } finally {
                  setSaving(false);
                }
              }}
            >
              {common.save}
            </Button>
          </>
        }
      >
        <p className="form-text mb-3">
          {target ? t.shiftModal.context(target.staff.name, formatDate(target.date)) : t.cell.dash}
        </p>

        {/* -------------------------------------------------------- 快速選擇 */}
        <FormGroup>
          <Label>{t.shiftModal.quickPick}</Label>
          {templates.length === 0 ? (
            <FormText>{t.shiftModal.noTemplates}</FormText>
          ) : (
            <div className="btn-group flex-wrap">
              {templates.map((tpl) => (
                <Button key={tpl.id} size="sm" variant="outline" onClick={() => applyTemplate(tpl)}>
                  {tpl.name}
                </Button>
              ))}
              <Button
                size="sm" variant="outline"
                onClick={() => patch({ type: 'OFF', templateId: '' })}
              >
                {t.shiftModal.quickOff}
              </Button>
              <Button size="sm" variant="outlineDanger" onClick={() => setClearOpen(true)}>
                {t.shiftModal.clear}
              </Button>
            </div>
          )}
        </FormGroup>

        <FormGroup>
          <Label>{t.shiftModal.type}</Label>
          <div className="btn-group">
            <Button
              size="sm" variant={draft.type === 'WORKING' ? 'primary' : 'outline'}
              onClick={() => patch({ type: 'WORKING' })}
            >
              {t.shiftModal.typeWorking}
            </Button>
            <Button
              size="sm" variant={draft.type === 'OFF' ? 'primary' : 'outline'}
              onClick={() => patch({ type: 'OFF' })}
            >
              {t.shiftModal.typeOff}
            </Button>
          </div>
        </FormGroup>

        {draft.type === 'WORKING' ? (
          <>
            <div className="grid gap-x-4 md:grid-cols-2">
              <FormGroup>
                <Label required htmlFor="sfStart">{t.shiftModal.start}</Label>
                <Select
                  id="sfStart" value={draft.startTime} options={TIME_OPTIONS}
                  onChange={(e) => patch({ startTime: e.target.value, templateId: '' })}
                />
              </FormGroup>
              <FormGroup>
                <Label required htmlFor="sfEnd">{t.shiftModal.end}</Label>
                <Select
                  id="sfEnd" value={draft.endTime} options={TIME_OPTIONS}
                  onChange={(e) => patch({ endTime: e.target.value, templateId: '' })}
                />
              </FormGroup>
              <FormGroup>
                <Label htmlFor="sfBreakStart">{t.shiftModal.breakStart}</Label>
                <Select
                  id="sfBreakStart" value={draft.breakStart} options={TIME_OPTIONS}
                  onChange={(e) => patch({ breakStart: e.target.value })}
                />
              </FormGroup>
              <FormGroup>
                <Label htmlFor="sfBreakEnd">{t.shiftModal.breakEnd}</Label>
                <Select
                  id="sfBreakEnd" value={draft.breakEnd} options={TIME_OPTIONS}
                  onChange={(e) => patch({ breakEnd: e.target.value })}
                />
              </FormGroup>
            </div>
            <FormText className="mb-3">{t.shiftModal.breakHelp}</FormText>

            <FormGroup>
              <Label htmlFor="sfNote">{t.shiftModal.note}</Label>
              <Input
                id="sfNote" value={draft.note} placeholder={t.shiftModal.notePlaceholder}
                onChange={(e) => patch({ note: e.target.value })}
              />
            </FormGroup>
          </>
        ) : null}

        {error ? <FormError>{error}</FormError> : null}
      </Modal>

      <ConfirmModal
        open={clearOpen}
        danger
        title={t.shiftModal.clear}
        message={t.shiftModal.clearConfirm}
        onClose={() => setClearOpen(false)}
        onConfirm={() => {
          setClearOpen(false);
          onSave(null);
          if (target) {
            void clearShiftDay(target.staff.id, target.date).catch((e) => {
              toast.show(e instanceof Error ? e.message : t.messages.clearFailed, 'danger');
            });
          }
        }}
      />
    </>
  );
}

/* ========================================================================== */
/* 編輯週排班                                                                  */
/* ========================================================================== */

function WeeklyScheduleModal({
  staff, rows, onClose, onSave,
}: {
  staff: Staff | null;
  rows: WeeklyRow[];
  onClose: () => void;
  onSave: (rows: WeeklyRow[]) => void;
}) {
  const [draft, setDraft] = React.useState<WeeklyRow[]>(DEFAULT_WEEKLY);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!staff) return;
    setError('');
    setDraft(rows);
  }, [staff, rows]);

  const patchRow = (i: number, p: Partial<WeeklyRow>) =>
    setDraft((list) => list.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  const validate = (): string => {
    for (let i = 0; i < draft.length; i++) {
      const r = draft[i];
      if (!r.working) continue;
      const day = common.weekdays[i];
      if (!r.startTime || !r.endTime) return t.validation.weeklyTimeRequired(day);
      if (r.endTime <= r.startTime) return t.validation.weeklyEndAfterStart(day, r.startTime, r.endTime);
      if (r.startTime < BUSINESS_HOURS.start) {
        return t.validation.weeklyStartBeforeBusiness(day, r.startTime, BUSINESS_HOURS.start);
      }
      if (r.endTime > BUSINESS_HOURS.end) {
        return t.validation.weeklyEndAfterBusiness(day, r.endTime, BUSINESS_HOURS.end);
      }
      if (Boolean(r.breakStart) !== Boolean(r.breakEnd)) return t.validation.weeklyBreakBoth(day);
      if (r.breakStart && r.breakEnd) {
        const inside = r.breakStart >= r.startTime && r.breakEnd <= r.endTime && r.breakEnd > r.breakStart;
        if (!inside) return t.validation.weeklyBreakInside(day);
      }
    }
    return '';
  };

  return (
    <Modal
      open={!!staff}
      onClose={onClose}
      size="lg"
      title={t.weeklyModal.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button
            loading={saving} loadingText={common.saving}
            onClick={async () => {
              const err = validate();
              setError(err);
              if (err) return;
              setSaving(true);
              try {
                await new Promise((r) => setTimeout(r, 320));
                onSave(draft);
              } finally {
                setSaving(false);
              }
            }}
          >
            {common.save}
          </Button>
        </>
      }
    >
      <p className="form-text mb-3">{t.weeklyModal.intro}</p>

      <div className="data-table-body">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.weeklyModal.columns.weekday}</th>
              <th>{t.weeklyModal.columns.working}</th>
              <th>{t.weeklyModal.columns.start}</th>
              <th>{t.weeklyModal.columns.end}</th>
              <th>{t.weeklyModal.columns.breakStart}</th>
              <th>{t.weeklyModal.columns.breakEnd}</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((r, i) => (
              <tr key={common.weekdays[i]}>
                <td>{common.weekdays[i]}</td>
                <td>
                  <input
                    type="checkbox" checked={r.working}
                    aria-label={t.weeklyModal.columns.working}
                    onChange={(e) => patchRow(i, { working: e.target.checked })}
                  />
                </td>
                <td>
                  <Select
                    className="form-select-sm" value={r.startTime} options={TIME_OPTIONS}
                    aria-label={t.weeklyModal.columns.start} disabled={!r.working}
                    onChange={(e) => patchRow(i, { startTime: e.target.value })}
                  />
                </td>
                <td>
                  <Select
                    className="form-select-sm" value={r.endTime} options={TIME_OPTIONS}
                    aria-label={t.weeklyModal.columns.end} disabled={!r.working}
                    onChange={(e) => patchRow(i, { endTime: e.target.value })}
                  />
                </td>
                <td>
                  <Select
                    className="form-select-sm" value={r.breakStart} options={TIME_OPTIONS}
                    aria-label={t.weeklyModal.columns.breakStart} disabled={!r.working}
                    onChange={(e) => patchRow(i, { breakStart: e.target.value })}
                  />
                </td>
                <td>
                  <Select
                    className="form-select-sm" value={r.breakEnd} options={TIME_OPTIONS}
                    aria-label={t.weeklyModal.columns.breakEnd} disabled={!r.working}
                    onChange={(e) => patchRow(i, { breakEnd: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* 班別範本管理                                                                */
/* ========================================================================== */

function TemplateModal({
  open, templates, onClose, onChange,
}: {
  open: boolean;
  templates: ShiftTemplate[];
  onClose: () => void;
  onChange: React.Dispatch<React.SetStateAction<ShiftTemplate[]>>;
}) {
  const toast = useToast();

  const EMPTY: ShiftTemplate = {
    id: '', name: '', startTime: '', endTime: '', color: '#4361ee', breakStart: '', breakEnd: '',
  };

  const [draft, setDraft] = React.useState<ShiftTemplate>(EMPTY);
  const [error, setError] = React.useState('');
  const [deleteTarget, setDeleteTarget] = React.useState<ShiftTemplate | null>(null);
  const nextId = React.useRef(1);

  React.useEffect(() => {
    if (!open) return;
    setDraft(EMPTY);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (p: Partial<ShiftTemplate>) => setDraft((d) => ({ ...d, ...p }));

  const validate = (): string => {
    if (!draft.name.trim()) return t.templateModal.nameRequired;
    if (!draft.startTime || !draft.endTime) return t.validation.timeRequired;
    if (draft.endTime <= draft.startTime) return t.validation.endAfterStart;
    if (draft.startTime < BUSINESS_HOURS.start) {
      return `${t.validation.beforeBusinessStart}${BUSINESS_HOURS.start}`;
    }
    if (draft.endTime > BUSINESS_HOURS.end) {
      return `${t.validation.afterBusinessEnd}${BUSINESS_HOURS.end}`;
    }
    if (Boolean(draft.breakStart) !== Boolean(draft.breakEnd)) return t.validation.breakBothRequired;
    if (draft.breakStart && draft.breakEnd) {
      if (draft.breakEnd <= draft.breakStart) return t.validation.breakEndAfterStart;
      const inside = draft.breakStart >= draft.startTime && draft.breakEnd <= draft.endTime;
      if (!inside) return t.validation.breakInsideShift;
    }
    return '';
  };

  const submit = () => {
    const err = validate();
    setError(err);
    if (err) return;
    /* API（shift_templates）無 breakStart/breakEnd 欄位，僅送出契約內欄位 */
    const payload = {
      name: draft.name, startTime: draft.startTime, endTime: draft.endTime, color: draft.color,
    };
    if (draft.id) {
      const id = draft.id;
      onChange(templates.map((x) => (x.id === id ? draft : x)));
      toast.show(t.templateModal.updated);
      void updateShiftTemplate(id, payload).catch((e) => {
        toast.show(e instanceof Error ? e.message : t.messages.saveFailed, 'danger');
      });
    } else {
      if (templates.length >= TEMPLATE_MAX) return;
      const localId = `tpl_new_${nextId.current++}`;
      onChange([...templates, { ...draft, id: localId }]);
      toast.show(t.templateModal.created);
      /* mock 分支回 null → 沿用本地 id；真實 API 回 {id} 後換成後端 id */
      void createShiftTemplate(payload)
        .then((res) => {
          if (res) onChange((list) => list.map((x) => (x.id === localId ? { ...x, id: res.id } : x)));
        })
        .catch((e) => {
          toast.show(e instanceof Error ? e.message : t.messages.saveFailed, 'danger');
        });
    }
    setDraft(EMPTY);
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={t.templateModal.title}
        footer={<Button variant="secondary" onClick={onClose}>{common.close}</Button>}
      >
        <p className="form-text mb-3">{t.templateModal.intro}</p>

        <h6 className="mb-2 text-base font-bold text-dark">{t.templateModal.createSectionTitle}</h6>

        <div className="grid gap-x-3 md:grid-cols-3">
          <FormGroup>
            <Label required htmlFor="tplName">{t.templateModal.name}</Label>
            <Input
              id="tplName" className="form-control-sm" value={draft.name}
              placeholder={t.templateModal.namePlaceholder}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </FormGroup>
          <FormGroup>
            <Label required htmlFor="tplStart">{t.templateModal.start}</Label>
            <Select
              id="tplStart" className="form-select-sm" value={draft.startTime} options={TIME_OPTIONS}
              onChange={(e) => patch({ startTime: e.target.value })}
            />
          </FormGroup>
          <FormGroup>
            <Label required htmlFor="tplEnd">{t.templateModal.end}</Label>
            <Select
              id="tplEnd" className="form-select-sm" value={draft.endTime} options={TIME_OPTIONS}
              onChange={(e) => patch({ endTime: e.target.value })}
            />
          </FormGroup>
          <FormGroup>
            <Label htmlFor="tplColor">{t.templateModal.color}</Label>
            <Input
              id="tplColor" type="color" className="h-8 p-1" value={draft.color}
              onChange={(e) => patch({ color: e.target.value })}
            />
          </FormGroup>
          <FormGroup>
            <Label htmlFor="tplBreakStart">{t.templateModal.breakStart}</Label>
            <Select
              id="tplBreakStart" className="form-select-sm" value={draft.breakStart} options={TIME_OPTIONS}
              onChange={(e) => patch({ breakStart: e.target.value })}
            />
          </FormGroup>
          <FormGroup>
            <Label htmlFor="tplBreakEnd">{t.templateModal.breakEnd}</Label>
            <Select
              id="tplBreakEnd" className="form-select-sm" value={draft.breakEnd} options={TIME_OPTIONS}
              onChange={(e) => patch({ breakEnd: e.target.value })}
            />
          </FormGroup>
        </div>

        <div className="btn-group mb-3">
          <Button size="sm" onClick={submit}>
            <Plus size={13} />
            {draft.id ? t.templateModal.update : t.templateModal.add}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setDraft(EMPTY); setError(''); }}>
            {t.templateModal.clear}
          </Button>
        </div>

        {error ? <FormError>{error}</FormError> : null}

        <div className="data-table-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.templateModal.columns.name}</th>
                <th>{t.templateModal.columns.range}</th>
                <th>{t.templateModal.columns.break}</th>
                <th style={{ width: '120px' }}>{t.templateModal.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={4} className="!max-w-none p-0">
                    <EmptyState icon={CalendarDays} title={t.templateModal.empty} />
                  </td>
                </tr>
              ) : (
                templates.map((tpl) => (
                  <tr key={tpl.id}>
                    <td>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="h-3 w-3 flex-shrink-0 rounded-pill"
                          style={{ backgroundColor: tpl.color }}
                        />
                        {tpl.name}
                      </span>
                    </td>
                    <td>{tpl.startTime}–{tpl.endTime}</td>
                    <td>
                      {tpl.breakStart && tpl.breakEnd
                        ? `${tpl.breakStart}–${tpl.breakEnd}`
                        : <span className="text-muted">{common.none}</span>}
                    </td>
                    <td>
                      <div className="btn-group">
                        <Button
                          variant="outline" size="sm"
                          title={t.templateModal.edit} aria-label={t.templateModal.edit}
                          onClick={() => setDraft(tpl)}
                        >
                          {t.templateModal.edit}
                        </Button>
                        <Button
                          variant="outlineDanger" size="sm"
                          title={t.templateModal.delete} aria-label={t.templateModal.delete}
                          onClick={() => setDeleteTarget(tpl)}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        danger
        title={t.templateModal.delete}
        confirmText={common.delete}
        message={t.templateModal.deleteConfirm}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            const id = deleteTarget.id;
            onChange(templates.filter((x) => x.id !== id));
            void deleteShiftTemplate(id).catch((e) => {
              toast.show(e instanceof Error ? e.message : t.messages.deleteFailed, 'danger');
            });
          }
          setDeleteTarget(null);
          toast.show(t.templateModal.deleted);
        }}
      />
    </>
  );
}

/* ========================================================================== */
/* 循環重複排班                                                                */
/* ========================================================================== */

function RepeatCycleModal({
  open, staff, weeks, anchor, shifts, onApplied, onClose,
}: {
  open: boolean;
  staff: Staff[];
  weeks: number;
  anchor: string;
  shifts: Record<string, ShiftRecord>;
  onApplied: () => void;
  onClose: () => void;
}) {
  const toast = useToast();

  const [staffId, setStaffId] = React.useState('');
  const [until, setUntil] = React.useState('');
  const [error, setError] = React.useState('');
  const [running, setRunning] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setStaffId('');
    setUntil('');
    setError('');
  }, [open]);

  const maxDate = React.useMemo(() => {
    if (!anchor) return '';
    const d = new Date(`${anchor}T00:00:00`);
    d.setDate(d.getDate() + REPEAT_MAX_DAYS);
    return toIsoDate(d);
  }, [anchor]);

  const run = async () => {
    if (!until) {
      setError(t.repeatModal.endDateRequired);
      return;
    }
    setError('');
    setRunning(true);
    try {
      /*
       * API 契約（/api/shifts/repeat-cycle）為「單週 weekPattern × 單一員工」：
       * 以檢視起始週（anchor 起 7 天，anchor 為週日 → 第 i 天即星期 i）取樣成
       * weekPattern（套模板的班 → templateId；設休 → null；空格或自訂時間班 →
       * 不出現，該日既有班保留），每位員工各送一次、加總結果；
       * from 從檢視循環結束的次日開始，避免覆蓋來源週的自訂班。
       */
      const targets = staffId ? staff.filter((s) => s.id === staffId) : staff;
      const items: { staffId: string; weekPattern: Record<string, string | null> }[] = [];
      for (const s of targets) {
        const pattern: Record<string, string | null> = {};
        for (let i = 0; i < 7; i++) {
          const d = new Date(`${anchor}T00:00:00`);
          d.setDate(d.getDate() + i);
          const rec = shifts[toKey(s.id, toIsoDate(d))];
          if (!rec) continue;
          if (rec.type === 'OFF') pattern[String(i)] = null;
          else if (rec.templateId) pattern[String(i)] = rec.templateId;
        }
        if (Object.keys(pattern).length > 0) items.push({ staffId: s.id, weekPattern: pattern });
      }
      const fromD = new Date(`${anchor}T00:00:00`);
      fromD.setDate(fromD.getDate() + weeks * 7);
      const res = await repeatShiftCycles(items, toIsoDate(fromD), until);
      const skipped = res.clearedDates - res.inserted;
      toast.show(
        `${t.repeatModal.applied(res.inserted)}${skipped > 0 ? t.repeatModal.appliedSkipped(skipped) : ''}`,
      );
      onApplied();
      onClose();
    } catch (e) {
      toast.show(
        `${t.repeatModal.failedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.repeatModal.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button loading={running} loadingText={common.processing} onClick={() => void run()}>
            {t.repeatModal.start}
          </Button>
        </>
      }
    >
      <p className="form-text mb-3">
        {t.repeatModal.cycleLead}
        <strong>{weeks}</strong>
        {t.repeatModal.cycleTail(weeks)}
      </p>

      <FormGroup>
        <Label htmlFor="repeatStaff">{t.repeatModal.targetLabel}</Label>
        <Select
          id="repeatStaff" value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
        >
          <option value="">{t.repeatModal.targetAll}</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </FormGroup>

      <FormGroup>
        <Label required htmlFor="repeatUntil">{t.repeatModal.untilLabel}</Label>
        <Input
          id="repeatUntil" type="date" value={until} min={anchor} max={maxDate}
          onChange={(e) => setUntil(e.target.value)}
        />
        <FormText>
          {t.repeatModal.maxHint}
          {maxDate ? formatDate(maxDate) : t.cell.dash}
          {t.repeatModal.maxHintTail}
        </FormText>
      </FormGroup>

      <Alert tone="warning">
        {t.repeatModal.warning}
        <strong>{weeks}</strong>
        {t.repeatModal.warningTail}
      </Alert>

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}
