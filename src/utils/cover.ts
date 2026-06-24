/**
 * Extracts ID3 cover art from audio Files completely client-side
 */
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
 * Extracts ID3 cover art from audio Files completely client-side
 */
export async function extractCoverFromAudio(file: File): Promise<string | null> {
  try {
    const buffer = await file.slice(0, 10 * 1024 * 1024).arrayBuffer(); // read first 10MB
    const view = new DataView(buffer);

    // Simple MP3 ID3v2 Parser
    if (view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
      // Found ID3 header
      const majorVersion = view.getUint8(3);
      const flags = view.getUint8(5);
      const unsynchronised = (flags & 0x80) !== 0;
      const hasExtendedHeader = (flags & 0x40) !== 0;

      const totalSize = ((view.getUint8(6) & 0x7f) << 21) |
                        ((view.getUint8(7) & 0x7f) << 14) |
                        ((view.getUint8(8) & 0x7f) << 7) |
                        (view.getUint8(9) & 0x7f);

      let tagBodyBytes: any = new Uint8Array(buffer, 10, Math.min(totalSize, buffer.byteLength - 10));
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

          if (frameId === 'PIC') {
            const picBytes = tagBodyBytes.subarray(offset + 6, offset + 6 + frameSize);
            
            let imgStart = -1;
            let mime = 'image/jpeg';
            for (let i = 0; i < picBytes.length - 4; i++) {
               // JPEG magic header: FF D8 FF
               if (picBytes[i] === 0xFF && picBytes[i+1] === 0xD8 && picBytes[i+2] === 0xFF) {
                  imgStart = i;
                  mime = 'image/jpeg';
                  break;
               }
               // PNG magic header: 89 50 4E 47
               if (picBytes[i] === 0x89 && picBytes[i+1] === 0x50 && picBytes[i+2] === 0x4E && picBytes[i+3] === 0x47) {
                  imgStart = i;
                  mime = 'image/png';
                  break;
               }
            }
            
            if (imgStart !== -1) {
               const imgData = picBytes.subarray(imgStart);
               const blob = new Blob([imgData], { type: mime });
               return URL.createObjectURL(blob);
            }
            break;
          }

          offset += 6 + frameSize;
        } else {
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

          if (frameId === 'APIC') {
            const apicBytes = tagBodyBytes.subarray(offset + 10, offset + 10 + frameSize);
            
            let imgStart = -1;
            let mime = 'image/jpeg';
            for (let i = 0; i < apicBytes.length - 4; i++) {
               // JPEG magic header: FF D8 FF
               if (apicBytes[i] === 0xFF && apicBytes[i+1] === 0xD8 && apicBytes[i+2] === 0xFF) {
                  imgStart = i;
                  mime = 'image/jpeg';
                  break;
               }
               // PNG magic header: 89 50 4E 47
               if (apicBytes[i] === 0x89 && apicBytes[i+1] === 0x50 && apicBytes[i+2] === 0x4E && apicBytes[i+3] === 0x47) {
                  imgStart = i;
                  mime = 'image/png';
                  break;
               }
            }
            
            if (imgStart !== -1) {
               const imgData = apicBytes.subarray(imgStart);
               const blob = new Blob([imgData], { type: mime });
               return URL.createObjectURL(blob);
            }
            break;
          }

          offset += 10 + frameSize;
        }
      }

      // Brute force inside the synchronized tagBodyBytes
      for (let i = 0; i < tagBodyBytes.length - 4; i++) {
        if (tagBodyBytes[i] === 0xFF && tagBodyBytes[i+1] === 0xD8 && tagBodyBytes[i+2] === 0xFF) {
          const blob = new Blob([tagBodyBytes.subarray(i, Math.min(i + 2 * 1024 * 1024, tagBodyBytes.length))], { type: 'image/jpeg' });
          return URL.createObjectURL(blob);
        }
        if (tagBodyBytes[i] === 0x89 && tagBodyBytes[i+1] === 0x50 && tagBodyBytes[i+2] === 0x4E && tagBodyBytes[i+3] === 0x47) {
          const blob = new Blob([tagBodyBytes.subarray(i, Math.min(i + 2 * 1024 * 1024, tagBodyBytes.length))], { type: 'image/png' });
          return URL.createObjectURL(blob);
        }
      }
    }

    // Fallback brute force search for JPEG/PNG magic bytes in raw buffer if no ID3 tag found
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length - 4; i++) {
      if (bytes[i] === 0xFF && bytes[i+1] === 0xD8 && bytes[i+2] === 0xFF) {
        const blob = new Blob([bytes.subarray(i, Math.min(i + 2 * 1024 * 1024, bytes.length))], { type: 'image/jpeg' });
        return URL.createObjectURL(blob);
      }
      if (bytes[i] === 0x89 && bytes[i+1] === 0x50 && bytes[i+2] === 0x4E && bytes[i+3] === 0x47) {
        const blob = new Blob([bytes.subarray(i, Math.min(i + 2 * 1024 * 1024, bytes.length))], { type: 'image/png' });
        return URL.createObjectURL(blob);
      }
    }
  } catch (err) {
    console.warn('Failed parsing audio cover art header:', err);
  }
  return null;
}
