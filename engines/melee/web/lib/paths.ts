// Standalone development keeps its old endpoints; the shared launcher uses a namespace.
// On the hosted site the shell publishes the Melee build id (the input manifest
// hash), and engine files are addressed under /melee/engine/v/<build>/ so the
// browser and CDN can cache them as immutable.
declare global { interface Window { __OPENSMASH_INITIAL_STATE__?: { meleeBuild?: string } } }
const hosted = () => typeof location !== 'undefined' && /^\/melee(?:\/|$)/.test(location.pathname);
export const meleeBuild = (): string => {
  const id = typeof window !== 'undefined' ? window.__OPENSMASH_INITIAL_STATE__?.meleeBuild : undefined;
  return typeof id === 'string' && /^[a-f0-9]{16}$/.test(id) ? id : '';
};
export const meleePath = (path:string) => {
  if (!hosted() || !/^\/(?:api|engine)\//.test(path)) return path;
  const build = meleeBuild();
  return build && path.startsWith('/engine/') ? '/melee/engine/v/' + build + path.slice('/engine'.length) : '/melee' + path;
};
