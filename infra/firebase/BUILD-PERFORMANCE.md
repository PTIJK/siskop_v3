# Cloud Build performance

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
