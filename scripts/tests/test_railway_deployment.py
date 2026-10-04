import importlib.util
from pathlib import Path
import subprocess
import unittest


spec = importlib.util.spec_from_file_location(
    "wait_railway", Path(__file__).resolve().parents[1] / "wait-railway-deployment.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def deployment(status="SUCCESS", commit="expected", identifier="release"):
    return [{"id": identifier, "status": status,
             "meta": {"cliMessage": "deploy backend from main @ " + commit}}]


def project_status(status="RUNNING", identifier="release"):
    return {"environments": {"edges": [{"node": {
        "id": "env-id", "name": "production", "serviceInstances": {"edges": [{"node": {
            "serviceName": "backend", "serviceId": "service-id", "activeDeployments": [{
                "id": identifier, "status": "SUCCESS", "instances": [{"status": status}],
            }],
        }}]},
    }}]}}


class RailwayReleaseTests(unittest.TestCase):
    def wait(self, replies, timeout=30):
        elapsed = [0]
        self.calls = []

        def query(arguments, query_timeout):
            self.calls.append((arguments, query_timeout))
            reply = replies.pop(0) if len(replies) > 1 else replies[0]
            if isinstance(reply, Exception):
                raise reply
            return reply

        return module.wait_for_release(
            "project", "production", "backend", "expected", timeout,
            query=query, now=lambda: elapsed[0],
            sleep=lambda seconds: elapsed.__setitem__(0, elapsed[0] + seconds),
        )

    def test_build_success_waits_for_requested_release_to_be_running(self):
        result = self.wait([
            deployment(commit="previous"), deployment("BUILDING"),
            deployment(), project_status("STARTING"),
            deployment(), project_status(),
        ])
        self.assertEqual(result, "release")
        self.assertEqual(len(self.calls), 6)

    def test_old_active_release_cannot_satisfy_success(self):
        with self.assertRaisesRegex(RuntimeError, "Timed out"):
            self.wait([deployment(), project_status(identifier="old")], timeout=5)

    def test_failed_deployment_stops_without_waiting_for_timeout(self):
        with self.assertRaisesRegex(RuntimeError, "FAILED"):
            self.wait([deployment("FAILED")])
        self.assertEqual(len(self.calls), 1)

    def test_superseded_release_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "superseded"):
            self.wait([deployment("BUILDING"), deployment(commit="newer")])

    def test_cli_errors_are_bounded_and_do_not_expose_stderr(self):
        error = subprocess.CalledProcessError(1, ["railway"], stderr="private-token")
        with self.assertRaisesRegex(RuntimeError, "three consecutive API errors") as raised:
            self.wait([error])
        self.assertNotIn("private-token", str(raised.exception))
        self.assertEqual(len(self.calls), 3)

    def test_wrong_environment_or_service_is_not_active(self):
        self.assertFalse(module.release_is_active(project_status(), "staging", "backend", "release"))
        self.assertFalse(module.release_is_active(project_status(), "production", "agents", "release"))


if __name__ == "__main__":
    unittest.main()
