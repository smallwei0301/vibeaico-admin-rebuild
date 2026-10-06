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
#   --push           全部通過後推送鎖定的 SHA 並設定 upstream；不帶時只驗證
#   vitest 目標      指定時只跑這些測試（`npx vitest run <目標…>`）；未指定時跑 `npm test`
#
# 檢查順序（任一失敗即停止，不 push）：
#   1. 目前在具名分支上（不是 detached HEAD）
#   2. 工作樹與暫存區乾淨（未 commit 的內容不會被推送，也就沒有被驗證）
#   3. `git fetch --prune <remote>` 成功
#   4. `git ls-remote` 確認遠端分支狀態；遠端已存在時，本機 HEAD 必須包含遠端 head（fast-forward）
#   5. typecheck
#   6. unit tests
#   7. 分支、HEAD 與工作樹在驗證期間都沒有改變；push 的是一開始鎖定的那個 SHA
#      （`git push <remote> <sha>:refs/heads/<branch>`），不是驗證結束時才讀到的 HEAD
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

assert_clean_tree() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    fail "工作樹或暫存區有未 commit 的變更$1；先 commit（或移除）再驗證"
  fi
  if [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    fail "有未追蹤的檔案$1；先 commit、移除或加入 .gitignore 再驗證"
  fi
}
assert_clean_tree ""

# 鎖定本次要驗證、也是唯一會被推送的 commit；驗證期間 HEAD 若改變就拒絕推送。
head_sha="$(git rev-parse HEAD)"
echo "VERIFY_HEAD: ${branch} @ ${head_sha}"

echo "STEP: git fetch --prune ${remote}"
git fetch --prune "$remote" || fail "git fetch --prune ${remote} 失敗；不得以舊的 remote-tracking ref 繼續"

echo "STEP: git ls-remote ${remote} refs/heads/${branch}"
remote_line="$(git ls-remote --exit-code --heads "$remote" "refs/heads/${branch}")" && remote_status=0 || remote_status=$?
if ((remote_status == 0)); then
  remote_sha="${remote_line%%[[:space:]]*}"
  git merge-base --is-ancestor "$remote_sha" "$head_sha" \
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

# 驗證期間不得改變分支、HEAD 或工作樹：推送的必須正是上面驗證過的 commit。
now_branch="$(git symbolic-ref --quiet --short HEAD)" || fail "驗證期間 HEAD 變成 detached；拒絕推送"
[[ "$now_branch" == "$branch" ]] || fail "驗證期間分支由 ${branch} 變成 ${now_branch}；拒絕推送"
now_sha="$(git rev-parse HEAD)"
[[ "$now_sha" == "$head_sha" ]] || fail "驗證期間 HEAD 由 ${head_sha} 變成 ${now_sha}；新 commit 未經驗證，拒絕推送"
assert_clean_tree "（驗證期間產生）"
echo "VERIFY_PASS: ${branch} @ ${head_sha}"

if [[ "$do_push" == true ]]; then
  echo "STEP: git push ${remote} ${head_sha}:refs/heads/${branch}"
  git push "$remote" "${head_sha}:refs/heads/${branch}" || fail "git push 失敗"
  # 從這裡開始遠端已經更新；之後的步驟失敗不得回報成「沒有推送」。
  echo "PUSHED: ${branch} @ ${head_sha}"
  # 以 SHA 為來源的 refspec 不會被 -u 設成追蹤分支；推送成功後明確寫入 upstream 設定。
  if git config "branch.${branch}.remote" "$remote" && git config "branch.${branch}.merge" "refs/heads/${branch}"; then
    echo "UPSTREAM: ${remote}/${branch}"
  else
    echo "UPSTREAM_WARNING: 已推送 ${head_sha}，但寫入 branch.${branch}.remote／merge 失敗；請手動 git branch --set-upstream-to=${remote}/${branch}" >&2
  fi
fi
