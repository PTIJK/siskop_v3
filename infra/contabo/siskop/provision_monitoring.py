#!/usr/bin/env python3
"""Create SISKOP-only monitoring with the user-approved notification recipient."""
import json
from pathlib import Path
import subprocess
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen
from provision_google import PROJECT, gcloud, role

BASE = 'https://monitoring.googleapis.com/v3/projects/' + PROJECT + '/'
OUTPUT = Path(__file__).resolve().parents[3] / 'apps/backend/scripts/data/contabo-migration/monitoring.json'


def request(method, path, data=None, missing=False):
    token = gcloud('auth', 'print-access-token').strip()
    req = Request(BASE + path, method=method, data=json.dumps(data).encode() if data is not None else None,
                  headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=30) as response:
            body = response.read(); return json.loads(body) if body else {}
    except HTTPError as error:
        if missing and error.code == 404: return None
        message = json.loads(error.read()).get('error', {}).get('message', 'provider error')
        raise ValueError(f'SISKOP monitoring HTTP {error.code}: ' + message[:500]) from None


def existing(collection, name):
    result = request('GET', collection)
    matches = [item for item in result.get(collection, []) if item.get('displayName') == name]
    if len(matches) > 1: raise ValueError('Duplicate SISKOP monitoring names require review')
    if matches and matches[0].get('userLabels', {}).get('application') != 'siskop':
        raise ValueError('Refusing to change a non-SISKOP monitor')
    return matches[0] if matches else None


def policy(name, conditions, channel):
    prior = existing('alertPolicies', name)
    if prior: return prior
    return request('POST', 'alertPolicies', {'displayName': name, 'combiner': 'OR', 'enabled': False,
        'userLabels': {'application': 'siskop', 'environment': 'staging'}, 'notificationChannels': [channel],
        'alertStrategy': {'autoClose': '86400s'}, 'documentation': {'mimeType': 'text/markdown',
        'content': 'SISKOP Contabo staging needs attention. Check only /srv/siskop/staging and SISKOP units. Never restart, alter or restore Sentryx services. See infra/contabo/siskop/README.md in PTIJK/siskop_v3.'}, 'conditions': conditions})


def update_uptime_readiness(uptime):
    matchers = [{'content': '"success":true', 'matcher': 'CONTAINS_STRING'}]
    if uptime.get('httpCheck', {}).get('path') != '/api/public/pricing' or uptime.get('contentMatchers') != matchers:
        return request('PATCH', uptime['name'].removeprefix('projects/' + PROJECT + '/') + '?updateMask=httpCheck.path,contentMatchers',
            {'name': uptime['name'], 'httpCheck': {'path': '/api/public/pricing'}, 'contentMatchers': matchers})
    return uptime


def main():
    gcloud('services', 'enable', 'monitoring.googleapis.com')
    writer = role('siskopBackupMetrics', ['monitoring.timeSeries.create'])
    gcloud('projects', 'add-iam-policy-binding', PROJECT, '--member=serviceAccount:siskop-contabo-backup@' + PROJECT + '.iam.gserviceaccount.com', '--role=' + writer, '--condition=None')
    for name, unit in [('backup_age_seconds', 's'), ('health_ok', '1')]:
        metric = 'custom.googleapis.com/siskop/' + name
        if request('GET', 'metricDescriptors/' + quote(metric, safe='/'), missing=True) is None:
            request('POST', 'metricDescriptors', {'type': metric, 'metricKind': 'GAUGE', 'valueType': 'INT64', 'unit': unit, 'displayName': 'SISKOP ' + name})
    channel = existing('notificationChannels', 'SISKOP Contabo operator')
    if channel:
        if channel.get('type') != 'email' or channel.get('labels') != {'email_address': 'yudith.octo@gmail.com'}:
            raise ValueError('Existing SISKOP channel differs from approved recipient')
    else:
        channel = request('POST', 'notificationChannels', {'displayName': 'SISKOP Contabo operator', 'type': 'email', 'enabled': True,
            'labels': {'email_address': 'yudith.octo@gmail.com'}, 'userLabels': {'application': 'siskop', 'environment': 'staging'}})
    uptime = existing('uptimeCheckConfigs', 'SISKOP Contabo database API')
    if not uptime:
        uptime = request('POST', 'uptimeCheckConfigs', {'displayName': 'SISKOP Contabo database API',
            'userLabels': {'application': 'siskop', 'environment': 'staging'}, 'period': '300s', 'timeout': '10s',
            'monitoredResource': {'type': 'uptime_url', 'labels': {'project_id': PROJECT, 'host': 'siskop-central-gateway-q5y6rflxaa-et.a.run.app'}},
            'httpCheck': {'requestMethod': 'GET', 'useSsl': True, 'port': 443, 'path': '/api/public/pricing', 'validateSsl': True,
                'acceptedResponseStatusCodes': [{'statusValue': 200}]},
            'contentMatchers': [{'content': '"success":true', 'matcher': 'CONTAINS_STRING'}]})
    uptime = update_uptime_readiness(uptime)
    metric_filter = lambda name: 'resource.type="global" AND metric.type="custom.googleapis.com/siskop/' + name + '"'
    backup_policy = policy('SISKOP Contabo backup freshness', [
        {'displayName': 'No successful encrypted off-host backup for 90 minutes', 'conditionThreshold': {'filter': metric_filter('backup_age_seconds'),
            'comparison': 'COMPARISON_GT', 'thresholdValue': 5400, 'duration': '0s', 'trigger': {'count': 1}}},
        {'displayName': 'SISKOP health reporter missing for 15 minutes', 'conditionAbsent': {'filter': metric_filter('backup_age_seconds'), 'duration': '900s', 'trigger': {'count': 1}}}
    ], channel['name'])
    health_policy = policy('SISKOP Contabo local health', [{'displayName': 'API, database, disk or certificate check failing', 'conditionThreshold': {
        'filter': metric_filter('health_ok'), 'comparison': 'COMPARISON_LT', 'thresholdValue': 1, 'duration': '300s', 'trigger': {'count': 1}}}], channel['name'])
    check_id = uptime['name'].rsplit('/', 1)[-1]
    uptime_policy = policy('SISKOP Contabo external availability', [{'displayName': 'External API/database check failing', 'conditionThreshold': {
        'filter': 'resource.type="uptime_url" AND metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND metric.labels.check_id="' + check_id + '"',
        'comparison': 'COMPARISON_LT', 'thresholdValue': 1, 'duration': '300s', 'aggregations': [{'alignmentPeriod': '300s', 'perSeriesAligner': 'ALIGN_FRACTION_TRUE'}], 'trigger': {'count': 1}}}], channel['name'])
    report = {'channel': channel['name'], 'recipient': 'yudith.octo@gmail.com', 'uptime_check': uptime['name'],
              'policies': [item['name'] for item in [backup_policy, health_policy, uptime_policy]], 'enabled_before_cutover': False}
    OUTPUT.write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    try: main()
    except Exception as error: raise SystemExit(str(error)) from None
