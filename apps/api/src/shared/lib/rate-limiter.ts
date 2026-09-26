import { systemClock, type Clock } from './clock.js';

export type TokenBucketOptions = {
  /** Nombre maximal de requêtes en rafale. */
  capacity: number;
  /** Jetons regagnés par minute (débit moyen autorisé). */
  refillPerMinute: number;
  clock?: Clock;
};

/**
 * Limiteur « seau à jetons » : chaque appel consomme un jeton, le seau se remplit en continu.
 * Protège un quota tiers (ex. AniList ~90 req/min) contre un emballement de nos propres appels.
 */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;
  private readonly clock: Clock;

  constructor(private readonly options: TokenBucketOptions) {
    this.clock = options.clock ?? systemClock;
    this.tokens = options.capacity;
    this.updatedAt = this.clock();
  }

  /** Consomme un jeton si possible ; `false` = quota momentanément épuisé. */
  tryTake(): boolean {
    const now = this.clock();
    const refilled = ((now - this.updatedAt) / 60_000) * this.options.refillPerMinute;
    this.tokens = Math.min(this.options.capacity, this.tokens + refilled);
    this.updatedAt = now;

    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
