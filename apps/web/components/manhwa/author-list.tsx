import type { ManhwaAuthor } from "@/app/lib/api-types";
import { AUTHOR_ROLE_LABELS, AUTHOR_ROLES } from "@/app/lib/labels";

// Composants de présentation purs (sans état) : utilisables côté serveur comme côté client.

const MAX_INLINE = 2;

/** « Scénario : TurtleMe — Dessin : Fuyuki23 » (infobulle et lecteurs d'écran). */
const describeCredits = (authors: readonly ManhwaAuthor[]) =>
  authors.map(({ name, role }) => `${AUTHOR_ROLE_LABELS[role]} : ${name}`).join(" — ");

/** Ligne compacte pour les cartes : « TurtleMe · Fuyuki23 » (+N au-delà de deux noms). */
export function AuthorLine({ authors }: { authors: readonly ManhwaAuthor[] }) {
  if (authors.length === 0) return null;
  const shown = authors.slice(0, MAX_INLINE).map((author) => author.name);
  const hidden = authors.length - shown.length;
  const credits = describeCredits(authors);

  return (
    <p className="text-muted-foreground truncate text-xs" title={credits}>
      <span className="sr-only">{credits}</span>
      <span aria-hidden>
        {shown.join(" · ")}
        {hidden > 0 && ` +${hidden}`}
      </span>
    </p>
  );
}

/** Crédits détaillés pour la fiche, regroupés par rôle (« Scénario & dessin », « Scénario », « Dessin »). */
export function AuthorCredits({ authors }: { authors: readonly ManhwaAuthor[] }) {
  const groups = AUTHOR_ROLES.map((role) => ({
    role,
    people: authors.filter((author) => author.role === role),
  })).filter((group) => group.people.length > 0);
  if (groups.length === 0) return null;

  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {groups.map(({ role, people }) => (
        <div key={role} className="flex gap-1.5">
          <dt className="text-muted-foreground">{AUTHOR_ROLE_LABELS[role]}</dt>
          <dd className="font-medium">
            {people.map(({ name, nativeName }, index) => (
              <span key={name}>
                {index > 0 && ", "}
                {name}
                {/* Nom d'origine (추공) : utile pour retrouver l'auteur sur les sites coréens. */}
                {nativeName && nativeName !== name && (
                  <span className="text-muted-foreground ml-1 font-normal" lang="und">
                    {nativeName}
                  </span>
                )}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
