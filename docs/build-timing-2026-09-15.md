# Release timing investigation — 15 September 2026

Observed release: `7eb7eded-a6d3-4c3b-b42d-076eb0fa55b6`, commit `136157f`.
Source: Cloud Build step timings and verification logs read from project
`siskop-d0f8c`. Total elapsed time was approximately 16 minutes.

| Step | Duration | Relationship |
| --- | ---: | --- |
| Test database | 28 s | Verification prerequisite |
| Verify and build frontend | 554 s | Main build bottleneck |
| Build backend image | 238 s | Runs in parallel with verification |
| Push backend image/caches | 60 s | Waits for both verification and image build |
| Acquire release | 30 s | Includes deployment tool image preparation |
| Migrate and deploy backend | 55 s | Sequential release step |
| Prepare tenant hosting | 8 s | Packages the verified browser output |
| Publish tenant hosting | 140 s | Includes App Hosting build and rollout |
| Publish central frontend | 57 s | After the tenant gateway is ready |
| Verify and finish | 22 s | Release checks |

Durations include tool-image preparation. Parallel steps must not be added to
estimate total elapsed time.

## What consumes the verification step

- Pull Node image: about 49 seconds.
- Install Chromium/Python and pnpm: about 50 seconds.
- Fresh pnpm dependency install: 43.6 seconds, 776 downloads, zero reused packages.
  Registry requests reported delays of 11–17 seconds.
- Lint: about 65 seconds; type checks: about 42 seconds.
- Backend coverage tests: 252.15 seconds (45 files, 527 tests). This includes
  about 79 seconds collecting modules and 151 seconds executing tests.
- Mobile compilation: 9.50 seconds; frontend compilation: 18.73 seconds.
- Remaining time covers migration, Python/gateway tests and packaging.

## Why another ~45-second build appears

Build `1f5e2097-19ed-43a8-b7f3-5caac6529b05` is the `siskop-tenants` Firebase
App Hosting build in `asia-southeast1`. It uses a prepared source archive, so
the build list has no Git branch or trigger. It packages the tenant gateway
and already-built assets into the hosting image.

It ran at 15:51:59–15:52:40 UTC, inside the main release's tenant-hosting step.
The main release finished at 15:55:22 UTC. The newer entry appears above the
main release because the build history is sorted by start time. It is not a
second full verification run and its time is already included in the release.

The screenshot ranges from roughly 12 to 20 minutes, so it does not establish
a steady increase. This release spends most time verifying and deploying,
with relatively little time compiling browser code.

## Improvements to prioritize

1. Use a maintained verification image with Node, Chromium, Python and pnpm
   preinstalled, and cache the pnpm store by lockfile. Backend image caching
   already exists; the verification step currently starts cold.
2. Profile test collection and run test shards against separate disposable
   databases if faster verification is needed. Current tests intentionally
   run serially because they truncate shared database tables.
3. Benchmark a larger Cloud Build machine before selecting it; more resources
   may reduce CPU contention but change build cost.

These are recommendations. This member-login change does not alter release
ordering or remove validation checks. Any speed improvement needs measured
before/after builds rather than a promised duration.
