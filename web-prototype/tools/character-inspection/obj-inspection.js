import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
const scene=new THREE.Scene();scene.background=new THREE.Color('#22262e');
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);document.body.append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.1,10000);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
scene.add(new THREE.HemisphereLight(0xffffff,0x647080,2.1));
const key=new THREE.DirectionalLight(0xffffff,2.3);key.position.set(3,6,8);scene.add(key);
let home;
const manager=new THREE.LoadingManager();let filesReady;const ready=new Promise(resolve=>filesReady=resolve);manager.onLoad=()=>filesReady();manager.onError=url=>{document.getElementById('status').textContent='Could not load '+url;};
try {
 const materials=await new MTLLoader(manager).setPath('/tools/character-inspection/assets/').loadAsync('thomasdimson.mtl');materials.preload();
 const object=await new OBJLoader(manager).setMaterials(materials).setPath('/tools/character-inspection/assets/').loadAsync('thomasdimson.obj');
 await ready;
 const bounds=new THREE.Box3().setFromObject(object),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
 // Center the whole object without modifying the exported vertices or UVs.
 object.position.sub(center);scene.add(object);
 const distance=Math.max(size.y,size.x/camera.aspect)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.35;
 home=new THREE.Vector3(distance*.8,size.y*.06,distance*.6);camera.position.copy(home);camera.near=distance/1000;camera.far=distance*20;camera.updateProjectionMatrix();controls.target.set(0,0,0);controls.update();
 let triangles=0;const mats=new Set();object.traverse(child=>{if(child.isMesh){triangles+=(child.geometry.index?.count||child.geometry.attributes.position.count)/3;for(const m of (Array.isArray(child.material)?child.material:[child.material]))mats.add(m);}});
 const wire=document.getElementById('wire');wire.disabled=false;wire.onclick=()=>{const enabled=!([...mats][0].wireframe);for(const m of mats)m.wireframe=enabled;wire.textContent=enabled?'Show texture':'Show wireframe';};
 const reset=document.getElementById('reset');reset.disabled=false;reset.onclick=()=>{camera.position.copy(home);controls.target.set(0,0,0);controls.update();};
 document.getElementById('status').textContent=`${triangles.toLocaleString()} triangles · Loaded directly from thomasdimson-obj.zip · Texture loaded`;
 document.title='Thomas — Exported OBJ ready';
} catch(error){document.getElementById('status').textContent=error.message;document.title='OBJ loading failed';}
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
