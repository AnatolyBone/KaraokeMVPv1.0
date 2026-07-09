import React, { useState, useRef, useEffect } from 'react';
import { useKaraokeStore, getDefaultProjectTitle } from '../../store/useKaraokeStore';
import { exportVideo } from '../../utils/video';
import { audioRef } from '../../audioRef';
import { localization } from '../../utils/localization';
import { clearTextWidthCache } from '../../utils/renderer/textCache';
import { renderBackground } from '../../utils/renderer/renderBackground';
import { RenderFrame } from '../../utils/renderer/types';
import { extractDominantColors } from '../../utils/colors';
import { trackAppEvent } from '../../utils/analytics';
import { FileVideo, Download, AlertCircle, RefreshCw, XCircle, CheckCircle2, Palette, Type, Eye, Film, Activity, ShieldAlert, LayoutGrid, SlidersHorizontal, Copy } from 'lucide-react';

const MODERN_VIDEO_FONT = '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

interface PreviewParticle {
  x: number;
  y: number;
  baseX?: number;
  baseY?: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color?: string;
  phase?: number;
  orbit?: number;
  speed?: number;
  stretch?: number;
}

type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
type ExportProfile = 'stable' | 'balanced' | 'sharp' | 'premium';
type ExportProfileState = ExportProfile | 'custom';
type RenderLogEntry = {
  id: number;
  time: string;
  tag: string;
  message: string;
  data?: Record<string, unknown>;
};

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const ExportVideoPanel: React.FC = () => {
  const {
    lines,
    audioUrl,
    audioFileName,
    currentProjectTitle,
    setCurrentProjectTitle,
    theme,
    videoStyle,
    updateVideoStyle,
    coverUrl,
    coverColors,
    setCoverColors,
    language,
    user,
    userProfile
  } = useKaraokeStore();
  
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [videoFormat, setVideoFormat] = useState<'mp4' | 'webm'>('mp4');
  const [isRecording, setIsRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const [secondsRecorded, setSecondsRecorded] = useState(0);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportEta, setExportEta] = useState<string | null>(null);
  const [exportSpeedFps, setExportSpeedFps] = useState<number>(0);
  const exportStartTimeRef = useRef<number>(0);
  const lastProgressUiUpdateRef = useRef<number>(0);
  type ExportPhase = 'idle' | 'decoding' | 'initializing' | 'prewarming' | 'encoding' | 'recording';
  const [exportPhase, setExportPhase] = useState<ExportPhase>('idle');
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [renderLogs, setRenderLogs] = useState<RenderLogEntry[]>([]);
  const [logsCopied, setLogsCopied] = useState(false);
  const renderLogIdRef = useRef(0);
  const codecPressureHitsRef = useRef(0);

  const dict = localization[language];
  const exportUi = {
    presetLabel: language === 'ru' ? 'Пресет караоке-дизайна' : 'Karaoke design preset',
    exportMode: language === 'ru' ? 'Режим экспорта' : 'Export mode',
    publishTarget: language === 'ru' ? 'Куда публикуем' : 'Publish target',
    smoothness: language === 'ru' ? 'Плавность' : 'Smoothness',
    advanced: language === 'ru' ? 'Тонкая настройка' : 'Fine tuning',
    open: language === 'ru' ? 'открыть' : 'open',
    hide: language === 'ru' ? 'скрыть' : 'hide',
    fileSharpness: language === 'ru' ? 'Четкость файла' : 'File sharpness',
    textTypeface: language === 'ru' ? 'Гарнитура текста' : 'Text typeface',
    textSize: language === 'ru' ? 'Размер текста' : 'Text size',
    unsupportedShort: language === 'ru' ? 'Не подд.' : 'N/A',
    mp4Unsupported: language === 'ru' ? 'Экспорт MP4 не поддерживается в этом браузере' : 'MP4 export is not supported in this browser',
    ultraWarning: language === 'ru'
      ? 'Внимание: Рендеринг в 1080p на максимальном режиме создает высокую нагрузку на CPU. На слабых ПК рекомендуется переключить режим на обычный.'
      : 'Heads up: 1080p export in Maximum mode is CPU-heavy. On weaker devices, Standard mode is recommended.',
    presets: {
      apple: language === 'ru' ? 'Apple Music Style (Кураторский)' : 'Apple Music Style (Curated)',
      spotify: language === 'ru' ? 'Spotify Stage (Глубокий зеленый)' : 'Spotify Stage (Deep green)',
      tiktok: language === 'ru' ? 'TikTok Pulse (Контрастный клип)' : 'TikTok Pulse (High-contrast clip)',
      classic: language === 'ru' ? 'Classic Karaoke (Сине-желтый)' : 'Classic Karaoke (Blue and yellow)',
      cinema: language === 'ru' ? 'Minimal Cinema (Темный кинотеатр)' : 'Minimal Cinema (Dark cinema)',
    },
    quality: {
      low: language === 'ru' ? 'Легкий' : 'Light',
      medium: language === 'ru' ? 'Обычный' : 'Standard',
      high: language === 'ru' ? 'Плавный' : 'Smooth',
      ultra: language === 'ru' ? 'Максимальный' : 'Maximum',
    },
    aspect: {
      landscape: language === 'ru' ? 'YouTube / горизонтально' : 'YouTube / landscape',
      vertical: language === 'ru' ? 'TikTok / Reels / Shorts' : 'TikTok / Reels / Shorts',
      square: language === 'ru' ? 'Instagram / квадрат' : 'Instagram / square',
    },
    fps: {
      low: language === 'ru' ? '24 FPS - для слабых Mac' : '24 FPS - lighter load',
      standard: language === 'ru' ? '30 FPS - стандарт' : '30 FPS - standard',
      smooth: language === 'ru' ? '60 FPS - суперплавно' : '60 FPS - extra smooth',
    },
    bitrate: {
      small: language === 'ru' ? 'маленький файл' : 'small file',
      normal: language === 'ru' ? 'обычное качество' : 'normal quality',
      sharp: language === 'ru' ? 'четкий 1080p' : 'crisp 1080p',
      hd: language === 'ru' ? 'четкое HD' : 'crisp HD',
      max: language === 'ru' ? 'максимум 1080p' : 'maximum 1080p',
    },
    font: {
      modern: language === 'ru' ? 'Современный' : 'Modern',
      sans: language === 'ru' ? 'Без засечек' : 'Sans serif',
      serif: language === 'ru' ? 'С засечками' : 'Serif',
      mono: language === 'ru' ? 'Моноширинный' : 'Monospace',
      cursive: language === 'ru' ? 'Рукописный' : 'Script',
    },
    profilesTitle: language === 'ru' ? 'Быстрый выбор экспорта' : 'Quick export setup',
    recommended: language === 'ru' ? 'рекомендуется' : 'recommended',
    customSettings: language === 'ru' ? 'Свои настройки' : 'Custom settings',
    currentSetup: language === 'ru' ? 'Текущий экспорт' : 'Current export',
    effectsOff: language === 'ru' ? 'эффекты выкл.' : 'effects off',
    effectsOn: language === 'ru' ? 'эффекты вкл.' : 'effects on',
    slowExportTitle: language === 'ru' ? 'Рендер идет медленно' : 'Render is running slowly',
    slowExportDesc: language === 'ru'
      ? 'Можно дождаться результата или отменить экспорт и выбрать профиль «Надежный».'
      : 'You can wait, or cancel export and choose the Reliable profile.',
    profiles: {
      stable: {
        title: language === 'ru' ? 'Надежный' : 'Reliable',
        meta: language === 'ru' ? '720p · 24 FPS · легкий рендер' : '720p · 24 FPS · light render',
        desc: language === 'ru'
          ? 'Для старых ноутбуков и слабых браузеров. Меньше эффектов, меньше шанс дерганого видео.'
          : 'For older laptops and weaker browsers. Fewer effects, lower risk of stutter.',
      },
      balanced: {
        title: language === 'ru' ? 'Оптимальный' : 'Balanced',
        meta: language === 'ru' ? '720p · 30 FPS · красивый фон' : '720p · 30 FPS · polished background',
        desc: language === 'ru'
          ? 'Лучший вариант по умолчанию: нормальное качество, хорошая плавность, без лишней нагрузки.'
          : 'Best default option: good quality, smooth enough, no excessive load.',
      },
      sharp: {
        title: language === 'ru' ? 'Четкий 1080p' : 'Crisp 1080p',
        meta: language === 'ru' ? '1080p · 30 FPS · 4.5 Mbps' : '1080p · 30 FPS · 4.5 Mbps',
        desc: language === 'ru'
          ? 'Для четкого текста, обложки и Full HD без жидких сфер и лишней нагрузки.'
          : 'For crisp text, cover art, and Full HD without liquid spheres or heavy render load.',
      },
      premium: {
        title: language === 'ru' ? 'Максимум' : 'Premium',
        meta: language === 'ru' ? '1080p · 30 FPS · жидкие сферы' : '1080p · 30 FPS · liquid spheres',
        desc: language === 'ru'
          ? 'Для мощного ПК и финального клипа. Красивее, но рендер заметно тяжелее.'
          : 'For a powerful PC and final clips. Prettier, but much heavier to render.',
      },
    },
  };

  // Качество рендеринга (Quality Manager)
  const exportPhaseCopy: Record<Exclude<ExportPhase, 'idle'>, { title: string; desc: string }> = {
    decoding: {
      title: language === 'ru' ? 'Аудио' : 'Audio',
      desc: language === 'ru' ? 'Готовим дорожку для рендера.' : 'Preparing the track for rendering.',
    },
    initializing: {
      title: language === 'ru' ? 'Кодек' : 'Codec',
      desc: language === 'ru' ? 'Проверяем формат и encoder.' : 'Checking the format and encoder.',
    },
    prewarming: {
      title: language === 'ru' ? 'Сцена' : 'Scene',
      desc: language === 'ru' ? 'Прогреваем фон, текст и эффекты.' : 'Warming up background, text, and effects.',
    },
    encoding: {
      title: language === 'ru' ? 'Рендер' : 'Render',
      desc: language === 'ru' ? 'Собираем видео быстрее реального времени.' : 'Building the video faster than real time.',
    },
    recording: {
      title: language === 'ru' ? 'Запись' : 'Recording',
      desc: language === 'ru' ? 'Резервный режим: идет запись в реальном времени.' : 'Fallback mode: recording in real time.',
    },
  };
  const exportPhaseOrder: Exclude<ExportPhase, 'idle'>[] = ['decoding', 'initializing', 'prewarming', 'encoding', 'recording'];
  const visibleExportPhase: Exclude<ExportPhase, 'idle'> = exportPhase === 'idle' ? 'initializing' : exportPhase;
  const activeExportPhaseIndex = Math.max(0, exportPhaseOrder.indexOf(visibleExportPhase));
  const secondsUnit = language === 'ru' ? 'с' : 's';
  const [quality, setQuality] = useState<QualityPreset>('high');
  const [exportFps, setExportFps] = useState<24 | 30 | 60>(30);
  const [customBitrate, setCustomBitrate] = useState<number>(3000);
  const [selectedProfile, setSelectedProfile] = useState<ExportProfileState>('balanced');
  const isSlowExport =
    isRecording &&
    (visibleExportPhase === 'encoding' || visibleExportPhase === 'recording') &&
    progress > 0.08 &&
    exportSpeedFps > 0 &&
    exportSpeedFps < Math.max(8, exportFps * 0.4);

  const formatRenderLogData = (data?: Record<string, unknown>) => {
    if (!data) return '';
    return Object.entries(data)
      .map(([key, value]) => `${key}: ${typeof value === 'number' ? Number(value.toFixed(2)) : String(value)}`)
      .join(' | ');
  };

  const copyRenderLogs = async () => {
    if (renderLogs.length === 0) return;

    const text = renderLogs
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((log) => {
        const data = formatRenderLogData(log.data);
        return `${log.time} [${log.tag}] ${log.message}${data ? `\n${data}` : ''}`;
      })
      .join('\n\n');

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setLogsCopied(true);
      window.setTimeout(() => setLogsCopied(false), 1600);
    } catch (err) {
      console.warn('Failed to copy render logs', err);
    }
  };

  useEffect(() => {
    let defaultBitrate = 3000;
    if (resolution === '1080p') {
      if (quality === 'low') defaultBitrate = 2500;
      else if (quality === 'medium') defaultBitrate = 4500;
      else if (quality === 'high') defaultBitrate = 4500;
      else if (quality === 'ultra') defaultBitrate = 12000;
    } else {
      if (quality === 'low') defaultBitrate = 1500;
      else if (quality === 'medium') defaultBitrate = 2500;
      else if (quality === 'high') defaultBitrate = 4000;
      else if (quality === 'ultra') defaultBitrate = 8000;
    }
    setCustomBitrate(defaultBitrate);
  }, [resolution, quality]);

  const applyExportProfile = (profile: ExportProfile) => {
    setSelectedProfile(profile);

    if (profile === 'stable') {
      setResolution('720p');
      setQuality('low');
      setExportFps(24);
      setCustomBitrate(1500);
      setVideoFormat(isMp4Supported ? 'mp4' : 'webm');
      updateVideoStyle({ fxOverlay: 'none' });
      return;
    }

    if (profile === 'balanced') {
      setResolution('720p');
      setQuality('high');
      setExportFps(30);
      setCustomBitrate(4000);
      setVideoFormat(isMp4Supported ? 'mp4' : 'webm');
      updateVideoStyle({ fxOverlay: 'fluid-gradient' });
      return;
    }

    if (profile === 'sharp') {
      setResolution('1080p');
      setQuality('high');
      setExportFps(30);
      setCustomBitrate(4500);
      setVideoFormat(isMp4Supported ? 'mp4' : 'webm');
      updateVideoStyle({ fxOverlay: 'none' });
      return;
    }

    setResolution('1080p');
    setQuality('ultra');
    setExportFps(30);
    setCustomBitrate(12000);
    setVideoFormat(isMp4Supported ? 'mp4' : 'webm');
    updateVideoStyle({ fxOverlay: 'fluid-gradient' });
  };

  const markCustomProfile = () => {
    setSelectedProfile('custom');
  };

  // Профайлер производительности (Frame & Per-Layer Profiler)
  const [fps, setFps] = useState(0);
  const [frameTimeMs, setFrameTimeMs] = useState(0);
  const [bgTimeMs, setBgTimeMs] = useState(0);
  const [particlesTimeMs, setParticlesTimeMs] = useState(0);
  const [lyricsTimeMs, setLyricsTimeMs] = useState(0);
  const [visualizerTimeMs, setVisualizerTimeMs] = useState(0);

  const bgTimeRef = useRef(0);
  const particlesTimeRef = useRef(0);
  const lyricsTimeRef = useRef(0);
  const visualizerTimeRef = useRef(0);
  const frameTimeRef = useRef(0);

  const frameCountRef = useRef(0);
  const fpsIntervalRef = useRef<any>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const timedLinesCount = lines.filter((l) => l.time !== null).length;
  const recommendedProfile: ExportProfile =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4
      ? 'stable'
      : 'balanced';

  // Динамический расчет размера обложки в зависимости от соотношения сторон
  const coverSize = videoStyle.aspectRatio === '9:16' 
    ? (resolution === '1080p' ? 240 : 160) 
    : (resolution === '1080p' ? 120 : 80);

  // Проверяем поддержку MP4
  const [isMp4Supported, setIsMp4Supported] = useState(false);
  useEffect(() => {
    const checkMp4Support = async () => {
      let supported = 
        MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a') ||
        MediaRecorder.isTypeSupported('video/mp4;codecs=h264,aac') ||
        MediaRecorder.isTypeSupported('video/mp4');
      
      if (!supported && typeof VideoEncoder !== 'undefined') {
        try {
          const support = await VideoEncoder.isConfigSupported({
            codec: 'avc1.4d0033',
            width: 1280,
            height: 720,
            bitrate: 5_000_000,
            framerate: 60
          });
          if (support.supported) {
            supported = true;
          }
        } catch (e) {}
      }
      
      setIsMp4Supported(supported);
      if (!supported) {
        setVideoFormat('webm');
      } else {
        setVideoFormat('mp4');
      }
    };
    
    checkMp4Support();
  }, []);

  // Очищаем все кэши рендерера при смене стиля/пресета или качества
  useEffect(() => {
    clearTextWidthCache();
  }, [videoStyle.preset, videoStyle.bgType, videoStyle.gradientPreset, quality]);

  // Старые сохранённые настройки могли показывать Apple-style в селекте,
  // но внутри держать прежний layout/background. Нормализуем прямо при входе в экспорт.
  useEffect(() => {
    if (
      videoStyle.preset === 'apple-music' &&
      (
        videoStyle.bgType !== 'gradient' ||
        videoStyle.gradientPreset !== 'ocean' ||
        videoStyle.animationStyle !== 'split-screen'
      )
    ) {
      updateVideoStyle({
        bgType: 'gradient',
        gradientPreset: 'ocean',
        animationStyle: 'split-screen',
        glowSize: 0,
        visualizerType: 'none',
        activeWordColor: '#ffffff',
        inactiveWordColor: 'rgba(255,255,255,0.35)',
      });
    }
  }, [
    videoStyle.preset,
    videoStyle.bgType,
    videoStyle.gradientPreset,
    videoStyle.animationStyle,
    videoStyle.fxOverlay,
    updateVideoStyle,
  ]);

  // Автоматически извлекаем цвета обложки при открытии панели экспорта,
  // если coverUrl есть, а coverColors ещё не вычислены (например после перезагрузки страницы)
  useEffect(() => {
    let cancelled = false;
    if (coverUrl) {
      extractDominantColors(coverUrl)
        .then((palette) => {
          if (!cancelled) setCoverColors(palette);
        })
        .catch(() => {/* silently ignore */});
    } else {
      setCoverColors(null);
    }
    return () => {
      cancelled = true;
    };
  }, [coverUrl, setCoverColors]);

  // Профайлер FPS
  useEffect(() => {
    fpsIntervalRef.current = setInterval(() => {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
      
      setBgTimeMs(bgTimeRef.current);
      setParticlesTimeMs(particlesTimeRef.current);
      setLyricsTimeMs(lyricsTimeRef.current);
      setVisualizerTimeMs(visualizerTimeRef.current);
      setFrameTimeMs(frameTimeRef.current);
    }, 1000);

    return () => clearInterval(fpsIntervalRef.current);
  }, []);

  // Генерация частиц Live Preview
  const previewParticlesRef = useRef<PreviewParticle[]>([]);
  const setupPreviewParticles = (w: number, h: number) => {
    previewParticlesRef.current = [];
    const pCount = quality === 'low' ? 0 : quality === 'medium' ? 12 : quality === 'high' ? 30 : 65;

    for (let i = 0; i < pCount; i++) {
      if (videoStyle.fxOverlay === 'snow') {
        previewParticlesRef.current.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.3) * 0.5,
          vy: Math.random() * 0.8 + 0.3,
          radius: Math.random() * 2 + 0.8,
          alpha: Math.random() * 0.5 + 0.1,
        });
      } else if (videoStyle.fxOverlay === 'lens-dust') {
        previewParticlesRef.current.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.15,
          radius: Math.random() * 4 + 1.5,
          alpha: Math.random() * 0.15 + 0.03,
          color: 'rgba(245, 195, 100, ',
        });
      } else if (videoStyle.fxOverlay === 'fluid-gradient') {
        const palette = [
          coverColors?.primary || '#4f46e5',
          coverColors?.glow || '#db2777',
          coverColors?.secondary || '#06b6d4',
        ];
        const particle: PreviewParticle = {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          radius: Math.random() * (w * 0.3) + w * 0.1,
          alpha: quality === 'ultra' ? Math.random() * 0.12 + 0.05 : Math.random() * 0.08 + 0.02,
          color: palette[i % palette.length],
          phase: Math.random() * Math.PI * 2,
          orbit: Math.random() * (w * 0.1) + w * 0.03,
          speed: Math.random() * 0.28 + 0.08,
          stretch: Math.random() * 0.7 + 0.8,
        };
        particle.baseX = particle.x;
        particle.baseY = particle.y;
        previewParticlesRef.current.push(particle);
      }
    }
  };

  useEffect(() => {
    const w = videoStyle.aspectRatio === '9:16' ? 720 : 1280;
    const h = videoStyle.aspectRatio === '9:16' ? 1280 : 720;
    setupPreviewParticles(w, h);
  }, [videoStyle.fxOverlay, videoStyle.aspectRatio, quality, coverColors]);

  // Preload cover image
  const [previewCoverImg, setPreviewCoverImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (coverUrl) {
      const img = new Image();
      if (coverUrl && !coverUrl.startsWith('blob:')) {
        img.crossOrigin = 'Anonymous';
      }
      img.onload = () => setPreviewCoverImg(img);
      img.src = coverUrl;
    } else {
      setPreviewCoverImg(null);
    }
  }, [coverUrl]);

  // Live Visual Preview Canvas Renderer Loop
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let activeFrameId: number;

    const renderPreview = () => {
      const totalStart = performance.now();
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      (ctx as any).imageSmoothingQuality = 'high';

      // --- 1. BACKGROUND DRAWING TIMING ---
      const bgStart = performance.now();
      if (videoStyle.bgType === 'particles') {
        const sColor = coverColors ? coverColors.secondary : '#0b0314';
        ctx.fillStyle = sColor;
        ctx.fillRect(0, 0, width, height);

        previewParticlesRef.current.forEach((p) => {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > width) p.vx *= -1;
          if (p.y < 0 || p.y > height) p.vy *= -1;

          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = coverColors ? `rgba(${parseInt(coverColors.glow.slice(1, 3), 16)}, ${parseInt(coverColors.glow.slice(3, 5), 16)}, ${parseInt(coverColors.glow.slice(5, 7), 16)}, ${p.alpha})` : `rgba(168, 85, 247, ${p.alpha})`;
          ctx.fill();
        });
      } else {
        const renderFrame: RenderFrame = {
          time: Date.now() / 1000,
          width,
          height,
          pulseFactor: 1 + Math.sin(Date.now() * 0.002) * 0.03,
          fft: new Uint8Array(64),
          styleOptions: videoStyle,
          coverColors,
          coverCanvas: null,
          coverImg: previewCoverImg,
          isCoverReady: !!previewCoverImg,
          resolution: resolution,
          audioFileName: audioFileName || '',
          quality,
        };
        renderBackground(ctx, renderFrame, null);
      }
      const bgEnd = performance.now();
      bgTimeRef.current = Number((bgEnd - bgStart).toFixed(1));

      // --- 2. PARTICLES DRAWING TIMING ---
      const particlesStart = performance.now();
      const actualOverlay = quality === 'low' ? 'none' : videoStyle.fxOverlay;
      if (actualOverlay !== 'none') {
        previewParticlesRef.current.forEach((p) => {
          if (actualOverlay === 'snow') {
            p.y += p.vy;
            p.x += p.vx;
            if (p.y > height) {
              p.y = -10;
              p.x = Math.random() * width;
            }
            ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
          } else if (actualOverlay === 'lens-dust') {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0 || p.x > width) p.vx *= -1;
            if (p.y < 0 || p.y > height) p.vy *= -1;

            ctx.fillStyle = p.color + `${p.alpha})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
          } else if (actualOverlay === 'fluid-gradient') {
            const time = Date.now() / 1000;
            if (quality === 'ultra') {
              const phase = p.phase || 0;
              const orbit = p.orbit || width * 0.06;
              const speed = p.speed || 0.14;
              p.x = (p.baseX || p.x) + Math.cos(time * speed + phase) * orbit + Math.sin(time * speed * 0.63 + phase * 1.7) * orbit * 0.55;
              p.y = (p.baseY || p.y) + Math.sin(time * speed * 0.82 + phase) * orbit * 0.72 + Math.cos(time * speed * 0.47 + phase * 1.3) * orbit * 0.35;
            } else {
              p.x += p.vx * 0.4;
              p.y += p.vy * 0.4;
              if (p.x < 0 || p.x > width) p.vx *= -1;
              if (p.y < 0 || p.y > height) p.vy *= -1;
            }

            const breath = 1 + Math.sin(time * ((p.speed || 0.12) * 1.9) + (p.phase || 0)) * (quality === 'ultra' ? 0.16 : 0.05);
            const radius = p.radius * breath;
            const radGrad = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, radius);
            const color = p.color || '#4f46e5';
            const alpha = quality === 'ultra' ? Math.min(0.18, p.alpha) : Math.min(0.1, p.alpha);
            radGrad.addColorStop(0, color.startsWith('#') ? hexToRgba(color, alpha) : 'rgba(79, 70, 229, 0.08)');
            radGrad.addColorStop(0.42, color.startsWith('#') ? hexToRgba(color, alpha * 0.38) : 'rgba(79, 70, 229, 0.03)');
            radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = radGrad;
            ctx.beginPath();
            if (quality === 'ultra') {
              ctx.ellipse(
                p.x,
                p.y,
                radius * (p.stretch || 1),
                radius / Math.max(0.7, p.stretch || 1),
                time * ((p.speed || 0.12) * 0.35) + (p.phase || 0),
                0,
                Math.PI * 2
              );
            } else {
              ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            }
            ctx.fill();
          }
        });
      }
      const particlesEnd = performance.now();
      particlesTimeRef.current = Number((particlesEnd - particlesStart).toFixed(1));

      // --- 3. VISUALIZERS DRAWING TIMING ---
      const visualizerStart = performance.now();
      if (videoStyle.visualizerType === 'bars') {
        const barWidth = width / 32;
        ctx.fillStyle = coverColors ? `rgba(${parseInt(coverColors.glow.slice(1, 3), 16)}, ${parseInt(coverColors.glow.slice(3, 5), 16)}, ${parseInt(coverColors.glow.slice(5, 7), 16)}, 0.12)` : 'rgba(139, 92, 246, 0.12)';
        for (let i = 0; i < 32; i++) {
          const barHeight = Math.abs(Math.sin(i * 0.2 + Date.now() * 0.002)) * (height * 0.14);
          ctx.fillRect(i * barWidth, height - barHeight, barWidth - 1, barHeight);
        }
      } else if (videoStyle.visualizerType === 'circle') {
        const circleX = videoStyle.aspectRatio === '9:16' ? width / 2 : width * 0.18;
        const circleY = videoStyle.aspectRatio === '9:16' ? height * 0.35 : height - 120;
        const baseRadius = 55;

        ctx.strokeStyle = coverColors ? coverColors.glow : 'rgba(168, 85, 247, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 64; i++) {
          const angle = (i / 64) * Math.PI * 2;
          const offset = Math.abs(Math.sin(i * 0.2 + Date.now() * 0.002)) * 8;
          const r = baseRadius + offset;
          const x = circleX + Math.cos(angle) * r;
          const y = circleY + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      const visualizerEnd = performance.now();
      visualizerTimeRef.current = Number((visualizerEnd - visualizerStart).toFixed(1));

      // --- 4. LYRICS TYPOGRAPHY DRAWING TIMING ---
      const lyricsStart = performance.now();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const isSoftSplitPreset = videoStyle.preset === 'apple-music' || videoStyle.preset === 'minimal-cinema';
      const previewFontFamily = isSoftSplitPreset ? MODERN_VIDEO_FONT : videoStyle.fontFamily;
      const previewMainWeight = isSoftSplitPreset ? 600 : 'bold';
      ctx.font = `${previewMainWeight} ${videoStyle.fontSize}px ${previewFontFamily}`;

      let glowSize = videoStyle.glowSize;
      if (quality === 'low') {
        glowSize = 0;
      } else if (quality === 'medium') {
        glowSize = Math.min(4, videoStyle.glowSize);
      }

      if (glowSize > 0) {
        ctx.shadowColor = coverColors ? coverColors.glow : videoStyle.glowColor;
        ctx.shadowBlur = glowSize;
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.strokeStyle = videoStyle.strokeColor;
      ctx.lineWidth = videoStyle.strokeWidth;
      const previewActiveColor = videoStyle.preset === 'spotify' ? '#f8fff8' : videoStyle.activeWordColor;
      const previewInactiveColor = videoStyle.preset === 'spotify' ? 'rgba(255,255,255,0.64)' : videoStyle.inactiveWordColor;

      if (videoStyle.animationStyle === 'split-screen') {
        // Рендерим левую часть обложки
        const isVertical = videoStyle.aspectRatio === '9:16';
        const isSquare = videoStyle.aspectRatio === '1:1';
        const splitY = isVertical ? height * 0.38 : (isSquare ? height * 0.46 : height);
        
        let leftRect = (isVertical || isSquare) ? { x: 0, y: 0, w: width, h: splitY } : { x: 0, y: 0, w: width / 2, h: height };
        let rightRect = (isVertical || isSquare) ? { x: 0, y: splitY, w: width, h: height - splitY } : { x: width / 2, y: 0, w: width / 2, h: height };
        
        let previewSize = Math.min(leftRect.w * 0.7, leftRect.h * 0.55);
        if (isVertical) {
          previewSize = Math.min(leftRect.w * 0.48, leftRect.h * 0.52);
        } else if (isSquare) {
          previewSize = Math.min(leftRect.w * 0.52, leftRect.h * 0.58);
        }
        
        const coverX = leftRect.x + (leftRect.w - previewSize) / 2;
        const coverY = leftRect.y + (leftRect.h - previewSize) / 2 + (isVertical ? 15 : (isSquare ? 8 : -60));

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 20;
        ctx.shadowOffsetY = 10;
        ctx.beginPath();
        ctx.roundRect(coverX, coverY, previewSize, previewSize, 16);
        ctx.fill();
        ctx.clip();
        
        if (previewCoverImg) {
          ctx.drawImage(previewCoverImg, coverX, coverY, previewSize, previewSize);
        } else {
          ctx.fillStyle = coverColors ? coverColors.primary : '#333333';
          ctx.fillRect(coverX, coverY, previewSize, previewSize);
        }
        ctx.restore();

        let artist = 'Unknown Artist';
        let title = 'Karaoke Track';
        
        if (audioFileName) {
          const cleanName = audioFileName.replace(/\.[^/.]+$/, '');
          const parts = cleanName.split(' - ');
          if (parts.length >= 2) {
            artist = parts[0].trim();
            title = parts.slice(1).join(' - ').trim();
          } else {
            title = cleanName.trim();
          }
        }

        const offsetText = (isVertical || isSquare) ? 25 : 40;
        const textY = coverY + previewSize + offsetText;
        const textX = leftRect.x + leftRect.w / 2;
        
        const titleFontSize = (isVertical || isSquare) ? 18 : 24;
        const artistFontSize = (isVertical || isSquare) ? 12 : 16;
        const offsetArtist = (isVertical || isSquare) ? 20 : 25;
        const offsetBar = (isVertical || isSquare) ? 22 : 35;
        
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${titleFontSize}px ${previewFontFamily}`;
        ctx.fillText(title, textX, textY, leftRect.w * 0.88);
        
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `500 ${artistFontSize}px ${previewFontFamily}`;
        ctx.fillText(artist, textX, textY + offsetArtist, leftRect.w * 0.88);

        // Прогресс
        if (!isVertical && !isSquare) {
          const barWidth = previewSize * 0.9;
          const barY = textY + offsetArtist + offsetBar;
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.beginPath();
          ctx.roundRect(textX - barWidth / 2, barY, barWidth, 4, 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.roundRect(textX - barWidth / 2, barY, barWidth * 0.3, 4, 2);
          ctx.fill();
        }

        // Правая часть (текст)
        ctx.save();
        ctx.beginPath();
        ctx.rect(rightRect.x, rightRect.y, rightRect.w, rightRect.h);
        ctx.clip();

        const centerX = rightRect.x + rightRect.w / 2;
        
        let centerY = rightRect.y + rightRect.h / 2;
        if (isVertical) {
          centerY -= 180; // 180px сдвиг для 720p превью
        } else if (isSquare) {
          centerY -= 80; // 80px сдвиг для 720p превью
        }
        
        // Рисуем список строк
        const linesMock = ["Прошлая строка", "Караоке в браузере", "Будущая строка"];
        linesMock.forEach((txt, i) => {
          const relIdx = i - 1;
          const y = centerY + relIdx * (isVertical || isSquare ? 75 : 60);
          const isPrimary = relIdx === 0;
          
          const baseScale = (isVertical || isSquare) ? 0.82 : 0.9;
          const scale = isPrimary ? (baseScale + 0.18) : baseScale;
          
          ctx.save();
          ctx.translate(centerX, y);
          ctx.scale(scale, scale);
          
          ctx.globalAlpha = isPrimary ? 1 : 0.4;
          ctx.font = `${previewMainWeight} ${videoStyle.fontSize}px ${previewFontFamily}`;
          ctx.fillStyle = isPrimary ? previewActiveColor : previewInactiveColor;
          ctx.fillText(txt, 0, 0);
          ctx.restore();
        });
        
        ctx.restore();

        // Отрисовка прогресс-бара внизу для вертикального и квадратного видео в Live Preview
        if (isVertical || isSquare) {
          const barWidth = width * 0.8;
          const barHeight = 4;
          const barX = (width - barWidth) / 2;
          const barY = height - (isVertical ? 180 : 130);

          // Фон бара
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.beginPath();
          ctx.roundRect(barX, barY, barWidth, barHeight, barHeight / 2);
          ctx.fill();

          // Заполненная часть (mock progress 30%)
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.roundRect(barX, barY, barWidth * 0.3, barHeight, barHeight / 2);
          ctx.fill();

          // Временные метки (mock 01:12 / 03:40)
          const curTimeStr = '01:12';
          const totalTimeStr = '03:40';

          ctx.save();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.font = `500 13px ${previewFontFamily}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(curTimeStr, barX, barY + 10);
          ctx.textAlign = 'right';
          ctx.fillText(totalTimeStr, barX + barWidth, barY + 10);
          ctx.restore();
        }
      } else {
        const sampleText1 = "Караоке";
        const sampleText2 = " в твоем ";
        const sampleText3 = "браузере";
        const fullText = sampleText1 + sampleText2 + sampleText3;
        const totalWidth = ctx.measureText(fullText).width;
        
        let startX = width / 2 - totalWidth / 2;
        const textY = videoStyle.aspectRatio === '9:16' ? height * 0.62 : height / 2;

        let yOffset = 0;
        if (videoStyle.animationStyle === 'kinetic') {
          const previewBounce = videoStyle.preset === 'tiktok-neon' ? 5 : 8;
          yOffset = -Math.abs(Math.sin(Date.now() * 0.003)) * previewBounce;
        }

        const width1 = ctx.measureText(sampleText1).width;
        ctx.fillStyle = previewActiveColor;
        ctx.fillText(sampleText1, startX + width1 / 2, textY + yOffset);
        if (videoStyle.strokeWidth > 0) {
          ctx.strokeText(sampleText1, startX + width1 / 2, textY + yOffset);
        }
        startX += width1;

        const width2 = ctx.measureText(sampleText2).width;
        ctx.fillStyle = previewInactiveColor;
        ctx.fillText(sampleText2, startX + width2 / 2, textY);
        if (videoStyle.strokeWidth > 0) {
          ctx.strokeText(sampleText2, startX + width2 / 2, textY);
        }

        ctx.save();
        ctx.beginPath();
        const fillFactor = (Math.sin(Date.now() * 0.002) + 1) / 2;
        ctx.rect(startX, textY - videoStyle.fontSize, width2 * fillFactor, videoStyle.fontSize * 2);
        ctx.clip();
        ctx.fillStyle = previewActiveColor;
        ctx.fillText(sampleText2, startX + width2 / 2, textY);
        if (videoStyle.strokeWidth > 0) {
          ctx.strokeText(sampleText2, startX + width2 / 2, textY);
        }
        ctx.restore();
        startX += width2;

        const width3 = ctx.measureText(sampleText3).width;
        ctx.fillStyle = previewInactiveColor;
        ctx.fillText(sampleText3, startX + width3 / 2, textY);
        if (videoStyle.strokeWidth > 0) {
          ctx.strokeText(sampleText3, startX + width3 / 2, textY);
        }

        ctx.shadowBlur = 0;

        if (previewCoverImg) {
          const size = coverSize;
          const coverX = videoStyle.aspectRatio === '9:16' ? width / 2 - size / 2 : 30;
          const coverY = videoStyle.aspectRatio === '9:16' ? height * 0.35 - size / 2 : height - size - 30;

          ctx.save();
          ctx.beginPath();
          ctx.roundRect(coverX, coverY, size, size, size * 0.15);
          ctx.clip();
          ctx.drawImage(previewCoverImg, coverX, coverY, size, size);
          ctx.restore();

          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(coverX, coverY, size, size, size * 0.15);
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = `18px ${videoStyle.fontFamily}`;
      ctx.fillText('CINEMA ENGINE 2.0', width / 2, height * 0.85);
      const lyricsEnd = performance.now();
      lyricsTimeRef.current = Number((lyricsEnd - lyricsStart).toFixed(1));

      const totalEnd = performance.now();
      frameTimeRef.current = Number((totalEnd - totalStart).toFixed(1));
      frameCountRef.current++;

      activeFrameId = requestAnimationFrame(renderPreview);
    };

    renderPreview();

    return () => cancelAnimationFrame(activeFrameId);
  }, [videoStyle, previewCoverImg, coverColors, coverSize, quality]);



  const startExport = async () => {
    if (!audioUrl) {
      alert('Сначала загрузите аудиофайл!');
      return;
    }
    if (timedLinesCount === 0) {
      alert('Сначала разметьте хотя бы одну строку с таймингом!');
      return;
    }

    const activeAudioEl = audioRef.current;
    if (!activeAudioEl) {
      alert('Ошибка: Аудиоплеер не инициализирован.');
      return;
    }

    setError(null);
    setVideoBlob(null);
    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl);
      setVideoObjectUrl(null);
    }

    setIsRecording(true);
    setProgress(0);
    setSecondsRecorded(0);
    setExportEta(null);
    setExportSpeedFps(0);
    setExportPhase('initializing');
    setWarningMessage(null);
    setRenderLogs([]);
    renderLogIdRef.current = 0;
    codecPressureHitsRef.current = 0;
    exportStartTimeRef.current = performance.now();
    lastProgressUiUpdateRef.current = 0;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const exportStartedAt = Date.now();
    const exportMetadata = {
      preset: videoStyle.preset,
      animationStyle: videoStyle.animationStyle,
      fxOverlay: videoStyle.fxOverlay,
      bgType: videoStyle.bgType,
      resolution,
      format: videoFormat,
      fps: exportFps,
      bitrateKbps: customBitrate,
      quality,
      lines: lines.length,
      timedLines: timedLinesCount,
      hasCover: Boolean(coverUrl),
      title: (currentProjectTitle || '').trim() || getDefaultProjectTitle(audioFileName, lines, language),
    };

    trackAppEvent({
      eventName: 'video_export_started',
      userId: user?.id,
      telegramId: userProfile?.telegram_id,
      appMode: 'editor',
      metadata: exportMetadata,
    });

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const fileNameToUse = (currentProjectTitle || '').trim() || getDefaultProjectTitle(audioFileName, lines, language);
      exportVideo({
        lines,
        audioElement: activeAudioEl,
        audioFileName: fileNameToUse,
        resolution,
        styleOptions: videoStyle,
        format: videoFormat,
        coverUrl,
        coverColors,
        audioCtx,
        signal: controller.signal,
        quality,
        language,
        fps: exportFps,
        bitrateKbps: customBitrate,
        onStatus: (status) => {
          setExportPhase(status);
          if (status === 'encoding' || status === 'recording') {
            exportStartTimeRef.current = performance.now();
            lastProgressUiUpdateRef.current = 0;
            setExportEta(null);
            setExportSpeedFps(0);
          }
        },
        onWarning: (msg) => {
          setWarningMessage(msg);
        },
        onRenderLog: (event) => {
          const entry: RenderLogEntry = {
            id: ++renderLogIdRef.current,
            time: new Date().toLocaleTimeString(),
            ...event,
          };
          if (event.tag === 'perf' && event.data) {
            const videoEncodeMs = typeof event.data.videoEncodeMs === 'number' ? event.data.videoEncodeMs : 0;
            const backpressureMs = typeof event.data.backpressureMs === 'number' ? event.data.backpressureMs : 0;
            if (Math.max(videoEncodeMs, backpressureMs) > 2500) {
              codecPressureHitsRef.current += 1;
              if (codecPressureHitsRef.current === 2) {
                setWarningMessage(language === 'ru'
                  ? 'Похоже, упираемся не в анимации, а в браузерный H.264-кодек. Если экспорт сильно тормозит, попробуйте 720p, меньший битрейт или профиль «Надежный».'
                  : 'Looks like the browser H.264 encoder is the bottleneck, not the animation. If export is slow, try 720p, a lower bitrate, or the Reliable profile.'
                );
              }
            }
          }
          console.log('[Render]', event.tag, event.message, event.data || {});
          setRenderLogs((prev) => {
            const next = [entry, ...prev];
            const pinnedTags = new Set(['worker', 'config', 'codec']);
            const pinned = next
              .filter((log) => pinnedTags.has(log.tag))
              .filter((log, index, logs) => logs.findIndex((item) => item.tag === log.tag && item.message === log.message) === index);
            const recent = next
              .filter((log) => !pinnedTags.has(log.tag))
              .slice(0, 24);
            return [...pinned, ...recent].slice(0, 32);
          });
        },
        onProgress: (percent, seconds) => {
          const now = performance.now();
          if (now - lastProgressUiUpdateRef.current < 120 && percent < 0.995) {
            return;
          }
          lastProgressUiUpdateRef.current = now;

          setProgress(percent);
          setSecondsRecorded(seconds);

          // Расчёт ETA и скорости
          if (percent > 0.02) {
            const elapsed = (now - exportStartTimeRef.current) / 1000;
            const estimatedTotal = elapsed / percent;
            const remaining = Math.max(0, estimatedTotal - elapsed);
            const fps = seconds / elapsed * exportFps;
            setExportSpeedFps(Math.round(fps));
            if (remaining > 5) {
              const mins = Math.floor(remaining / 60);
              const secs = Math.round(remaining % 60);
              setExportEta(
                mins > 0
                  ? `~${mins}${language === 'ru' ? 'м' : 'm'} ${secs}${secondsUnit}`
                  : `~${secs}${secondsUnit}`
              );
            } else {
              setExportEta(language === 'ru' ? 'почти готово' : 'almost done');
            }
          }
        },
        onComplete: (blob) => {
          const url = URL.createObjectURL(blob);
          setVideoBlob(blob);
          setVideoObjectUrl(url);
          setIsRecording(false);
          trackAppEvent({
            eventName: 'video_export_completed',
            userId: user?.id,
            telegramId: userProfile?.telegram_id,
            appMode: 'editor',
            metadata: {
              ...exportMetadata,
              blobSize: blob.size,
              durationMs: Date.now() - exportStartedAt,
            },
          });
        },
        onError: (err) => {
          if (controller.signal.aborted) return;
          trackAppEvent({
            eventName: 'video_export_failed',
            userId: user?.id,
            telegramId: userProfile?.telegram_id,
            appMode: 'editor',
            metadata: {
              ...exportMetadata,
              error: err.message || 'Unknown export error',
              durationMs: Date.now() - exportStartedAt,
            },
          });
          setError(err.message || 'Неизвестная ошибка при экспорте видео');
          setIsRecording(false);
        },
      });
    } catch (err: any) {
      setError(err.message || 'Failed to initialize audio capture context');
      setIsRecording(false);
      trackAppEvent({
        eventName: 'video_export_failed',
        userId: user?.id,
        telegramId: userProfile?.telegram_id,
        appMode: 'editor',
        metadata: {
          ...exportMetadata,
          error: err.message || 'Failed to initialize audio capture context',
          durationMs: Date.now() - exportStartedAt,
        },
      });
    }
  };

  const cancelExport = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    trackAppEvent({
      eventName: 'video_export_cancelled',
      userId: user?.id,
      telegramId: userProfile?.telegram_id,
      appMode: 'editor',
      metadata: {
        progress,
        secondsRecorded,
        phase: exportPhase,
      },
    });
    setIsRecording(false);
    setProgress(0);
  };

  const downloadVideoFile = () => {
    if (!videoObjectUrl || !videoBlob) return;

    const cleanName = (currentProjectTitle || '').trim() || getDefaultProjectTitle(audioFileName, lines, language);
    
    const ext = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
    const a = document.createElement('a');
    a.href = videoObjectUrl;
    a.download = `${cleanName}_karaoke.${ext}`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const getAspectRatioClass = () => {
    if (videoStyle.aspectRatio === '9:16') return 'w-full max-w-[215px] aspect-[9/16]';
    if (videoStyle.aspectRatio === '1:1') return 'w-full max-w-[380px] aspect-square';
    return 'w-full max-w-[380px] aspect-video';
  };

  return (
    <div
      className={`rounded-2xl p-6 border shadow-sm transition-all ${
        theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
      }`}
    >
      <div className="flex items-center gap-2 mb-4 border-b border-zinc-200/10 pb-3">
        <Film className="text-violet-500 dark:text-violet-400" size={20} />
        <h3 className="font-semibold text-lg">Генератор Видео 3.0 (Cinema Engine)</h3>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs flex items-center gap-2 mb-4">
          <XCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!audioUrl ? (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs">
          <AlertCircle size={16} className="shrink-0" />
          <span>Пожалуйста, сначала загрузите аудиофайл на вкладке ввода текста.</span>
        </div>
      ) : timedLinesCount === 0 ? (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-xs">
          <AlertCircle size={16} className="shrink-0" />
          <span>Для создания видео необходимо разметить хотя бы одну строку с таймингом.</span>
        </div>
      ) : !isRecording && !videoObjectUrl ? (
        <div className="flex flex-col gap-6">
          
          {/* Real-time Adaptive Preview Container */}
          <div className="space-y-2 flex flex-col items-center">
            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5 self-start">
              <Eye size={14} className="text-violet-500" /> {theme === 'dark' ? 'Интерактивный предпросмотр' : 'Interactive Multi-format Preview'}
            </h4>
            <div 
              className={`relative rounded-xl overflow-hidden bg-black border border-zinc-200/10 flex items-center justify-center shadow-inner transition-all duration-500 mx-auto ${getAspectRatioClass()}`}
            >
              <canvas
                ref={previewCanvasRef}
                width={videoStyle.aspectRatio === '9:16' ? 720 : videoStyle.aspectRatio === '1:1' ? 720 : 1280}
                height={videoStyle.aspectRatio === '9:16' ? 1280 : videoStyle.aspectRatio === '1:1' ? 720 : 720}
                className="w-full h-full object-cover bg-[#05020a]"
              />
            </div>

            {/* РАСШИРЕННЫЙ ВСТРОЕННЫЙ ПОСЛОЙНЫЙ ПРОФАЙЛЕР (PER-LAYER PROFILER) */}
            <div className="w-full max-w-md mt-2 p-4 rounded-xl border border-zinc-200/5 bg-zinc-500/5 flex flex-col gap-2 text-[10px] font-mono">
              <div className="flex justify-between items-center border-b border-zinc-200/5 pb-1.5">
                <span className="text-zinc-400 flex items-center gap-1 font-bold">
                  <Activity size={12} className="text-violet-500 animate-pulse" /> Render Performance Monitor:
                </span>
                <div className="flex gap-2.5">
                  <span>FPS: <strong className={fps < 45 ? "text-yellow-500" : "text-green-500 font-bold"}>{fps}</strong></span>
                  <span>Total: <strong className={frameTimeMs > 10 ? "text-yellow-500" : "text-green-500 font-bold"}>{frameTimeMs}ms</strong></span>
                </div>
              </div>
              
              {/* Детализация слоев рендеринга (Per-layer timings) */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-zinc-500">
                <div className="flex justify-between">
                  <span>Background:</span>
                  <span className="font-bold text-zinc-400">{bgTimeMs}ms</span>
                </div>
                <div className="flex justify-between">
                  <span>Particles:</span>
                  <span className="font-bold text-zinc-400">{particlesTimeMs}ms</span>
                </div>
                <div className="flex justify-between">
                  <span>Lyrics Layer:</span>
                  <span className="font-bold text-zinc-400">{lyricsTimeMs}ms</span>
                </div>
                <div className="flex justify-between">
                  <span>Visualizer:</span>
                  <span className="font-bold text-zinc-400">{visualizerTimeMs}ms</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick export profiles */}
          <div className="space-y-3 border-b border-zinc-200/10 pb-5">
            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
              <SlidersHorizontal size={14} className="text-violet-500" /> {exportUi.profilesTitle}
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {(['stable', 'balanced', 'sharp', 'premium'] as ExportProfile[]).map((profile) => {
                const profileInfo = exportUi.profiles[profile];
                const isActive = selectedProfile === profile;
                const isRecommended = recommendedProfile === profile;

                return (
                  <button
                    key={profile}
                    type="button"
                    onClick={() => applyExportProfile(profile)}
                    className={`text-left rounded-2xl border p-4 transition-all active:scale-[0.98] ${
                      isActive
                        ? theme === 'dark'
                          ? 'border-violet-500/60 bg-violet-500/12 text-zinc-100 shadow-md shadow-violet-500/10'
                          : 'border-violet-300/80 bg-violet-50/85 text-zinc-900 shadow-md shadow-violet-200/45'
                        : theme === 'dark'
                          ? 'border-white/10 bg-zinc-900/55 hover:border-violet-500/35 hover:bg-zinc-900/80 text-zinc-200'
                          : 'border-white/70 bg-white/70 hover:border-violet-300/70 hover:bg-white/90 text-zinc-800 shadow-sm shadow-violet-200/25'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className={`text-sm font-extrabold ${isActive ? 'text-violet-600 dark:text-violet-300' : 'text-inherit'}`}>
                          {profileInfo.title}
                        </p>
                        <p className={`mt-1 text-[10px] font-bold uppercase tracking-wider ${
                          isActive ? 'text-violet-500/80 dark:text-violet-200/75' : 'text-zinc-500 dark:text-zinc-400'
                        }`}>
                          {profileInfo.meta}
                        </p>
                      </div>

                      {isRecommended && (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[9px] font-extrabold uppercase tracking-wider text-emerald-500 dark:text-emerald-400">
                          {exportUi.recommended}
                        </span>
                      )}
                    </div>

                    <p className={`mt-3 text-[11px] leading-relaxed ${
                      isActive ? 'text-zinc-600 dark:text-zinc-200/80' : 'text-zinc-500 dark:text-zinc-400'
                    }`}>
                      {profileInfo.desc}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold ${
              theme === 'dark'
                ? 'border-white/10 bg-zinc-900/45 text-zinc-300'
                : 'border-white/70 bg-white/65 text-zinc-600 shadow-sm shadow-violet-200/25'
            }`}>
              <span className="font-extrabold text-violet-500 dark:text-violet-300">
                {selectedProfile === 'custom' ? exportUi.customSettings : exportUi.currentSetup}
              </span>
              <span>{resolution}</span>
              <span className="text-zinc-400">·</span>
              <span>{exportFps} FPS</span>
              <span className="text-zinc-400">·</span>
              <span>{customBitrate / 1000} Mbps</span>
              <span className="text-zinc-400">·</span>
              <span>{videoFormat.toUpperCase()}</span>
              <span className="text-zinc-400">·</span>
              <span>{videoStyle.fxOverlay === 'none' ? exportUi.effectsOff : exportUi.effectsOn}</span>
            </div>
          </div>

          {/* Visual Customizer Options */}
          <div className="space-y-4 border-b border-zinc-200/10 pb-5">
            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5 mb-3">
              <Palette size={14} className="text-violet-500" /> Настройки Субтитров и Фона
              {coverColors && (
                <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400 normal-case tracking-normal">
                  <span
                    className="w-3 h-3 rounded-full border border-white/20 shadow-sm flex-shrink-0"
                    style={{ backgroundColor: coverColors.glow }}
                    title={`Цвет обложки: ${coverColors.glow}`}
                  />
                  Палитра обложки активна
                </span>
              )}
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* PRESET-FIRST DESIGN SELECTOR */}
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-xs font-bold text-zinc-400 flex items-center gap-1.5">
                  <LayoutGrid size={14} className="text-violet-500" /> {exportUi.presetLabel}
                </label>
                <select
                  value={videoStyle.preset}
                  onChange={(e) => {
                    markCustomProfile();
                    updateVideoStyle({ preset: e.target.value as any });
                  }}
                  className={`p-2.5 rounded-xl text-xs border font-bold focus:outline-none transition-all bg-zinc-900 border-zinc-800 text-violet-400`}
                >
                  <option value="apple-music">🎵 {exportUi.presets.apple}</option>
                  <option value="spotify">🟢 {exportUi.presets.spotify}</option>
                  <option value="tiktok-neon">⚡ {exportUi.presets.tiktok}</option>
                  <option value="classic-karaoke">🎤 {exportUi.presets.classic}</option>
                  <option value="minimal-cinema">🎬 {exportUi.presets.cinema}</option>
                </select>
              </div>

              {/* RENDER QUALITY MANAGER */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-zinc-400">{exportUi.exportMode}</label>
                <select
                  value={quality}
                  onChange={(e) => {
                    markCustomProfile();
                    setQuality(e.target.value as QualityPreset);
                  }}
                  className={`p-2.5 rounded-xl text-xs border focus:outline-none transition-all bg-zinc-900 border-zinc-800 text-zinc-300`}
                >
                  <option value="low">{exportUi.quality.low}</option>
                  <option value="medium">{exportUi.quality.medium}</option>
                  <option value="high">{exportUi.quality.high}</option>
                  <option value="ultra">{exportUi.quality.ultra}</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-zinc-400">
                  {language === 'ru' ? 'Эффекты фона' : 'Background effects'}
                </label>
                <select
                  value={videoStyle.fxOverlay}
                  onChange={(e) => {
                    markCustomProfile();
                    updateVideoStyle({ fxOverlay: e.target.value as any });
                  }}
                  className={`p-2.5 rounded-xl text-xs border focus:outline-none transition-all bg-zinc-900 border-zinc-800 text-zinc-300`}
                >
                  <option value="none">{language === 'ru' ? 'Без эффектов' : 'No effects'}</option>
                  <option value="lens-dust">{language === 'ru' ? 'Кинопыль' : 'Cinematic dust'}</option>
                  <option value="snow">{language === 'ru' ? 'Снег / частицы' : 'Snow / particles'}</option>
                  <option value="fluid-gradient">{language === 'ru' ? 'Жидкий градиент' : 'Liquid gradient'}</option>
                </select>
              </div>

              {/* Aspect Ratio Selection */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-zinc-400">{exportUi.publishTarget}</label>
                <select
                  value={videoStyle.aspectRatio}
                  onChange={(e) => {
                    markCustomProfile();
                    updateVideoStyle({ aspectRatio: e.target.value as any });
                  }}
                  className={`p-2.5 rounded-xl text-xs border focus:outline-none transition-all bg-zinc-900 border-zinc-800 text-zinc-300`}
                >
                  <option value="16:9">{exportUi.aspect.landscape}</option>
                  <option value="9:16">{exportUi.aspect.vertical}</option>
                  <option value="1:1">{exportUi.aspect.square}</option>
                </select>
              </div>

              {/* FPS Selection */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-zinc-400">{exportUi.smoothness}</label>
                <select
                  value={exportFps}
                  onChange={(e) => {
                    markCustomProfile();
                    setExportFps(Number(e.target.value) as 24 | 30 | 60);
                  }}
                  className={`p-2.5 rounded-xl text-xs border focus:outline-none transition-all bg-zinc-900 border-zinc-800 text-zinc-300`}
                >
                  <option value={24}>{exportUi.fps.low}</option>
                  <option value={30}>{exportUi.fps.standard}</option>
                  <option value={60}>{exportUi.fps.smooth}</option>
                </select>
              </div>

              <details className="group sm:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/70">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs font-bold text-zinc-300">
                  <span className="flex items-center gap-2">
                    <SlidersHorizontal size={14} className="text-violet-400" />
                    {exportUi.advanced}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 group-open:hidden">
                    {exportUi.open}
                  </span>
                  <span className="hidden text-[10px] uppercase tracking-wider text-zinc-500 group-open:inline">
                    {exportUi.hide}
                  </span>
                </summary>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-zinc-800 p-3">
                  {/* Bitrate Selection */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-zinc-400">{exportUi.fileSharpness}</label>
                    <select
                      value={customBitrate}
                      onChange={(e) => {
                        markCustomProfile();
                        setCustomBitrate(Number(e.target.value));
                      }}
                      className={`p-2.5 rounded-xl text-xs border focus:outline-none transition-all bg-zinc-950 border-zinc-800 text-zinc-300`}
                    >
                      <option value={1500}>{exportUi.bitrate.small}</option>
                      <option value={3000}>{exportUi.bitrate.normal}</option>
                      <option value={4500}>{exportUi.bitrate.sharp}</option>
                      <option value={6000}>{exportUi.bitrate.hd}</option>
                      <option value={12000}>{exportUi.bitrate.max}</option>
                    </select>
                  </div>

                  {/* Subtitle Font selection */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-zinc-400 flex items-center gap-1">
                      <Type size={12} /> {exportUi.textTypeface}
                    </label>
                    <select
                      value={videoStyle.fontFamily}
                      onChange={(e) => {
                        markCustomProfile();
                        updateVideoStyle({ fontFamily: e.target.value });
                      }}
                      className={`p-2.5 rounded-xl text-xs border focus:outline-none transition-all bg-zinc-950 border-zinc-800 text-zinc-300`}
                    >
                      <option value={MODERN_VIDEO_FONT}>{exportUi.font.modern}</option>
                      <option value="sans-serif">{exportUi.font.sans}</option>
                      <option value="serif">{exportUi.font.serif}</option>
                      <option value="monospace">{exportUi.font.mono}</option>
                      <option value="cursive">{exportUi.font.cursive}</option>
                    </select>
                  </div>

                  {/* Subtitle Size */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-zinc-400">{exportUi.textSize}</label>
                    <input
                      type="number"
                      min={20}
                      max={100}
                      value={videoStyle.fontSize}
                      onChange={(e) => {
                        markCustomProfile();
                        updateVideoStyle({ fontSize: Number(e.target.value) });
                      }}
                      className="p-2.5 rounded-xl text-xs border focus:outline-none text-center bg-zinc-950 border-zinc-800 text-zinc-100"
                    />
                  </div>
                </div>
              </details>
            </div>
          </div>

          {/* --- ИСПРАВЛЕНО: Buttons выбора формата взамен Label Radio --- */}
          <div className="space-y-2">
            <span className="block text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {dict.videoFormatLabel}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={!isMp4Supported}
                onClick={() => {
                  markCustomProfile();
                  setVideoFormat('mp4');
                }}
                className={`flex-1 flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                  videoFormat === 'mp4'
                    ? 'border-violet-500 bg-violet-500/10 text-violet-400 font-semibold scale-[1.01]'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                } ${!isMp4Supported ? 'opacity-40 cursor-not-allowed' : ''}`}
                title={!isMp4Supported ? exportUi.mp4Unsupported : ''}
              >
                <span className="text-xs font-bold">MP4 (H.264)</span>
                <span className="text-[10px] opacity-50 mt-0.5">{isMp4Supported ? 'AAC/Opus' : exportUi.unsupportedShort}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  markCustomProfile();
                  setVideoFormat('webm');
                }}
                className={`flex-1 flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                  videoFormat === 'webm'
                    ? 'border-violet-500 bg-violet-500/10 text-violet-400 font-semibold scale-[1.01]'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                }`}
              >
                <span className="text-xs font-bold">WebM (VP9)</span>
                <span className="text-[10px] opacity-50 mt-0.5">VP9/VP8</span>
              </button>
            </div>
          </div>

          {/* --- ИСПРАВЛЕНО: Buttons выбора разрешения взамен Label Radio --- */}
          <div className="space-y-2">
            <span className="block text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {dict.videoResolution}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  markCustomProfile();
                  setResolution('720p');
                }}
                className={`flex-1 flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                  resolution === '720p'
                    ? 'border-violet-500 bg-violet-500/10 text-violet-400 font-semibold scale-[1.01]'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                }`}
              >
                <span className="text-xs font-bold">HD (720p)</span>
                <span className="text-[10px] opacity-50 mt-0.5">1280x720</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  markCustomProfile();
                  setResolution('1080p');
                }}
                className={`flex-1 flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                  resolution === '1080p'
                    ? 'border-violet-500 bg-violet-500/10 text-violet-400 font-semibold scale-[1.01]'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                }`}
              >
                <span className="text-xs font-bold">Full HD (1080p)</span>
                <span className="text-[10px] opacity-50 mt-0.5">1920x1080</span>
              </button>
            </div>
          </div>

          {quality === 'ultra' && resolution === '1080p' && (
            <div className="p-3 rounded-xl bg-yellow-500/5 border border-yellow-500/15 text-[10px] text-yellow-500/90 flex gap-1.5 items-start">
              <ShieldAlert size={14} className="shrink-0 mt-0.5" />
              <span>{exportUi.ultraWarning}</span>
            </div>
          )}

          {/* Filename Input */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {dict.exportFilenameLabel || 'Название файла при экспорте'}
            </label>
            <input
              type="text"
              value={currentProjectTitle || getDefaultProjectTitle(audioFileName, lines, language)}
              onChange={(e) => setCurrentProjectTitle(e.target.value)}
              placeholder={dict.exportFilenamePlaceholder || 'Введите название файла...'}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs border focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all ${
                theme === 'dark' ? 'bg-zinc-905 border-zinc-800 text-zinc-100' : 'bg-zinc-50 border-zinc-200 text-zinc-900'
              }`}
            />
          </div>

          <button
            onClick={startExport}
            className="w-full py-3.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold flex items-center justify-center gap-2 shadow-md shadow-violet-600/15 hover:scale-[1.01] active:scale-95 transition-all"
          >
            <FileVideo size={18} />
            {dict.videoStartExport}
          </button>
        </div>
      ) : isRecording ? (
        <div className="flex flex-col gap-5 py-2">
          <div className="flex items-center gap-3">
            <RefreshCw className="animate-spin text-violet-500" size={20} />
            <div>
              <h4 className="font-semibold text-sm">
                {language === 'ru' ? 'Экспорт видео' : 'Video export'}: {exportPhaseCopy[visibleExportPhase].title}
              </h4>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {exportPhaseCopy[visibleExportPhase].desc} {language === 'ru' ? 'Не закрывайте вкладку.' : 'Keep this tab open.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            {exportPhaseOrder.map((phase, index) => {
              const isDone = index < activeExportPhaseIndex;
              const isCurrent = phase === visibleExportPhase;
              return (
                <div
                  key={phase}
                  className={`rounded-lg border px-2 py-2 text-center transition-colors ${
                    isCurrent
                      ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-300'
                      : isDone
                        ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-600'
                  }`}
                >
                  <div className="text-[10px] font-mono font-bold leading-none">{index + 1}</div>
                  <div className="mt-1 truncate text-[10px] font-semibold">{exportPhaseCopy[phase].title}</div>
                </div>
              );
            })}
          </div>

          {/* Предупреждение / уведомление об откате на резервный режим */}
          {warningMessage && (
            <div className="text-[10px] text-amber-500 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl leading-relaxed flex items-start gap-1.5 animate-pulse">
              <span className="shrink-0">⚠️</span>
              <span>{warningMessage}</span>
            </div>
          )}

          {isSlowExport && (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-3 text-xs text-zinc-600 dark:text-zinc-300">
              <div className="flex items-start gap-2">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-violet-500" />
                <div>
                  <div className="font-semibold text-zinc-800 dark:text-zinc-100">{exportUi.slowExportTitle}</div>
                  <div className="mt-0.5 leading-relaxed">{exportUi.slowExportDesc}</div>
                </div>
              </div>
            </div>
          )}

          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-mono text-zinc-400 dark:text-zinc-500 font-bold">
              <span>{Math.floor(secondsRecorded)}{secondsUnit} / {Math.round(progress * 100)}%</span>
              <span className="flex items-center gap-2">
                {exportSpeedFps > 0 && <span className="text-violet-400">{exportSpeedFps} fps</span>}
                {exportEta && (
                  <span className="text-zinc-500 dark:text-zinc-300">
                    {language === 'ru' ? 'осталось' : 'left'} {exportEta}
                  </span>
                )}
              </span>
            </div>
            <div className="h-3 w-full bg-zinc-100 dark:bg-zinc-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-300"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>

          {renderLogs.length > 0 && (
            <div
              className={`rounded-xl border p-3 text-[10px] ${
                theme === 'dark'
                  ? 'border-zinc-800 bg-zinc-950/80 text-zinc-300'
                  : 'border-zinc-200 bg-zinc-50/85 text-zinc-600'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold uppercase tracking-wider text-zinc-400">
                  {language === 'ru' ? 'Логи рендера' : 'Render logs'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={copyRenderLogs}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-semibold transition-all ${
                      theme === 'dark'
                        ? 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-violet-500 hover:text-violet-300'
                        : 'border-zinc-200 bg-white text-zinc-600 hover:border-violet-300 hover:text-violet-600'
                    }`}
                  >
                    {logsCopied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                    {logsCopied
                      ? language === 'ru' ? 'Скопировано' : 'Copied'
                      : language === 'ru' ? 'Скопировать' : 'Copy'}
                  </button>
                  <span className="font-mono text-zinc-400">
                    {renderLogs.length}
                  </span>
                </div>
              </div>
              <div className="mt-2 max-h-40 space-y-1 overflow-auto pr-1 font-mono">
                {renderLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`rounded-lg px-2 py-1.5 ${
                      theme === 'dark' ? 'bg-white/[0.03]' : 'bg-white/80'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-zinc-400">{log.time}</span>
                      <span className="font-bold text-violet-500">[{log.tag}]</span>
                      <span>{log.message}</span>
                    </div>
                    {log.data && (
                      <div className="mt-1 break-words text-zinc-400">
                        {formatRenderLogData(log.data)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={cancelExport}
            className="w-full py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 font-semibold text-xs flex items-center justify-center gap-1.5 transition-all"
          >
            <XCircle size={15} />
            {dict.videoRecordingCancel}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2 p-3.5 rounded-xl bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-xs font-medium">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{dict.videoRecordingSuccess}</span>
          </div>

          {/* Video Element Preview (С адаптивным ресайзом и пропорциями кадра) */}
          <div className="space-y-2 flex flex-col items-center w-full">
            <div 
              className={`relative rounded-xl overflow-hidden bg-black border border-zinc-200/10 flex items-center justify-center shadow-inner transition-all duration-500 mx-auto ${getAspectRatioClass()}`}
            >
              <video
                src={videoObjectUrl || undefined}
                controls
                className="w-full h-full object-contain animate-fade-in bg-[#05020a]"
              />
            </div>
          </div>

          {/* Filename Input */}
          <div className="space-y-1.5 w-full">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {dict.exportFilenameLabel || 'Название файла при экспорте'}
            </label>
            <input
              type="text"
              value={currentProjectTitle || getDefaultProjectTitle(audioFileName, lines, language)}
              onChange={(e) => setCurrentProjectTitle(e.target.value)}
              placeholder={dict.exportFilenamePlaceholder || 'Введите название файла...'}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs border focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all ${
                theme === 'dark' ? 'bg-zinc-905 border-zinc-800 text-zinc-100' : 'bg-zinc-50 border-zinc-200 text-zinc-900'
              }`}
            />
          </div>

          <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap w-full">
            <button
              onClick={downloadVideoFile}
              className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-md shadow-violet-600/15 hover:scale-[1.01] active:scale-95 transition-all"
            >
              <Download size={18} />
              {dict.videoDownload}
            </button>

            <button
              onClick={() => {
                setVideoBlob(null);
                setVideoObjectUrl(null);
              }}
              className={`px-4 py-3 rounded-xl font-semibold text-xs transition-colors border bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-300`}
            >
              {language === 'ru' ? 'Записать заново' : 'Record Again'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
