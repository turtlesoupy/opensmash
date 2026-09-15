"""Embedded glTF 2 skin reader; no dependence on the SSB64 converter."""
import io
import json
import struct
from pathlib import Path
import numpy as np
from PIL import Image


class GLB:
    def __init__(self, path):
        raw = Path(path).read_bytes()
        if len(raw) < 20 or struct.unpack_from('<III', raw) != (0x46546c67, 2, len(raw)):
            raise ValueError('Invalid GLB 2 header')
        chunks, pos = {}, 12
        while pos < len(raw):
            if pos + 8 > len(raw):
                raise ValueError('Truncated GLB chunk header')
            size, kind = struct.unpack_from('<II', raw, pos)
            if size % 4 or pos + 8 + size > len(raw) or kind in chunks:
                raise ValueError('Invalid GLB chunk')
            chunks[kind] = raw[pos + 8:pos + 8 + size]
            pos += 8 + size
        self.g = json.loads(chunks[0x4e4f534a])
        self.bin = chunks[0x004e4942]
        if self.g.get('extensionsRequired'):
            raise ValueError('Required glTF extensions unsupported')
        self.world = {}
        self.parents = {}
        for i, node in enumerate(self.g['nodes']):
            for child in node.get('children', []):
                if child in self.parents:
                    raise ValueError('Multiple glTF parents')
                self.parents[child] = i
        pending = [(i, np.eye(4)) for i in range(len(self.g['nodes'])) if i not in self.parents]
        while pending:
            i, parent = pending.pop()
            node = self.g['nodes'][i]
            if i in self.world:
                raise ValueError('Cyclic glTF scene')
            if 'matrix' in node:
                m = np.array(node['matrix']).reshape(4, 4).T
            else:
                q = np.array(node.get('rotation', [0, 0, 0, 1]), dtype=float)
                if np.linalg.norm(q) < 1e-8:
                    raise ValueError('Zero quaternion')
                x, y, z, w = q / np.linalg.norm(q)
                m = np.eye(4)
                m[:3, :3] = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                    [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                    [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]) @ np.diag(node.get('scale', [1, 1, 1]))
                m[:3, 3] = node.get('translation', [0, 0, 0])
            if not np.isfinite(m).all():
                raise ValueError('Non-finite node transform')
            self.world[i] = parent @ m
            pending.extend((c, self.world[i]) for c in node.get('children', []))
        if len(self.world) != len(self.g['nodes']):
            raise ValueError('Cyclic glTF scene')

    def view(self, index):
        v = self.g['bufferViews'][index]
        if v.get('buffer', 0) != 0:
            raise ValueError('External buffers unsupported')
        start, size = v.get('byteOffset', 0), v['byteLength']
        if start < 0 or size < 0 or start + size > len(self.bin):
            raise ValueError('Invalid buffer view')
        return self.bin[start:start + size]

    def accessor(self, index):
        a = self.g['accessors'][index]
        if 'sparse' in a or 'bufferView' not in a:
            raise ValueError('Sparse/accessor without buffer view unsupported')
        types = {5120:'i1', 5121:'u1', 5122:'<i2', 5123:'<u2', 5125:'<u4', 5126:'<f4'}
        widths = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4, 'MAT4':16}
        dtype, width = np.dtype(types[a['componentType']]), widths[a['type']]
        v = self.g['bufferViews'][a['bufferView']]
        data = self.view(a['bufferView'])
        stride, offset, count = v.get('byteStride', dtype.itemsize * width), a.get('byteOffset', 0), a['count']
        if count < 1 or stride < width * dtype.itemsize or offset < 0 or offset + (count-1)*stride + width*dtype.itemsize > len(data):
            raise ValueError('Invalid accessor bounds/stride')
        result = np.ndarray((count, width), dtype=dtype, buffer=data, offset=offset,
                            strides=(stride, dtype.itemsize)).copy()
        if a.get('normalized'):
            if dtype.kind not in 'iu':
                raise ValueError('Invalid normalized float accessor')
            result = result.astype(float) / np.iinfo(dtype).max
            result = np.maximum(result, -1)
        if not np.isfinite(result).all():
            raise ValueError('Non-finite accessor')
        return result

    def mesh(self):
        nodes = [(i, n) for i, n in enumerate(self.g['nodes']) if 'mesh' in n]
        if len(nodes) != 1 or 'skin' not in nodes[0][1]:
            raise ValueError('Expected one skinned mesh node; combine meshes before export')
        mesh_index, node = nodes[0]
        primitives = self.g['meshes'][node['mesh']]['primitives']
        if len(primitives) != 1:
            raise ValueError('Expected one primitive/material; atlas before export')
        p = primitives[0]
        if p.get('mode', 4) != 4 or p.get('targets') or 'JOINTS_1' in p['attributes']:
            raise ValueError('Expected triangles, no morph targets, at most four influences')
        attr = p['attributes']
        arrays = {k:self.accessor(attr[k]) for k in ('POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0')}
        count = len(arrays['POSITION'])
        if any(len(v) != count for v in arrays.values()):
            raise ValueError('Inconsistent vertex attribute lengths')
        for name, width in [('POSITION',3),('NORMAL',3),('TEXCOORD_0',2),('JOINTS_0',4),('WEIGHTS_0',4)]:
            if arrays[name].shape[1] != width:
                raise ValueError('Invalid attribute dimensions')
        indices = self.accessor(p['indices']).reshape(-1) if 'indices' in p else np.arange(count)
        if indices.dtype.kind not in 'iu' or len(indices) % 3 or np.any(indices >= count):
            raise ValueError('Invalid triangle indices')
        skin = self.g['skins'][node['skin']]
        joint_ids = skin['joints']
        names = [self.g['nodes'][j].get('name', f'node_{j}') for j in joint_ids]
        if len(set(names)) != len(names):
            raise ValueError('Duplicate joint names')
        ji, weights = arrays['JOINTS_0'], arrays['WEIGHTS_0'].astype(float)
        if ji.dtype.kind not in 'iu' or np.any(ji >= len(names)) or np.any(weights < 0) or np.any(weights.sum(axis=1) <= 0):
            raise ValueError('Invalid skin weights or joint indices')
        weights /= weights.sum(axis=1, keepdims=True)
        if 'inverseBindMatrices' not in skin:
            raise ValueError('Explicit inverse bind matrices required')
        ibms = self.accessor(skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
        if len(ibms) != len(names):
            raise ValueError('Inverse bind matrix count mismatch')
        # glTF inverse binds map mesh vertices directly into joint bind space.
        try:
            bind = np.linalg.inv(ibms)
        except np.linalg.LinAlgError:
            raise ValueError('Singular glTF inverse bind matrix') from None
        material = self.g['materials'][p['material']]
        if material.get('alphaMode','OPAQUE') != 'OPAQUE':
            raise ValueError('Transparent materials require a separate rendering path')
        pbr = material.get('pbrMetallicRoughness', {})
        tex = pbr.get('baseColorTexture')
        if not tex or tex.get('texCoord',0) or tex.get('extensions'):
            raise ValueError('Embedded base-color texture on TEXCOORD_0 required')
        image = self.g['images'][self.g['textures'][tex['index']]['source']]
        im = Image.open(io.BytesIO(self.view(image['bufferView']))).convert('RGBA')
        factor = np.array(pbr.get('baseColorFactor', [1,1,1,1]))
        if factor.shape != (4,) or not np.isfinite(factor).all() or np.any(factor < 0) or np.any(factor > 1):
            raise ValueError('Invalid base color factor')
        im = Image.fromarray(np.rint(np.array(im)*factor).astype('uint8'))
        return dict(positions=arrays['POSITION'].astype(float), normals=arrays['NORMAL'].astype(float),
                    uv=arrays['TEXCOORD_0'].astype(float), joints=ji, weights=weights,
                    triangles=indices.astype(int).reshape(-1,3), names=names, bind=bind, image=im,
                    mesh_world=self.world[mesh_index])
