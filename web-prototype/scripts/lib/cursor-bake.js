import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCursorRig, GLB_ALIGN } from '../../shared/cursor-rig.js';

// Offline only: preserve the original weld, smoothing, transform and skin weights.
export function bakeCursorGeometry(sourceGeometry) {
  const { rigs, bones, INDEX_REST_Z } = createCursorRig();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  const capsules = [];
  for (const f of rigs) {
    const d = f.def;
    const a1 = f.base.getWorldPosition(new THREE.Vector3());
    const b1 = f.knuckle.getWorldPosition(new THREE.Vector3());
    const b2 = f.knuckle.localToWorld(V(0, d.l2, 0));
    capsules.push({ a: a1, b: b1, r: d.r, bone: bones.indexOf(f.base) });
    capsules.push({ a: b1.clone(), b: b2, r: d.r * (d.name === 'index' ? 0.62 : 0.85), bone: bones.indexOf(f.knuckle) });
  }

  function sdCapsule(p, a, b, r) {
    const pax = p.x - a.x, pay = p.y - a.y, paz = p.z - a.z;
    const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
    const h = Math.max(0, Math.min(1,
      (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
    const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
  }
  function sdEllipsoid(p, cx, cy, cz, rx, ry, rz) {
    const ox = p.x - cx, oy = p.y - cy, oz = p.z - cz;
    const x = ox / rx, y = oy / ry, z = oz / rz;
    const k0 = Math.sqrt(x * x + y * y + z * z);
    const k1 = Math.sqrt(x / rx * (x / rx) + y / ry * (y / ry) + z / rz * (z / rz));
    return k1 > 0 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
  }
  const CUFF_ROT = 0.45, CUFF_C = V(-1.0, -1.35, 0), CUFF_R = 0.8, CUFF_r = 0.45;
  function sdCuffTorus(p) {
    const qx0 = p.x - CUFF_C.x, qy0 = p.y - CUFF_C.y, qz = p.z - CUFF_C.z;
    const c = Math.cos(CUFF_ROT), s = Math.sin(CUFF_ROT);
    const qx = qx0 * c + qy0 * s, qy = -qx0 * s + qy0 * c;
    const lxz = Math.sqrt(qx * qx + qz * qz) - CUFF_R;
    return Math.sqrt(lxz * lxz + qy * qy) - CUFF_r;
  }
  const cuffCapA = V(-1.0, -1.6, 0), cuffCapB = V(-1.0, -1.3, 0);
  function sdRoot(p) {
    return Math.min(
      sdEllipsoid(p, 0, -0.3, 0, 1.9, 1.2, 1.0),
      sdCuffTorus(p),
      sdCapsule(p, cuffCapA, cuffCapB, 0.7));
  }

  let g = sourceGeometry.clone();
  for (const name of ['tangent', 'uv', 'normal', 'uv1', 'uv2', 'color'])
    if (g.getAttribute(name)) g.deleteAttribute(name);
  g = mergeVertices(g, 1e-4);

  // Light Laplacian smoothing — a touch, to match our soft blob style.
  {
    const posAttr = g.getAttribute('position');
    const idx = g.getIndex().array;
    const n = posAttr.count;
    const pts = posAttr.array;
    const neighbors = Array.from({ length: n }, () => new Set());
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      neighbors[a].add(b).add(c); neighbors[b].add(a).add(c); neighbors[c].add(a).add(b);
    }
    for (let iter = 0; iter < 2; iter++) {
      const next = pts.slice();
      for (let vi = 0; vi < n; vi++) {
        let sx = 0, sy = 0, sz = 0;
        const nb = neighbors[vi];
        for (const nn of nb) { sx += pts[nn * 3]; sy += pts[nn * 3 + 1]; sz += pts[nn * 3 + 2]; }
        const inv = 1 / nb.size, L = 0.45;
        next[vi * 3]     += (sx * inv - pts[vi * 3]) * L;
        next[vi * 3 + 1] += (sy * inv - pts[vi * 3 + 1]) * L;
        next[vi * 3 + 2] += (sz * inv - pts[vi * 3 + 2]) * L;
      }
      pts.set(next);
    }
    posAttr.needsUpdate = true;
  }

  {
    const A = GLB_ALIGN;
    const g2 = g.clone();
    const m = new THREE.Matrix4()
      .makeTranslation(A.offX, A.offY, A.offZ)
      .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(A.rotX, A.rotY, A.rotZ)))
      .multiply(new THREE.Matrix4().makeScale(A.scale, A.scale, A.scale));
    g2.applyMatrix4(m);
    g2.computeVertexNormals();

    // Distance-skin to our bones with capsule weighting.
    const posAttr = g2.getAttribute('position');
    const n = posAttr.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const p = new THREE.Vector3();
    const dists = new Array(bones.length);
    for (let vi = 0; vi < n; vi++) {
      p.fromBufferAttribute(posAttr, vi);
      dists.fill(Infinity);
      dists[0] = sdRoot(p);
      for (const c of capsules) {
        const d = sdCapsule(p, c.a, c.b, c.r);
        if (d < dists[c.bone]) dists[c.bone] = d;
      }
      const scored = dists.map((d, bi) => ({ bi, w: Math.pow(Math.max(d + 0.05, 0.01), -4) }));
      scored.sort((a, b) => b.w - a.w);
      let total = 0;
      for (let k = 0; k < 4; k++) total += scored[k].w;
      for (let k = 0; k < 4; k++) {
        si[vi * 4 + k] = scored[k].bi;
        sw[vi * 4 + k] = scored[k].w / total;
      }
    }
    g2.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g2.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));

    g2.computeBoundingBox();
    const dirX = Math.sin(-INDEX_REST_Z), dirY = Math.cos(INDEX_REST_Z);
    let pointerTipIndex = 0, bestScore = -Infinity;
    for (let vi = 0; vi < n; vi++) {
      const score = posAttr.getX(vi) * dirX + posAttr.getY(vi) * dirY;
      if (score > bestScore) { bestScore = score; pointerTipIndex = vi; }
    }
    g2.userData = { pointerTipIndex };
    return g2;
  }
}
