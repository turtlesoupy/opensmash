// Standalone development keeps its old endpoints; the shared launcher uses a namespace.
export const meleePath = (path:string) => typeof location !== 'undefined' && /^\/melee(?:\/|$)/.test(location.pathname)
  && /^\/(?:api|engine)\//.test(path) ? '/melee' + path : path;
