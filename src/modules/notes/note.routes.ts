import { Router } from 'express';
import { parseOrThrow } from '../../lib/validate.js';
import { createNoteSchema, updateNoteSchema } from './note.schema.js';
import type { Note } from './note.schema.js';
import type { NoteRepository } from './note.repository.js';

/** The list view only needs metadata — the ciphertext stays on the server. */
interface NoteSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toSummary(note: Note): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/**
 * Build the `/notes` router.
 *
 * There is no decryption endpoint by design: the browser fetches the
 * ciphertext, derives the key from the password and decrypts locally, so the
 * password never travels over the network.
 */
export function createNotesRouter(repository: NoteRepository): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const notes = repository.list().map(toSummary);
    res.json({ data: notes, meta: { count: notes.length } });
  });

  router.get('/:id', (req, res) => {
    const note = repository.getById(req.params.id);

    // Metadata plus the encrypted payload the client needs to decrypt.
    res.json({
      data: {
        ...toSummary(note),
        cipher: note.cipher,
        salt: note.salt,
        iv: note.iv,
      },
    });
  });

  router.post('/', (req, res, next) => {
    const input = parseOrThrow(createNoteSchema, req.body, 'request body');

    repository
      .create(input)
      .then((note) => {
        res.status(201).json({ data: toSummary(note) });
      })
      .catch(next);
  });

  router.put('/:id', (req, res, next) => {
    const input = parseOrThrow(updateNoteSchema, req.body, 'request body');

    repository
      .update(req.params.id, input)
      .then((note) => {
        res.json({ data: toSummary(note) });
      })
      .catch(next);
  });

  router.delete('/:id', (req, res, next) => {
    repository
      .delete(req.params.id)
      .then(() => {
        res.status(204).end();
      })
      .catch(next);
  });

  return router;
}
