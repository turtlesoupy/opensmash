"""Retain SDK calendar and controller algorithms, replacing hardware boundaries."""
from pathlib import Path

def prepare_os(source: Path, out: Path, patched: dict):
    text=(source/'extern/dolphin/src/dolphin/os/OSTime.c').read_text()
    body=text[:text.index('asm long long OSGetTime')]+text[text.index('static int IsLeapYear'):]
    body=body.replace('#include "__os.h"','')
    path=out/'sdk_calendar.c';path.write_text(body)
    return [path,source/'extern/dolphin/src/dolphin/pad/Padclamp.c']
