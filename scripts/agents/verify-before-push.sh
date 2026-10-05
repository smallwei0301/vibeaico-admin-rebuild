#!/usr/bin/env bash
# 推送前驗證入口（#787，PB-038 升級）。
#
# PB-038：在對話裡臨時拼裝「驗證 ; git push」時，`;` 與管線會吃掉退出碼，讓紅燈或 fetch
# 失敗之後的 git 動作照跑（四次：PR #416、PR #77、PR #784 …）。本腳本把整條鏈固定成
# `set -euo pipefail`：任何一步失敗都非零退出，而且 push 只會在全部檢查通過之後、由本腳本
# 自己執行。
#
# 用法：
#   scripts/agents/verify-before-push.sh [--remote <name>] [--push] [--] [vitest 目標…]
#
#   --remote <name>  遠端名稱（預設 origin）
#   --push           全部通過後執行 `git push -u <remote> <branch>`；不帶時只驗證
#   vitest 目標      指定時只跑這些測試（`npx vitest run <目標…>`）；未指定時跑 `npm test`
#
# 檢查順序（任一失敗即停止，不 push）：
#   1. 目前在具名分支上（不是 detached HEAD）
#   2. 工作樹與暫存區乾淨（未 commit 的內容不會被推送，也就沒有被驗證）
#   3. `git fetch --prune <remote>` 成功
#   4. `git ls-remote` 確認遠端分支狀態；遠端已存在時，本機 HEAD 必須包含遠端 head（fast-forward）
#   5. typecheck
#   6. unit tests
#
# 測試用的覆寫（只供 tests/unit/verify-before-push.787.test.ts 使用）：
#   VBP_TYPECHECK_CMD、VBP_TEST_CMD 取代預設的 typecheck／test 指令。
set -euo pipefail

remote="origin"
do_push=false
targets=()

while (($#)); do
  case "$1" in
    --remote)
      [[ $# -ge 2 && -n "$2" ]] || { echo "VERIFY_FAILED: --remote 需要遠端名稱" >&2; exit 2; }
      remote="$2"
      shift 2
      ;;
    --push)
      do_push=true
      shift
      ;;
    --)
      shift
      targets+=("$@")
      break
      ;;
    -*)
      echo "VERIFY_FAILED: 未知選項 $1" >&2
      exit 2
      ;;
    *)
      targets+=("$1")
      shift
      ;;
  esac
done

fail() {
  echo "VERIFY_FAILED: $*" >&2
  exit 1
}

branch="$(git symbolic-ref --quiet --short HEAD)" || fail "目前是 detached HEAD，請切到要推送的分支"

if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "工作樹或暫存區有未 commit 的變更；先 commit（或移除）再驗證"
fi
if [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  fail "有未追蹤的檔案；先 commit、移除或加入 .gitignore 再驗證"
fi

echo "STEP: git fetch --prune ${remote}"
git fetch --prune "$remote" || fail "git fetch --prune ${remote} 失敗；不得以舊的 remote-tracking ref 繼續"

echo "STEP: git ls-remote ${remote} refs/heads/${branch}"
remote_line="$(git ls-remote --exit-code --heads "$remote" "refs/heads/${branch}")" && remote_status=0 || remote_status=$?
if ((remote_status == 0)); then
  remote_sha="${remote_line%%[[:space:]]*}"
  git merge-base --is-ancestor "$remote_sha" HEAD \
    || fail "遠端 ${remote}/${branch}（${remote_sha}）不是本機 HEAD 的祖先；推送會是非 fast-forward，請先整合遠端變更"
  echo "REMOTE_BRANCH: ${branch} @ ${remote_sha}（本機 HEAD 已包含）"
elif ((remote_status == 2)); then
  echo "REMOTE_BRANCH: ${branch} 尚不存在於 ${remote}（新分支）"
else
  fail "git ls-remote ${remote} 失敗（exit ${remote_status}）"
fi

echo "STEP: typecheck"
if [[ -n "${VBP_TYPECHECK_CMD:-}" ]]; then
  bash -c "$VBP_TYPECHECK_CMD" || fail "typecheck 失敗"
else
  npm run typecheck || fail "typecheck 失敗"
fi

echo "STEP: unit tests"
if [[ -n "${VBP_TEST_CMD:-}" ]]; then
  bash -c "$VBP_TEST_CMD" || fail "unit tests 失敗"
elif ((${#targets[@]})); then
  npx vitest run "${targets[@]}" || fail "unit tests 失敗：${targets[*]}"
else
  npm test || fail "unit tests 失敗"
fi

head_sha="$(git rev-parse HEAD)"
echo "VERIFY_PASS: ${branch} @ ${head_sha}"

if [[ "$do_push" == true ]]; then
  echo "STEP: git push -u ${remote} ${branch}"
  git push -u "$remote" "$branch" || fail "git push 失敗"
  echo "PUSHED: ${branch} @ ${head_sha}"
fi
