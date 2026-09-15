import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import consoleUrl from './assets/fun-gamecube.glb?url';

export const GAMECUBE_LID_OPEN = THREE.MathUtils.degToRad(110);

// Disc face is +X, matching the shared cartridge animation contract.
export function createDisc(labelTexture) {
  const root=new THREE.Group(),disc=new THREE.Group();root.add(disc);
  // Ring geometry keeps a real centre hole, including while the disc spins.
  const silver=new THREE.MeshStandardMaterial({color:0xbdbcc8,metalness:.8,roughness:.3,side:THREE.DoubleSide});
  const rim=new THREE.Mesh(new THREE.RingGeometry(.064,.5,96),silver);rim.rotation.y=Math.PI/2;disc.add(rim);
  const back=rim.clone();back.position.x=-.008;disc.add(back);
  const edge=new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,.008,96,1,true),silver);edge.rotation.z=Math.PI/2;edge.position.x=-.004;disc.add(edge);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#24212a';ctx.fillRect(0,0,512,512);
  // The same painted artwork as the cartridge, clipped to a mini-disc label.
  ctx.globalAlpha=.65;ctx.drawImage(labelTexture.image,0,0,512,512);ctx.globalAlpha=1;
  ctx.fillStyle='#22202c';ctx.fillRect(0,35,512,108);ctx.fillRect(0,376,512,85);
  ctx.textAlign='center';ctx.fillStyle='#eee9d8';ctx.font='italic 900 72px Arial';ctx.fillText('fun',256,113);
  ctx.font='900 32px Arial';ctx.fillText('MELEE',256,412);ctx.font='14px monospace';ctx.fillText('SMASH.FUN  •  OPTICAL GAME DISC',256,440);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const face=new THREE.Mesh(new THREE.RingGeometry(.105,.476,96),new THREE.MeshStandardMaterial({map:texture,roughness:.82,side:THREE.DoubleSide}));face.rotation.y=Math.PI/2;face.position.x=.003;disc.add(face);
  root.scale.setScalar(.8);root.userData={homeY:.68,homeScale:.8,baseHomeScale:.8,baseDiameter:.8,isDisc:true};
  return root;
}
export async function createGameCube() {
  const {scene: root} = await new GLTFLoader().loadAsync(consoleUrl);
  const lid = root.getObjectByName('DiscLid');
  root.updateMatrixWorld(true);
  const anchor = name => root.worldToLocal(root.getObjectByName(name).getWorldPosition(new THREE.Vector3()));
  root.userData = {
    snapAnchor: anchor('DiscSnapAnchor'),
    mouthAnchor: anchor('DiscMouthAnchor'),
    lid,
    isGameCube: true,
  };
  lid.rotation.z = GAMECUBE_LID_OPEN;
  root.traverse(object => {
    if (object.isMesh) object.castShadow = object.receiveShadow = true;
  });
  return root;
}
