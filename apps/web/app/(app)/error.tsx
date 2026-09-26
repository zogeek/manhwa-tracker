"use client"; // Les frontières d'erreur sont des Client Components.

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Filet de sécurité de l'application connectée : une erreur inattendue (API injoignable…)
 * remplace la page par ce message au lieu d'un écran blanc ; la barre latérale reste utilisable.
 * `retry()` (Next.js 16) relance le rendu serveur du segment.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card role="alert" className="max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TriangleAlert className="text-destructive size-5" aria-hidden />
          Impossible d&apos;afficher cette page
        </CardTitle>
        <CardDescription>
          Le serveur n&apos;a pas pu répondre. Vérifiez votre connexion puis réessayez.
          {error.digest && <span className="mt-1 block text-xs">Référence : {error.digest}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => retry()}>
          <RotateCw data-icon="inline-start" />
          Réessayer
        </Button>
      </CardContent>
    </Card>
  );
}
