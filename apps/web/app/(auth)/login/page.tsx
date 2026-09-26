import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/app/login-form";
import { getSession } from "@/app/lib/dal";

export const metadata: Metadata = { title: "Connexion" };

// Server Component : si la session est déjà valide (vérifiée par l'API), inutile d'afficher le formulaire.
export default async function LoginPage() {
  if (await getSession()) redirect("/");

  return (
    <main className="bg-muted flex min-h-svh items-center justify-center p-6">
      <LoginForm />
    </main>
  );
}
