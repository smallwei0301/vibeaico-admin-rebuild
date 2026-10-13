import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const base = "src/app/s/[shopCode]/";

describe("#883 my-orders 連結不外洩聯絡方式", () => {
  it("狀態頁連到 my-orders 的連結不帶 contact query", () => {
    const src = read(`${base}requests/[orderId]/page.tsx`);
    expect(src).toContain("href={`/s/${shopCode}/my-orders`}");
    expect(src).not.toMatch(/my-orders\?contact/);
    expect(src).not.toMatch(/my-orders[^`'"]*contact=/);
  });

  it("my-orders page 與元件不再讀取或傳遞 contact／initialContact", () => {
    for (const f of ["my-orders/page.tsx", "my-orders/MyOrdersSearch.tsx"]) {
      const src = read(`${base}${f}`);
      expect(src).not.toMatch(/initialContact/);
      expect(src).not.toMatch(/searchParams/);
      expect(src).not.toMatch(/\bcontact\b\s*[}=,?:]/);
    }
  });
});
