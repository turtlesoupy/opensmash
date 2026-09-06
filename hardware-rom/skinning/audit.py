"""Independent structural validation of the skinned model layout."""
import struct
import math
from skinning.patches import GRAPHICS_RESERVE


def audit_model(raw,pointers,common):
    signature=bytes.fromhex('df00000000000000534b4e31')
    marker=raw.find(signature)
    assert marker>=0 and raw.find(signature,marker+1)<0,'Missing or duplicate skin descriptor'
    def pointer(offset,size):
        at=pointers[marker+offset]
        assert at%4==0 and 0<=at<=len(raw)-size
        return at
    code_size,nverts,nout,njoints,flags=struct.unpack_from('>5I',raw,marker+20)
    assert 0<nverts<=2000 and 0<nout<=4096 and 0<njoints<=32 and flags in (0,1)
    assert 4*nout*16<=GRAPHICS_RESERVE,'Skin render buffers exceed reserved memory'
    pointer(12,128)
    code_at=struct.unpack_from('>I',raw,marker+16)[0]
    assert marker+16 not in pointers
    assert code_at%16==0 and code_at>=16 and code_at+code_size<=len(common)
    assert struct.unpack_from('>4I',common,code_at-16)==(0x534b4331,16 if njoints<=16 else 32,code_size,code_at)
    render=pointer(80,20)
    b0,b1,scale,fit,npins=struct.unpack_from('>2I2fI',raw,render)
    assert b1<32 and npins<=8 and math.isfinite(scale) and scale>0 and math.isfinite(fit) and fit>0
    assert render+20+npins*88+nverts*4<=len(raw)
    for i in range(npins):
        at=render+20+i*88
        assert struct.unpack_from('>I',raw,at)[0]<37
        assert all(j<njoints for j in raw[at+28:at+32])
        assert sum(raw[at+32:at+36])>0
        assert all(math.isfinite(v) for v in struct.unpack_from('>6f',raw,at+4)+struct.unpack_from('>13f',raw,at+36))
    if flags:
        cap=16 if njoints<=16 else 32
        parity=pointer(76,124+92*cap+nverts*4)
        assert struct.unpack_from('>I',raw,parity)[0]==njoints
    joints=pointer(40,njoints*92);vertices=pointer(44,nverts*16)
    mapping=pointer(48,nout*2);pointer(52,nout*16)
    for i in range(njoints):
        jid,parent=struct.unpack_from('>Ii',raw,joints+i*92)
        assert jid<37
        if flags:assert -1<=parent<i
    for i in range(nverts):
        slots=raw[vertices+i*16+6:vertices+i*16+10]
        weights=raw[vertices+i*16+10:vertices+i*16+14]
        assert sum(weights)>0 and all(j<njoints for j in slots)
    assert nout==nverts and list(struct.unpack('>'+str(nout)+'H',raw[mapping:mapping+nout*2]))==list(range(nverts))
    cursor=pointer(56,32);loaded=set();texture_size=0;count=0
    for _ in range(len(raw)//8):
        assert cursor+8<=len(raw)
        w0,w1=struct.unpack_from('>II',raw,cursor);op=w0>>24
        if op==0xdf:
            assert (w0,w1)==(0xdf000000,0)
            break
        if op==1:
            num=(w0>>12)&255;end=(w0&255)//2;offset=w1&0xffffff
            assert 0<num<=30 and num<=end<=30 and (w0&1)==0
            loaded.update(range(end-num,end))
            assert w1>>24==13 and offset%16==0 and offset+num*16<=nout*16
        elif op==2:
            assert w0>>16 in (0x0210,0x0214) and (w0&65535)%2==0 and (w0&65535)//2 in loaded
        elif op==5:
            assert w1==0 and all(((w0>>s)&255)%2==0 and ((w0>>s)&255)//2 in loaded for s in (16,8,0))
            count+=1
        elif op==0xfd:
            texture_size=(w0&4095)+1
            assert w0>>12==0xfd100 and texture_size in (4,8,12)
            at=pointers[cursor+4]
            assert at%8==0 and at+texture_size**2*2<=len(raw)
        elif op==0xf5:
            assert texture_size and w0==(0xf5100000|((texture_size//4)<<9)) and w1 in (0x07080200,0x00080200)
        elif op in (0xf4,0xf2):
            extent=((texture_size-1)*4<<12)|((texture_size-1)*4)
            assert texture_size and w0==op<<24 and w1==(extent|(0x07000000 if op==0xf4 else 0))
        elif op in (0xe7,0xe6):assert w0==op<<24 and w1==0
        elif op==0xd7:assert (w0,w1) in ((0xd7000000,0),(0xd7000002,0xffffffff))
        elif op==0xdb:assert (w0,w1)==(0xdb020000,24)
        elif op==0xdc:
            assert w0 in (0xdc08060a,0xdc08090a)
            assert cursor+4 in pointers and pointers[cursor+4]+8<=len(raw)
        elif op==0xfa:assert w0==0xfa000000 and w1&255==255
        elif op==0xfc:assert (w0,w1) in ((0xfc1219ff,0xfffffe38),(0xfc327fff,0xfffff838),(0xfcffffff,0xfffe793c),(0xfcffffff,0xfffcf238),(0xfc121824,0xff33ffff))
        elif op==0xd9:assert (w0,w1) in ((0xd9fbf9ff,0),(0xd9ffffff,0x00220005),(0xd9f1f9ff,0x00200004),(0xd9ffffff,0x00020400))
        else:raise AssertionError(f'Unexpected skinned GBI opcode {op:x}')
        cursor+=8
    else:raise AssertionError('Unterminated skinned display list')
    assert count>0
    assert raw[cursor-24:cursor]==bytes.fromhex('e700000000000000d9ffffff00020400fc121824ff33ffff'), 'Missing conventional material-state restore'
    return count
