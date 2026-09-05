// Self-contained local-build import. A URL fragment never reaches the web server.
// It contains only this fighter's asset links, never session cookies or job data.
export function characterBuildLink(character, origin) {
  if (!character?.slug || !character.bundleUrl) throw new Error("This fighter is not ready to export.");
  const record = {};
  for (const key of ["slug", "name", "short", "base", "fkind", "variants"]) {
    if (character[key] !== undefined) record[key] = character[key];
  }
  for (const key of ["bundleUrl", "uiUrl", "voiceUrl", "portrait"]) {
    if (!character[key]) continue;
    const asset = new URL(character[key], origin);
    if (!["http:", "https:"].includes(asset.protocol) || asset.username || asset.password) {
      throw new Error("Unsupported fighter asset URL.");
    }
    record[key] = asset.href;
  }
  const url = new URL("/", origin);
  url.hash = new URLSearchParams({ "opensmash-character": JSON.stringify(record) }).toString();
  return url.href;
}
