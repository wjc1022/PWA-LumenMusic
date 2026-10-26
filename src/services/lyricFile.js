// No accept filter: iOS document providers may not classify LRC/TXT as text.
// Validate decoded content instead, without restricting its language or timestamps.
export async function readLyricFile(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Lyrics file too large');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (!text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text)) throw new Error('Invalid lyrics text');
  if (/^(?:%PDF-|PK\x03\x04|GIF8|\u0089PNG)/u.test(text)) throw new Error('Binary file');
  return text;
}
