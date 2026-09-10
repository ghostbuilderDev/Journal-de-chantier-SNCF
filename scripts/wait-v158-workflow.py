#!/usr/bin/env python3
"""Wait for the exact release run without resolving a newly created workflow first."""
import json
import re
import subprocess
import sys
import time

REPOSITORY = 'ghostbuilderdev/Journal-de-chantier-SNCF'
WORKFLOW = 'deploy-v158.yml'
WORKFLOW_PATH = '.github/workflows/' + WORKFLOW
BASE = 'repos/' + REPOSITORY
ACTIONS_URL = 'https://github.com/' + REPOSITORY + '/actions'


class APIError(RuntimeError):
    def __init__(self, status, message=''):
        self.status = status
        # Raw HTTP bodies and authenticated command output never enter diagnostics.
        super().__init__(f'GitHub API HTTP {status or "indisponible"}')


def gh_api(method, path, fields=None):
    command = ['gh', 'api', '--method', method, path]
    for key, value in (fields or {}).items():
        command += ['-f', f'{key}={value}']
    try:
        result = subprocess.run(command, text=True, capture_output=True, timeout=45)
    except (OSError, subprocess.TimeoutExpired):
        raise APIError(0) from None
    if result.returncode:
        match = re.search(r'HTTP\s+(\d{3})', result.stderr)
        raise APIError(int(match[1]) if match else 0)
    if not result.stdout.strip():
        return {}
    try:
        return json.loads(result.stdout)
    except ValueError:
        raise APIError(0) from None


def exact_run(run, sha):
    return (isinstance(run, dict) and isinstance(run.get('id'), int) and run['id'] > 0
            and run.get('head_sha') == sha and run.get('head_branch') == 'main'
            and run.get('event') in ('push', 'workflow_dispatch')
            and str(run.get('path', '')).split('@', 1)[0] == WORKFLOW_PATH)


def require_access(error):
    if error.status in (401, 403):
        raise RuntimeError(f'GitHub refuse la lecture ou le lancement des Actions (HTTP {error.status}). '
                           'Verifier les droits du compte connecte dans Termux. Interface conservee.') from None


def diagnose_missing(sha, api, output):
    checks = [
        (BASE, None, lambda x: 'Branche par defaut : ' + str(x.get('default_branch', 'inconnue'))),
        (BASE + '/contents/' + WORKFLOW_PATH, {'ref': sha}, lambda x: 'Fichier du workflow present dans le commit envoye.'),
        (BASE + '/actions/workflows/' + WORKFLOW, None, lambda x: 'Etat du workflow : ' + str(x.get('state', 'inconnu'))),
    ]
    for path, fields, describe in checks:
        try:
            output(describe(api('GET', path, fields)))
        except APIError as error:
            output(f'Controle GitHub indisponible (HTTP {error.status or "reseau"}) : {path.rsplit("/", 1)[-1]}')


def wait_for_workflow(sha, *, resume=False, api=gh_api, sleep=time.sleep,
                      now=time.monotonic, output=print, discovery_timeout=180,
                      completion_timeout=1200):
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise RuntimeError('Empreinte Git complete attendue ; interface conservee.')
    deadline = now() + discovery_timeout
    selected = None
    previous_id = 0
    dispatch_attempted = False
    attempt = 0
    while now() < deadline:
        try:
            data = api('GET', BASE + '/actions/runs', {'head_sha': sha, 'branch': 'main', 'per_page': 100})
            if not isinstance(data, dict) or not isinstance(data.get('workflow_runs'), list):
                raise RuntimeError('Liste des executions GitHub invalide ; interface conservee.')
            matching = [run for run in data['workflow_runs'] if exact_run(run, sha) and run['id'] > previous_id]
            candidate = max(matching, key=lambda run: run['id']) if matching else None
            if candidate:
                if not resume or dispatch_attempted or candidate.get('status') != 'completed' or candidate.get('conclusion') == 'success':
                    selected = candidate
                    break
                previous_id = candidate['id']
            if resume and not dispatch_attempted:
                # The name lookup is only needed to launch a missing/failed run.
                # A temporary 404 here is caught and retried, never mistaken for success.
                workflow = api('GET', BASE + '/actions/workflows/' + WORKFLOW)
                if workflow.get('state') != 'active' or not isinstance(workflow.get('id'), int):
                    raise RuntimeError('Le workflow V15.8 est desactive ou non valide dans GitHub. '
                                       'Verifier son etat dans Actions. Interface conservee.')
                repository = api('GET', BASE)
                if repository.get('default_branch') != 'main':
                    raise RuntimeError('La branche par defaut GitHub est differente de main : le lancement manuel '
                                       'ne peut pas etre valide automatiquement. Interface conservee.')
                head = api('GET', BASE + '/git/ref/heads/main')
                if head.get('object', {}).get('sha') != sha:
                    raise RuntimeError('Le depot distant a change ; relancer la commande pour reverifier. Interface conservee.')
                output('Lancement de la reprise GitHub pour le commit verifie...')
                try:
                    api('POST', BASE + '/actions/workflows/' + str(workflow['id']) + '/dispatches', {'ref': 'main'})
                    dispatch_attempted = True
                except APIError as error:
                    require_access(error)
                    if error.status == 404:
                        # A rejected dispatch has created no run; registration may still be pending.
                        pass
                    elif error.status in (0, 408, 429) or error.status >= 500:
                        # An ambiguous result may already have started a run: do not submit twice.
                        dispatch_attempted = True
                        output('Reponse de lancement incertaine ; verification des executions sans second lancement.')
                    else:
                        raise RuntimeError(f'Lancement refuse par GitHub (HTTP {error.status}). Interface conservee.') from None
        except APIError as error:
            require_access(error)
            if error.status not in (0, 404, 408, 429) and error.status < 500:
                raise RuntimeError(f'Lecture des Actions refusee (HTTP {error.status}). Interface conservee.') from None
        if attempt % 6 == 0:
            output('Attente de l execution V15.8 dans GitHub...')
        attempt += 1
        sleep(5)
    if selected is None:
        diagnose_missing(sha, api, output)
        raise RuntimeError('Aucune execution V15.8 confirmee pour ce commit. '
                           'Interface conservee. Consulter ' + ACTIONS_URL)

    run_id = selected['id']
    output(f'Execution identifiee : {ACTIONS_URL}/runs/{run_id}')
    deadline = now() + completion_timeout
    previous_state = None
    while now() < deadline:
        if not exact_run(selected, sha) or selected['id'] != run_id:
            raise RuntimeError('Execution GitHub differente de la livraison attendue ; interface conservee.')
        status = selected.get('status')
        if status == 'completed':
            if selected.get('conclusion') == 'success':
                output('Serveur V15.8 valide par GitHub Actions.')
                return run_id
            raise RuntimeError(f'Le workflow V15.8 a termine avec : {selected.get("conclusion") or "resultat inconnu"}. '
                               f'Interface conservee. Diagnostic : gh run view {run_id} --repo {REPOSITORY} --log-failed')
        if status != previous_state:
            output('Journal V15.8 : ' + str(status or 'en attente') + '...')
            previous_state = status
        sleep(5)
        try:
            selected = api('GET', BASE + '/actions/runs/' + str(run_id))
        except APIError as error:
            require_access(error)
            if error.status not in (0, 404, 408, 429) and error.status < 500:
                raise RuntimeError(f'Lecture du resultat refusee (HTTP {error.status}). Interface conservee.') from None
    raise RuntimeError(f'Delai de validation depasse ; interface conservee. Consulter {ACTIONS_URL}/runs/{run_id}')


def main():
    args = sys.argv[1:]
    if not args or len(args) > 2 or len(args) == 2 and args[1] != '--resume':
        raise RuntimeError('Usage : wait-v158-workflow.py SHA [--resume]')
    wait_for_workflow(args[0], resume=len(args) == 2)


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        print(f'ERREUR : {error}', file=sys.stderr)
        # Only logs from an already identified failed run, never arbitrary URLs.
        match = re.search(r'Diagnostic : gh run view (\d+)', str(error))
        if match:
            try:
                logs = subprocess.run(['gh', 'run', 'view', match[1], '--repo', REPOSITORY, '--log-failed'],
                                      capture_output=True, text=True, timeout=45)
                if logs.returncode == 0:
                    print('\n'.join(logs.stdout.splitlines()[-80:]), file=sys.stderr)
            except (OSError, subprocess.TimeoutExpired):
                pass
        sys.exit(1)
