// Match OpenSmash's selection audio: one voice at a time, never block launch.
let current: HTMLAudioElement | null = null;
export function stopAnnouncer() {
  if (current) {
    current.pause();
    current.currentTime = 0;
    current = null;
  }
}
export function announceCharacter(slug: string) {
  stopAnnouncer();
  const audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.src = '/api/announcer/' + encodeURIComponent(slug);
  current = audio;
  const release = () => { if (current === audio) current = null; };
  audio.addEventListener('ended', release, {once: true});
  void audio.play().catch(release);
}
