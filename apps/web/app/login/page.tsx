"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BookOpen, Lock, Mail, ArrowLeft, User } from "lucide-react";
import { authClient } from "../lib/auth-client";

type Mode = "signIn" | "signUp";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isSignUp = mode === "signUp";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);

    // Le cookie de session est posé par Better Auth via le proxy Next.js (/api/auth/*).
    const { error: authError } = isSignUp
      ? await authClient.signUp.email({ name, email, password })
      : await authClient.signIn.email({ email, password });

    setPending(false);
    if (authError) {
      setError(authError.message ?? "Identifiants invalides.");
      return;
    }
    router.push("/dashboard");
  };

  const toggleMode = () => {
    setMode(isSignUp ? "signIn" : "signUp");
    setError(null);
  };

  return (
    <div className="relative min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6 overflow-hidden">
      {/* Background gradients */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-teal-500/10 rounded-full blur-[140px] pointer-events-none animate-pulse duration-[8000ms]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px] pointer-events-none" />

      {/* Floating Back to Home button */}
      <div className="absolute top-6 left-6 z-10">
        <Link href="/">
          <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white hover:bg-zinc-900/50 rounded-xl gap-2">
            <ArrowLeft className="h-4 w-4" />
            Retour à l&apos;accueil
          </Button>
        </Link>
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo and Intro */}
        <div className="flex flex-col items-center gap-3 mb-8 text-center">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-teal-500/20">
            <BookOpen className="h-6 w-6 text-zinc-950 stroke-[2.5]" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
            {isSignUp ? "Créer votre compte" : "Bon retour parmi nous"}
          </h2>
          <p className="text-zinc-400 text-sm">
            {isSignUp
              ? "Quelques secondes pour commencer à suivre vos lectures"
              : "Entrez vos identifiants pour accéder à votre liste de suivi"}
          </p>
        </div>

        {/* Login Card */}
        <Card className="bg-zinc-900/40 border-zinc-800/80 backdrop-blur-md shadow-2xl rounded-2xl">
          <form onSubmit={handleSubmit}>
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-xl font-bold">{isSignUp ? "Inscription" : "Connexion"}</CardTitle>
              <CardDescription className="text-zinc-500 text-xs">
                {isSignUp ? "Mot de passe : 10 caractères minimum" : "Connexion par e-mail et mot de passe"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-zinc-300 text-sm font-medium">
                    Pseudo
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <Input
                      id="name"
                      type="text"
                      placeholder="Votre pseudo"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="bg-zinc-950/60 border-zinc-800/80 focus:border-teal-500/50 focus:ring-teal-500/20 pl-10 rounded-xl text-zinc-200"
                      required
                    />
                  </div>
                </div>
              )}

              {/* Email field */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-zinc-300 text-sm font-medium">
                  Adresse e-mail
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="nom@exemple.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="bg-zinc-950/60 border-zinc-800/80 focus:border-teal-500/50 focus:ring-teal-500/20 pl-10 rounded-xl text-zinc-200"
                  />
                </div>
              </div>

              {/* Password field */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="password" className="text-zinc-300 text-sm font-medium">
                    Mot de passe
                  </Label>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    autoComplete={isSignUp ? "new-password" : "current-password"}
                    minLength={isSignUp ? 10 : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="bg-zinc-950/60 border-zinc-800/80 focus:border-teal-500/50 focus:ring-teal-500/20 pl-10 rounded-xl text-zinc-200"
                  />
                </div>
              </div>
              {error && (
                <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
            </CardContent>

            <CardFooter className="flex flex-col gap-4 pt-2">
              <Button type="submit" disabled={pending} className="w-full bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-zinc-950 font-bold py-2 rounded-xl shadow-lg shadow-teal-500/10">
                {pending ? "Patientez..." : isSignUp ? "Créer mon compte" : "Se connecter"}
              </Button>

              <div className="text-center text-xs text-zinc-500 w-full">
                {isSignUp ? "Déjà un compte ?" : "Pas encore de compte ?"}{" "}
                <button
                  type="button"
                  onClick={toggleMode}
                  className="text-teal-400 hover:text-teal-300 transition-colors font-medium"
                >
                  {isSignUp ? "Se connecter" : "Créer un compte"}
                </button>
              </div>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
