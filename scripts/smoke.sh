#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"

for endpoint in /api/v1/health/live /api/v1/health/ready /api/v1/meta /api/schema/; do
  printf 'Checking %s ... ' "$endpoint"
  curl --fail --silent --show-error --max-time 10 --output /dev/null "$BASE_URL$endpoint"
  echo OK
done

printf 'Checking web ... '
curl --fail --silent --show-error --max-time 15 --output /dev/null "$BASE_URL/"
echo OK

echo 'HTTP checks passed. Run make worker-smoke to verify task execution.'
