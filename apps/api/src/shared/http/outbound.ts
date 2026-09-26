import { BadGatewayError } from '../lib/errors.js';

/**
 * Signature minimale de `fetch`, injectée dans les clients HTTP sortants (AniList, proxy d'images).
 * Le `fetch` global la satisfait ; les tests fournissent un faux qui ne sort jamais sur le réseau.
 */
export type HttpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Lit le corps d'une réponse en refusant d'en charger plus de `maxBytes` en mémoire
 * (un `Content-Length` peut mentir ou manquer : on compte réellement les octets reçus).
 */
export async function readBodyWithLimit(res: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new BadGatewayError(`Upstream response exceeds ${maxBytes} bytes`);
  }
  if (!res.body) return new Uint8Array(0);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new BadGatewayError(`Upstream response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
