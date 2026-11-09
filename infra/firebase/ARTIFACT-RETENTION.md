# Backend image retention

`siskop-staging` in `asia-southeast2` previously retained every backend build.
`artifact-cleanup.json` limits that growth using Google Artifact Registry's native
background cleanup. It does not change the Firebase-managed tenant image repository,
Cloud Run revisions/tags, Hosting versions, databases, or uploaded member documents.

## Retention rules

- Keep every image younger than seven days.
- Keep at least the five newest `api` package versions, regardless of age.
  Dependency-cache images also count as versions; this is not five successful releases.
- Always keep images carrying `cache-*` or `retain-*` tags.
- Delete other `api*` package versions older than seven days. The repository currently
  also contains `central-gateway`, which this policy leaves untouched.

Keep rules take precedence over deletion. The seven-day grace period means this
is not an immediate reduction to five images. Shared layers also mean multiplying
image count by image size does not predict reclaimed storage accurately.

## Release protection

Under the existing release lock, `backend()` adds `retain-pending-<build UUID>` to
the immutable candidate before migration/deployment. Failed or partially published
releases retain this pin until a later successful coordinated release supersedes them.

After Hosting, API and scheduler verification, `finish()` saves the old `retain-live`
digest as `retain-rollback`, then moves `retain-live` to the new digest. Retries keep
the previous release intact. It removes completed candidate pins only after those
writes succeed. With tenant hosting disabled, it retires only pending pins on the
same image; older tenant rollout pins remain protected. An uninterrupted series of
failed/partial releases can therefore retain extra images until recovery succeeds.

Operators can add `retain-manual-<reason>` for a longer rollback/investigation window.
The pipeline never removes manual pins. Remove them explicitly when no longer needed.
Deleting an old registry image prevents a fresh deployment of that digest. Existing
Cloud Run serving revisions retain their imported image independently; no Cloud Run
revision or Hosting pin is removed by this policy.

## Apply or change the policy

Use a project administrator account. Before enabling deletion:

1. Inspect active Cloud Builds, current central/tenant Hosting release markers,
   Cloud Run traffic/image digests, and the migration job image. Investigate any
   mismatch or unfinished rollout first.
2. Bootstrap `api:retain-live` with the verified live immutable digest and
   `api:retain-rollback` with the previous successful release digest using
   `gcloud artifacts docker tags add IMAGE@sha256:DIGEST IMAGE:TAG`.
   Pin any other image that must remain redeployable.
3. Install the repository-scoped `siskopArtifactTagCleaner` custom role defined in
   `artifact-tag-cleaner-role.yaml` for `siskop-cloud-build`. `setup-release.sh`
   includes this configuration for new environments. It adds only
   `artifactregistry.tags.delete`; the builder's existing Writer role covers
   creating/moving pins. The builder does not need permission to delete images.
4. Ensure subsequent deployments include the release protection changes. The
   bootstrap pins protect the currently verified live/rollback digests immediately;
   merge the pipeline changes before making further application releases so those
   pins continue to track newly deployed images.
5. Apply and inspect the policy in dry-run mode:

```sh
gcloud artifacts repositories set-cleanup-policies siskop-staging \
  --project=siskop-d0f8c --location=asia-southeast2 \
  --policy=infra/firebase/artifact-cleanup.json --dry-run
```

Google's dry-run audit results need Artifact Registry DATA_WRITE audit logging and
can take about a day. An offline inventory preview is useful for immediate review
but is not a substitute for claiming those provider results have completed.

After reviewing eligible versions and protected digests, enable periodic deletion:

```sh
gcloud artifacts repositories set-cleanup-policies siskop-staging \
  --project=siskop-d0f8c --location=asia-southeast2 \
  --policy=infra/firebase/artifact-cleanup.json --no-dry-run
```

Reapply with `--dry-run` to stop future deletions. Already deleted images are not
restored; rebuild them from source if a fresh deployment is needed. Preserve the
original repository policy configuration before replacing an existing policy.

References: [cleanup policies](https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy)
and [Cloud Run image import](https://docs.cloud.google.com/run/docs/deploying).

## Cost adjustment — 2026-11-09

Reduced the newest-version floor from ten to five and applied the policy to
`siskop-staging`. The seven-day grace period and all `retain-*` / `cache-*`
protections remain. The inventory preview identified five eligible API versions;
actual deletion and reclaimed bytes depend on Google's background cleanup.
Gateway and Firebase-managed repositories remain unchanged.

The backend Dockerfile copies dependency files before application output, directly
from the dependency stage, so application changes do not invalidate that layer.
Docker on Contabo already retains downloaded layers; do not prune its image cache
to save registry storage, because that increases subsequent downloads. Monthly
OS refreshes remain enabled, and new security/dependency layers still need transfer.

## Initial rollout — 2026-09-18

The Jakarta repository contained 33 versions using 9,409,897,550 storage bytes;
it had no cleanup policy. Central Hosting, tenant Hosting, direct API traffic and
the migration job all referenced build `6fe70883-07b4-4180-8daa-3ec88db0e3d1`.
That image was pinned as `retain-live`. The previous successful build
`2affaa4e-1aaf-43bd-9b48-d8397d4f34f3` was pinned as `retain-rollback`.

The policy was installed in dry-run mode and read back, and an offline inventory
preview identified two eligible September 10 images (`landing-20260910-1` and
`landing-20260910-2`). No builds were in flight. Periodic deletion was then enabled;
provider dry-run audit execution and actual storage reclamation were not observed
during this setup. More versions become eligible as they age past seven days.
The custom tag-cleaner role and repository binding were installed. The pipeline
changes still need to be merged before further application releases.
