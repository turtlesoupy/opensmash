export const TRAILER_VIDEO_ID = "Uj3N_CbYMHs";
export const TRAILER_WATCH_URL = `https://youtu.be/${TRAILER_VIDEO_ID}`;

export const TRAILER_EMBED_URL =
  `https://www.youtube-nocookie.com/embed/${TRAILER_VIDEO_ID}` +
  `?autoplay=1&cc_load_policy=0&controls=1&enablejsapi=1&iv_load_policy=3` +
  `&loop=1&mute=1&playlist=${TRAILER_VIDEO_ID}&playsinline=1&rel=0`;

const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";

export function controlEmbeddedTrailer(player, command, args = []) {
  player?.contentWindow?.postMessage(JSON.stringify({
    event: "command",
    func: command,
    args,
  }), YOUTUBE_ORIGIN);
}

export function disableEmbeddedTrailerCaptions(player) {
  controlEmbeddedTrailer(player, "setOption", ["captions", "track", {}]);
  controlEmbeddedTrailer(player, "unloadModule", ["captions"]);
}

/** Ask the player to stream state events (onReady, infoDelivery) to this window. */
export function subscribeEmbeddedTrailer(player) {
  player?.contentWindow?.postMessage(JSON.stringify({
    event: "listening",
    id: player.id || "intro-video",
  }), YOUTUBE_ORIGIN);
}

// YouTube does not opt into COEP. Only credentialless iframes can embed it
// inside the isolated game shell. Other browsers get a normal watch link.
export function canEmbedTrailer(framePrototype = globalThis.HTMLIFrameElement?.prototype) {
  return !!framePrototype && 'credentialless' in framePrototype;
}
