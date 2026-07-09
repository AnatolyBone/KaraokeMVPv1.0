import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { renderBackground } from './renderBackground';
import { renderParticles } from './renderParticles';
import { renderVisualizer } from './renderVisualizer';
import { renderLyrics } from './renderLyrics';
import { clearTextWidthCache } from './textCache';
import { RenderFrame } from './types';

const roundMs = (value: number) => Number(value.toFixed(2));

const postRenderLog = (tag: string, message: string, data?: Record<string, unknown>) => {
  self.postMessage({ type: 'render-log', tag, message, data });
};

// Перехват консоли для перенаправления логов в главный поток
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args) => {
  originalLog(...args);
  self.postMessage({
    type: 'log',
    level: 'info',
    message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  });
};

console.warn = (...args) => {
  originalWarn(...args);
  self.postMessage({
    type: 'log',
    level: 'warn',
    message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  });
};

console.error = (...args) => {
  originalError(...args);
  self.postMessage({
    type: 'log',
    level: 'error',
    message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  });
};

// Хелпер для обхода жесткого троттлинга setTimeout в фоновых вкладках браузера.
const yieldToMain = () => new Promise<void>(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(null);
});

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

self.onmessage = async (e: MessageEvent) => {
  const { action } = e.data;
  if (action !== 'start') return;

  const {
    options,
    leftChannel,
    rightChannel,
    coverBitmap
  } = e.data;

  const {
    lines,
    resolution,
    styleOptions,
    format,
    coverColors,
    sampleRate,
    duration,
    numChannels,
    fps,
    bitrate,
    quality,
    hwAccel
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

  const canvas = new OffscreenCanvas(finalWidth, finalHeight);
  const ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;

  if (!ctx) {
    self.postMessage({ type: 'error', message: 'Failed to get 2D context from OffscreenCanvas' });
    return;
  }

  clearTextWidthCache();

  let isAborted = false;
  let encoderError: Error | null = null;

  const timedLines = [...lines]
    .filter((line) => line.time !== null)
    .sort((a, b) => (a.time || 0) - (b.time || 0));

  postRenderLog('config', 'Worker received export job', {
    width: finalWidth,
    height: finalHeight,
    resolution,
    format,
    fps,
    bitrateKbps: bitrate,
    quality: quality || 'default',
    hwAccel: hwAccel || 'auto',
    preset: styleOptions.preset,
    animationStyle: styleOptions.animationStyle,
    fxOverlay: styleOptions.fxOverlay,
    bgType: styleOptions.bgType,
    aspectRatio: styleOptions.aspectRatio,
    duration: Number(duration.toFixed(2)),
    lines: lines.length,
    timedLines: timedLines.length,
    hasCover: !!coverBitmap,
  });

  let videoEncoder: VideoEncoder | undefined;
  let audioEncoder: AudioEncoder | undefined;
  let muxer: any = null;
  let outputType = '';

  try {
    videoEncoder = new VideoEncoder({
      output: (chunk, metadata) => {
        if (isAborted || !muxer) return;
        muxer.addVideoChunk(chunk, metadata);
      },
      error: (err) => {
        console.error('Worker VideoEncoder Error:', err);
        if (!encoderError) encoderError = err;
      },
    });

    const targetBitrate = bitrate * 1000; // bitrate in kbps -> bps

    const isFullHdOrLarger = finalWidth * finalHeight >= 1920 * 1080;
    const h264Level = isFullHdOrLarger ? (fps > 30 ? '2a' : '28') : (fps > 30 ? '20' : '1f');

    const videoConfig: VideoEncoderConfig = {
      codec: format === 'mp4' ? `avc1.42e0${h264Level}` : 'vp09.00.41.08',
      width: finalWidth,
      height: finalHeight,
      bitrate: targetBitrate,
      framerate: fps,
      latencyMode: 'realtime',
      hardwareAcceleration: hwAccel || (format === 'mp4' ? 'prefer-hardware' : 'prefer-software'),
    };

    if (typeof VideoEncoder.isConfigSupported === 'function') {
      const codecCandidates = format === 'mp4'
        ? [
            `avc1.42e0${h264Level}`,
            `avc1.4d40${h264Level}`,
            `avc1.6400${h264Level}`,
            'avc1.42e033',
            'avc1.4d0033',
            'avc1.640033',
            'avc1.640034',
          ]
        : ['vp09.00.41.08', 'vp09.00.40.08', 'vp09.00.10.08', 'vp8'];

      let configured = false;
      for (const codec of codecCandidates) {
        const candidateConfig = { ...videoConfig, codec };
        const support = await VideoEncoder.isConfigSupported(candidateConfig);
        if (support.supported) {
          videoConfig.codec = codec;
          configured = true;
          break;
        }
      }

      if (!configured) {
        throw new Error(
          format === 'mp4'
            ? 'No supported H.264 profile found for offline MP4 export.'
            : 'No supported VP9/VP8 codec found for offline WebM export.'
        );
      }
    }

    videoEncoder.configure(videoConfig);
    postRenderLog('codec', 'Video codec selected', {
      codec: videoConfig.codec,
      hardwareAcceleration: videoConfig.hardwareAcceleration || 'default',
      width: videoConfig.width,
      height: videoConfig.height,
      bitrateKbps: Math.round(targetBitrate / 1000),
      fps,
      latencyMode: videoConfig.latencyMode || 'default',
    });

    audioEncoder = new AudioEncoder({
      output: (chunk, metadata) => {
        if (isAborted || !muxer) return;
        muxer.addAudioChunk(chunk, metadata);
      },
      error: (err) => {
        console.error('Worker AudioEncoder Error:', err);
        if (!encoderError) encoderError = err;
      },
    });

    const chosenAudioCodec = format === 'mp4' ? 'aac' : 'opus';
    const audioConfig = {
      codec: format === 'mp4' ? 'mp4a.40.2' : 'opus',
      numberOfChannels: numChannels,
      sampleRate: sampleRate,
      bitrate: 192_000,
    };

    audioEncoder.configure(audioConfig);
    postRenderLog('codec', 'Audio codec selected', {
      codec: audioConfig.codec,
      channels: numChannels,
      sampleRate,
      bitrateKbps: Math.round(audioConfig.bitrate / 1000),
    });

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
      const webmVideoCodec = videoConfig.codec === 'vp8' ? 'V_VP8' : 'V_VP9';
      muxer = new WebmMuxer({
        target: new WebmTarget(),
        video: {
          codec: webmVideoCodec,
          width: finalWidth,
          height: finalHeight,
          frameRate: fps,
        },
        audio: {
          codec: 'A_OPUS',
          numberOfChannels: numChannels,
          sampleRate: sampleRate,
        },
      });
      outputType = 'video/webm';
    }

    const FRAME_TIME = 1 / fps;
    const totalFrames = Math.ceil(duration * fps);
    let exportFrame = 0;

    const fakeFft = new Uint8Array(64);
    const AUDIO_FRAME_SIZE = chosenAudioCodec === 'aac' ? 1024 : 960;
    const audioFrameBuffer = new Float32Array(AUDIO_FRAME_SIZE * numChannels);
    let audioBufferQueueLeft = new Float32Array(0);
    let audioBufferQueueRight = new Float32Array(0);
    let audioFramesEncodedCount = 0;

    const drawFrame = (time: number) => {
      const frameStart = performance.now();
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
        coverCanvas: null,
        coverImg: coverBitmap,
        isCoverReady: !!coverBitmap,
        resolution,
        audioFileName: options.audioFileName,
        exportProgress: exportFrame / totalFrames,
        quality,
      };

      const bgStart = performance.now();
      renderBackground(ctx, renderFrame, null);
      const bgMs = performance.now() - bgStart;

      const particlesStart = performance.now();
      renderParticles(ctx, renderFrame);
      const particlesMs = performance.now() - particlesStart;

      const visualizerStart = performance.now();
      renderVisualizer(ctx, renderFrame);
      const visualizerMs = performance.now() - visualizerStart;

      const lyricsStart = performance.now();
      renderLyrics(ctx, renderFrame, timedLines);
      const lyricsMs = performance.now() - lyricsStart;

      return {
        totalMs: performance.now() - frameStart,
        bgMs,
        particlesMs,
        visualizerMs,
        lyricsMs,
      };
    };

    self.postMessage({ type: 'status', status: 'prewarming' });

    // Pre-warm caches
    const cacheWarmCount = Math.min(timedLines.length, 5);
    for (let i = 0; i < cacheWarmCount; i++) {
      drawFrame(i * FRAME_TIME);
      await yieldToMain();
    }
    const prewarmMetrics = drawFrame(0);
    postRenderLog('prewarm', 'Prewarm frame rendered', {
      totalMs: roundMs(prewarmMetrics.totalMs),
      backgroundMs: roundMs(prewarmMetrics.bgMs),
      particlesMs: roundMs(prewarmMetrics.particlesMs),
      visualizerMs: roundMs(prewarmMetrics.visualizerMs),
      lyricsMs: roundMs(prewarmMetrics.lyricsMs),
    });

    let audioSampleOffset = 0;
    let lastProgressPostTime = 0;
    let lastPerfPostTime = 0;
    let lastYieldMs = 0;
    let lastBackpressureMs = 0;
    const YIELD_EVERY_FRAMES = 2;
    const VIDEO_QUEUE_THROTTLE_LIMIT = format === 'mp4' ? 2 : 6;
    const VIDEO_QUEUE_HARD_FLUSH_LIMIT = format === 'mp4' ? 24 : 48;
    const KEYFRAME_INTERVAL = Math.max(fps * 4, 60);

    postRenderLog('config', 'Encoder throttle configured', {
      queueLimit: VIDEO_QUEUE_THROTTLE_LIMIT,
      hardFlushLimit: VIDEO_QUEUE_HARD_FLUSH_LIMIT,
      keyframeInterval: KEYFRAME_INTERVAL,
    });

    self.postMessage({ type: 'status', status: 'encoding' });

    while (exportFrame < totalFrames && !isAborted) {
      if ((videoEncoder?.state as string) === 'closed') {
        throw new Error('VideoEncoder was closed due to an internal error.');
      }
      if ((audioEncoder?.state as string) === 'closed') {
        throw new Error('AudioEncoder was closed due to an internal error.');
      }
      if (encoderError) throw encoderError;

      const loopStart = performance.now();
      const time = exportFrame * FRAME_TIME;

      const renderMetrics = drawFrame(time);

      const videoFrameStart = performance.now();
      const timestampUs = Math.round(time * 1_000_000);
      const durationUs = Math.round(FRAME_TIME * 1_000_000);
      const videoFrame = new VideoFrame(canvas, { 
        timestamp: timestampUs,
        duration: durationUs 
      });
      const videoFrameMs = performance.now() - videoFrameStart;

      const videoEncodeStart = performance.now();
      videoEncoder.encode(videoFrame, { keyFrame: exportFrame % KEYFRAME_INTERVAL === 0 });
      videoFrame.close();
      let videoEncodeMs = performance.now() - videoEncodeStart;
      lastBackpressureMs = 0;

      if (videoEncoder.encodeQueueSize > VIDEO_QUEUE_THROTTLE_LIMIT) {
        const backpressureStart = performance.now();
        let waitLoops = 0;
        while (
          !isAborted &&
          !encoderError &&
          videoEncoder.encodeQueueSize > VIDEO_QUEUE_THROTTLE_LIMIT
        ) {
          if (videoEncoder.encodeQueueSize > VIDEO_QUEUE_HARD_FLUSH_LIMIT) {
            await videoEncoder.flush();
          } else {
            await sleep(4);
          }
          waitLoops++;
          if (waitLoops % 12 === 0) {
            await yieldToMain();
          }
        }
        lastBackpressureMs = performance.now() - backpressureStart;
        videoEncodeMs += lastBackpressureMs;
        if (encoderError) throw encoderError;
      }

      const audioQueueStart = performance.now();
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

        if (numChannels > 1 && rightChannel) {
          const newRight = rightChannel.subarray(audioSampleOffset, audioSampleOffset + currentChunkSize);
          const nextQueueRight = new Float32Array(audioBufferQueueRight.length + newRight.length);
          nextQueueRight.set(audioBufferQueueRight, 0);
          nextQueueRight.set(newRight, audioBufferQueueRight.length);
          audioBufferQueueRight = nextQueueRight;
        }

        audioSampleOffset += currentChunkSize;
      }
      const audioQueueMs = performance.now() - audioQueueStart;

      const audioEncodeStart = performance.now();
      let audioChunksEncoded = 0;
      while (audioBufferQueueLeft.length >= AUDIO_FRAME_SIZE && !isAborted) {
        const leftSlice = audioBufferQueueLeft.subarray(0, AUDIO_FRAME_SIZE);
        const planarData = audioFrameBuffer;
        planarData.set(leftSlice, 0);
        if (numChannels > 1 && rightChannel) {
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

        audioEncoder.encode(audioData);
        audioData.close();
        audioFramesEncodedCount++;
        audioChunksEncoded++;

        audioBufferQueueLeft = audioBufferQueueLeft.slice(AUDIO_FRAME_SIZE);
        if (numChannels > 1 && rightChannel) {
          audioBufferQueueRight = audioBufferQueueRight.slice(AUDIO_FRAME_SIZE);
        }
      }
      const audioEncodeMs = performance.now() - audioEncodeStart;

      const now = performance.now();
      if (now - lastPerfPostTime > 1000 || exportFrame === totalFrames - 1) {
        postRenderLog('perf', 'Frame render profile', {
          frame: exportFrame,
          totalFrames,
          time: Number(time.toFixed(2)),
          totalMs: roundMs(renderMetrics.totalMs),
          backgroundMs: roundMs(renderMetrics.bgMs),
          particlesMs: roundMs(renderMetrics.particlesMs),
          visualizerMs: roundMs(renderMetrics.visualizerMs),
          lyricsMs: roundMs(renderMetrics.lyricsMs),
          videoFrameMs: roundMs(videoFrameMs),
          videoEncodeMs: roundMs(videoEncodeMs),
          audioQueueMs: roundMs(audioQueueMs),
          audioEncodeMs: roundMs(audioEncodeMs),
          audioChunks: audioChunksEncoded,
          loopMs: roundMs(performance.now() - loopStart),
          lastYieldMs: roundMs(lastYieldMs),
          backpressureMs: roundMs(lastBackpressureMs),
          encodeQueue: videoEncoder?.encodeQueueSize ?? null,
        });
        lastPerfPostTime = now;
      }
      if (now - lastProgressPostTime > 120 || exportFrame === totalFrames - 1) {
        self.postMessage({ type: 'progress', percent: exportFrame / totalFrames, seconds: time });
        lastProgressPostTime = now;
      }
      exportFrame++;

      if (exportFrame % YIELD_EVERY_FRAMES === 0) {
        const yieldStart = performance.now();
        await yieldToMain();
        lastYieldMs = performance.now() - yieldStart;
      } else {
        lastYieldMs = 0;
      }
    }

    if (isAborted) {
      videoEncoder.close();
      audioEncoder.close();
      return;
    }

    if (audioBufferQueueLeft.length > 0 && !isAborted) {
      const planarData = audioFrameBuffer;
      planarData.fill(0);
      planarData.set(audioBufferQueueLeft, 0);
      if (numChannels > 1 && rightChannel && audioBufferQueueRight.length > 0) {
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

      audioEncoder.encode(audioData);
      audioData.close();
    }

    postRenderLog('mux', 'Flushing encoders');
    await videoEncoder.flush();
    await audioEncoder.flush();

    videoEncoder.close();
    audioEncoder.close();

    postRenderLog('mux', 'Finalizing container');
    muxer.finalize();

    const finalBuffer = muxer.target.buffer;
    postRenderLog('complete', 'Export buffer ready', {
      bytes: finalBuffer.byteLength,
      megabytes: Number((finalBuffer.byteLength / 1024 / 1024).toFixed(2)),
      outputType,
    });
    (self as any).postMessage({ type: 'complete', buffer: finalBuffer, outputType }, [finalBuffer]);

  } catch (error: any) {
    console.error('Worker execution failed:', error);
    self.postMessage({ type: 'error', message: error.message || 'Unknown error inside Web Worker' });
  }
};
