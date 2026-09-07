#!/usr/bin/env python3
"""Workflow discovery and resumption tests; no GitHub or production calls."""
import importlib.util
from pathlib import Path
import sys
import unittest


SOURCE = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    'feedback_workflow_under_test', SOURCE / 'scripts/wait-feedback-workflow.py')
workflow = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = workflow
spec.loader.exec_module(workflow)

SHA = 'a' * 40
OTHER_SHA = 'b' * 40
REPO_PATH = 'repos/ghostbuilderdev/Journal-de-chantier-SNCF'
WORKFLOW_PATH = '.github/workflows/deploy-feedback.yml'


def run(identifier=101, *, status='completed', conclusion='success', **changes):
    record = {
        'id': identifier, 'workflow_id': 1432, 'head_sha': SHA,
        'head_branch': 'main', 'path': WORKFLOW_PATH, 'event': 'push',
        'status': status, 'conclusion': conclusion,
        'created_at': '2026-09-06T22:00:00Z',
    }
    record.update(changes)
    return record


class Clock:
    def __init__(self):
        self.value = 1000.0

    def now(self):
        return self.value

    def sleep(self, seconds):
        if seconds < 0:
            raise AssertionError('Negative wait requested')
        self.value += max(seconds, 0.001)


class GitHub:
    """Serve realistic API records and explicitly model workflow registration."""
    def __init__(self, *, initial_runs=None, after_dispatch=None,
                 metadata_errors=0, metadata_always_404=False,
                 default_branch='main', remote_sha=SHA):
        self.initial_runs = [run()] if initial_runs is None else initial_runs
        self.after_dispatch = [run(202, event='workflow_dispatch')] if after_dispatch is None else after_dispatch
        self.metadata_errors = metadata_errors
        self.metadata_always_404 = metadata_always_404
        self.default_branch = default_branch
        self.remote_sha = remote_sha
        self.dispatched = False
        self.calls = []
        self.details = {}
        self.list_responses = []
        self.list_error = None
        self.dispatch_errors = []
        self.metadata_state = 'active'

    def __call__(self, method, path, fields=None):
        path = path.lstrip('/')
        self.calls.append((method, path, fields))
        if method == 'GET' and path == REPO_PATH + '/actions/runs':
            if self.list_error is not None:
                raise self.list_error
            if self.list_responses:
                records = self.list_responses.pop(0)
            else:
                records = self.after_dispatch if self.dispatched else self.initial_runs
            return {'total_count': len(records), 'workflow_runs': records}
        if method == 'GET' and path.startswith(REPO_PATH + '/actions/runs/'):
            identifier = int(path.rsplit('/', 1)[1])
            if identifier in self.details:
                responses = self.details[identifier]
                return responses.pop(0) if len(responses) > 1 else responses[0]
            for record in [*self.initial_runs, *self.after_dispatch]:
                if record['id'] == identifier:
                    return record
            raise AssertionError('Polling an unknown execution: ' + str(identifier))
        if method == 'GET' and path == REPO_PATH + '/actions/workflows/deploy-feedback.yml':
            if self.metadata_always_404 or self.metadata_errors:
                self.metadata_errors = max(0, self.metadata_errors - 1)
                raise workflow.APIError(404, 'Workflow not registered yet')
            return {'id': 1432, 'state': self.metadata_state, 'path': WORKFLOW_PATH}
        if method == 'GET' and path == REPO_PATH:
            return {'default_branch': self.default_branch}
        if method == 'GET' and path == REPO_PATH + '/contents/' + WORKFLOW_PATH:
            if fields != {'ref': SHA}:
                raise AssertionError('Diagnostic must inspect the deployed commit')
            return {'type': 'file', 'path': WORKFLOW_PATH}
        if method == 'GET' and path == REPO_PATH + '/git/ref/heads/main':
            return {'ref': 'refs/heads/main', 'object': {'sha': self.remote_sha}}
        if method == 'POST' and path == REPO_PATH + '/actions/workflows/1432/dispatches':
            if fields != {'ref': 'main'}:
                raise AssertionError('Unexpected dispatch target: ' + repr(fields))
            if self.dispatch_errors:
                status = self.dispatch_errors.pop(0)
                if status != 404:
                    # A timed-out response can still correspond to a created run.
                    self.dispatched = True
                raise workflow.APIError(status, 'Dispatch response unavailable')
            self.dispatched = True
            return {}
        raise AssertionError('Unexpected API call: ' + repr((method, path, fields)))

    @property
    def posts(self):
        return [call for call in self.calls if call[0] == 'POST']

    @property
    def metadata_calls(self):
        return [call for call in self.calls if call[1].endswith('/actions/workflows/deploy-feedback.yml')]


class WorkflowWaitTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.output = []

    def wait(self, api, *, resume=False, discovery_timeout=30, completion_timeout=30):
        return workflow.wait_for_workflow(
            SHA, resume=resume, api=api, sleep=self.clock.sleep,
            now=self.clock.now, output=self.output.append,
            discovery_timeout=discovery_timeout, completion_timeout=completion_timeout)

    def test_push_run_discovery_uses_repository_endpoint_and_exact_commit(self):
        api = GitHub()
        self.assertEqual(self.wait(api), 101)
        calls = [call for call in api.calls if call[1] == REPO_PATH + '/actions/runs']
        self.assertTrue(calls)
        self.assertEqual(calls[0][2]['head_sha'], SHA)
        self.assertEqual(calls[0][2]['branch'], 'main')
        self.assertEqual(int(calls[0][2]['per_page']), 100)
        self.assertFalse(api.posts)

    def test_ignores_other_workflow_commit_branch_event_and_similar_path(self):
        ignored = [
            run(501, path='.github/workflows/pages.yml'),
            run(502, head_sha=OTHER_SHA),
            run(503, head_branch='feature'),
            run(504, event='pull_request'),
            run(505, path=WORKFLOW_PATH + '.backup'),
        ]
        valid = run(601, path=WORKFLOW_PATH + '@main', status='in_progress', conclusion=None)
        api = GitHub(initial_runs=[*ignored, valid])
        api.details[601] = [run(601, path=WORKFLOW_PATH + '@main')]
        self.assertEqual(self.wait(api), 601)
        self.assertFalse(api.posts)

    def test_temporary_empty_repository_run_list_is_polled(self):
        api = GitHub()
        api.list_responses = [[], []]
        self.assertEqual(self.wait(api), 101)
        self.assertGreater(self.clock.value, 1000)

    def test_latest_failed_run_does_not_accept_older_success(self):
        api = GitHub(initial_runs=[
            run(99), run(101, conclusion='failure', created_at='2026-09-06T22:01:00Z')])
        with self.assertRaises(RuntimeError):
            self.wait(api)
        self.assertFalse(api.posts)

    def test_resume_reuses_active_run_without_dispatch(self):
        api = GitHub(initial_runs=[run(status='in_progress', conclusion=None)])
        api.details[101] = [
            run(status='in_progress', conclusion=None), run()]
        self.assertEqual(self.wait(api, resume=True), 101)
        self.assertFalse(api.posts)

    def test_resume_reuses_success_without_dispatch(self):
        api = GitHub()
        self.assertEqual(self.wait(api, resume=True), 101)
        self.assertFalse(api.posts)

    def test_resume_registration_404_is_retried_and_dispatch_happens_once(self):
        api = GitHub(initial_runs=[], metadata_errors=2)
        self.assertEqual(self.wait(api, resume=True), 202)
        self.assertGreaterEqual(len(api.metadata_calls), 3)
        self.assertEqual(len(api.posts), 1)

    def test_resume_failed_run_requires_a_new_execution(self):
        api = GitHub(initial_runs=[run(conclusion='failure')])
        self.assertEqual(self.wait(api, resume=True), 202)
        self.assertEqual(len(api.posts), 1)

    def test_ambiguous_dispatch_response_never_posts_twice(self):
        for status in (0, 408, 429, 500, 502):
            with self.subTest(status=status):
                api = GitHub(initial_runs=[])
                api.dispatch_errors = [status]
                self.assertEqual(self.wait(api, resume=True), 202)
                self.assertEqual(len(api.posts), 1)

    def test_rejected_dispatch_404_can_be_retried(self):
        api = GitHub(initial_runs=[])
        api.dispatch_errors = [404]
        self.assertEqual(self.wait(api, resume=True), 202)
        self.assertEqual(len(api.posts), 2)

    def test_old_run_cannot_approve_interface_after_dispatch(self):
        failed = run(101, conclusion='failure')
        api = GitHub(initial_runs=[run(99), failed], after_dispatch=[run(99), failed])
        with self.assertRaises(RuntimeError):
            self.wait(api, resume=True, discovery_timeout=11)
        self.assertEqual(len(api.posts), 1)

    def test_permanent_workflow_404_stops_without_dispatch(self):
        api = GitHub(initial_runs=[], metadata_always_404=True)
        with self.assertRaises(RuntimeError):
            self.wait(api, resume=True, discovery_timeout=11)
        self.assertFalse(api.posts)
        self.assertGreaterEqual(self.clock.value, 1011)

    def test_permission_error_stops_immediately_without_secret_echo(self):
        api = GitHub()
        marker = 'postgresql://postgres:DO_NOT_PRINT_PASSWORD@db.example/postgres'
        api.list_error = workflow.APIError(403, marker)
        with self.assertRaises(RuntimeError) as failure:
            self.wait(api)
        self.assertLessEqual(self.clock.value, 1005)
        self.assertFalse(api.posts)
        self.assertNotIn(marker, str(failure.exception) + '\n'.join(self.output))

    def test_remote_main_advanced_stops_before_dispatch(self):
        api = GitHub(initial_runs=[], remote_sha=OTHER_SHA)
        with self.assertRaises(RuntimeError):
            self.wait(api, resume=True)
        self.assertFalse(api.posts)

    def test_non_main_default_branch_stops_before_dispatch(self):
        api = GitHub(initial_runs=[], default_branch='master')
        with self.assertRaises(RuntimeError):
            self.wait(api, resume=True)
        self.assertFalse(api.posts)

    def test_disabled_workflow_is_not_automatically_enabled(self):
        api = GitHub(initial_runs=[])
        api.metadata_state = 'disabled_manually'
        with self.assertRaises(RuntimeError):
            self.wait(api, resume=True)
        self.assertFalse(api.posts)

    def test_active_execution_timeout_never_reports_success(self):
        api = GitHub(initial_runs=[run(status='in_progress', conclusion=None)])
        with self.assertRaises(RuntimeError):
            self.wait(api, completion_timeout=11)
        self.assertFalse(api.posts)


if __name__ == '__main__':
    unittest.main()
