import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Manhwa Tracker", template: "%s · Manhwa Tracker" },
  description: "Suivez vos lectures de manhwas, mangas et webtoons.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        {/* Notifications éphémères (succès d'un import, erreur réseau…), déclenchées par `toast()`. */}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
