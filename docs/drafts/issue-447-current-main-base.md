# #447 current-main base

- Candidate branch start: `faff7991b555cf052d3b0c9c312f0e45f1e761fe`
- That commit already contains #445 policy, #444 read-only preflight/backup/consistency, and #446 Production DB Final Risk release-evidence adapter.
- Any later main advancement must be checked for overlap with the controlled-writer files before merge; unrelated advancement does not by itself invalidate semantic evidence.
