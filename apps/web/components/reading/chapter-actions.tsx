"use client";

import { Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatChapter } from "@/app/lib/format";
import { useProgressUpdate } from "@/hooks/use-progress-update";

type ChapterActionsProps = {
  manhwaId: string;
  number: number;
  /** Progression confirmée de l'utilisateur (0 si la série n'est pas dans sa bibliothèque). */
  currentChapter: number;
};

/**
 * Menu d'un chapitre : « Lu jusqu'ici » (rattrapage) ou « Reprendre ici » (retour en arrière).
 * Mise à jour ABSOLUE de la progression (`PUT`, `currentChapter = N`) : aucune entrée n'est ajoutée
 * à l'historique des lectures — on déclare une position, on ne prétend pas avoir lu 120 chapitres
 * à la même seconde. « Annuler » dans le toast restaure la position précédente.
 */
export function ChapterActions({ manhwaId, number, currentChapter }: ChapterActionsProps) {
  const { update, isPending } = useProgressUpdate(manhwaId);
  const label = formatChapter(number);

  const moveTo = (success: string) =>
    update({ currentChapter: number }, { success, undo: { currentChapter } });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" disabled={isPending} aria-label={`Actions pour le chapitre ${label}`}>
          {isPending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Chapitre {label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {number > currentChapter && (
          <DropdownMenuItem onSelect={() => moveTo(`Progression : lu jusqu'au chapitre ${label}.`)}>
            Marquer comme lu jusqu&apos;ici
          </DropdownMenuItem>
        )}
        {number < currentChapter && (
          <DropdownMenuItem onSelect={() => moveTo(`Progression ramenée au chapitre ${label}.`)}>
            Reprendre ici (marquer la suite comme non lue)
          </DropdownMenuItem>
        )}
        {number === currentChapter && <DropdownMenuItem disabled>Vous en êtes ici</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
