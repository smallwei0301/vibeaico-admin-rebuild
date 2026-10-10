/** Executes actual page callbacks with a minimal hook-state harness; NOT mounted DOM/React lifecycle QA. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { registerPage as t } from '@/i18n/zh-TW/pages/register';
import { MODE_PRESETS } from '@/config/modes';
import { common } from '@/i18n/zh-TW/common';
import { SHOP_CODE_PATTERN } from '@/lib/shop-code';
const h = { values: [] as any[], cursor: 0, effects: [] as Array<() => any>, send: vi.fn(), toast: vi.fn() };
const react = { ...React,
  useState(initial: any) { const i = h.cursor++; if (!(i in h.values)) h.values[i] = typeof initial === 'function' ? initial() : initial; return [h.values[i], (next: any) => { h.values[i] = typeof next === 'function' ? next(h.values[i]) : next; }]; },
  useRef(initial: any) { const i = h.cursor++; if (!(i in h.values)) h.values[i] = { current: initial }; return h.values[i]; },
  useEffect(effect: () => any) { h.effects.push(effect); },
};
// Transpile the actual page (repo JSX=preserve intentionally serves Next). No copied handler.
const compiled = ts.transpileModule(readFileSync('src/app/tenant/register/page.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const exported: any = {};
runInNewContext(compiled, { exports: exported, setTimeout, clearTimeout, require(name: string) {
  if (name === 'react') return react;
  if (name === 'next/navigation') return { useRouter: () => ({ push: vi.fn() }) };
  if (name === '@/components/ui/Toast') return { useToast: () => ({ show: h.toast }) };
  if (name === '@/services') return { getOAuthStatus: vi.fn(), registerTenant: vi.fn(), sendVerificationCode: h.send };
  if (name === '@/config/modes') return { MODE_PRESETS };
  if (name === '@/lib/utils') return { cn: (...args: any[]) => args.filter(Boolean).join(' ') };
  if (name === '@/lib/shop-code') return { SHOP_CODE_PATTERN };
  if (name === '@/i18n/zh-TW/common') return { common };
  if (name === '@/i18n/zh-TW/pages/register') return { registerPage: t };
  if (name === '@/lib/api') return { ApiError: Error };
  if (name === 'next/link') return { __esModule: true, default: 'Link' };
  if (name.startsWith('@/components/') || name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) });
  throw new Error(`Unexpected dependency: ${name}`);
} });
const RegisterPage = exported.default;
function render(): any { h.cursor = 0; h.effects = []; return RegisterPage(); }
function all(node: any): any[] { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(all); return [node, ...all(node.props?.children)]; }
function input(tree: any, id: string): any { return all(tree).find(n => n.props?.id === id); }
function sendButton(tree: any): any { return all(tree).find(n => n.props?.type === 'button' && n.props?.variant === 'outline' && n.props?.disabled !== undefined && typeof n.props?.onClick === 'function'); }
function change(id: string, value: string) { input(render(), id).props.onChange({ target: { value } }); }
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred() { let resolve!: () => void; let reject!: (e: unknown) => void; const promise = new Promise<void>((a,b) => { resolve=a;reject=b; }); return { promise,resolve,reject }; }
beforeEach(() => { h.values=[]; h.cursor=0; h.effects=[]; vi.clearAllMocks(); h.send.mockResolvedValue(undefined); });
describe('actual register page verification-code feedback', () => {
  it('email edit clears code, old sent hint and old cooldown', async () => {
    change('email','a@example.test'); sendButton(render()).props.onClick(); await tick();
    change('verificationCode','123456'); change('email','b@example.test');
    const tree=render(); expect(input(tree,'verificationCode').props.value).toBe('');
    expect(all(tree).some(n=>n.props?.children===t.messages.codeSent)).toBe(false);
    expect(sendButton(tree).props.disabled).toBe(false);
  });
  it.each(['resolve','reject'] as const)('old %s cannot mark changed email as sent or show stale toast', async (settle) => {
    const d=deferred(); h.send.mockReturnValue(d.promise); change('email','a@example.test'); sendButton(render()).props.onClick();
    change('email','b@example.test'); h.toast.mockClear(); d[settle](new Error('old')); await tick();
    expect(h.toast).not.toHaveBeenCalled(); expect(sendButton(render()).props.disabled).toBe(false);
    expect(all(render()).some(n=>n.props?.children===t.messages.codeSent)).toBe(false);
  });
  it('same-render repeated clicks make only one request', async () => {
    const d=deferred(); h.send.mockReturnValue(d.promise); change('email','a@example.test');
    const button=sendButton(render()); button.props.onClick();button.props.onClick();
    expect(h.send).toHaveBeenCalledTimes(1);d.resolve();await tick();
  });
  it('A → B → A still discards the first email request', async () => {
    const d=deferred(); h.send.mockReturnValue(d.promise); change('email','a@example.test'); sendButton(render()).props.onClick();
    change('email','b@example.test');change('email','a@example.test'); d.resolve();await tick();
    expect(h.toast).not.toHaveBeenCalled();expect(sendButton(render()).props.disabled).toBe(false);
  });
  it('old completion cannot unlock a newer request', async () => {
    const old=deferred();const newer=deferred();h.send.mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    change('email','a@example.test');sendButton(render()).props.onClick();change('email','b@example.test');sendButton(render()).props.onClick();
    old.resolve();await tick();expect(sendButton(render()).props.disabled).toBe(true);expect(h.toast).not.toHaveBeenCalled();
    newer.resolve();await tick();expect(h.toast).toHaveBeenCalledExactlyOnceWith(`${t.messages.codeSentToPrefix}b@example.test`);
    expect(all(render()).some(n=>n.props?.children===t.messages.codeSent)).toBe(true);
  });
  it('changing unrelated fields preserves current valid code feedback', async () => {
    change('email','a@example.test');sendButton(render()).props.onClick();await tick();change('verificationCode','123456');change('name','Shop');
    expect(input(render(),'verificationCode').props.value).toBe('123456');
    expect(all(render()).some(n=>n.props?.children===t.messages.codeSent)).toBe(true);
    expect(sendButton(render()).props.disabled).toBe(true);
  });
  it('cleanup invalidates a pending callback without a later toast', async () => {
    const d=deferred();h.send.mockReturnValue(d.promise);change('email','a@example.test');sendButton(render()).props.onClick();render();
    const cleanup=h.effects[0]();cleanup();d.resolve();await tick();expect(h.toast).not.toHaveBeenCalled();
    expect(all(render()).some(n=>n.props?.children===t.messages.codeSent)).toBe(false);
  });

});
