"""Build the local-only BQL lab without packaging any market data."""
from pathlib import Path
import re
import shutil
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DIST = HERE / 'dist'


def build(output=None, production=False):
    destination = Path(output) if output else DIST
    assets = destination / 'assets'
    assets.mkdir(parents=True, exist_ok=True)
    if not production and list(assets.glob('*.json')):
        raise ValueError('The lab build must not contain market snapshots')
    page = (ROOT / 'bonds.template.html').read_text(encoding='utf-8')
    page = re.sub(r'^.*rel="canonical".*\n', '', page, flags=re.M)
    page = re.sub(r'^.*<header class="site-header">.*\n', '', page, flags=re.M)
    page = re.sub(r'^.*<div class="bond-heading">.*\n', '', page, flags=re.M)
    page = re.sub(r'^.*<footer class="site-footer">.*\n', '', page, flags=re.M)
    page = page.replace('<title>單券相對價值比較表</title>', '<title>RV Lab｜BQL 單券測試站</title>')
    page = page.replace('{{LUAC_VERSION}}', 'lab-v1')
    page = page.replace('</head>', '<link rel="stylesheet" href="assets/lab.css">\n</head>')
    page = page.replace('<body>', '<body class="lab-body">')
    intro = (HERE / 'intro.html').read_text(encoding='utf-8')
    if production:
        sys.path.insert(0, str(ROOT))
        from scripts.build_bql_launcher import source_version
        package_version = source_version()
        intro = intro.replace('Launcher.zip" download=', f'Launcher.zip?v={package_version}" download=')
        page = page.replace('RV Lab｜BQL 單券測試站', 'BQL API 預覽｜單券相對價值')
        intro = intro.replace('LOCAL TEST', 'API PREVIEW').replace('API 測試工作台', 'API 預覽工作台')
        intro += '<p class="lab-review-note"><a href="update.html">原有 Excel 更新入口 ↗</a> · <a href="https://github.com/creditbase02/rv-dashboard/blob/main/BQL_DIAGNOSTICS.md" target="_blank" rel="noreferrer">進階設定與診斷說明 ↗</a></p>'
    main = '<main id="main-content" class="bond-shell">'
    page = page.replace(main, main + intro + '<div id="explorer" hidden>')
    page = page.replace('</main>', '</div></main>')
    page = page.replace('</body>', '<script src="assets/lab.js" defer></script></body>')
    for name in ('site.css', 'bonds.css', 'luac-model.js'):
        shutil.copyfile(ROOT / 'assets' / name, assets / name)
    for name in ('lab.js', 'lab.css'):
        shutil.copyfile(HERE / name, assets / name)
    page = page.replace('assets/bonds.js', 'assets/bql-viewer.js')
    viewer = (ROOT / 'assets/bonds.js').read_text(encoding='utf-8')
    marker = "  const version=document.querySelector('.bond-date time')"
    if viewer.count(marker) != 1:
        raise ValueError('Bond viewer initialization changed; review the lab adapter')
    viewer = viewer[:viewer.index(marker)] + '''
  window.BqlExplorer = {
    load(data) {
      const bonds = model.validateSnapshot(data);
      state.date = data.date; state.bonds = bonds; state.page = 1;
      state.selectedBond = null; state.pinned = false;
      elements['bond-search'].value = '';
      elements['show-outliers'].checked = false;
      elements['show-curves'].checked = true;
      document.querySelector('[name=bond-metric][value=yield_pct]').checked = true;
      state.metric = 'yield_pct';
      document.querySelectorAll('[data-list-search]').forEach(input => { input.value = ''; });
      initializeFilters(); render();
    }
  };
})();
'''
    (assets / 'bql-viewer.js').write_text(viewer, encoding='utf-8')
    if production:
        import hashlib
        version = hashlib.sha256((page + viewer + (HERE/'lab.js').read_text(encoding='utf-8') + (HERE/'lab.css').read_text(encoding='utf-8')).encode()).hexdigest()[:10]
        page = page.replace('lab-v1', version).replace('assets/lab.js"', f'assets/lab.js?v={version}"').replace('assets/lab.css"', f'assets/lab.css?v={version}"')
        page = page.replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="referrer" content="no-referrer">')
    (destination / ('bql.html' if production else 'index.html')).write_text(page, encoding='utf-8')
    print('BQL preview built; no API market snapshots packaged.')


if __name__ == '__main__':
    build()
