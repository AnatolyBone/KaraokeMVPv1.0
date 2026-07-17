import { useSyncExternalStore } from 'react';
import { getAudioTransportSnapshot, subscribeAudioTransport } from '../audioRef';

export function useAudioTransport() {
  return useSyncExternalStore(
    subscribeAudioTransport,
    getAudioTransportSnapshot,
    getAudioTransportSnapshot,
  );
}
