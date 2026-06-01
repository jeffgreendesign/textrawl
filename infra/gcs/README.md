# GCS provisioning — large-upload bucket

Infra-as-config for the resumable large-upload workflow
(`docs/plans/2026-05-31-large-upload-gcs-resumable-plan.md`, §3–§7).

## Resource

| Setting | Value |
|---|---|
| Bucket | `gs://textrawl-uploads` |
| Project | `textrawl` (607480003712) |
| Location | `us-east4` (colocated with the Cloud Run `textrawl` service) |
| Uniform bucket-level access | enabled |
| Public access prevention | enforced |
| Soft-delete | disabled (transient bytes; avoids paying to retain deleted upload objects) |
| Lifecycle | delete objects ≥ 1 day old (abandoned-upload cleanup; `UPLOAD_CLEANUP_TTL_HOURS=24`) |
| IAM | `607480003712-compute@developer.gserviceaccount.com` → `roles/storage.objectAdmin` (bucket-scoped) |

The Cloud Run runtime SA (the default compute SA) reads/writes via ADC — no
service-account keys.

## Re-apply config

```sh
PROJECT=textrawl
BUCKET=gs://textrawl-uploads

# CORS (dashboard origin + localhost for browser-direct resumable PUTs)
gcloud storage buckets update $BUCKET --project=$PROJECT --cors-file=infra/gcs/cors.json

# Lifecycle (delete abandoned objects after 1 day)
gcloud storage buckets update $BUCKET --project=$PROJECT --lifecycle-file=infra/gcs/lifecycle.json
```

## One-time creation (already done)

```sh
gcloud storage buckets create gs://textrawl-uploads \
  --project=textrawl --location=us-east4 \
  --uniform-bucket-level-access --public-access-prevention

gcloud storage buckets add-iam-policy-binding gs://textrawl-uploads \
  --project=textrawl \
  --member="serviceAccount:607480003712-compute@developer.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

gcloud storage buckets update gs://textrawl-uploads --project=textrawl --clear-soft-delete
```

## Server env (set on Cloud Run when the GCS StorageService lands, T3.2)

```sh
GCS_UPLOAD_BUCKET=textrawl-uploads
GCS_PROJECT_ID=textrawl   # optional; auto-detected from ADC otherwise
```

## CORS origins

Edit `cors.json` and re-apply when the dashboard origin changes. Current:
`https://dashboard-lilac-one-63.vercel.app`, `http://localhost:3000`.
