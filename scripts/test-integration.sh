#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
courier_repo="${COURIER_GO_DIR:-$repo_dir/../courier}"
export COURIER_JS_DIR="$repo_dir"
exec bash "$courier_repo/scripts/test-integration.sh" --suite js "$@"
