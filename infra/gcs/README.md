# GCS provisioning — large-upload bucket

Infra-as-config for the resumable large-upload workflow
(`docs/archive/2026-05-31-large-upload-gcs-resumable-plan.md`, §3–§7).

## Resource

| Setting | Value |
|---|---|
| Bucket | `gs://<your-upload-bucket>` |
| Project | `<your-project>` (`<your-project-number>`) |
| Location | `<your-region>` (colocated with the Cloud Run service) |
| Uniform bucket-level access | enabled |
| Public access prevention | enforced |
| Soft-delete | disabled (transient bytes; avoids paying to retain deleted upload objects) |
| Lifecycle | delete objects ≥ 1 day old (abandoned-upload cleanup; `UPLOAD_CLEANUP_TTL_HOURS=24`) |
| IAM | `<runtime-sa>@<project>.iam.gserviceaccount.com` → `roles/storage.objectAdmin` (bucket-scoped) |

The Cloud Run runtime SA (the default compute SA) reads/writes via ADC — no
service-account keys.

## Re-apply config

```sh
PROJECT=<your-project>
BUCKET=gs://<your-upload-bucket>

# CORS (dashboard origin + localhost for browser-direct resumable PUTs)
gcloud storage buckets update $BUCKET --project=$PROJECT --cors-file=infra/gcs/cors.json

# Lifecycle (delete abandoned objects after 1 day)
gcloud storage buckets update $BUCKET --project=$PROJECT --lifecycle-file=infra/gcs/lifecycle.json
```

## One-time creation

```sh
PROJECT=<your-project>
REGION=<your-region>
BUCKET=gs://<your-upload-bucket>
RUNTIME_SA=<runtime-sa>@<project>.iam.gserviceaccount.com

gcloud storage buckets create $BUCKET \
  --project=$PROJECT --location=$REGION \
  --uniform-bucket-level-access --public-access-prevention

gcloud storage buckets add-iam-policy-binding $BUCKET \
  --project=$PROJECT \
  --member="serviceAccount:$RUNTIME_SA" \
  --role="roles/storage.objectAdmin"

gcloud storage buckets update $BUCKET --project=$PROJECT --clear-soft-delete
```

## Server env (set on Cloud Run when the GCS StorageService lands, T3.2)

```sh
GCS_UPLOAD_BUCKET=<your-upload-bucket>
GCS_PROJECT_ID=<your-project>   # optional; auto-detected from ADC otherwise
```

## CORS origins

`cors.json` ships with a placeholder origin (`https://dashboard.example.com`). Replace it with your
real dashboard origin and re-apply whenever the origin changes; `http://localhost:3000` covers local
browser-direct PUTs.
