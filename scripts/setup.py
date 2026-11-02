"""Generate private deployment variables; optionally deploy on the chosen Docker host."""
import argparse
import getpass
import hashlib
import os
from pathlib import Path
import re
import secrets
import subprocess
import warnings


def configure(root):
    target = root / '.env'
    if target.exists():
        print('Existing .env retained. Edit its values deliberately; passwords were not replaced.')
        return
    digest = os.getenv('MERIDIAN_AUTH_DIGEST', '')
    if not re.fullmatch(r'[a-fA-F0-9]{64}', digest):
        name = input('Terminal username [owner]: ').strip() or 'owner'
        if ':' in name or any(c in name for c in '\r\n'):
            raise ValueError('Username cannot contain a colon or newline')
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            password = getpass.getpass('Terminal password (12+ characters; hidden): ')
            confirm = getpass.getpass('Repeat terminal password: ')
        if password != confirm or len(password) < 12:
            raise ValueError('Passwords must match and contain at least 12 characters')
        digest = hashlib.sha256((name + ':' + password).encode('utf-8')).hexdigest()
    postgres = secrets.token_urlsafe(32)
    content = (f'POSTGRES_PASSWORD={postgres}\nMERIDIAN_AUTH_DIGEST={digest.lower()}\nDATA_PRIMARY=akshare\n'
               'DATA_FALLBACK_CHAIN=akshare,tushare\nTUSHARE_TOKEN=\nSNAPSHOT_INTERVAL_SECONDS=10\n'
               'PROVIDER_TIMEOUT_SECONDS=35\nBROKER_MODE=paper\nREALTIME_PROVIDER=\n')
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        stream.write(content)
    print('Created private .env. For Coolify, copy its values into the resource environment variables. Do not commit this file.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--deploy', action='store_true', help='Also run Docker Compose on this machine; use on your selected server')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    try:
        configure(root)
        if args.deploy:
            subprocess.run(['docker', 'compose', '-f', str(root/'docker-compose.yml'), 'up', '-d', '--build'], cwd=root, check=True)
        else:
            print('Configuration only. No application or local web server was started.')
    except (ValueError, OSError, subprocess.CalledProcessError, getpass.GetPassWarning) as error:
        raise SystemExit(str(error)) from None
