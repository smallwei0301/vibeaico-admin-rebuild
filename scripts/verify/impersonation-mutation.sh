#!/usr/bin/env bash
#
# scripts/verify/impersonation-mutation.sh
# -----------------------------------------------------------------------------
# 規格：docs/integration/21-PLATFORM-ADMIN-IMPERSONATION.md §7
#
# 「測試綠」本身不證明測試在守什麼（PB-029）。這支腳本把 §7 明列的四個變異
# 逐一注入原始碼，每次都必須讓對應的測試**轉紅**；有任何一個變異之後測試仍然綠，
# 代表那條防線其實沒有被守住，腳本以非零結束。
#
# 用法：bash scripts/verify/impersonation-mutation.sh
# 這支腳本會改動工作目錄的檔案，結束前（含中途失敗、Ctrl-C）一律還原。
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

PA=src/server/platform-admin.ts
HTTP=src/server/http.ts
TENANT=src/server/tenant.ts

restore() { git checkout -- "$PA" "$HTTP" "$TENANT" 2>/dev/null || true; }
trap restore EXIT INT TERM

if ! git diff --quiet -- "$PA" "$HTTP" "$TENANT"; then
  echo "✗ $PA / $HTTP / $TENANT 有未提交的改動，請先 commit 或 stash（本腳本會 git checkout 還原它們）。" >&2
  exit 2
fi

fail=0

# $1 說明  $2 目標檔  $3 要刪掉/替換的字串  $4 替換成什麼（空字串＝刪除該行）  $5 測試檔
mutate() {
  local label=$1 file=$2 needle=$3 replacement=$4 spec=$5
  restore
  python3 - "$file" "$needle" "$replacement" <<'PY' || { echo "✗ $label：找不到變異錨點" >&2; fail=1; return; }
import io, sys
path, needle, replacement = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(path, encoding='utf-8').read()
if s.count(needle) != 1:
    print(f'anchor count = {s.count(needle)}', file=sys.stderr)
    raise SystemExit(1)
io.open(path, 'w', encoding='utf-8').write(s.replace(needle, replacement, 1))
PY
  if npx vitest run "$spec" >/tmp/mut.log 2>&1; then
    echo "✗ $label：注入變異後測試仍然綠 —— 這條防線沒有被守住"
    tail -20 /tmp/mut.log
    fail=1
  else
    echo "✓ $label：測試如預期轉紅"
  fi
  restore
}

echo "── 變異測試（六個都必須轉紅）───────────────────────────────"

mutate "變異 1：拿掉條件 ④（platform_admins 仍 active）" \
  "$PA" \
  '  if (!(await isPlatformAdmin(data.admin_user_id as string))) return null; // ④' \
  '' \
  tests/unit/platform-impersonation.test.ts

mutate "變異 2：拿掉條件 ⑤（session 屬於當前登入者）" \
  "$PA" \
  '  if (data.admin_user_id !== currentUserId) return null;             // ⑤' \
  '' \
  tests/unit/platform-impersonation.test.ts

mutate "變異 3：拿掉 handle() 裡的記錄" \
  "$HTTP" \
  '  if (!impersonation) return fn(req, ctx); // ②' \
  '  if (true) return fn(req, ctx); // ②' \
  tests/unit/impersonation-write-audit.test.ts

mutate "變異 4：拿掉 expires_at 檢查（條件 ③）" \
  "$PA" \
  '  if (new Date(data.expires_at as string) <= new Date()) return null; // ③' \
  '' \
  tests/unit/platform-impersonation.test.ts

# 第 5 個不在 §7 的清單裡，是最終風險評估抓到 fail-open 之後補的：
# 稽核層原本 catch-all 吞掉所有錯誤，DB 瞬時故障時寫入會在代登入下無紀錄執行。
mutate "變異 5（額外）：把稽核層的 fail-closed 改回吞掉所有錯誤" \
  "$HTTP" \
  '    if (e instanceof ApiHttpError && e.status === 401) {' \
  '    if (true) {' \
  tests/unit/impersonation-write-audit.test.ts

# 第 6 個是最終風險評估第二輪抓到的：requireUser() 不看 getUser() 的 error，
# 於是 Auth 服務故障被降級成 401，稽核層把它當合法未登入而放行。
mutate "變異 6（額外）：讓 requireUser 不再檢查 getUser 的 error" \
  "$TENANT" \
  '  if (error && !isMissingSessionError(error)) {' \
  '  if (false) {' \
  tests/unit/tenant.test.ts

echo "────────────────────────────────────────────────────────────"
if (( fail )); then
  echo "結果：有變異沒有被測試抓到。"
  exit 1
fi
echo "結果：六個變異全部被抓到。"
