"""Small, auditable portability edits in generated copies; upstream stays intact."""
import hashlib, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def prepare(out):
    changes={}
    def write(relative, original, replacement, rationale):
        source=ROOT/'melee'/relative;text=source.read_text()
        if text.count(original)!=1:raise ValueError(f'Port patch drift: {relative}')
        patched=text.replace(original,replacement)
        target=out/'patched'/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(patched)
        changes[relative]=dict(path=str(target),original_sha256=hashlib.sha256(text.encode()).hexdigest(),
                               patched_sha256=hashlib.sha256(patched.encode()).hexdigest(),rationale=rationale)
    write('src/melee/ef/efalt.c',
          '#define EFALT_VA_ARG(t) (*((t*) __va_arg(vlist_arg, _var_arg_typeof(t))))',
          '#define EFALT_VA_ARG(t) va_arg(vlist, t)',
          'Use compiler varargs instead of the Metrowerks __va_arg register ABI.')
    source=(ROOT/'melee/src/melee/gr/grmutecity.c').read_text()
    start=source.index('s32 grMuteCity_801F2AB0(');end=source.index('\n/// @copydoc',start)
    original=source[start:end]
    replacement=original.replace('                return;', '                return 0;')
    replacement=replacement.replace('        appsrt->gp = gen;','        appsrt->gp = gen;\n        return 1;')
    replacement=replacement.rsplit('}',1)[0]+'    return 0;\n}\n'
    write('src/melee/gr/grmutecity.c',original,replacement,
          'Define effect-created boolean instead of falling off a non-void function. '
          'Both callers store x28 and only test zero/nonzero. PPC residual r3 is not a portable return contract; '
          'this is an intentional portability fix, not a bit-exact stage claim.')
    (out/'portability-patches.json').write_text(json.dumps(changes,indent=2)+'\n')
    return {k:Path(v['path']) for k,v in changes.items()}
