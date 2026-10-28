"""Release SISKOP through a private GCS mailbox; CI never receives VPS credentials."""
import json
import pathlib
import re
import time
import urllib.parse

ORIGIN = 'https://siskop-api.inovasijayakarsa.id:18443'
GATEWAY = 'siskop-central-gateway'
GATEWAY_IMAGE = 'asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/central-gateway'
BUCKET = 'siskop-d0f8c-contabo-releases'


def publish_backend(cloud, state, image, release):
    release.assert_owner(cloud, state)
    if not image.startswith(release.IMAGE + ':'):
        raise ValueError('Unexpected SISKOP image repository')
    digest = cloud.command(release.gcloud('artifacts', 'docker', 'images', 'describe', image, '--format=value(image_summary.digest)'))
    reference = release.IMAGE + '@' + digest
    release.validate_image_ref(reference)
    release.protect_candidate_image(cloud, reference, state['buildId'])
    data = {key: state[key] for key in ['buildId', 'commit']}; data['image'] = reference
    name = 'contabo-requests/' + state['buildId'] + '.json'
    try:
        cloud.request('POST', f'https://storage.googleapis.com/upload/storage/v1/b/{BUCKET}/o?uploadType=media&ifGenerationMatch=0&name=' + urllib.parse.quote(name, safe=''), json.dumps(data).encode())
    except cloud.Conflict:
        existing = cloud.request('GET', f'https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/' + urllib.parse.quote(name, safe='') + '?alt=media')
        if existing != data: raise RuntimeError('Existing deployment request differs')
    url = f'https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/' + urllib.parse.quote('contabo-receipts/' + state['buildId'] + '.json', safe='') + '?alt=media'
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        try: result = cloud.request('GET', url)
        except cloud.Missing:
            time.sleep(5); continue
        if any(result.get(key) != value for key, value in data.items()) or result.get('success') is not True or result.get('revision') != state['buildId']:
            raise RuntimeError('Contabo deployment failed; frontend publication is stopped')
        break
    else: raise TimeoutError('No verified Contabo deployment receipt; frontend publication is stopped')
    # A gateway image has no business/DB credentials. Its configuration stays fixed.
    gateway_tag = GATEWAY_IMAGE + ':' + state['buildId']
    gateway_digest = cloud.command(release.gcloud('artifacts', 'docker', 'images', 'describe', gateway_tag, '--format=value(image_summary.digest)'))
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', gateway_digest): raise ValueError('Immutable gateway image required')
    cloud.command(release.gcloud('run', 'deploy', GATEWAY, '--region=' + release.REGION,
        '--image=' + GATEWAY_IMAGE + '@' + gateway_digest,
        '--service-account=siskop-central-gateway@' + release.PROJECT + '.iam.gserviceaccount.com',
        '--set-secrets=CENTRAL_GATEWAY_SECRET=SISKOP_CENTRAL_GATEWAY_SECRET:1',
        '--set-env-vars=SISKOP_API_ORIGIN=' + ORIGIN, '--cpu=1', '--memory=512Mi',
        '--concurrency=80', '--min-instances=0', '--max-instances=2', '--timeout=65s', '--cpu-throttling'))
    service = json.loads(cloud.command(release.gcloud('run', 'services', 'describe', GATEWAY, '--region=' + release.REGION, '--format=json')))
    release.check_api(cloud, service['status']['url'])
    config = pathlib.Path('firebase.json'); hosting = json.loads(config.read_text())
    rewrites = [item for item in hosting['hosting']['rewrites'] if item.get('source') == '/@(api|uploads)/**']
    if len(rewrites) != 1 or rewrites[0].get('run', {}).get('serviceId') not in {release.SERVICE, GATEWAY}:
        raise ValueError('Unexpected Firebase API rewrite')
    rewrites[0]['run'] = {'serviceId': GATEWAY, 'region': release.REGION, 'pinTag': True}
    config.write_text(json.dumps(hosting, indent=2) + '\n')
    state.update({'backend': 'contabo', 'revision': state['buildId'], 'image': reference, 'candidateUrl': ORIGIN})
    release.STATE.write_text(json.dumps(state))
    print('Contabo deployment and signed gateway checks passed.')
