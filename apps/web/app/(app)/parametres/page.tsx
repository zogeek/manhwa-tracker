import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { verifySession } from "@/app/lib/dal";

export const metadata: Metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const { user } = await verifySession();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Paramètres</h1>
      <Card>
        <CardHeader>
          <CardTitle>Compte</CardTitle>
          <CardDescription>La modification du profil arrivera prochainement.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Pseudo</dt>
            <dd>{user.name}</dd>
            <dt className="text-muted-foreground">E-mail</dt>
            <dd>{user.email}</dd>
            <dt className="text-muted-foreground">Rôle</dt>
            <dd>{user.role ?? "user"}</dd>
          </dl>
        </CardContent>
      </Card>
    </>
  );
}
