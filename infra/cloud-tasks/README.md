# Cloud Tasks provisioning — async upload processing

Infra-as-config for the Phase 4 async pipeline
(`docs/plans/2026-06-01-phase4-cloud-tasks-impl.md`). Cloud Tasks delivers an
OIDC-authenticated request to the internal `POST /api/upload/process/:uploadId`
endpoint on the existing `textrawl` Cloud Run service; the app verifies the OIDC
token itself (the service is public for MCP/API, so this is the access control).

## Resources created by `setup.sh`

| Resource | Value |
|---|---|
| Cloud Tasks queue | `<your-upload-processing-queue>` (colocated with Cloud Run + the GCS bucket) |
| OIDC invoker SA | `textrawl-tasks@<project>.iam.gserviceaccount.com` (identity in the task's OIDC token) |
| Enqueuer | the Cloud Run runtime SA (default compute SA) — granted `cloudtasks.enqueuer` (queue-scoped) |
| actAs | runtime SA granted `iam.serviceAccountUser` on the invoker SA |
| token mint | Cloud Tasks service agent granted `iam.serviceAccountTokenCreator` on the invoker SA |

Queue location is `us-east4` (the plan's `us-central1` default is overridden to
colocate with the Cloud Run service and bucket). Cost is effectively $0 — Cloud
Tasks' first 1M operations/month are free and an idle queue has no standing cost.

## Run it

Set the target project/region explicitly instead of relying on your active
gcloud project. Review, then:

```sh
bash infra/cloud-tasks/setup.sh
# overridable: GCP_PROJECT_ID, GCP_REGION, CLOUD_RUN_SERVICE, CLOUD_TASKS_QUEUE, TASKS_SA_NAME
```

The runner needs admin on the target project (service-usage, Cloud Tasks,
service-account, project-IAM admin — or Editor/Owner). If your account lacks
these, run as the project owner.

It is idempotent — safe to re-run. If step 6 fails because the Cloud Tasks
service agent isn't provisioned yet, wait ~1 minute after the API enable and
re-run.

## Configure Cloud Run (do this when the T4.1–T4.3 code is deployed)

`setup.sh` prints the exact values. The processing code reads these env vars;
they are inert until that code ships, so set them at the same deploy:

```sh
gcloud run services update <service-name> --project=<your-project> --region=<your-region> \
  --update-env-vars="CLOUD_TASKS_QUEUE=<your-upload-processing-queue>,CLOUD_TASKS_LOCATION=<your-region>,CLOUD_TASKS_SERVICE_ACCOUNT=<tasks-sa>@<project>.iam.gserviceaccount.com,UPLOAD_PROCESS_URL=<service-url>/api/upload/process,GCS_UPLOAD_BUCKET=<your-upload-bucket>" \
  --timeout=600
```

Notes:

- `UPLOAD_PROCESS_URL` is the live service URL + `/api/upload/process`; it is
  both the task target base and the OIDC audience the app verifies.
- `GCS_UPLOAD_BUCKET` must be set for production large uploads. If it is unset,
  storage falls back to an in-memory fake intended only for local/dev use.
- `--timeout=600` raises the request budget for streaming/extraction (currently
  300s).

## Teardown

```sh
gcloud tasks queues delete <your-upload-processing-queue> --project=<your-project> --location=<your-region>
gcloud iam service-accounts delete <tasks-sa>@<project>.iam.gserviceaccount.com --project=<your-project>
```
