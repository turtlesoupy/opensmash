// Shared controls for the hosted trailer and demo hotkeys.
export function controlEmbeddedTrailer(player, command, args = []) {
  if (!player) return;
  // Leave native controls available when the browser blocks autoplay.
  if (command === "playVideo") player.play()?.catch(() => {});
  else if (command === "pauseVideo") player.pause();
  else if (command === "mute") player.muted = true;
  else if (command === "unMute") player.muted = false;
  else if (command === "seekTo") player.currentTime = args[0];
}
