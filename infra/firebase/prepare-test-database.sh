#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Only the preceding GitHub-proof step may create this exact-commit marker.
if [[ "${RELEASE_VERIFICATION:-full}" == reuse-ci && "${RELEASE_DEPLOY:-false}" == true &&
      "${RELEASE_BRANCH:-}" == main && -f .release/verification.json && -f .release/reuse-ci.ok ]]; then
  test "$(cat .release/reuse-ci.ok)" = "${RELEASE_COMMIT:?Exact release commit required}"
  echo 'Identical source already passed PostgreSQL 17 tests in GitHub CI; no duplicate test database is needed.'
  exit 0
fi
docker run -d --network cloudbuild --name siskop-ci-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=ci-only-password \
  -e POSTGRES_DB=siskop_ci_test postgres:17
for attempt in {1..30}; do
  if docker exec siskop-ci-postgres pg_isready -U postgres; then exit 0; fi
  sleep 2
done
exit 1
