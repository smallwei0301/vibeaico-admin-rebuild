# 本機文件保存清單（2026-09-04）

本資料夾保存本次執行環境 `/mnt/data` 中發現的全部 3 份本機文件。

## 保存結果

| 本機來源 | Repo 存檔 | 處理方式 |
|---|---|---|
| `Sol.md` | `Sol.md` | 原文保存；秘密掃描未發現 token／金鑰／email。 |
| `跨專案派工協議.txt` | `跨專案派工協議.txt` | 原文保存；秘密掃描未發現 token／金鑰／email。 |
| `tour platform - 接管專案並持續施工.html` | `tour-platform-接管專案並持續施工.redacted.html` 與 `.redacted.md` | 原始檔含 ChatGPT 登入／工作階段憑證，禁止直接進公開 repo；已移除 script、token、帳號資料與介面程式，只保留可見對話文字。 |

## 原始檔 SHA-256

```json
[
  {
    "source": "Sol.md",
    "size_bytes": 11854,
    "sha256": "2cabea12c8023ce782c1a22ad29d349d80cd472e5c6454358da7a3f1fc1f5240"
  },
  {
    "source": "tour platform - 接管專案並持續施工.html",
    "size_bytes": 794296,
    "sha256": "dcd8828893bd836d0acc6155813f27c253dbeba24d27b8d9dfcc4fb9d2dee945"
  },
  {
    "source": "跨專案派工協議.txt",
    "size_bytes": 781,
    "sha256": "5322f2ccb96397d8676ba87a5f3a416386dccbf7e2ccf9fc598c9cd48928c654"
  }
]
```

## 安全界線

- 原始 HTML **沒有**提交到 repo。
- 存檔中不包含 `.env`、GitHub token、OpenAI／ChatGPT access token、session token 或 JWT。
- 此資料夾是歷史施工／交接證據，不是 current truth；後續接管仍須重新讀取 GitHub `main`、PR、Issue 與 CI。
