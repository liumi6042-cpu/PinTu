"""Build small transparent runtime images from the approved original atlases."""
import hashlib, io, json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
folder = root / 'public/cosmetics'
target = folder / 'assets'
target.mkdir(exist_ok=True)
ids = ['leaf','flower','moon','puzzle','wave','maple','mushroom','bee','ginkgo','pinecone','feather','strawberry']
icons = Image.open(folder / 'icons-v1.png').convert('RGBA')
bubbles = Image.open(folder / 'bubbles-v1.png').convert('RGBA')
manifest = {}
for i, name in enumerate(ids):
    x, y = i % 4 * 362, i // 4 * 362
    icon = icons.crop((x,y,x+362,y+362))
    bounds = icon.getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox()
    cursor = Image.new('RGBA',(32,32))
    small = icon.crop(bounds)
    small.thumbnail((30,30),Image.Resampling.LANCZOS)
    cursor.paste(small,((32-small.width)//2,(32-small.height)//2))
    icon.thumbnail((200,200),Image.Resampling.LANCZOS)
    x, y = i % 3 * 512, [55,275,498,724][i//3]
    bubble = bubbles.crop((x,y,x+512,y+215))
    manifest[name] = {}
    for kind, im in [('icon',icon),('bubble',bubble),('cursor',cursor)]:
        buf = io.BytesIO()
        im.save(buf,format='PNG' if kind=='cursor' else 'WEBP',**({'optimize':True} if kind=='cursor' else {'quality':85,'method':6}))
        data=buf.getvalue(); ext='png' if kind=='cursor' else 'webp'
        filename=f'{name}-{kind}-{hashlib.sha256(data).hexdigest()[:12]}.{ext}'
        (target / filename).write_bytes(data)
        manifest[name][kind]='/cosmetics/assets/'+filename
(folder / 'delivery.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
allow=root/'config/runtime-assets.json'
config=json.loads(allow.read_text(encoding='utf-8'))
config['static']=list(dict.fromkeys(config['static']+[url for item in manifest.values() for url in item.values()]))
allow.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Prepared',len(ids)*3,'assets;',sum((target/Path(url).name).stat().st_size for item in manifest.values() for url in item.values()),'bytes')
