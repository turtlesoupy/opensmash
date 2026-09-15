export type TouchPad={buttons:number;x:number;y:number;cx:number;cy:number;main:boolean;c:boolean;active:boolean};
export const neutralTouchPad=():TouchPad=>({buttons:0,x:0,y:0,cx:0,cy:0,main:false,c:false,active:false});
/** Radial dead zone, circular gate, native GameCube range. Screen Y points down. */
export function stickVector(dx:number,dy:number,radius:number){
 if(!Number.isFinite(dx+dy+radius)||radius<=0)return {x:0,y:0};
 const distance=Math.hypot(dx,dy),strength=Math.min(1,Math.max(0,(distance/radius-.16)/.84));
 return distance?{x:(Math.round(dx/distance*strength*100)||0),y:(Math.round(-dy/distance*strength*100)||0)}:{x:0,y:0};
}
