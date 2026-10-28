#!/usr/bin/env python3
"""Run as the real Cloud Build account; inspect external scheduler readiness only."""
import json
from release import Cloud, PROJECT, REGION
from contabo_release import ORIGIN

cloud = Cloud()
results = []
for name, path in [('siskop-daily-scheduler', '/api/scheduler/run-daily'),
                   ('siskop-identity-recovery', '/api/scheduler/reconcile-identities')]:
    job = cloud.request('GET', f'https://cloudscheduler.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/jobs/' + name)
    target = job.get('httpTarget', {})
    if job.get('state') != 'PAUSED' or target.get('uri') != ORIGIN + path:
        raise RuntimeError('Prepare paused SISKOP scheduler targets first')
    result = cloud.scheduler_status(ORIGIN, target['headers']['x-scheduler-token'])
    data = result.get('data', {})
    if result.get('success') is not True or data.get('daily') is not True or data.get('identityRecovery') is not True:
        raise RuntimeError('Contabo scheduler readiness failed')
    results.append({'job': name, 'revision': data.get('revision'), 'oidc_verified': True, 'executed': False})
print(json.dumps({'scheduler_preflight': results, 'database_mutations': False}))
