"""High-confidence secret checks for tracked files; never print secret material.

This complements (but does not replace) GitHub secret scanning and key rotation.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = (
    ("google_api_key", re.compile("AI" + r"za[0-9A-Za-z_-]{35}")),
    ("openai_api_key", re.compile(r"sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}")),
    ("github_token", re.compile(r"gh[pousr]_[A-Za-z0-9_]{30,}")),
    ("private_key_header", re.compile("-----BEGIN " + r"(?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
)
# Scan source/docs/configs; skip binaries, package lockfiles and fixture archives.
EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".json", ".yaml", ".yml", ".md", ".sh", ".ps1", ".toml", ".env"}
MAX_BYTES = 2_000_000


def scan_text(content: str) -> list[tuple[int, str]]:
    findings = []
    for line_number, line in enumerate(content.splitlines(), start=1):
        for name, pattern in PATTERNS:
            if pattern.search(line):
                findings.append((line_number, name))
    return findings


def audit_repository(root: Path) -> list[tuple[str, int, str]]:
    result = subprocess.check_output(["git", "ls-files", "-z"], cwd=root)
    findings: list[tuple[str, int, str]] = []
    for raw in result.split(b"\0"):
        if not raw:
            continue
        relative = raw.decode("utf-8", errors="replace").replace("\\", "/")
        file = root / relative
        name = file.name
        if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
            findings.append((relative, 0, "tracked_environment_file"))
        if not file.is_file() or file.is_symlink():
            continue
        if file.suffix not in EXTENSIONS and name not in {"Dockerfile", ".env", ".env.example"}:
            continue
        if file.stat().st_size > MAX_BYTES:
            continue
        try:
            content = file.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for line_number, kind in scan_text(content):
            findings.append((relative, line_number, kind))
    return findings


def main() -> int:
    try:
        findings = audit_repository(ROOT)
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"Secret scan unable to inspect tracked files: {type(exc).__name__}", file=sys.stderr)
        return 2
    if not findings:
        print("Tracked-file secret audit passed (high-confidence patterns only).")
        return 0
    for path, line_number, kind in findings:
        print(f"{path}:{line_number}: {kind}", file=sys.stderr)
    print(f"Secret audit found {len(findings)} issue(s); investigate and rotate exposed keys.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
