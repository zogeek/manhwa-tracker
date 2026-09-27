import type { TransactionRunner } from '../../shared/db/transaction.js';
import {
  AppError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../shared/lib/errors.js';
import type { JobQueue } from '../jobs/job.repository.js';
import type { JobRequest } from '../jobs/job.types.js';
import type { ManhwaRepository } from '../manhwas/manhwa.repository.js';
import type { ManhwaSearchHit, ManhwaView } from '../manhwas/manhwa.schema.js';
import type { DiscoveryRepository, ExternalLinkTarget, VocabularyRef } from './discovery.repository.js';
import type { CatalogSearchQuery, ImportManhwaInput } from './discovery.validator.js';
import {
  externalRefKey,
  type ExternalCatalogProvider,
  type ExternalManhwa,
  type ExternalProvider,
  type ExternalRef,
} from './external-catalog.js';

export type DiscoveryRepositories = { discovery: DiscoveryRepository; jobs: JobQueue };

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

export type ImportOutcome = { manhwa: ManhwaView; created: boolean };

type ProviderOutcome = { provider: ExternalProvider; status: ExternalSearchStatus; items: ExternalManhwa[] };
type ImportTarget = ExternalLinkTarget & { created: boolean };

const selfRef = (item: ExternalManhwa): ExternalRef => ({
  provider: item.provider,
  externalId: item.externalId,
  url: item.url,
});

/** La référence de l'œuvre puis ses références croisées : l'ordre de priorité pour la retrouver chez nous. */
const allRefs = (item: ExternalManhwa): ExternalRef[] => [selfRef(item), ...item.crossReferences];

/**
 * Découverte du catalogue : recherche floue locale, repli sur les catalogues externes,
 * puis import à la demande d'une œuvre externe dans notre base.
 *
 * Pattern Strategy : chaque fournisseur (AniList, MangaDex…) est une stratégie interchangeable
 * derrière le port `ExternalCatalogProvider`. Ce service n'a aucun `if (provider === 'anilist')` :
 * il itère sur les stratégies qu'on lui injecte.
 */
export class DiscoveryService {
  constructor(
    private readonly manhwas: Pick<ManhwaRepository, 'search' | 'findById'>,
    private readonly repo: DiscoveryRepository,
    private readonly providers: readonly ExternalCatalogProvider[],
    private readonly transactions: TransactionRunner<DiscoveryRepositories>,
  ) {}

  async search({ q, limit, external, providers }: CatalogSearchQuery): Promise<CatalogSearchResult> {
    const local = await this.manhwas.search(q, limit);
    if (local.length > 0 && !external) return { local, external: [], providers: [] };

    // Filtre facultatif du client, borné aux fournisseurs activés côté serveur.
    const selected = providers ? this.providers.filter((provider) => providers.includes(provider.name)) : this.providers;
    const outcomes = await Promise.all(selected.map((provider) => this.searchProvider(provider, q, limit)));

    const items = outcomes.flatMap((outcome) => outcome.items);
    const imported = await this.repo.findImportedManhwaIds(items.flatMap(allRefs));
    return {
      local,
      external: items.map((item) => ({
        ...item,
        // Déjà importée sous cet id… ou sous celui d'un autre fournisseur (référence croisée).
        importedManhwaId:
          allRefs(item)
            .map((ref) => imported.get(externalRefKey(ref)))
            .find((id) => id !== undefined) ?? null,
      })),
      providers: outcomes.map(({ provider, status }) => ({ provider, status })),
    };
  }

  /**
   * Import idempotent : une œuvre déjà importée n'est jamais dupliquée (`created: false`), y compris
   * quand elle l'a été depuis un autre fournisseur (références croisées).
   * L'appel au fournisseur a lieu AVANT la transaction : on ne garde pas de connexion Postgres
   * ouverte pendant un appel réseau. Les tâches de suivi (miroir de la couverture, synchronisation
   * des chapitres) sont mises en file DANS la transaction (outbox) : pas de fiche sans ses tâches.
   */
  async importManhwa({ provider, externalId }: ImportManhwaInput, userId: string): Promise<ImportOutcome> {
    const client = this.providers.find((candidate) => candidate.name === provider);
    if (!client) throw new BadRequestError(`External provider "${provider}" is not enabled`);

    const linked = await this.repo.findLinkedManhwa(provider, externalId);
    if (linked) return this.toOutcome({ ...linked, created: false }, provider, externalId);

    const item = await client.findById(externalId);
    if (!item) throw new NotFoundError(`${provider} work`, externalId);

    const target = await this.transactions.run(async ({ discovery, jobs }): Promise<ImportTarget> => {
      await discovery.lockExternalRefs(allRefs(item));
      // Import concurrent terminé entre-temps : on renvoie la fiche qu'il a créée.
      // (id canonique du fournisseur, pas celui saisi : `ABC…` et `abc…` désignent la même œuvre MangaDex)
      const concurrent = await discovery.findLinkedManhwa(item.provider, item.externalId);
      if (concurrent) return { ...concurrent, created: false };

      const sibling = await this.findSibling(discovery, item);
      if (sibling) {
        if (sibling.deleted) return { ...sibling, created: false };
        // Même œuvre, autre fournisseur : on complète la fiche existante au lieu d'en créer une seconde.
        const linked =
          (await discovery.linkExternalRefs(sibling.manhwaId, [selfRef(item)])) +
          (await discovery.linkExternalRefs(sibling.manhwaId, item.crossReferences));
        // Auteurs : seulement si la fiche n'en a aucun (ex. importée de Kitsu). Sinon on garde ceux du
        // premier catalogue — les graphies varient trop d'un catalogue à l'autre pour les fusionner sans risque.
        if (!(await discovery.hasAuthors(sibling.manhwaId))) await discovery.attachAuthors(sibling.manhwaId, item.authors);
        // De nouveaux liens peuvent ouvrir l'accès à un flux de chapitres : on redemande une synchronisation.
        if (linked > 0) await jobs.enqueue(this.followUpJobs(sibling.manhwaId, item, { mirrorCover: false }));
        return { ...sibling, created: false };
      }

      const manhwaId = await discovery.insertImportedManhwa(item, userId);
      await discovery.linkExternalRefs(manhwaId, item.crossReferences);
      await discovery.attachTerms(
        manhwaId,
        IMPORT_VOCABULARIES.genres,
        item.genres.map((name) => ({ name, relevance: 100, isSpoiler: false })),
      );
      await discovery.attachTerms(manhwaId, IMPORT_VOCABULARIES.tags, item.tags);
      await discovery.attachAuthors(manhwaId, item.authors);
      await jobs.enqueue(this.followUpJobs(manhwaId, item, { mirrorCover: true }));
      return { manhwaId, deleted: false, created: true };
    });

    return this.toOutcome(target, provider, externalId);
  }

  private async findSibling(discovery: DiscoveryRepository, item: ExternalManhwa): Promise<ExternalLinkTarget | null> {
    for (const ref of item.crossReferences) {
      const linked = await discovery.findLinkedManhwa(ref.provider, ref.externalId);
      if (linked) return linked;
    }
    return null;
  }

  /**
   * Travail asynchrone déclenché par un import (dédoublonné : jamais deux fois la même tâche en attente).
   * `chapters.sync` est demandée pour TOUTE œuvre, sans savoir qui fournit des chapitres : c'est la
   * tâche qui choisit ses sources parmi les liens de l'œuvre (aucun couplage import ↔ fournisseur).
   */
  private followUpJobs(manhwaId: string, item: ExternalManhwa, { mirrorCover }: { mirrorCover: boolean }): JobRequest[] {
    const requests: JobRequest[] = [];
    if (mirrorCover && item.coverUrl) {
      requests.push({
        type: 'cover.mirror',
        payload: { manhwaId, imageUrl: item.coverUrl },
        dedupeKey: `cover.mirror:${manhwaId}:${item.coverUrl}`,
      });
    }
    requests.push({ type: 'chapters.sync', payload: { manhwaId }, dedupeKey: `chapters.sync:${manhwaId}` });
    return requests;
  }

  private async toOutcome(
    { manhwaId, deleted, created }: ImportTarget,
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
  private async searchProvider(provider: ExternalCatalogProvider, q: string, limit: number): Promise<ProviderOutcome> {
    // `Promise.resolve().then` : même une exception synchrone du fournisseur arrive dans le gestionnaire d'échec.
    return Promise.resolve()
      .then(() => provider.search(q, limit))
      .then(
        (items): ProviderOutcome => ({ provider: provider.name, status: 'ok', items }),
        (error: unknown): ProviderOutcome => {
          if (error instanceof ServiceUnavailableError) return { provider: provider.name, status: 'rate_limited', items: [] };
          if (error instanceof AppError) {
            console.warn(`[DISCOVERY] ${provider.name} search failed: ${error.message}`);
            return { provider: provider.name, status: 'unavailable', items: [] };
          }
          throw error; // bug de programmation : ne pas le masquer
        },
      );
  }
}
