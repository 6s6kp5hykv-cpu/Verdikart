
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

url="${PREVIEW_URL%/}"
host="$(printf '%s' "$url" | sed -E 's#^https://([^/]+).*#\1#')"

if [[ "$url" != https://* ]] || [[ "$host" != *.vercel.app ]]; then
  echo "FAIL: Use an https://*.vercel.app Preview URL. Custom/production domains are refused."
  exit 2
fi

check_path() {
  local path="$1"
  local expected="$2"
  local body headers errors status location

  body="$(mktemp)"
  headers="$(mktemp)"
  errors="$(mktemp)"

  if status="$(curl --silent --show-error \
    --max-time 20 \
    --output "$body" \
    --dump-header "$headers" \
    --write-out '%{http_code}' \
    --header "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}" \
    --header "x-vercel-set-bypass-cookie: true" \
    "${url}${path}" 2>"$errors")"; then
    :
  else
    echo "FAIL: Request failed for ${path}."
    if [[ -s "$errors" ]]; then
      sed -E 's/(x-vercel-protection-bypass:).*/\1 [REDACTED]/I' "$errors"
    fi
    rm -f "$body" "$headers" "$errors"
    return 1
  fi

  if [[ "$status" =~ ^3[0-9][0-9]$ ]]; then
    location="$(grep -i '^location:' "$headers" | tail -n 1 | tr -d '\r' || true)"
    echo "FAIL: ${path} returned HTTP ${status}; redirect detected."
    if [[ -n "$location" ]]; then
      echo "Redirect target: ${location}"
    fi
    echo "Redirects are not followed, to prevent redirect loops."
    rm -f "$body" "$headers" "$errors"
    return 1
  fi

  if [[ "$status" != "200" ]]; then
    echo "FAIL: ${path} returned HTTP ${status}; expected 200. Response body not printed."
    rm -f "$body" "$headers" "$errors"
    return 1
  fi

  if ! grep -Fqi "$expected" "$body"; then
    echo "FAIL: ${path} returned HTTP 200 but expected marker was missing."
    rm -f "$body" "$headers" "$errors"
    return 1
  fi

  echo "PASS: ${path} returned HTTP 200 and expected marker."
  rm -f "$body" "$headers" "$errors"
}

check_path "/" "Kistefunn"
check_path "/test-runner.html" "automatisk testpakke"

echo "PASS: Preview access confirmed. No /api/analyze request was made."
