# Safe session handoff archive, 2026-09-04

This directory preserves the local closeout package requested by the Owner. It is a historical handoff, **not current project truth**. Before resuming product work, re-read the live `main`, open Issues/PRs and exact-head CI.

## Why the archive is split

The connected GitHub write transport has a bounded text-field size. The lossless `tar.gz` archive is therefore stored as five binary parts. Reassemble them in lexical order:

```bash
cat safe-session-handoff-2026-09-04.tar.gz.part-*.bin \
  > safe-session-handoff-2026-09-04.tar.gz
sha256sum safe-session-handoff-2026-09-04.tar.gz
tar -xzf safe-session-handoff-2026-09-04.tar.gz
```

Expected archive SHA-256:

```text
454edbef0a411d58967ed91e354b26fa24003cd2ffa60357c45f7fc8412d46ea
```

## Part checksums

| Part | Bytes | SHA-256 |
|---|---:|---|
| `part-00.bin` | 3600 | `4926feb6b1bc0e8ee0b1061a8540dbf3c3f416befedb8d7cf11f9b7bbd948ab9` |
| `part-01.bin` | 3600 | `077e891cd2e01f296c23a2e29f9f432c6b4c0015e7aa20a269c8f43c978529f2` |
| `part-02.bin` | 3600 | `af9bea340979856b40c59f050d0d0bfe765b67d8d507c1f9341ac70dd652dd98` |
| `part-03.bin` | 3600 | `46ca3d8e2f51a35d0f588c89ef03651a0e3244538c664ecd22cd126c7ff3b453` |
| `part-04.bin` | 3439 | `5c34bdb4188b836245f4960fab70604a72e4b8a904e63f22fd3def1b5bcd96d6` |

## Safe contents inside the archive

```text
docs/archive/session-handoffs/2026-09-04/
├── README.md
├── MANIFEST.md
├── CLOSEOUT-STATUS.md
├── Sol.md
├── 跨專案派工協議.txt
└── tour-platform-session-export.sanitized.md
```

The six files are preserved exactly as prepared during closeout. The full sanitized conversation document is 22,086 bytes with SHA-256:

```text
28b7a46c38dc732868551cddf5212da628acfa79c17a071e3e1a49dca031303f
```

## Security handling

- The original raw ChatGPT HTML export is excluded because it embedded authentication/session tokens and personal application bootstrap data.
- No `.env`, GitHub token, Supabase/Vercel/LINE secret, password, cookie or authorization header is stored here.
- The original raw HTML checksum remains inside `MANIFEST.md` for traceability without publishing the secret-bearing bytes.
- No Production, TEST database, payment, refund, notification or deployment action is represented by this archive.

Historical note: `CLOSEOUT-STATUS.md` correctly records that the earlier closeout session had not pushed to GitHub. This later documentation PR is the follow-up publication step and does not rewrite that checkpoint.
