"""Google clients restricted to SISKOP backup/certificate identities."""
import json
from siskopctl import ROOT, validate_root


def session(purpose):
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    scopes = {
        'acme': 'https://www.googleapis.com/auth/ndev.clouddns.readwrite',
        'backup': ['https://www.googleapis.com/auth/devstorage.read_write', 'https://www.googleapis.com/auth/monitoring.write'],
        'deployer': 'https://www.googleapis.com/auth/cloud-platform',
    }
    if purpose not in scopes:
        raise ValueError('Unexpected SISKOP credential purpose')
    validate_root()
    path = ROOT / f'secrets/google-{purpose}.json'
    if path.is_symlink() or path.stat().st_mode & 0o077 or path.stat().st_uid != 0:
        raise ValueError('Google job credential must be a private root-owned file')
    data = json.loads(path.read_text())
    expected = f'siskop-contabo-{purpose}@siskop-d0f8c.iam.gserviceaccount.com'
    if data.get('client_email') != expected or data.get('project_id') != 'siskop-d0f8c':
        raise ValueError('Unexpected Google job identity')
    selected = scopes[purpose]
    credentials = service_account.Credentials.from_service_account_info(data, scopes=selected if isinstance(selected, list) else [selected])
    return AuthorizedSession(credentials)
