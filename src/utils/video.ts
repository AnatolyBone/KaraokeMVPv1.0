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

// Хелпер для обхода жесткого троттлинга setTimeout в фоновых вкладках браузера.
// MessageChannel не замедляется до 1 секунды при сворачивании окна!
const yieldToMain = () => new Promise<void>(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(null);
});

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
  onProgress: (percent: number, secondsRecorded: number) => void;
  onComplete: (blob: Blob) => void;
  onError: (error: Error) => void;
  quality?: 'low' | 'medium' | 'high' | 'ultra';
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

  if (isWebCodecsSupported) {
    console.log('Cinema Engine: WebCodecs offline export mode checking...');
    exportVideoWebCodecs(options).catch((err) => {
      console.warn('Cinema Engine: WebCodecs crashed during initialization. Switching to MediaRecorder fallback.', err);
      exportVideoMediaRecorder(options);
    });
  } else {
    console.warn('Cinema Engine: WebCodecs not fully supported. Falling back to MediaRecorder realtime mode.');
    exportVideoMediaRecorder(options);
  }
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

/**
 * РЕЖИМ А: Высокопроизводительный оффлайн-экспорт WebCodecs + mp4-muxer/webm-muxer (Chrome/Edge)
 */
async function exportVideoWebCodecs(options: ExportOptions): Promise<void> {
  const {
    lines,
    audioElement,
    audioFileName: _audioFileName,
    resolution,
    styleOptions,
    format,
    coverUrl,
    coverColors,
    signal,
    onProgress,
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
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) as CanvasRenderingContext2D;

  if (!ctx) {
    throw new Error('Failed to get 2D context from canvas');
  }

  clearTextWidthCache();

  let isAborted = false;

  if (signal) {
    signal.addEventListener('abort', () => {
      isAborted = true;
    });
  }

  const timedLines = [...lines]
    .filter((line) => line.time !== null)
    .sort((a, b) => (a.time || 0) - (b.time || 0));

  // --- ШАГ 1: БЕЗОПАСНОЕ ДЕКОДИРОВАНИЕ АУДИО ---
  let audioBuffer: AudioBuffer;
  try {
    const audioArrayBuffer = await getAudioBuffer(audioElement);
    audioBuffer = await decodeAudioSafely(audioArrayBuffer);
  } catch (error: any) {
    throw new Error(`Audio decoding failed: ${error.message}`);
  }

  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const numChannels = audioBuffer.numberOfChannels;

  // --- ШАГ 2: ИНИЦИАЛИЗАЦИЯ МУКСЕРА И КОДЕКОВ ---
  let videoEncoder: VideoEncoder | undefined;
  let audioEncoder: AudioEncoder | undefined;
  let muxer: any = null;
  let outputType = '';

  try {
    if (format === 'mp4') {
      muxer = new Mp4Muxer({
        target: new Mp4Target(),
        video: {
          codec: 'avc',
          width: finalWidth,
          height: finalHeight,
        },
        audio: {
          codec: 'aac',
          numberOfChannels: numChannels,
          sampleRate: sampleRate,
        },
        fastStart: 'in-memory',
      });
      outputType = 'video/mp4';
    } else {
      muxer = new WebmMuxer({
        target: new WebmTarget(),
        video: {
          codec: 'V_VP9',
          width: finalWidth,
          height: finalHeight,
        },
        audio: {
          codec: 'A_OPUS',
          numberOfChannels: numChannels,
          sampleRate: sampleRate,
        },
      });
      outputType = 'video/webm';
    }

    videoEncoder = new VideoEncoder({
      output: (chunk, metadata) => {
        if (isAborted || !muxer) return;
        muxer.addVideoChunk(chunk, metadata);
      },
      error: (e) => {
        console.error('VideoEncoder Error:', e);
        onError(e);
      },
    });

    // Для MP4: H.264 поддерживается всегда, добавляем VP9 как запасной
    // Для WebM: VP9 с правильными уровнями (важно: 10=Level1=256x144, 31=Level3.1=1080p, 41=Level4.1=4K)
    const videoCodecsToTry = format === 'mp4' 
      ? ['avc1.640034', 'avc1.640033', 'avc1.4d0033', 'avc1.42e033', 'avc1.4d002a']
      : [
          'vp09.00.41.08', // VP9 Profile 0, Level 4.1, 8-bit — до 2160p
          'vp09.00.31.08', // VP9 Profile 0, Level 3.1, 8-bit — до 1080p@30fps
          'vp09.00.30.08', // VP9 Profile 0, Level 3.0
          'vp09.00.20.08', // VP9 Profile 0, Level 2.0
          'vp8',           // VP8 — старый но надёжный fallback
        ];
    
    let videoConfigured = false;
    for (const codec of videoCodecsToTry) {
      try {
        // Битрейт: для 1080p 3Mbps достаточно для музыкального видео, меньше битрейт = быстрее кодирование
        const targetBitrate = options.resolution === '720p' ? 2_000_000 : 3_000_000;
        const config: VideoEncoderConfig = {
          codec: codec,
          width: finalWidth,
          height: finalHeight,
          bitrate: targetBitrate,
          bitrateMode: 'variable',
          framerate: 30,
          // Очень важно: аппаратное ускорение через VideoToolbox (Mac) / NVENC (Win)
          hardwareAcceleration: 'prefer-hardware',
          // realtime = мгновенное кодирование через аппаратные чипы вместо медленного CPU-quality рендеринга
          latencyMode: 'realtime',
        };

        if (typeof VideoEncoder.isConfigSupported === 'function') {
          const support = await VideoEncoder.isConfigSupported(config);
          if (!support.supported) {
            console.warn(`Codec ${codec} not supported by hardware, trying next...`);
            continue;
          }
          // Покажем полный конфиг чтобы видеть hardwareAcceleration в результате
          console.log(`Codec ${codec} isConfigSupported result:`, JSON.stringify(support.config));
        }

        videoEncoder.configure(config);
        videoConfigured = true;
        console.log(`Cinema Engine: VideoEncoder configured with codec: ${codec}`);
        break;
      } catch (err) {
        console.warn(`Codec ${codec} configuration failed:`, err);
      }
    }

    if (!videoConfigured) {
      throw new Error('No supported video codec found');
    }

    audioEncoder = new AudioEncoder({
      output: (chunk, metadata) => {
        if (isAborted || !muxer) return;
        muxer.addAudioChunk(chunk, metadata);
      },
      error: (e) => {
        console.error('AudioEncoder Error:', e);
        onError(e);
      },
    });

    const audioCodecsToTry = format === 'mp4' ? ['mp4a.40.2', 'opus'] : ['opus'];
    let audioConfigured = false;

    for (const codec of audioCodecsToTry) {
      try {
        const config = {
          codec: codec,
          numberOfChannels: numChannels,
          sampleRate: sampleRate,
          bitrate: 192_000,
        };

        if (typeof AudioEncoder.isConfigSupported === 'function') {
          try {
            const support = await AudioEncoder.isConfigSupported(config);
            if (!support.supported) continue;
          } catch {}
        }

        audioEncoder.configure(config);
        audioConfigured = true;
        console.log(`Cinema Engine: AudioEncoder configured with codec: ${codec}`);
        break;
      } catch (err) {
        console.warn(`Audio codec ${codec} failed:`, err);
      }
    }

    if (!audioConfigured) {
      throw new Error('No supported audio codec found');
    }

    // --- ШАГ 3: ПОДГОТОВКА ВИЗУАЛЬНЫХ ЭЛЕМЕНТОВ ---
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

    const coverCanvas = document.createElement('canvas');
    const coverCanvasSize = styleOptions.aspectRatio === '9:16' 
      ? (resolution === '1080p' ? 240 : 160) 
      : (resolution === '1080p' ? 120 : 80);
    coverCanvas.width = coverCanvasSize;
    coverCanvas.height = coverCanvasSize;
    const coverCtx = coverCanvas.getContext('2d');
    let isCoverReady = false;
    let coverImg: HTMLImageElement | null = null;

    if (coverUrl && coverCtx) {
      // Конвертируем blob: URL в data: URL через Canvas чтобы избежать проблем
      // с отозванными blob URL во время длинного асинхронного экспорта
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
          console.warn('Cinema Engine: Failed to convert blob URL to data URL, using original.');
          return coverUrl;
        }
      })();

      const img = new Image();
      coverImg = img;

      await new Promise<void>((resolve) => {
        img.onload = () => {
          if (!coverCtx || !img) {
            resolve();
            return;
          }
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
          isCoverReady = true;
          resolve();
        };
        img.onerror = () => {
          console.warn('Cinema Engine: Cover image failed to load, proceeding without cover.');
          resolve();
        };
        img.src = resolvedCoverUrl;
      });
    }


    // --- ШАГ 4: НАСТРОЙКА ДЕТЕРМИНИРОВАННЫХ ПОТОКОВ ---
    // 30 FPS = вдвое меньше кадров = вдвое быстрее; для музыкального видео разница незаметна
    const EXPORT_FPS = 30;
    const FRAME_TIME = 1 / EXPORT_FPS;
    const totalFrames = Math.ceil(duration * EXPORT_FPS);
    let exportFrame = 0;
    let lastPerfLog = performance.now();
    console.log(`Cinema Engine: Starting export ${totalFrames} frames @ ${EXPORT_FPS}fps`);

    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = numChannels > 1 ? audioBuffer.getChannelData(1) : leftChannel;

    const fakeFft = new Uint8Array(64);
    
    // Пре-аллоцируем буфер звука один раз, чтобы не создавать GC-давление в горячем цикле
    const samplesPerFrame = Math.ceil(sampleRate / EXPORT_FPS) + 2;
    const preallocatedPlanar = new Float32Array(samplesPerFrame * numChannels);

    const drawFrame = (time: number) => {
      ctx.imageSmoothingEnabled = true;
      (ctx as any).imageSmoothingQuality = 'high';
      const sampleIdx = Math.floor(time * sampleRate);
      const amplitude = sampleIdx < leftChannel.length ? Math.abs(leftChannel[sampleIdx]) : 0;
      
      for (let i = 0; i < 64; i++) {
        fakeFft[i] = Math.max(10, Math.round(amplitude * 240 * (1 - i / 64)));
      }

      const pulseFactor = 1 + amplitude * 0.08;

      const renderFrame: RenderFrame = {
        time,
        width: finalWidth,
        height: finalHeight,
        pulseFactor,
        fft: fakeFft,
        styleOptions,
        coverColors,
        coverCanvas,
        coverImg,
        isCoverReady,
        resolution,
        audioFileName: options.audioFileName,
        exportProgress: exportFrame / totalFrames,
        quality,
      };

      renderBackground(ctx, renderFrame, null);
      renderParticles(ctx, renderFrame);
      renderVisualizer(ctx, renderFrame);
      renderLyrics(ctx, renderFrame, timedLines);

    };

    // --- ШАГ 5: ПРОГРЕВ КЭШЕЙ (важно до старта лупа!) ---
    // Прорисуем первые N кадров чтобы строитель текста, фона и частиц заполнили кэш
    console.log('Cinema Engine: Pre-warming render caches...');
    const cacheWarmCount = Math.min(timedLines.length, 5);
    for (let i = 0; i < cacheWarmCount; i++) {
      drawFrame(i * FRAME_TIME);
      await yieldToMain();
    }
    drawFrame(0); // render frame 0 for final state
    console.log('Cinema Engine: Cache warm-up done. Starting encode loop.');

    // --- ШАГ 5б: СИНХРОНИЗИРОВАННОЕ КОДИРОВАНИЕ ВИДЕО И АУДИО ЧАНКАМИ ---
    let audioSampleOffset = 0;

    const runVideoEncodingLoop = async () => {
      while (exportFrame < totalFrames && !isAborted) {
        const time = exportFrame * FRAME_TIME;

        // А. Рендерим и кодируем видео-кадр
        drawFrame(time);

        const timestampUs = Math.round(time * 1_000_000);
        const videoFrame = new VideoFrame(canvas, { timestamp: timestampUs });

        videoEncoder!.encode(videoFrame, { keyFrame: exportFrame % 300 === 0 });
        videoFrame.close();

        // Безопасность: предотвращаем накопление сотен кадров в памяти (каждый ~8MB при 1080p)
        if (videoEncoder!.encodeQueueSize > 90) {
          while (videoEncoder!.encodeQueueSize > 45 && !isAborted) {
            await yieldToMain();
          }
        }

        // Б. Кодируем порцию PCM аудио, строго соответствующую длительности кадра (1/60 сек)
        const targetSampleOffset = Math.min(
          Math.floor((exportFrame + 1) * FRAME_TIME * sampleRate),
          leftChannel.length
        );
        const currentChunkSize = targetSampleOffset - audioSampleOffset;

        if (currentChunkSize > 0) {
          const leftSlice = leftChannel.subarray(audioSampleOffset, audioSampleOffset + currentChunkSize);
          const rightSlice = rightChannel.subarray(audioSampleOffset, audioSampleOffset + currentChunkSize);

          // Используем пре-аллоцированный буфер вместо new Float32Array каждый кадр
          const planarData = preallocatedPlanar.subarray(0, currentChunkSize * numChannels);
          planarData.set(leftSlice, 0);
          if (numChannels > 1) {
            planarData.set(rightSlice, currentChunkSize);
          }

          const audioTimestampUs = Math.round((audioSampleOffset / sampleRate) * 1_000_000);

          const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate: sampleRate,
            numberOfFrames: currentChunkSize,
            numberOfChannels: numChannels,
            timestamp: audioTimestampUs,
            data: planarData,
          });

          audioEncoder!.encode(audioData);
          audioData.close();

          audioSampleOffset += currentChunkSize;
        }

        onProgress(exportFrame / totalFrames, time);
        exportFrame++;

        // Лог производительности каждые 100 кадров
        if (exportFrame % 100 === 0) {
          const now = performance.now();
          const elapsed = now - lastPerfLog;
          const fps = 100 / (elapsed / 1000);
          const qSize = videoEncoder?.encodeQueueSize ?? 0;
          console.log(`[Export] Frame ${exportFrame}/${totalFrames} | Speed: ${fps.toFixed(1)} fps | Encoder queue: ${qSize}`);
          lastPerfLog = now;
          await yieldToMain();
        }
      }

      if (isAborted) {
        videoEncoder!.close();
        audioEncoder!.close();
        return;
      }

      // --- ШАГ 6: ФИНАЛИЗАЦИЯ ОФФЛАЙН-ПОТОКОВ ---
      await videoEncoder!.flush();
      await audioEncoder!.flush();

      videoEncoder!.close();
      audioEncoder!.close();

      muxer.finalize();

      const finalBuffer = muxer.target.buffer;
      const finalBlob = new Blob([finalBuffer], { type: outputType });
      
      onComplete(finalBlob);
    };

    await runVideoEncodingLoop();

  } catch (error: any) {
    console.error('WebCodecs export failed:', error);
    if (videoEncoder && videoEncoder.state !== 'closed') {
      try { videoEncoder.close(); } catch {}
    }
    if (audioEncoder && audioEncoder.state !== 'closed') {
      try { audioEncoder.close(); } catch {}
    }
    // Если ошибка возникла ДО начала лупа (например нет подходящего кодека),
    // пробрасываем ошибку вверх, чтобы внешний .catch() переключился на MediaRecorder
    if (error.message === 'No supported video codec found') {
      throw error;
    }
    onError(error);
  }
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

  const originalCurrentTime = audioElement.currentTime;
  const originalMuted = audioElement.muted;
  const originalVolume = audioElement.volume;

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

    audioElement.pause();
    audioElement.currentTime = originalCurrentTime;
    audioElement.muted = originalMuted;
    audioElement.volume = originalVolume;

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
    try {
      if (!activeAudioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        activeAudioCtx = new AudioContextClass();
      }
      
      if (activeAudioCtx.state === 'suspended') {
        await activeAudioCtx.resume();
      }

      sourceNode = activeAudioCtx.createMediaElementSource(audioElement);
      destinationNode = activeAudioCtx.createMediaStreamDestination();
      
      sourceNode.connect(destinationNode);

      audioElement.muted = false;
      audioElement.volume = 1.0;
      audioElement.currentTime = 0;

      const canvasStream = canvas.captureStream(60);
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

        const time = audioElement.currentTime;
        const duration = audioElement.duration || 0;

        onProgress(duration > 0 ? time / duration : 0, time);

        if (audioElement.ended || (duration > 0 && time >= duration - 0.1)) {
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

      worker.postMessage({ action: 'start', interval: 1000 / 60 });

      await audioElement.play();

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
