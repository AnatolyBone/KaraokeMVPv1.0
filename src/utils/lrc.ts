import { LyricLine, WordTiming } from '../types';
import { formatTime, parseTime } from './time';

/**
 * Helper to split text into word structure
 */
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

/**
 * Generates an LRC content string from lines.
 * Supports Enhanced LRC format for word-by-word sync if word timings are present.
 */
export function generateLRC(lines: LyricLine[], audioFileName?: string): string {
  const filteredLines = lines
    .filter((line) => line.time !== null)
    .sort((a, b) => (a.time || 0) - (b.time || 0));

  let content = '';
  if (audioFileName) {
    content += `[ti:${audioFileName.replace(/\.[^/.]+$/, '')}]\n`;
  }
  
  filteredLines.forEach((line) => {
    const hasWordTimings = line.words && line.words.some((w) => w.time !== null);
    
    if (hasWordTimings) {
      // Enhanced LRC format: [mm:ss.xx]<mm:ss.xx>Word1 <mm:ss.xx>Word2 ...
      let lineStr = `[${formatTime(line.time)}]`;
      line.words.forEach((w, idx) => {
        const wordTimePrefix = w.time !== null ? `<${formatTime(w.time)}>` : '';
        lineStr += `${idx > 0 ? ' ' : ''}${wordTimePrefix}${w.text}`;
      });
      content += `${lineStr}\n`;
    } else {
      // Standard LRC format
      content += `[${formatTime(line.time)}]${line.text}\n`;
    }
  });

  return content;
}

/**
 * Parses an LRC file content string into LyricLine arrays.
 * Supports both standard LRC and Enhanced LRC formats.
 */
export function parseLRC(content: string): LyricLine[] {
  const lines: LyricLine[] = [];
  
  // Standard line regex: [01:23.45]Lyric text
  const lineRegex = /^\[(\d+:\d+(?:\.\d+)?)\](.*)$/;

  const rawLines = content.split(/\r?\n/);
  rawLines.forEach((lineStr) => {
    const match = lineStr.trim().match(lineRegex);
    if (match) {
      const lineTimeStr = match[1];
      const restOfLine = match[2].trim();
      const lineTime = parseTime(lineTimeStr);

      // Check if line has Enhanced LRC format (contains <mm:ss.xx>)
      if (restOfLine.includes('<') && restOfLine.includes('>')) {
        // Extract words with matching tags
        const matches: { text: string; time: number | null }[] = [];
        
        // Let's parse word timings
        // A quick splitter to parse e.g. <00:01.00>Word1 <00:02.00>Word2
        const parts = restOfLine.split(/\s+/);
        parts.forEach((part) => {
          const wordMatch = part.match(/<(\d+:\d+(?:\.\d+)?)>(.*)/);
          if (wordMatch) {
            matches.push({
              text: wordMatch[2],
              time: parseTime(wordMatch[1]),
            });
          } else {
            matches.push({
              text: part,
              time: null,
            });
          }
        });

        const structuredWords = matches.map((m) => ({
          id: Math.random().toString(36).substring(2, 9),
          text: m.text,
          time: m.time,
        }));

        const plainText = matches.map((m) => m.text).join(' ');

        lines.push({
          id: Math.random().toString(36).substring(2, 9),
          text: plainText,
          time: lineTime,
          words: structuredWords,
        });
      } else {
        // Standard LRC line
        lines.push({
          id: Math.random().toString(36).substring(2, 9),
          text: restOfLine,
          time: lineTime,
          words: textToWords(restOfLine),
        });
      }
    } else {
      const isTag = lineStr.startsWith('[') && lineStr.includes(']');
      if (!isTag && lineStr.trim().length > 0) {
        lines.push({
          id: Math.random().toString(36).substring(2, 9),
          text: lineStr.trim(),
          time: null,
          words: textToWords(lineStr.trim()),
        });
      }
    }
  });

  return lines;
}

/**
 * Triggers a local file download for LRC
 */
export function downloadLRC(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.lrc') ? filename : `${filename}.lrc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
