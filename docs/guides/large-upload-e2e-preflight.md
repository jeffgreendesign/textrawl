# Large-upload E2E pre-flight runbook

A single copy-paste runbook that gates the live end-to-end validation of the
resumable large-upload feature (browser → GCS resumable → Cloud Tasks → status).
It **assembles** the infra steps that already live in the repo and adds the
read-only checks and the **gate ordering** so a CORS/resume mistake is caught
*before* the expensive Cloud Tasks activation.

> **Placeholders only.** Every identifier below (`YOUR_PROJECT`,
> `textrawl-uploads`, `https://dashboard.example.com`, region, service, queue) is
> a placeholder — the maintainer supplies real values at run time. This is a
> public repo: never commit a real origin, bucket, project, or token.
> `scripts/security-check.sh` blocks any `*.vercel.app` hostname.
>
> **Outward-facing steps are the maintainer's.** Provisioning CORS / IAM / the
> queue / Cloud Run env is irreversible-ish and outward-facing. The read-only
> checks here are safe to run any time; the **apply** commands must be reviewed
> and run deliberately. Always pass `--project` explicitly — the active gcloud
> project may differ from the deployment target.

Sources of truth this runbook stitches together (keep them DRY — edit there, not
here):

- Bucket CORS / lifecycle / IAM → [`infra/gcs/`](../../infra/gcs/) (`cors.json`,
  `lifecycle.json`, `README.md`)
- Cloud Tasks queue + OIDC invoker SA + IAM → [`infra/cloud-tasks/`](../../infra/cloud-tasks/)
  (`setup.sh`, `README.md`)
- Cloud Run env activation → [`docs/archive/2026-06-06-phase4-cloud-run-activation.md`](../archive/2026-06-06-phase4-cloud-run-activation.md)
- API contract + smoke checklist → [`docs/archive/2026-05-31-large-upload-gcs-resumable-plan.md`](../archive/2026-05-31-large-upload-gcs-resumable-plan.md) §4, §13
- Deployment reference → [`docs/guides/cloud-run-deployment.mdx`](./cloud-run-deployment.mdx)

---

## 0. Resolve your values

```sh
PROJECT=YOUR_PROJECT                 # GCP project id of the deployment
REGION=YOUR_REGION                   # region of the Cloud Run service (queue is colocated — see note)
SERVICE=YOUR_CLOUD_RUN_SERVICE       # e.g. textrawl
BUCKET=textrawl-uploads              # GCS upload bucket name (no gs:// here)
QUEUE=textrawl-upload-processing     # Cloud Tasks queue id
ORIGIN=https://dashboard.example.com # your real dashboard origin
TASKS_SA=textrawl-tasks@${PROJECT}.iam.gserviceaccount.com

# Live Cloud Run URL (also the Cloud Tasks target base + OIDC audience).
SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" --format='value(status.url)')

echo "account: $(gcloud config get-value account)"   # confirm you are the maintainer
```

> **Region note.** `infra/cloud-tasks/setup.sh` provisions the queue in
> **`us-east4`** (overriding the plan's `us-central1` default) to colocate with
> Cloud Run + the bucket. `CLOUD_TASKS_LOCATION` must equal the queue's actual
> region. Set `REGION` to whatever your service/queue/bucket share.

---

## 1. Read-only pre-flight checks (safe to run now)

None of these mutate anything. Run them first to see exactly what is and isn't
already in place — the only real gap is usually the four env vars + the timeout.

```sh
# Deployed image (expect the current main commit SHA):
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='value(spec.template.spec.containers[0].image)'

# Current request timeout (must be 600 for processing; raise in step 4):
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='value(spec.template.spec.timeoutSeconds)'

# Upload/processing env already on the service (look for the 4 + GCS_UPLOAD_BUCKET):
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='json(spec.template.spec.containers[0].env)'

# Queue exists and is RUNNING (empty/err output = not yet created → step 3):
gcloud tasks queues describe "$QUEUE" --project="$PROJECT" --location="$REGION" \
  --format='value(state)'

# Bucket CORS — assert "Range" is in responseHeader (THE thing chunked resume needs):
gcloud storage buckets describe "gs://${BUCKET}" --project="$PROJECT" \
  --format='json(cors_config)'
```

If `cors_config` is null/empty or its `responseHeader` list lacks `Range`, the
browser cannot read the committed offset and chunked resume breaks — fix in
step 2, then prove it with the probe in [§5](#5-gate-cors--resume-probe-run-before-activation).

---

## 2. (a) Bucket CORS + lifecycle

The canonical config and commands live in [`infra/gcs/`](../../infra/gcs/). The
`cors.json` already exposes `Range` (and the `x-goog-*` headers); you only edit
the **origin**.

1. Edit [`infra/gcs/cors.json`](../../infra/gcs/cors.json): replace
   `https://dashboard.example.com` with your real `$ORIGIN`. **Do not commit the
   real origin** — apply it locally and revert the file, or keep the real value
   only in your working tree.
2. Apply (🚦 outward-facing — review first):

   ```sh
   gcloud storage buckets update "gs://${BUCKET}" --project="$PROJECT" \
     --cors-file=infra/gcs/cors.json
   gcloud storage buckets update "gs://${BUCKET}" --project="$PROJECT" \
     --lifecycle-file=infra/gcs/lifecycle.json
   ```

3. Re-run the read-only CORS check from §1 to confirm `Range` is present.

Bucket creation + IAM (`roles/storage.objectAdmin` for the runtime SA) and
soft-delete disable are in [`infra/gcs/README.md`](../../infra/gcs/README.md) —
only needed if the bucket doesn't exist yet.

---

## 3. (b) Cloud Tasks queue + OIDC invoker SA

Idempotent and safe to re-run; it creates the queue + the `textrawl-tasks`
invoker SA and the IAM grants. Provisioning only — it does **not** set Cloud Run
env or deploy.

```sh
# Review first, then (🚦 outward-facing):
bash infra/cloud-tasks/setup.sh
# overridable: GCP_PROJECT_ID, GCP_REGION, CLOUD_RUN_SERVICE, CLOUD_TASKS_QUEUE, TASKS_SA_NAME
```

Details, IAM rationale, and teardown: [`infra/cloud-tasks/README.md`](../../infra/cloud-tasks/README.md).
The script prints the exact env values to set in step 4.

---

## 4. (c) Cloud Run env activation + raised timeout

This is the only change that makes the async pipeline live. From
[`2026-06-06-phase4-cloud-run-activation.md`](../plans/2026-06-06-phase4-cloud-run-activation.md):

```sh
# 🚦 Outward-facing: creates a new revision from the already-deployed image.
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --update-env-vars="CLOUD_TASKS_QUEUE=${QUEUE},CLOUD_TASKS_LOCATION=${REGION},CLOUD_TASKS_SERVICE_ACCOUNT=${TASKS_SA},UPLOAD_PROCESS_URL=${SERVICE_URL}/api/upload/process,GCS_UPLOAD_BUCKET=${BUCKET}" \
  --timeout=600
```

- `UPLOAD_PROCESS_URL` is **both** the Cloud Tasks target base
  (`<URL>/<uploadId>`) **and** the OIDC audience the app verifies — it must be
  the live `https://…` service URL. The app rejects an invalid URL at startup.
- All of `CLOUD_TASKS_QUEUE` + `UPLOAD_PROCESS_URL` + `CLOUD_TASKS_SERVICE_ACCOUNT`
  must be set together or the app falls back to the in-memory queue (logs a
  warning) and processing stays inert.
- `--update-env-vars` only adds/overwrites the listed keys; other env is
  untouched.
- Concurrency=1–2 / raised memory: the queue caps concurrent dispatches at 2
  (`setup.sh`). If you also want low per-instance concurrency, set it on the
  service (`--concurrency=1`) — see the plan §7 + "Deployment shape".
- Rollback (processing goes inert again):

  ```sh
  gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --remove-env-vars=CLOUD_TASKS_QUEUE,CLOUD_TASKS_LOCATION,CLOUD_TASKS_SERVICE_ACCOUNT,UPLOAD_PROCESS_URL
  ```

---

## 5. GATE: CORS + resume probe (run BEFORE activation)

Prove the browser-direct resumable PUT works cross-origin **before** spending
effort on Cloud Tasks. This needs only step 2 (CORS) + a bucket the runtime/your
identity can write to — not the queue or the env activation.

```sh
# Self-initiate a throwaway session against the bucket (token via gcloud):
pnpm probe:cors -- --bucket "$BUCKET" --origin "$ORIGIN"

# …or probe a throwaway session URI from POST /api/upload/init:
pnpm probe:cors -- --uri "<resumableSessionUri>" --origin "$ORIGIN"
```

The probe ([`scripts/cli/probe-resumable-cors.ts`](../../scripts/cli/probe-resumable-cors.ts))
asserts, with an `Origin` header so it sees what a browser may read:

1. OPTIONS preflight → 200, `Access-Control-Allow-Methods` ⊇ PUT,
   `Access-Control-Allow-Headers` ⊇ `content-range`.
2. A 256 KiB chunked PUT → **308 Resume Incomplete**, `Range` header present,
   and **`Access-Control-Expose-Headers` ⊇ Range** ← the gate.
3. A `Content-Range: bytes */<total>` status probe reports the committed offset.

Non-zero exit = a gate failed; the message names the fix. **Do not proceed to
the smoke test until this is green** — if `Range` isn't exposed cross-origin,
chunked resume cannot work no matter what the server does.

---

## 6. Recommended order

1. Read-only checks (§1).
2. Apply CORS + lifecycle (§2).
3. **Run the probe (§5) — gate.** Green → continue; red → fix CORS, re-probe.
4. Provision the queue + SA (§3).
5. Activate Cloud Run env + timeout (§4).
6. Run the §13 manual smoke-test checklist (next section).

---

## 7. Manual smoke-test checklist (after infra is up)

Drive these from the deployed dashboard, watching server + queue:

```sh
gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
gcloud tasks queues describe "$QUEUE" --project="$PROJECT" --location="$REGION"
```

Record pass/fail per item with the observed status JSON / log lines. From the
plan §13 (stable error codes from `src/utils/errors.ts` in parentheses):

- [ ] Small `.txt` via the direct path still works (document created).
- [ ] Oversized **direct** upload → JSON **413** (`FILE_TOO_LARGE`), not `Load failed`.
- [ ] `>threshold` `.pdf` → `/init` returns `uploadId` + `resumableUri` +
      server-generated `objectKey`; the bar advances by **real bytes**; complete
      → **202**; status `queued → processing → completed`.
- [ ] ZIP of mixed entries → ends **`partial`** with per-entry results in `entries[]`.
- [ ] ZIP path traversal → `ZIP_PATH_TRAVERSAL`; ZIP bomb → `ZIP_BOMB`; **no partial docs**.
- [ ] Unsupported / oversized → a **readable** UI error (never `[object Object]` / `Load failed`).
- [ ] Internal `/api/upload/process/:id` returns **401/403** without a valid Cloud
      Tasks OIDC token (must never return 200):

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "${SERVICE_URL}/api/upload/process/test-id"   # expect 401 or 403, never 200
```
