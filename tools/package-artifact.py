"""Детерминированный Pages tar и ограниченное извлечение проверенного архива."""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_name(name):
    parts = name.split('/')
    return 0 < len(parts) <= 8 and all(re.fullmatch(r'[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*', part) for part in parts)


def pack(root, inventory, output):
    files = json.loads(Path(inventory).read_text())
    with tarfile.open(output, 'w', format=tarfile.GNU_FORMAT) as archive:
        for file in files:
            require(safe_name(file['path']), 'Unsafe archive path')
            path = Path(root) / file['path']
            require(path.is_file() and not path.is_symlink(), 'Invalid source file')
            body = path.read_bytes()
            require(len(body) == file['bytes'] and hashlib.sha256(body).hexdigest() == file['sha256'], 'Source changed during packaging')
            info = tarfile.TarInfo(file['path'])
            info.size = len(body)
            info.mode = 0o644
            info.mtime = 0
            archive.addfile(info, io.BytesIO(body))


def unpack(archive_path, output, expected_sha256):
    archive_path, output = Path(archive_path), Path(output)
    require(not output.exists() and not output.is_symlink(), 'Extraction destination must not exist')
    require(archive_path.stat().st_size <= 24 * 1024 * 1024, 'Archive size limit')
    require(hashlib.sha256(archive_path.read_bytes()).hexdigest() == expected_sha256, 'Archive digest mismatch')
    with tarfile.open(archive_path, 'r:') as archive:
        members = archive.getmembers()
        require(0 < len(members) <= 2200, 'Archive entry limit')
        require(len({item.name for item in members}) == len(members), 'Duplicate archive entry')
        require(sum(item.size for item in members) <= 20 * 1024 * 1024, 'Expanded size limit')
        for item in members:
            require(item.isfile() and safe_name(item.name) and 0 <= item.size <= 8 * 1024 * 1024, 'Unsafe archive entry')
        output.mkdir(parents=True)
        for item in members:
            target = output.joinpath(*PurePosixPath(item.name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(item) as source, target.open('xb') as destination:
                body = source.read(item.size + 1)
                require(len(body) == item.size, 'Truncated archive entry')
                destination.write(body)


if __name__ == '__main__':
    mode, *args = sys.argv[1:]
    if mode == 'create' and len(args) == 3:
        pack(*args)
    elif mode == 'extract' and len(args) == 3:
        unpack(*args)
    else:
        raise SystemExit('Usage: package-artifact.py create ROOT INVENTORY TAR | extract TAR DESTINATION SHA256')
