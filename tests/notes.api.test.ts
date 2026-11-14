import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { NoteRepository } from '../src/modules/notes/note.repository.js';

interface NoteSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface NoteDetail extends NoteSummary {
  readonly cipher: string;
  readonly salt: string;
  readonly iv: string;
}

interface NotePayload {
  readonly data: NoteSummary;
}

interface NoteListPayload {
  readonly data: NoteSummary[];
  readonly meta: { readonly count: number };
}

interface NoteDetailPayload {
  readonly data: NoteDetail;
}

interface ErrorPayload {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Array<{ readonly path: string; readonly message: string }>;
  };
}

function bodyOf<T>(response: { body: unknown }): T {
  return response.body as T;
}

/** Stand-in for a browser-produced AES-GCM payload. */
const SECRET = {
  cipher: 'q83vAAA=',
  salt: 'c2FsdHNhbHQ=',
  iv: 'aXZpdml2aXY=',
} as const;

/** The plaintext a real client would have encrypted before sending. */
const PLAINTEXT = 'совершенно секретный текст';

describe('Notes API', () => {
  let app: Express;
  let repository: NoteRepository;
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'notes-api-'));
    filePath = join(directory, 'notes.json');

    const config = loadConfig({ NODE_ENV: 'test' });
    const logger = createLogger(config);

    repository = new NoteRepository({ filePath });
    app = createApp({ config, logger, noteRepository: repository });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  describe('GET /api/notes', () => {
    it('returns an empty list initially', async () => {
      const response = await request(app).get('/api/notes').expect(200);
      const body = bodyOf<NoteListPayload>(response);

      expect(body.data).toEqual([]);
      expect(body.meta.count).toBe(0);
    });

    it('does not leak ciphertext in the list view', async () => {
      await request(app)
        .post('/api/notes')
        .send({ title: 'Secret', ...SECRET })
        .expect(201);

      const response = await request(app).get('/api/notes').expect(200);
      const body = bodyOf<NoteListPayload>(response);

      expect(body.data).toHaveLength(1);
      expect(body.data[0]).not.toHaveProperty('cipher');
      expect(body.data[0]).not.toHaveProperty('salt');
      expect(JSON.stringify(body)).not.toContain(SECRET.cipher);
    });
  });

  describe('POST /api/notes', () => {
    it('creates a note and returns its summary', async () => {
      const response = await request(app)
        .post('/api/notes')
        .send({ title: 'Заметка', ...SECRET })
        .expect(201);
      const body = bodyOf<NotePayload>(response);

      expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.data.title).toBe('Заметка');
      expect(body.data.createdAt).toBe(body.data.updatedAt);
    });

    it('rejects a missing title', async () => {
      const response = await request(app).post('/api/notes').send(SECRET).expect(400);
      const body = bodyOf<ErrorPayload>(response);

      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('rejects a blank title', async () => {
      await request(app)
        .post('/api/notes')
        .send({ title: '   ', ...SECRET })
        .expect(400);
    });

    it('rejects a non-base64 cipher', async () => {
      await request(app)
        .post('/api/notes')
        .send({ title: 'Bad', ...SECRET, cipher: 'not base64!!' })
        .expect(400);
    });

    it('rejects a missing cipher', async () => {
      await request(app)
        .post('/api/notes')
        .send({ title: 'Bad', salt: SECRET.salt, iv: SECRET.iv })
        .expect(400);
    });
  });

  describe('GET /api/notes/:id', () => {
    it('returns the encrypted payload needed to decrypt', async () => {
      const created = bodyOf<NotePayload>(
        await request(app)
          .post('/api/notes')
          .send({ title: 'Read me', ...SECRET })
          .expect(201),
      );

      const response = await request(app).get(`/api/notes/${created.data.id}`).expect(200);
      const body = bodyOf<NoteDetailPayload>(response);

      expect(body.data.cipher).toBe(SECRET.cipher);
      expect(body.data.salt).toBe(SECRET.salt);
      expect(body.data.iv).toBe(SECRET.iv);
    });

    it('returns 404 for an unknown id', async () => {
      const response = await request(app).get('/api/notes/does-not-exist').expect(404);

      expect(bodyOf<ErrorPayload>(response).error.code).toBe('NOT_FOUND');
    });
  });

  describe('PUT /api/notes/:id', () => {
    it('updates the title and re-encrypted body', async () => {
      const created = bodyOf<NotePayload>(
        await request(app)
          .post('/api/notes')
          .send({ title: 'Before', ...SECRET })
          .expect(201),
      );

      await request(app)
        .put(`/api/notes/${created.data.id}`)
        .send({ title: 'After', cipher: 'bmV3', salt: 'c2FsdDI=', iv: 'aXZpdml2aXg=' })
        .expect(200);

      const response = await request(app).get(`/api/notes/${created.data.id}`).expect(200);
      const body = bodyOf<NoteDetailPayload>(response);

      expect(body.data.title).toBe('After');
      expect(body.data.cipher).toBe('bmV3');
      expect(body.data.updatedAt >= body.data.createdAt).toBe(true);
    });

    it('allows a title-only edit', async () => {
      const created = bodyOf<NotePayload>(
        await request(app)
          .post('/api/notes')
          .send({ title: 'Before', ...SECRET })
          .expect(201),
      );

      await request(app)
        .put(`/api/notes/${created.data.id}`)
        .send({ title: 'Renamed' })
        .expect(200);

      const response = await request(app).get(`/api/notes/${created.data.id}`).expect(200);
      const body = bodyOf<NoteDetailPayload>(response);

      expect(body.data.title).toBe('Renamed');
      expect(body.data.cipher).toBe(SECRET.cipher);
    });

    it('returns 404 for an unknown id', async () => {
      await request(app).put('/api/notes/nope').send({ title: 'x' }).expect(404);
    });
  });

  describe('DELETE /api/notes/:id', () => {
    it('deletes a note', async () => {
      const created = bodyOf<NotePayload>(
        await request(app)
          .post('/api/notes')
          .send({ title: 'Doomed', ...SECRET })
          .expect(201),
      );

      await request(app).delete(`/api/notes/${created.data.id}`).expect(204);
      await request(app).get(`/api/notes/${created.data.id}`).expect(404);
    });

    it('returns 404 for an unknown id', async () => {
      await request(app).delete('/api/notes/nope').expect(404);
    });
  });

  describe('confidentiality', () => {
    it('never writes plaintext to disk', async () => {
      await request(app)
        .post('/api/notes')
        .send({ title: 'Disk check', ...SECRET })
        .expect(201);

      const raw = await readFile(filePath, 'utf8');

      expect(raw).toContain(SECRET.cipher);
      expect(raw).not.toContain(PLAINTEXT);
    });

    it('discards any password a client might send', async () => {
      // Zod strips unknown keys, so a stray password is dropped rather than
      // persisted. The client never sends one, but this guards the contract.
      await request(app)
        .post('/api/notes')
        .send({ title: 'Nope', ...SECRET, password: 'hunter2' })
        .expect(201);

      const raw = await readFile(filePath, 'utf8');

      expect(raw).not.toContain('hunter2');
      expect(raw).not.toContain('password');
    });
  });
});
