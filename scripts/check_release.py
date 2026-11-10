"""Read-only health smoke for SyntheSift. Never sends credentials or dataset rows."""

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime


CHECKS = ("/api/v1/health/live", "/api/v1/health/ready")


def check_endpoint(url: str, timeout: float = 8) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            code = response.status
    except urllib.error.HTTPError as exc:
        code = exc.code
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {"ok": False, "status": None, "error": type(exc).__name__}
    return {"ok": code == 200, "status": code, "error": None}


def run_checks(base_url: str, timeout: float = 8) -> dict:
    return {
        "checked_at_utc": datetime.now(UTC).isoformat(),
        "target": base_url.rstrip("/"),
        "checks": {
            path: check_endpoint(base_url.rstrip("/") + path, timeout)
            for path in CHECKS
        },
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--timeout", type=float, default=8)
    parser.add_argument("--output", help="Optional JSON evidence file, outside .env")
    args = parser.parse_args(argv)
    if args.timeout <= 0 or args.timeout > 60:
        parser.error("--timeout must be > 0 and <= 60 seconds")
    if not args.url.startswith(("http://", "https://")):
        parser.error("--url must start with http:// or https://")
    report = run_checks(args.url, args.timeout)
    report["all_healthy"] = all(item["ok"] for item in report["checks"].values())
    rendered = json.dumps(report, indent=2, sort_keys=True)
    if args.output:
        from pathlib import Path
        Path(args.output).write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0 if report["all_healthy"] else 2


if __name__ == "__main__":
    sys.exit(main())
