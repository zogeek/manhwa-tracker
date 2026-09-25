"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/app/lib/auth-client";

type Mode = "signIn" | "signUp";

const MIN_PASSWORD_LENGTH = 10;

// Client Component : saisie contrôlée, soumission, appel Better Auth depuis le navigateur
// (le cookie de session est posé via le proxy Next.js /api/auth/*).
export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signIn");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isSignUp = mode === "signUp";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "");

    setError(null);
    setPending(true);
    const { error: authError } = isSignUp
      ? await authClient.signUp.email({ name, email, password })
      : await authClient.signIn.email({ email, password });
    setPending(false);

    if (authError) {
      setError(authError.message ?? "Identifiants invalides.");
      return;
    }
    // Nouveau cookie : on navigue puis on redemande aux Server Components un rendu avec la session.
    router.push("/");
    router.refresh();
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{isSignUp ? "Créer un compte" : "Connexion"}</CardTitle>
        <CardDescription>
          {isSignUp ? "Commencez à suivre vos lectures." : "Accédez à votre bibliothèque de manhwas."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            {isSignUp && (
              <Field>
                <FieldLabel htmlFor="name">Pseudo</FieldLabel>
                <Input id="name" name="name" autoComplete="nickname" required />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="email">E-mail</FieldLabel>
              <Input id="email" name="email" type="email" autoComplete="email" placeholder="nom@exemple.com" required />
            </Field>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="password">Mot de passe</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                minLength={isSignUp ? MIN_PASSWORD_LENGTH : undefined}
                aria-invalid={error ? true : undefined}
                required
              />
              {isSignUp && <FieldDescription>{MIN_PASSWORD_LENGTH} caractères minimum.</FieldDescription>}
              {error && <FieldError>{error}</FieldError>}
            </Field>
            <Field>
              <Button type="submit" disabled={pending}>
                {pending ? "Patientez…" : isSignUp ? "Créer mon compte" : "Se connecter"}
              </Button>
              <FieldDescription className="text-center">
                {isSignUp ? "Déjà un compte ?" : "Pas encore de compte ?"}{" "}
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={() => {
                    setMode(isSignUp ? "signIn" : "signUp");
                    setError(null);
                  }}
                >
                  {isSignUp ? "Se connecter" : "Créer un compte"}
                </button>
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
