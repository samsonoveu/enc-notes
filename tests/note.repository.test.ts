import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NoteRepository } from '../src/modules/notes/note.repository.js';
import { isHttpError } from '../src/lib/http-error.js';

/** Base64 that satisfies the schema without being real ciphertext. */
const PAYLOAD = {
  cipher: 'AAAA',
  salt: 'BBBB',
  iv: 'CCCC',
} as const;

describe('NoteRepository', () => {
  let directory: string;
  let filePath: string;
  let repository: NoteRepository;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'notes-'));
    filePath = join(directory, 'nested', 'notes.json');
    repository = new NoteRepository({ filePath });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('starts empty when the file does not exist', async () => {
    await repository.load();

    expect(repository.list()).toEqual([]);
    expect(repository.size).toBe(0);
  });

  it('creates a note with generated id and timestamps', async () => {
    const note = await repository.create({ title: 'Первая', ...PAYLOAD });

    expect(note.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(note.title).toBe('Первая');
    expect(note.cipher).toBe('AAAA');
    expect(note.createdAt).toBe(note.updatedAt);
  });

  it('writes the note to disk and reloads it', async () => {
    const created = await repository.create({ title: 'Persisted', ...PAYLOAD });

    const reopened = new NoteRepository({ filePath });
    await reopened.load();

    expect(reopened.list()).toHaveLength(1);
    expect(reopened.getById(created.id).title).toBe('Persisted');
  });

  it('creates the parent directory when missing', async () => {
    await repository.create({ title: 'Nested', ...PAYLOAD });

    const raw = await readFile(filePath, 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });
  });

  it('updates fields and bumps updatedAt', async () => {
    const note = await repository.create({ title: 'Before', ...PAYLOAD });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = await repository.update(note.id, { title: 'After', cipher: 'ZZZZ' });

    expect(updated.title).toBe('After');
    expect(updated.cipher).toBe('ZZZZ');
    expect(updated.salt).toBe('BBBB');
    expect(updated.updatedAt > note.updatedAt).toBe(true);
    expect(updated.createdAt).toBe(note.createdAt);
  });

  it('lists newest edit first', async () => {
    const first = await repository.create({ title: 'One', ...PAYLOAD });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repository.create({ title: 'Two', ...PAYLOAD });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repository.update(first.id, { title: 'One again' });

    expect(repository.list().map((note) => note.title)).toEqual(['One again', 'Two']);
  });

  it('deletes a note and persists the removal', async () => {
    const note = await repository.create({ title: 'Gone', ...PAYLOAD });
    await repository.delete(note.id);

    const reopened = new NoteRepository({ filePath });
    await reopened.load();

    expect(reopened.list()).toEqual([]);
  });

  it('throws 404 for unknown ids', async () => {
    await expect(repository.update('missing', { title: 'x' })).rejects.toSatisfy(isHttpError);
    await expect(repository.delete('missing')).rejects.toSatisfy(isHttpError);
    expect(() => repository.getById('missing')).toThrowError(/not found/i);
  });

  it('ignores malformed entries instead of failing to start', async () => {
    await writeFile(
      filePath.replace('nested', '.'),
      JSON.stringify({ version: 1, notes: [{ id: 'x' }, null, 42] }),
      'utf8',
    );

    const flat = filePath.replace('nested', '.');
    const reopened = new NoteRepository({ filePath: flat });
    await reopened.load();

    expect(reopened.list()).toEqual([]);
  });

  it('accepts a bare array file', async () => {
    const flat = join(directory, 'bare.json');
    await writeFile(
      flat,
      JSON.stringify([
        {
          id: '11111111-1111-1111-1111-111111111111',
          title: 'Bare',
          cipher: 'AAAA',
          salt: 'BBBB',
          iv: 'CCCC',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ]),
      'utf8',
    );

    const reopened = new NoteRepository({ filePath: flat });
    await reopened.load();

    expect(reopened.list()).toHaveLength(1);
  });

  it('treats an empty file as no notes', async () => {
    const flat = join(directory, 'empty.json');
    await writeFile(flat, '   \n', 'utf8');

    const reopened = new NoteRepository({ filePath: flat });
    await reopened.load();

    expect(reopened.list()).toEqual([]);
  });

  it('surfaces a corrupt file as an error', async () => {
    const flat = join(directory, 'corrupt.json');
    await writeFile(flat, '{not json', 'utf8');

    const reopened = new NoteRepository({ filePath: flat });

    await expect(reopened.load()).rejects.toThrowError(/not valid JSON/i);
  });

  it('serialises concurrent writes without losing a note', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_value, index) =>
        repository.create({ title: `Note ${index}`, ...PAYLOAD }),
      ),
    );

    const reopened = new NoteRepository({ filePath });
    await reopened.load();

    expect(reopened.list()).toHaveLength(10);
  });
});
