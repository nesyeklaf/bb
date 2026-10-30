#!/usr/bin/env bash
# List runtime calls to npm and other package managers, and fail on any not covered by package-manager-exceptions.tsv.
# Usage: scripts/fork/check-package-manager-calls.sh
# Patterns: execNpm, runInstallCommand, npmCommand(, the host toolchain npm launchers in sources, and npm install|view|pack|ci|exec in shell assets and Dockerfiles.
# Exceptions file columns: path prefix, owning slice, reason. Slice "S2" and "S3" are not allowed; "keep" and "fork" entries are permanent and need an honest reason.
set -euo pipefail

root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$root"
exceptions="$root/scripts/fork/package-manager-exceptions.tsv"

CODE_PATTERN='execNpm|runInstallCommand|npmCommand\(|npmCli\(|bundledNpmCli|resolve\("npm"'
SHELL_PATTERN='\bnpm (install|view|pack|ci|exec)\b'

if awk -F'\t' '$1 !~ /^#/ && ($2 == "S2" || $2 == "S3")' "$exceptions" | grep -q .; then
  echo "package-manager-exceptions.tsv lists an S2 or S3 entry; those paths must have none left" >&2
  exit 1
fi

excludes=(':!*.md' ':!*.test.*' ':!*.stories.*' ':!**/__tests__/**' ':!**/test/**' ':!**/test-fixture.ts'
  ':!pnpm-lock.yaml' ':!scripts/fork/check-package-manager-calls.sh' ':!scripts/fork/package-manager-exceptions.tsv')
while IFS=$'\t' read -r prefix _slice _reason; do
  case "$prefix" in ''|'#'*) continue ;; esac
  excludes+=(":!$prefix")
done < "$exceptions"

hits=$( {
  git grep -nIE "$CODE_PATTERN" -- apps packages plugins scripts "${excludes[@]}"
  git grep -nIE "$SHELL_PATTERN" -- '*.sh' '*Dockerfile*' "${excludes[@]}"
} | cut -c1-200 || true)
if [ -n "$hits" ]; then
  echo "Package-manager calls not covered by an exception:" >&2
  echo "$hits" >&2
  exit 1
fi
echo "check-package-manager-calls: every package-manager call is covered by an exception (none owned by S2 or S3)"
