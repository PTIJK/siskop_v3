#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
repository=asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api
image="${RELEASE_IMAGE:?RELEASE_IMAGE is required}"
if [[ "$image" != "$repository":* ]]; then
  echo 'Unexpected backend image repository.' >&2
  exit 1
fi
build_tag="${image##*:}"
if [[ ! "$build_tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]]; then
  echo 'Invalid backend image tag.' >&2
  exit 1
fi
dependencies="$repository:dependencies-$build_tag"
dependency_cache="$repository:cache-dependencies"
runtime_cache="$repository:cache-runtime"

case "${1:-}" in
  build)
    # Missing caches only make a cold build slower. Cache tags are performance
    # hints: Docker still checks every source/manifest against its layer keys.
    docker pull "$dependency_cache" >/dev/null 2>&1 & dependency_pull=$!
    docker pull "$runtime_cache" >/dev/null 2>&1 & runtime_pull=$!
    wait "$dependency_pull" || echo 'Dependency cache unavailable; building it.'
    wait "$runtime_pull" || echo 'Runtime cache unavailable; building it.'
    # Refresh system-package layers monthly even if Node/lockfile are unchanged.
    cache_epoch="${RELEASE_CACHE_EPOCH:-$(date -u +%Y-%m)}"
    docker build --pull -f apps/backend/Dockerfile --target dependencies \
      --build-arg "OS_CACHE_EPOCH=$cache_epoch" --cache-from "$dependency_cache" \
      -t "$dependencies" .
    docker build --pull -f apps/backend/Dockerfile \
      --build-arg "OS_CACHE_EPOCH=$cache_epoch" \
      --cache-from "$dependencies" --cache-from "$runtime_cache" -t "$image" .
    ;;
  push)
    # Cloud Build reaches this phase only after verification AND compilation.
    # The deployable tag stays unique to this build; cache tags never deploy.
    docker push "$image"
    if ! docker tag "$dependencies" "$dependency_cache" || ! docker push "$dependency_cache"; then
      echo 'Dependency cache upload unavailable; the release image is already published.'
    fi
    if ! docker tag "$image" "$runtime_cache" || ! docker push "$runtime_cache"; then
      echo 'Runtime cache upload unavailable; the release image is already published.'
    fi
    ;;
  *) echo 'Usage: build-backend.sh build|push' >&2; exit 1 ;;
esac
