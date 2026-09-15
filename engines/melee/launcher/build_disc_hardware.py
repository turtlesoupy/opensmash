"""Blender-authored fun console. Run: blender -b --python this_file.py.

Blender uses Z up; glTF exports Y up. Front is +X in both spaces.
The exported lid has a real hinge behind the well, with its closed pose at zero.
"""
from pathlib import Path
import math
import random
import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parent / 'assets'
OUT.mkdir(exist_ok=True)
PREVIEWS = Path(__file__).resolve().parents[3] / 'build/melee-hardware-preview'
PREVIEWS.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color, roughness=.43, metal=0, texture=False):
    mat=bpy.data.materials.new(name); mat.diffuse_color=(*color,1); mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(*color,1)
    bsdf.inputs['Roughness'].default_value=roughness
    bsdf.inputs['Metallic'].default_value=metal
    if texture:
        rng=random.Random(64)
        image=bpy.data.images.new(name+' moulded plastic',512,512)
        values=[]
        for _ in range(512*512):
            v=rng.uniform(.985,1.015);values.extend([min(1,c*v) for c in color]+[1])
        image.pixels=values;image.pack()
        tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
        mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
    return mat

purple=material('Indigo ABS',(.19,.115,.34),.48)
edge=material('Shell seam',(.035,.025,.072),.57)
black=material('Recessed graphite',(.016,.018,.023),.55)
rubber=material('Rubber',(.008,.009,.012),.83)
grey=material('Warm grey faceplate',(.72,.73,.70),.5)
silver=material('Brushed metal',(.43,.46,.49),.34,.72)
ink=material('Warm white printing',(.82,.84,.79),.65)
gold=material('Socket contacts',(.48,.34,.10),.3,.75)
glass=material('Optical lens',(.13,.32,.47),.13,.58)
amber=material('Power indicator',(.8,.20,.018),.25)
amber.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value=(1,.16,.01,1)
amber.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=.7

root=bpy.data.objects.new('FunGameCube',None);bpy.context.collection.objects.link(root)
def finish(obj,name,mat,parent=root):
    obj.name=name
    if mat:obj.data.materials.append(mat)
    obj.parent=parent
    return obj
def apply(obj,modifier):
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
def bevel(obj,width=.006):
    m=obj.modifiers.new('Moulded edge radii','BEVEL');m.width=width;m.segments=3
    apply(obj,m)
    for p in obj.data.polygons:p.use_smooth=True
    return obj
def box(name,loc,size,mat,parent=root,radius=.004):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);obj=bpy.context.object
    obj.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    finish(obj,name,mat,parent)
    if radius:bevel(obj,radius)
    return obj
def cylinder(name,loc,radius,depth,mat,parent=root,axis='Z',bevel_width=.001):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=radius,depth=depth,location=loc)
    obj=bpy.context.object
    if axis=='X':obj.rotation_euler.y=math.pi/2
    if axis=='Y':obj.rotation_euler.x=math.pi/2
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    finish(obj,name,mat,parent)
    if bevel_width:bevel(obj,bevel_width)
    return obj
def cut(target,cutter):
    m=target.modifiers.new('Recess','BOOLEAN');m.operation='DIFFERENCE';m.solver='EXACT';m.object=cutter
    apply(target,m);bpy.data.objects.remove(cutter,do_unlink=True)
def text(name,words,loc,size,mat,rotation=(0,0,0),parent=root):
    bpy.ops.object.text_add(location=loc,rotation=rotation);obj=bpy.context.object
    obj.data.body=words;obj.data.align_x='CENTER';obj.data.align_y='CENTER';obj.data.size=size
    obj.data.extrude=.00012;obj.data.resolution_u=5
    finish(obj,name,mat,parent)
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object

# Separate mouldings, not a single rounded cube. The roof has a real cavity.
body=box('Upper indigo shell',(0,0,-.22),(.65,.70,.44),purple,radius=.013)
cut(body,cylinder('Disc well cutter',(0,0,.01),.255,.155,None,bevel_width=0))
box('Lower seam',(0,0,-.441),(.648,.698,.003),edge,radius=.008)
box('Base moulding',(0,0,-.489),(.65,.70,.092),purple,radius=.009)
for x in [-.24,.24]:
    for y in [-.27,.27]:box('Rubber foot',(x,y,-.54),(.068,.062,.018),rubber,radius=.006)

# Recessed front plate: all four ports are apertures with walls and contact pins.
fascia=box('Controller faceplate',(.326,0,-.278),(.009,.566,.262),grey,radius=.008)
for i,y in enumerate([-.213,-.071,.071,.213]):
    for target in [fascia,body]:
        cut(target,cylinder('Port cutter',(.325,y,-.229),.047,.065,None,axis='X',bevel_width=0))
    cylinder('Port interior',(.298,y,-.229),.045,.003,black,axis='X')
    barrel=cylinder('Port moulded rim',(.315,y,-.229),.045,.025,black,axis='X')
    cut(barrel,cylinder('Port bore',(.315,y,-.229),.037,.04,None,axis='X',bevel_width=0))
    box('Port key',(.305,y,-.259),(.012,.045,.008),black,radius=.001)
    for row in [-1,1]:
        for col in [-1,0,1]:box('Gold contact',(.301,y+col*.012,-.229+row*.008),(.007,.005,.003),gold,radius=.0006)
    for dot in range(i+1):
        cylinder('Player indicator',(.332,y+(dot-i/2)*.009,-.167),.002,.001,black,axis='X',bevel_width=0)
for y,label in [(-.142,'SLOT A'),(.142,'SLOT B')]:
    for target in [fascia,body]:cut(target,box('Memory slot cutter',(.326,y,-.354),(.06,.136,.031),None,radius=.003))
    box('Memory slot shadow',(.303,y,-.354),(.002,.135,.030),black,radius=.002)
    box('Memory slot door',(.319,y,-.354),(.003,.129,.025),grey,radius=.002)
    text('Memory slot label',label,(.332,y,-.388),.011,black,(math.pi/2,0,math.pi/2))

# Square lattice on the right side, horizontal cooling slits on the left.
cut(body,box('Grid opening',(-.025,.347,-.284),(.258,.07,.244),None,radius=.001))
box('Grid interior',(-.025,.318,-.284),(.258,.004,.244),black,radius=.001)
for i in range(9):
    box('Vent vertical rib',(-.154+i*.03225,.347,-.284),(.003,.007,.244),purple,radius=.0005)
for i in range(9):
    box('Vent horizontal rib',(-.025,.347,-.406+i*.0305),(.258,.007,.003),purple,radius=.0005)
for i in range(12):
    cut(body,box('Vent cutter',(-.012,-.347,-.18-i*.018),(.255,.035,.007),None,radius=.0018))
box('Vent interior',(-.012,-.327,-.279),(.26,.003,.22),black,radius=.004)
# Lower side service panel and cable notch.
box('Side service cover seam',(.17,.350,-.484),(.14,.002,.08),edge,radius=.001)
box('Side service cover',(.17,.352,-.484),(.135,.002,.075),purple,radius=.001)
box('Side cable recess',(-.065,.353,-.486),(.075,.003,.082),black,radius=.001)

# Optical deck below the roof: tray walls, spindle, optical pickup and rails.
tray=cylinder('Recessed optical deck',(0,0,-.061),.252,.013,black)
cylinder('Disc seating ring',(0,0,-.044),.088,.008,rubber)
cylinder('Spindle',(0,0,-.028),.023,.026,black)
cylinder('Spindle cap',(0,0,-.014),.016,.003,silver)
for y in [-.050,.050]:box('Pickup rail',(.128,y,-.048),(.15,.008,.007),silver,radius=.002)
box('Laser carriage',(.115,0,-.049),(.049,.071,.019),black,radius=.004)
cylinder('Laser lens',(.115,0,-.040),.012,.004,glass)
for a in range(0,360,60):
    r=.232;x=r*math.cos(math.radians(a));y=r*math.sin(math.radians(a))
    cylinder('Deck fastener',(x,y,-.050),.006,.007,silver)

# Flush top controls, with their surrounding seats and printed legends.
for x,y,r,label,mat in [(-.232,-.285,.033,'OPEN',grey),(.237,-.285,.028,'POWER',purple),(.237,.285,.027,'RESET',purple)]:
    cylinder('Button recess',(x,y,.0005),r+.005,.003,edge)
    cylinder(label+' button',(x,y,.004),r,.005,mat)
    text(label+' legend',label,(x-.055,y,.002),.009,ink,(0,0,math.pi/2))
cylinder('Indicator bezel',(.278,0,.001),.008,.004,edge)
cylinder('Amber power light',(.278,0,.004),.005,.002,amber)

# Carry handle with a genuine opening, rear connectors and housing screws.
handle_curve=bpy.data.curves.new('Rounded carry handle','CURVE');handle_curve.dimensions='3D'
handle_curve.bevel_depth=.022;handle_curve.bevel_resolution=3
spline=handle_curve.splines.new('POLY');spline.points.add(48)
for i,point in enumerate(spline.points):
    angle=i*math.pi/48
    point.co=(-.327-.14*math.sin(angle),.24*math.cos(angle),-.045,1)
handle=bpy.data.objects.new('Rounded carry handle',handle_curve);bpy.context.collection.objects.link(handle)
finish(handle,'Rounded carry handle',black)
bpy.context.view_layer.objects.active=handle;handle.select_set(True)
bpy.ops.object.convert(target='MESH')
for y in [-.19,.15]:box('Rear connector',(-.329,y,-.34),(.017,.09,.045),black,radius=.004)
text('Rear roof fun brand','fun',(-.23,.27,.002),.023,edge,(0,0,math.pi/2))

# The hinge is BEHIND the disc's bounding cylinder. Open 110 degrees to clear
# the entire vertical insertion path; close only after the disc seats below 0.
lid=bpy.data.objects.new('DiscLid',None);bpy.context.collection.objects.link(lid)
lid.parent=root;lid.location=(-.278,0,.006)
for y in [-.125,.125]:cylinder('Hinge barrel',(-.278,y,.005),.014,.075,purple,axis='Y')
# Broad shaped lid panel: flat rear hinge edge, clipped front corners.
outline=[(-.278,-.275),(.17,-.275),(.245,-.205),(.265,-.10),(.265,.10),(.245,.205),(.17,.275),(-.278,.275)]
lidverts=[(x+.278,y,z) for z in [-.003,.006] for x,y in outline]
n=len(outline)
lidfaces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
lidmesh=bpy.data.meshes.new('Shaped lid mesh');lidmesh.from_pydata(lidverts,[],lidfaces);lidmesh.update()
lidskin=bpy.data.objects.new('Shaped lid outer skin',lidmesh);bpy.context.collection.objects.link(lidskin)
finish(lidskin,'Shaped lid outer skin',purple,lid);bevel(lidskin,.002)
# Buttons belong to the stationary roof; scallop the lid around their seats.
# Boolean cutters are evaluated in world space before the lid opens.
bpy.context.view_layer.update()
for x,y,r in [(-.232,-.285,.039),(.237,-.285,.034),(.237,.285,.033)]:
    cut(lidskin,cylinder('Button clearance cutter',(x,y,.012),r,.05,None,bevel_width=0))
cylinder('Lid inner moulding',(.278,0,-.006),.235,.005,edge,parent=lid)
cylinder('Lid clamp',(.278,0,-.010),.037,.005,rubber,parent=lid)
for angle in [30,90,150,210,270,330]:
    a=math.radians(angle)
    rib=box('Lid reinforcing rib',(.278+.145*math.cos(a),.145*math.sin(a),-.009),(.135,.007,.006),purple,parent=lid,radius=.001)
    rib.rotation_euler.z=a
cylinder('Jewel rim',(.278,0,.009),.173,.002,edge,parent=lid)
cylinder('Dark lid jewel',(.278,0,.011),.17,.002,black,parent=lid)
text('Lid fun badge','fun',(.278,0,.013),.077,ink,(0,0,math.pi/2),parent=lid)
text('Optical disc legend','OPTICAL DISC SYSTEM',(.210,0,.013),.009,ink,(0,0,math.pi/2),parent=lid)
for name,loc in [('DiscSnapAnchor',(0,0,-.029)),('DiscMouthAnchor',(0,0,.34))]:
    obj=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(obj);obj.parent=root;obj.location=loc

# Keep broad moulded panels planar after all boolean cuts. Smooth only the
# curved bevels/cylinder walls; triangulate the boolean ngons before export.
for obj in root.children_recursive:
    if obj.type != 'MESH': continue
    for face in obj.data.polygons:
        face.use_smooth = max(abs(v) for v in face.normal) < .9999
    mod = obj.modifiers.new('Stable boolean triangulation', 'TRIANGULATE')
    mod.keep_custom_normals = True
    apply(obj, mod)

# Validate actual mesh intersections throughout descent and lid closure.
# The proxy matches the browser disc at its final .44 fit scale, including
# the centre hole and label thickness. Keep it in the .blend for inspection.
from mathutils.bvhtree import BVHTree
vertices=[]; faces=[]; segments=96
for z in [-.008*.44, .003*.44]:
    for radius in [.064*.44, .5*.44]:
        vertices += [(radius*math.cos(i*2*math.pi/segments), radius*math.sin(i*2*math.pi/segments), z) for i in range(segments)]
for i in range(segments):
    j=(i+1)%segments
    faces += [(i,j,segments+j,segments+i),
              (2*segments+i,3*segments+i,3*segments+j,2*segments+j),
              (i,2*segments+i,2*segments+j,j),
              (segments+i,segments+j,3*segments+j,3*segments+i)]
mesh=bpy.data.meshes.new('Disc clearance mesh');mesh.from_pydata(vertices,[],faces);mesh.update()
proxy=bpy.data.objects.new('Disc clearance reference',mesh);bpy.context.collection.objects.link(proxy)
proxy.data.materials.append(silver)
def tree(obj):
    return BVHTree.FromPolygons([obj.matrix_world @ v.co for v in obj.data.vertices], [tuple(p.vertices) for p in obj.data.polygons])
static=[o for o in root.children_recursive if o.type=='MESH' and o.parent!=lid]
bpy.context.view_layer.update()
static_trees=[(o.name,tree(o)) for o in static]
for frame in range(201):
    t=frame/200
    proxy.location.z=.671+(-.029-.671)*min(1,t/.7)
    lid.rotation_euler.y=-math.radians(110)*(1-max(0,(t-.7)/.3))
    bpy.context.view_layer.update()
    disc_tree=tree(proxy)
    for name,other in static_trees+[(o.name,tree(o)) for o in lid.children if o.type=='MESH']:
        assert not disc_tree.overlap(other), f'Disc intersects {name} at insertion {t:.3f}'
print('PASS: 201 disc descent/lid closure poses, no mesh intersections')
proxy.location.z=.34
proxy.hide_render=True
proxy.hide_set(True)
lid.rotation_euler.y=0

# Export only the model, keeping the hinge separate and editable.
bpy.ops.object.select_all(action='DESELECT')
for obj in [root,*root.children_recursive]:obj.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.export_scene.gltf(filepath=str(OUT/'fun-gamecube.glb'),export_format='GLB',use_selection=True,export_yup=True)

# An editable, lit .blend with camera and an open lid for inspection.
lid.rotation_euler.y=-math.radians(110)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=48
scene.world.color=(.14,.14,.14)
def area(loc,energy,size):
    bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object
    light.data.energy=energy;light.data.shape='DISK';light.data.size=size
    light.rotation_euler=(Vector((0,0,-.1))-light.location).to_track_quat('-Z','Y').to_euler()
area((1.5,-1,2),110,2);area((-1,1,1),80,1.5)
bpy.ops.object.camera_add(location=(1.25,1.05,.88));camera=bpy.context.object
camera.rotation_euler=(Vector((-.07,0,.03))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=1.65
scene.camera=camera;scene.render.resolution_x=1100;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'fun-gamecube.blend'))
scene.render.filepath=str(PREVIEWS/'fun-gamecube-open.png');bpy.ops.render.render(write_still=True)
lid.rotation_euler.y=0
scene.render.filepath=str(PREVIEWS/'fun-gamecube-closed.png');bpy.ops.render.render(write_still=True)
print('Exported editable console, GLB and inspection renders to',OUT)
