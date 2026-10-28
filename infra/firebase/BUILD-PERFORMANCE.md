# Cloud Build performance

## Follow-up: isolated CI tests and backend compilation cache

The completed [SDK-wrapper release](https://console.cloud.google.com/cloud-build/builds;region=asia-southeast2/b8abc4f3-0e3b-48d1-bab5-e1d1664d73e5?project=siskop-d0f8c)
finished in **11m21s**, with frontend verification/build at **2m37s** and the
parallel backend build at **4m33s**. Frontend compilation itself took about 50s;
package installation took 38.6s. This run missed the frontend dependency cache and
then saved it successfully. Backend package installation also rebuilt after root
manifest changes. These are cold-cache observations, not steady-state timings.

GitHub's completed verification spent **7m19s** on `pnpm run test`, compared with
19s each for lint and typechecks. This follow-up leaves both checks in place and
sets three backend fork slots for GitHub's test step. Each slot gets a clean,
separate clone of the migrated local test database; fixture resets cannot cross
slots. Full coverage remains combined in one Vitest run with unchanged thresholds.

Local validation passed all 1,097 backend tests in **93.8s wall time** (91.45s
reported by Vitest), with **97.06% line coverage**. An initial serial run took
259.2s but failed one accounting fixture, so it is not a clean before/after speed
benchmark. Local investigation reproduced macOS allowing a separate IPv4 listener
on an automatically assigned IPv6 HTTP test port, while Supertest sends requests
to IPv4. Test-only Supertest URLs now follow the actual listener family while
preserving the original Host header, covered by a real socket regression test.
The accounting fixture also checks successful
mapping setup before its deactivation assertion. Additional
cleanup/boundary unit tests cover owned-clone deletion and partial setup failures.
GitHub performance still needs measurement after merge.

Backend Docker caching now preserves the `build` stage, not only dependency and
final runtime layers. Unchanged backend sources can reuse TypeScript compilation
layers on later infrastructure-only releases. This keeps the same two Docker
build invocations/cache tags and preserves runtime import checks. Actual Cloud
Build timing for this follow-up has not been measured; no new worker size or
manually triggered release is part of the change.

## October 2026 optimization — proposed, not deployed

The [completed October release](https://console.cloud.google.com/cloud-build/builds;region=asia-southeast2/0183950e-724a-4bce-8696-5c5fc011cc4a?project=siskop-d0f8c)
took about **25m 27s**. Its slow stage was verification, not the completed Supabase data transfer.

| Measured stage | Duration |
| --- | ---: |
| Disposable test database | 40s |
| Verification and browser builds | **18m 25s** |
| Backend image build, in parallel | 2m 26s |
| Migration and API deployment together | 1m 29s |
| Tenant hosting publication | 2m 33s |
| Central hosting publication | 1m 01s |

The proposed fast path reuses full GitHub CI results for the **identical source tree**:

- CI explicitly checks out the immutable source commit, uses PostgreSQL 17 to match Contabo, and retains full tests and coverage.
- A bounded public-metadata lookup verifies the repository, pinned CI workflow, exact tree, successful verification job and result freshness. A different squash commit hash is acceptable; different tracked content is not.
- Eligible builds omit the duplicate test database, test-schema migration, Chromium installation and repeated full application suite. They install only browser-workspace dependencies, rerun release/gateway/host boundary tests and build fresh browser artifacts.
- Dependency downloads persist in a dependency-keyed pnpm store archive in the existing SISKOP deployment bucket. Source-only changes reuse it; lockfile/manifests/toolchain changes use a new key. Frozen installs and package integrity checks remain. Cold/missing/corrupt cache and storage failures fall back to ordinary downloads; optional uploads overlap deployment.
- API image compilation, live Prisma schema migrations, release locking, deployment receipts, readiness checks and scheduler controls remain unchanged. Live schema checks are needed for future migrations; the old one-time provider transfer is already finished.
- Missing or invalid evidence preserves the original full verification path. Manual verification and the explicit full-mode override also retain it.

**Target:** below ten minutes for the normal CI-reuse path. The measured downstream release stages take roughly six minutes; the aim is to overlap the existing backend image build with a short source-proof/browser-build stage. This is a target, not a measured optimized Cloud Build result. No new Cloud Build run or live infrastructure change is part of this PR.

Wait for green GitHub verification before merging and update the branch with main before the final CI run. Source changes introduced at merge, stale evidence, public API rate limits/network failures, cold dependency downloads or slow hosting rollouts can require full verification or exceed the target. No extra worker size, service or persistent credential is introduced.

Local pre-push checks, single full GitHub verification, and Cloud Build CI-result/dependency reuse are implemented together. The first merged release populates the dependency cache; reduced download time applies to later matching builds. The local hook is installed per clone and supplements the shared CI result.

Implementation reference: [Google Cloud Build directory caching](https://docs.cloud.google.com/build/docs/optimize-builds/speeding-up-builds#caching_directories_with_google_cloud_storage).

## Earlier baseline and optimizations

Baseline deployment: [3f35c703](https://console.cloud.google.com/cloud-build/builds;region=asia-southeast2/3f35c703-518f-45a6-928d-2ac1c73385e0?project=siskop-d0f8c),
main commit `1817514`, 2026-09-15. The build completed successfully and activated
both scheduler jobs.

| Baseline phase | Duration |
| --- | ---: |
| Disposable database startup | 14s |
| Verification and browser builds | 8m 19s |
| Backend image build | 3m 23s |
| Backend image upload | 49s |
| Release acquisition | 31s |
| Migration and API deployment | 1m 02s |
| Firebase Hosting publish | 55s |
| Optional tenant setup/publish | 8s |
| Final checks and scheduler activation | 25s |
| Entire deployment | **15m 52s** |

The backend Docker context was **573.9 MB**. Its broad context included the pnpm
store left by verification. The pipeline also compiled the backend both outside
and inside Docker, repeated browser typechecks, and bundled the frontend in both
production and staging modes. Every step waited for all preceding steps.

## Changes

- Restrict the Docker context to backend and shared-package inputs.
- Build the backend concurrently with verification; require both to pass before
  publishing the image or taking the deployment lock.
- Persist dependency and runtime Docker caches in Artifact Registry. Prisma
  generation belongs to the dependency stage, so source-only changes reuse it.
- Compile the backend in Docker and build each browser bundle once, keeping
  lint, typechecks, all tests and the coverage gate.
- Preserve default worker sizing, main-only publishing, migration ordering,
  immutable deployment digests, Hosting checks and scheduler activation checks.

## Verification

Local tests cover cold-cache fallback, failed dependency builds, required image
uploads versus optional cache uploads, test failure stopping browser builds, and
the dependency graph protecting publication. Full Cloud Build validation uses
`_DEPLOY=false`, which does not
migrate Cloud SQL, deploy either frontend, change API traffic or activate jobs.

The first [validation build](https://console.cloud.google.com/cloud-build/builds;region=asia-southeast2/4957b3e6-3133-4735-9cce-66290734b78c?project=siskop-d0f8c)
started with neither cache available. All 501 backend tests passed with 95.35%
line coverage, and lint, typechecks, release tests, both browser bundles and the
compiled backend import check passed. Local validation also passed all 36
release/pipeline tests, including the subsequently added optional-cache-upload
failure case.

| Same measured phase | Baseline | Optimized, empty cache |
| --- | ---: | ---: |
| Docker context, per transfer | 573.9 MB | **3.97 MB** |
| Verification and browser builds | 8m 19s | 8m 52s |
| Backend image build | 3m 23s | 4m 27s, overlapping verification |
| Image/cache upload | 49s | 1m 28s, creating both caches |
| Database startup through completed image upload | **12m 45s** | **10m 38s** |

This reduced the same preparation interval by **2m 07s (16.5%)** even with empty
caches. Individual concurrent steps took longer on the unchanged worker; the
improvement comes from overlapping work and avoiding duplicate compilation.
The first cache upload also costs more than a normal runtime-image upload.

A separate [warm-cache benchmark](https://console.cloud.google.com/cloud-build/builds;region=asia-southeast2/d5a5624d-f983-4dea-a501-191a6a569ab6?project=siskop-d0f8c)
ran only `build-backend.sh build` on a fresh default Cloud Build worker, with the
same backend source and the newly published caches. It succeeded in **69.6s
(1m 10s)** including cache pulls, compared with the baseline backend build's
202.7s (3m 23s): **65.7% faster**. Logs show 37 layer-cache hits across the two
Docker invocations; TypeScript compilation still ran. The benchmark did not push
images or deploy anything. It isolates cache reuse and is not a measurement of a
complete warm-cache release or of concurrent worker contention.

Verification-only wall times exclude actual deployment and must not be directly
compared with the full 15m 52s baseline. Compare their verification/image phases;
the remaining release steps are unchanged. Cache speed also depends on whether
dependencies, schema, base images or the monthly refresh period changed.

References: [Cloud Build concurrency](https://docs.cloud.google.com/build/docs/configuring-builds/configure-build-step-order),
[Docker caching in Cloud Build](https://docs.cloud.google.com/build/docs/optimize-builds/speeding-up-builds).
