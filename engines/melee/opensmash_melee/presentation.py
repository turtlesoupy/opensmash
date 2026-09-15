"""Per-costume results identity; consumed by the shared native/Wasm launch mod."""
import json
from pathlib import Path
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

MAGIC = 0x4f535549  # OSUI; extension of our own MObjDesc, never a vanilla edit.
VERSION = 8
OSBV_SIZE = 4 + 8640 + 1024 + 80 + 32 + 768 + 2304


def stock_image(path):
    """Apply the source stock art's chroma background before downsampling."""
    art=Image.open(path).convert('RGBA')
    pixels=np.array(art)
    background=pixels[2 if art.height>2 else 0,2 if art.width>2 else 0,:3].astype(int)
    # Existing transparent exports are already keyed; preserve them verbatim.
    if pixels[:,:,3].min()==255 and background[1]>background[0]+40 and background[1]>background[2]+40:
        difference=np.abs(pixels[:,:,:3].astype(int)-background).sum(axis=2)
        pixels[difference<=110,3]=0
        art=Image.fromarray(pixels)
    return art


def import_stencil(source, destination):
    source, destination = Path(source), Path(destination)
    explicit = source / 'emblem_stencil.png'
    if explicit.exists():
        Image.open(explicit).convert('L').save(destination / explicit.name)
        return True
    for path in sorted(source.glob('*.osbui')):
        raw = path.read_bytes()
        if raw[:4] == b'OSBV' and len(raw) == OSBV_SIZE:
            Image.frombytes('L', (48,48), raw[-2304:]).save(destination / 'emblem_stencil.png')
            return True
    return False


def panel(character):
    character = Path(character)
    data = json.loads((character/'character.json').read_text())
    name = (data.get('short') or data['display']).upper()
    mask_path = character/'emblem_stencil.png'
    if mask_path.exists():
        emblem = Image.open(mask_path).convert('L')
    else:
        # For newly generated art without an OpenSmash stencil, retain dark
        # linework inside the keyed artwork rather than making a solid blob.
        rgba = np.asarray(Image.open(character/'emblem_raw.png').convert('RGBA'))
        rgb = rgba[:,:,:3].astype(float)
        foreground = np.linalg.norm(rgb-rgb[2,2], axis=2)>90
        ink = (255-rgb.mean(axis=2))*foreground*(rgba[:,:,3]/255)
        emblem = Image.fromarray(np.uint8(ink))
    bbox = emblem.getbbox()
    if bbox: emblem = emblem.crop(bbox)
    scale=92/max(emblem.size)
    emblem=emblem.resize((max(1,round(emblem.width*scale)),max(1,round(emblem.height*scale))), Image.Resampling.LANCZOS)
    canvas = Image.new('L',(256,256))
    canvas.info['emblem'] = emblem
    canvas.info['stock'] = stock_image(character/'stock_raw.png')
    font = None
    for candidate in ('/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf',
                      'DejaVuSansCondensed-Bold.ttf'):
        try: font = ImageFont.truetype(candidate,52);break
        except OSError: pass
    if font is None:
        try: font = ImageFont.load_default(size=52)
        except TypeError: font = ImageFont.load_default()
    bbox = font.getbbox(name)
    text = Image.new('L',(max(1,bbox[2]-bbox[0]),max(1,bbox[3]-bbox[1])))
    ImageDraw.Draw(text).text((-bbox[0],-bbox[1]),name,font=font,fill=255)
    text = text.resize((min(246,text.width),52),Image.Resampling.LANCZOS)
    canvas.paste(text,((256-text.width)//2,198))
    full=data['display'].upper()
    box=font.getbbox(full)
    title=Image.new('L',(max(1,box[2]-box[0]),max(1,box[3]-box[1])))
    ImageDraw.Draw(title).text((-box[0],-box[1]),full,font=font,fill=255)
    title=title.resize((min(246,title.width),52),Image.Resampling.LANCZOS)
    title_canvas=Image.new('L',(256,64));title_canvas.paste(title,((256-title.width)//2,6))
    canvas.info['title']=title_canvas
    return canvas


def i4(image):
    p = np.asarray(image.convert('L'),dtype=np.uint8)//17
    height,width=p.shape
    if width%8 or height%8: raise ValueError('I4 dimensions must be multiples of eight')
    out=bytearray()
    for y in range(0,height,8):
        for x in range(0,width,8):
            tile=p[y:y+8,x:x+8].reshape(-1)
            out.extend(((tile[::2]<<4)|tile[1::2]).tobytes())
    return bytes(out)


def emblem_geometry(a, image):
    # Marching triangles interpolate the stencil boundary. Raster rectangles
    # become conspicuous stair steps at the winner logo's full-screen size.
    emblem=image.info.get('emblem',image.crop((0,0,256,192)))
    canvas=Image.new('L',(64,64))
    ratio=56/max(emblem.size)
    emblem=emblem.resize((max(1,round(emblem.width*ratio)),max(1,round(emblem.height*ratio))),Image.Resampling.LANCZOS)
    canvas.paste(emblem,((64-emblem.width)//2,(64-emblem.height)//2))
    mask=np.asarray(canvas,dtype=float)
    ys,xs=np.where(mask>96)
    if len(xs)==0: raise ValueError('Empty character emblem')
    center=((xs.min()+xs.max())/2,(ys.min()+ys.max())/2)
    scale=5/max(xs.max()-xs.min(),ys.max()-ys.min(),1)
    vertices=[];indices=[];unique={}
    def index(x,y):
        key=(round(x,5),round(y,5))
        if key not in unique:
            unique[key]=len(vertices)
            vertices.append(((x-center[0])*scale,(center[1]-y)*scale,0))
        return unique[key]
    for y in range(mask.shape[0]-1):
        for x in range(mask.shape[1]-1):
            corners=[(x,y,mask[y,x]),(x+1,y,mask[y,x+1]),
                     (x+1,y+1,mask[y+1,x+1]),(x,y+1,mask[y+1,x])]
            for corners3 in ((corners[0],corners[2],corners[1]),(corners[0],corners[3],corners[2])):
                clipped=[]
                for i,current in enumerate(corners3):
                    previous=corners3[i-1]
                    if (current[2]>=96)!=(previous[2]>=96):
                        t=(96-previous[2])/(current[2]-previous[2])
                        clipped.append((previous[0]+t*(current[0]-previous[0]),previous[1]+t*(current[1]-previous[1])))
                    if current[2]>=96:clipped.append(current[:2])
                for i in range(1,len(clipped)-1):
                    indices.extend(index(*v) for v in (clipped[0],clipped[i],clipped[i+1]))
    if len(vertices)>65535:raise ValueError('Emblem exceeds GX vertex limit')
    positions=a.append(np.asarray(vertices,dtype='>f4').tobytes(),32)
    attrs=a.alloc(48);a.pack('4I',attrs,9,3,1,4);a.pack('H',attrs+18,12)
    a.pointer(attrs+20,positions);a.pack('I',attrs+24,255)
    display=bytearray()
    for start in range(0,len(indices),65535):
        batch=indices[start:start+65535]
        display.extend(struct.pack('>BH',0x90,len(batch)))
        display.extend(np.asarray(batch,dtype='>u2').tobytes())
    display.extend(bytes(-len(display)%32));dl=a.append(display,32)
    p=a.alloc(24);a.pointer(p+8,attrs);a.pack('HH',p+12,0,len(display)//32);a.pointer(p+16,dl)
    return p


def portrait_fit(mesh, skeleton, profile):
    head=profile.get('joint_map',{}).get('Head')
    if head is None:return None
    mask=[sum(w for j,w in env if j==head)>=.5 for env in mesh['envelopes']]
    points=np.asarray(mesh['positions'])[mask]
    if len(points)<4:return None
    inverse=skeleton[head]['inverse_bind']
    if inverse is None:return None
    local=np.c_[points,np.ones(len(points))]@np.asarray(inverse).T
    center=(local[:,:3].min(axis=0)+local[:,:3].max(axis=0))/2
    radius=float(np.linalg.norm(local[:,:3]-center,axis=1).max())
    return skeleton[head]['offset'],center,radius


def attach(a, dobj, image, portrait=None, stature=None):
    old=a.ptr(dobj+8)
    if old is None: raise ValueError('Presentation needs an existing material')
    # Clone descriptor and relocation fields, preserving original GX material.
    m=a.append(a.data[old:old+24]+bytes(120))
    for offset in range(0,24,4):
        if old+offset in a.relocs:a.pointer(m+offset,a.ptr(old+offset))
    pixels=a.append(i4(image),32)
    im=a.alloc(24);a.pointer(im,pixels);a.pack('HHI',im+4,256,256,0)
    positions=a.append(struct.pack('>12f',-4.301025,-1.138428,.202148,
                                  -4.301025,7.463622,.202148,
                                  4.301025,-1.138428,.202148,
                                  4.301025,7.463622,.202148),32)
    uv=a.append(struct.pack('>8f',0,1,0,0,1,1,1,0),32)
    attrs=a.alloc(72)
    for i,(attr,ptr,stride) in enumerate(((9,positions,12),(13,uv,8))):
        a.pack('4I',attrs+i*24,attr,3,1,4)
        a.pack('H',attrs+i*24+18,stride);a.pointer(attrs+i*24+20,ptr)
    a.pack('I',attrs+48,255)
    dl=bytearray(struct.pack('>BH',0x98,4))
    for i in range(4):dl.extend(struct.pack('>HH',i,i))
    dl.extend(bytes(-len(dl)%32));display=a.append(dl,32)
    pobj=a.alloc(24);a.pointer(pobj+8,attrs);a.pack('HH',pobj+12,0x8000,1);a.pointer(pobj+16,display)
    a.pack('II',m+24,MAGIC,VERSION);a.pointer(m+32,im);a.pointer(m+36,pobj)
    a.pointer(m+40,emblem_geometry(a,image))
    title_pixels=a.append(i4(image.info.get('title',image.crop((0,192,256,256)))),32)
    title=a.alloc(24);a.pointer(title,title_pixels);a.pack("HHI",title+4,256,64,0)
    a.pointer(m+44,title)
    if portrait:
        head,center,radius=portrait
        a.pointer(m+48,head);a.pack("4f",m+52,*center,radius)
    stature=stature or dict(scale=1.,offset=0.)
    a.pack('2f',m+68,stature['scale'],stature['offset'])
    from .gx import rgba8
    for offset,art in [(76,image.info.get('stock')), (80,image.info.get('emblem'))]:
        if art is None:continue
        art=art.convert('RGBA') if offset==76 else Image.merge('RGBA',(Image.new('L',art.size,255),)*3+(art,))
        bounds=art.getbbox()
        if bounds:art=art.crop(bounds)
        art.thumbnail((28,28),Image.Resampling.LANCZOS)
        canvas=Image.new('RGBA',(32,32));canvas.paste(art,((32-art.width)//2,(32-art.height)//2))
        if offset==80:
            outline=Image.new('RGBA',(32,32),(0,0,0,0));outline.putalpha(canvas.getchannel('A').filter(ImageFilter.MaxFilter(3)))
            outline.alpha_composite(canvas);canvas=outline
        pixels=a.append(rgba8(canvas),32);descriptor=a.alloc(24)
        a.pointer(descriptor,pixels);a.pack('HHI',descriptor+4,32,32,6);a.pointer(m+offset,descriptor)
    # m+88..135 is per-costume draw-matrix scratch, never animation state.
    a.pointer(dobj+8,m)
