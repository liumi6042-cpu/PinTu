"""Offline encoding only: lossless native-size WebP and small gallery thumbnails.

Requires Pillow. Keeps original PNGs and records; performs no AI generation or
upscaling. Run after registering artwork, before building the local website.
"""
from pathlib import Path
from io import BytesIO
from hashlib import sha256
import json
from PIL import Image, ImageChops

root = Path(__file__).resolve().parent.parent
catalog_path = root / 'content/puzzle-catalog.json'
catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
totals = {'originalBytes': 0, 'playBytes': 0, 'thumbnailBytes': 0}
# Kept in step with scripts/image-origin.mjs — both origins get the same derived
# delivery, because a user-provided original still needs play/thumbnail WebP.
PLAYABLE_ORIGINS = ('project-ai-generated', 'user-provided')
RETAINED_STATUSES = ('published', 'archived')
for photo in catalog:
    if photo['origin'] not in PLAYABLE_ORIGINS or photo['status'] not in RETAINED_STATUSES:
        continue
    original = root / 'public' / photo['src'].lstrip('/')
    record_path = root / 'content/image-provenance' / (photo['id'] + '.json')
    record = json.loads(record_path.read_text(encoding='utf-8'))
    original_bytes = original.read_bytes()
    assert sha256(original_bytes).hexdigest() == record['sha256']
    prior = record.get('delivery', {})
    if prior.get('sourceSha256') == record['sha256'] and all(
        kind in prior and photo.get(field) == prior[kind].get('src') and
        (root / 'public' / prior[kind]['src'].lstrip('/')).exists() and
        sha256((root / 'public' / prior[kind]['src'].lstrip('/')).read_bytes()).hexdigest() == prior[kind]['sha256']
        for kind, field in [('play', 'playSrc'), ('thumbnail', 'thumbSrc')] + ([('standard', 'standardSrc')] if photo.get('standardSrc') else [])
    ):
        if photo['status'] == 'published':
            totals['originalBytes'] += len(original_bytes)
            totals['playBytes'] += prior['play']['bytes']
            totals['thumbnailBytes'] += prior['thumbnail']['bytes']
        continue
    with Image.open(original) as source:
        image = source.convert('RGB')
        assert image.size == (record['width'], record['height'])
        delivery = {'sourceSha256': record['sha256']}
        for kind in ('play', 'thumbnail') + (('standard',) if photo.get('standardSrc') else ()):
            output = image.copy()
            options = {'format': 'WEBP', 'method': 6}
            if kind == 'play':
                options['lossless'] = True
            elif kind == 'standard':
                output.thumbnail((1774, 1774), Image.Resampling.LANCZOS)
                options['lossless'] = True
            else:
                output.thumbnail((480, 384), Image.Resampling.LANCZOS)
                options['quality'] = 82
            buffer = BytesIO()
            output.save(buffer, **options)
            data = buffer.getvalue()
            digest = sha256(data).hexdigest()
            src = f"/puzzles/{photo['id']}-{kind}-{digest[:12]}.webp"
            (root / 'public' / src.lstrip('/')).write_bytes(data)
            with Image.open(BytesIO(data)) as decoded:
                assert decoded.size == output.size
                if kind in ('play', 'standard'):
                    assert ImageChops.difference(output, decoded.convert('RGB')).getbbox() is None
            delivery[kind] = {'src': src, 'width': output.width, 'height': output.height,
                              'sha256': digest, 'bytes': len(data),
                              'format': 'webp', 'lossless': kind in ('play', 'standard'),
                              'quality': 82 if kind == 'thumbnail' else None, 'upscaled': False}
            if kind == 'standard':
                delivery[kind]['downsampled'] = True
            photo[{'play': 'playSrc', 'thumbnail': 'thumbSrc', 'standard': 'standardSrc'}[kind]] = src
        record['delivery'] = delivery
        record_path.write_text(json.dumps(record, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        if photo['status'] == 'published':
            totals['originalBytes'] += len(original_bytes)
            totals['playBytes'] += delivery['play']['bytes']
            totals['thumbnailBytes'] += delivery['thumbnail']['bytes']
catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(totals))
