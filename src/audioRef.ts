export const audioRef = {
  current: null as HTMLAudioElement | null,
};

export interface AudioTransportSnapshot {
  audio: HTMLAudioElement | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
}

type AudioTransportListener = () => void;

const transportListeners = new Set<AudioTransportListener>();
let transportFrame: number | null = null;
let transportSnapshot: AudioTransportSnapshot = {
  audio: null,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
};

function publishTransportSnapshot(): void {
  const audio = audioRef.current;
  transportSnapshot = {
    audio,
    currentTime: audio?.currentTime || 0,
    duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0,
    isPlaying: Boolean(audio && !audio.paused && !audio.ended),
  };
  transportListeners.forEach((listener) => listener());
}

function stopTransportFrame(): void {
  if (transportFrame !== null) {
    cancelAnimationFrame(transportFrame);
    transportFrame = null;
  }
}

function runTransportFrame(): void {
  stopTransportFrame();
  const tick = () => {
    publishTransportSnapshot();
    if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) {
      transportFrame = requestAnimationFrame(tick);
    } else {
      transportFrame = null;
    }
  };
  transportFrame = requestAnimationFrame(tick);
}

const transportEvents = ['timeupdate', 'durationchange', 'loadedmetadata', 'seeking', 'seeked', 'pause', 'ended'] as const;

function handleTransportEvent(): void {
  publishTransportSnapshot();
}

function handleTransportPlay(): void {
  publishTransportSnapshot();
  runTransportFrame();
}

export function setAudioElement(audio: HTMLAudioElement | null): void {
  if (audioRef.current === audio) return;
  const previous = audioRef.current;
  if (previous) {
    transportEvents.forEach((eventName) => previous.removeEventListener(eventName, handleTransportEvent));
    previous.removeEventListener('play', handleTransportPlay);
  }
  stopTransportFrame();
  audioRef.current = audio;
  if (audio) {
    transportEvents.forEach((eventName) => audio.addEventListener(eventName, handleTransportEvent));
    audio.addEventListener('play', handleTransportPlay);
    if (!audio.paused && !audio.ended) runTransportFrame();
  }
  publishTransportSnapshot();
}

export function subscribeAudioTransport(listener: AudioTransportListener): () => void {
  transportListeners.add(listener);
  return () => transportListeners.delete(listener);
}

export function getAudioTransportSnapshot(): AudioTransportSnapshot {
  return transportSnapshot;
}

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
