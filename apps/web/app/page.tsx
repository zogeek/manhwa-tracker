"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { 
  BookOpen, 
  Bot, 
  Search, 
  TrendingUp, 
  ArrowRight, 
  Shield, 
  ChevronDown, 
  Layers, 
  Clock, 
  BookOpenCheck, 
  Lock, 
  Bell, 
  Zap, 
  Heart, 
  MessageCircle,
  Menu,
  X,
  Server
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

// Custom SVG GitHub Icon since it's not exported by this version of lucide-react
function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  );
}

// --- ScrollReveal Helper Component ---
function ScrollReveal({ 
  children, 
  delay = 0, 
  direction = "up", 
  distance = 24,
  className = ""
}: { 
  children: React.ReactNode; 
  delay?: number; 
  direction?: "up" | "down" | "left" | "right"; 
  distance?: number;
  className?: string;
}) {
  const [isIntersecting, setIsIntersecting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsIntersecting(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.05 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current);
      }
    };
  }, []);

  const getTransform = () => {
    if (isIntersecting) return "translate(0, 0)";
    switch (direction) {
      case "up": return `translateY(${distance}px)`;
      case "down": return `translateY(-${distance}px)`;
      case "left": return `translateX(${distance}px)`;
      case "right": return `translateX(-${distance}px)`;
    }
  };

  return (
    <div
      ref={ref}
      style={{
        transform: getTransform(),
        opacity: isIntersecting ? 1 : 0,
        transition: `opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)`,
        transitionDelay: `${delay}ms`,
      }}
      className={className}
    >
      {children}
    </div>
  );
}

// --- AnimatedCounter Helper Component ---
function AnimatedCounter({ value, className }: { value: string; className?: string }) {
  const [displayValue, setDisplayValue] = useState("0");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const numericPart = parseInt(value.replace(/[^0-9]/g, ""), 10);
    const suffix = value.replace(/[0-9]/g, "");

    if (isNaN(numericPart)) {
      setDisplayValue(value);
      return;
    }

    let start = 0;
    const duration = 1500;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsedTime = currentTime - startTime;
      const progress = Math.min(elapsedTime / duration, 1);
      const easeProgress = progress * (2 - progress); // Ease Out
      const currentCount = Math.floor(easeProgress * numericPart);

      setDisplayValue(`${currentCount}${suffix}`);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [value]);

  if (!mounted) {
    return <span className={className}>{value}</span>;
  }

  return <span className={className}>{displayValue}</span>;
}

// --- ConveyorBelt Component ---
const popularManhwas = [
  { title: "Solo Leveling", chapters: "200", color: "from-blue-600/20 to-indigo-900/60" },
  { title: "Omniscient Reader", chapters: "215", color: "from-teal-600/20 to-emerald-950/60" },
  { title: "Tower of God", chapters: "634", color: "from-amber-600/20 to-red-950/60" },
  { title: "The Beginning After The End", chapters: "185", color: "from-purple-600/20 to-pink-950/60" },
  { title: "Wind Breaker", chapters: "492", color: "from-cyan-600/20 to-sky-950/60" },
  { title: "Eleceed", chapters: "312", color: "from-green-600/20 to-zinc-900/60" },
];

function ConveyorBelt() {
  const list = [...popularManhwas, ...popularManhwas, ...popularManhwas];

  return (
    <div className="relative w-full overflow-hidden border-y border-zinc-900 bg-zinc-950/50 py-6 backdrop-blur-sm">
      <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-zinc-950 to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-zinc-950 to-transparent z-10 pointer-events-none" />
      
      <div className="animate-marquee flex gap-6">
        {list.map((m, idx) => (
          <div 
            key={idx} 
            className={`flex items-center gap-4 px-5 py-2.5 rounded-xl border border-zinc-805/80 bg-gradient-to-br ${m.color} min-w-[220px] backdrop-blur-md hover:border-teal-500/30 transition-all duration-300`}
          >
            <div className="h-2 w-2 rounded-full bg-teal-500 animate-pulse" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-zinc-100">{m.title}</span>
              <span className="text-xs text-zinc-400 font-mono">Ch. {m.chapters}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Main Page Component ---
export default function Home() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-zinc-950 text-zinc-100 font-sans selection:bg-teal-500/30 selection:text-teal-200">
      {/* Immersive background glows */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-teal-500/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-[160px] pointer-events-none" />
      <div className="absolute bottom-10 left-1/3 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808006_1px,transparent_1px),linear-gradient(to_bottom,#80808006_1px,transparent_1px)] bg-[size:24px_36px] pointer-events-none" />

      {/* Navbar */}
      <header className="relative z-50 w-full max-w-7xl mx-auto px-6 py-5 flex justify-between items-center border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md sticky top-0">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-teal-500/20">
            <BookOpen className="h-5 w-5 text-zinc-950 stroke-[2.5]" />
          </div>
          <span className="font-bold text-xl tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
            ManhwaTracker
          </span>
        </div>

        {/* Desktop Links */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
          <a href="#features" className="hover:text-white transition-colors">Fonctionnalités</a>
          <a href="#timeline" className="hover:text-white transition-colors">Fonctionnement</a>
          <a href="#hosting" className="hover:text-white transition-colors">Hébergement</a>
        </nav>

        <div className="hidden md:flex items-center gap-4">
          <Link href="/login">
            <Button variant="ghost" className="text-zinc-400 hover:text-white hover:bg-zinc-900/50 rounded-xl">
              Se connecter
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button className="bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-zinc-950 font-bold rounded-xl shadow-lg shadow-teal-500/10">
              Dashboard
            </Button>
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <button 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden text-zinc-400 hover:text-white"
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </header>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="fixed inset-x-0 top-[77px] bg-zinc-950/95 border-b border-zinc-900 backdrop-blur-lg p-6 z-40 md:hidden flex flex-col gap-6 animate-fade-in">
          <nav className="flex flex-col gap-4 text-base font-semibold text-zinc-300">
            <a href="#features" onClick={() => setMobileMenuOpen(false)} className="hover:text-teal-400">Fonctionnalités</a>
            <a href="#timeline" onClick={() => setMobileMenuOpen(false)} className="hover:text-teal-400">Fonctionnement</a>
            <a href="#hosting" onClick={() => setMobileMenuOpen(false)} className="hover:text-teal-400">Hébergement</a>
          </nav>
          <Separator className="bg-zinc-800" />
          <div className="flex flex-col gap-3">
            <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="w-full">
              <Button variant="outline" className="w-full border-zinc-800 text-zinc-300 rounded-xl">
                Se connecter
              </Button>
            </Link>
            <Link href="/dashboard" onClick={() => setMobileMenuOpen(false)} className="w-full">
              <Button className="w-full bg-gradient-to-r from-teal-500 to-cyan-500 text-zinc-950 font-bold rounded-xl">
                Dashboard
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <section className="relative z-10 flex flex-col items-center justify-center px-6 pt-16 md:pt-28 pb-12 text-center max-w-5xl mx-auto">
        <ScrollReveal>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-900/80 border border-zinc-850 text-xs text-teal-400 font-semibold mb-8 backdrop-blur-md">
            <span className="flex h-2 w-2 rounded-full bg-teal-500 animate-pulse" />
            Worker Python & Gateway API Hono opérationnels
          </div>
        </ScrollReveal>

        <ScrollReveal delay={100}>
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-black tracking-tight mb-8 leading-[1.1]">
            Centralisez et automatisez le{" "}
            <span className="bg-gradient-to-r from-teal-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent drop-shadow-sm">
              suivi de vos scans
            </span>
          </h1>
        </ScrollReveal>

        <ScrollReveal delay={200}>
          <p className="text-zinc-400 text-base md:text-xl max-w-2xl mb-12 leading-relaxed">
            Gardez un oeil sur votre historique de lecture de Manhwas. Notre scraper s'occupe de surveiller la sortie des scans pour mettre à jour votre tableau de bord en temps réel.
          </p>
        </ScrollReveal>

        <ScrollReveal delay={300}>
          <div className="flex flex-col sm:flex-row gap-4 mb-20">
            <Link href="/login">
              <Button size="lg" className="bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-zinc-950 font-extrabold px-8 shadow-lg shadow-teal-500/20 rounded-xl h-14 animate-glow-pulse">
                Commencer le suivi
                <ArrowRight className="ml-2 h-5 w-5 stroke-[2.5]" />
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button size="lg" variant="outline" className="border-zinc-800 bg-zinc-900/30 text-zinc-300 hover:bg-zinc-900/80 hover:text-white rounded-xl backdrop-blur-sm px-8 h-14">
                Accéder au Dashboard
              </Button>
            </Link>
          </div>
        </ScrollReveal>

        {/* Scroll Indicator */}
        <ScrollReveal delay={400} className="flex flex-col items-center gap-2">
          <span className="text-[10px] font-bold tracking-[0.2em] text-zinc-650 uppercase">
            Faites défiler
          </span>
          <ChevronDown className="text-teal-500 animate-float" size={18} />
        </ScrollReveal>
      </section>

      {/* Horizontal Carousel / Conveyor */}
      <ConveyorBelt />

      {/* Stats Section */}
      <section className="relative z-10 border-y border-zinc-900 bg-zinc-900/10 backdrop-blur-sm py-12 md:py-16">
        <div className="mx-auto max-w-5xl px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { label: "Manga & Manhwas", value: "10K+", icon: Layers, color: "text-teal-400" },
            { label: "Uptime Scraper", value: "99.9%", icon: Shield, color: "text-cyan-400" },
            { label: "Publicités intrusives", value: "0", icon: Lock, color: "text-blue-400" },
            { label: "Hébergement libre", value: "100%", icon: Server, color: "text-purple-400" },
          ].map((stat, i) => (
            <ScrollReveal key={stat.label} delay={i * 100} className="flex flex-col items-center text-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-400">
                <stat.icon size={22} className={stat.color} />
              </div>
              <div>
                <AnimatedCounter
                  value={stat.value}
                  className="block text-2xl md:text-3xl font-black tracking-tight text-white"
                />
                <span className="text-[10px] font-bold tracking-[0.1em] text-zinc-500 uppercase">
                  {stat.label}
                </span>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative z-10 py-20 md:py-32">
        <div className="relative mx-auto max-w-6xl px-6">
          <ScrollReveal>
            <div className="mb-16 md:mb-24 text-center">
              <Badge variant="outline" className="mb-4 border-teal-500/20 bg-teal-500/5 px-4 py-1 text-[11px] font-bold tracking-[0.15em] text-teal-400 uppercase rounded-full">
                Fonctionnalités
              </Badge>
              <h2 className="text-3xl font-black tracking-tight text-white md:text-5xl">
                Un outil taillé pour{" "}
                <span className="bg-gradient-to-r from-teal-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent">
                  votre bibliothèque
                </span>
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-sm md:text-base text-zinc-400 leading-relaxed">
                Gardez le contrôle sur vos lectures grâce à une stack moderne et performante associant Next.js 15, Hono et Python.
              </p>
            </div>
          </ScrollReveal>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Robot Python Playwright",
                description: "Le scraper parcourt silencieusement les sites de scans partenaires et rapporte automatiquement les nouveaux chapitres.",
                icon: Bot,
              },
              {
                title: "Recherche AniList API",
                description: "Liez instantanément vos fiches de manhwas avec leurs métadonnées et affiches officielles en effectuant une recherche rapide.",
                icon: Search,
              },
              {
                title: "Suivi Fluide en un Clic",
                description: "Mettez à jour le chapitre actuel lu d'un simple clic depuis votre mobile ou votre ordinateur de bureau.",
                icon: TrendingUp,
              },
              {
                title: "Zéro Pub, Zéro Trackers",
                description: "Naviguez sur une interface fluide, saine et épurée, sans aucune publicité ni tracking marketing intrusif.",
                icon: Lock,
              },
              {
                title: "Notifications de Sortie",
                description: "Soyez alerté immédiatement quand un nouveau chapitre est extrait et mis en ligne sur les sites de scans.",
                icon: Bell,
              },
              {
                title: "Architecture Performante",
                description: "Hono.js gère la base de données PostgreSQL tandis que le worker Python traite les tâches asynchrones via Redis.",
                icon: Zap,
              }
            ].map((f, i) => (
              <ScrollReveal key={f.title} delay={i * 80}>
                <Card className="group bg-zinc-900/30 border-zinc-900 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-zinc-800 rounded-2xl">
                  <CardContent className="p-6 flex flex-col gap-4">
                    <div className="h-10 w-10 rounded-xl bg-zinc-950 border border-zinc-900 flex items-center justify-center text-teal-400 group-hover:text-teal-300 group-hover:bg-teal-500/5 transition-all">
                      <f.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-zinc-100 text-lg mb-1">{f.title}</h3>
                      <p className="text-zinc-400 text-xs md:text-sm leading-relaxed">{f.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline Section */}
      <section id="timeline" className="relative z-10 bg-zinc-950/60 border-y border-zinc-900/60 py-20 md:py-32">
        <div className="relative mx-auto max-w-4xl px-6">
          <ScrollReveal>
            <div className="mb-16 md:mb-24 text-center">
              <Badge variant="outline" className="mb-4 border-cyan-500/20 bg-cyan-500/5 px-4 py-1 text-[11px] font-bold tracking-[0.15em] text-cyan-400 uppercase rounded-full">
                Comment ça marche ?
              </Badge>
              <h2 className="text-3xl font-black tracking-tight text-white md:text-5xl">
                Le cycle de vie d'une{" "}
                <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                  mise à jour de scan
                </span>
              </h2>
            </div>
          </ScrollReveal>

          <div className="relative">
            {/* Vertical timeline line */}
            <div className="absolute top-0 left-6 hidden h-full w-px md:left-1/2 md:block">
              <div className="h-full w-full bg-gradient-to-b from-teal-500/20 via-cyan-500/20 to-blue-500/20" />
            </div>

            {[
              {
                step: 1,
                title: "Enregistrement de la Série",
                desc: "Ajoutez la série dans votre interface. Le tracker récupère la fiche officielle et lie la série à l'URL du site de scanlation de votre choix.",
                icon: Search,
                color: "rgb(20, 184, 166)" // teal
              },
              {
                step: 2,
                title: "Surveillance Asynchrone",
                desc: "Le service Python Playwright s'active périodiquement en tâche de fond pour aller visiter le site de scan cible.",
                icon: Bot,
                color: "rgb(6, 182, 212)" // cyan
              },
              {
                step: 3,
                title: "Détection de Nouveauté",
                desc: "Le script extrait le numéro du dernier chapitre publié. S'il est supérieur au chapitre stocké en base, une mise à jour est déclenchée.",
                icon: Zap,
                color: "rgb(59, 130, 246)" // blue
              },
              {
                step: 4,
                title: "Notification & Synchronisation",
                desc: "Le scraper envoie une requête HTTP POST à l'API Hono qui met à jour la base de données. Votre tableau de bord affiche instantanément le badge de nouveau chapitre.",
                icon: Bell,
                color: "rgb(168, 85, 247)" // purple
              }
            ].map((item, index) => (
              <ScrollReveal
                key={item.step}
                delay={index * 100}
                direction={index % 2 === 0 ? "left" : "right"}
                className={index < 3 ? "mb-12 md:mb-20" : ""}
              >
                <div
                  className={`relative flex flex-col gap-4 pl-16 md:w-[calc(50%-24px)] md:pl-0 ${
                    index % 2 === 0
                      ? "md:ml-0 md:pr-16 md:text-right"
                      : "md:ml-auto md:pl-16"
                  }`}
                >
                  {/* Step dot - mobile */}
                  <div
                    className="absolute top-0 left-0 flex h-11 w-11 items-center justify-center rounded-xl border md:hidden bg-zinc-950"
                    style={{
                      borderColor: `${item.color}30`,
                    }}
                  >
                    <item.icon size={18} style={{ color: item.color }} />
                  </div>

                  {/* Timeline dot - desktop */}
                  <div
                    className="absolute top-2.5 hidden h-4.5 w-4.5 rounded-full md:block"
                    style={{
                      backgroundColor: item.color,
                      boxShadow: `0 0 0 4px ${item.color}20, 0 0 12px ${item.color}30`,
                      ...(index % 2 === 0
                        ? { right: "-31px" }
                        : { left: "-31px" }),
                    }}
                  />

                  <div>
                    <div
                      className={`mb-2 flex items-center gap-3.5 ${index % 2 === 0 ? "md:justify-end" : "md:justify-start"}`}
                    >
                      <div
                        className="hidden h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 md:flex border"
                        style={{
                          borderColor: `${item.color}20`,
                          order: index % 2 === 0 ? 1 : 0,
                        }}
                      >
                        <item.icon size={16} style={{ color: item.color }} />
                      </div>
                      <span
                        className="text-[10px] font-bold tracking-[0.2em] uppercase"
                        style={{ color: item.color }}
                      >
                        Étape {item.step}
                      </span>
                    </div>
                    <h3 className="text-lg md:text-xl font-bold text-white">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-xs md:text-sm leading-relaxed text-zinc-400">
                      {item.desc}
                    </p>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Hosting Section */}
      <section id="hosting" className="relative z-10 py-20 md:py-32">
        <div className="mx-auto max-w-4xl px-6">
          <ScrollReveal>
            <div className="mb-16 text-center">
              <Badge variant="outline" className="mb-4 border-amber-500/20 bg-amber-500/5 px-4 py-1 text-[11px] font-bold tracking-[0.15em] text-amber-400 uppercase rounded-full">
                Déploiement
              </Badge>
              <h2 className="text-3xl font-black tracking-tight text-white md:text-5xl">
                Où est hébergée{" "}
                <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                  votre instance ?
                </span>
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-sm text-zinc-400 leading-relaxed">
                ManhwaTracker est conçu pour s'adapter à vos besoins de déploiement, que vous souhaitiez une solution clé en main ou un contrôle total en local.
              </p>
            </div>
          </ScrollReveal>

          <div className="grid gap-8 sm:grid-cols-2 max-w-3xl mx-auto">
            {/* Local Server Hosting */}
            <ScrollReveal delay={100} className="h-full">
              <Card className="group relative h-full overflow-hidden bg-zinc-900/20 border-zinc-900 transition-all duration-300 hover:border-zinc-800 hover:bg-zinc-900/40 rounded-2xl flex flex-col justify-between">
                <div>
                  <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-teal-500 to-transparent" />
                  <CardHeader className="px-6 pt-6 pb-0 flex flex-col gap-2">
                    <div className="h-10 w-10 rounded-xl bg-zinc-950 border border-zinc-900 flex items-center justify-center text-teal-400 group-hover:text-teal-300 group-hover:bg-teal-500/5 transition-all">
                      <Server className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-xl font-bold text-white mt-2">Hébergement Local (Vieux PC)</CardTitle>
                    <CardDescription className="text-zinc-500 text-xs uppercase tracking-wider font-semibold">Docker Compose & Tailscale</CardDescription>
                  </CardHeader>
                  <CardContent className="px-6 pt-4">
                    <p className="text-zinc-400 text-xs md:text-sm leading-relaxed mb-4">
                      Idéal pour recycler un vieil ordinateur portable ou un serveur à la maison. Déployez l'entièreté des microservices via notre configuration Docker et accédez-y de l'extérieur en toute sécurité via Tailscale.
                    </p>
                    <Separator className="my-4 bg-zinc-800/80" />
                    <ul className="space-y-2.5 text-xs text-zinc-450">
                      <li className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
                        Gratuit & Open Source à 100%
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
                        Contrôle total sur vos données
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
                        Pas de limitation de requêtes
                      </li>
                    </ul>
                  </CardContent>
                </div>
                <div className="p-6 pt-0">
                  <Badge variant="outline" className="border-teal-500/20 bg-teal-500/5 text-teal-400 rounded-full w-full justify-center py-1.5 font-bold text-xs">
                    Recommandé pour Devs
                  </Badge>
                </div>
              </Card>
            </ScrollReveal>

            {/* Cloud Hosted Option */}
            <ScrollReveal delay={200} className="h-full">
              <Card className="group relative h-full overflow-hidden bg-zinc-900/20 border-zinc-900 transition-all duration-300 hover:border-zinc-800 hover:bg-zinc-900/40 rounded-2xl flex flex-col justify-between">
                <div>
                  <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-500 to-transparent" />
                  <CardHeader className="px-6 pt-6 pb-0 flex flex-col gap-2">
                    <div className="h-10 w-10 rounded-xl bg-zinc-950 border border-zinc-900 flex items-center justify-center text-cyan-400 group-hover:text-cyan-300 group-hover:bg-cyan-500/5 transition-all">
                      <Zap className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-xl font-bold text-white mt-2">Hébergement Cloud</CardTitle>
                    <CardDescription className="text-zinc-500 text-xs uppercase tracking-wider font-semibold">Instance Partagée</CardDescription>
                  </CardHeader>
                  <CardContent className="px-6 pt-4">
                    <p className="text-zinc-400 text-xs md:text-sm leading-relaxed mb-4">
                      Pas envie de gérer des conteneurs Docker ou un serveur chez vous ? Accédez à notre instance hébergée sur le cloud, prête à l'emploi. Le scraping automatique est mutualisé pour préserver les ressources.
                    </p>
                    <Separator className="my-4 bg-zinc-800/80" />
                    <ul className="space-y-2.5 text-xs text-zinc-450">
                      <li className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                        Zéro configuration requise
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                        Accessible partout instantanément
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                        Sauvegardes automatiques
                      </li>
                    </ul>
                  </CardContent>
                </div>
                <div className="p-6 pt-0">
                  <Badge variant="outline" className="border-cyan-500/20 bg-cyan-500/5 text-cyan-400 rounded-full w-full justify-center py-1.5 font-bold text-xs">
                    Clé en main
                  </Badge>
                </div>
              </Card>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="relative z-10 py-20 md:py-32">
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <ScrollReveal>
            <h2 className="text-3xl font-black tracking-tight text-white md:text-5xl">
              Prêt à organiser vos{" "}
              <span className="bg-gradient-to-r from-teal-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent">
                lectures de Manhwas
              </span>
              ?
            </h2>
            <p className="mx-auto mt-5 max-w-md text-sm md:text-base text-zinc-400 leading-relaxed">
              Créez votre liste de suivi en quelques secondes, importez vos séries préférées et laissez notre scraper s'occuper du reste.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href="/login">
                <Button
                  size="lg"
                  className="h-13 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 px-10 text-sm font-bold text-zinc-950 shadow-lg shadow-teal-500/10 transition-all"
                >
                  Créer un compte
                  <ArrowRight size={16} className="ml-1" />
                </Button>
              </Link>
            </div>

            <p className="mt-6 flex items-center justify-center gap-1.5 text-[10px] text-zinc-650">
              <Lock size={10} />
              Entièrement gratuit et sans publicité intrusive.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-zinc-900 bg-zinc-950 py-10">
        <div className="mx-auto max-w-5xl px-6 flex flex-col items-center gap-6 sm:flex-row sm:justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-400 flex items-center justify-center">
              <BookOpen className="h-4 w-4 text-zinc-950 stroke-[2.5]" />
            </div>
            <span className="text-sm font-bold text-zinc-300">ManhwaTracker</span>
          </div>

          {/* Links */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-zinc-500">
            <a href="#features" className="hover:text-zinc-300 transition-colors">Fonctionnalités</a>
            <a href="#timeline" className="hover:text-zinc-300 transition-colors">Fonctionnement</a>
            <a href="#hosting" className="hover:text-zinc-300 transition-colors">Hébergement</a>
            <a href="#" className="hover:text-zinc-300 transition-colors">Confidentialité</a>
            <a href="#" className="hover:text-zinc-300 transition-colors">Mentions légales</a>
          </div>

          {/* Socials & Credits */}
          <div className="flex items-center gap-4 text-zinc-650 text-xs">
            <p className="flex items-center gap-1">
              Fait avec <Heart size={10} className="text-red-500/60" /> par l'équipe
            </p>
            <a href="#" className="hover:text-zinc-400 transition-colors" aria-label="GitHub">
              <GithubIcon size={15} />
            </a>
            <a href="#" className="hover:text-zinc-400 transition-colors" aria-label="Discord">
              <MessageCircle size={15} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
