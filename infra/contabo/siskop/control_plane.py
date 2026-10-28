#!/usr/bin/env python3
"""Prepare only SISKOP release/jobs, then explicitly block the old business API."""
import argparse
import json
import os
from pathlib import Path
import tempfile
from urllib.request import Request, urlopen
from provision_google import PROJECT, gcloud

REGION = 'asia-southeast2'
TRIGGER = '8346644b-e829-4692-8226-fad4c3c5ce28'
ORIGIN = 'https://siskop-api.inovasijayakarsa.id:18443'
PRIVATE = Path(__file__).resolve().parents[3] / 'apps/backend/scripts/data/contabo-migration'


def request(method, url, data=None):
    token = gcloud('auth', 'print-access-token').strip()
    req = Request(url, method=method, data=json.dumps(data).encode() if data is not None else None,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urlopen(req, timeout=30) as response:
        content = response.read(); return json.loads(content) if content else {}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'block-old-api'])
    args = parser.parse_args(); os.umask(0o077)
    trigger_url = f'https://cloudbuild.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/triggers/{TRIGGER}'
    trigger = request('GET', trigger_url)
    specs = json.loads(Path(__file__).parents[2].joinpath('firebase/scheduler-jobs.json').read_text())
    jobs = []
    for spec in specs:
        url = f'https://cloudscheduler.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/jobs/' + spec['id']
        job = request('GET', url)
        target = job.get('httpTarget', {})
        if (job.get('state') not in {'PAUSED', 'ENABLED'} or target.get('httpMethod') != 'POST'
                or target.get('oidcToken', {}).get('serviceAccountEmail') != f'siskop-scheduler-invoker@{PROJECT}.iam.gserviceaccount.com'
                or not target.get('headers', {}).get('x-scheduler-token')):
            raise ValueError('Existing SISKOP scheduler differs from the reviewed configuration')
        origin = target['uri'].removesuffix(spec['path'])
        if origin != ORIGIN and not (origin.startswith('https://siskop-staging-api-') and origin.endswith('.a.run.app')):
            raise ValueError('Unexpected existing scheduler origin')
        jobs.append((url, spec, job))
    policy = json.loads(gcloud('run', 'services', 'get-iam-policy', 'siskop-staging-api', '--region=' + REGION, '--format=json'))
    snapshot = PRIVATE / 'cloud-control-before-cutover.json'
    if not snapshot.exists():
        snapshot.write_text(json.dumps({'application': 'siskop', 'project': PROJECT, 'trigger': trigger,
            'jobs': [job for _, _, job in jobs], 'old_api_iam': policy}, indent=2)); snapshot.chmod(0o600)
    elif json.loads(snapshot.read_text()).get('application') != 'siskop': raise ValueError('Unexpected existing control snapshot')
    if args.action == 'prepare':
        substitutions = {**trigger.get('substitutions', {}), '_BACKEND': 'contabo'}
        # Use the SDK's complete config update for repository-event triggers;
        # the provider rejects a bare disabled/substitutions partial payload.
        trigger.update(disabled=True, substitutions=substitutions)
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json') as config:
            json.dump(trigger, config); config.flush()
            gcloud('builds', 'triggers', 'update', 'github', TRIGGER, '--region=' + REGION, '--trigger-config=' + config.name)
        for url, spec, job in jobs:
            if job['state'] == 'ENABLED':
                job = request('POST', url + ':pause', {})
            if job.get('state') != 'PAUSED': raise ValueError('Scheduler did not pause')
            target = {**job['httpTarget'], 'uri': ORIGIN + spec['path'],
                'oidcToken': {'audience': ORIGIN, 'serviceAccountEmail': f'siskop-scheduler-invoker@{PROJECT}.iam.gserviceaccount.com'}}
            request('PATCH', url + '?updateMask=httpTarget', {'name': job['name'], 'httpTarget': target})
        print(json.dumps({'siskop_trigger_disabled': True, 'future_backend': 'contabo', 'siskop_jobs_paused_and_retargeted': len(jobs), 'old_api_public_access_changed': False}))
    else:
        if trigger.get('disabled') is not True or any(job['state'] != 'PAUSED' or job['httpTarget']['uri'] != ORIGIN + spec['path'] for _, spec, job in jobs):
            raise ValueError('Prepare and hold the SISKOP release/jobs first')
        bindings = []
        for binding in policy.get('bindings', []):
            if binding.get('role') == 'roles/run.invoker':
                binding['members'] = [member for member in binding.get('members', []) if member not in {'allUsers', 'allAuthenticatedUsers'}]
            if binding.get('members'): bindings.append(binding)
        policy['bindings'] = bindings
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json') as file:
            json.dump(policy, file); file.flush()
            gcloud('run', 'services', 'set-iam-policy', 'siskop-staging-api', file.name, '--region=' + REGION)
        print(json.dumps({'old_siskop_api_public_invocation_blocked': True, 'private_invokers_preserved': True, 'database_changed': False}))


if __name__ == '__main__':
    try: main()
    except Exception as error: raise SystemExit('SISKOP control change stopped: ' + type(error).__name__) from None
