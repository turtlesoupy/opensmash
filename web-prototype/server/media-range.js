// Single byte ranges cover Safari's media probes and seeking. Ignore malformed
// or multi-range requests (serve 200); reject valid but unsatisfiable ranges.
export function mediaRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match || (!match[1] && !match[2])) return null;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
  if (!size) return { unsatisfiable: true };
  if (!match[1]) {
    if (!last) return { unsatisfiable: true };
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (match[2] && last < first) return null;
  if (first >= size) return { unsatisfiable: true };
  return { start: first, end: match[2] ? Math.min(last, size - 1) : size - 1 };
}
