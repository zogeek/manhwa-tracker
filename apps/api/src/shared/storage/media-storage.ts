import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type StoredMedia = {
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
};

/**
 * Port de stockage des médias (couvertures). Implémentation locale aujourd'hui ;
 * S3 / Cloudflare R2 demain = un nouvel adaptateur, sans toucher aux appelants.
 */
export interface MediaStorage {
  /** Idempotent : écrire deux fois la même clé ne fait rien de plus. */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredMedia | null>;
}

const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};
const TYPE_BY_EXTENSION = new Map(Object.entries(EXTENSION_BY_TYPE).map(([type, extension]) => [extension, type]));

/**
 * Clé = empreinte SHA-256 du contenu + extension. Deux couvertures identiques n'occupent qu'une place,
 * et une clé ne change jamais de contenu (cache HTTP « immutable »). Le format strict rend toute
 * traversée de répertoire (`../`) impossible.
 */
export const MEDIA_KEY_PATTERN = /^[a-f0-9]{64}\.(jpg|png|webp|gif|avif)$/;

export function mediaKeyFor(body: Uint8Array, contentType: string): string {
  const extension = EXTENSION_BY_TYPE[contentType];
  if (!extension) throw new Error(`Unsupported media type: ${contentType}`);
  return `${createHash('sha256').update(body).digest('hex')}.${extension}`;
}

function assertKey(key: string): void {
  if (!MEDIA_KEY_PATTERN.test(key)) throw new Error(`Invalid media key: ${key}`);
}

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

export type LocalDiskMediaStorageOptions = { rootDir: string };

/** Stockage sur disque local : `<rootDir>/<2 premiers caractères>/<clé>` (évite un répertoire géant). */
export class LocalDiskMediaStorage implements MediaStorage {
  constructor(private readonly options: LocalDiskMediaStorageOptions) {}

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    assertKey(key);
    // Le type est porté par l'extension : une clé `.png` ne peut pas contenir un JPEG.
    if (!key.endsWith(`.${EXTENSION_BY_TYPE[contentType] ?? '?'}`)) {
      throw new Error(`Media key ${key} does not match its content type ${contentType}`);
    }
    const path = this.pathOf(key);
    if (await this.exists(path)) return;

    await mkdir(join(this.options.rootDir, key.slice(0, 2)), { recursive: true });
    // Écriture atomique : fichier temporaire puis renommage. Un lecteur ne voit jamais d'image tronquée.
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, body);
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async get(key: string): Promise<StoredMedia | null> {
    if (!MEDIA_KEY_PATTERN.test(key)) return null;
    const contentType = TYPE_BY_EXTENSION.get(key.slice(key.lastIndexOf('.') + 1));
    if (!contentType) return null;

    try {
      const buffer = await readFile(this.pathOf(key));
      return { body: new Uint8Array(buffer), contentType };
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  private pathOf(key: string): string {
    return join(this.options.rootDir, key.slice(0, 2), key);
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
  }
}
