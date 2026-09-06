function ascii(bytes, offset, length = 4) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function checkedRange(bytes, offset, length, label) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error(`Truncated fighter bundle (${label})`);
  }
}

function expand5(value) {
  return (value << 3) | (value >> 2);
}

export function decodeRgba16(bytes, offset, width, height) {
  const pixelCount = width * height;
  checkedRange(bytes, offset, pixelCount * 2, "texture");
  const rgba = new Uint8Array(pixelCount * 4);
  for (let index = 0; index < pixelCount; index += 1) {
    // N64 RGBA16 words remain big-endian inside the otherwise little-endian
    // bundle format.
    const packed = (bytes[offset + index * 2] << 8) | bytes[offset + index * 2 + 1];
    rgba[index * 4] = expand5((packed >> 11) & 31);
    rgba[index * 4 + 1] = expand5((packed >> 6) & 31);
    rgba[index * 4 + 2] = expand5((packed >> 1) & 31);
    rgba[index * 4 + 3] = (packed & 1) ? 255 : 0;
  }
  return rgba;
}

export function parseOsb6Preview(input, requestedFkind) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  checkedRange(bytes, 0, 16, "header");
  if (ascii(bytes, 0) !== "OSB6") throw new Error("Not an OSB6 fighter bundle");

  const textureWidth = view.getUint32(4, true);
  const textureHeight = view.getUint32(8, true);
  const targetCount = view.getUint32(12, true);
  if (!textureWidth || !textureHeight || textureWidth > 4096 || textureHeight > 4096 || targetCount > 64) {
    throw new Error("Invalid fighter bundle header");
  }
  const textureOffset = 16;
  const textureBytes = textureWidth * textureHeight * 2;
  checkedRange(bytes, textureOffset, textureBytes, "texture");

  let offset = textureOffset + textureBytes;
  let selected = null;
  let first = null;
  for (let index = 0; index < targetCount; index += 1) {
    checkedRange(bytes, offset, 8, "target header");
    const fkind = view.getUint32(offset, true);
    const length = view.getUint32(offset + 4, true);
    offset += 8;
    checkedRange(bytes, offset, length, "target payload");
    const target = { fkind, offset, length };
    first ||= target;
    if (fkind === requestedFkind) selected = target;
    offset += length;
  }
  selected ||= first;
  if (!selected) throw new Error("Fighter bundle has no renderable targets");
  if (ascii(bytes, selected.offset) !== "OSB5") throw new Error("Invalid fighter target payload");

  if (selected.length < 24) throw new Error("Truncated fighter bundle (mesh header)");
  const payload = selected.offset;
  checkedRange(bytes, payload, 24, "mesh header");
  const jointCount = view.getUint32(payload + 4, true);
  const vertexCount = view.getUint32(payload + 8, true);
  const triangleCount = view.getUint32(payload + 12, true);
  if (!jointCount || jointCount > 32 || !vertexCount || !triangleCount) {
    throw new Error("Invalid fighter mesh header");
  }

  const vertexOffset = payload + 24 + jointCount * 4;
  const triangleOffset = vertexOffset + vertexCount * 28;
  if (triangleOffset + triangleCount * 8 > payload + selected.length) throw new Error("Truncated fighter bundle (mesh payload)");
  checkedRange(bytes, vertexOffset, vertexCount * 28, "vertices");
  checkedRange(bytes, triangleOffset, triangleCount * 8, "triangles");

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  for (let index = 0; index < vertexCount; index += 1) {
    const at = vertexOffset + index * 28;
    positions[index * 3] = view.getFloat32(at, true);
    positions[index * 3 + 1] = view.getFloat32(at + 4, true);
    positions[index * 3 + 2] = view.getFloat32(at + 8, true);
    uvs[index * 2] = view.getInt16(at + 12, true) / (textureWidth * 32);
    // OSB and glTF texture coordinates both address the uploaded atlas from
    // its first (top) source row. DataTexture intentionally keeps flipY off.
    uvs[index * 2 + 1] = view.getInt16(at + 14, true) / (textureHeight * 32);
    normals[index * 3] = view.getInt8(at + 24) / 127;
    normals[index * 3 + 1] = view.getInt8(at + 25) / 127;
    normals[index * 3 + 2] = view.getInt8(at + 26) / 127;
  }

  const IndexArray = vertexCount > 65_535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(triangleCount * 3);
  for (let index = 0; index < triangleCount; index += 1) {
    const at = triangleOffset + index * 8;
    indices[index * 3] = view.getUint16(at, true);
    indices[index * 3 + 1] = view.getUint16(at + 2, true);
    indices[index * 3 + 2] = view.getUint16(at + 4, true);
  }

  if (positions.some(value => !Number.isFinite(value))) throw new Error("Invalid fighter vertex position");
  if (indices.some(index => index >= vertexCount)) throw new Error("Invalid fighter triangle index");

  return {
    fkind: selected.fkind,
    indices,
    normals,
    positions,
    rgba: decodeRgba16(bytes, textureOffset, textureWidth, textureHeight),
    textureHeight,
    textureWidth,
    uvs,
  };
}
