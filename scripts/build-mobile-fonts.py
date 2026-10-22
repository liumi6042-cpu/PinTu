"""Build local OFL webfont subsets; sources/rights in public/fonts/FONT-NOTICES.md.
Run with fonttools[woff] installed, or the project-local work/font-tools directory.
"""
from pathlib import Path
import hashlib, json, shutil, sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'work/font-tools'))
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.merge import Merger
SOURCES = ROOT / 'work/font-sources'
OUT = ROOT / 'public/fonts'
OUT.mkdir(exist_ok=True)
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def rename(font, family, style='Regular'):
    # Keep original copyright (0), license (13), and license URL (14).
    names = font['name']
    replacement = {1:family, 2:style, 3:family+' 20261010', 4:family,
                   6:family.replace(' ','')+'-'+style, 16:family, 17:style}
    for record in list(names.names):
        if record.nameID in replacement:
            names.setName(replacement[record.nameID], record.nameID,
                          record.platformID, record.platEncID, record.langID)
def trim(font, chars):
    options = subset.Options()
    options.name_IDs = ['*']; options.name_languages = ['*']
    options.notdef_glyph = True; options.notdef_outline = True
    options.recalc_timestamp = False
    sub = subset.Subsetter(options=options); sub.populate(unicodes=chars); sub.subset(font)
def original_names(font):
    return {str(i): sorted({r.toUnicode() for r in font['name'].names if r.nameID==i})
            for i in [0,1,5,13,14]}
# Cover interface, catalog titles and server responses; unusual player names fall back.
text = ''.join(path.read_text(encoding='utf-8') for folder in ['h5','app','mobile','lib','server','content','config']
               for path in sorted((ROOT/folder).rglob('*'))
               if path.suffix in {'.ts','.tsx','.mjs','.json','.css'})
chars = set(range(32,127)) | {ord(c) for c in text if ord(c)>=0x3000}
chars |= {ord(c) for c in '·×÷…—–“”‘’→←↑↓✓✦©'}
body = TTFont(SOURCES/'sans.ttf', recalcTimestamp=False)
body_names = original_names(body); supported = set(body.getBestCmap())
trim(body, chars & supported); rename(body,'Jigsaw UI SC')
body.flavor=None; body.save(OUT/'jigsaw-ui-sc.ttf')
body.flavor='woff2'; body_file=OUT/'jigsaw-ui-sc.woff2'; body.save(body_file)
# A single small static serif for headings instead of the complete CJK font.
headings = ('大厅创建房间补给站体力包建房券筛选图片玩家与设置我的房间关于补给十格礼包'
            '隐私说明游玩约定玩法帮助等你开第一桌换个条件试试一起拼图任务礼包好友邀请伙伴初遇默契同心今日协作小礼库存分享补满体力0123456789 /')
heading_chars={ord(c) for c in headings}; parts=[]; covered=set(); serif_sources=[]
temp=SOURCES/'serif-heading-parts'; temp.mkdir(exist_ok=True)
for path in sorted((SOURCES/'noto-serif-sc/package/files').glob('*.woff2')):
    font=TTFont(path,recalcTimestamp=False)
    chosen=(heading_chars & set(font.getBestCmap()))-covered
    if not chosen: continue
    serif_sources.append({'file':path.name,'sha256':sha(path),'originalNames':original_names(font)})
    font=instantiateVariableFont(font,{'wght':700},inplace=True)
    trim(font,chosen); font.flavor=None
    part=temp/(path.stem+'.ttf'); font.save(part); parts.append(str(part)); covered.update(chosen)
assert heading_chars<=covered, f'Missing heading characters: {heading_chars-covered}'
display=Merger().merge(parts); rename(display,'Jigsaw Display SC','Bold')
display.flavor='woff2'; display.recalcTimestamp=False
# Use a stable timestamp inherited from the source rather than build time.
display['head'].modified=body['head'].modified
display_file=OUT/'jigsaw-display-sc.woff2'; display.save(display_file)
for name in ['OFL-NotoSansSC.txt','OFL-NotoSerifSC.txt']: shutil.copyfile(SOURCES/name,OUT/name)
manifest={'license':'SIL Open Font License 1.1','generatedBy':'scripts/build-mobile-fonts.py',
 'body':{'file':body_file.name,'family':'Jigsaw UI SC','sourceFamily':'Noto Sans SC','weight':[100,900],
  'characters':len(chars & supported),'bytes':body_file.stat().st_size,'sha256':sha(body_file),
  'sourceSha256':sha(SOURCES/'sans.ttf'),
  'source':'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
  'upstream':'https://github.com/google/fonts/tree/main/ofl/notosanssc','originalNames':body_names},
 'display':{'file':display_file.name,'family':'Jigsaw Display SC','sourceFamily':'Noto Serif SC','weight':700,
  'characters':len(covered),'text':headings,'bytes':display_file.stat().st_size,'sha256':sha(display_file),
  'sourcePackage':'@fontsource-variable/noto-serif-sc@5.3.0',
  'upstream':'https://github.com/google/fonts/tree/main/ofl/notoserifsc','sourceParts':serif_sources}}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'bodyBytes':body_file.stat().st_size,'displayBytes':display_file.stat().st_size,
                 'bodyCharacters':len(chars & supported),'displayCharacters':len(covered)},indent=2))
