"""Measured target stature and explicitly inspected costume attachments."""
import numpy as np

# Original GALE01 neutral costume joint indices. Keep DObj lists and visibility
# tables intact: alternate sword/shield states remain controlled by Melee.
ATTACHMENTS = {'link': [25, 26, 67, 69, 70, 71], 'marth': [19, 75, 76]}
VERSION = 1


def stature(mesh, original_positions):
    low, high = np.min(mesh['positions'][:, 1]), np.max(mesh['positions'][:, 1])
    target_low, target_high = np.min(original_positions[:, 1]), np.max(original_positions[:, 1])
    scale = float((target_high - target_low) / (high - low))
    if not np.isfinite(scale) or not .2 < scale < 3:
        raise ValueError('Target stature outside supported range')
    return dict(scale=scale, offset=float(target_low-scale*low),
                source_height=float(high-low), target_height=float(target_high-target_low),
                version=VERSION)


def attachment_offsets(mesh, skeleton, original_path, fighter, weapon_scale=1.):
    """Fit Link's hand shield and back assembly to the custom surface.

    Measure in each attachment's own bind coordinates, so the correction
    rotates with the original animated hand or stowed-shield joint.
    """
    if fighter != 'link':
        return {}
    from tools.inspect_costume_bounds import inspect
    result = {}
    for index, bones in ((67, [54, 55]), (69, [18, 19, 51, 39, 40])):
        original_bones = list(bones)
        if index == 67:
            for joint in skeleton:
                if joint['parent'] in original_bones and joint['index'] != index:
                    original_bones.append(joint['index'])
        original = inspect(str(original_path), None, tuple(original_bones))[0]
        active = np.array([sum(w for j, w in env if j in bones) > .5
                           for env in mesh['envelopes']])
        custom = mesh['positions'][active]
        inverse = np.array(skeleton[index]['inverse_bind'])
        def outward_surface(points):
            local = (inverse @ np.c_[points, np.ones(len(points))].T).T
            return float(local[:, 2].max() if index == 69 else local[:, 2].min())
        # Shields face local -Z; the scabbard faces local +Z. Preserve clearance; only
        # compensate for the extra thickness of the custom arm or torso.
        difference = outward_surface(custom) - weapon_scale * outward_surface(original)
        offset = max(0., difference) if index == 69 else min(0., difference)
        result[str(index)] = [0., 0., offset]
    return result


def axis_rotation(axis, angle):
    axis = np.asarray(axis, dtype=float)
    axis /= np.linalg.norm(axis)
    x, y, z = axis
    cross = np.array([[0.,-z,y],[z,0.,-x],[-y,x,0.]])
    return np.eye(3) + np.sin(angle)*cross + (1-np.cos(angle))*(cross@cross)


def clearance_rotation(points, anchor, stature_scale, stature_offset, clearance=.25):
    """Smallest outward tilt that clears the ground, preserving the mount."""
    points, anchor = np.asarray(points), np.asarray(anchor)
    relative = points-anchor
    pivot = anchor*stature_scale + np.array([0.,stature_offset,0.])
    if (relative[:,1]+pivot[1]).min() >= clearance:
        return np.eye(3)
    lowest = relative[np.argmin(relative[:,1])]
    axis = np.cross(lowest, [0.,1.,0.])
    if np.linalg.norm(axis) < 1e-8:
        axis = np.array([0.,0.,1.])
    def height(angle):
        return ((axis_rotation(axis,angle)@relative.T).T[:,1]+pivot[1]).min()
    # Find the first clearing bracket, then refine it. This also handles the
    # minimum switching from one vertex to another during the tilt.
    low=0.
    for high in np.linspace(0.,np.pi/2,181)[1:]:
        if height(high) >= clearance:
            for _ in range(40):
                middle=(low+high)/2
                if height(middle) >= clearance: high=middle
                else: low=middle
            return axis_rotation(axis,high)
        low=high
    raise ValueError('Attachment cannot clear the idle floor while preserving its mount')


def attachment_rotations(skeleton, original_path, fighter, fit):
    if fighter != 'marth':
        return {}
    import hashlib, json
    from pathlib import Path
    from .archive import Archive
    from tools.inspect_costume_bounds import rigid_positions
    reference=json.loads((Path(__file__).resolve().parents[1]/'runtime/attachment-poses/marth-idle.json').read_text())
    raw=Path(original_path).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=reference['costumeSha256']:
        raise ValueError('Attachment pose requires the verified original Marth costume')
    archive=Archive(raw)
    poses={int(i):np.array(m) for i,m in reference['joints'].items()}
    result={}
    for anchor_index, children in ((19,[19]),(75,[75,76])):
        points=[]
        for index in children:
            local=rigid_positions(archive,skeleton[index],reference['visibleDObjs'][str(index)])
            points.extend((poses[index]@np.c_[local,np.ones(len(local))].T).T[:,:3])
        pose=poses[anchor_index]
        clearance=max(.25,float(np.asarray(points)[:,1].min())*fit['scale']+fit['offset'])
        rotation=clearance_rotation(points,pose[:3,3],fit['scale'],fit['offset'],clearance)
        local=np.linalg.inv(pose[:3,:3])@rotation@pose[:3,:3]
        result[str(anchor_index)]=local.tolist()
    return result


def attachment_transform(skeleton, fighter, index, profile):
    anchors={'link':{26:25,70:69,71:69},'marth':{76:75}}
    anchor_index=profile.get('attachment_anchors',{}).get(str(index),anchors.get(fighter,{}).get(index,index))
    def bind_matrix(i):
        if skeleton[i]['inverse_bind'] is not None:return np.linalg.inv(skeleton[i]['inverse_bind'])
        # Rigid-only weapon tips may omit an envelope inverse bind. TRS is
        # authoritative here only when every ancestor has unit scale.
        ancestor=i
        while ancestor is not None:
            if not np.allclose(skeleton[ancestor]['scale'],[1,1,1],atol=1e-7,rtol=0):
                raise ValueError('Unbound attachment with scaled ancestry requires HSD matrix capture')
            ancestor=skeleton[ancestor]['parent']
        return np.asarray(skeleton[i]['world'])
    bind=bind_matrix(index)
    anchor=bind_matrix(anchor_index)
    correction=np.eye(4)
    correction[:3,:3]=np.array(profile.get('attachment_rotations',{}).get(str(anchor_index),np.eye(3)))*profile.get('attachment_scale',1.)
    correction[:3,3]=profile.get('attachment_offsets',{}).get(str(anchor_index),[0.,0.,0.])
    return np.linalg.inv(bind)@anchor@correction@np.linalg.inv(anchor)@bind


def transform_rigid_attachment(archive, joint, offset, scale=1., anchor=None, transform=None):
    """Transform rigid positions and normals without mutating shared arrays."""
    anchor = np.zeros(3) if anchor is None else np.asarray(anchor)
    offset = np.asarray(offset) + (1. - scale) * anchor
    if transform is None:
        transform=np.eye(4);transform[:3,:3]*=scale;transform[:3,3]=offset
    normal_transform=np.linalg.inv(transform[:3,:3]).T
    d = joint['dobj']
    while d is not None:
        p = archive.ptr(d + 12)
        while p is not None:
            attrs = []; v = archive.ptr(p + 8)
            while archive.u32(v) != 255:
                attrs.append((v, archive.unpack('4IBBHI', v))); v += 24
            cursor = archive.ptr(p + 16)
            end = cursor + archive.unpack('H', p + 14)[0] * 32
            indices = {9:set(),10:set()}
            index_fields = {9:[],10:[]}
            display_start=cursor
            while cursor < end:
                op = archive.unpack('B', cursor)[0]; cursor += 1
                if op == 0: continue
                if op & 0xf8 not in (0x80, 0x90, 0x98, 0xa0):
                    raise ValueError('Unsupported attachment display command')
                count = archive.unpack('H', cursor)[0]; cursor += 2
                for _ in range(count):
                    for _, (attr, typ, cnt, fmt, frac, pad, stride, array) in attrs:
                        if typ == 0: continue
                        if typ not in (2, 3):
                            raise ValueError('Expected indexed attachment attributes')
                        index = archive.unpack('B' if typ == 2 else 'H', cursor)[0]
                        cursor += 1 if typ == 2 else 2
                        if attr in indices:
                            indices[attr].add(index)
                            index_fields[attr].append((cursor-(1 if typ==2 else 2)-display_start,index,typ))
            display=archive.append(bytes(archive.data[display_start:end]),32)
            archive.pointer(p+16,display)
            # Descriptors can also be shared with other DObjs. Clone the list
            # and preserve all relocation fields before replacing positions.
            start = archive.ptr(p + 8); size = v + 24 - start
            clone = archive.append(bytes(archive.data[start:start + size]))
            for field in list(archive.relocs):
                if start <= field < start + size:
                    archive.pointer(clone + field - start, archive.ptr(field))
            archive.pointer(p + 8, clone)
            for descriptor, (attr, typ, cnt, fmt, frac, pad, stride, array) in attrs:
                if attr not in (9,10): continue
                selected=indices[attr]
                if not selected: continue
                if (attr==9 and (cnt!=1 or fmt!=3)) or (attr==10 and (cnt!=0 or fmt not in (1,3,4))):
                    raise ValueError('Unsupported attachment vector format')
                remap={index:n for n,index in enumerate(sorted(selected))}
                values=np.zeros((len(selected),3),dtype=float)
                for field,index,typ in index_fields[attr]:
                    archive.pack('B' if typ==2 else 'H',display+field,remap[index])
                for index in selected:
                    vector=np.array(archive.unpack({1:'3b',3:'3h',4:'3f'}[fmt],array+index*stride),dtype=float)/(2**frac if fmt!=4 else 1)
                    if attr==9:
                        values[remap[index]]=(transform@np.r_[vector,1.])[:3]
                    else:
                        normal=normal_transform@vector
                        values[remap[index]]=normal/max(np.linalg.norm(normal),1e-12)
                buffer=archive.append(np.asarray(values,dtype='>f4').tobytes(),32)
                target=clone+descriptor-start
                archive.pack('I',target+12,4)
                archive.pack('B',target+16,0)
                archive.pack('H',target+18,12)
                archive.pointer(target+20,buffer)
            p = archive.ptr(p + 4)
        d = archive.ptr(d + 4)
