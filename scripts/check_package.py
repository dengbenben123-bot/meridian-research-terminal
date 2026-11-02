"""Check extracted release files only. No network, application or local web server."""
from pathlib import Path
import hashlib
import json

root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'release-manifest.json').read_text(encoding='utf-8'))
if manifest.get('version')!='5.0.0' or manifest.get('edition')!='Coolify':
    raise SystemExit('Unexpected release manifest')
for relative,expected in manifest['files'].items():
    path=(root/relative).resolve()
    if not path.is_relative_to(root) or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:
        raise SystemExit('Missing or changed release file: '+relative)
print('PASS: all '+str(len(manifest['files']))+' release files match their SHA-256 checksums. No service started.')
