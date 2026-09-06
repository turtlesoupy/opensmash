"""Build a self-contained, relocatable MIPS module only for opt-in ROMs."""
from pathlib import Path
import shutil
import struct
import subprocess

HERE=Path(__file__).resolve().parent


def elf_sections(path):
    data=Path(path).read_bytes()
    if data[:6]!=b'\x7fELF\x01\x02':
        raise ValueError('Expected ELF32 big-endian output')
    header=struct.unpack_from('>16sHHIIIIIHHHHHH',data)
    shoff,entsize,count,strings=header[6],header[11],header[12],header[13]
    rows=[struct.unpack_from('>10I',data,shoff+i*entsize) for i in range(count)]
    names=data[rows[strings][4]:rows[strings][4]+rows[strings][5]]
    result={}
    for row in rows:
        name=names[row[0]:].split(b'\0',1)[0].decode()
        result[name]=(row,data[row[4]:row[4]+row[5]])
    return result


def compile_modules(decomp,output,classic=False,joint_cap=16):
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    llvm=Path('/opt/homebrew/opt/llvm/bin/clang')
    clang=str(llvm) if llvm.is_file() else shutil.which('clang')
    assembler=shutil.which('mips-linux-gnu-as')
    linker=shutil.which('mips-linux-gnu-ld')
    if not all((clang,assembler,linker)):
        raise ValueError('--skinning requires LLVM clang with MIPS support and mips-linux-gnu binutils')
    run=lambda args:subprocess.run(args,check=True,capture_output=True,text=True)
    from skinning.native_pose import generate
    generate(decomp,output)
    try:
        runtime=output/'runtime.o'
        run([clang,'--target=mips-unknown-elf','-march=mips2','-mabi=32','-EB',
             '-DSKIN_JOINT_CAP='+str(joint_cap),'-DSKIN_CLASSIC' if classic else '-DSKIN_PARITY','-mabicalls','-fPIC','-G0','-ffreestanding','-fno-builtin','-O2',
             '-fomit-frame-pointer','-I',str(output),'-DF3DEX_GBI_2','-D_MIPS_SZLONG=32','-D_LANGUAGE_C',
             '-I',str(decomp/'include'),'-I',str(decomp/'src'),'-c',str(HERE/'runtime.c'),'-o',str(runtime)])
        module=output/'module.elf'
        run([linker,'-shared','-Bsymbolic','-T',str(HERE/'module.ld'),str(runtime),'-o',str(module)])
        sections=elf_sections(module)
        syms=sections['.dynsym'][1]
        if any(row[0] and row[5]==0 for row in struct.iter_unpack('>IIIBBH',syms)):
            raise ValueError('Runtime has unresolved external symbols')
        if sections.get('.rel.dyn',(None,b''))[1]:
            raise ValueError('Runtime has unsupported dynamic relocations')
        selected=[sections[name] for name in ('.text','.rodata','.got','.data','.bss') if name in sections]
        end=max(row[3]+row[5] for row,data in selected)
        code=bytearray(end)
        for row,data in selected:
            if row[1]!=8:code[row[3]:row[3]+len(data)]=data
        dynamic=dict(struct.iter_unpack('>II',sections['.dynamic'][1]))
        got=sections['.got'][0][3]
        relocations={got+i*4:struct.unpack_from('>I',code,got+i*4)[0]
                     for i in range(2,dynamic[0x7000000a])}
        # MIPS GOT page entries may point to the next 64 KiB page, with a
        # negative signed displacement addressing data inside this module.
        if any(value>=(len(code)+65535)//65536*65536+1 for value in relocations.values()):
            raise ValueError('Runtime GOT references data outside module')
        result={'code':bytes(code),'relocations':relocations,'joint_cap':joint_cap}
        if joint_cap==16:
            from skinning.ordering import Optimizer
            meshopt=decomp.parent/'third_party/meshoptimizer'
            host=output/'mesh_order.dylib'
            run([shutil.which('clang++') or 'c++','-O2','-std=c++11','-shared','-fPIC',
                 '-I',str(meshopt),str(HERE/'mesh_order.cpp'),str(meshopt/'allocator.cpp'),
                 str(meshopt/'vcacheoptimizer.cpp'),'-o',str(host)])
            result['optimizer']=Optimizer(host.resolve())
        for name in ('draw_hook','bootstrap'):
            obj=output/(name+'.o');elf=output/(name+'.elf')
            run([assembler,'-mips2','-32','-EB','-o',str(obj),str(HERE/(name+'.s'))])
            address='0x800f24a0' if name=='draw_hook' else '0x80000000'
            run([linker,'-Ttext='+address,'-e','skin_'+name,
                 '--defsym=ftDisplayMainDrawSkeleton=0x800f21b4',
                 '--defsym=ftDisplayMainDrawDefault=0x800f1e60',
                 '--defsym=ftDisplayMainDrawAfterImage=0x800f1020',
                 str(obj),'-o',str(elf)])
            result[name]=elf_sections(elf)['.text'][1][:228] if name=='draw_hook' else elf_sections(elf)['.text'][1]
        if len(result['draw_hook'])!=228:
            raise ValueError('Draw hook does not fit original function')
        if result['draw_hook'] != bytes.fromhex((HERE/'draw_hook.hex').read_text()):
            raise ValueError('Compiled draw hook differs from the audited ROM patch')
        if not classic:
            if joint_cap==16:
                result['wide']=compile_modules(decomp,output/'wide',False,32)
                result['wide']['optimizer']=result['optimizer']
        return result
    except subprocess.CalledProcessError as error:
        raise ValueError('MIPS toolchain failed: '+error.stderr.strip()) from error
