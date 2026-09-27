"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";

type CoverImageProps = {
  /** Sources par ordre de préférence (cf. `coverSources`) : copie locale, puis proxy. */
  sources: readonly string[];
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
  placeholderLabel?: string;
};

/**
 * Couverture avec repli automatique : si une source échoue (404, fichier local supprimé, CDN
 * en panne), l'image suivante est essayée, puis un emplacement neutre s'affiche. Jamais d'icône
 * d'image cassée pour l'utilisateur.
 */
export function CoverImage({ sources, alt, sizes, priority, className, placeholderLabel = "Pas de couverture" }: CoverImageProps) {
  const [failed, setFailed] = useState(0);
  const src = sources[failed];

  if (!src) {
    return (
      <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-2">
        <ImageOff className="size-8" aria-hidden />
        <span className="text-xs">{placeholderLabel}</span>
      </div>
    );
  }

  return (
    <Image
      // `key` : une nouvelle source = une nouvelle balise, sans réutiliser l'état d'erreur précédent.
      key={src}
      src={src}
      alt={alt}
      fill
      // Déjà servie (et mise en cache) par notre API : pas de seconde optimisation par Next.
      unoptimized
      priority={priority}
      sizes={sizes}
      className={className}
      onError={() => setFailed((count) => count + 1)}
    />
  );
}
