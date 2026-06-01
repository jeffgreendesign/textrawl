#!/bin/bash
#
# Cloud Tasks provisioning for the async upload-processing pipeline (Phase 4,
# docs/plans/2026-06-01-phase4-cloud-tasks-impl.md).
#
# Creates: Cloud Tasks queue + a dedicated OIDC "invoker" service account, and
# the IAM grants so the Cloud Run runtime SA can enqueue OIDC-authenticated
# tasks that call the internal /api/upload/process endpoint.
#
# Idempotent and safe to re-run. Does NOT set Cloud Run env vars or redeploy —
# do that when the T4.1–T4.3 code is deployed (see README "Configure Cloud Run").
# Does NOT hardcode project number / SA email / service URL — all derived at
# runtime so nothing identifying is committed.
#
# Run with an account that has, on the target project:
#   roles/serviceusage.serviceUsageAdmin, roles/cloudtasks.admin,
#   roles/iam.serviceAccountAdmin, roles/resourcemanager.projectIamAdmin
# (or Editor/Owner). The active gcloud project is ignored — everything targets
# --project="$PROJECT" explicitly.
set -euo pipefail

PROJECT="${GCP_PROJECT_ID:-textrawl}"
REGION="${GCP_REGION:-us-east4}"
SERVICE="${CLOUD_RUN_SERVICE:-textrawl}"
QUEUE="${CLOUD_TASKS_QUEUE:-textrawl-upload-processing}"
TASKS_SA_NAME="${TASKS_SA_NAME:-textrawl-tasks}"
TASKS_SA="${TASKS_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

echo "Project=$PROJECT  Region=$REGION  Service=$SERVICE  Queue=$QUEUE"
echo "OIDC invoker SA=$TASKS_SA"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')

# Enqueuer identity = the Cloud Run runtime SA of $SERVICE (default compute SA if unset).
RUNTIME_SA=$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)
[ -z "$RUNTIME_SA" ] && RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "Enqueuer (Cloud Run runtime) SA=$RUNTIME_SA"

CLOUD_TASKS_AGENT="service-${PROJECT_NUMBER}@gcp-sa-cloudtasks.iam.gserviceaccount.com"

# 1. Enable the Cloud Tasks API (also provisions the Cloud Tasks service agent).
echo "==> Enabling cloudtasks.googleapis.com"
gcloud services enable cloudtasks.googleapis.com --project="$PROJECT"

# 2. Create the processing queue (low concurrency to protect memory for large files).
echo "==> Creating queue $QUEUE"
if gcloud tasks queues describe "$QUEUE" --project="$PROJECT" --location="$REGION" >/dev/null 2>&1; then
  echo "    queue already exists (ok)"
else
  gcloud tasks queues create "$QUEUE" --project="$PROJECT" --location="$REGION" \
    --max-concurrent-dispatches=2 \
    --max-attempts=5 \
    --min-backoff=10s --max-backoff=300s
fi

# 3. Dedicated OIDC invoker SA (the identity in the task's OIDC token; the app
#    verifies payload.email == CLOUD_TASKS_SERVICE_ACCOUNT).
echo "==> Creating invoker SA $TASKS_SA_NAME"
if gcloud iam service-accounts describe "$TASKS_SA" --project="$PROJECT" >/dev/null 2>&1; then
  echo "    invoker SA already exists (ok)"
else
  gcloud iam service-accounts create "$TASKS_SA_NAME" --project="$PROJECT" \
    --display-name="Textrawl Cloud Tasks OIDC invoker"
fi

# 4. Runtime SA may enqueue onto this queue (queue-scoped least privilege).
echo "==> Grant cloudtasks.enqueuer to runtime SA (queue-scoped)"
gcloud tasks queues add-iam-policy-binding "$QUEUE" --project="$PROJECT" --location="$REGION" \
  --member="serviceAccount:${RUNTIME_SA}" --role="roles/cloudtasks.enqueuer" >/dev/null

# 5. Runtime SA may actAs the invoker SA (required to attach an OIDC token to tasks).
echo "==> Grant iam.serviceAccountUser on invoker SA to runtime SA"
gcloud iam service-accounts add-iam-policy-binding "$TASKS_SA" --project="$PROJECT" \
  --member="serviceAccount:${RUNTIME_SA}" --role="roles/iam.serviceAccountUser" \
  --condition=None >/dev/null

# 6. Cloud Tasks service agent may mint OIDC tokens as the invoker SA at dispatch.
#    If this aborts because the agent isn't provisioned yet (race right after the
#    API enable in step 1), wait ~1 minute and re-run — the script is idempotent.
echo "==> Grant iam.serviceAccountTokenCreator on invoker SA to Cloud Tasks agent"
gcloud iam service-accounts add-iam-policy-binding "$TASKS_SA" --project="$PROJECT" \
  --member="serviceAccount:${CLOUD_TASKS_AGENT}" --role="roles/iam.serviceAccountTokenCreator" \
  --condition=None >/dev/null

# The service may not exist yet (provisioning can run before the first deploy);
# guard the describe so set -e doesn't abort right before the summary.
SERVICE_URL=""
if gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" >/dev/null 2>&1; then
  SERVICE_URL=$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(status.url)')
fi
if [ -n "$SERVICE_URL" ]; then
  PROCESS_URL="$SERVICE_URL/api/upload/process"
else
  PROCESS_URL="<service-url>/api/upload/process   # service not deployed yet — re-run after deploy"
fi

cat <<EOF

✅ Provisioned. Set these on the '$SERVICE' Cloud Run service when the Phase 4
   code (T4.1–T4.3) is deployed, then redeploy:

   CLOUD_TASKS_QUEUE=$QUEUE
   CLOUD_TASKS_LOCATION=$REGION
   CLOUD_TASKS_SERVICE_ACCOUNT=$TASKS_SA
   UPLOAD_PROCESS_URL=$PROCESS_URL
   GCS_UPLOAD_BUCKET=textrawl-uploads        # wire the bucket if not already set

   And raise the processing request timeout to 600s:
   gcloud run services update $SERVICE --project=$PROJECT --region=$REGION --timeout=600
EOF
