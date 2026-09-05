// Resolve once for the whole roster. Keep fallback after a timeout so a late
// download cannot produce a second visible change.
export async function loadCaptionFonts(fonts, timeoutMs = 4000) {
  if (!fonts) return 'fallback';
  let timer;
  try {
    return await Promise.race([
      Promise.all(['Regular', 'Condensed', 'Narrow'].map(async cut => {
        const faces = await fonts.load(`16px "Smash Caption ${cut}"`, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.');
        if (!faces.length) throw new Error('Caption font unavailable');
      })).then(() => 'ready'),
      new Promise(resolve => { timer = setTimeout(() => resolve('fallback'), timeoutMs); }),
    ]);
  } catch {
    return 'fallback';
  } finally {
    clearTimeout(timer);
  }
}
