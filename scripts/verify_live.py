"""Read-only checks against your deployed HTTPS domain; never submits orders."""
import argparse
import base64
import getpass
import json
import warnings
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def run(origin, auth):
    opener = build_opener(NoRedirect())
    def read(path, private=False):
        headers = {'Cache-Control': 'no-cache'}
        if private:
            headers['Authorization'] = auth
        try:
            reply = opener.open(Request(origin+path, headers=headers), timeout=90)
        except HTTPError as error:
            reply = error
        with reply:
            raw = reply.read(4_000_000)
            return reply.status, raw
    status, raw = read('/healthz')
    if status != 200 or json.loads(raw) != {'status': 'ok', 'version': '5.0.0'}:
        raise ValueError('Wrong release or unhealthy dependencies at /healthz')
    for path in ['/', '/api/status']:
        if read(path)[0] != 401:
            raise ValueError('Private access check failed at '+path)
    status, raw = read('/api/status', True)
    config = json.loads(raw)
    if status != 200 or config.get('live_execution') is not False:
        raise ValueError('Authenticated configuration check failed')
    status, raw = read('/api/search?q=gzmt', True)
    if status != 200 or not any(row['symbol'] == '600519.SH' for row in json.loads(raw).get('items', [])):
        raise ValueError('Directory / Pinyin search check failed')
    print('PASS: version, database/cache health, private login, directory search and disabled live execution.')
    status, raw = read('/api/cn/equity/snapshot?q=600519', True)
    data = json.loads(raw)
    print('Public A-share source:', data.get('state'), '| observed:', len(data.get('rows', [])), '| retrieved:', data.get('received_at'))
    if status != 200 or data.get('state') != 'ok' or not data.get('rows'):
        print('SOURCE NOT VERIFIED: inspect provider errors and server outbound access. The application can be healthy while a public source is unavailable.')
    else:
        print('PASS: source returned an observed quote. Exchange-event latency remains unverified.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('origin', help='Your deployed HTTPS origin, without a path')
    args = parser.parse_args()
    url = urlsplit(args.origin)
    if url.scheme != 'https' or not url.netloc or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
        raise SystemExit('Use your exact HTTPS origin without credentials or a path')
    name = input('Terminal username: ')
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        password = getpass.getpass('Terminal password (hidden): ')
    try:
        run(args.origin.rstrip('/'), 'Basic '+base64.b64encode((name+':'+password).encode()).decode())
    except (ValueError, OSError) as error:
        raise SystemExit('Verification failed: '+str(error)) from None
