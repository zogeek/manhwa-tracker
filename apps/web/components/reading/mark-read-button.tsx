"use client";

import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/app/lib/api";
import { formatChapter } from "@/app/lib/format";
import { useApiMutation } from "@/hooks/use-api-mutation";

type MarkReadButtonProps = { chapterId: string; number: number };

/**
 * « J'ai lu ce chapitre » (`POST /reading/reads`) : l'API journalise la lecture ET fait avancer
 * la progression dans la même transaction (jamais de recul si on relit un ancien chapitre).
 */
export function MarkReadButton({ chapterId, number }: MarkReadButtonProps) {
  const { mutate, isPending } = useApiMutation();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() =>
        mutate(() => api.reading.reads.$post({ json: { chapterId } }), {
          onSuccess: () => {
            toast.success(`Chapitre ${formatChapter(number)} marqué comme lu.`);
          },
          onError: (message) => toast.error("Lecture non enregistrée", { description: message }),
        })
      }
      aria-label={`Marquer le chapitre ${formatChapter(number)} comme lu`}
    >
      {isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}
      Lu
    </Button>
  );
}
