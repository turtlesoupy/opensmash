export const renderWidths = [640, 960, 1280, 1440, 1920];
export function normalizeRenderWidth(value) {
  return renderWidths.includes(value) ? value : 0;
}
/** A physical-pixel budget: DPR must never multiply this a second time. */
export function resolveRenderWidth(value, device = globalThis.navigator) {
  const explicit = normalizeRenderWidth(value);
  if (explicit) return explicit;
  const mobile = /Android|iPhone|iPad|iPod/.test(device?.userAgent || '') ||
    (/Macintosh/.test(device?.userAgent || '') && device?.maxTouchPoints > 1);
  return mobile || (device?.deviceMemory > 0 && device.deviceMemory <= 4) ? 640 : 960;
}
