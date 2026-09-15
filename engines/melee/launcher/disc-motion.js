// Shared by the launcher and the silent inspection tool. Quintic easing keeps
// velocity and acceleration continuous when a disc or lid comes to rest.
export const DISC_DOCK_MS = 4300;
export const DISC_SEATED_MS = 2790;
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t*t*t*(t*(t*6-15)+10); };
export function discDockPose(elapsed) {
  const lift = smooth((elapsed - 1220) / 650);
  const descent = smooth((elapsed - 1920) / 870);
  return {
    height: (.5 + .08 * lift) * (1 - descent),
    spin: Math.PI * 2 * smooth((elapsed - 1220) / 1350),
    lid: 1 - smooth((elapsed - 2890) / 550),
    retreat: smooth((elapsed - 3510) / (DISC_DOCK_MS - 3510)),
  };
}
