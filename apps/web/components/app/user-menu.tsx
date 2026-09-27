"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, LogOut, Settings } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient, isAdmin } from "@/app/lib/auth-client";
import { ROUTES } from "@/app/lib/routes";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";

// Client Component : état de session réactif (useSession), menu interactif et déconnexion.
export function UserMenu() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <Skeleton className="size-8 rounded-full" />;

  if (!session) {
    return (
      <Button asChild size="sm">
        <Link href={ROUTES.login}>
          <LogIn />
          Se connecter
        </Link>
      </Button>
    );
  }

  const signOut = async () => {
    await authClient.signOut();
    // Les Server Components ont été rendus avec l'ancienne session : on force un nouveau rendu.
    router.push(ROUTES.login);
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Menu du compte">
          <Avatar className="size-8">
            <AvatarFallback>{initials(session.user.name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span>{session.user.name}</span>
          <span className="text-muted-foreground text-xs font-normal">{session.user.email}</span>
          {isAdmin(session.user.role) && <span className="text-xs font-normal">Administrateur</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={ROUTES.settings}>
            <Settings />
            Paramètres
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={signOut}>
          <LogOut />
          Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
