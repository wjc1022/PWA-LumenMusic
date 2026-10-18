import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, findActiveLine, findActiveWord } from '../src/lyrics/lrc.mjs';

test('BOM, CRLF, arbitrary minutes and fraction precision', () => {
  const { lines } = parseLrc('\uFEFF[123:59.123]long\r\n[00:01.1]one\r\n[00:02.12]two');
  assert.deepEqual(lines.map(line => line.time), [1.1, 2.12, 7439.123]);
});

test('recognized metadata is hidden; unknown and malformed data remain readable', () => {
  const parsed = parseLrc('[ar: Artist ]\n[ti:]\n[unknown:value]\n[00:60]invalid\n[00:01.1234]precision\n[offset:nope]');
  assert.deepEqual(parsed.metadata, { artist: 'Artist', title: '' });
  assert.deepEqual(parsed.lines.map(line => line.text), ['[unknown:value]', '[00:60]invalid', '[00:01.1234]precision', '[offset:nope]']);
  assert.ok(parsed.lines.every(line => line.time === null));
});

test('plain text and spaces survive; untimed lines follow sorted timed lines', () => {
  const { lines } = parseLrc('  plain  \n\n[00:02] second \n[00:01]first\ntail');
  assert.deepEqual(lines, [{ time: 1, text: 'first' }, { time: 2, text: ' second ' }, { time: null, text: '  plain  ' }, { time: null, text: 'tail' }]);
  assert.deepEqual(parseLrc('').lines, []);
});

test('timed blank lines clear breaks and boundaries choose last duplicate', () => {
  const { lines } = parseLrc('[00:05]first\n[00:10]\n[00:15]a\n[00:15]b\nnotes');
  assert.equal(findActiveLine(lines, 4.999), -1);
  assert.equal(findActiveLine(lines, 5), 0);
  assert.equal(lines[findActiveLine(lines, 12)].text, '');
  assert.equal(findActiveLine(lines, 15), 3);
  assert.equal(findActiveLine(lines, 999), 3);
  assert.equal(findActiveLine(lines, NaN), -1);
  assert.equal(findActiveLine([], 1), -1);
  assert.equal(findActiveLine(parseLrc('plain').lines, 1), -1);
});

test('late positive offset advances every line and word; repeated lines shift segments', () => {
  const { lines, offsetMs } = parseLrc('[00:10][00:20]Oh <00:11>ba<00:11.5>by \n[offset:+500]');
  assert.equal(offsetMs, 500);
  assert.deepEqual(lines, [
    { time: 9.5, text: 'Oh baby ', words: [{ time: 9.5, text: 'Oh ' }, { time: 10.5, text: 'ba' }, { time: 11, text: 'by ' }] },
    { time: 19.5, text: 'Oh baby ', words: [{ time: 19.5, text: 'Oh ' }, { time: 20.5, text: 'ba' }, { time: 21, text: 'by ' }] },
  ]);
  assert.notEqual(lines[0].words, lines[1].words);
});

test('negative offsets delay lyrics; positive offsets may create negative times', () => {
  assert.equal(parseLrc('[offset:-1000]\n[00:01]a').lines[0].time, 2);
  assert.equal(parseLrc('[00:00]a\n[offset:500]').lines[0].time, -0.5);
});

test('enhanced tags preserve spaces, terminal markers and word selection boundaries', () => {
  const { lines } = parseLrc('[00:10]<00:10>Ne<00:10.3>ver <00:10.6> gonna<00:11>');
  const words = lines[0].words;
  assert.equal(lines[0].text, 'Never  gonna');
  assert.deepEqual(words.map(word => word.text), ['Ne', 'ver ', ' gonna', '']);
  assert.equal(findActiveWord(words, 9.99), -1);
  assert.equal(findActiveWord(words, 10), 0);
  assert.equal(findActiveWord(words, 10.599), 1);
  assert.equal(findActiveWord(words, 11), 3);
  assert.equal(findActiveWord([], 1), -1);
});
