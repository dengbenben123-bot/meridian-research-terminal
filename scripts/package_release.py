"""Build a secret-free standalone source archive with a per-file integrity manifest."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
output = root/'outputs/meridian-coolify-source.zip'
output.parent.mkdir(exist_ok=True)
excluded = {'node_modules','dist','__pycache__','.pytest_cache','.git','.venv','outputs'}
files = []
for path in sorted(root.rglob('*')):
    relative = path.relative_to(root)
    if not path.is_file() or any(part in excluded for part in relative.parts):
        continue
    if path.name.startswith('.env') and path.name != '.env.example':
        continue
    if path.suffix in ('.log','.key','.pem','.pyc','.sqlite3'):
        continue
    files.append(path)
manifest = {'version':'5.0.0','edition':'Coolify','files':{str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in files}}
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path,'meridian-coolify/'+str(path.relative_to(root)))
    archive.writestr('meridian-coolify/release-manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'file':str(output),'source_files':len(files),'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}))
