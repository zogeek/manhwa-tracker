"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InferResponseType } from "hono/client";
import api from "../lib/api";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
  ExternalLink, 
  Trash2,
  FileText,
  Globe,
  User,
  Link2,
  Star,
  Calendar,
  Hash,
  BarChart3,
  Activity,
  Tag,
  Pen
} from "lucide-react";

type BaseManhwa = InferResponseType<typeof api.manhwa.$get>[number];

// Interface extending the API Manhwa type with additional tracked fields
interface Manhwa extends BaseManhwa {
  site?: string;
  type?: string;
  note?: number;
  url?: string;
  statusScan?: "En cours" | "Fini";
  summary?: string;
  startedAt?: string;
  finishedAt?: string;
  author?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [manhwas, setManhwas] = useState<Manhwa[]>([]);
  const [loading, setLoading] = useState(true);

  // View state: 'gallery', 'table', or 'list'
  const [viewMode, setViewMode] = useState<"gallery" | "table" | "list">("gallery");

  // Tab filter: 'all' | 'reading' | 'completed'
  const [activeTab, setActiveTab] = useState<"all" | "reading" | "completed">("reading");

  // Search & sorting
  const [searchQuery, setSearchQuery] = useState("");

  // Dialog state for "New Page" / Add Manhwa
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSite, setNewSite] = useState("Scan Manga");
  const [newCurrent, setNewCurrent] = useState(0);
  const [newTotal, setNewTotal] = useState(0);

  // Selected manhwa for Detail Modal
  const [selectedManhwa, setSelectedManhwa] = useState<Manhwa | null>(null);

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  useEffect(() => {
    const fetchManhwas = async () => {
      try {
        setLoading(true);
        const res = await api.manhwa.$get();
        if (res.ok) {
          const data = await res.json();
          // Map default properties to match Notion screens
          const formatted: Manhwa[] = data.map((item) => {
            const isFinished = item.currentChapterRead >= item.latestChapterAvailable && item.latestChapterAvailable > 0;
            return {
              ...item,
              site: item.title.toLowerCase().includes("reader") || item.title.toLowerCase().includes("returner") 
                ? "Phénix scans" 
                : "Scan Manga",
              type: "Scan",
              note: isFinished ? 5 : 4,
              url: "https://www.scan-manga.com/",
              statusScan: isFinished ? "Fini" : "En cours",
              startedAt: "October 15, 2025",
              finishedAt: isFinished ? "June 24, 2026" : "Empty",
              author: "Empty",
              summary: "Yeonwoo avait un frère jumeau, Jeongwoo, disparu il y a cinq ans. Un jour, la montre à gousset de son frère, dont il ne se séparait jamais, refait surface. Après avoir appris la vérité, Yeonwoo se résout à consacrer sa vie à un unique but : gravir la tour et venger son frère."
            };
          });
          setManhwas(formatted);
        }
      } catch (err) {
        console.error("Erreur de récupération", err);
      } finally {
        setLoading(false);
      }
    };
    fetchManhwas();
  }, []);

  // Sync back to database when modifying main values (chapters read)
  const syncWithDatabase = async (id: string, current: number) => {
    try {
      await api.manhwa[":id"].$patch({
        param: { id },
        json: { currentChapterRead: current },
      });
    } catch (err) {
      console.error("Erreur de synchronisation", err);
    }
  };

  const handleAddManhwa = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      const res = await api.manhwa.$post({
        json: {
          title: newTitle,
          currentChapterRead: Number(newCurrent) || 0,
          latestChapterAvailable: Number(newTotal) || 0,
        },
      });

      if (res.ok) {
        const data = await res.json();
        const created: Manhwa = {
          ...data,
          site: newSite,
          type: "Scan",
          note: 0,
          url: "https://www.scan-manga.com/",
          statusScan: "En cours",
          startedAt: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
          finishedAt: "Empty",
          author: "Empty",
          summary: "Aucune description de disponible pour le moment."
        };

        setManhwas((prev) => [...prev, created]);
        setNewTitle("");
        setNewCurrent(0);
        setNewTotal(0);
        setIsAddOpen(false);
      }
    } catch (err) {
      console.error("Erreur d'ajout", err);
    }
  };

  // Update a single property of selected Manhwa
  const updateSelectedField = (field: keyof Manhwa, value: any) => {
    if (!selectedManhwa) return;
    
    const updated = { ...selectedManhwa, [field]: value };
    
    // Auto-calculate progress percentage
    if (field === "currentChapterRead" || field === "latestChapterAvailable") {
      const current = field === "currentChapterRead" ? Number(value) : selectedManhwa.currentChapterRead;
      const total = field === "latestChapterAvailable" ? Number(value) : selectedManhwa.latestChapterAvailable;
      if (current >= total && total > 0) {
        updated.statusScan = "Fini";
      } else {
        updated.statusScan = "En cours";
      }
    }

    setSelectedManhwa(updated);
    
    // Update local state list
    setManhwas((prev) =>
      prev.map((item) => (item.id === selectedManhwa.id ? updated : item))
    );

    // If it's a database field, trigger API call
    if (field === "currentChapterRead") {
      syncWithDatabase(selectedManhwa.id, Number(value));
    }
  };

  // Rating star renderer
  const renderStars = (rating: number = 0, onChange: (r: number) => void) => {
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            className={`text-base transition-colors ${
              star <= rating ? "text-amber-400" : "text-zinc-700 hover:text-zinc-500"
            }`}
          >
            ★
          </button>
        ))}
      </div>
    );
  };

  // Drag & drop sorting handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    if (draggedIndex === null) return;
    
    const updated = [...manhwas];
    const [reorderedItem] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, reorderedItem);
    
    setManhwas(updated);
    setDraggedIndex(null);
  };

  // Calculate percentages
  const getProgressPercent = (item: Manhwa) => {
    if (!item.latestChapterAvailable || item.latestChapterAvailable <= 0) return 0;
    return Math.min(Math.round((item.currentChapterRead / item.latestChapterAvailable) * 100), 100);
  };

  // Filters logic
  const filteredManhwas = manhwas.filter((m) => {
    const matchesSearch = m.title.toLowerCase().includes(searchQuery.toLowerCase());
    const isFinished = m.currentChapterRead >= m.latestChapterAvailable && m.latestChapterAvailable > 0;

    if (activeTab === "reading") {
      return matchesSearch && !isFinished;
    }
    if (activeTab === "completed") {
      return matchesSearch && isFinished;
    }
    return matchesSearch;
  });

  const handleLogout = () => {
    router.push("/");
  };

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
        <p className="text-[#808080] text-sm mt-2">Ceci est ma liste de lecture de Scan/BD/Manhwa</p>
      </div>

      {/* View Switcher & Toolbar */}
      <div className="max-w-6xl w-full mx-auto px-8 py-2 border-b border-[#2c2c2c] flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        {/* Left tabs: Tous, En cours, Terminés */}
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

        {/* Right controls: Search, View Mode, New Button */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Search bar */}
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

          {/* Toggle View Mode */}
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

          {/* New Page button */}
          <Button 
            onClick={() => setIsAddOpen(true)}
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
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="h-6 w-6 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
            <p className="text-zinc-650 text-xs">Chargement de votre liste...</p>
          </div>
        ) : filteredManhwas.length > 0 ? (
          viewMode === "gallery" ? (
            /* GALLERY VIEW (compact text card) */
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 stagger-children">
              {filteredManhwas.map((item, index) => {
                const progress = getProgressPercent(item);
                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onClick={() => setSelectedManhwa(item)}
                    className="group relative bg-[#202020] border border-[#2c2c2c] hover:border-[#373737] hover:bg-[#252525] rounded-xl p-4.5 flex flex-col justify-between gap-4.5 shadow-sm hover:shadow-[0_4px_16px_rgba(0,0,0,0.3)] transition-all duration-200 cursor-pointer active:scale-[0.98] hover-lift"
                  >
                    {/* Card Top Title & Edit Pencil */}
                    <div className="space-y-1">
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="font-bold text-sm text-zinc-200 group-hover:text-teal-450 transition-colors line-clamp-2">
                          {item.title}
                        </h3>
                      </div>
                      
                      {/* Team / Site description */}
                      <p className="text-[#808080] text-[11px] font-medium leading-tight">
                        {item.site}
                      </p>
                    </div>

                    {/* Badge type */}
                    <div>
                      <span className="text-[10px] font-semibold px-2 py-0.5 bg-[#191919] border border-[#2c2c2c] text-[#acacac] rounded-md">
                        {item.type}
                      </span>
                    </div>

                    {/* Progress slider bar */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-mono font-medium text-[#808080]">
                        <span>{progress}%</span>
                        <span>{item.currentChapterRead} / {item.latestChapterAvailable}</span>
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

              {/* Add New Page card placeholder */}
              <div 
                onClick={() => setIsAddOpen(true)}
                className="border border-dashed border-[#2c2c2c] hover:border-[#373737] bg-transparent hover:bg-[#252525]/40 rounded-xl p-5 flex items-center justify-center text-[#808080] hover:text-zinc-300 transition-all duration-200 cursor-pointer min-h-[140px] text-xs font-semibold gap-1.5"
              >
                <Plus className="h-4 w-4" />
                New page
              </div>
            </div>
          ) : viewMode === "list" ? (
            /* LIST VIEW (clean row layout) */
            <div className="flex flex-col border border-[#2c2c2c] rounded-xl overflow-hidden bg-[#202020] divide-y divide-[#2c2c2c] shadow-sm stagger-children">
              {filteredManhwas.map((item, index) => {
                const progress = getProgressPercent(item);
                const isFinished = item.currentChapterRead >= item.latestChapterAvailable && item.latestChapterAvailable > 0;
                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onClick={() => setSelectedManhwa(item)}
                    className="group flex items-center justify-between px-5 py-3.5 hover:bg-[#252525] transition-all duration-200 cursor-pointer text-xs"
                  >
                    {/* Left part: Icon & Title */}
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <span className="text-[#808080] select-none group-hover:text-teal-400 transition-colors">📄</span>
                      <span className="font-semibold text-[#ececec] group-hover:text-teal-400 transition-colors truncate max-w-[280px]">
                        {item.title}
                      </span>
                      <span className="text-[#808080] text-[10px] truncate max-w-[150px] font-medium">
                        {item.site}
                      </span>
                    </div>

                    {/* Middle/Right part: Progress & badges */}
                    <div className="flex items-center gap-6 shrink-0">
                      {/* Progress indicator */}
                      <div className="flex items-center gap-2.5 w-32">
                        <span className="font-mono text-[10px] text-[#808080] w-8 text-right font-medium">{progress}%</span>
                        <div className="flex-1 h-1 bg-[#191919] rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-emerald-500 rounded-full transition-all duration-350" 
                            style={{ width: `${progress}%` }} 
                          />
                        </div>
                      </div>

                      {/* Badges */}
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-[#191919] border border-[#2c2c2c] text-[#acacac] rounded-md">
                          {item.type}
                        </span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold tracking-wide ${
                          isFinished 
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                            : "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                        }`}>
                          {isFinished ? "Fini" : "En cours"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* TABLE VIEW (clean spreadsheet table) */
            <div className="border border-[#2c2c2c] rounded-xl overflow-hidden bg-[#202020]">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#2c2c2c] bg-[#1f1f1f] text-[#808080] font-semibold uppercase tracking-wider">
                      <th className="px-5 py-3 select-none">Titre</th>
                      <th className="px-4 py-3 select-none">Team/Site</th>
                      <th className="px-4 py-3 select-none">État</th>
                      <th className="px-4 py-3 select-none">Type</th>
                      <th className="px-4 py-3 select-none">Note</th>
                      <th className="px-4 py-3 select-none">Progression</th>
                      <th className="px-4 py-3 select-none">Ch. Actuel</th>
                      <th className="px-4 py-3 select-none">Ch. Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredManhwas.map((item) => {
                      const progress = getProgressPercent(item);
                      const isFinished = item.currentChapterRead >= item.latestChapterAvailable && item.latestChapterAvailable > 0;
                      return (
                        <tr 
                          key={item.id} 
                          onClick={() => setSelectedManhwa(item)}
                          className="border-b border-[#2c2c2c] hover:bg-[#252525] transition-colors cursor-pointer"
                        >
                          <td className="px-5 py-3 font-semibold text-[#ececec] flex items-center gap-2 max-w-[240px] truncate">
                            <span className="text-[#808080] flex-shrink-0">📄</span>
                            {item.title}
                          </td>
                          <td className="px-4 py-3 text-[#acacac] font-medium">{item.site}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide ${
                              isFinished 
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                                : "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                            }`}>
                              {isFinished ? "Fini" : "En cours"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[#acacac]">{item.type}</td>
                          <td className="px-4 py-3">{renderStars(item.note, () => {})}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5 w-24">
                              <span className="font-mono text-[10px] text-[#808080] w-8">{progress}%</span>
                              <div className="flex-1 h-1 bg-[#191919] rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[#ececec] font-mono">{item.currentChapterRead}</td>
                          <td className="px-4 py-3 text-[#808080] font-mono">{item.latestChapterAvailable}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-[#2c2c2c] rounded-2xl gap-3">
            <span className="text-2xl select-none">📭</span>
            <div>
              <h3 className="font-bold text-zinc-300 text-sm">Aucun élément trouvé</h3>
              <p className="text-zinc-550 text-xs mt-1">Essayez un autre mot clé ou créez une nouvelle entrée.</p>
            </div>
            <Button 
              onClick={() => setIsAddOpen(true)}
              size="sm"
              className="bg-[#202020] hover:bg-[#252525] text-[#ececec] border border-[#2c2c2c] rounded-lg text-xs"
            >
              Ajouter une série
            </Button>
          </div>
        )}
      </div>

      {/* --- ADD NEW PAGE MODAL --- */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="p-0 bg-[#191919] border-[#2c2c2c] text-zinc-100 rounded-2xl max-w-sm overflow-hidden shadow-2xl">
          <form onSubmit={handleAddManhwa}>
            {/* Modal Body */}
            <div className="p-6 pb-5 space-y-5 text-xs">
              <DialogHeader className="space-y-1.5">
                <DialogTitle className="text-lg font-bold flex items-center gap-2 text-white">
                  <span>📄</span> Nouveau Manhwa
                </DialogTitle>
                <DialogDescription className="text-[#808080] text-xs">
                  Créer une nouvelle entrée dans votre bibliothèque
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="newTitle" className="text-[#acacac] font-semibold text-xs">Titre</Label>
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
                  <Label htmlFor="newSite" className="text-[#acacac] font-semibold text-xs">Team/Site Scan</Label>
                  <Input
                    id="newSite"
                    type="text"
                    placeholder="Ex: Scan Manga"
                    value={newSite}
                    onChange={(e) => setNewSite(e.target.value)}
                    className="bg-[#202020] border-[#2c2c2c] focus:border-[#00c5a1]/50 rounded-lg h-9 text-xs focus-visible:ring-0 focus-visible:ring-offset-0 text-zinc-200"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="newCurrent" className="text-[#acacac] font-semibold text-xs">Chapitre Actuel</Label>
                    <Input
                      id="newCurrent"
                      type="number"
                      min="0"
                      placeholder="0"
                      value={newCurrent === 0 ? "" : newCurrent}
                      onChange={(e) => setNewCurrent(Number(e.target.value))}
                      className="bg-[#202020] border-[#2c2c2c] focus:border-[#00c5a1]/50 rounded-lg h-9 text-xs focus-visible:ring-0 focus-visible:ring-offset-0 text-zinc-200 text-center"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="newTotal" className="text-[#acacac] font-semibold text-xs">Chapitres Totaux</Label>
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
                </div>
              </div>
            </div>

            {/* Modal Action Footer (grey background exactly like the screenshot) */}
            <div className="bg-[#2f2f2f] px-6 py-4 flex justify-end items-center gap-3 border-t border-[#2c2c2c]">
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => setIsAddOpen(false)} 
                className="text-zinc-400 hover:text-white hover:bg-transparent font-semibold text-xs"
              >
                Annuler
              </Button>
              <Button 
                type="submit" 
                className="bg-[#00c5a1] hover:bg-[#00b090] text-zinc-950 font-bold px-5 h-9 rounded-lg text-xs"
              >
                Créer la page
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- PAGE PREVIEW MODAL (Notion-style single column properties) --- */}
      <Dialog open={selectedManhwa !== null} onOpenChange={(open) => !open && setSelectedManhwa(null)}>
        {selectedManhwa && (
          <DialogContent className="bg-[#191919] border-[#2c2c2c] text-zinc-100 rounded-2xl max-w-xl max-h-[90vh] overflow-y-auto p-0 flex flex-col shadow-2xl animate-scale-in">
            {/* Modal Top Bar */}
            <div className="flex justify-between items-center gap-4 px-6 pt-5 pb-3 animate-fade-in">
              <div className="flex items-center gap-1.5 text-[#808080] text-xs font-medium">
                <span className="text-sm">📄</span>
                <span>Bibliothèque</span>
                <ChevronRight className="h-3 w-3" />
                <span className="text-[#acacac] font-semibold truncate max-w-[200px]">{selectedManhwa.title}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {selectedManhwa.url && (
                  <a 
                    href={selectedManhwa.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 text-[#808080] hover:text-zinc-300 bg-[#202020] border border-[#2c2c2c] hover:border-[#373737] text-[10px] rounded-lg transition-all duration-200 hover:scale-[1.02]"
                  >
                    Ouvrir le lien
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    if (confirm("Supprimer ce Manhwa ?")) {
                      try {
                        const res = await api.manhwa[":id"].$delete({ param: { id: selectedManhwa.id } });
                        if (res.ok) {
                          setManhwas((prev) => prev.filter((item) => item.id !== selectedManhwa.id));
                          setSelectedManhwa(null);
                        }
                      } catch (err) {
                        console.error("Erreur de suppression", err);
                      }
                    }
                  }}
                  className="h-7 w-7 text-[#808080] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all duration-200"
                  title="Supprimer la fiche"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Editable Title */}
            <div className="px-6 pb-1 animate-fade-in-up" style={{ animationDelay: '50ms' }}>
              <input
                type="text"
                value={selectedManhwa.title}
                onChange={(e) => updateSelectedField("title", e.target.value)}
                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-[28px] font-bold tracking-tight text-white p-0 placeholder:text-[#505050]"
                placeholder="Sans titre"
              />
            </div>

            {/* Divider */}
            <div className="mx-6 border-b border-[#2c2c2c]" />

            {/* Single-column property list (Notion-style with icons) */}
            <div className="px-6 py-4 space-y-0 stagger-props">
              {/* Team/Site Scan */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Globe className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Team/Site Scan</span>
                </div>
                <input
                  type="text"
                  value={selectedManhwa.site || ""}
                  onChange={(e) => updateSelectedField("site", e.target.value)}
                  className="flex-1 bg-transparent border-none py-1 px-1.5 focus:bg-[#2c2c2c] rounded-md focus:outline-none text-[13px] text-[#ececec] placeholder:text-[#505050] transition-colors"
                  placeholder="Empty"
                />
              </div>

              {/* Auteur Originel */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <User className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Auteur Originel</span>
                </div>
                <input
                  type="text"
                  value={selectedManhwa.author || ""}
                  onChange={(e) => updateSelectedField("author", e.target.value)}
                  className="flex-1 bg-transparent border-none py-1 px-1.5 focus:bg-[#2c2c2c] rounded-md focus:outline-none text-[13px] text-[#ececec] placeholder:text-[#505050] transition-colors"
                  placeholder="Empty"
                />
              </div>

              {/* Lien */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Link2 className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Lien</span>
                </div>
                <input
                  type="text"
                  value={selectedManhwa.url || ""}
                  onChange={(e) => updateSelectedField("url", e.target.value)}
                  className="flex-1 bg-transparent border-none py-1 px-1.5 focus:bg-[#2c2c2c] rounded-md focus:outline-none text-[13px] text-teal-400 font-medium truncate placeholder:text-[#505050] transition-colors"
                  placeholder="Empty"
                />
              </div>

              {/* Note */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Star className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Note</span>
                </div>
                <div className="flex-1 py-1 px-1.5">
                  {renderStars(selectedManhwa.note, (star) => updateSelectedField("note", star))}
                </div>
              </div>

              {/* Chapitre Actuel */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Hash className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Chapitre actuel</span>
                </div>
                <div className="flex-1 flex items-center gap-1.5 py-1 px-1.5">
                  <input
                    type="number"
                    min="0"
                    value={selectedManhwa.currentChapterRead}
                    onChange={(e) => updateSelectedField("currentChapterRead", Number(e.target.value))}
                    className="w-14 bg-[#202020] border border-[#2c2c2c] py-0.5 px-1 rounded-md text-[13px] text-[#ececec] text-center focus:outline-none focus:border-[#373737] transition-colors"
                  />
                  <span className="text-[#505050] text-[13px]">/</span>
                  <span className="text-[#808080] text-[13px]">{selectedManhwa.latestChapterAvailable}</span>
                </div>
              </div>

              {/* Nombre total */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Hash className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Nombre total</span>
                </div>
                <div className="flex-1 py-1 px-1.5">
                  <input
                    type="number"
                    min="0"
                    value={selectedManhwa.latestChapterAvailable}
                    onChange={(e) => updateSelectedField("latestChapterAvailable", Number(e.target.value))}
                    className="w-14 bg-[#202020] border border-[#2c2c2c] py-0.5 px-1 rounded-md text-[13px] text-[#ececec] text-center focus:outline-none focus:border-[#373737] transition-colors"
                  />
                </div>
              </div>

              {/* Commencé le */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Calendar className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Commencé le</span>
                </div>
                <input
                  type="text"
                  value={selectedManhwa.startedAt || ""}
                  onChange={(e) => updateSelectedField("startedAt", e.target.value)}
                  className="flex-1 bg-transparent border-none py-1 px-1.5 focus:bg-[#2c2c2c] rounded-md focus:outline-none text-[13px] text-[#ececec] placeholder:text-[#505050] transition-colors"
                  placeholder="Empty"
                />
              </div>

              {/* Progression */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <BarChart3 className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Progression</span>
                </div>
                <div className="flex-1 flex items-center gap-3 py-1 px-1.5">
                  <span className="font-mono text-[13px] text-[#acacac] w-10">{getProgressPercent(selectedManhwa)}%</span>
                  <div className="flex-1 h-1.5 bg-[#2c2c2c] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500 rounded-full animate-progress-fill transition-all duration-500"
                      style={{ width: `${getProgressPercent(selectedManhwa)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* État */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Activity className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">État</span>
                </div>
                <div className="flex-1 py-1 px-1.5">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${
                    selectedManhwa.currentChapterRead >= selectedManhwa.latestChapterAvailable && selectedManhwa.latestChapterAvailable > 0
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" 
                      : "bg-sky-500/15 text-sky-400 border border-sky-500/20"
                  }`}>
                    {selectedManhwa.currentChapterRead >= selectedManhwa.latestChapterAvailable && selectedManhwa.latestChapterAvailable > 0 
                      ? "Terminé" 
                      : "En cours de lecture"}
                  </span>
                </div>
              </div>

              {/* Type */}
              <div className="group flex items-center min-h-[34px] px-1 -mx-1 rounded-md hover:bg-[#252525] transition-colors duration-150 cursor-default">
                <div className="flex items-center gap-2 w-[160px] shrink-0">
                  <Tag className="h-3.5 w-3.5 text-[#808080]" />
                  <span className="text-[13px] text-[#808080] font-medium">Type</span>
                </div>
                <div className="flex-1 py-1 px-1.5">
                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-[#2c2c2c] border border-[#373737] text-[#acacac] rounded-md">
                    {selectedManhwa.type}
                  </span>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="mx-6 border-b border-[#2c2c2c]" />

            {/* Description / Résumé */}
            <div className="px-6 pb-2 space-y-2.5 animate-fade-in" style={{ animationDelay: '300ms' }}>
              <div className="flex items-center gap-2 text-[#808080]">
                <Pen className="h-3.5 w-3.5" />
                <span className="text-[13px] font-semibold">Résumé</span>
              </div>
              <textarea
                value={selectedManhwa.summary || ""}
                onChange={(e) => updateSelectedField("summary", e.target.value)}
                className="w-full bg-transparent border-none p-0 focus:outline-none focus:ring-0 text-[#acacac] leading-relaxed text-[13px] h-28 resize-none placeholder:text-[#505050]"
                placeholder="Écrivez un résumé pour cette œuvre..."
              />
            </div>

            {/* Footer */}
            <div className="bg-[#202020] px-6 py-3.5 flex justify-end items-center border-t border-[#2c2c2c] rounded-b-2xl">
              <Button 
                onClick={() => setSelectedManhwa(null)}
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
