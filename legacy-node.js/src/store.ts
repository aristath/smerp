import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MAX_BYTES, demand, emptyData, normalize, parseBackup, type Data } from './model.ts';

export const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex');
export class Conflict extends Error { constructor() { super('Something changed on another device. Review the latest values before saving again.'); } }
export class Store {
  file: string;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(file: string) { this.file = file; }
  async raw(): Promise<string> {
    try { return await readFile(this.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
  }
  async read() {
    const raw = await this.raw();
    return { data: raw ? parseBackup(raw) : emptyData(), revision: fingerprint(raw) };
  }
  update(revision: string, action: (data: Data) => Data) { return this.commit(revision, raw => action(raw ? parseBackup(raw) : emptyData())); }
  replace(revision: string, data: Data) { return this.commit(revision, () => data); }
  private commit(revision: string, action: (raw: string) => Data) {
    const result = this.pending.then(async () => {
      const raw = await this.raw();
      if (revision !== fingerprint(raw)) throw new Conflict();
      const data = normalize(action(raw)), contents = JSON.stringify(data, null, 2) + '\n';
      demand(Buffer.byteLength(contents) <= MAX_BYTES, 'Data exceeds the 10 MB backup limit.');
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(contents, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, this.file);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      return { data, revision: fingerprint(contents) };
    });
    this.pending = result.catch(() => {});
    return result;
  }
}
