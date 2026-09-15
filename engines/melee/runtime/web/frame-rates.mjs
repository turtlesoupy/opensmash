// A renderer can keep presenting while the match is stalled or has ended.
// Report both rates and use the slower one for the gameplay FPS display.
export function frameRates(renderFrames, combatFrames, durationMs) {
  const scale = durationMs > 0 && Number.isFinite(durationMs) ? 1000 / durationMs : 0;
  const renderFps = Math.max(0, renderFrames) * scale;
  const combatFps = Math.max(0, combatFrames) * scale;
  return {renderFps, combatFps, fps: Math.min(renderFps, combatFps)};
}
