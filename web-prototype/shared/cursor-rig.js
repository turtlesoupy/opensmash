import * as THREE from 'three';

export const GLB_ALIGN = {
  scale: 2.4,
  rotX: 0, rotY: 0, rotZ: -0.55,
  offX: 0, offY: 0, offZ: 0,
  tweak: { thumb: 2.2, middle: 0.2, ring: 0.15, pinky: 0.1 },
};

// Shared by the asset baker and live animation so bone order and bind pose agree.
export function createCursorRig() {
  const fingerDefs = [
    { x: -1.15, y: 0.35, z: -0.1,  r: 0.34, l1: 0.55, l2: 0.45, curl: 1.0, name: 'pinky'  },
    { x: -0.55, y: 0.45, z: -0.05, r: 0.36, l1: 0.6,  l2: 0.5,  curl: 1.0, name: 'ring'   },
    { x:  0.05, y: 0.5,  z: 0,     r: 0.38, l1: 0.65, l2: 0.5,  curl: 1.0, name: 'middle' },
    { x:  0.7,  y: 0.55, z: 0.1,   r: 0.36, l1: 0.9,  l2: 0.65, curl: 0.0, name: 'index'  },
  ];
  const INDEX_REST_Z = -0.95;   // index lean (rad clockwise from vertical)

  const rootBone = new THREE.Bone();           // palm + cuff
  const bones = [rootBone];
  const rigs = [];
  for (const d of fingerDefs) {
    const base = new THREE.Bone();
    base.position.set(d.x, d.y, d.z);
    const knuckle = new THREE.Bone();
    knuckle.position.set(0, d.l1, 0);
    base.add(knuckle);
    rootBone.add(base);
    bones.push(base, knuckle);
    rigs.push({ def: d, base, knuckle, jig: { a: 0, v: 0, phase: Math.random() * Math.PI * 2 } });
  }
  const thumbDef = { r: 0.3, l1: 0.6, l2: 0.45, curl: 0, name: 'thumb' };
  {
    const base = new THREE.Bone();
    base.position.set(0.25, 0.75, -0.2);
    const knuckle = new THREE.Bone();
    knuckle.position.set(0, thumbDef.l1, 0);
    base.add(knuckle);
    rootBone.add(base);
    bones.push(base, knuckle);
    rigs.push({ def: thumbDef, base, knuckle, jig: { a: 0, v: 0, phase: Math.random() * Math.PI * 2 } });
  }

  // Extra curl applied on top of the rest pose (tucks the GLB's authored
  // up-thumb etc.; zeroed while binding so it acts as a live delta).
  const poseTweak = { pinky: 0, ring: 0, middle: 0, thumb: 0 };

  // Grip (closed-fist) parameters, tuned against assets/hand_grab.png with the
  // capture/compare loop — an orientation sweep plus per-joint refinement.
  const GRIP = {
    indexCurl: 1.25, indexKnuckle: 1.25, indexZ: -0.10,
    fistTighten: 0.22,
    thumbX: -1.15, thumbY: 0.15, thumbZ: -1.15, thumbKnuckle: 0.55,
    scale: 0.90,
  };

  // Default-pose scale, tuned the same way against assets/hand_point.png.
  const POINT = { scale: 1.00 };

  // Pose the skeleton across three poses that share one rig:
  //   tap  0..1  the click gesture — whole-hand tilt into the page, fingers
  //              barely move (this is what pointerdown drives)
  //   grip 0..1  a real closed fist matching the game's grab sprite, available
  //              via setGrip() for pick-up style interactions
  function poseFingers(tap, grip) {
    grip = grip || 0;
    for (const f of rigs) {
      const d = f.def, jig = f.jig;
      if (d.name === 'thumb') {
        // rest = the GLB's authored up-thumb (bind capsule lies along it);
        // poseTweak.thumb is the live fold that tucks it against the fist
        const x = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.35, -0.3, tap), GRIP.thumbX, grip);
        const y = THREE.MathUtils.lerp(0, GRIP.thumbY, grip);
        const z = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.05, -0.02, tap), GRIP.thumbZ, grip);
        f.base.rotation.set(x + poseTweak.thumb + jig.a * 0.5, y, z);
        f.knuckle.rotation.x =
          THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.1, 0.15, tap), GRIP.thumbKnuckle, grip)
          + poseTweak.thumb * 0.25 + jig.a;
      } else if (d.name === 'index') {
        // tap: a whisper of compression. grip: folds down into the fist
        // (negative X is inward on this rig; positive splays the tip out).
        const tapCurl = THREE.MathUtils.lerp(0, 0.18, tap);
        f.base.rotation.x = THREE.MathUtils.lerp(tapCurl * 1.15, -GRIP.indexCurl, grip) + jig.a;
        f.base.rotation.z = THREE.MathUtils.lerp(
          THREE.MathUtils.lerp(INDEX_REST_Z, INDEX_REST_Z - 0.08, tap), GRIP.indexZ, grip);
        f.knuckle.rotation.x =
          THREE.MathUtils.lerp(tapCurl * 1.35, -GRIP.indexCurl * GRIP.indexKnuckle, grip);
      } else {
        const curl = THREE.MathUtils.lerp(1.05, 1.07, tap) + GRIP.fistTighten * grip
                   + jig.a + poseTweak[d.name];
        f.base.rotation.x = curl * 1.15;
        f.knuckle.rotation.x = curl * 1.35;
      }
    }
  }
  poseFingers(0, 0);
  rootBone.updateMatrixWorld(true);

  return { rootBone, bones, rigs, poseTweak, poseFingers, GRIP, POINT, INDEX_REST_Z };
}
