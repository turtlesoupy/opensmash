"""Retryable costume builds with retained sources and readable diagnostics."""
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid


def archive_previous_build(workspace, ident, source=None):
    if not re.fullmatch('[a-z0-9][a-z0-9_-]{0,95}', ident):
        raise ValueError('Invalid character build identifier')
    workspace=Path(workspace)
    source=Path(source) if source is not None else None
    archive=workspace/'build/character-imports/previous-builds'/(ident+'-'+uuid.uuid4().hex)
    for label,folder in [('output',workspace/'build/characters'/ident),
                         ('source',workspace/'assets/characters'/ident)]:
        if folder.exists():
            archive.mkdir(parents=True,exist_ok=True)
            # A default imported costume can use this same folder as input.
            relative=source.relative_to(folder) if source is not None and source.is_relative_to(folder) else None
            folder.rename(archive/label)
            if relative is not None:source=archive/label/relative
    return source


def run_stage(args, workspace, log, stage, target):
    log=Path(log);log.parent.mkdir(parents=True,exist_ok=True)
    label=target.replace('-', ' ').title()
    def record(text):
        with log.open('a',encoding='utf-8') as stream:
            stream.write(f'\n[{stage}: {target}]\n'+text+'\n')
    try:
        result=subprocess.run([sys.executable,*map(str,args)],cwd=workspace,
                              capture_output=True,text=True,encoding='utf-8',errors='replace',
                              env={**os.environ,'PYTHONIOENCODING':'utf-8'},timeout=240)
    except subprocess.TimeoutExpired as error:
        parts=[error.stdout or '',error.stderr or '']
        text=''.join(part.decode('utf-8',errors='replace') if isinstance(part,bytes) else part for part in parts)
        record(text+'\nTimed out after 240 seconds.')
        raise ValueError(f'{stage} for {label} timed out. Retry the import. Diagnostic log: {log}') from None
    except OSError as error:
        record(str(error))
        raise ValueError(f'{stage} for {label} could not start. Restart the app and retry. Diagnostic log: {log}') from None
    output=result.stdout+(getattr(result,'stderr','') or '')
    record(output)
    if result.returncode:
        action=('Choose another moveset or retry after updating the app.'
                if 'Source-shape check' in output else 'Retry; if this repeats, share the diagnostic log.')
        raise ValueError(f'{stage} for {label} failed. {action} Diagnostic log: {log}')
    return result
