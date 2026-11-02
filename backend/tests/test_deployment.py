import contextlib
import importlib.util
import io
import json
from pathlib import Path
from unittest.mock import patch
import yaml

ROOT=Path(__file__).resolve().parents[2]


def test_compose_dependency_order_internal_ports_and_persistent_storage():
    config=yaml.safe_load((ROOT/'docker-compose.yml').read_text())
    assert set(config['services'])=={'frontend','backend','redis','postgres'}
    assert all(not service.get('ports') for service in config['services'].values())
    assert config['services']['frontend']['depends_on']['backend']['condition']=='service_healthy'
    assert config['services']['backend']['depends_on']['postgres']['condition']=='service_healthy'
    assert set(config['volumes'])=={'postgres_data','redis_data'}
    assert ':?' in config['services']['backend']['environment']['MERIDIAN_AUTH_DIGEST']
    for service in ('frontend','backend'):
        assert (ROOT/config['services'][service]['build']['context']/'Dockerfile').is_file()


def test_compose_empty_uses_git_contexts_instead_of_missing_local_files():
    config=yaml.safe_load((ROOT/'docker-compose.coolify-empty.yml').read_text())
    for service in ('frontend','backend'):
        assert '${SOURCE_REPOSITORY_URL:?' in config['services'][service]['build']['context']
        assert config['services'][service]['build']['context'].endswith(':'+service)


def test_generated_credentials_are_private_and_not_regenerated(tmp_path):
    spec=importlib.util.spec_from_file_location('meridian_setup',ROOT/'scripts/setup.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    output=io.StringIO()
    with patch.object(module.os,'getenv',return_value=''),patch('builtins.input',return_value='fixture-owner'), \
         patch.object(module.getpass,'getpass',return_value='fixture-password-long'),contextlib.redirect_stdout(output):
        module.configure(tmp_path)
        first=(tmp_path/'.env').read_bytes()
        module.configure(tmp_path)
    assert (tmp_path/'.env').read_bytes()==first
    assert (tmp_path/'.env').stat().st_mode&0o077==0
    assert b'MERIDIAN_AUTH_DIGEST=' in first and b'fixture-password-long' not in first
    assert 'fixture-password-long' not in output.getvalue()


def test_container_builds_use_locks_and_single_paper_process():
    frontend=(ROOT/'frontend/Dockerfile').read_text()
    backend=(ROOT/'backend/Dockerfile').read_text()
    assert 'npm ci' in frontend and 'package-lock.json' in frontend
    assert 'constraints.txt' in backend and '"--workers", "1"' in backend
    config=json.loads((ROOT/'frontend/package.json').read_text())
    assert 'ag-grid-enterprise' not in config['dependencies']
