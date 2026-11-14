import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { HttpError } from '../../lib/http-error.js';
import type { CreateNoteInput, Note, UpdateNoteInput } from './note.schema.js';

/** Shape written to disk. Versioned so the format can evolve later. */
interface NotesFile {
  readonly version: 1;
  readonly notes: Note[];
}

interface NoteRepositoryOptions {
  readonly filePath: string;
}

/**
 * Notes persisted as a single JSON document.
 *
 * Only ciphertext is ever written: `title` is plaintext (it has to be, so the
 * list can render without a password) while the body stays encrypted end to
 * end. Writes go through a temporary file plus `rename`, which is atomic on
 * both POSIX and Windows, so a crash mid-write cannot truncate the store.
 */
export class NoteRepository {
  readonly #filePath: string;
  readonly #notes = new Map<string, Note>();
  #writeQueue: Promise<void> = Promise.resolve();

  constructor({ filePath }: NoteRepositoryOptions) {
    this.#filePath = filePath;
  }

  /** Read the store from disk. Missing file means "no notes yet". */
  async load(): Promise<void> {
    let raw: string;

    try {
      raw = await readFile(this.#filePath, 'utf8');
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }

      throw error;
    }

    this.#notes.clear();

    const trimmed = raw.trim();
    if (trimmed === '') {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw HttpError.internal(`Notes file ${this.#filePath} is not valid JSON`);
    }

    for (const note of extractNotes(parsed)) {
      this.#notes.set(note.id, note);
    }
  }

  /** Newest edit first, which is the order the list renders in. */
  list(): Note[] {
    return [...this.#notes.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  findById(id: string): Note | undefined {
    return this.#notes.get(id);
  }

  getById(id: string): Note {
    const note = this.findById(id);

    if (!note) {
      throw HttpError.notFound(`Note ${id} not found`);
    }

    return note;
  }

  async create(input: CreateNoteInput): Promise<Note> {
    const now = new Date().toISOString();
    const note: Note = {
      id: randomUUID(),
      title: input.title,
      cipher: input.cipher,
      salt: input.salt,
      iv: input.iv,
      createdAt: now,
      updatedAt: now,
    };

    this.#notes.set(note.id, note);
    await this.#persist();

    return note;
  }

  async update(id: string, input: UpdateNoteInput): Promise<Note> {
    const current = this.getById(id);

    const updated: Note = {
      ...current,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.cipher === undefined ? {} : { cipher: input.cipher }),
      ...(input.salt === undefined ? {} : { salt: input.salt }),
      ...(input.iv === undefined ? {} : { iv: input.iv }),
      updatedAt: new Date().toISOString(),
    };

    this.#notes.set(id, updated);
    await this.#persist();

    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!this.#notes.delete(id)) {
      throw HttpError.notFound(`Note ${id} not found`);
    }

    await this.#persist();
  }

  clear(): void {
    this.#notes.clear();
  }

  get size(): number {
    return this.#notes.size;
  }

  /**
   * Serialise writes so two concurrent requests cannot interleave their
   * temporary files, and so each caller only resolves once its own snapshot
   * has hit the disk.
   */
  #persist(): Promise<void> {
    const snapshot: NotesFile = { version: 1, notes: this.list() };

    this.#writeQueue = this.#writeQueue.then(() => this.#writeFile(snapshot));

    return this.#writeQueue;
  }

  async #writeFile(snapshot: NotesFile): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });

    const temporaryPath = join(dirname(this.#filePath), `.${randomUUID()}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.#filePath);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/** Accept both the versioned wrapper and a bare array, and drop junk entries. */
function extractNotes(parsed: unknown): Note[] {
  const candidate = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && 'notes' in parsed
      ? (parsed as { notes?: unknown }).notes
      : undefined;

  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.filter(isNote);
}

function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const note = value as Record<string, unknown>;

  return (
    typeof note['id'] === 'string' &&
    typeof note['title'] === 'string' &&
    typeof note['cipher'] === 'string' &&
    typeof note['salt'] === 'string' &&
    typeof note['iv'] === 'string' &&
    typeof note['createdAt'] === 'string' &&
    typeof note['updatedAt'] === 'string'
  );
}
