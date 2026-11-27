#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

project=demo-siskop-tenants
auth_dir=.local/firebase-auth
mkdir -p "$auth_dir"
emulator_args=(emulators:start --only auth --project "$project" --config infra/tenant-web/emulators.json "--export-on-exit=$auth_dir")
if [[ -f "$auth_dir/firebase-export-metadata.json" ]]; then
  emulator_args+=("--import=$auth_dir")
fi

node --env-file=apps/backend/.env --input-type=module -e '
const db = new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== "development" || process.env.FIREBASE_PROJECT_ID !== "demo-siskop-tenants" ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9109" ||
    db.hostname !== "[::1]" || process.env.BIND_HOST !== "127.0.0.1") {
  throw new Error("The local launcher requires the Firebase demo project and the IPv6 Docker database.");
}'

children=()
cleanup() {
  trap - EXIT
  if ((${#children[@]})); then
    kill -TERM "${children[@]}" 2>/dev/null || true
    wait "${children[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

firebase "${emulator_args[@]}" &
children+=("$!")
auth_ready=false
for ((i=0; i<30; i++)); do
  kill -0 "${children[0]}" 2>/dev/null || break
  if curl -fsS --max-time 1 "http://127.0.0.1:9109/emulator/v1/projects/$project/config" >/dev/null 2>&1; then
    auth_ready=true
    break
  fi
  sleep 1
done
if [[ "$auth_ready" != true ]]; then
  echo "Firebase Auth did not start on port 9109." >&2
  exit 1
fi

(cd apps/backend; exec ./node_modules/.bin/tsx watch src/main.ts) &
children+=("$!")
node --env-file=apps/backend/.env infra/tenant-web/preview.mjs --local &
children+=("$!")

while kill -0 "${children[0]}" "${children[1]}" "${children[2]}" 2>/dev/null; do sleep 1; done
echo "A local service exited. Check the output above." >&2
exit 1
