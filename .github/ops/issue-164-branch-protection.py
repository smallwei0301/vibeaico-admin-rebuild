#!/usr/bin/env python3
"""One-time encrypted Owner operation for GitHub branch protection.

No credential is stored in this file. It generates an ephemeral RSA key, accepts
one Owner-authored ciphertext via Issue #164, decrypts the PAT only in runner
memory, applies the approved main protection, verifies it, then wipes temp files.
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPOSITORY = "smallwei0301/vibeaico-admin-rebuild"
ISSUE_NUMBER = 164
BRANCH = "main"
OWNER_LOGIN = "smallwei0301"
API = "https://api.github.com"
API_VERSION = "2022-11-28"
REQUIRED_CONTEXTS = {"Agent WIP Policy", "check"}


def api_request(
    method: str,
    path: str,
    token: str,
    payload: dict[str, Any] | None = None,
    *,
    allow_status: set[int] | None = None,
) -> tuple[int, Any | None]:
    data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    request = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": API_VERSION,
            "User-Agent": "midao-branch-protection-owner-operation",
            **({"Content-Type": "application/json"} if data is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read()
        if allow_status and error.code in allow_status:
            try:
                body = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                body = None
            return error.code, body
        message = "GitHub API request failed"
        try:
            body = json.loads(raw)
            if isinstance(body, dict) and isinstance(body.get("message"), str):
                message = body["message"]
        except json.JSONDecodeError:
            pass
        raise RuntimeError(f"{method} {path} returned HTTP {error.code}: {message}") from None


def post_comment(token: str, body: str) -> int:
    _, response = api_request(
        "POST",
        f"/repos/{REPOSITORY}/issues/{ISSUE_NUMBER}/comments",
        token,
        {"body": body},
    )
    if not isinstance(response, dict) or not isinstance(response.get("id"), int):
        raise RuntimeError("GitHub did not return the key comment ID")
    return response["id"]


def update_comment(token: str, comment_id: int, body: str) -> None:
    api_request(
        "PATCH",
        f"/repos/{REPOSITORY}/issues/comments/{comment_id}",
        token,
        {"body": body},
    )


def safe_update_comment(token: str, comment_id: int | None, status: str, detail: str) -> None:
    if comment_id is None:
        return
    body = (
        "<!-- branch-protection-operation -->\n"
        "## Branch protection Owner operation\n\n"
        f"- STATUS: `{status}`\n"
        f"{detail}"
    )
    try:
        update_comment(token, comment_id, body)
    except Exception as error:
        print(f"::warning::Could not update operation comment: {type(error).__name__}")


def verify_protection(branch: dict[str, Any], protection: dict[str, Any]) -> dict[str, bool]:
    required = protection.get("required_status_checks") or {}
    contexts = set(required.get("contexts") or [])
    contexts.update(
        item.get("context")
        for item in (required.get("checks") or [])
        if isinstance(item, dict) and isinstance(item.get("context"), str)
    )
    return {
        "protected": branch.get("protected") is True,
        "required_contexts": REQUIRED_CONTEXTS.issubset(contexts),
        "strict_up_to_date": required.get("strict") is True,
        "admins_enforced": (protection.get("enforce_admins") or {}).get("enabled") is True,
        "pull_request_required": protection.get("required_pull_request_reviews") is not None,
        "force_push_blocked": (protection.get("allow_force_pushes") or {}).get("enabled") is False,
        "deletion_blocked": (protection.get("allow_deletions") or {}).get("enabled") is False,
    }


def protection_payload() -> dict[str, Any]:
    return {
        "required_status_checks": {
            "strict": True,
            "contexts": ["Agent WIP Policy", "check"],
        },
        "enforce_admins": True,
        "required_pull_request_reviews": {
            "dismiss_stale_reviews": False,
            "require_code_owner_reviews": False,
            "required_approving_review_count": 0,
            "require_last_push_approval": False,
        },
        "restrictions": None,
        "required_linear_history": False,
        "allow_force_pushes": False,
        "allow_deletions": False,
        "block_creations": False,
        "required_conversation_resolution": False,
        "lock_branch": False,
        "allow_fork_syncing": False,
    }


def main() -> int:
    actions_token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not actions_token:
        raise RuntimeError("GITHUB_TOKEN is unavailable")

    key_comment_id: int | None = None
    secret_comment_id: int | None = None

    with tempfile.TemporaryDirectory(prefix="branch-protection-") as directory:
        root = Path(directory)
        private_key = root / "private.pem"
        public_der = root / "public.der"
        cipher_file = root / "cipher.bin"
        token_file = root / "admin-token"

        try:
            subprocess.run(
                [
                    "openssl", "genpkey", "-algorithm", "RSA",
                    "-pkeyopt", "rsa_keygen_bits:3072", "-out", str(private_key),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            subprocess.run(
                [
                    "openssl", "pkey", "-in", str(private_key), "-pubout",
                    "-outform", "DER", "-out", str(public_der),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

            nonce = os.urandom(24).hex()
            public_key_b64 = base64.b64encode(public_der.read_bytes()).decode()
            expires_epoch = int(time.time()) + 8 * 60
            expires_utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires_epoch))
            key_body = (
                f"<!-- branch-protection-key:{nonce} -->\n"
                "## One-time encrypted Owner operation\n\n"
                "- ALGORITHM: `RSA-OAEP-SHA256`\n"
                f"- EXPIRES_AT: `{expires_utc}`\n"
                f"- PUBLIC_KEY_DER_BASE64: `{public_key_b64}`\n\n"
                "Only ciphertext encrypted for this one-time key is accepted. "
                "The private key remains only in this runner memory."
            )
            key_comment_id = post_comment(actions_token, key_body)

            marker = f"<!-- branch-protection-secret:{nonce} -->"
            cipher_pattern = re.compile(r"(?m)^CIPHERTEXT: ([A-Za-z0-9+/]+={0,2})$")
            ciphertext_b64: str | None = None

            while time.time() < expires_epoch:
                _, comments = api_request(
                    "GET",
                    f"/repos/{REPOSITORY}/issues/{ISSUE_NUMBER}/comments?per_page=100",
                    actions_token,
                )
                if not isinstance(comments, list):
                    raise RuntimeError("Issue comments response is not a list")
                for comment in sorted(comments, key=lambda item: item.get("id", 0)):
                    if not isinstance(comment, dict) or comment.get("id", 0) <= key_comment_id:
                        continue
                    if (comment.get("user") or {}).get("login") != OWNER_LOGIN:
                        continue
                    if comment.get("author_association") != "OWNER":
                        continue
                    body = comment.get("body") or ""
                    if marker not in body:
                        continue
                    match = cipher_pattern.search(body)
                    if not match:
                        continue
                    secret_comment_id = int(comment["id"])
                    ciphertext_b64 = match.group(1)
                    break
                if ciphertext_b64:
                    break
                time.sleep(5)

            if not ciphertext_b64:
                safe_update_comment(
                    actions_token,
                    key_comment_id,
                    "FAILED_NO_CIPHERTEXT",
                    "\nNo valid Owner ciphertext arrived before expiry. No GitHub setting was changed.",
                )
                return 1

            try:
                cipher_file.write_bytes(base64.b64decode(ciphertext_b64, validate=True))
            except ValueError:
                raise RuntimeError("Ciphertext was not valid base64") from None

            subprocess.run(
                [
                    "openssl", "pkeyutl", "-decrypt",
                    "-inkey", str(private_key),
                    "-in", str(cipher_file),
                    "-out", str(token_file),
                    "-pkeyopt", "rsa_padding_mode:oaep",
                    "-pkeyopt", "rsa_oaep_md:sha256",
                    "-pkeyopt", "rsa_mgf1_md:sha256",
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            admin_token = token_file.read_text().strip()
            print(f"::add-mask::{admin_token}")
            if not re.fullmatch(r"(?:github_pat_|ghp_)[A-Za-z0-9_]+", admin_token):
                safe_update_comment(
                    actions_token,
                    key_comment_id,
                    "FAILED_INVALID_TOKEN_FORMAT",
                    "\nThe decrypted value was not a supported GitHub PAT. No setting was changed.",
                )
                return 1

            _, repository = api_request("GET", f"/repos/{REPOSITORY}", admin_token)
            if not isinstance(repository, dict) or (repository.get("permissions") or {}).get("admin") is not True:
                safe_update_comment(
                    actions_token,
                    key_comment_id,
                    "FAILED_NO_ADMIN_PERMISSION",
                    "\nThe PAT can read the repository but lacks Administration permission. No setting was changed.",
                )
                return 1

            _, branch_before = api_request(
                "GET", f"/repos/{REPOSITORY}/branches/{BRANCH}", admin_token
            )
            if not isinstance(branch_before, dict):
                raise RuntimeError("Branch response was invalid")
            main_sha = (branch_before.get("commit") or {}).get("sha")

            if branch_before.get("protected") is True:
                code, protection_before = api_request(
                    "GET",
                    f"/repos/{REPOSITORY}/branches/{BRANCH}/protection",
                    admin_token,
                    allow_status={404},
                )
                if code != 200 or not isinstance(protection_before, dict):
                    safe_update_comment(
                        actions_token,
                        key_comment_id,
                        "FAILED_EXISTING_PROTECTION_UNREADABLE",
                        "\nmain was already protected, but its rule could not be read. Nothing was overwritten.",
                    )
                    return 1
                if not all(verify_protection(branch_before, protection_before).values()):
                    safe_update_comment(
                        actions_token,
                        key_comment_id,
                        "FAILED_EXISTING_PROTECTION_DIFFERS",
                        "\nmain already had a different protection rule. The workflow failed closed and did not overwrite it.",
                    )
                    return 1
            else:
                api_request(
                    "PUT",
                    f"/repos/{REPOSITORY}/branches/{BRANCH}/protection",
                    admin_token,
                    protection_payload(),
                )

            _, branch_after = api_request(
                "GET", f"/repos/{REPOSITORY}/branches/{BRANCH}", admin_token
            )
            _, protection_after = api_request(
                "GET", f"/repos/{REPOSITORY}/branches/{BRANCH}/protection", admin_token
            )
            if not isinstance(branch_after, dict) or not isinstance(protection_after, dict):
                raise RuntimeError("Protection verification response was invalid")
            checks = verify_protection(branch_after, protection_after)
            if not all(checks.values()):
                raise RuntimeError(
                    "Protection read-back failed: " + json.dumps(checks, sort_keys=True)
                )

            if secret_comment_id is not None:
                try:
                    api_request(
                        "DELETE",
                        f"/repos/{REPOSITORY}/issues/comments/{secret_comment_id}",
                        actions_token,
                    )
                except Exception:
                    try:
                        update_comment(
                            actions_token,
                            secret_comment_id,
                            "<!-- encrypted-handoff-consumed -->\nEncrypted handoff consumed and redacted.",
                        )
                    except Exception:
                        print("::warning::Encrypted handoff comment could not be removed")

            safe_update_comment(
                actions_token,
                key_comment_id,
                "APPLIED_AND_VERIFIED",
                (
                    f"\n- MAIN_SHA_AT_OPERATION: `{main_sha}`\n"
                    "- MAIN_PROTECTED: `true`\n"
                    "- REQUIRED_CHECKS: `Agent WIP Policy`, `check`\n"
                    "- REQUIRE_UP_TO_DATE: `true`\n"
                    "- REQUIRE_PULL_REQUEST: `true`\n"
                    "- ADMIN_BYPASS: `blocked`\n"
                    "- FORCE_PUSH: `blocked`\n"
                    "- BRANCH_DELETION: `blocked`\n"
                    "- TOKEN_PERSISTED: `false`\n\n"
                    "Protection was read back from GitHub after the update."
                ),
            )
            print(
                "Branch protection applied and verified for "
                f"{REPOSITORY}:{BRANCH} at {main_sha}"
            )
            return 0

        except Exception as error:
            safe_update_comment(
                actions_token,
                key_comment_id,
                "FAILED_SAFE",
                f"\nOperation stopped safely: `{type(error).__name__}`. No secret was persisted. Check the workflow log for the sanitized error.",
            )
            print(f"::error::{type(error).__name__}: {error}")
            return 1
        finally:
            for candidate in (private_key, public_der, cipher_file, token_file):
                try:
                    if candidate.exists():
                        candidate.write_bytes(b"\x00" * candidate.stat().st_size)
                except OSError:
                    pass


if __name__ == "__main__":
    raise SystemExit(main())
