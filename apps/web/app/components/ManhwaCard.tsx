"use client";

import React from "react";

interface Manhwa {
  id: string;
  title: string;
  coverUrl?: string | null;
  currentChapterRead: number;
  latestChapterAvailable: number;
}

interface ManhwaCardProps {
  manhwa: Manhwa;
  onIncrement: () => void;
  onDecrement: () => void;
}

export default function ManhwaCard({
  manhwa,
  onIncrement,
  onDecrement,
}: ManhwaCardProps) {
  // Calcul de la progression en pourcentage pour la barre visuelle
  const progressPercent = manhwa.latestChapterAvailable > 0
    ? Math.min((manhwa.currentChapterRead / manhwa.latestChapterAvailable) * 100, 100)
    : 0;

  return (
    <div className="relative group overflow-hidden rounded-2xl bg-zinc-900/50 border border-zinc-800/80 backdrop-blur-md p-5 flex flex-col gap-4 shadow-xl hover:shadow-2xl hover:border-teal-500/40 hover:-translate-y-1 transition-all duration-300">
      
      {/* Visual Cover Placeholder / Image */}
      <div className="relative w-full aspect-[16/9] rounded-xl overflow-hidden bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center border border-zinc-800/50">
        {manhwa.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={manhwa.coverUrl}
            alt={manhwa.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          /* Placeholder dégradé premium avec l'initiale si pas d'image */
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-gradient-to-br from-teal-500/10 via-zinc-900 to-zinc-950">
            <span className="text-4xl font-extrabold text-teal-500/30 select-none">
              {manhwa.title.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        
        {/* Badge "Dernier chapitre dispo" */}
        <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full border border-zinc-700/50 text-[11px] font-semibold text-zinc-300">
          Ch. {manhwa.latestChapterAvailable} disponible
        </div>
      </div>

      {/* Content Section */}
      <div className="flex flex-col gap-3">
        <h3 className="font-semibold text-zinc-100 text-lg leading-tight line-clamp-1 group-hover:text-teal-400 transition-colors duration-200">
          {manhwa.title}
        </h3>

        {/* Progression numérique */}
        <div className="flex justify-between items-center text-sm font-medium">
          <span className="text-zinc-400">Progression</span>
          <span className="text-zinc-200 font-mono">
            {manhwa.currentChapterRead} <span className="text-zinc-500">/</span> {manhwa.latestChapterAvailable}
          </span>
        </div>

        {/* Barre de progression visuelle */}
        <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-cyan-400 rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Control Buttons */}
      <div className="flex gap-2.5 mt-2">
        <button
          onClick={onDecrement}
          disabled={manhwa.currentChapterRead <= 0}
          className="flex-1 py-2 px-3 rounded-xl bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/50 text-zinc-200 font-bold text-center flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Décrémenter"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
          </svg>
        </button>
        <button
          onClick={onIncrement}
          className="flex-1 py-2 px-3 rounded-xl bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 hover:border-teal-500/50 text-teal-400 font-bold text-center flex items-center justify-center transition-all"
          title="Incrémenter"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>
    </div>
  );
}
