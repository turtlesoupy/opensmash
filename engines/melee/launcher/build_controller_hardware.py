"""Build an editable fun GameCube controller. Run with Blender --background --python."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def mat(name,color,rough=.4):
 m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough
 return m
purple=mat('Indigo molded plastic',(.12,.10,.34)); gray=mat('Warm gray rubber',(.57,.57,.55)); pale=mat('Silver lower shell',(.55,.56,.61)); dark=mat('Socket shadow',(.018,.019,.027)); green=mat('A turquoise',(.015,.53,.37)); red=mat('B red',(.65,.006,.025)); yellow=mat('C stick yellow',(.95,.52,.006)); white=mat('fun lettering',(.85,.85,.83)); blue=mat('Z trigger blue',(.12,.11,.56))
def smooth(obj,m):
 obj.data.materials.append(m)
 if obj.type=='MESH':
  for p in obj.data.polygons:p.use_smooth=True
 return obj
def ball(name,loc,scale,m):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=48,ring_count=24,location=loc);o=bpy.context.object;o.name=name;o.scale=scale
 return smooth(o,m)
def cylinder(name,x,y,z,r,depth,m,vertices=64):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=(x,y,z));o=bpy.context.object;o.name=name
 bevel=o.modifiers.new('Soft molded edges','BEVEL');bevel.width=min(.018,depth*.3);bevel.segments=3
 o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return smooth(o,m)
def text(body,x,y,z,size,m=white):
 bpy.ops.object.text_add(location=(x,y,z));o=bpy.context.object;o.name='Mark '+body;o.data.body=body;o.data.align_x='CENTER';o.data.align_y='CENTER';o.data.size=size;o.data.extrude=.0007;o.data.materials.append(m)
 bpy.ops.object.convert(target='MESH');return bpy.context.object
def outline(name,points,z,depth,bevel,m):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='2D';c.resolution_u=16;c.fill_mode='BOTH';c.extrude=depth/2;c.bevel_depth=bevel;c.bevel_resolution=4
 s=c.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
 for p,xy in zip(s.bezier_points,points):p.co=(*xy,0);p.handle_left_type='AUTO';p.handle_right_type='AUTO'
 s.use_cyclic_u=True;o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.location.z=z;o.data.materials.append(m);return o
# Single continuous silhouette, including the inward waist and long outer grips.
points=[(0,.59),(-.55,.56),(-.89,.40),(-1.01,.05),(-1.08,-.50),(-1.01,-.92),(-.87,-.99),(-.72,-.75),(-.59,-.44),(-.32,-.58),(-.19,-.45),(-.29,-.15),(0,-.08),(.29,-.15),(.19,-.45),(.32,-.58),(.59,-.44),(.72,-.75),(.87,-.99),(1.01,-.92),(1.08,-.50),(1.01,.05),(.89,.40),(.55,.56)]
outline('Lower shell',points,-.075,.11,.07,pale)
outline('Indigo upper shell',points,.035,.13,.075,purple)
# Subtle raised face lobes; grips remain part of the continuous shell.
ball('Left face',(-.57,.09,.135),(.40,.48,.075),purple)
ball('Right face',(.57,.09,.135),(.40,.48,.075),purple)
# Octagonal joystick gates and concentric rubber grip rings.
for name,x,y,r,m in [('Control stick',-.65,.16,.165,gray),('C stick',.36,-.37,.135,yellow)]:
 cylinder(name+' octagonal gate',x,y,.20,r*1.27,.035,dark,8)
 cylinder(name+' stem',x,y,.22,r*.44,.09,dark)
 cylinder(name+' cap',x,y,.265,r,.07,m,8 if name=='C stick' else 64)
 for rad in ([.07,.10,.128] if name=='Control stick' else [.082]):
  bpy.ops.mesh.primitive_torus_add(major_radius=rad,minor_radius=.0035,major_segments=64,minor_segments=8,location=(x,y,.302));smooth(bpy.context.object,m)
 if name=='C stick':text('C',x,y,.305,.08,yellow)
# D-pad cross with rounded molded corners.
x,y=-.37,-.38
cross=[(-.04,.12),(.04,.12),(.04,.04),(.12,.04),(.12,-.04),(.04,-.04),(.04,-.12),(-.04,-.12),(-.04,-.04),(-.12,-.04),(-.12,.04),(-.04,.04)]
def polygon(name,pts,z,depth,m):
 vs=[(a,b,z+d) for d in [-depth/2,depth/2] for a,b in pts];n=len(pts);faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);o.data.materials.append(m);b=o.modifiers.new('Rounded edges','BEVEL');b.width=.014;b.segments=3;o.modifiers.new('Normals','WEIGHTED_NORMAL');return o
polygon('D pad',[(x+a,y+b) for a,b in cross],.205,.07,gray)
for name,x,y,r,m in [('A',.64,.13,.145,green),('B',.40,-.005,.083,red),('Start',0,.13,.046,gray)]:
 cylinder(name+' socket',x,y,.19,r+.012,.035,dark);cylinder(name,x,y,.225,r,.075,m)
 text(name if name!='Start' else '',x,y,.264,r*.75,m)
for name,x,y,sx,sy,angle in [('Y',.59,.365,.13,.065,-.22),('X',.875,.19,.067,.13,.28)]:
 o=ball(name+' button',(x,y,.224),(sx,sy,.053),gray);o.rotation_euler.z=angle;text(name,x,y,.276,.07,white)
for name,x,m in [('L',-.73,gray),('R',.73,gray)]:
 ball(name+' shoulder',(x,.48,.085),(.20,.105,.11),m)
ball('Z shoulder',(.81,.48,.155),(.17,.07,.055),blue)
text('fun',0,.43,.19,.16);text('START / PAUSE',0,.24,.18,.034,purple)
# Flexible cable, going back from the center.
c=bpy.data.curves.new('Cable','CURVE');c.dimensions='3D';c.bevel_depth=.025;c.bevel_resolution=4;s=c.splines.new('BEZIER');s.bezier_points.add(2)
for p,co in zip(s.bezier_points,[(0,.57,0),(0,.72,-.015),(.055,.86,-.03)]):p.co=co;p.handle_left_type=p.handle_right_type='AUTO'
o=bpy.data.objects.new('Cable',c);bpy.context.collection.objects.link(o);o.data.materials.append(dark)
# Convert to portable mesh assets, apply modifiers in glTF export.
bpy.ops.object.select_all(action='SELECT');bpy.context.view_layer.objects.active=bpy.context.selected_objects[0];bpy.ops.object.convert(target='MESH')
ROOT.joinpath('assets').mkdir(exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/fun-gamecube-controller.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'assets/fun-gamecube-controller.glb'),export_format='GLB',export_apply=True)
