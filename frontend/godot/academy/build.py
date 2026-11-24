"""Stage existing assets, import the real Godot project and export Web locally."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
PROJECT = Path(__file__).parent
# This project stages the v2 art below, independently of the catalog's current version.
ASSET_VERSION = 'academy-art-v2'


def run(arguments):
    arguments = [arguments[0], '--language', 'en', *arguments[1:]]
    result = subprocess.run(arguments, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            encoding='utf-8', errors='replace')
    print(result.stdout, flush=True)
    result.check_returncode()
    # Godot can return zero even when a scene fails to parse (observed in this study).
    if 'ERROR:' in result.stdout:
        raise RuntimeError('Godot reported an import/export error; see output above')


def prepare():
    assets = PROJECT / 'assets'
    assets.mkdir(exist_ok=True)
    original = ROOT / 'frontend/public/assets/academy/v1'
    for name in ('materials.png', 'characters.png', 'decor.png'):
        shutil.copyfile(original / name, assets / name)
    # Superseded staged input only; original v1 public art is kept intact.
    (assets / 'exteriors.png').unlink(missing_ok=True)
    for name in ('academy-front.png','shops-front.png'):
        shutil.copyfile(ROOT / 'frontend/public/assets/academy/v2/architecture-r1' / name, assets / name)
    shutil.copyfile(ROOT / 'frontend/public/assets/academy/v2/characters-back.png', assets / 'characters-back.png')
    # Metadata extraction only: the production PNG bytes are copied unchanged.
    boxes = {}
    for direction, name, columns, rows in [('front','characters.png',6,4),('back','characters-back.png',6,4),('decor','decor.png',4,2)]:
        image = Image.open(assets / name).convert('RGBA')
        if image.getchannel('A').getextrema()[0] != 0:
            raise ValueError(f'{name} needs real transparent margins')
        boxes[direction] = []
        for row in range(rows):
            for column in range(columns):
                left, top = round(column*image.width/columns), round(row*image.height/rows)
                cell = image.crop((left,top,round((column+1)*image.width/columns),round((row+1)*image.height/rows)))
                bounds = cell.getchannel('A').point(lambda value: 255 if value>32 else 0).getbbox()
                if not bounds: raise ValueError(f'Missing {direction} sprite {row},{column}')
                x,y,right,bottom = bounds
                boxes[direction].append([left+x,top+y,right-x,bottom-y])
    (assets / 'decor.frames.json').write_text(json.dumps(boxes.pop('decor')),encoding='utf-8')
    (assets / 'characters.frames.json').write_text(json.dumps(boxes),encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--godot', default='D:/Godot/4.7.2/Godot_v4.7.2-stable_win64_console.exe')
    parser.add_argument('--import-only', action='store_true')
    args = parser.parse_args()
    prepare()
    run([args.godot,'--headless','--path',str(PROJECT),'--editor','--import'])
    run([args.godot,'--headless','--path',str(PROJECT),'--quit-after','2'])
    if (PROJECT / 'test_scene.gd').is_file():
        run([args.godot,'--headless','--path',str(PROJECT),'--script','res://test_scene.gd'])
    if not args.import_only:
        destination = ROOT / 'frontend/public/renderers/academy' / ASSET_VERSION
        destination.mkdir(parents=True,exist_ok=True)
        template = ROOT / '.cache/godot/4.7.2/web_nothreads_release.zip'
        if not template.is_file(): raise FileNotFoundError('Run fetch_web_templates.py first')
        manifest = destination / 'manifest.json'
        # Mark the bundle available only after a complete export.
        manifest.unlink(missing_ok=True)
        preset = f'''[preset.0]
name="Web"
platform="Web"
runnable=true
export_filter="all_resources"
include_filter="*.json"
exclude_filter="test_scene.gd"
export_path="{(destination / 'index.html').as_posix()}"

[preset.0.options]
custom_template/release="{template.as_posix()}"
variant/extensions_support=false
variant/thread_support=false
html/head_include="<script src='bridge.js'></script>"
html/canvas_resize_policy=2
html/focus_canvas_on_start=false
progressive_web_app/enabled=false
'''
        (PROJECT / 'export_presets.cfg').write_text(preset,encoding='utf-8')
        run([args.godot,'--headless','--path',str(PROJECT),'--export-release','Web',str(destination / 'index.html')])
        shutil.copyfile(PROJECT / 'bridge.js', destination / 'bridge.js')
        html = (destination / 'index.html').read_text(encoding='utf-8')
        for old, new in [
            ('function displayFailureNotice(err) {', 'function displayFailureNotice(err) { window.AetherloomAcademy.fail(String(err));'),
            ("'onProgress': function (current, total) {", "'onProgress': function (current, total) { window.AetherloomAcademy.progress(current,total);")]:
            if old not in html: raise RuntimeError('Godot Web shell changed: progress/error bridge needs review')
            html = html.replace(old,new)
        (destination / 'index.html').write_text(html,encoding='utf-8')
        sizes={p.name:p.stat().st_size for p in destination.iterdir() if p.is_file() and p.name!='manifest.json'}
        manifest.write_text(json.dumps({
            'version': 'academy-renderer-v1', 'asset_version': ASSET_VERSION, 'files': sizes,
        }), encoding='utf-8')
        print(f'Web renderer: {sum(sizes.values())} bytes, one bundle shared by four maps')
