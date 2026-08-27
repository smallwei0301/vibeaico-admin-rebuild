# 2026-08-27 Owner Decision — 團次導遊指派與加購業績 C+

## 決策

Owner 確認採用下列產品架構：

- 方案不綁導遊。
- 團次才指派實際執行人員。
- 團次支援一位主導遊與多位協同導遊。
- 開團／改團必須與員工班表、一般預約、封鎖時段、其他團次做雙向撞班檢查。
- 一般服務預約也必須反向排除已被團次占用的導遊。
- 加購業績採 C+：預設歸團次主導遊，可逐筆改派其他人，或選擇不計個人業績。
- 0 元加購允許，負數禁止。

## 原因

方案是販售規則，同一方案不同日期可能由不同導遊執行；若把人員綁在方案，會把商品定義和實際排班混在一起。

現有 repo 已有 `shifts + bookings + block_times` 的人員可用性判斷，但舊 `trip_departures` 尚未記錄實際帶團人員，因此無法做到人員級精準防撞。這次決策補上團次人員關聯、雙向排班判斷與可追溯的加購業績快照。

## Canonical 規格

- `docs/integration/10-TOUR-DOMAIN.md`
- `docs/integration/10-TOUR-DOMAIN-CHECKLIST.md`

若歷史 Issue、舊 branch 補充文件、0020 migration 註解或其他舊文件與上述規則衝突，以本次 Owner Decision 與 `main` 的 10 分冊為準。
