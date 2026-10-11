#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
  echo "FAIL: GitHub Actions secret VERCEL_AUTOMATION_BYPASS_SECRET is not configured."
  exit 2
fi
if [[ -z "${PREVIEW_URL:-}" ]]; then
  echo "FAIL: PREVIEW_URL is empty."
  exit 2
fi

# Restrict the check to Vercel Preview hosts; refuse production/custom domains.
url="${PREVIEW_URL%/}"
host="$(printf '%s' "$url" | sed -E 's#^https?://([^/]+).*#\1#')"
if [[ "$url" != https://* ]] || [[ "$host" != *.vercel.app ]]; then
  echo "FAIL: Use an https://*.vercel.app Preview URL. Custom/production domains are refused."
  exit 2
fi

check_path() {
  local path="$1" expected="$2" body status
  body="$(mktemp)"
  status="$(curl --silent --show-error --location --max-time 20 \
    --output "$body" --write-out '%{http_code}' \
    --header "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}" \
    --header "x-vercel-set-bypass-cookie: true" \
    "${url}${path}")" || {
      rm -f "$body"
      echo "FAIL: Network/TLS request failed for ${path}."
      return 1
    }

  if [[ "$status" != "200" ]]; then
    echo "FAIL: ${path} returned HTTP ${status}; expected 200. Response body not printed."
    rm -f "$body"
    return 1
  fi
  if ! grep -Fqi "$expected" "$body"; then
    echo "FAIL: ${path} returned HTTP 200 but did not contain expected marker '${expected}'."
    rm -f "$body"
    return 1
  fi
  echo "PASS: ${path} returned HTTP 200 and expected marker '${expected}'."
  rm -f "$body"
}

check_path "/" "Kistefunn" 
check_path "/test-runner.html" "automatisk testpakke"
echo "PASS: Preview access confirmed. No /api/analyze request was made; no OpenAI/eBay analysis was run."
