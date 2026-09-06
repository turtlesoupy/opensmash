import { parseOsb6Preview } from "./osb6-preview.js";

export function objFilename(name = "character") {
  return String(name).normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "character";
}

// OBJ uses a bottom-origin V coordinate. Keep the PNG in the atlas's original
// top-to-bottom row order and flip V exactly once when writing texture coords.
export function osb6ToObj(input, { name, fkind } = {}) {
  const mesh = parseOsb6Preview(input, fkind);
  if (fkind !== undefined && mesh.fkind !== fkind) throw new Error("This bundle does not include the selected fighter target.");
  const filename = objFilename(name);
  const lines = ["# OpenSmash static character mesh (bind pose)", `mtllib ${filename}.mtl`, `o ${filename}`];
  for (let i = 0; i < mesh.positions.length; i += 3) lines.push(`v ${mesh.positions[i]} ${mesh.positions[i+1]} ${mesh.positions[i+2]}`);
  for (let i = 0; i < mesh.uvs.length; i += 2) lines.push(`vt ${mesh.uvs[i]} ${1-mesh.uvs[i+1]}`);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const [x,y,z] = mesh.normals.subarray(i,i+3);
    const length = Math.hypot(x,y,z) || 1;
    lines.push(`vn ${x/length} ${y/length} ${z/length}`);
  }
  lines.push("usemtl character", "s 1");
  for (let i = 0; i < mesh.indices.length; i += 3) {
    lines.push(`f ${Array.from(mesh.indices.subarray(i,i+3), n => `${n+1}/${n+1}/${n+1}`).join(" ")}`);
  }
  return {
    filename, mesh,
    obj: `${lines.join("\n")}\n`,
    mtl: `newmtl character\nKa 1 1 1\nKd 1 1 1\nKs 0 0 0\nd 1\nillum 1\nmap_Kd ${filename}.png\n`,
  };
}
