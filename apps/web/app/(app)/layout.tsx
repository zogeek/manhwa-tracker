import { cookies } from "next/headers";
import { AppHeader } from "@/components/app/app-header";
import { AppSidebar } from "@/components/app/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

// Layout de l'application connectée. Pas de contrôle d'accès ici : un layout ne se ré-exécute pas
// à chaque navigation (doc Next.js) — chaque page appelle verifySession() au plus près des données.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Mémorise l'état ouvert/replié de la sidebar (cookie posé par le composant shadcn).
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <div className="flex flex-1 flex-col gap-6 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
