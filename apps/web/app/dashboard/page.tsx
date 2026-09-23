"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { InferRequestType, InferResponseType } from "hono/client";
import { api } from "../lib/api";
import { authClient, isAdmin } from "../lib/auth-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BookOpen,
  LogOut,
  Plus,
  Search,
  BookOpenCheck,
  Layers,
  Grid,
  Table,
  List,
  ChevronRight,
  Trash2,
  Star,
  Calendar,
  Hash,
  BarChart3,
  Activity,
  Tag,
  Pen,
  Flag,
  ShieldCheck,
} from "lucide-react";

// Types dérivés du contrat Hono RPC : toute évolution de l'API casse la compilation ici.
type LibraryEntry = InferResponseType<typeof api.reading.progress.$get, 200>["data"][number];
type CatalogManhwa = InferResponseType<typeof api.manhwas.$get, 200>["data"][number];
type ProgressPatch = InferRequestType<(typeof api.reading.progress)[":manhwaId"]["$put"]>["json"];
type ReadingStatus = LibraryEntry["status"];

const READING_STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: "En cours",
  plan_to_read: "À lire",
  on_hold: "En pause",
  completed: "Terminé",
  dropped: "Abandonné",
};

const MANHWA_TYPE_LABELS: Record<LibraryEntry["manhwa"]["type"], string> = {
  manhwa: "Manhwa",
  manga: "Manga",
  manhua: "Manhua",
  webtoon: "Webtoon",
};

const RELEASE_STATUS_LABELS: Record<LibraryEntry["manhwa"]["status"], string> = {
  ongoing: "En cours de parution",
  completed: "Série terminée",
  hiatus: "En pause",
  cancelled: "Annulée",
};

const isReadingStatus = (value: string): value is ReadingStatus => value in READING_STATUS_LABELS;

const ACTIVE_STATUSES: ReadingStatus[] = ["reading", "plan_to_read", "on_hold"];

const getProgressPercent = (entry: LibraryEntry): number => {
  const total = entry.manhwa.totalChapters;
  if (!total || total <= 0) return 0;
  return Math.min(Math.round((entry.currentChapter / total) * 100), 100);
};

const formatDate = (value: string | null): string =>
  value
    ? new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : "—";

const statusBadgeClass = (status: ReadingStatus): string =>
  status === "completed"
    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
    : status === "dropped"
      ? "bg-red-500/10 text-red-400 border border-red-500/20"
      : "bg-sky-500/10 text-sky-400 border border-sky-500/20";

// Session absente/expirée : `useSession` redirige vers /login (cf. effet du composant).
const fetchLibrary = async (): Promise<LibraryEntry[]> => {
  const res = await api.reading.progress.$get();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data;
};

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const userIsAdmin = isAdmin(session?.user.role);

  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<"gallery" | "table" | "list">("gallery");
  const [activeTab, setActiveTab] = useState<"all" | "reading" | "completed">("reading");
  const [searchQuery, setSearchQuery] = useState("");

  // Ajout à la bibliothèque (depuis le catalogue, ou création au catalogue pour les admins)
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogManhwa[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState("");
  const [createInCatalog, setCreateInCatalog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTotal, setNewTotal] = useState(0);
  const [newCurrent, setNewCurrent] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find((entry) => entry.manhwaId === selectedId) ?? null;

  const [draggedId, setDraggedId] = useState<string | null>(null);

  const redirectToLogin = useCallback(() => router.replace("/login"), [router]);

  const loadLibrary = useCallback(async () => {
    try {
      setEntries(await fetchLibrary());
    } catch (err) {
      console.error("Erreur de récupération", err);
      setError("Impossible de charger votre bibliothèque.");
    }
  }, []);

  useEffect(() => {
    if (sessionPending) return;
    if (!session) {
      redirectToLogin();
      return;
    }

    let cancelled = false;
    fetchLibrary()
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err: unknown) => {
        console.error("Erreur de récupération", err);
        if (!cancelled) setError("Impossible de charger votre bibliothèque.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, sessionPending, redirectToLogin]);

  const openAddDialog = async () => {
    setIsAddOpen(true);
    const res = await api.manhwas.$get();
    if (res.ok) setCatalog((await res.json()).data);
  };

  const trackedIds = useMemo(() => new Set(entries.map((entry) => entry.manhwaId)), [entries]);
  const untrackedCatalog = catalog.filter((manhwa) => !trackedIds.has(manhwa.id));

  // Mise à jour optimiste : l'UI change tout de suite, la réponse serveur fait foi ensuite.
  const updateProgress = async (manhwaId: string, patch: ProgressPatch) => {
    setEntries((prev) => prev.map((entry) => (entry.manhwaId === manhwaId ? { ...entry, ...patch } : entry)));
    try {
      const res = await api.reading.progress[":manhwaId"].$put({ param: { manhwaId }, json: patch });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json();
      setEntries((prev) => prev.map((entry) => (entry.manhwaId === manhwaId ? { ...entry, ...data } : entry)));
    } catch (err) {
      console.error("Erreur de synchronisation", err);
      setError("La modification n'a pas pu être enregistrée.");
      void loadLibrary();
    }
  };

  const resetAddForm = () => {
    setSelectedCatalogId("");
    setCreateInCatalog(false);
    setNewTitle("");
    setNewTotal(0);
    setNewCurrent(0);
    setIsAddOpen(false);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      let manhwaId = selectedCatalogId;

      if (createInCatalog) {
        if (!newTitle.trim()) return;
        const created = await api.manhwas.$post({
          json: { title: newTitle.trim(), totalChapters: newTotal > 0 ? newTotal : null },
        });
        if (!created.ok) throw new Error(`HTTP ${created.status}`);
        manhwaId = (await created.json()).data.id;
      }
      if (!manhwaId) return;

      const res = await api.reading.progress[":manhwaId"].$put({
        param: { manhwaId },
        json: { currentChapter: newCurrent, status: newCurrent > 0 ? "reading" : "plan_to_read" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      resetAddForm();
      await loadLibrary();
    } catch (err) {
      console.error("Erreur d'ajout", err);
      setError("Impossible d'ajouter cette série.");
    }
  };

  const handleRemove = async (entry: LibraryEntry) => {
    if (!confirm(`Retirer « ${entry.manhwa.title} » de votre bibliothèque ?`)) return;
    const res = await api.reading.progress[":manhwaId"].$delete({ param: { manhwaId: entry.manhwaId } });
    if (res.ok) {
      setEntries((prev) => prev.filter((item) => item.manhwaId !== entry.manhwaId));
      setSelectedId(null);
    } else {
      setError("Impossible de retirer cette série.");
    }
  };

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/");
  };

  // Note stockée sur 10, affichée sur 5 étoiles.
  const renderStars = (rating: number | null, onChange?: (rating: number) => void) => {
    const stars = rating ? Math.round(rating / 2) : 0;
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            disabled={!onChange}
            onClick={(e) => {
              e.stopPropagation();
              onChange?.(star * 2);
            }}
            className={`text-base transition-colors ${
              star <= stars ? "text-amber-400" : "text-zinc-700 hover:text-zinc-500"
            }`}
          >
            ★
          </button>
        ))}
      </div>
    );
  };

  // Réorganisation locale par glisser-déposer (par identifiant, indépendante des filtres).
  const handleDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setEntries((prev) => {
      const from = prev.findIndex((entry) => entry.manhwaId === draggedId);
      const to = prev.findIndex((entry) => entry.manhwaId === targetId);
      const moved = prev[from];
      if (from === -1 || to === -1 || !moved) return prev;
      const next = prev.filter((_, index) => index !== from);
      next.splice(to, 0, moved);
      return next;
    });
    setDraggedId(null);
  };

  const dragProps = (entry: LibraryEntry) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setDraggedId(entry.manhwaId);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: () => handleDrop(entry.manhwaId),
    onClick: () => setSelectedId(entry.manhwaId),
  });

  const filteredEntries = entries.filter((entry) => {
    const matchesSearch = entry.manhwa.title.toLowerCase().includes(searchQuery.toLowerCase());
    if (activeTab === "reading") return matchesSearch && ACTIVE_STATUSES.includes(entry.status);
    if (activeTab === "completed") return matchesSearch && entry.status === "completed";
    return matchesSearch;
  });

  return (
    <div className="min-h-screen bg-[#191919] text-zinc-100 font-sans flex flex-col antialiased">
      {/* Top Header bar */}
      <header className="flex justify-between items-center px-8 py-3.5 border-b border-[#2c2c2c] bg-[#191919] sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="h-6.5 w-6.5 rounded-md bg-gradient-to-br from-teal-500 to-cyan-400 flex items-center justify-center">
            <BookOpen className="h-3.5 w-3.5 text-zinc-950 stroke-[2.5]" />
          </div>
          <span className="font-bold text-sm tracking-tight text-zinc-200">ManhwaTracker</span>
        </div>
        <div className="flex items-center gap-4">
          {session && (
            <span className="flex items-center gap-1.5 text-xs text-[#808080]">
              {session.user.name}
              {userIsAdmin && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-semibold">
                  <ShieldCheck className="h-3 w-3" />
                  Admin
                </span>
              )}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg gap-2 text-xs"
          >
            <LogOut className="h-3.5 w-3.5" />
            Déconnexion
          </Button>
        </div>
      </header>

      {/* Document Header */}
      <div className="max-w-6xl w-full mx-auto px-8 pt-10 pb-4">
        <div className="flex items-center gap-4 text-4xl font-extrabold tracking-tight">
          <span className="select-none">📕</span>
          <h1>Liste de lecture</h1>
        </div>
        <p className="text-[#808080] text-sm mt-2">Ma bibliothèque de Scan/BD/Manhwa</p>
        {error && (
          <p role="alert" className="mt-4 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {/* View Switcher & Toolbar */}
      <div className="max-w-6xl w-full mx-auto px-8 py-2 border-b border-[#2c2c2c] flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-1 text-sm text-[#808080] font-medium">
          <button
            onClick={() => setActiveTab("all")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === "all" ? "bg-[#2c2c2c] text-zinc-100 font-semibold" : "hover:bg-[#252525]"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Tous les livres
          </button>
          <button
            onClick={() => setActiveTab("reading")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === "reading" ? "bg-[#2c2c2c] text-zinc-100 font-semibold" : "hover:bg-[#252525]"
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            En cours de lecture
          </button>
          <button
            onClick={() => setActiveTab("completed")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === "completed" ? "bg-[#2c2c2c] text-zinc-100 font-semibold" : "hover:bg-[#252525]"
            }`}
          >
            <BookOpenCheck className="h-3.5 w-3.5" />
            Terminés
          </button>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative w-full md:w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
            <Input
              type="text"
              placeholder="Rechercher..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#202020] border-[#2c2c2c] pl-8 h-8 rounded-lg focus:border-[#373737] text-xs w-full text-zinc-200 focus:ring-0 focus:ring-offset-0"
            />
          </div>

          <div className="flex items-center bg-[#202020] border border-[#2c2c2c] p-0.5 rounded-lg">
            <button
              onClick={() => setViewMode("gallery")}
              className={`p-1.5 rounded-md transition-colors ${viewMode === "gallery" ? "bg-[#2c2c2c] text-teal-400" : "text-[#808080] hover:text-zinc-300"}`}
              title="Vue Galerie"
            >
              <Grid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-[#2c2c2c] text-teal-400" : "text-[#808080] hover:text-zinc-300"}`}
              title="Vue Liste"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`p-1.5 rounded-md transition-colors ${viewMode === "table" ? "bg-[#2c2c2c] text-teal-400" : "text-[#808080] hover:text-zinc-300"}`}
              title="Vue Tableau"
            >
              <Table className="h-3.5 w-3.5" />
            </button>
          </div>

          <Button
            onClick={openAddDialog}
            size="sm"
            className="bg-teal-500 hover:bg-teal-600 text-zinc-950 font-bold text-xs h-8 px-4 rounded-lg flex items-center gap-1"
          >
            New
            <ChevronRight className="h-3 w-3 stroke-[3]" />
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 max-w-6xl w-full mx-auto px-8 py-8">
        {loading || sessionPending ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="h-6 w-6 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
            <p className="text-zinc-650 text-xs">Chargement de votre liste...</p>
          </div>
        ) : filteredEntries.length > 0 ? (
          viewMode === "gallery" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 stagger-children">
              {filteredEntries.map((entry) => {
                const progress = getProgressPercent(entry);
                return (
                  <div
                    key={entry.manhwaId}
                    {...dragProps(entry)}
                    className="group relative bg-[#202020] border border-[#2c2c2c] hover:border-[#373737] hover:bg-[#252525] rounded-xl p-4.5 flex flex-col justify-between gap-4.5 shadow-sm hover:shadow-[0_4px_16px_rgba(0,0,0,0.3)] transition-all duration-200 cursor-pointer active:scale-[0.98] hover-lift"
                  >
                    <div className="space-y-1">
                      <h3 className="font-bold text-sm text-zinc-200 group-hover:text-teal-450 transition-colors line-clamp-2">
                        {entry.manhwa.title}
                      </h3>
                      <p className="text-[#808080] text-[11px] font-medium leading-tight">
                        {READING_STATUS_LABELS[entry.status]}
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] font-semibold px-2 py-0.5 bg-[#191919] border border-[#2c2c2c] text-[#acacac] rounded-md">
                        {MANHWA_TYPE_LABELS[entry.manhwa.type]}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-mono font-medium text-[#808080]">
                        <span>{progress}%</span>
                        <span>
                          {entry.currentChapter} / {entry.manhwa.totalChapters ?? "?"}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#191919] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all duration-350"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              <div
                onClick={openAddDialog}
                className="border border-dashed border-[#2c2c2c] hover:border-[#373737] bg-transparent hover:bg-[#252525]/40 rounded-xl p-5 flex items-center justify-center text-[#808080] hover:text-zinc-300 transition-all duration-200 cursor-pointer min-h-[140px] text-xs font-semibold gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Ajouter une série
              </div>
            </div>
          ) : viewMode === "list" ? (
            <div className="flex flex-col border border-[#2c2c2c] rounded-xl overflow-hidden bg-[#202020] divide-y divide-[#2c2c2c] shadow-sm stagger-children">
              {filteredEntries.map((entry) => {
                const progress = getProgressPercent(entry);
                return (
                  <div
                    key={entry.manhwaId}
                    {...dragProps(entry)}
                    className="group flex items-center justify-between px-5 py-3.5 hover:bg-[#252525] transition-all duration-200 cursor-pointer text-xs"
                  >
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <span className="text-[#808080] select-none group-hover:text-teal-400 transition-colors">📄</span>
                      <span className="font-semibold text-[#ececec] group-hover:text-teal-400 transition-colors truncate max-w-[280px]">
                        {entry.manhwa.title}
                      </span>
                    </div>

                    <div className="flex items-center gap-6 shrink-0">
                      <div className="flex items-center gap-2.5 w-32">
                        <span className="font-mono text-[10px] text-[#808080] w-8 text-right font-medium">{progress}%</span>
                        <div className="flex-1 h-1 bg-[#191919] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all duration-350"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-[#191919] border border-[#2c2c2c] text-[#acacac] rounded-md">
                          {MANHWA_TYPE_LABELS[entry.manhwa.type]}
                        </span>
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold tracking-wide ${statusBadgeClass(entry.status)}`}
                        >
                          {READING_STATUS_LABELS[entry.status]}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border border-[#2c2c2c] rounded-xl overflow-hidden bg-[#202020]">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#2c2c2c] bg-[#1f1f1f] text-[#808080] font-semibold uppercase tracking-wider">
                      <th className="px-5 py-3 select-none">Titre</th>
                      <th className="px-4 py-3 select-none">État</th>
                      <th className="px-4 py-3 select-none">Type</th>
                      <th className="px-4 py-3 select-none">Note</th>
                      <th className="px-4 py-3 select-none">Progression</th>
                      <th className="px-4 py-3 select-none">Ch. Actuel</th>
                      <th className="px-4 py-3 select-none">Ch. Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((entry) => {
                      const progress = getProgressPercent(entry);
                      return (
                        <tr
                          key={entry.manhwaId}
                          onClick={() => setSelectedId(entry.manhwaId)}
                          className="border-b border-[#2c2c2c] hover:bg-[#252525] transition-colors cursor-pointer"
                        >
                          <td className="px-5 py-3 font-semibold text-[#ececec] flex items-center gap-2 max-w-[240px] truncate">
                            <span className="text-[#808080] flex-shrink-0">📄</span>
                            {entry.manhwa.title}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide ${statusBadgeClass(entry.status)}`}
                            >
                              {READING_STATUS_LABELS[entry.status]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[#acacac]">{MANHWA_TYPE_LABELS[entry.manhwa.type]}</td>
                          <td className="px-4 py-3">{renderStars(entry.rating)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5 w-24">
                              <span className="font-mono text-[10px] text-[#808080] w-8">{progress}%</span>
                              <div className="flex-1 h-1 bg-[#191919] rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[#ececec] font-mono">{entry.currentChapter}</td>
                          <td className="px-4 py-3 text-[#808080] font-mono">{entry.manhwa.totalChapters ?? "?"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-[#2c2c2c] rounded-2xl gap-3">
            <span className="text-2xl select-none">📭</span>
            <div>
              <h3 className="font-bold text-zinc-300 text-sm">Aucun élément trouvé</h3>
              <p className="text-zinc-550 text-xs mt-1">Essayez un autre mot clé ou ajoutez une série à votre bibliothèque.</p>
            </div>
            <Button
              onClick={openAddDialog}
              size="sm"
              className="bg-[#202020] hover:bg-[#252525] text-[#ececec] border border-[#2c2c2c] rounded-lg text-xs"
            >
              Ajouter une série
            </Button>
          </div>
        )}
      </div>

      {/* --- ADD TO LIBRARY MODAL --- */}
      <Dialog open={isAddOpen} onOpenChange={(open) => (open ? setIsAddOpen(true) : resetAddForm())}>
        <DialogContent className="p-0 bg-[#191919] border-[#2c2c2c] text-zinc-100 rounded-2xl max-w-sm overflow-hidden shadow-2xl">
          <form onSubmit={handleAdd}>
            <div className="p-6 pb-5 space-y-5 text-xs">
              <DialogHeader className="space-y-1.5">
                <DialogTitle className="text-lg font-bold flex items-center gap-2 text-white">
                  <span>📄</span> Ajouter une série
                </DialogTitle>
                <DialogDescription className="text-[#808080] text-xs">
                  Choisissez une œuvre du catalogue pour la suivre
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {createInCatalog ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="newTitle" className="text-[#acacac] font-semibold text-xs">Titre (nouveau au catalogue)</Label>
                      <Input
                        id="newTitle"
                        type="text"
                        placeholder="Sans titre"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        className="bg-[#202020] border-[#2c2c2c] focus:border-[#00c5a1]/50 rounded-lg h-9 text-xs focus-visible:ring-0 focus-visible:ring-offset-0 text-zinc-200"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="newTotal" className="text-[#acacac] font-semibold text-xs">Chapitres parus</Label>
                      <Input
                        id="newTotal"
                        type="number"
                        min="0"
                        placeholder="0"
                        value={newTotal === 0 ? "" : newTotal}
                        onChange={(e) => setNewTotal(Number(e.target.value))}
                        className="bg-[#202020] border-[#2c2c2c] focus:border-[#00c5a1]/50 rounded-lg h-9 text-xs focus-visible:ring-0 focus-visible:ring-offset-0 text-zinc-200 text-center"
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="catalogManhwa" className="text-[#acacac] font-semibold text-xs">Œuvre</Label>
                    <select
                      id="catalogManhwa"
                      value={selectedCatalogId}
                      onChange={(e) => setSelectedCatalogId(e.target.value)}
                      className="w-full bg-[#202020] border border-[#2c2c2c] rounded-lg h-9 px-2 text-xs text-zinc-200 focus:outline-none focus:border-[#00c5a1]/50"
                      required
                    >
                      <option value="">
                        {untrackedCatalog.length > 0 ? "Sélectionner…" : "Aucune œuvre disponible"}
                      </option>
                      {untrackedCatalog.map((manhwa) => (
                        <option key={manhwa.id} value={manhwa.id}>
                          {manhwa.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="newCurrent" className="text-[#acacac] font-semibold text-xs">Chapitre actuel</Label>
                  <Input
                    id="newCurrent"
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={newCurrent === 0 ? "" : newCurrent}
                    onChange={(e) => setNewCurrent(Number(e.target.value))}
                    className="bg-[#202020] border-[#2c2c2c] focus:border-[#00c5a1]/50 rounded-lg h-9 text-xs focus-visible:ring-0 focus-visible:ring-offset-0 text-zinc-200 text-center"
                  />
                </div>

                {userIsAdmin && (
                  <button
                    type="button"
                    onClick={() => setCreateInCatalog((value) => !value)}
                    className="flex items-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300"
                  >
                    <ShieldCheck className="h-3 w-3" />
                    {createInCatalog ? "Choisir dans le catalogue" : "Pas dans le catalogue ? Le créer (admin)"}
                  </button>
                )}
              </div>
            </div>

            <div className="bg-[#2f2f2f] px-6 py-4 flex justify-end items-center gap-3 border-t border-[#2c2c2c]">
              <Button
                type="button"
                variant="ghost"
                onClick={resetAddForm}
                className="text-zinc-400 hover:text-white hover:bg-transparent font-semibold text-xs"
              >
                Annuler
              </Button>
              <Button
                type="submit"
                className="bg-[#00c5a1] hover:bg-[#00b090] text-zinc-950 font-bold px-5 h-9 rounded-lg text-xs"
              >
                Ajouter
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- ENTRY DETAIL MODAL (Notion-style single column properties) --- */}
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        {selected && (
          <DialogContent className="bg-[#191919] border-[#2c2c2c] text-zinc-100 rounded-2xl max-w-xl max-h-[90vh] overflow-y-auto p-0 flex flex-col shadow-2xl animate-scale-in">
            <div className="flex justify-between items-center gap-4 px-6 pt-5 pb-3 animate-fade-in">
              <div className="flex items-center gap-1.5 text-[#808080] text-xs font-medium">
                <span className="text-sm">📄</span>
                <span>Bibliothèque</span>
                <ChevronRight className="h-3 w-3" />
                <span className="text-[#acacac] font-semibold truncate max-w-[200px]">{selected.manhwa.title}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRemove(selected)}
                className="h-7 w-7 text-[#808080] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all duration-200"
                title="Retirer de ma bibliothèque"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="px-6 pb-1 animate-fade-in-up" style={{ animationDelay: "50ms" }}>
              <DialogTitle className="text-[28px] font-bold tracking-tight text-white">{selected.manhwa.title}</DialogTitle>
              <DialogDescription className="sr-only">Détail de votre progression</DialogDescription>
            </div>

            <div className="mx-6 border-b border-[#2c2c2c]" />

            <div className="px-6 py-4 space-y-0 stagger-props">
              {/* Statut de lecture */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Activity className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">État</span>
                </div>
                <select
                  value={selected.status}
                  onChange={(e) => {
                    const status = e.target.value;
                    if (isReadingStatus(status)) void updateProgress(selected.manhwaId, { status });
                  }}
                  className="flex-1 bg-transparent py-1 px-1.5 rounded-md text-[13px] text-[#ececec] focus:bg-[#2c2c2c] focus:outline-none"
                >
                  {Object.entries(READING_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value} className="bg-[#202020]">
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Note */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Star className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Note</span>
                </div>
                <div className="flex-1 py-1 px-1.5">
                  {renderStars(selected.rating, (rating) => void updateProgress(selected.manhwaId, { rating }))}
                </div>
              </div>

              {/* Chapitre actuel (enregistré à la sortie du champ) */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Hash className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Chapitre actuel</span>
                </div>
                <div className="flex-1 flex items-center gap-1.5 py-1 px-1.5">
                  <input
                    key={`${selected.manhwaId}-${selected.currentChapter}`}
                    type="number"
                    min="0"
                    step="any"
                    defaultValue={selected.currentChapter}
                    onBlur={(e) => {
                      const currentChapter = Number(e.target.value);
                      if (Number.isFinite(currentChapter) && currentChapter >= 0 && currentChapter !== selected.currentChapter) {
                        void updateProgress(selected.manhwaId, { currentChapter });
                      }
                    }}
                    className="w-16 bg-[#202020] border border-[#2c2c2c] py-0.5 px-1 rounded-md text-[13px] text-[#ececec] text-center focus:outline-none focus:border-[#373737] transition-colors"
                  />
                  <span className="text-[#505050] text-[13px]">/</span>
                  <span className="text-[#808080] text-[13px]">{selected.manhwa.totalChapters ?? "?"}</span>
                </div>
              </div>

              {/* Plus loin lu */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Flag className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Plus loin lu</span>
                </div>
                <span className="flex-1 py-1 px-1.5 text-[13px] text-[#ececec]">{selected.furthestChapter}</span>
              </div>

              {/* Commencé le */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Calendar className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Commencé le</span>
                </div>
                <span className="flex-1 py-1 px-1.5 text-[13px] text-[#ececec]">{formatDate(selected.startedAt)}</span>
              </div>

              {/* Progression */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <BarChart3 className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Progression</span>
                </div>
                <div className="flex-1 flex items-center gap-3 py-1 px-1.5">
                  <span className="font-mono text-[13px] text-[#acacac] w-10">{getProgressPercent(selected)}%</span>
                  <div className="flex-1 h-1.5 bg-[#2c2c2c] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full animate-progress-fill transition-all duration-500"
                      style={{ width: `${getProgressPercent(selected)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Type & parution */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Tag className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Type</span>
                </div>
                <div className="flex-1 flex items-center gap-2 py-1 px-1.5">
                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-[#2c2c2c] border border-[#373737] text-[#acacac] rounded-md">
                    {MANHWA_TYPE_LABELS[selected.manhwa.type]}
                  </span>
                  <span className="text-[11px] text-[#808080]">{RELEASE_STATUS_LABELS[selected.manhwa.status]}</span>
                </div>
              </div>
            </div>

            <div className="mx-6 border-b border-[#2c2c2c]" />

            {/* Résumé (catalogue) */}
            {selected.manhwa.synopsis && (
              <div className="px-6 pt-4 space-y-2.5 animate-fade-in">
                <div className="flex items-center gap-2 text-[#808080]">
                  <BookOpen className="h-3.5 w-3.5" />
                  <span className="text-[13px] font-semibold">Résumé</span>
                </div>
                <p className="text-[#acacac] leading-relaxed text-[13px]">{selected.manhwa.synopsis}</p>
              </div>
            )}

            {/* Notes personnelles (enregistrées à la sortie du champ) */}
            <div className="px-6 py-4 space-y-2.5 animate-fade-in" style={{ animationDelay: "300ms" }}>
              <div className="flex items-center gap-2 text-[#808080]">
                <Pen className="h-3.5 w-3.5" />
                <span className="text-[13px] font-semibold">Mes notes</span>
              </div>
              <textarea
                key={selected.manhwaId}
                defaultValue={selected.notes ?? ""}
                maxLength={5000}
                onBlur={(e) => {
                  if (e.target.value !== (selected.notes ?? "")) {
                    void updateProgress(selected.manhwaId, { notes: e.target.value });
                  }
                }}
                className="w-full bg-transparent border-none p-0 focus:outline-none focus:ring-0 text-[#acacac] leading-relaxed text-[13px] h-28 resize-none placeholder:text-[#505050]"
                placeholder="Vos impressions sur cette œuvre..."
              />
            </div>

            <div className="bg-[#202020] px-6 py-3.5 flex justify-end items-center border-t border-[#2c2c2c] rounded-b-2xl">
              <Button
                onClick={() => setSelectedId(null)}
                className="bg-[#2c2c2c] hover:bg-[#373737] text-[#ececec] font-semibold rounded-lg text-xs transition-all duration-200 hover:scale-[1.02]"
              >
                Fermer la page
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
