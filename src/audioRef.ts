export const audioRef = {
  current: null as HTMLAudioElement | null,
};

export function getAudioCurrentTime(): number {
  return audioRef.current ? audioRef.current.currentTime : 0;
}

export function seekAudio(seconds: number): void {
  if (audioRef.current) {
    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime + seconds);
  }
}

export function toggleAudioPlay(): void {
  if (audioRef.current) {
    if (audioRef.current.paused) {
      audioRef.current.play().catch((err) => console.warn('Audio play failed:', err));
    } else {
      audioRef.current.pause();
    }
  }
}
