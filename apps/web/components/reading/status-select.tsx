"use client";

import { useOptimistic } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ReadingStatus } from "@/app/lib/api-types";
import { READING_STATUS_LABELS, READING_STATUSES } from "@/app/lib/labels";
import { useProgressUpdate } from "@/hooks/use-progress-update";

type StatusSelectProps = { manhwaId: string; title: string; status: ReadingStatus; className?: string };

/** Changement de statut en un clic, optimiste, avec « Annuler » dans le toast de confirmation. */
export function StatusSelect({ manhwaId, title, status, className }: StatusSelectProps) {
  const { update, isPending } = useProgressUpdate(manhwaId);
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(status);

  const change = (value: string) => {
    const next = READING_STATUSES.find((candidate) => candidate === value);
    if (!next || next === optimisticStatus) return;
    update(
      { status: next },
      {
        optimistic: () => setOptimisticStatus(next),
        success: `« ${title} » est maintenant dans « ${READING_STATUS_LABELS[next]} ».`,
        undo: { status },
      },
    );
  };

  return (
    <Select value={optimisticStatus} onValueChange={change} disabled={isPending}>
      <SelectTrigger className={className} aria-label={`Statut de lecture de ${title}`} aria-busy={isPending}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {READING_STATUSES.map((value) => (
          <SelectItem key={value} value={value}>
            {READING_STATUS_LABELS[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
