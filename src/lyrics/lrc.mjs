// Times are seconds. Positive LRC offsets advance both lines and word segments.
const TIME = '(\\d+):([0-5]\\d)(?:\\.(\\d{1,3}))?';
const lineTag = new RegExp(`^\\[${TIME}\\]`);
const wordTag = new RegExp(`<${TIME}>`, 'g');
const metadataNames = {
  ar: 'artist', ti: 'title', al: 'album', au: 'author',
  by: 'by', re: 're', ve: 've', length: 'length',
};

function seconds(match) {
  return Number(match[1]) * 60 + Number(match[2]) + Number((match[3] || '').padEnd(3, '0')) / 1000;
}

function parseWords(text, lineTime) {
  const words = [];
  let end = 0;
  // matchAll clones the regular expression, avoiding shared lastIndex state.
  for (const match of text.matchAll(wordTag)) {
    const preceding = text.slice(end, match.index);
    if (preceding) {
      if (words.length) words[words.length - 1].text += preceding;
      else words.push({ time: lineTime, text: preceding });
    }
    words.push({ time: seconds(match), text: '' });
    end = match.index + match[0].length;
  }
  if (!words.length) return undefined;
  words[words.length - 1].text += text.slice(end);
  return words;
}

export function parseLrc(text) {
  const lines = [];
  const metadata = {};
  let offsetMs = 0;
  for (const raw of String(text ?? '').replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
    if (!raw.trim()) continue;
    const meta = raw.trim().match(/^\[([a-z]+):(.*)\]$/i);
    if (meta) {
      const key = meta[1].toLowerCase();
      const value = meta[2].trim();
      if (key === 'offset' && /^[+-]?\d+$/.test(value)) {
        offsetMs = Number(value);
        metadata.offset = offsetMs;
        continue;
      }
      if (Object.hasOwn(metadataNames, key)) {
        metadata[metadataNames[key]] = value;
        continue;
      }
    }
    const times = [];
    let lyric = raw.trimStart();
    let match;
    while ((match = lyric.match(lineTag))) {
      times.push(seconds(match));
      lyric = lyric.slice(match[0].length);
    }
    if (!times.length) {
      lines.push({ time: null, text: raw });
      continue;
    }
    const words = parseWords(lyric, times[0]);
    for (const time of times) {
      const line = { time, text: words ? words.map(word => word.text).join('') : lyric };
      if (words) line.words = words.map(word => ({ time: word.time + time - times[0], text: word.text }));
      lines.push(line);
    }
  }
  for (const line of lines) {
    if (line.time === null) continue;
    line.time -= offsetMs / 1000;
    for (const word of line.words || []) word.time -= offsetMs / 1000;
  }
  lines.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  return { lines, metadata, offsetMs };
}

// Parsed lines are sorted, with untimed content at the end. Ties select the last.
export function findActiveLine(lines, time) {
  if (Number.isNaN(time)) return -1;
  let left = 0;
  let right = lines.length - 1;
  let result = -1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (lines[mid].time !== null && lines[mid].time <= time) {
      result = mid;
      left = mid + 1;
    } else right = mid - 1;
  }
  return result;
}

// Keep source segment order even for imperfect files with nonmonotonic word tags.
export function findActiveWord(words, time) {
  for (let index = words.length - 1; index >= 0; index--) {
    if (words[index].time <= time) return index;
  }
  return -1;
}
