#!/usr/bin/env bash
# Run after completing the one-time Cloud Build GitHub authorization.
set -euo pipefail
project=fun-opensmash-builds
account=thomas@fun.inc
region=us-central1
state=$(gcloud builds connections describe opensmash --project="$project" --region="$region" --account="$account" --format='value(installationState.stage)')
if [[ "$state" != COMPLETE ]]; then
  gcloud builds connections describe opensmash --project="$project" --region="$region" --account="$account" --format='yaml(installationState)'
  exit 1
fi
if ! gcloud builds repositories describe opensmash-melee --connection=opensmash --region="$region" --project="$project" --account="$account" >/dev/null 2>&1; then
  gcloud builds repositories create opensmash-melee --remote-uri=https://github.com/turtlesoupy/opensmash-melee.git --connection=opensmash --region="$region" --project="$project" --account="$account"
fi
if gcloud builds triggers describe desktop-release --region="$region" --project="$project" --account="$account" >/dev/null 2>&1; then
  echo 'Release trigger already exists; inspect it before changing its policy.'
else
  gcloud builds triggers create github --name=desktop-release --region="$region" --project="$project" --account="$account" \
    --repository="projects/$project/locations/$region/connections/opensmash/repositories/opensmash-melee" \
    --tag-pattern='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' \
    --build-config=infra/gcp/cloudbuild.yaml \
    --service-account="projects/$project/serviceAccounts/release-coordinator@$project.iam.gserviceaccount.com"
fi
