/**
 * Formats a time in seconds to a standard LRC timestamp string: "mm:ss.xx"
 */
export function formatTime(seconds: number | null): string {
  if (seconds === null || isNaN(seconds)) return '00:00.00';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds % 1) * 100);
  
  const minsStr = String(mins).padStart(2, '0');
  const secsStr = String(secs).padStart(2, '0');
  const hundredthsStr = String(hundredths).padStart(2, '0');
  
  return `${minsStr}:${secsStr}.${hundredthsStr}`;
}

/**
 * Parses an LRC timestamp string (e.g. "01:23.45" or "02:04.123") to seconds
 */
export function parseTime(timeStr: string): number {
  const cleanStr = timeStr.trim().replace(/[\[\]]/g, '');
  const parts = cleanStr.split(':');
  if (parts.length < 2) return 0;
  
  const mins = parseFloat(parts[0]);
  const rest = parts[1].split('.');
  const secs = parseFloat(rest[0]);
  const hundredths = rest[1] ? parseFloat(rest[1]) : 0;
  
  // Handle 3-digit milliseconds (e.g., .123 -> 0.123)
  const fraction = rest[1] ? (hundredths / Math.pow(10, rest[1].length)) : 0;
  
  return mins * 60 + secs + fraction;
}
