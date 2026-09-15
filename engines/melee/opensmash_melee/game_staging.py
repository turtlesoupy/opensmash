"""Reuse the verified disc's hard-link tree between stopped game sessions."""
import json
import os
from pathlib import Path
import shutil
import uuid


def link_or_copy(source, target):
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def stage_game(source, destination, costumes, customize):
    source, destination = Path(source), Path(destination)
    # Metadata is sufficient here: the setup service owns and verifies the
    # original disc. Include identity as well as timestamps to detect replacement.
    files = {}
    for path in source.rglob('*'):
        if path.is_file():
            s = path.stat()
            files[path.relative_to(source).as_posix()] = [s.st_size, s.st_mtime_ns, s.st_ino]
    identity = {'source': str(source.resolve()), 'files': files}
    marker = destination / '.opensmash-lineup.json'
    previous = {}
    try:
        previous = json.loads(marker.read_text())
    except (OSError, ValueError):
        pass
    if not isinstance(previous, dict):
        previous = {}
    overrides = previous.get('overrides')
    reuse = (previous.get('identity') == identity and isinstance(overrides, list)
             and all(isinstance(name, str) and 'files/' + name in files for name in overrides)
             and all((destination / name).is_file() for name in files))
    stage = destination if reuse else destination.with_name(destination.name + '-' + uuid.uuid4().hex)
    try:
        if reuse:
            # Removing the completion marker makes an interrupted update a full
            # rebuild on the next attempt, never a partially prepared launch.
            marker.unlink()
            for name in previous['overrides']:
                relative = Path('files') / name
                target = stage / relative
                target.unlink(missing_ok=True)
                link_or_copy(source / relative, target)
        else:
            shutil.copytree(source, stage, copy_function=link_or_copy)
        overrides = []
        for costume, name in costumes:
            target = stage / 'files' / name
            target.unlink()
            shutil.copy2(costume, target)
            overrides.append(name)
        overrides.extend(customize(stage))
        (stage / marker.name).write_text(json.dumps({'identity': identity, 'overrides': overrides}))
        if not reuse:
            if destination.exists():
                shutil.rmtree(destination)
            stage.rename(destination)
    finally:
        if not reuse and stage.exists():
            shutil.rmtree(stage)
    return destination
