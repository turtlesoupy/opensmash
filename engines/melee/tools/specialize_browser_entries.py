"""Reduce hot PPC entry switches and materialize PC at observable boundaries.

The original function remains the fallback for every other entry, exceptions,
write journaling, and overlapping CPU/RAM storage. Instruction bodies, branch
targets and cycle charges remain unchanged. Memory callbacks receive the original
instruction PC. Only reviewed pure integer operations can defer its store.

Entry hints come from the verified 1.02 DOL's direct branches, return addresses,
function symbols and local loop heads. They select a fast path, not legal guest
control flow; an unlisted address still executes the original generated code.
"""
import hashlib
import json
import re
from pathlib import Path

from specialize_browser_math import GENERATED

METADATA = Path(__file__).with_name('browser_entry_points.json')
MEMORY_CALL = re.compile(r'\bmem_(?:read|write)\d+\(ctx,')
PURE_CALLS = {'if', 'while', 'switch', 'for', 'sizeof',
              'dolrecomp_rotl32', 'dolrecomp_mask32'}
PURE_CALLS.update(f'mem_{op}{width}' for op in ('read', 'write')
                  for width in (8, 16, 32, 64))


def write_changed(path, text):
    if not path.exists() or path.read_text() != text:
        path.write_text(text)


def memory_helpers():
    text = '''#pragma once
#include "generated.h"
static bool opensmash_pc_overlap(const void* a, unsigned asize,
                                 const void* b, unsigned bsize) {
    return (u64)(uintptr_t)a < (u64)(uintptr_t)b + bsize &&
           (u64)(uintptr_t)b < (u64)(uintptr_t)a + asize;
}
static bool opensmash_pc_safe(CPUState* ctx) {
    return !ctx->exception && !g_mem_write_journal &&
        !opensmash_pc_overlap(ctx, sizeof(*ctx), ctx->ram, ctx->ram_size) &&
        (!ctx->exram || !opensmash_pc_overlap(ctx, sizeof(*ctx), ctx->exram,
                                            ctx->exram_size));
}
'''
    for width in (8, 16, 32, 64):
        kind, size = f'u{width}', width // 8
        read = '*ptr' if width == 8 else f'read_be{width}(ptr)'
        write = '*ptr = value;' if width == 8 else f'write_be{width}(ptr, value);'
        text += f'''static inline {kind} opensmash_pc_read{width}(CPUState* ctx, u32 ea, u32 cia) {{
    u8* ptr = get_ram_ptr(ctx, ea, {size}, NULL);
    if (ptr) return {read};
    ctx->pc = cia;
    return mem_read{width}(ctx, ea);
}}
static inline void opensmash_pc_write{width}(CPUState* ctx, u32 ea, {kind} value, u32 cia) {{
    u8* ptr = get_ram_ptr(ctx, ea, {size}, NULL);
    if (!ptr || g_mem_write_journal) {{
        ctx->pc = cia;
        mem_write{width}(ctx, ea, value);
        return;
    }}
    clear_matching_reservation(ctx, ea);
    {write}
}}
'''
    return text


def defer_counter(match, stats):
    address, body = match[1], match[2]
    store = f'    ctx->pc = 0x{address}u;\n'
    # Only the instruction-entry store is redundant. A self-branch can assign
    # the same address inside its budget/return path and must retain that write.
    if not body.startswith(store):
        return match[0]
    code = re.sub(r'//[^\n]*', '', body)
    calls = set(re.findall(r'\b([A-Za-z_]\w*)\s*\(', code))
    if calls - PURE_CALLS:
        return match[0]
    # A PC read (including a comparison) must see the original materialization.
    if re.search(r'ctx->pc\s*(?!\s*=\s*[^=])', code.replace(store, '')):
        return match[0]
    changed = body[len(store):]
    for width in (8, 16, 32, 64):
        changed = re.sub(rf'mem_read{width}\(ctx, ea\)',
                         f'opensmash_pc_read{width}(ctx, ea, 0x{address}u)', changed)
        changed = re.sub(
            rf'mem_write{width}\(ctx, ea, (.*?)\);',
            lambda m: f'opensmash_pc_write{width}(ctx, ea, {m[1]}, 0x{address}u);',
            changed)
    # Cache-line clears, for example, use ea+i. Keep their original PC store
    # unless every memory access has an explicit observation boundary.
    if MEMORY_CALL.search(changed):
        return match[0]
    stats['deferredStores'] += 1
    return f'label_{address}:\n{changed}'


def specialize_entries(generated=GENERATED):
    metadata = json.loads(METADATA.read_text())
    if hashlib.sha256((generated / 'main.dol').read_bytes()).hexdigest() != metadata['dolSha256']:
        raise ValueError('Entry specialization requires the verified USA 1.02 DOL')
    output = generated / 'entries'
    output.mkdir(exist_ok=True)
    write_changed(generated / 'opensmash_entry_memory.h', memory_helpers())
    manifest, oracle, rows = [], ['#pragma once\n#include "generated.h"\n'], []
    stats = {'regions': 0, 'fastEntries': 0, 'deferredStores': 0, 'deferredRegions': 0}
    for region in metadata['regions']:
        base = region['base']
        original, = (generated / 'chunks').glob(f'*_{base}.c')
        source = original.read_text()
        if hashlib.sha256(source.encode()).hexdigest() != region['sourceSha256']:
            raise ValueError(f'Generated region {base} changed; revalidate entry specialization')
        pattern = (rf'(void func_{base}\(CPUState\* ctx\) \{{\n    switch \(ctx->pc\) \{{\n)'
                   r'(.*?)(    default: return;\n    })')
        match = re.search(pattern, source, re.S)
        if not match:
            raise ValueError(f'Missing entry switch in {original.name}')
        entries = set(region['entries'])
        cases = re.findall(r'case 0x([0-9A-F]{8})u:', match[2])
        if not entries or not entries.issubset(cases):
            raise ValueError(f'Invalid entry hints for {base}')
        selected = ''.join(line for line in match[2].splitlines(True)
                           if re.search(r'0x([0-9A-F]+)', line)[1] in entries)
        fast = (source[:match.start(2)] + selected +
                f'    default: reference_{base}(ctx); return;\n    }}' + source[match.end():])
        # Preserve helper bodies: their own PC observations are not specialized.
        start = fast.index(f'void func_{base}(CPUState* ctx) {{')
        fast = fast[:start] + re.sub(
            r'label_([0-9A-F]{8}):\n(.*?)(?=label_[0-9A-F]{8}:\n|\Z)',
            lambda m: defer_counter(m, stats), fast[start:], flags=re.S)
        fast = fast.replace(f'void func_{base}(CPUState* ctx) {{',
                            f'void func_{base}(CPUState* ctx) {{\n'
                            f'    if (!opensmash_pc_safe(ctx)) {{ reference_{base}(ctx); return; }}', 1)
        reference = source.replace(f'func_{base}', f'reference_{base}')
        reference = re.sub(r'\bloop_([0-9A-F]+)', r'reference_loop_\1', reference)
        reference = reference.replace('void reference_', '__attribute__((noinline)) void reference_')
        destination = output / original.name
        write_changed(destination, '#include "../opensmash_entry_memory.h"\n' +
                      reference + '\n' + fast.replace('#include "../generated.h"', ''))
        manifest += [f'list(REMOVE_ITEM OPENSMASH_CHUNKS "{original.as_posix()}")\n',
                     f'list(APPEND OPENSMASH_CHUNKS "{destination.as_posix()}")\n']
        oracle.append(f'void reference_{base}(CPUState*);\n')
        rows.append(f'    {{0x{base}u, reference_{base}, func_{base}}},\n')
        stats['regions'] += 1
        stats['fastEntries'] += len(entries)
    hinted = {region['base'] for region in metadata['regions']}
    defer_remaining(generated, hinted, oracle, rows, stats)
    oracle += ['static const struct { u32 base; void (*reference)(CPUState*); '
               'void (*fast)(CPUState*); } rows[] = {\n', *rows, '};\n']
    write_changed(generated / 'opensmash_entries.cmake', ''.join(manifest))
    write_changed(generated / 'opensmash_entries_oracle.h', ''.join(oracle))
    write_changed(generated / 'opensmash_entries.json', json.dumps(stats, indent=2) + '\n')
    return stats


if __name__ == '__main__':
    print(json.dumps(specialize_entries()))


def defer_remaining(generated, hinted, oracle, rows, stats):
    """Defer redundant PC stores in every region without entry hints.

    These regions keep their full entry switch. The original generated function
    is retained as `reference_<base>` in a separate, test-only archive so the
    game module does not grow; the differential oracle compares both over the
    same scenarios (including write journaling and preset exceptions, where the
    memory helpers materialize the instruction PC before any callback).
    """
    output = generated / 'deferred'
    references = generated / 'references'
    output.mkdir(exist_ok=True)
    references.mkdir(exist_ok=True)
    stale = {path.name for directory in (output, references) for path in directory.glob('*.c')}
    for original in sorted((generated / 'chunks').glob('*.c')):
        base = original.stem.rsplit('_', 1)[1]
        if base in hinted:
            continue
        source = original.read_text()
        start = source.index(f'void func_{base}(CPUState* ctx) {{')
        fast = source[:start] + re.sub(
            r'label_([0-9A-F]{8}):\n(.*?)(?=label_[0-9A-F]{8}:\n|\Z)',
            lambda m: defer_counter(m, stats), source[start:], flags=re.S)
        if fast == source:
            continue
        reference = source.replace(f'func_{base}', f'reference_{base}')
        reference = re.sub(r'\bloop_([0-9A-F]+)', r'reference_loop_\1', reference)
        reference = reference.replace('void reference_', '__attribute__((noinline)) void reference_')
        write_changed(output / original.name,
                      '#include "../opensmash_entry_memory.h"\n' + fast)
        write_changed(references / original.name, reference)
        stale.discard(original.name)
        oracle.append(f'void reference_{base}(CPUState*);\n')
        rows.append(f'    {{0x{base}u, reference_{base}, func_{base}}},\n')
        stats['deferredRegions'] += 1
    for name in stale:
        for directory in (output, references):
            (directory / name).unlink(missing_ok=True)
