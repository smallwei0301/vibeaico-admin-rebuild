# Owner 裁示：Product throughput recovery

日期：2026-10-06。來源：Owner 直接交辦 GOVERNANCE_OPTIMIZATION / PRODUCT_THROUGHPUT_RECOVERY。本記錄為環境成果遺失後依原裁示與 current main 重新施工，尚未合併時不代表現行 main 已採用。

最高目標是保留真正防止 Production、跨租戶、付款、migration、partial apply 事故的閘門，移除重複證明、錯誤阻擋與產品全面停工。不得以「更安全」作為新增gate的充分理由。

- A：machine-ready Production DB不再錯等Owner；退化要指出失效machine evidence。政策外reset/seed/destructive/payment/provider等授權不擴張。
- B：可比較的current-main同源unrelated failure與candidate regression分開；共享hot boundary或未知仍failclosed。
- C：Release Guard v1 freeze，先使用現有工具完成真實release；只修actual run揭露且未被既有gate覆蓋的可重現風險。
- D：Lane A環境交付、Lane B使用者可見產品；獨立產品不因環境債務全面停止，保留capacity/ownership/isolation。
- E：merge後truth sync與安全相容性仍阻塞；行政文書背景收尾，不阻止下一個安全bounded slice。
- Product成果分 USER_VISIBLE_PRODUCT／ENVIRONMENT_DELIVERY／PRODUCT_INFRA，不混算可見產品throughput。

正式操作規則回併 `../AGENT-EXECUTION.md` 相應章節，本記錄不建立新的validator、approval或權限。main migration、exact bytes/digest、canonical TEST、tenant/RLS正反例、Production identity、controlled writer/lock、apply前recheck、G7、payment/refund Final Risk、destructive failclosed、跨租戶及partial apply/APPLY_UNKNOWN/reset/seed防護均保留。

歷史readiness證據：[run 37405805863](https://github.com/smallwei0301/vibeaico-admin-rebuild/actions/runs/37405805863) 於2026-10-06 02:48:12 UTC、exact main e951f4a4記錄AUTOMATION_READY=true、POLICY_GATED_ACTIVE、perRunOwnerApproval=NOT_REQUIRED、blockers=[]，同時databaseMutationAuthorized=false。它只證明當時readiness，不代表目前G0–G7或Production apply通過；每次release仍須重新核當前有效證據。
