"""Lay out native framebuffer evidence without altering its lighting or colors."""
import argparse
import json
from pathlib import Path
import re
from PIL import Image, ImageDraw, ImageFont


def render(root, before_caption='Alan Turing · unlit material'):
    cases = [('mario', 'ORIGINAL MARIO', 'Melee material reference'),
             ('before', 'MARIO RETARGET · BEFORE', before_caption),
             ('after', 'MARIO RETARGET · UPDATED', 'Alan Turing · Melee lighting')]
    pose_frames = []
    for case, _, _ in cases:
        log = (root / case / 'game.log').read_text()
        states = re.findall(r'\[shading\] frame=(\d+) motion=(\d+) anim_bits=([0-9a-f]+)', log)
        assert len(states)>1 and states[-1][1]=='14' and states[-1][1:]==states[-2][1:], case
        pose_frames.append(states[-1][2])
    assert len(set(pose_frames))==1, 'All three captures must use the same idle frame'
    font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
    title = ImageFont.truetype(font_path, 25)
    small = ImageFont.truetype(font_path, 19)
    sheet = Image.new('RGB', (1608, 872), '#111419')
    draw = ImageDraw.Draw(sheet)
    for i, (case, heading, caption) in enumerate(cases):
        x = 18 + i*530
        draw.text((x+10, 20), heading, fill='#f2eee8', font=title)
        draw.text((x+10, 55), caption, fill='#b8babd', font=small)
        image = Image.open(root / case / 'capture.png').convert('RGB')
        assert image.size == (1280, 1056), image.size
        # Exactly the same crop and scale in every column. No color adjustment.
        image = image.crop((300, 0, 1060, 1056)).resize((520, 722), Image.Resampling.LANCZOS)
        sheet.paste(image, (x, 90))
    draw.text((28, 836), 'Actual game renders  ·  Battlefield lighting  ·  Same camera and idle frame  ·  No image color adjustments', fill='#c8cbd0', font=small)
    output = root / 'comparison.png';sheet.save(output)
    (root / 'comparison.json').write_text(json.dumps(dict(cases=[x[0] for x in cases],
        animationFrameBits=pose_frames[0], matchingPose=True, crop=[300,0,1060,1056],
        colorAdjustments=False), indent=2)+'\n')
    print(output.resolve())


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__);p.add_argument('directory', type=Path)
    p.add_argument('--before-caption', default='Alan Turing · unlit material')
    args=p.parse_args();render(args.directory,args.before_caption)
