import { LyricLine, VideoStyleOptions } from '../types';
import { RenderFrame } from './renderer/types';
import { renderBackground } from './renderer/renderBackground';
import { renderParticles } from './renderer/renderParticles';
import { renderVisualizer } from './renderer/renderVisualizer';
import { renderLyrics } from './renderer/renderLyrics';
import { clearTextWidthCache } from './renderer/textCache';

// Импортируем современные оффлайн-муксеры для WebCodecs
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

// @ts-ignore
import ExportWorker from './renderer/export.worker?worker&inline';

// Хелпер для обхода жесткого троттлинга setTimeout в фоновых вкладках браузера.
// MessageChannel не замедляется до 1 секунды при сворачивании окна!
const yieldToMain = () => new Promise<void>(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(null);
});

// Реальный sleep через setTimeout — даёт GPU-кодеку время обработать очередь
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

interface ExportOptions {
  lines: LyricLine[];
  audioElement: HTMLAudioElement;
  audioFileName: string;
  resolution: '720p' | '1080p';
  styleOptions: VideoStyleOptions;
  format: 'webm' | 'mp4';
  coverUrl: string | null;
  coverColors: {
    primary: string;
    secondary: string;
    glow: string;
  } | null;
  audioCtx?: AudioContext;
  signal?: AbortSignal;
  language?: 'ru' | 'en';
  onProgress: (percent: number, secondsRecorded: number) => void;
  onStatus?: (status: 'decoding' | 'initializing' | 'prewarming' | 'encoding' | 'recording') => void;
  onWarning?: (message: string) => void;
  onComplete: (blob: Blob) => void;
  onError: (error: Error) => void;
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  fps?: 30 | 60;
  bitrateKbps?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color?: string;
}

export function exportVideo(options: ExportOptions): void {
  const isWebCodecsSupported = 
    typeof VideoEncoder !== 'undefined' && 
    typeof AudioEncoder !== 'undefined' && 
    typeof AudioData !== 'undefined' && 
    typeof VideoFrame !== 'undefined';

  if (!isWebCodecsSupported) {
    console.warn('Cinema Engine: WebCodecs not supported. Using real-time MediaRecorder.');
    options.onWarning?.(
      options.language === 'ru'
        ? 'Ваш браузер не поддерживает офлайн-кодеки. Используется запись в реальном времени.'
        : 'Your browser does not support offline codecs. Using real-time recording.'
    );
    exportVideoMediaRecorder(options);
    return;
  }

  // Четырехуровневый каскад:
  // Уровень 1: GPU MP4 (H.264) — самый быстрый
  exportVideoWebCodecs(options, 'prefer-hardware').catch((hwErr) => {
    console.warn('Cinema Engine: GPU MP4 encoder failed, trying CPU software encoder...', hwErr.message);
    options.onWarning?.(
      options.language === 'ru'
        ? `Сбой аппаратного MP4: ${hwErr.message}. Пробуем программный MP4...`
        : `GPU MP4 failed: ${hwErr.message}. Trying software MP4...`
    );
    options.onStatus?.('initializing');

    // Уровень 2: CPU-софтвар MP4 (H.264)
    exportVideoWebCodecs(options, 'prefer-software').catch((swErr) => {
      console.warn('Cinema Engine: CPU MP4 encoder also failed.', swErr.message);
      
      // Уровень 3: Если MP4 полностью упал, пробуем офлайн WebM (VP9) на CPU (стабильный софтверный кодек)
      if (options.format === 'mp4') {
        options.onWarning?.(
          options.language === 'ru'
            ? 'Сбой MP4 кодеков. Пробуем офлайн-экспорт в WebM...'
            : 'MP4 codecs failed. Trying offline export in WebM...'
        );
        options.onStatus?.('initializing');
        
        const webmOptions: ExportOptions = {
          ...options,
          format: 'webm',
        };
        
        exportVideoWebCodecs(webmOptions, 'prefer-software').catch((webmErr) => {
          console.warn('Cinema Engine: Offline WebM also failed. Falling back to real-time MediaRecorder.', webmErr.message);
          options.onWarning?.(
            options.language === 'ru'
              ? `Сбой офлайн-кодеков. Переход на запись в реальном времени...`
              : `Offline codecs failed. Falling back to real-time recording...`
          );
          exportVideoMediaRecorder(options);
        });
      } else {
        options.onWarning?.(
          options.language === 'ru'
            ? `Сбой офлайн-кодеков. Переход на запись в реальном времени...`
            : `Offline codecs failed. Falling back to real-time recording...`
        );
        exportVideoMediaRecorder(options);
      }
    });
  });
}

/**
 * Безопасное декодирование аудио (избегаем блокировки UI)
 */
async function decodeAudioSafely(audioArrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const tempCtx = new AudioContextClass();
    
    tempCtx.decodeAudioData(
      audioArrayBuffer,
      (buffer) => {
        tempCtx.close();
        resolve(buffer);
      },
      (error) => {
        tempCtx.close();
        reject(error);
      }
    );
  });
}

/**
 * Безопасное получение аудио буфера из HTMLAudioElement
 */
async function getAudioBuffer(audioElement: HTMLAudioElement): Promise<ArrayBuffer> {
  const audioUrl = audioElement.src;
  
  if (audioUrl.startsWith('blob:') || audioUrl.startsWith('data:')) {
    const response = await fetch(audioUrl);
    const blob = await response.blob();
    return await blob.arrayBuffer();
  } else {
    try {
      const response = await fetch(audioUrl, {
        mode: 'cors',
        credentials: 'same-origin'
      });
      const blob = await response.blob();
      return await blob.arrayBuffer();
    } catch (corsError) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', audioUrl, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => {
          if (xhr.status === 200) {
            resolve(xhr.response);
          } else {
            reject(new Error(`Failed to load audio: ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error loading audio'));
        xhr.send();
      });
    }
  }
}

async function exportVideoWebCodecs(
  options: ExportOptions,
  hwAccel: HardwareAcceleration = 'prefer-hardware'
): Promise<void> {
  const {
    lines,
    audioElement,
    audioFileName,
    resolution,
    styleOptions,
    format,
    coverUrl,
    coverColors,
    signal,
    onProgress,
    onStatus,
    onComplete,
    quality,
  } = options;

  // --- ШАГ 1: БЕЗОПАСНОЕ ДЕКОДИРОВАНИЕ АУДИО ---
  onStatus?.('decoding');
  let audioBuffer: AudioBuffer;
  try {
    const audioArrayBuffer = await getAudioBuffer(audioElement);
    audioBuffer = await decodeAudioSafely(audioArrayBuffer);
  } catch (error: any) {
    throw new Error(`Audio decoding failed: ${error.message}`);
  }

  // Извлекаем каналы аудио (Float32Array)
  const leftChannel = audioBuffer.getChannelData(0);
  const rightChannel = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;

  // --- ШАГ 2: ПОДГОТОВКА ОБЛОЖКИ (ImageBitmap) ---
  let coverBitmap: ImageBitmap | null = null;
  if (coverUrl) {
    const coverCanvasSize = styleOptions.aspectRatio === '9:16' 
      ? (resolution === '1080p' ? 240 : 160) 
      : (resolution === '1080p' ? 120 : 80);
    
    const coverCanvas = document.createElement('canvas');
    coverCanvas.width = coverCanvasSize;
    coverCanvas.height = coverCanvasSize;
    const coverCtx = coverCanvas.getContext('2d');
    
    if (coverCtx) {
      const resolvedCoverUrl = await (async () => {
        if (!coverUrl.startsWith('blob:')) return coverUrl;
        try {
          const resp = await fetch(coverUrl);
          const blob = await resp.blob();
          return await new Promise<string>((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result as string);
            reader.onerror = rej;
            reader.readAsDataURL(blob);
          });
        } catch {
          return coverUrl;
        }
      })();

      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => {
          coverCtx.save();
          coverCtx.beginPath();
          coverCtx.roundRect(0, 0, coverCanvasSize, coverCanvasSize, coverCanvasSize * 0.15);
          coverCtx.clip();
          coverCtx.drawImage(img, 0, 0, coverCanvasSize, coverCanvasSize);
          coverCtx.restore();

          coverCtx.strokeStyle = 'rgba(255,255,255,0.15)';
          coverCtx.lineWidth = 2;
          coverCtx.beginPath();
          coverCtx.roundRect(0, 0, coverCanvasSize, coverCanvasSize, coverCanvasSize * 0.15);
          coverCtx.stroke();
          resolve();
        };
        img.onerror = () => resolve();
        img.src = resolvedCoverUrl;
      });
      
      try {
        coverBitmap = await createImageBitmap(coverCanvas);
      } catch (e) {
        console.warn('Failed to create cover ImageBitmap:', e);
      }
    }
  }

  // --- ШАГ 3: ЗАПУСК WEB WORKER ---
  onStatus?.('initializing');
  const worker = new ExportWorker();

  let isAborted = false;

  if (signal) {
    signal.addEventListener('abort', () => {
      isAborted = true;
      worker.postMessage({ action: 'abort' });
      worker.terminate();
    });
  }

  return new Promise<void>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      if (isAborted) return;
      const { type, percent, seconds, buffer, outputType, message, level } = e.data;
      
      if (type === 'log') {
        if (level === 'info') console.log(`[Worker] ${message}`);
        else if (level === 'warn') console.warn(`[Worker] ${message}`);
        else if (level === 'error') console.error(`[Worker] ${message}`);
      } else if (type === 'progress') {
        onProgress(percent, seconds);
      } else if (type === 'warning') {
        options.onWarning?.(message);
      } else if (type === 'complete') {
        const finalBlob = new Blob([buffer], { type: outputType });
        onComplete(finalBlob);
        worker.terminate();
        resolve();
      } else if (type === 'error') {
        console.error('Web Worker reported error:', message);
        worker.terminate();
        reject(new Error(message || 'Unknown error inside Web Worker'));
      }
    };

    worker.onerror = (err) => {
      console.error('Web Worker runtime/load error:', err);
      worker.terminate();
      reject(err);
    };

    // Подготовка буферов для переноса в Web Worker (transferables)
    const transferables: Transferable[] = [leftChannel.buffer];
    if (rightChannel) {
      transferables.push(rightChannel.buffer);
    }
    if (coverBitmap) {
      transferables.push(coverBitmap);
    }

    const targetFps = options.fps || 30;
    const targetBitrate = options.bitrateKbps || (resolution === '720p' ? 3000 : 6000);

    worker.postMessage({
      action: 'start',
      options: {
        lines,
        resolution,
        styleOptions,
        format,
        coverColors,
        audioFileName,
        quality,
        sampleRate: audioBuffer.sampleRate,
        duration: audioBuffer.duration,
        numChannels: audioBuffer.numberOfChannels,
        fps: targetFps,
        bitrate: targetBitrate,
        hwAccel,
      },
      leftChannel,
      rightChannel,
      coverBitmap
    }, transferables);
  });
}

/**
 * РЕЖИМ Б: Отказоустойчивый экспортер MediaRecorder (Safari/Firefox/Mobile)
 */
function exportVideoMediaRecorder(options: ExportOptions): void {
  const {
    lines,
    audioElement,
    resolution,
    styleOptions,
    format,
    coverUrl,
    coverColors,
    audioCtx,
    signal,
    onProgress,
    onStatus,
    onComplete,
    onError,
    quality,
  } = options;

  const width = resolution === '1080p' ? 1920 : 1280;
  const height = resolution === '1080p' ? 1080 : 720;

  let finalWidth = width;
  let finalHeight = height;
  if (styleOptions.aspectRatio === '9:16') {
    finalWidth = resolution === '1080p' ? 1080 : 720;
    finalHeight = resolution === '1080p' ? 1920 : 1280;
  } else if (styleOptions.aspectRatio === '1:1') {
    finalWidth = resolution === '1080p' ? 1080 : 720;
    finalHeight = resolution === '1080p' ? 1080 : 720;
  }

  const canvas = document.createElement('canvas');
  canvas.width = finalWidth;
  canvas.height = finalHeight;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  if (!ctx) {
    onError(new Error('Failed to get 2D context from canvas'));
    return;
  }

  clearTextWidthCache();

  // Создаем изолированный аудио-элемент для экспорта, чтобы не ломать основной плеер
  const exportAudioElement = document.createElement('audio');
  exportAudioElement.src = audioElement.src;
  exportAudioElement.crossOrigin = 'anonymous';

  let worker: Worker | null = null;
  let workerUrl: string | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let isAborted = false;
  let isFinished = false;
  let activeAudioCtx: AudioContext | null = audioCtx || null;
  let sourceNode: MediaElementAudioSourceNode | null = null;
  let destinationNode: MediaStreamAudioDestinationNode | null = null;

  let bgVideoEl: HTMLVideoElement | null = null;
  if (styleOptions.bgType === 'custom-video' && styleOptions.customVideoUrl) {
    bgVideoEl = document.createElement('video');
    bgVideoEl.src = styleOptions.customVideoUrl;
    bgVideoEl.muted = true;
    bgVideoEl.loop = true;
    bgVideoEl.playsInline = true;
    bgVideoEl.preload = 'auto';
  }

  const coverCanvas = document.createElement('canvas');
  const coverSize = styleOptions.aspectRatio === '9:16' 
    ? (resolution === '1080p' ? 240 : 160) 
    : (resolution === '1080p' ? 120 : 80);
  coverCanvas.width = coverSize;
  coverCanvas.height = coverSize;
  const coverCtx = coverCanvas.getContext('2d');
  let isCoverReady = false;

  let coverImg: HTMLImageElement | null = null;
  if (coverUrl && coverCtx) {
    const img = new Image();
    coverImg = img;
    
    if (coverUrl && !coverUrl.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      if (!coverCtx || !img) return;
      coverCtx.save();
      coverCtx.beginPath();
      coverCtx.roundRect(0, 0, coverSize, coverSize, coverSize * 0.15);
      coverCtx.clip();
      coverCtx.drawImage(img, 0, 0, coverSize, coverSize);
      coverCtx.restore();
      
      coverCtx.strokeStyle = 'rgba(255,255,255,0.15)';
      coverCtx.lineWidth = 2;
      coverCtx.beginPath();
      coverCtx.roundRect(0, 0, coverSize, coverSize, coverSize * 0.15);
      coverCtx.stroke();
      isCoverReady = true;
    };
    img.onerror = () => {
    };
    img.src = coverUrl;
  }

  const particles: Particle[] = [];
  const fxCount = styleOptions.fxOverlay === 'snow' ? 120 : 35;
  for (let i = 0; i < fxCount; i++) {
    if (styleOptions.fxOverlay === 'snow') {
      particles.push({
        x: Math.random() * finalWidth,
        y: Math.random() * finalHeight,
        vx: (Math.random() - 0.3) * 0.7,
        vy: Math.random() * 1.2 + 0.5,
        radius: Math.random() * 2.5 + 1,
        alpha: Math.random() * 0.6 + 0.2,
      });
    } else if (styleOptions.fxOverlay === 'lens-dust') {
      particles.push({
        x: Math.random() * finalWidth,
        y: Math.random() * finalHeight,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        radius: Math.random() * 6 + 2,
        alpha: Math.random() * 0.2 + 0.05,
        color: `rgba(${240 + Math.random() * 15}, ${190 + Math.random() * 20}, 100, `,
      });
    } else {
      particles.push({
        x: Math.random() * finalWidth,
        y: Math.random() * finalHeight,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: Math.random() * (finalWidth * 0.3) + finalWidth * 0.1,
        alpha: Math.random() * 0.12 + 0.04,
        color: i % 2 === 0 ? '#4f46e5' : '#db2777',
      });
    }
  }

  const cleanup = () => {
    if (worker) {
      worker.postMessage({ action: 'stop' });
      worker.terminate();
      worker = null;
    }

    if (workerUrl) {
      URL.revokeObjectURL(workerUrl);
      workerUrl = null;
    }

    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch {}
      sourceNode = null;
    }
    
    if (destinationNode) {
      destinationNode = null;
    }

    exportAudioElement.pause();
    exportAudioElement.src = '';

    if (bgVideoEl) {
      bgVideoEl.pause();
    }

    if (activeAudioCtx && activeAudioCtx.state !== 'closed') {
      activeAudioCtx.close().catch(() => {});
      activeAudioCtx = null;
    }
  };

  const finishRecording = () => {
    if (isFinished || isAborted) return;
    isFinished = true;

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    
    cleanup();
  };

  const cancelCleanup = () => {
    isAborted = true;
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    
    cleanup();
  };

  if (signal) {
    signal.addEventListener('abort', () => {
      cancelCleanup();
    });
  }

  const timedLines = [...lines]
    .filter((line) => line.time !== null)
    .sort((a, b) => (a.time || 0) - (b.time || 0));

  const startMR = async () => {
    onStatus?.('recording');
    try {
      if (!activeAudioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        activeAudioCtx = new AudioContextClass();
      }
      
      if (activeAudioCtx.state === 'suspended') {
        await activeAudioCtx.resume();
      }

      sourceNode = activeAudioCtx.createMediaElementSource(exportAudioElement);
      destinationNode = activeAudioCtx.createMediaStreamDestination();
      
      sourceNode.connect(destinationNode);

      exportAudioElement.muted = false;
      exportAudioElement.volume = 1.0;
      exportAudioElement.currentTime = 0;

      const canvasStream = canvas.captureStream(30);
      const audioStream = destinationNode.stream;

      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioStream.getAudioTracks(),
      ]);

      const targetBitrate = resolution === '720p' ? 2_500_000 : 4_500_000;
      let optionsLocal = { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: targetBitrate };
      let outputType = 'video/webm';

      if (format === 'mp4') {
        const mp4MimeTypes = [
          'video/mp4;codecs=avc1,mp4a',
          'video/mp4;codecs=h264,aac',
          'video/mp4',
        ];
        
        for (const mime of mp4MimeTypes) {
          if (MediaRecorder.isTypeSupported(mime)) {
            optionsLocal = { mimeType: mime, videoBitsPerSecond: targetBitrate };
            outputType = 'video/mp4';
            break;
          }
        }
      } else {
        if (!MediaRecorder.isTypeSupported(optionsLocal.mimeType)) {
          optionsLocal = { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: targetBitrate };
        }
      }

      mediaRecorder = new MediaRecorder(combinedStream, optionsLocal);
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (isAborted) return;

        const blob = new Blob(chunks, { type: outputType });
        onComplete(blob);
      };

      mediaRecorder.onerror = (e: any) => {
        console.error('MediaRecorder error:', e);
        onError(new Error('MediaRecorder failed: ' + e.message));
        cleanup();
      };

      const draw = () => {
        if (isAborted || isFinished) return;
        ctx.imageSmoothingEnabled = true;
        (ctx as any).imageSmoothingQuality = 'high';

        const time = exportAudioElement.currentTime;
        const duration = exportAudioElement.duration || 0;

        onProgress(duration > 0 ? time / duration : 0, time);

        if (exportAudioElement.ended || (duration > 0 && time >= duration - 0.1)) {
          finishRecording();
          return;
        }

        const pulseFactor = 1 + Math.sin(time * 2) * 0.03;

        const fakeFFT = new Uint8Array(64);
        for (let i = 0; i < 64; i++) {
          fakeFFT[i] = Math.round(80 + Math.random() * 40);
        }

        const renderFrame: RenderFrame = {
          time,
          width: finalWidth,
          height: finalHeight,
          pulseFactor,
          fft: fakeFFT,
          styleOptions,
          coverColors,
          coverCanvas,
          coverImg,
          isCoverReady,
          resolution,
          audioFileName: options.audioFileName,
          exportProgress: duration > 0 ? time / duration : 0,
          quality,
        };

        renderBackground(ctx, renderFrame, bgVideoEl);
        renderParticles(ctx, renderFrame);
        renderVisualizer(ctx, renderFrame);
        renderLyrics(ctx, renderFrame, timedLines);
      };

      mediaRecorder.start(100);
      
      const workerCode = `
        let timerId = null;
        self.onmessage = function(e) {
          if (e.data.action === 'start') {
            timerId = setInterval(() => {
              self.postMessage('tick');
            }, e.data.interval);
          } else if (e.data.action === 'stop') {
            if (timerId) {
              clearInterval(timerId);
              timerId = null;
            }
          }
        };
      `;
      const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
      workerUrl = URL.createObjectURL(workerBlob);
      worker = new Worker(workerUrl);

      worker.onmessage = () => {
        draw();
      };

      worker.postMessage({ action: 'start', interval: 1000 / 30 });

      await exportAudioElement.play();

      if (bgVideoEl) {
        await bgVideoEl.play().catch(() => {});
      }

    } catch (err: any) {
      console.error('MediaRecorder setup failed:', err);
      cleanup();
      onError(err);
    }
  };

  startMR();
}
