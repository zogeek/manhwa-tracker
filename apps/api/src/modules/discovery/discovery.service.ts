import type { TransactionRunner } from '../../shared/db/transaction.js';
import {
  AppError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../shared/lib/errors.js';
import type { ManhwaRepository } from '../manhwas/manhwa.repository.js';
import type { Manhwa, ManhwaSearchHit } from '../manhwas/manhwa.schema.js';
import type { DiscoveryRepository, VocabularyRef } from './discovery.repository.js';
import type { CatalogSearchQuery, ImportManhwaInput } from './discovery.validator.js';
import type { ExternalCatalogProvider, ExternalManhwa, ExternalProvider } from './external-catalog.js';

export type DiscoveryRepositories = { discovery: DiscoveryRepository };

/** Vocabulaires de la taxonomie alimentés par l'import (créés à la volée s'ils manquent). */
export const IMPORT_VOCABULARIES = {
  genres: { slug: 'genre', name: 'Genres' },
  tags: { slug: 'theme', name: 'Thèmes' },
} satisfies Record<string, VocabularyRef>;

export type ExternalSearchStatus = 'ok' | 'unavailable' | 'rate_limited';

export type ProviderSearchReport = { provider: ExternalProvider; status: ExternalSearchStatus };

/** Résultat externe + l'id local s'il a déjà été importé (le front affiche alors « Voir » au lieu d'« Importer »). */
export type ExternalSearchHit = ExternalManhwa & { importedManhwaId: string | null };

export type CatalogSearchResult = {
  local: ManhwaSearchHit[];
  external: ExternalSearchHit[];
  /** Fournisseurs interrogés et leur état ; vide si la recherche locale a suffi. */
  providers: ProviderSearchReport[];
};

export type ImportOutcome = { manhwa: Manhwa; created: boolean };

type ProviderSearch = { report: ProviderSearchReport; hits: ExternalSearchHit[] };
type ProviderOutcome = { status: ExternalSearchStatus; items: ExternalManhwa[] };

/**
 * Découverte du catalogue : recherche floue locale, repli sur les catalogues externes,
 * puis import à la demande d'une œuvre externe dans notre base.
 */
export class DiscoveryService {
  constructor(
    private readonly manhwas: Pick<ManhwaRepository, 'search' | 'findById'>,
    private readonly repo: DiscoveryRepository,
    private readonly providers: readonly ExternalCatalogProvider[],
    private readonly transactions: TransactionRunner<DiscoveryRepositories>,
  ) {}

  async search({ q, limit, external }: CatalogSearchQuery): Promise<CatalogSearchResult> {
    const local = await this.manhwas.search(q, limit);
    if (local.length > 0 && !external) return { local, external: [], providers: [] };

    const searches = await Promise.all(this.providers.map((provider) => this.searchProvider(provider, q, limit)));
    return {
      local,
      external: searches.flatMap((search) => search.hits),
      providers: searches.map((search) => search.report),
    };
  }

  /**
   * Import idempotent : une œuvre déjà importée n'est jamais dupliquée (`created: false`).
   * L'appel au fournisseur a lieu AVANT la transaction : on ne garde pas de connexion Postgres
   * ouverte pendant un appel réseau.
   */
  async importManhwa({ provider, externalId }: ImportManhwaInput, userId: string): Promise<ImportOutcome> {
    const client = this.providers.find((candidate) => candidate.name === provider);
    if (!client) throw new BadRequestError(`External provider "${provider}" is not configured`);

    const linked = await this.repo.findLinkedManhwa(provider, externalId);
    if (linked) return this.toOutcome({ ...linked, created: false }, provider, externalId);

    const item = await client.findById(externalId);
    if (!item) throw new NotFoundError(`${provider} work`, externalId);

    const outcome = await this.transactions.run(async ({ discovery }) => {
      await discovery.lockExternalRef(provider, externalId);
      // Import concurrent terminé entre-temps : on renvoie la fiche qu'il a créée.
      const concurrent = await discovery.findLinkedManhwa(provider, externalId);
      if (concurrent) return { ...concurrent, created: false };

      const manhwaId = await discovery.insertImportedManhwa(item, userId);
      await discovery.attachTerms(
        manhwaId,
        IMPORT_VOCABULARIES.genres,
        item.genres.map((name) => ({ name, relevance: 100, isSpoiler: false })),
      );
      await discovery.attachTerms(manhwaId, IMPORT_VOCABULARIES.tags, item.tags);
      return { manhwaId, deleted: false, created: true };
    });

    return this.toOutcome(outcome, provider, externalId);
  }

  private async toOutcome(
    { manhwaId, deleted, created }: { manhwaId: string; deleted: boolean; created: boolean },
    provider: ExternalProvider,
    externalId: string,
  ): Promise<ImportOutcome> {
    // Retirée volontairement par un admin : on ne la ressuscite pas en douce.
    if (deleted) throw new ConflictError(`${provider} work ${externalId} was removed from the catalogue`);
    const manhwa = await this.manhwas.findById(manhwaId);
    if (!manhwa) throw new NotFoundError('Manhwa', manhwaId);
    return { manhwa, created };
  }

  /** Une panne ou un quota épuisé chez un fournisseur dégrade la réponse au lieu de la faire échouer. */
  private async searchProvider(provider: ExternalCatalogProvider, q: string, limit: number): Promise<ProviderSearch> {
    // `Promise.resolve().then` : même une exception synchrone du fournisseur arrive dans le gestionnaire d'échec.
    const search = await Promise.resolve()
      .then(() => provider.search(q, limit))
      .then(
        (items): ProviderOutcome => ({ status: 'ok', items }),
        (error: unknown): ProviderOutcome => {
          if (error instanceof ServiceUnavailableError) return { status: 'rate_limited', items: [] };
          if (error instanceof AppError) {
            console.warn(`[DISCOVERY] ${provider.name} search failed: ${error.message}`);
            return { status: 'unavailable', items: [] };
          }
          throw error; // bug de programmation : ne pas le masquer
        },
      );

    const imported = await this.repo.findImportedManhwaIds(
      provider.name,
      search.items.map((item) => item.externalId),
    );
    return {
      report: { provider: provider.name, status: search.status },
      hits: search.items.map((item) => ({ ...item, importedManhwaId: imported.get(item.externalId) ?? null })),
    };
  }
}
