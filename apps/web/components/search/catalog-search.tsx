"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Globe, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MIN_QUERY_LENGTH } from "@/app/lib/search";
const DEBOUNCE_MS = 350;

type SearchState = { q: string; external: boolean };

/**
 * Barre de recherche du catalogue. Elle ne fait AUCUN appel à l'API : elle écrit la recherche
 * dans l'URL (`?q=…&external=true`) et c'est la page (Server Component) qui relit l'URL et
 * interroge l'API. URL partageable, bouton « précédent » fonctionnel, rechargement sans perte.
 */
export function CatalogSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const external = searchParams.get("external") === "true";

  const navigate = ({ q, external: includeExternal }: SearchState) => {
    clearTimeout(debounce.current);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (q && includeExternal) params.set("external", "true");
    const url = params.size > 0 ? `${pathname}?${params}` : pathname;
    // `replace` : taper une recherche ne remplit pas l'historique d'une entrée par lettre.
    // La transition garde la page actuelle affichée (et `isPending` vrai) jusqu'aux nouveaux résultats.
    startTransition(() => router.replace(url, { scroll: false }));
  };

  const onChange = (value: string) => {
    setQuery(value);
    clearTimeout(debounce.current);
    const q = value.trim();
    if (q.length > 0 && q.length < MIN_QUERY_LENGTH) return;
    // Anti-rebond : on attend une pause dans la frappe avant d'interroger le serveur.
    debounce.current = setTimeout(() => navigate({ q, external }), DEBOUNCE_MS);
  };

  const q = query.trim();
  const tooShort = q.length > 0 && q.length < MIN_QUERY_LENGTH;

  return (
    <div className="flex flex-col gap-2">
      <form
        role="search"
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!tooShort) navigate({ q, external });
        }}
      >
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Rechercher un manhwa, un manga… (ex. Solo Leveling)"
            aria-label="Rechercher une série"
            aria-describedby="catalog-search-hint"
            className="h-10 pr-10 pl-9"
            autoComplete="off"
          />
          <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center">
            {isPending ? (
              <Loader2 className="text-muted-foreground size-4 animate-spin" aria-label="Recherche en cours" />
            ) : (
              query && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => {
                    setQuery("");
                    navigate({ q: "", external: false });
                  }}
                  aria-label="Effacer la recherche"
                >
                  <X />
                </Button>
              )
            )}
          </div>
        </div>
        <Button
          type="button"
          variant={external ? "default" : "outline"}
          className="h-10"
          aria-pressed={external}
          disabled={q.length < MIN_QUERY_LENGTH}
          onClick={() => navigate({ q, external: !external })}
          title="Interroger aussi AniList, MangaDex et Kitsu, même si le catalogue a des résultats"
        >
          <Globe data-icon="inline-start" />
          Chercher aussi en ligne
        </Button>
      </form>
      <p id="catalog-search-hint" className="text-muted-foreground text-xs" aria-live="polite">
        {tooShort
          ? `Encore ${MIN_QUERY_LENGTH - q.length} caractère pour lancer la recherche.`
          : "Recherche tolérante aux fautes, dans les titres et les titres alternatifs."}
      </p>
    </div>
  );
}
