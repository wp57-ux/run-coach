// Trims leading/trailing silence from the voice clips so cues land promptly
// and stay well under Android's 5-second "short sound" limit.
// Run: node tools/trim-audio.mjs [clip names…]   (no names = every clip)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'audio');
const THRESHOLD = 400;      // 16-bit sample level treated as silence
const PAD_START = 0.03;     // seconds kept before the first sound
const PAD_END = 0.08;       // seconds kept after the last sound

const only = process.argv.slice(2);
const wanted = f => f.endsWith('.wav') && (!only.length || only.includes(f.slice(0, -4)));

for (const name of (await fs.readdir(dir)).filter(wanted)) {
  const file = path.join(dir, name);
  const buf = await fs.readFile(file);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') data = { start: off + 8, size: Math.min(size, buf.length - off - 8) };
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.bits !== 16 || fmt.channels !== 1) {
    console.log(`${name}: skipped (unexpected format)`);
    continue;
  }
  const n = data.size / 2;
  const at = i => buf.readInt16LE(data.start + i * 2);
  let first = 0, last = n - 1;
  while (first < n && Math.abs(at(first)) < THRESHOLD) first++;
  while (last > first && Math.abs(at(last)) < THRESHOLD) last--;
  const s0 = Math.max(0, first - Math.round(PAD_START * fmt.rate));
  const s1 = Math.min(n, last + Math.round(PAD_END * fmt.rate));
  const pcm = buf.subarray(data.start + s0 * 2, data.start + s1 * 2);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(fmt.rate, 24);
  header.writeUInt32LE(fmt.rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  await fs.writeFile(file, Buffer.concat([header, pcm]));
  console.log(`${name.padEnd(14)} ${(n / fmt.rate).toFixed(2)}s -> ${((s1 - s0) / fmt.rate).toFixed(2)}s`);
}
