import { LyricLine, WordTiming } from '../types';

// Helper to format seconds to SRT timestamp: HH:MM:SS,mmm
export function formatSRTTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

// Helper to format seconds to ASS timestamp: H:MM:SS.cc (centiseconds)
export function formatASSTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  
  return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// Helper to format seconds to WebVTT timestamp: HH:MM:SS.mmm
export function formatVTTTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * Generates SRT subtitle content from lines
 */
export function generateSRT(lines: LyricLine[]): string {
  const sortedLines = [...lines]
    .filter((l) => l.time !== null)
    .sort((a, b) => (a.time || 0) - (b.time || 0));

  let content = '';
  sortedLines.forEach((line, idx) => {
    const startTime = line.time || 0;
    // Estimate end time: next line start or start + 4 seconds
    const nextLine = sortedLines[idx + 1];
    const endTime = nextLine ? nextLine.time || (startTime + 4) : startTime + 4;

    content += `${idx + 1}\n`;
    content += `${formatSRTTime(startTime)} --> ${formatSRTTime(endTime)}\n`;
    content += `${line.text}\n\n`;
  });

  return content;
}

/**
 * Generates WebVTT subtitle content from lines
 */
export function generateVTT(lines: LyricLine[]): string {
  const sortedLines = [...lines]
    .filter((l) => l.time !== null)
    .sort((a, b) => (a.time || 0) - (b.time || 0));

  let content = 'WEBVTT\n\n';
  sortedLines.forEach((line, idx) => {
    const startTime = line.time || 0;
    const nextLine = sortedLines[idx + 1];
    const endTime = nextLine ? nextLine.time || (startTime + 4) : startTime + 4;

    content += `${idx + 1}\n`;
    content += `${formatVTTTime(startTime)} --> ${formatVTTTime(endTime)}\n`;
    content += `${line.text}\n\n`;
  });

  return content;
}

/**
 * Generates ASS subtitle content with style tags
 */
export function generateASS(lines: LyricLine[], fontFamily = 'Arial', fontSize = 20): string {
  const sortedLines = [...lines]
    .filter((l) => l.time !== null)
    .sort((a, b) => (a.time || 0) - (b.time || 0));

  let content = `[Script Info]
Title: Karaoke Subtitles
ScriptType: v4.00+
Collisions: Normal
PlayResX: 640
PlayResY: 360

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontFamily},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  sortedLines.forEach((line, idx) => {
    const startTime = line.time || 0;
    const nextLine = sortedLines[idx + 1];
    const endTime = nextLine ? nextLine.time || (startTime + 4) : startTime + 4;

    const startStr = formatASSTime(startTime);
    const endStr = formatASSTime(endTime);

    // Support word timings in ASS utilizing the {\k} karaoke tag (e.g. {\k50}Word1 {\k30}Word2)
    let textVal = '';
    if (line.words && line.words.some((w) => w.time !== null)) {
      line.words.forEach((word, wIdx) => {
        const wordStart = word.time || line.time || 0;
        const nextW = line.words[wIdx + 1];
        const wordEnd = nextW?.time || nextLine?.time || (wordStart + 1);
        // ASS karaoke duration is in centiseconds (1/100s)
        const durationCs = Math.max(10, Math.round((wordEnd - wordStart) * 100));
        textVal += `{\\k${durationCs}}${word.text} `;
      });
    } else {
      textVal = line.text;
    }

    content += `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${textVal.trim()}\n`;
  });

  return content;
}

/**
 * Parses SRT timestamps back into seconds
 */
export function parseSRTTime(timeStr: string): number {
  const parts = timeStr.trim().replace(',', '.').split(':');
  if (parts.length < 3) return 0;
  
  const hrs = parseFloat(parts[0]);
  const mins = parseFloat(parts[1]);
  const secs = parseFloat(parts[2]);
  
  return hrs * 3600 + mins * 60 + secs;
}

/**
 * Parses SRT subtitles content into structured LyricLine array
 */
export function parseSRT(content: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const blocks = content.split(/\r?\n\r?\n/);

  blocks.forEach((block) => {
    const rows = block.trim().split(/\r?\n/);
    if (rows.length >= 3) {
      const timeRow = rows[1];
      const textRow = rows.slice(2).join(' ');

      const timeMatch = timeRow.match(/(\d+:\d+:\d+,\d+)\s*-->\s*(\d+:\d+:\d+,\d+)/);
      if (timeMatch) {
        const startSecs = parseSRTTime(timeMatch[1]);
        lines.push({
          id: Math.random().toString(36).substring(2, 9),
          text: textRow.trim(),
          time: Number(startSecs.toFixed(2)),
          words: textToWords(textRow.trim()),
        });
      }
    }
  });

  return lines;
}

/**
 * Parses WebVTT subtitles content into structured LyricLine array
 */
export function parseVTT(content: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const blocks = content.replace('WEBVTT', '').trim().split(/\r?\n\r?\n/);

  blocks.forEach((block) => {
    const rows = block.trim().split(/\r?\n/);
    if (rows.length >= 2) {
      let timeRow = rows[0];
      let textRow = rows.slice(1).join(' ');

      // If the first row is an index/number, shift
      if (!timeRow.includes('-->') && rows.length >= 3) {
        timeRow = rows[1];
        textRow = rows.slice(2).join(' ');
      }

      const timeMatch = timeRow.match(/(\d+:\d+:\d+\.\d+|\d+:\d+\.\d+)\s*-->\s*(\d+:\d+:\d+\.\d+|\d+:\d+\.\d+)/);
      if (timeMatch) {
        const startSecs = parseSRTTime(timeMatch[1]);
        lines.push({
          id: Math.random().toString(36).substring(2, 9),
          text: textRow.trim(),
          time: Number(startSecs.toFixed(2)),
          words: textToWords(textRow.trim()),
        });
      }
    }
  });

  return lines;
}

/**
 * Parses ASS subtitles content into structured LyricLine array
 */
export function parseASS(content: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const rows = content.split(/\r?\n/);

  rows.forEach((row) => {
    if (row.startsWith('Dialogue:')) {
      // Dialogue: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
      const cleanRow = row.replace('Dialogue:', '').trim();
      const parts = cleanRow.split(',');
      if (parts.length >= 10) {
        const startStr = parts[1];
        const textStr = parts.slice(9).join(',');

        // Parse ASS time: H:MM:SS.cc -> seconds
        const timeParts = startStr.trim().split(':');
        if (timeParts.length >= 3) {
          const hrs = parseFloat(timeParts[0]);
          const mins = parseFloat(timeParts[1]);
          const secs = parseFloat(timeParts[2]);
          const startSecs = hrs * 3600 + mins * 60 + secs;

          // Clean ASS tags like {\k30} or {\an8} from subtitle text
          const cleanedText = textStr.replace(/\{[^}]+\}/g, '').trim();

          lines.push({
            id: Math.random().toString(36).substring(2, 9),
            text: cleanedText,
            time: Number(startSecs.toFixed(2)),
            words: textToWords(cleanedText),
          });
        }
      }
    }
  });

  return lines;
}

// Helper to split text into initial WordTiming nodes
function textToWords(text: string): WordTiming[] {
  return text
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => ({
      id: Math.random().toString(36).substring(2, 9),
      text: w,
      time: null,
    }));
}
