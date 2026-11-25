"""从游戏现有像素边框生成原生“同意并登录”按钮，避开宿主文字裁切。"""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
scale, width, height = 3, 168, 38
image = Image.new('RGBA', (width*scale, height*scale), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
spec = json.loads((root/'mobile/pixel-frame-data.json').read_text(encoding='utf8'))['button-berry-normal']
k = spec['slice']
def coord(value, source, target):
    return value if value <= k else target-source+value if value >= source-k else k+(value-k)*(target-2*k)/(source-2*k)
def paint(x, y, w, h, color):
    left, top, right, bottom = round(x*scale), round(y*scale), round((x+w)*scale), round((y+h)*scale)
    if right>left and bottom>top: draw.rectangle((left, top, right-1, bottom-1), fill=color)
paint(k, k, width-2*k, height-2*k, spec['surface'])
for x,y,w,h,color in spec['rects']:
    left,top = coord(x,spec['width'],width),coord(y,spec['height'],height)
    right,bottom = coord(x+w,spec['width'],width),coord(y+h,spec['height'],height)
    paint(left,top,right-left,bottom-top,color)
font = ImageFont.truetype(str(root/'public/fonts/jigsaw-ui-sc.ttf'), 13*scale)
font.set_variation_by_name('Bold')
draw.text((width*scale/2, height*scale/2-2), '同意并登录', font=font, fill='#fffaf0', anchor='mm')
image.save(root/'public/mobile-icons/taptap-nickname-authorize.png', optimize=True)
