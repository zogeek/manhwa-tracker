import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { verifySession } from "@/app/lib/dal";

export const metadata: Metadata = { title: "Ma Bibliothèque" };

export default async function LibraryPage() {
  await verifySession();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Ma Bibliothèque</h1>
      <Card>
        <CardHeader>
          <CardTitle>En construction</CardTitle>
          <CardDescription>Vos séries suivies et votre progression apparaîtront ici.</CardDescription>
        </CardHeader>
      </Card>
    </>
  );
}
