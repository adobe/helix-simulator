#!/bin/bash

# $1 = ${SMOKE_TEST_TOKEN}
# $2 = << parameters.remote_job >> (REMOTE_JOB_NAME)
# $3 = ${CIRCLE_BRANCH} (CIRCLE_PROJECT_REPONAME)
# $4 = << parameters.repo >> (REMOTE_REPO)
# $5 = REMOTE_BRANCH
# $6 = smoke_job.json


curl \
    --user $1: \
    --header "Content-Type: application/json" \
    --silent \
    --data "{\"build_parameters\": {\"CIRCLE_JOB\": \"$2\", \"GDM_MODULE_BRANCHES\": { \"${CIRCLE_PROJECT_REPONAME}\": \"$3\"}}}" \
    --request POST "https://circleci.com/api/v1.1/project/github/$4/tree/$5" > $6