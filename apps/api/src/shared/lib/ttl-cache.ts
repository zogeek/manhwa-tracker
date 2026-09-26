import { systemClock, type Clock } from './clock.js';

export type TtlCacheOptions = {
  /** Durée de vie d'une entrée. */
  ttlMs: number;
  /** Au-delà, l'entrée la plus ancienne est évincée (borne mémoire). */
  maxEntries: number;
  clock?: Clock;
};

/**
 * Cache mémoire à expiration, borné en taille (éviction LRU : `Map` conserve l'ordre d'insertion).
 * Local au processus : suffisant pour amortir les appels à une API tierce, à remplacer par Redis
 * dès que l'API tourne sur plusieurs instances.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  private readonly clock: Clock;

  constructor(private readonly options: TtlCacheOptions) {
    this.clock = options.clock ?? systemClock;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    // Réinsertion : la clé devient la plus récemment utilisée.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.clock() + this.options.ttlMs });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
