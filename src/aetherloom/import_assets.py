"""Read locally stored import batch metadata and locate its original files."""

import json
from pathlib import Path


def read_import_batch(folder: Path) -> dict:
    return json.loads((folder / 'preview.json').read_text(encoding='utf-8'))


def find_import_original(folder: Path, asset: str) -> Path | None:
    folder = folder.resolve()
    path = (folder / asset).resolve()
    if path.is_relative_to(folder) and path.is_file():
        return path
    return None
