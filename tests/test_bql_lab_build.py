"""Ensure the local lab cannot accidentally package a market snapshot."""
from pathlib import Path
import runpy
import unittest
import tempfile
from html.parser import HTMLParser


class Ids(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []

    def handle_starttag(self, tag, attrs):
        self.ids.extend(value for name, value in attrs if name == 'id')


class BqlLabBuildTests(unittest.TestCase):
    def test_local_build_contains_only_code_and_no_automatic_quote_fetch(self):
        root = Path(__file__).resolve().parents[1]
        runpy.run_path(str(root/'bql-test-site/build.py'),run_name='__main__')
        dist = root/'bql-test-site/dist'
        self.assertFalse(list(dist.rglob('*.json')))
        self.assertFalse(list(dist.rglob('*.xlsx')))
        page = (dist/'index.html').read_text(encoding='utf-8')
        self.assertNotIn('{{',page)
        parser = Ids(); parser.feed(page)
        self.assertEqual(len(parser.ids),len(set(parser.ids)))
        self.assertIn('fetch-snapshot',parser.ids)
        self.assertIn('bond-canvas',parser.ids)
        viewer = (dist/'assets/bql-viewer.js').read_text(encoding='utf-8')
        self.assertNotIn('assets/luac-bonds.json',viewer)
        self.assertIn('window.BqlExplorer',viewer)

    def test_production_build_keeps_existing_bond_viewer_and_excel_route(self):
        root = Path(__file__).resolve().parents[1]
        builder = runpy.run_path(str(root/'bql-test-site/build.py'))['build']
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output/'assets').mkdir()
            original = (root/'assets/bonds.js').read_bytes()
            (output/'assets/bonds.js').write_bytes(original)
            builder(output, production=True)
            self.assertEqual((output/'assets/bonds.js').read_bytes(), original)
            page = (output/'bql.html').read_text(encoding='utf-8')
            self.assertIn('href="update.html"', page)
            self.assertIn('assets/bql-viewer.js?', page)
            self.assertNotIn('{{', page)
            self.assertFalse(list(output.rglob('*.json')))


if __name__ == '__main__':
    unittest.main()
