import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/app/lib/routes";

export default function ManhwaNotFound() {
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Série introuvable</CardTitle>
        <CardDescription>Cette série n&apos;existe pas ou a été retirée du catalogue.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href={ROUTES.catalog}>Retour au catalogue</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
