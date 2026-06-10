# Phase 4 — Cloud Run activation

**Date:** 2026-06-06 · **Status:** Ready to run (maintainer step) · **Parent:**
[infra/cloud-tasks/README.md](../../infra/cloud-tasks/README.md),
[2026-06-01-phase4-cloud-tasks-impl.md](2026-06-01-phase4-cloud-tasks-impl.md)

Phase 4 (async upload processing via Google Cloud Tasks) is merged to `main` and the
image auto-deploys to Cloud Run (Cloud Build source-deploy on push to `main`). The
feature is **inert** until four env vars are set on the service and the request timeout
is raised. Everything else — the Cloud Tasks queue, the OIDC invoker SA, the GCS bucket,
and all IAM bindings — is already provisioned by
[infra/cloud-tasks/setup.sh](../../infra/cloud-tasks/setup.sh); do **not** re-run it.

> Identifiers below are placeholders (this is a public repo). Resolve the real values
> from gcloud at run time — the active gcloud project may differ from the target, so
> always pass `--project` explicitly. Confirm your account with
> `gcloud config get-value account`.

## Resolve your values first

```sh
PROJECT=<your-project>            # GCP project id of the deployment
REGION=<your-region>             # region of the Cloud Run service + queue + bucket
SERVICE=<your-cloud-run-service> # Cloud Run service name
QUEUE=<your-upload-processing-queue>
TASKS_SA=<tasks-sa>@${PROJECT}.iam.gserviceaccount.com
SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" --format='value(status.url)')
```

Optional sanity checks (the only gap is the four env vars + the timeout):

```sh
# Already-deployed image (expect the current main commit SHA):
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='value(spec.template.spec.containers[0].image)'
# Queue is RUNNING:
gcloud tasks queues describe "$QUEUE" --project="$PROJECT" --location="$REGION" \
  --format='value(state)'
# Current request timeout (raise to 600 below):
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='value(spec.template.spec.timeoutSeconds)'
```

`GCS_UPLOAD_BUCKET` is expected to already be set on the service (Phase 3 storage); if
it is not, add it to the `--update-env-vars` list below.

## Activate (the only change)

```sh
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --update-env-vars="CLOUD_TASKS_QUEUE=${QUEUE},CLOUD_TASKS_LOCATION=${REGION},CLOUD_TASKS_SERVICE_ACCOUNT=${TASKS_SA},UPLOAD_PROCESS_URL=${SERVICE_URL}/api/upload/process" \
  --timeout=600
```

- `UPLOAD_PROCESS_URL` is BOTH the Cloud Tasks target base (task → `<URL>/<uploadId>`)
  AND the OIDC audience the app verifies. It must be the live `https://…` service URL;
  the app rejects an invalid URL at startup (zod `.url()`).
- All of `CLOUD_TASKS_QUEUE` + `UPLOAD_PROCESS_URL` + `CLOUD_TASKS_SERVICE_ACCOUNT` must
  be set together, or the app falls back to the in-memory queue (logs a warning).
- `--update-env-vars` only adds/overwrites the listed keys; other env is untouched.
- This changes live production config (creates a new revision from the same already-
  deployed image). It is outward-facing — confirm before running it.

## Verify after (smoke test)

See the checklist in
[2026-05-31-large-upload-gcs-resumable-plan.md](2026-05-31-large-upload-gcs-resumable-plan.md)
§13.

1. Internal endpoint rejects non-OIDC callers — must never return 200:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     "${SERVICE_URL}/api/upload/process/test-id"   # expect 401 or 403
   ```

2. End-to-end: a large upload flows `/init` → resumable PUT to GCS → `/complete` (202)
   → a task appears in the queue → `GET /api/upload/:id/status` goes
   `queued → processing → completed` with a document created. Watch:

   ```sh
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   gcloud tasks queues describe "$QUEUE" --project="$PROJECT" --location="$REGION"
   ```

## Rollback

Reverts to the in-memory queue (processing goes inert again):

```sh
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --remove-env-vars=CLOUD_TASKS_QUEUE,CLOUD_TASKS_LOCATION,CLOUD_TASKS_SERVICE_ACCOUNT,UPLOAD_PROCESS_URL
```
