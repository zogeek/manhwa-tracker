"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, LibraryBig, Settings, type LucideIcon } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ROUTES } from "@/app/lib/routes";

type NavItem = { title: string; href: string; icon: LucideIcon };

const NAV_ITEMS: NavItem[] = [
  { title: "Catalogue", href: ROUTES.catalog, icon: BookOpen },
  { title: "Ma Bibliothèque", href: ROUTES.library, icon: LibraryBig },
  { title: "Paramètres", href: ROUTES.settings, icon: Settings },
];

// Client Component : l'état « lien actif » dépend de l'URL courante (hook usePathname).
export function NavMain() {
  const pathname = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_ITEMS.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton asChild isActive={pathname.startsWith(item.href)} tooltip={item.title}>
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
