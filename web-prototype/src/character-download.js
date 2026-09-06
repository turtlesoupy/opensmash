import { objFilename, osb6ToObj } from "../shared/osb6-obj.js";

export async function texturePng({ rgba, textureWidth, textureHeight }) {
  const canvas = document.createElement("canvas");
  canvas.width = textureWidth; canvas.height = textureHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not create the texture image.");
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), textureWidth, textureHeight), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not encode the texture image.")), "image/png"));
}

export async function objArchive(bytes, options, encodePng = texturePng) {
  const result = osb6ToObj(bytes, options);
  const { ZipWriter, BlobWriter, BlobReader, TextReader } = await import("@zip.js/zip.js");
  const texture = await encodePng(result.mesh);
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  try {
    await writer.add(`${result.filename}.obj`, new TextReader(result.obj));
    await writer.add(`${result.filename}.mtl`, new TextReader(result.mtl));
    await writer.add(`${result.filename}.png`, new BlobReader(texture));
    await writer.add("README.txt", new TextReader("Extract all files into one folder, then import the OBJ into your 3D editor. Keep the MTL and PNG beside it.\n\nThis is a static bind-pose mesh with its texture. OBJ does not contain the character's skeleton, animations, announcer, or game settings. Use OSB6 to play with the character in OpenSmash.\n"));
    return { blob: await writer.close(), filename: `${result.filename}-obj.zip` };
  } catch (error) {
    await writer.close().catch(() => {});
    throw error;
  }
}

export async function characterDownload(url, format, options, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Could not download this character. Please try again.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError");
  if (format === "obj") return objArchive(bytes, options);
  if (String.fromCharCode(...bytes.subarray(0,4)) !== "OSB6") throw new Error("The download is not an OSB6 character bundle.");
  return { blob: new Blob([bytes], { type: "application/octet-stream" }), filename: `${objFilename(options.name)}.osb6` };
}

export function saveDownload({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  // Allow slower browsers to begin consuming the file before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
