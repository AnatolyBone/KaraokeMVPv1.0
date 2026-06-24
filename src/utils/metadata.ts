export interface AudioMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
}

function fixCyrillicEncoding(text: string): string {
  let matches = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Accented characters corresponding to Cyrillic range in Windows-1251
    if (code >= 0xC0 && code <= 0xFF) {
      matches++;
    }
  }
  // If significant density of accented chars, it's likely Windows-1251 misidentified as Windows-1252
  if (matches > 0 && (matches / text.length > 0.25 || matches >= 2)) {
    try {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) {
        bytes[i] = text.charCodeAt(i) & 0xFF;
      }
      return new TextDecoder('windows-1251').decode(bytes).trim();
    } catch (e) {
      // Fallback to original
    }
  }
  return text;
}

function decodeText(bytes: Uint8Array, encoding: number): string {
  try {
    if (encoding === 0x00) {
      // ISO-8859-1 (Latin1) - windows-1252 is the most robust decoder for this
      const decoded = new TextDecoder('windows-1252').decode(bytes).replace(/\0+$/, '').trim();
      return fixCyrillicEncoding(decoded);
    } else if (encoding === 0x01) {
      // UTF-16 with BOM (TextDecoder automatically handles Byte Order Mark)
      return new TextDecoder('utf-16').decode(bytes).replace(/\0+$/, '').trim();
    } else if (encoding === 0x02) {
      // UTF-16BE without BOM
      return new TextDecoder('utf-16be').decode(bytes).replace(/\0+$/, '').trim();
    } else if (encoding === 0x03) {
      // UTF-8
      return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '').trim();
    }
    // Fallback to UTF-8
    return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '').trim();
  } catch (e) {
    console.warn('Failed to decode text bytes:', e);
    return '';
  }
}

function decodeUnsynchronisation(bytes: Uint8Array): Uint8Array {
  const safeBytes = new Uint8Array(bytes.length);
  let writeIdx = 0;
  for (let i = 0; i < bytes.length; i++) {
    safeBytes[writeIdx++] = bytes[i];
    if (bytes[i] === 0xFF && i + 1 < bytes.length && bytes[i + 1] === 0x00) {
      i++; // skip the 00 byte
    }
  }
  return safeBytes.subarray(0, writeIdx);
}

/**
 * Извлекает базовые метаданные ID3v2 (исполнитель, название, альбом) из MP3-файла
 */
export async function extractMetadataFromAudio(file: File): Promise<AudioMetadata> {
  const result: AudioMetadata = { title: null, artist: null, album: null };
  try {
    // Читаем первые 5МБ файла, в которых гарантированно находится заголовок ID3
    const buffer = await file.slice(0, 5 * 1024 * 1024).arrayBuffer();
    const view = new DataView(buffer);

    // Проверяем сигнатуру "ID3" (0x49 0x44 0x33)
    if (
      buffer.byteLength >= 10 &&
      view.getUint8(0) === 0x49 &&
      view.getUint8(1) === 0x44 &&
      view.getUint8(2) === 0x33
    ) {
      const majorVersion = view.getUint8(3);
      const flags = view.getUint8(5);
      const unsynchronised = (flags & 0x80) !== 0;
      const hasExtendedHeader = (flags & 0x40) !== 0;

      const totalSize =
        ((view.getUint8(6) & 0x7f) << 21) |
        ((view.getUint8(7) & 0x7f) << 14) |
        ((view.getUint8(8) & 0x7f) << 7) |
        (view.getUint8(9) & 0x7f);

      let tagBodyBytes: Uint8Array = new Uint8Array(buffer, 10, Math.min(totalSize, buffer.byteLength - 10));
      if (unsynchronised) {
        tagBodyBytes = decodeUnsynchronisation(tagBodyBytes);
      }

      const bodyView = new DataView(tagBodyBytes.buffer, tagBodyBytes.byteOffset, tagBodyBytes.byteLength);
      let offset = 0;

      // Skip Extended Header if present
      if (hasExtendedHeader) {
        if (majorVersion === 3) {
          const extSize = (bodyView.getUint8(offset) << 24) |
                          (bodyView.getUint8(offset + 1) << 16) |
                          (bodyView.getUint8(offset + 2) << 8) |
                          bodyView.getUint8(offset + 3);
          offset += 4 + extSize;
        } else if (majorVersion === 4) {
          const extSize = ((bodyView.getUint8(offset) & 0x7f) << 21) |
                          ((bodyView.getUint8(offset + 1) & 0x7f) << 14) |
                          ((bodyView.getUint8(offset + 2) & 0x7f) << 7) |
                          (bodyView.getUint8(offset + 3) & 0x7f);
          offset += extSize;
        }
      }

      while (offset < tagBodyBytes.length - (majorVersion === 2 ? 6 : 10)) {
        if (majorVersion === 2) {
          // ID3v2.2 использует 3-символьные ID фреймов и 3-байтные размеры
          const frameId = String.fromCharCode(
            bodyView.getUint8(offset),
            bodyView.getUint8(offset + 1),
            bodyView.getUint8(offset + 2)
          );

          if (!frameId || frameId === '\0\0\0' || /[^A-Z0-9]/.test(frameId)) {
            break;
          }

          const frameSize = (bodyView.getUint8(offset + 3) << 16) |
                            (bodyView.getUint8(offset + 4) << 8) |
                            bodyView.getUint8(offset + 5);

          if (frameSize <= 0 || offset + 6 + frameSize > tagBodyBytes.length) {
            break;
          }

          // TP1 - Artist, TT2 - Title, TAL - Album
          if (frameId === 'TP1' || frameId === 'TT2' || frameId === 'TAL') {
            const encoding = bodyView.getUint8(offset + 6);
            const textBytes = tagBodyBytes.subarray(offset + 7, offset + 6 + frameSize);
            const text = decodeText(textBytes, encoding);

            if (text) {
              if (frameId === 'TP1') result.artist = text;
              else if (frameId === 'TT2') result.title = text;
              else if (frameId === 'TAL') result.album = text;
            }
          }

          offset += 6 + frameSize;
        } else {
          // ID3v2.3 и ID3v2.4 используют 4-символьные ID и 4-байтные размеры
          const frameId = String.fromCharCode(
            bodyView.getUint8(offset),
            bodyView.getUint8(offset + 1),
            bodyView.getUint8(offset + 2),
            bodyView.getUint8(offset + 3)
          );

          if (!frameId || frameId === '\0\0\0\0' || /[^A-Z0-9]/.test(frameId)) {
            break;
          }

          let frameSize = 0;
          if (majorVersion === 4) {
            frameSize =
              ((bodyView.getUint8(offset + 4) & 0x7f) << 21) |
              ((bodyView.getUint8(offset + 5) & 0x7f) << 14) |
              ((bodyView.getUint8(offset + 6) & 0x7f) << 7) |
              (bodyView.getUint8(offset + 7) & 0x7f);
          } else {
            frameSize =
              (bodyView.getUint8(offset + 4) << 24) |
              (bodyView.getUint8(offset + 5) << 16) |
              (bodyView.getUint8(offset + 6) << 8) |
              bodyView.getUint8(offset + 7);
          }

          if (frameSize <= 0 || offset + 10 + frameSize > tagBodyBytes.length) {
            break;
          }

          // TPE1 - Artist, TIT2 - Title, TALB - Album
          if (frameId === 'TPE1' || frameId === 'TIT2' || frameId === 'TALB') {
            const encoding = bodyView.getUint8(offset + 10);
            const textBytes = tagBodyBytes.subarray(offset + 11, offset + 10 + frameSize);
            const text = decodeText(textBytes, encoding);

            if (text) {
              if (frameId === 'TPE1') result.artist = text;
              else if (frameId === 'TIT2') result.title = text;
              else if (frameId === 'TALB') result.album = text;
            }
          }

          offset += 10 + frameSize;
        }
      }
    }
  } catch (err) {
    console.warn('ID3 metadata extraction failed:', err);
  }
  return result;
}
