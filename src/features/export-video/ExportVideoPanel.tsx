import React, { useState, useRef, useEffect } from 'react';
import { useKaraokeStore, getDefaultProjectTitle } from '../../store/useKaraokeStore';
import { exportVideo } from '../../utils/video';
import { audioRef } from '../../audioRef';
import { localization } from '../../utils/localization';
import { clearTextWidthCache } from '../../utils/renderer/textCache';
import { renderBackground } from '../../utils/renderer/renderBackground';
import { RenderFrame } from '../../utils/renderer/types';
import { extractDominantColors } from '../../utils/colors';
import { FileVideo, Download, AlertCircle, RefreshCw, XCircle, CheckCircle2, Palette, Type, Eye, Film, Activity, ShieldAlert, LayoutGrid } from 'lucide-react';

interface PreviewParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color?: string;
}

type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

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
    language
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
  type ExportPhase = 'idle' | 'decoding' | 'initializing' | 'prewarming' | 'encoding' | 'recording';
  const [exportPhase, setExportPhase] = useState<ExportPhase>('idle');
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const dict = localization[language];

  // Качество рендеринга (Quality Manager)
  const [quality, setQuality] = useState<QualityPreset>('high');
  const [exportFps, setExportFps] = useState<30 | 60>(30);
  const [customBitrate, setCustomBitrate] = useState<number>(3000);

  useEffect(() => {
    let defaultBitrate = 3000;
    if (resolution === '1080p') {
      if (quality === 'low') defaultBitrate = 2500;
      else if (quality === 'medium') defaultBitrate = 4500;
      else if (quality === 'high') defaultBitrate = 6000;
      else if (quality === 'ultra') defaultBitrate = 12000;
    } else {
      if (quality === 'low') defaultBitrate = 1500;
      else if (quality === 'medium') defaultBitrate = 2500;
      else if (quality === 'high') defaultBitrate = 4000;
      else if (quality === 'ultra') defaultBitrate = 8000;
    }
    setCustomBitrate(defaultBitrate);
  }, [resolution, quality]);

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

  // Автоматически извлекаем цвета обложки при открытии панели экспорта,
  // если coverUrl есть, а coverColors ещё не вычислены (например после перезагрузки страницы)
  useEffect(() => {
    if (coverUrl && !coverColors) {
      extractDominantColors(coverUrl)
        .then((palette) => setCoverColors(palette))
        .catch(() => {/* silently ignore */});
    }
  }, [coverUrl, coverColors, setCoverColors]);

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
        previewParticlesRef.current.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          radius: Math.random() * (w * 0.3) + w * 0.1,
          alpha: Math.random() * 0.08 + 0.02,
          color: i % 2 === 0 ? '#4f46e5' : '#db2777',
        });
      }
    }
  };

  useEffect(() => {
    const w = videoStyle.aspectRatio === '9:16' ? 720 : 1280;
    const h = videoStyle.aspectRatio === '9:16' ? 1280 : 720;
    setupPreviewParticles(w, h);
  }, [videoStyle.fxOverlay, videoStyle.aspectRatio, quality]);

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
            p.x += p.vx * 0.4;
            p.y += p.vy * 0.4;
            if (p.x < 0 || p.x > width) p.vx *= -1;
            if (p.y < 0 || p.y > height) p.vy *= -1;

            const radGrad = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, p.radius);
            radGrad.addColorStop(0, p.color === '#4f46e5' ? 'rgba(79, 70, 229, 0.08)' : 'rgba(219, 39, 119, 0.08)');
            radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = radGrad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
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
      ctx.font = `bold ${videoStyle.fontSize}px ${videoStyle.fontFamily}`;

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
        ctx.font = `bold ${titleFontSize}px ${videoStyle.fontFamily}`;
        ctx.fillText(title, textX, textY, leftRect.w * 0.88);
        
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `${artistFontSize}px ${videoStyle.fontFamily}`;
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
          ctx.font = `bold ${videoStyle.fontSize}px ${videoStyle.fontFamily}`;
          ctx.fillStyle = isPrimary ? videoStyle.activeWordColor : videoStyle.inactiveWordColor;
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
          ctx.font = `13px ${videoStyle.fontFamily}`;
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
          yOffset = -Math.abs(Math.sin(Date.now() * 0.003)) * 12;
        }

        const width1 = ctx.measureText(sampleText1).width;
        ctx.fillStyle = videoStyle.activeWordColor;
        ctx.fillText(sampleText1, startX + width1 / 2, textY + yOffset);
        if (videoStyle.strokeWidth > 0) {
          ctx.strokeText(sampleText1, startX + width1 / 2, textY + yOffset);
        }
        startX += width1;

        const width2 = ctx.measureText(sampleText2).width;
        ctx.fillStyle = videoStyle.inactiveWordColor;
        ctx.fillText(sampleText2, startX + width2 / 2, textY);
        if (videoStyle.strokeWidth > 0) {
          ctx.strokeText(sampleText2, startX + width2 / 2, textY);
        }

        ctx.save();
        ctx.beginPath();
        const fillFactor = (Math.sin(Date.now() * 0.002) + 1) / 2;
        ctx.rect(startX, textY - videoStyle.fontSize, width2 * fillFactor, videoStyle.fontSize * 2);
        ctx.clip();
        ctx.fillStyle = videoStyle.activeWordColor;
        ctx.fillText(sampleText2, startX + width2 / 2, textY);
        if (videoStyle.strokeWidth > 0) {
          ctx.strokeText(sampleText2, startX + width2 / 2, textY);
        }
        ctx.restore();
        startX += width2;

        const width3 = ctx.measureText(sampleText3).width;
        ctx.fillStyle = videoStyle.inactiveWordColor;
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
    exportStartTimeRef.current = performance.now();

    const controller = new AbortController();
    abortControllerRef.current = controller;

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
        },
        onWarning: (msg) => {
          setWarningMessage(msg);
        },
        onProgress: (percent, seconds) => {
          setProgress(percent);
          setSecondsRecorded(seconds);

          // Расчёт ETA и скорости
          if (percent > 0.02) {
            const elapsed = (performance.now() - exportStartTimeRef.current) / 1000;
            const estimatedTotal = elapsed / percent;
            const remaining = Math.max(0, estimatedTotal - elapsed);
            const fps = seconds / elapsed * exportFps;
            setExportSpeedFps(Math.round(fps));
            if (remaining > 5) {
              const mins = Math.floor(remaining / 60);
              const secs = Math.round(remaining % 60);
              setExportEta(mins > 0 ? `~${mins}м ${secs}с` : `~${secs}с`);
            } else {
              setExportEta('совсем скоро...');
            }
          }
        },
        onComplete: (blob) => {
          const url = URL.createObjectURL(blob);
          setVideoBlob(blob);
          setVideoObjectUrl(url);
          setIsRecording(false);
        },
        onError: (err) => {
          if (controller.signal.aborted) return;
          setError(err.message || 'Неизвестная ошибка при экспорте видео');
          setIsRecording(false);
        },
      });
    } catch (err: any) {
      setError(err.message || 'Failed to initialize audio capture context');
      setIsRecording(false);
    }
  };

  const cancelExport = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
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
              className={`relative rounded-xl overflow-hidden bg-black border border-zinc-250/10 flex items-center justify-center shadow-inner transition-all duration-500 mx-auto ${getAspectRatioClass()}`}
            >
              <canvas
                ref={previewCanvasRef}
                width={videoStyle.aspectRatio === '9:16' ? 720 : videoStyle.aspectRatio === '1:1' ? 720 : 1280}
                height={videoStyle.aspectRatio === '9:16' ? 1280 : videoStyle.aspectRatio === '1:1' ? 720 : 720}
                className="w-full h-full object-cover bg-[#05020a]"
              />
            </div>

            {/* РАСШИРЕННЫЙ ВСТРОЕННЫЙ ПОСЛОЙНЫЙ ПРОФАЙЛЕР (PER-LAYER PROFILER) */}
            <div className="w-full max-w-md mt-2 p-4 rounded-xl border border-zinc-200/5 bg-zinc-550/5 flex flex-col gap-2 text-[10px] font-mono">
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
                  <LayoutGrid size={14} className="text-violet-500" /> Пресет караоке-дизайна
                </label>
                <select
                  value={videoStyle.preset}
                  onChange={(e) => updateVideoStyle({ preset: e.target.value as any })}
                  className={`p-2.5 rounded-xl text-xs border font-bold focus:outline-none transition-all bg-zinc-900 border-zinc-800 text-violet-400`}
                >
                  <option value="apple-music">🎵 Apple Music Style (Кураторский)</option>
                  <option value="spotify">🟢 Spotify Premium (Сочный зеленый)</option>
                  <option value="tiktok-neon">⚡ TikTok Neon (Неоновый молодежный)</option>
                  <option value="classic-karaoke">🎤 Classic Karaoke (Сине-желтый)</option>
                  <option value="minimal-cinema">🎬 Minimal Cinema (Темный кинотеатр)</option>
                </select>
              </div>

              {/* RENDER QUALITY MANAGER */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-zinc-400">Качество Рендера</label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as QualityPreset)}
                  className={`p-2.5 rounded-xl text-xs border focus:outline-none transition-all bg-zinc-900 border-zinc-800 text-zinc-300`}
                >
                  <option value="low">Низкое (Слабый ПК / Без эффектов)</option>
                  <option value="medium">Среднее (Без частиц / Мягкая тень)</option>
                  <option value="high">Высокое (Снег / Размытие обложки)</option>
                  <option value="ultra">Ультра (Жидкие сферы / Максимум FPS)</option>
                </select>
              </div>

              {/* Aspect Ratio Selection */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-zinc-400">Формат кадра</label>
                <select
                  value={videoStyle.aspectRatio}
                  onChange={(e) => updateVideoStyle({ aspectRatio: e.target.value as any })}
                  className={`p-2.5 rounded-xl text-xs border focus:outline-none transition-all bg-zinc-900 border-zinc-800 text-zinc-300`}
                >
                  <option value="16:9">Desktop (16:9)</option>
                  <option value="9:16">Mobile / TikTok (9:16)</option>
                  <option value="1:1">Square / Instagram (1:1)</option>
                </select>
              </div>

              {/* FPS Selection */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-zinc-400">Частота кадров (FPS)</label>
                <select
                  value={exportFps}
                  onChange={(e) => setExportFps(Number(e.target.value) as 30 | 60)}
                  className={`p-2.5 rounded-xl text-xs border focus:outline-none transition-all bg-zinc-900 border-zinc-800 text-zinc-300`}
                >
                  <option value={30}>30 FPS (Быстрый экспорт)</option>
                  <option value={60}>60 FPS (Плавные анимации)</option>
                </select>
              </div>

              {/* Bitrate Selection */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-zinc-400">Битрейт видео (качество)</label>
                <select
                  value={customBitrate}
                  onChange={(e) => setCustomBitrate(Number(e.target.value))}
                  className={`p-2.5 rounded-xl text-xs border focus:outline-none transition-all bg-zinc-900 border-zinc-800 text-zinc-300`}
                >
                  <option value={1500}>1.5 Mbps (Экономный)</option>
                  <option value={3000}>3 Mbps (Средний SD)</option>
                  <option value={6000}>6 Mbps (Высокий HD)</option>
                  <option value={12000}>12 Mbps (Ультра 1080p)</option>
                </select>
              </div>

              {/* Subtitle Font selection */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-zinc-400 flex items-center gap-1">
                  <Type size={12} /> Шрифт текста
                </label>
                <select
                  value={videoStyle.fontFamily}
                  onChange={(e) => updateVideoStyle({ fontFamily: e.target.value })}
                  className={`p-2.5 rounded-xl text-xs border focus:outline-none transition-all bg-zinc-900 border-zinc-800 text-zinc-300`}
                >
                  <option value="sans-serif">Без засечек (Sans-Serif)</option>
                  <option value="serif">С засечками (Serif)</option>
                  <option value="monospace">Моноширинный (Monospace)</option>
                  <option value="cursive">Курсивный (Cursive)</option>
                </select>
              </div>

              {/* Subtitle Size */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-zinc-400">Размер шрифта (px)</label>
                <input
                  type="number"
                  min={20}
                  max={100}
                  value={videoStyle.fontSize}
                  onChange={(e) => updateVideoStyle({ fontSize: Number(e.target.value) })}
                  className="p-2.5 rounded-xl text-xs border focus:outline-none text-center bg-zinc-900 border-zinc-805 text-zinc-100"
                />
              </div>
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
                onClick={() => setVideoFormat('mp4')}
                className={`flex-1 flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                  videoFormat === 'mp4'
                    ? 'border-violet-500 bg-violet-500/10 text-violet-400 font-semibold scale-[1.01]'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                } ${!isMp4Supported ? 'opacity-40 cursor-not-allowed' : ''}`}
                title={!isMp4Supported ? 'Экспорт MP4 не поддерживается в этом браузере' : ''}
              >
                <span className="text-xs font-bold">MP4 (H.264)</span>
                <span className="text-[10px] opacity-50 mt-0.5">{isMp4Supported ? 'AAC/Opus' : 'Не подд.'}</span>
              </button>

              <button
                type="button"
                onClick={() => setVideoFormat('webm')}
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
                onClick={() => setResolution('720p')}
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
                onClick={() => setResolution('1080p')}
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
              <span>Внимание: Рендеринг в 1080p на качестве Ultra создает высокую нагрузку на CPU. На слабых ПК рекомендуется переключить качество в режим Medium.</span>
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
                {exportPhase === 'decoding' && (language === 'ru' ? 'Декодирование аудио...' : 'Decoding audio...')}
                {exportPhase === 'initializing' && (language === 'ru' ? 'Инициализация кодеков...' : 'Initializing codecs...')}
                {exportPhase === 'prewarming' && (language === 'ru' ? 'Подготовка рендерера...' : 'Pre-warming renderer...')}
                {exportPhase === 'encoding' && (language === 'ru' ? 'Кодирование видео (офлайн)' : 'Encoding video (offline)')}
                {exportPhase === 'recording' && (language === 'ru' ? 'Запись в реальном времени' : 'Real-time recording')}
                {exportPhase === 'idle' && dict.videoRecording}
              </h4>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {exportPhase === 'recording'
                  ? (language === 'ru' ? 'Используется режим реального времени. Не закрывайте вкладку.' : 'Real-time mode active. Keep this tab open.')
                  : (language === 'ru' ? 'Быстрый офлайн-экспорт. Не закрывайте вкладку.' : 'Fast offline export. Keep this tab open.')}
              </p>
            </div>
          </div>

          {/* Предупреждение / уведомление об откате на резервный режим */}
          {warningMessage && (
            <div className="text-[10px] text-amber-500 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl leading-relaxed flex items-start gap-1.5 animate-pulse">
              <span className="shrink-0">⚠️</span>
              <span>{warningMessage}</span>
            </div>
          )}

          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-mono text-zinc-400 dark:text-zinc-500 font-bold">
              <span>{Math.floor(secondsRecorded)}с / {Math.round(progress * 100)}%</span>
              <span className="flex items-center gap-2">
                {exportSpeedFps > 0 && <span className="text-violet-400">{exportSpeedFps} fps</span>}
                {exportEta && <span className="text-zinc-300">{exportEta}</span>}
              </span>
            </div>
            <div className="h-3 w-full bg-zinc-100 dark:bg-zinc-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-300"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>

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
              className={`relative rounded-xl overflow-hidden bg-black border border-zinc-250/10 flex items-center justify-center shadow-inner transition-all duration-500 mx-auto ${getAspectRatioClass()}`}
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
