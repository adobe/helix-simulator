#!/bin/bash

# $1 = $SMOKE_TEST_TOKEN
# $2 = smoke_job.json
# $3 = << parameters.repo >>
# $4 = step name ("Running Smoke Tests")

smoke_job_build_num=$(jq '.build_num' < $2)

build_url="https://circleci.com/api/v1.1/project/github/$3/${smoke_job_build_num}"

smoke_result_file="smoke_result.json"
smoke_step_name="$4"
echo "smoke_step_name=${smoke_step_name=}"

echo "Waiting now for smoke tests job execution. See build ${build_url}."

RUNNING=true
    while [ $RUNNING == true ]; do
    sleep 10;
    status=$(curl --silent --header "Accept: application/json" "${build_url}?circle-token=$1" | tee ${smoke_result_file} | jq -r '.status');
    echo 'running queued scheduled not_running' | grep --silent "$status" || RUNNING=false;
    echo -n "."
done

echo ""
echo "Smoke tests ${build_url} finished with status ${status}"

if [[ $status == 'fixed success' ]]
then
    exit_code=0
else
    exit_code=1

    # get the output_url property from the "Running Smoke Tests" job in the json response
    output_url=$(jq -r '.steps[] | select(.name == ("${smoke_step_name}")) | .actions[0].output_url' ${smoke_result_file});

    echo ""
    echo "Smoke tests error message:"
    echo ""

    if [ ! -z "$output_url" ]
    then
        # call the output url to fetch the error message and display it
        error_message=$(curl --silent --compressed --header "Accept: application/json" "${output_url}" | jq -r '.[0].message');
        echo "${error_message}"
    else
        # no output_url, unknown error
        echo "Unknown error. Check the smoke test job execution logs for more details."
    fi
    echo ""
fi
exit $exit_code