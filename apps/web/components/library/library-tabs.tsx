"use client";

import { Fragment, useState } from "react";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ManhwaGrid } from "@/components/manhwa/manhwa-grid";
import type { ReadingStatus } from "@/app/lib/api-types";
import { READING_STATUS_LABELS, READING_STATUSES } from "@/app/lib/labels";
import { ALL_TAB, type LibraryTab } from "@/app/lib/library";

export type LibraryItem = {
  key: string;
  status: ReadingStatus;
  /** Carte déjà rendue par le serveur (Server Component + contrôles client). */
  card: React.ReactNode;
};

type LibraryTabsProps = { items: LibraryItem[]; initialTab: LibraryTab };

const TABS: { value: LibraryTab; label: string }[] = [
  { value: ALL_TAB, label: "Toutes" },
  ...READING_STATUSES.map((status) => ({ value: status, label: READING_STATUS_LABELS[status] })),
];

const isLibraryTab = (value: string): value is LibraryTab => TABS.some((tab) => tab.value === value);

/**
 * Onglets par statut. Le filtrage se fait dans le navigateur (toutes les cartes sont déjà là) :
 * changer d'onglet est instantané. L'onglet est reflété dans l'URL (`?statut=…`) avec
 * `history.replaceState` — lien partageable, sans nouvelle requête au serveur.
 */
export function LibraryTabs({ items, initialTab }: LibraryTabsProps) {
  const pathname = usePathname();
  const [tab, setTab] = useState<LibraryTab>(initialTab);

  const select = (value: string) => {
    if (!isLibraryTab(value)) return;
    setTab(value);
    window.history.replaceState(null, "", value === ALL_TAB ? pathname : `${pathname}?statut=${value}`);
  };

  const count = (value: LibraryTab) =>
    value === ALL_TAB ? items.length : items.filter((item) => item.status === value).length;

  return (
    <Tabs value={tab} onValueChange={select}>
      <TabsList className="h-auto flex-wrap">
        {TABS.map(({ value, label }) => (
          <TabsTrigger
            key={value}
            value={value}
            className="gap-1.5"
            aria-label={`${label}, ${count(value)} série${count(value) > 1 ? "s" : ""}`}
          >
            {label}
            <Badge variant="secondary" className="tabular-nums" aria-hidden>
              {count(value)}
            </Badge>
          </TabsTrigger>
        ))}
      </TabsList>
      {TABS.map(({ value, label }) => {
        const visible = value === ALL_TAB ? items : items.filter((item) => item.status === value);
        return (
          <TabsContent key={value} value={value} className="mt-2">
            {visible.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Aucune série « {label} »</CardTitle>
                  <CardDescription>Changez le statut d&apos;une série depuis sa carte pour la retrouver ici.</CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <ManhwaGrid>
                {visible.map((item) => (
                  <Fragment key={item.key}>{item.card}</Fragment>
                ))}
              </ManhwaGrid>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
