#!/bin/bash
set -e

PROJECT_ID=${GCP_PROJECT_ID:?"Set GCP_PROJECT_ID"}
REGION=${GCP_REGION:-"us-central1"}
SERVICE_NAME="textrawl"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/textrawl/textrawl"

echo "Building and pushing image..."
docker build -t $IMAGE:latest .
docker push $IMAGE:latest

echo "Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE:latest \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --set-secrets="API_BEARER_TOKEN=textrawl-api-token:latest,SUPABASE_URL=textrawl-supabase-url:latest,SUPABASE_SERVICE_KEY=textrawl-supabase-key:latest,OPENAI_API_KEY=textrawl-openai-key:latest" \
  --min-instances 0 \
  --max-instances 10 \
  --memory 512Mi \
  --cpu 1 \
  --cpu-boost

echo "Deployed: $(gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)')"
