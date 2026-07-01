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
      
      // Уровень 3: Если MP4 полностью упал, пробуем офлайн WebM (VP9) — у него стабильный софтверный кодек в Chrome
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

/**
 * РЕЖИМ А: Высокопроизводительный офлайн-экспорт WebCodecs + mp4-muxer/webm-muxer (Chrome/Edge)
 * hwAccel: 'prefer-hardware' = GPU (быстро), 'no-preference' = CPU (медленно но надёжно, без десинхронизации)
 */
async function exportVideoWebCodecs(
  options: ExportOptions,
  hwAccel: HardwareAcceleration = 'prefer-hardware'
): Promise<void> {
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
    onStatus,
    onWarning: _onWarning,
    onComplete,
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
  // НЕ используем desynchronized: true в экспорте!
  // desynchronized=true отвязывает flush GPU-операций от JS — VideoFrame может захватить незаконченный кадр
  const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;

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
  onStatus?.('decoding');
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
  onStatus?.('initializing');
  let videoEncoder: VideoEncoder | undefined;
  let audioEncoder: AudioEncoder | undefined;
  let muxer: any = null;
  let outputType = '';

  try {
    let encoderError: Error | null = null;

    videoEncoder = new VideoEncoder({
      output: (chunk, metadata) => {
        if (isAborted || !muxer) return;
        muxer.addVideoChunk(chunk, metadata);
      },
      error: (e) => {
        // НЕ вызываем onError напрямую — просто сохраняем ошибку, цикл энкодирования сам её обнаружит
        console.error('VideoEncoder Error:', e);
        if (!encoderError) encoderError = e;
      },
    });

    // Для MP4: H.264 поддерживается всегда, добавляем VP9 как запасной
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
        const targetBitrate = options.resolution === '720p' ? 2_000_000 : 3_000_000;
        const config: VideoEncoderConfig = {
          codec: codec,
          width: finalWidth,
          height: finalHeight,
          bitrate: targetBitrate,
          framerate: 30,
          latencyMode: 'realtime',
          hardwareAcceleration: hwAccel,
        };

        if (typeof VideoEncoder.isConfigSupported === 'function') {
          const support = await VideoEncoder.isConfigSupported(config);
          if (!support.supported) {
            console.warn(`Codec ${codec} not supported by hardware, trying next...`);
            continue;
          }
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
        if (!encoderError) encoderError = e;
      },
    });

    const audioCodecsToTry = format === 'mp4' ? ['mp4a.40.2', 'opus'] : ['opus'];
    let audioConfigured = false;
    let chosenAudioCodec: 'aac' | 'opus' = 'aac';

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
        chosenAudioCodec = codec.includes('mp4a') ? 'aac' : 'opus';
        console.log(`Cinema Engine: AudioEncoder configured with codec: ${codec} (muxer: ${chosenAudioCodec})`);
        break;
      } catch (err) {
        console.warn(`Audio codec ${codec} failed:`, err);
      }
    }

    if (!audioConfigured) {
      throw new Error('No supported audio codec found');
    }

    // ИНИЦИАЛИЗИРУЕМ МУКСЕР ПОСЛЕ ТОГО, КАК КОДЕКИ НАСТРОЕНЫ
    // Это гарантирует, что codec в muxer совпадет с реально выбранным кодеком (aac/opus)
    if (format === 'mp4') {
      muxer = new Mp4Muxer({
        target: new Mp4Target(),
        video: {
          codec: 'avc',
          width: finalWidth,
          height: finalHeight,
        },
        audio: {
          codec: chosenAudioCodec,
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
    
    // Пре-аллоцируем буфер звука под один фиксированный пакет кодека (1024 для AAC, 960 для Opus)
    // AAC строго требует 1024 сэмплов на фрейм, Opus — 960 (20мс при 48кГц)
    const AUDIO_FRAME_SIZE = chosenAudioCodec === 'aac' ? 1024 : 960;
    const audioFrameBuffer = new Float32Array(AUDIO_FRAME_SIZE * numChannels);
    let audioBufferQueueLeft = new Float32Array(0);
    let audioBufferQueueRight = new Float32Array(0);
    let audioFramesEncodedCount = 0;

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
    onStatus?.('prewarming');
    console.log('Cinema Engine: Pre-warming render caches...');
    const cacheWarmCount = Math.min(timedLines.length, 5);
    for (let i = 0; i < cacheWarmCount; i++) {
      drawFrame(i * FRAME_TIME);
      await yieldToMain();
    }
    drawFrame(0); // render frame 0 for final state
    console.log('Cinema Engine: Cache warm-up done. Starting encode loop.');
    onStatus?.('encoding');

    // --- ШАГ 5б: СИНХРОНИЗИРОВАННОЕ КОДИРОВАНИЕ ВИДЕО И АУДИО ЧАНКАМИ ---
    let audioSampleOffset = 0;

    const runVideoEncodingLoop = async () => {
      while (exportFrame < totalFrames && !isAborted) {
        if ((videoEncoder?.state as string) === 'closed') {
          throw new Error('VideoEncoder was closed due to an internal error.');
        }
        if ((audioEncoder?.state as string) === 'closed') {
          throw new Error('AudioEncoder was closed due to an internal error.');
        }
        // Проверяем ошибку кодека из async callback
        if (encoderError) {
          throw encoderError;
        }

        const time = exportFrame * FRAME_TIME;

        // А. Рендерим и кодируем видео-кадр
        drawFrame(time);

        const timestampUs = Math.round(time * 1_000_000);
        const durationUs = Math.round(FRAME_TIME * 1_000_000);
        const videoFrame = new VideoFrame(canvas, { 
          timestamp: timestampUs,
          duration: durationUs 
        });

        videoEncoder!.encode(videoFrame, { keyFrame: exportFrame % 30 === 0 });
        videoFrame.close();

        // Бэкпресшн: держим размер очереди в разумных пределах (до 120 кадров), чтобы не перегружать память.
        // Дает кодировщику достаточный буфер, чтобы избежать взаимной блокировки (deadlock).
        if (videoEncoder!.encodeQueueSize > 120) {
          while (videoEncoder!.encodeQueueSize > 60 && !isAborted) {
            if (encoderError) throw encoderError;
            if ((videoEncoder?.state as string) === 'closed') {
              throw new Error('VideoEncoder was closed while waiting for queue to clear.');
            }
            await sleep(15);
          }
        }

        // Б. Добавляем новые сэмплы звука в очередь
        const targetSampleOffset = Math.min(
          Math.floor((exportFrame + 1) * FRAME_TIME * sampleRate),
          leftChannel.length
        );
        const currentChunkSize = targetSampleOffset - audioSampleOffset;

        if (currentChunkSize > 0) {
          const newLeft = leftChannel.subarray(audioSampleOffset, audioSampleOffset + currentChunkSize);
          
          const nextQueueLeft = new Float32Array(audioBufferQueueLeft.length + newLeft.length);
          nextQueueLeft.set(audioBufferQueueLeft, 0);
          nextQueueLeft.set(newLeft, audioBufferQueueLeft.length);
          audioBufferQueueLeft = nextQueueLeft;

          if (numChannels > 1) {
            const newRight = rightChannel.subarray(audioSampleOffset, audioSampleOffset + currentChunkSize);
            const nextQueueRight = new Float32Array(audioBufferQueueRight.length + newRight.length);
            nextQueueRight.set(audioBufferQueueRight, 0);
            nextQueueRight.set(newRight, audioBufferQueueRight.length);
            audioBufferQueueRight = nextQueueRight;
          }

          audioSampleOffset += currentChunkSize;
        }

        // Отправляем пакеты по AUDIO_FRAME_SIZE сэмплов в кодек
        while (audioBufferQueueLeft.length >= AUDIO_FRAME_SIZE && !isAborted) {
          const leftSlice = audioBufferQueueLeft.subarray(0, AUDIO_FRAME_SIZE);
          
          const planarData = audioFrameBuffer;
          planarData.set(leftSlice, 0);
          if (numChannels > 1) {
            const rightSlice = audioBufferQueueRight.subarray(0, AUDIO_FRAME_SIZE);
            planarData.set(rightSlice, AUDIO_FRAME_SIZE);
          }

          const audioTimestampUs = Math.round((audioFramesEncodedCount * AUDIO_FRAME_SIZE / sampleRate) * 1_000_000);

          const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate: sampleRate,
            numberOfFrames: AUDIO_FRAME_SIZE,
            numberOfChannels: numChannels,
            timestamp: audioTimestampUs,
            data: planarData,
          });

          audioEncoder!.encode(audioData);
          audioData.close();

          audioFramesEncodedCount++;

          // Удаляем отправленные сэмплы из очереди
          audioBufferQueueLeft = audioBufferQueueLeft.slice(AUDIO_FRAME_SIZE);
          if (numChannels > 1) {
            audioBufferQueueRight = audioBufferQueueRight.slice(AUDIO_FRAME_SIZE);
          }
        }

        onProgress(exportFrame / totalFrames, time);
        exportFrame++;

        // Даём браузеру один тик на обработку событий
        await sleep(0);

        // Перфоманс лог каждые 150 кадров
        if (exportFrame % 150 === 0) {
          const now = performance.now();
          const elapsed = now - lastPerfLog;
          const fps = 150 / (elapsed / 1000);
          const qSize = videoEncoder?.encodeQueueSize ?? 0;
          console.log(`[Export] Frame ${exportFrame}/${totalFrames} | Speed: ${fps.toFixed(1)} fps | Encoder queue: ${qSize}`);
          lastPerfLog = now;
        }

      }

      if (isAborted) {
        videoEncoder!.close();
        audioEncoder!.close();
        return;
      }

      // Досылаем остатки аудио с заполнением тишиной (padding)
      if (audioBufferQueueLeft.length > 0 && !isAborted) {
        const planarData = audioFrameBuffer;
        planarData.fill(0);
        
        planarData.set(audioBufferQueueLeft, 0);
        if (numChannels > 1 && audioBufferQueueRight.length > 0) {
          planarData.set(audioBufferQueueRight, AUDIO_FRAME_SIZE);
        }

        const audioTimestampUs = Math.round((audioFramesEncodedCount * AUDIO_FRAME_SIZE / sampleRate) * 1_000_000);

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: sampleRate,
          numberOfFrames: AUDIO_FRAME_SIZE,
          numberOfChannels: numChannels,
          timestamp: audioTimestampUs,
          data: planarData,
        });

        audioEncoder!.encode(audioData);
        audioData.close();
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
    console.warn('Cinema Engine: WebCodecs export failed, rethrowing for MediaRecorder fallback.', error.message);
    if (videoEncoder && videoEncoder.state !== 'closed') {
      try { videoEncoder.close(); } catch {}
    }
    if (audioEncoder && audioEncoder.state !== 'closed') {
      try { audioEncoder.close(); } catch {}
    }
    // Пробрасываем ВСЕ ошибки наверх — внешний .catch() в exportVideo()
    // перехватит их и переключится на MediaRecorder-фоллбек.
    throw error;
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
