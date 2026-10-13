import { z, ZodIssueCode, ZodParsedType } from 'zod';
import { validationMessages as m } from '@/i18n/zh-TW/validation';

/**
 * Zod 全域錯誤訊息繁中化（#930）。
 * 優先序（zod v3）：issue 自帶 message／schema 的 errorMap > contextual errorMap > 此 global map，
 * 因此 schema 自訂 message 不受影響；這裡只負責「沒人自訂時」的預設訊息。
 */
export const zhErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type: {
      if (issue.received === ZodParsedType.undefined) return { message: m.required };
      const key = issue.expected === ZodParsedType.integer ? 'integer' : String(issue.expected);
      const map = m.invalidType as Record<string, string>;
      return { message: map[key] ?? m.invalidType.other };
    }
    case ZodIssueCode.too_small: {
      const kind = issue.exact ? 'Exact' : issue.inclusive ? 'Inclusive' : 'Exclusive';
      const t = m.tooSmall;
      const n = String(issue.minimum);
      if (issue.type === 'string') return { message: t[`string${kind}`](n) };
      if (issue.type === 'array' || issue.type === 'set') return { message: t[`array${kind}`](n) };
      if (issue.type === 'number' || issue.type === 'bigint') return { message: t[`number${kind}`](n) };
      if (issue.type === 'date') return { message: t[`date${kind}`](new Date(Number(issue.minimum)).toISOString()) };
      return { message: m.fallback };
    }
    case ZodIssueCode.too_big: {
      const kind = issue.exact ? 'Exact' : issue.inclusive ? 'Inclusive' : 'Exclusive';
      const t = m.tooBig;
      const n = String(issue.maximum);
      if (issue.type === 'string') return { message: t[`string${kind}`](n) };
      if (issue.type === 'array' || issue.type === 'set') return { message: t[`array${kind}`](n) };
      if (issue.type === 'number' || issue.type === 'bigint') return { message: t[`number${kind}`](n) };
      if (issue.type === 'date') return { message: t[`date${kind}`](new Date(Number(issue.maximum)).toISOString()) };
      return { message: m.fallback };
    }
    case ZodIssueCode.invalid_string: {
      const v = issue.validation;
      if (typeof v === 'object' && v !== null) {
        if ('startsWith' in v) return { message: m.invalidString.startsWith(v.startsWith) };
        if ('endsWith' in v) return { message: m.invalidString.endsWith(v.endsWith) };
        if ('includes' in v) return { message: m.invalidString.includes(v.includes) };
        return { message: m.invalidString.other };
      }
      const map = m.invalidString as Record<string, unknown>;
      const hit = map[v];
      return { message: typeof hit === 'string' ? hit : m.invalidString.other };
    }
    case ZodIssueCode.invalid_enum_value:
      return { message: m.invalidEnum(issue.options.map(String).join('、')) };
    case ZodIssueCode.invalid_literal:
      return { message: m.invalidLiteral(JSON.stringify(issue.expected)) };
    case ZodIssueCode.not_multiple_of:
      return { message: m.notMultipleOf(String(issue.multipleOf)) };
    case ZodIssueCode.not_finite:
      return { message: m.notFinite };
    case ZodIssueCode.invalid_date:
      return { message: m.invalidDate };
    case ZodIssueCode.unrecognized_keys:
      return { message: m.unrecognizedKeys(issue.keys.join('、')) };
    case ZodIssueCode.invalid_union:
      return { message: m.invalidUnion };
    case ZodIssueCode.invalid_union_discriminator:
      return { message: m.invalidUnionDiscriminator };
    case ZodIssueCode.invalid_intersection_types:
      return { message: m.invalidIntersection };
    case ZodIssueCode.custom:
      // custom 若沒帶 message，zod 預設是 "Invalid input"；有帶就用它（ctx.defaultError 即為自帶訊息）。
      return { message: ctx.defaultError && ctx.defaultError !== 'Invalid input' ? ctx.defaultError : m.custom };
    default:
      return { message: m.fallback };
  }
};

export function installZhErrorMap(): void {
  z.setErrorMap(zhErrorMap);
}
