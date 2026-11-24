"""Fetch only official Web template members from the version-matched TPZ.

HTTP byte ranges avoid downloading the unrelated 1.28GB platform bundle.
All acquired files stay in the repository cache, never a global installation.
"""
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[3]
VERSION = '4.7.2-stable'
TARGET = ROOT / '.cache/godot/4.7.2'


class RemoteZip(io.RawIOBase):
    def __init__(self, url, size):
        self.url, self.size, self.position = url, size, 0

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        return self.position

    def tell(self):
        return self.position

    def read(self, size=-1):
        size = min(size if size >= 0 else self.size, self.size-self.position)
        if size <= 0:
            return b''
        request = urllib.request.Request(self.url, headers={
            'User-Agent': 'Aetherloom-Academy', 'Range': f'bytes={self.position}-{self.position+size-1}'})
        with urllib.request.urlopen(request, timeout=60) as response:
            if response.status != 206:
                raise RuntimeError('Server did not honor byte ranges; full archive download was not attempted')
            value = response.read(size)
        self.position += len(value)
        return value


if __name__ == '__main__':
    request = urllib.request.Request(f'https://api.github.com/repos/godotengine/godot-builds/releases/tags/{VERSION}',
                                     headers={'User-Agent':'Aetherloom-Academy'})
    with urllib.request.urlopen(request, timeout=30) as response:
        release = json.load(response)
    asset = next(a for a in release['assets'] if a['name'] == f'Godot_v{VERSION}_export_templates.tpz')
    TARGET.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(RemoteZip(asset['browser_download_url'], asset['size'])) as archive:
        members = [i for i in archive.infolist() if Path(i.filename).name.startswith('web_') and i.filename.endswith('.zip')]
        print(json.dumps([{'file':m.filename, 'compressed':m.compress_size} for m in members]), flush=True)
        for member in members:
            if Path(member.filename).name != 'web_nothreads_release.zip':
                continue
            destination = TARGET / Path(member.filename).name
            if not destination.exists():
                with archive.open(member) as source, destination.open('wb') as out:
                    while chunk := source.read(1024*1024): out.write(chunk)
            print(f'Web template ready: {destination}', flush=True)
