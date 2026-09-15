import schema from '../../runtime/launch-options.json';
export type Fighter = {slug:string;name:string;short:string;target:string;review?:boolean;portrait?:string;imported?:boolean};
export const names:Record<string,string> = Object.fromEntries(schema.targets.map(t=>[t.slug,t.label]));
