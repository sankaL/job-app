#!/usr/bin/env python3
"""Wait for the requested main commit to become an active Railway release."""

import argparse
import json
import subprocess
import time


TERMINAL_FAILURES = {"FAILED", "CRASHED", "REMOVED", "CANCELLED", "SKIPPED"}


def railway_json(arguments, timeout):
    result = subprocess.run(
        ["railway", *arguments, "--json"],
        capture_output=True,
        text=True,
        check=True,
        timeout=timeout,
    )
    return json.loads(result.stdout)


def release_is_active(project, environment, service, deployment_id):
    for edge in project["environments"]["edges"]:
        env = edge["node"]
        if environment not in (env["name"], env["id"]):
            continue
        for instance_edge in env["serviceInstances"]["edges"]:
            instance = instance_edge["node"]
            if service not in (instance["serviceName"], instance["serviceId"]):
                continue
            for deployment in instance.get("activeDeployments", []):
                instances = deployment.get("instances", [])
                if (
                    deployment["id"] == deployment_id
                    and deployment["status"] == "SUCCESS"
                    and not deployment.get("deploymentStopped", False)
                    and instances
                    and all(item["status"] == "RUNNING" for item in instances)
                ):
                    return True
    return False


def wait_for_release(project, environment, service, commit, timeout=600, *,
                     query=railway_json, now=time.monotonic, sleep=time.sleep):
    deadline = now() + timeout
    previous = None
    consecutive_errors = 0
    target_id = None
    while now() < deadline:
        try:
            remaining = max(1, min(30, deadline - now()))
            deployments = query(
                ["deployment", "list", "--project", project, "--environment", environment,
                 "--service", service, "--limit", "1"], remaining,
            )
            deployment = deployments[0] if deployments else None
            message = (deployment or {}).get("meta", {}).get("cliMessage", "")
            if not message.endswith("from main @ " + commit):
                if target_id is not None:
                    raise RuntimeError("A different deployment superseded the requested release.")
                state = "Waiting for a deployment of the requested commit"
            else:
                target_id = deployment["id"]
                status = deployment["status"]
                if status in TERMINAL_FAILURES:
                    raise RuntimeError("Railway deployment ended with status " + status + ".")
                state = "Railway deployment " + target_id + ": " + status
                if status == "SUCCESS":
                    remaining = deadline - now()
                    if remaining <= 0:
                        break
                    status_data = query(
                        ["status", "--project", project, "--environment", environment],
                        min(30, remaining),
                    )
                    if release_is_active(status_data, environment, service, target_id):
                        print("Railway release " + target_id + " is active and running.")
                        return target_id
                    state += "; waiting for running instances"
            consecutive_errors = 0
        except (subprocess.SubprocessError, ValueError, KeyError, TypeError) as error:
            consecutive_errors += 1
            if consecutive_errors >= 3:
                raise RuntimeError("Railway verification failed after three consecutive API errors: "
                                   + type(error).__name__ + ".") from None
            state = "Retrying Railway verification after " + type(error).__name__
        if state != previous:
            print(state, flush=True)
            previous = state
        sleep(max(0, min(5, deadline - now())))
    raise RuntimeError("Timed out waiting for the requested Railway release to become active.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--environment", default="production")
    parser.add_argument("--service", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    if not 1 <= args.timeout <= 1800:
        parser.error("timeout must be between 1 and 1800 seconds")
    try:
        wait_for_release(args.project, args.environment, args.service, args.commit, args.timeout)
    except RuntimeError as error:
        parser.exit(1, str(error) + "\n")


if __name__ == "__main__":
    main()
