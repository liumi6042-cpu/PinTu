"""Focused local fixtures for actual deploy-warm-release.py retention helpers.

Uses AST extraction so no top-level deployment code can execute.
Only disposable fixtures below this audit directory are written.
"""
import json
import os
import pathlib
import re
import shutil
import stat
import tempfile


def load_actual_helpers():
    # Execute only the three AST nodes. Never run argparse, SSH or the deployment.
    import ast
    script = pathlib.Path(__file__).resolve().parents[3] / 'work/dual-managed-release-20261014/scripts/deploy-warm-release.py'
    parsed = ast.parse(script.read_text(encoding='utf-8'))
    names = {'SHARED_FILES', 'plain_directory', 'retain_shared_client_hashes'}
    nodes = [node for node in parsed.body if
             isinstance(node, ast.FunctionDef) and node.name in names or
             isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in node.targets)]
    assert len(nodes) == 3
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(script), 'exec'), globals())


def self_test():
    load_actual_helpers()
    folder = pathlib.Path(__file__).resolve().parent
    root = pathlib.Path(tempfile.mkdtemp(prefix='retain-fixture-', dir=folder)).resolve()
    assert root.parent == folder and root.name.startswith('retain-fixture-')
    results = []
    old, new = root / 'old', root / 'new'
    h = '1234567890abcdef'
    try:
        for app in (old, new):
            (app / 'dist/client/shared-client').mkdir(parents=True)
        src = old / 'dist/client/shared-client' / h
        (src / 'assets/fonts').mkdir(parents=True)
        (src / 'game.js').write_bytes(b'old script')
        (src / 'assets/fonts/jigsaw-ui-sc.woff2').write_bytes(b'old font')
        current = new / 'dist/client/shared-client/aaaaaaaaaaaaaaaa'
        current.mkdir()
        (current / 'game.js').write_bytes(b'new script')
        assert retain_shared_client_hashes(old, new) == 2
        dst = new / 'dist/client/shared-client' / h
        assert (dst / 'assets/fonts/jigsaw-ui-sc.woff2').read_bytes() == b'old font'
        assert (current / 'game.js').read_bytes() == b'new script'
        assert os.path.samefile(src / 'game.js', dst / 'game.js')
        results.append({'check': 'retains old script/font by hardlink without changing current hash', 'passed': True})
        assert retain_shared_client_hashes(old, new) == 0
        results.append({'check': 'same bytes are idempotent', 'passed': True})
        # unlink the hardlink before changing the destination collision fixture.
        (dst / 'game.js').unlink()
        (dst / 'game.js').write_bytes(b'collision')
        try:
            retain_shared_client_hashes(old, new)
            raise AssertionError('Must reject immutable collision')
        except ValueError:
            pass
        assert (src / 'game.js').read_bytes() == b'old script'
        results.append({'check': 'different bytes at same hash rejected, source untouched', 'passed': True})
        (dst / 'game.js').unlink()
        os.link(src / 'game.js', dst / 'game.js')
        unknown = src / 'private.json'
        unknown.write_bytes(b'not allowed')
        try:
            retain_shared_client_hashes(old, new)
            raise AssertionError('Must reject unexpected file')
        except ValueError:
            pass
        unknown.unlink()
        results.append({'check': 'non-allowlisted file rejected', 'passed': True})
        link = src / 'linked'
        try:
            link.symlink_to(root, target_is_directory=True)
        except OSError as error:
            # This Windows account cannot create symlinks; still test the actual
            # guard with an explicitly simulated filesystem symlink result.
            from unittest.mock import patch
            original = pathlib.Path.is_symlink
            with patch.object(pathlib.Path, 'is_symlink', lambda value: value == src / 'game.js' or original(value)):
                try:
                    retain_shared_client_hashes(old, new)
                    raise AssertionError('Must reject detected symlink')
                except ValueError:
                    pass
            results.append({'check': 'detected source symlink rejected', 'passed': True,
                            'method': 'simulated Path.is_symlink result on actual helper; real symlink fixture unavailable',
                            'realSymlinkFixtureSkipped': str(error)})
        else:
            try:
                retain_shared_client_hashes(old, new)
                raise AssertionError('Must reject linked directory')
            except ValueError:
                pass
            link.unlink()
            results.append({'check': 'linked directory rejected', 'passed': True})
        report = {'scope': 'actual local deployment helper via AST; isolated fixture data only; no deployment or remote edits', 'results': results}
        (folder / 'retain-shared-client-fixture-results.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, indent=2))
    finally:
        assert root.resolve().parent == folder and root.name.startswith('retain-fixture-')
        shutil.rmtree(root)


if __name__ == '__main__':
    self_test()
