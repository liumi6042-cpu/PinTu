import pathlib,json,subprocess
from inspect import cfg,opts
here=pathlib.Path(__file__).resolve().parent
subprocess.run(['ssh',*opts,cfg['host'],'mkdir -p /tmp/web-nine-grid-20261019'],check=True)
names=['delta.tar.gz','freeze.json','baseline-manifest.json','inspection.json','target-manifest.json','public-inventory.before.json','deploy-reviewed.py']
subprocess.run(['scp',*opts,*[str(here/n) for n in names],cfg['host']+':/tmp/web-nine-grid-20261019/'],check=True)
print('Uploaded frozen diagnostic release; not activated.')
