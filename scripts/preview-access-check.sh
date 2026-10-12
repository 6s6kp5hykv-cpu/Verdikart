#!/usr/bin/env bash
set -euo pipefail
# Kistefunn Preview access check
# Test only. Never calls /api/analyze.
# Retries only transient network errors, HTTP 429 and HTTP 5xx.
if [[ -z "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
  echo "FAIL: VERCEL_AUTOMATION_BYPASS_SECRET is not configured."
  exit 2
fi
if [[ -z "${PREVIEW_URL:-}" ]]; then
  echo "FAIL: PREVIEW_URL is empty."
  exit 2
fi
url="${PREVIEW_URL%/}"
host="$(printf '%s' "$url" | sed -E 's#^https://([^/]+).*#\1#')"
if [[ "$url" != https://* ]] || [[ "$host" != *.vercel.app ]]; then
  echo "FAIL: Use an https://*.vercel.app Preview URL."
  exit 2
fi
check_path() {
  local path="$1"
  local expected="$2"
  local body headers errors status location
  local attempt max_attempts delay
  max_attempts=3
  delay=5
  body="$(mktemp)"
  headers="$(mktemp)"
  errors="$(mktemp)"
  for ((attempt=1; attempt<=max_attempts; attempt++)); do
    : > "$body"
    : > "$headers"
    : > "$errors"
    if status="$(curl --silent --show-error \
      --connect-timeout 10 \
      --max-time 20 \
      --output "$body" \
      --dump-header "$headers" \
      --write-out '%{http_code}' \
      --header "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}" \
      "${url}${path}" 2>"$errors")"; then
      :
    else
      status="000"
    fi
    if [[ "$status" == "200" ]]; then
      if grep -Fqi "$expected" "$body"; then
        echo "PASS: ${path} returned HTTP 200 and expected marker."
        rm -f "$body" "$headers" "$errors"
        return 0
      fi
      echo "FAIL: ${path} returned HTTP 200 but expected marker was missing."
      rm -f "$body" "$headers" "$errors"
      return 1
    fi
    # Do not retry redirects or authorization/protection failures.
    if [[ "$status" =~ ^3[0-9][0-9]$ ]] || \
       [[ "$status" == "401" ]] || [[ "$status" == "403" ]]; then
      location="$(grep -i '^location:' "$headers" | tail -n 1 | tr -d '\r' || true)"
      echo "FAIL: ${path} returned HTTP ${status}; manual investigation required."
      if [[ -n "$location" ]]; then
        echo "Redirect target: ${location}"
      fi
      echo "Redirects are not followed."
      rm -f "$body" "$headers" "$errors"
      return 1
    fi
    # Retry only transient errors, with a bounded number of attempts.
    if [[ "$status" == "000" ]] || [[ "$status" == "429" ]] || \
       [[ "$status" =~ ^5[0-9][0-9]$ ]]; then
      if (( attempt < max_attempts )); then
        echo "WARN: ${path} returned HTTP ${status}; retry ${attempt}/${max_attempts} after ${delay}s."
        sleep "$delay"
        delay=$((delay * 2))
        continue
      fi
    fi
    echo "FAIL: ${path} returned HTTP ${status}; expected 200."
    echo "Response body not printed."
    if [[ -s "$errors" ]]; then
      echo "A network or curl error was reported."
    fi
    rm -f "$body" "$headers" "$errors"
    return 1
  done
  rm -f "$body" "$headers" "$errors"
  return 1
}
check_path "/" "Kistefunn"
check_path "/test-runner.html" "automatisk testpakke"
echo "PASS: Preview access confirmed."
echo "No /api/analyze request was made."
