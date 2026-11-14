import { z } from 'zod';

/**
 * A note as the server knows it. The plaintext never reaches this layer: the
 * browser encrypts before sending, so `cipher` is an opaque base64 blob and
 * `salt`/`iv` are the parameters needed to decrypt it again.
 */
export interface Note {
  readonly id: string;
  readonly title: string;
  readonly cipher: string;
  readonly salt: string;
  readonly iv: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Everything the client may send when creating or saving a note. */
export interface NoteSecret {
  readonly cipher: string;
  readonly salt: string;
  readonly iv: string;
}

/** Base64 (standard alphabet, with padding). */
const base64 = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be a base64 string');

/** AES-GCM initialisation vector: 96 bits is the recommended size. */
const iv = base64.max(64);

/** PBKDF2 salt: at least 128 bits. */
const salt = base64.max(128);

export const createNoteSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  cipher: base64.max(400_000),
  salt,
  iv,
});

export const updateNoteSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200).optional(),
  cipher: base64.max(400_000).optional(),
  salt: salt.optional(),
  iv: iv.optional(),
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
