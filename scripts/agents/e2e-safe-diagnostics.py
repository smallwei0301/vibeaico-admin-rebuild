"""Export bounded API metadata; never publish raw Playwright traces or DOM snapshots."""
import json
import re
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")
API = re.compile(r"/api/(?:auth/me|trips(?:/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:/publish)?)?)\Z")
RESOURCE = re.compile(r"[0-9a-f]{40}(?:\.[a-z0-9]+)?\Z")
FIXTURE_TITLE = re.compile(r"E2E行程-[a-z0-9]+(?:-已編輯)?\Z")


def identifier(value):
    return value if isinstance(value, str) and UUID.fullmatch(value) else None


def safe_data(pathname, payload):
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, (dict, list)):
        return None
    if pathname == "/api/auth/me" and isinstance(data, dict):
        return {"tenantId": identifier(data.get("tenantId")),
                "role": data.get("role") if data.get("role") in ("OWNER", "MANAGER", "STAFF") else None}
    rows = data if isinstance(data, list) else data.get("content", [data])
    if not isinstance(rows, list):
        return None
    result = []
    for row in rows[:1000]:
        if not isinstance(row, dict):
            continue
        title = row.get("title")
        result.append({"id": identifier(row.get("id")),
                       "tenantId": identifier(row.get("tenantId", row.get("tenant_id"))),
                       "status": row.get("status") if row.get("status") in ("DRAFT", "PUBLISHED", "ARCHIVED") else None,
                       "fixtureTitle": title if isinstance(title, str) and FIXTURE_TITLE.fullmatch(title) else None})
    return {"rowCount": len(rows), "rows": result}


def summarize(trace):
    result = {"status": "READ", "requests": []}
    try:
        with zipfile.ZipFile(trace) as archive:
            for name in archive.namelist():
                if not name.endswith(".network") or archive.getinfo(name).file_size > 32 * 1024 * 1024:
                    continue
                for line in archive.read(name).splitlines()[:10000]:
                    if len(line) > 1024 * 1024:
                        continue
                    event = json.loads(line)
                    snapshot = event.get("snapshot", {}) if isinstance(event, dict) else {}
                    request, response = snapshot.get("request", {}), snapshot.get("response", {})
                    pathname = urlsplit(request.get("url", "")).path
                    if not API.fullmatch(pathname):
                        continue
                    method, status = request.get("method"), response.get("status")
                    record = {"pathname": pathname,
                              "method": method if method in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS") else None,
                              "httpStatus": status if isinstance(status, int) and not isinstance(status, bool) and 100 <= status <= 599 else None}
                    resource = response.get("content", {}).get("_sha1")
                    if isinstance(resource, str) and RESOURCE.fullmatch(resource):
                        body_path = "resources/" + resource
                        if body_path in archive.namelist() and archive.getinfo(body_path).file_size <= 2 * 1024 * 1024:
                            try:
                                record["data"] = safe_data(pathname, json.loads(archive.read(body_path)))
                            except (ValueError, TypeError):
                                record["data"] = None
                    result["requests"].append(record)
    except (OSError, ValueError, TypeError, AttributeError, zipfile.BadZipFile, RuntimeError):
        # Exception messages/paths may contain sensitive data; preserve no raw text.
        result["status"] = "UNREADABLE_TRACE"
    return result


def main():
    source, output = map(Path, sys.argv[1:3])
    output.mkdir(parents=True, exist_ok=True)
    traces = sorted(source.rglob("trace.zip"))[:100] if source.exists() else []
    report = {"schemaVersion": 1, "status": "CAPTURED" if traces else "NO_TRACES",
              "rawTracePublished": False, "traces": [summarize(trace) for trace in traces]}
    (output / "api-metadata.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
