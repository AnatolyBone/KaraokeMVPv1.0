import JSZip from 'jszip';
import { LyricLine, VideoStyleOptions } from '../types';
import { generateLRC, parseLRC } from './lrc';

interface ProjectSettings {
  title: string;
  timingMode: 'line' | 'word';
  videoStyle: VideoStyleOptions;
  coverColors: { primary: string; secondary: string; glow: string } | null;
}

/**
 * Packs the audio file, LRC subtitles, and style configurations into a single .zip project archive
 */
export async function exportProjectZip(
  audioFile: File | Blob | null,
  audioFileName: string | null,
  lines: LyricLine[],
  videoStyle: VideoStyleOptions,
  coverColors: { primary: string; secondary: string; glow: string } | null
): Promise<Blob> {
  const zip = new JSZip();
  
  const title = audioFileName ? audioFileName.replace(/\.[^/.]+$/, '') : 'karaoke_project';
  const lrcContent = generateLRC(lines, audioFileName || undefined);

  // 1. Add LRC subtitles
  zip.file(`${title}.lrc`, lrcContent);

  // 2. Add Style & Settings JSON
  const settings: ProjectSettings = {
    title,
    timingMode: lines.some((l) => l.words.some((w) => w.time !== null)) ? 'word' : 'line',
    videoStyle,
    coverColors,
  };
  zip.file('settings.json', JSON.stringify(settings, null, 2));

  // 3. Add Audio track file if present
  if (audioFile) {
    const name = audioFileName || 'audio.mp3';
    zip.file(name, audioFile);
  }

  return await zip.generateAsync({ type: 'blob' });
}

interface ImportedProject {
  audioFile: File | null;
  lines: LyricLine[];
  videoStyle: VideoStyleOptions | null;
  coverColors: { primary: string; secondary: string; glow: string } | null;
}

/**
 * Unpacks a .zip project archive to restore audio, LRC, and visual styles
 */
export async function importProjectZip(zipBlob: Blob): Promise<ImportedProject> {
  const zip = await JSZip.loadAsync(zipBlob);
  
  let audioFile: File | null = null;
  let lines: LyricLine[] = [];
  let videoStyle: VideoStyleOptions | null = null;
  let coverColors: { primary: string; secondary: string; glow: string } | null = null;

  // 1. Locate files inside zip
  const files = Object.keys(zip.files);

  // A. Find settings.json
  const settingsFile = files.find((name) => name.endsWith('settings.json'));
  if (settingsFile) {
    const text = await zip.file(settingsFile)!.async('string');
    const settings: ProjectSettings = JSON.parse(text);
    if (settings.videoStyle) videoStyle = settings.videoStyle;
    if (settings.coverColors) coverColors = settings.coverColors;
  }

  // B. Find LRC file
  const lrcFile = files.find((name) => name.endsWith('.lrc'));
  if (lrcFile) {
    const text = await zip.file(lrcFile)!.async('string');
    lines = parseLRC(text);
  }

  // C. Find Audio track
  const audioFileKey = files.find((name) => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return ['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext);
  });
  if (audioFileKey) {
    const data = await zip.file(audioFileKey)!.async('blob');
    audioFile = new File([data], audioFileKey, { type: `audio/${audioFileKey.split('.').pop()}` });
  }

  return {
    audioFile,
    lines,
    videoStyle,
    coverColors,
  };
}

/**
 * Generates a self-contained shareable URL containing compressed lyrics and styles
 */
export function generateShareableLink(
  audioFileName: string | null,
  lines: LyricLine[],
  videoStyle: VideoStyleOptions
): string {
  const baseUrl = window.location.origin + window.location.pathname;
  
  // We serialize a lightweight project mockup into base64 query parameter
  const payload = {
    title: audioFileName?.replace(/\.[^/.]+$/, '') || 'Karaoke',
    lines: lines.map((l) => ({ t: l.text, s: l.time })),
    font: videoStyle.fontFamily,
    bg: videoStyle.bgType,
  };

  try {
    const str = JSON.stringify(payload);
    const encoded = btoa(encodeURIComponent(str));
    return `${baseUrl}?share=${encoded}`;
  } catch {
    return baseUrl;
  }
}

/**
 * Generates iframe HTML embed code for third-party websites
 */
export function generateEmbedCode(shareLink: string): string {
  // Добавляем безопасный sandbox без дублирования allow-same-origin и allow-scripts, если это не требуется,
  // либо разделяем ограничения для безопасного встраивания на сторонних сайтах.
  return `<iframe src="${shareLink}&embed=true" width="640" height="360" frameborder="0" sandbox="allow-scripts allow-popups allow-forms" allow="autoplay; clipboard-write" style="border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.3);"></iframe>`;
}
