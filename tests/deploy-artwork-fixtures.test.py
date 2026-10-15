"""Exercise only deployment QA helpers, without importing deployment execution."""
import ast
import copy
import json
import pathlib
import unittest
import urllib.parse

source = pathlib.Path(__file__).parents[1] / 'scripts/deploy-warm-release.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
names = {'pre_artwork_qa_fixture', 'assert_preserved_artwork_snapshot'}
helpers = ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names], type_ignores=[])
assert {node.name for node in helpers.body} == names
scope = {'json': json, 'urllib': urllib}
exec(compile(ast.fix_missing_locations(helpers), str(source), 'exec'), scope)


class DeploymentArtworkFixtureTests(unittest.TestCase):
    def setUp(self):
        self.artwork = {'revision': 'a' * 64, 'src': '/puzzles/example-optimized-0123456789ab.webp', 'thumbSrc': '/puzzles/example-thumbnail-0123456789ab.webp', 'width': 2144, 'height': 2144}
        self.room = {'id': 'a' * 32, 'revision': 7, 'artwork': self.artwork, 'puzzle': {'imageId': 'example', 'seed': 17, 'cols': 12, 'rows': 9, 'elapsed': 25, 'groups': [{'id': 0, 'pieces': [0, 1], 'dx': 123, 'dy': 456, 'locked': False}]}, 'members': [{'id': 'player', 'name': 'QA'}], 'leases': {'0': 'player'}, 'ownerId': 'qa-account'}
        self.snapshot = {**copy.deepcopy(self.room), 'photo': {'src': 'https://jigsawnook.online' + self.artwork['src']}}

    def test_pre_artwork_fixture_removes_only_optional_snapshot_and_keeps_progress(self):
        before = json.dumps(self.room)
        fixture = json.loads(scope['pre_artwork_qa_fixture'](before))
        self.assertEqual(fixture, {key: value for key, value in self.room.items() if key != 'artwork'})
        self.assertEqual(json.dumps(self.room), before)
        self.assertEqual(json.loads(scope['pre_artwork_qa_fixture'](json.dumps(fixture))), fixture)

    def test_pre_artwork_fixture_rejects_private_upload_rooms(self):
        with self.assertRaises(AssertionError):
            scope['pre_artwork_qa_fixture'](json.dumps({**self.room, 'customImage': {'id': 'private'}}))

    def test_preserved_snapshot_accepts_elapsed_time_but_checks_identity_progress_and_drawing(self):
        restored = copy.deepcopy(self.snapshot)
        restored['puzzle']['elapsed'] += 1
        scope['assert_preserved_artwork_snapshot'](self.snapshot, restored, self.artwork)
        for mutate in [lambda room: room.update(id='b' * 32), lambda room: room.update(revision=8), lambda room: room['puzzle'].update(seed=18), lambda room: room['puzzle']['groups'][0].update(dx=999), lambda room: room['artwork'].update(width=1), lambda room: room['photo'].update(src='https://jigsawnook.online/puzzles/other.webp')]:
            changed = copy.deepcopy(restored)
            mutate(changed)
            with self.assertRaises(AssertionError):
                scope['assert_preserved_artwork_snapshot'](self.snapshot, changed, self.artwork)


if __name__ == '__main__':
    unittest.main()
