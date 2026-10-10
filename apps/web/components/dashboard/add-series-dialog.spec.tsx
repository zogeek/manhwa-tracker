import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddSeriesDialog } from "./add-series-dialog";

type FakeResponse<T> = { ok: boolean; status: number; json: () => Promise<{ data: T }> };
type ImportArgs = { json: { provider: string; externalId: string } };
type TrackArgs = { param: { manhwaId: string }; json: Record<string, never> };

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn() },
  importPost: vi.fn<(args: ImportArgs) => Promise<FakeResponse<{ id: string; title: string }>>>(),
  progressPut: vi.fn<(args: TrackArgs) => Promise<FakeResponse<{ manhwaId: string }>>>(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
// Client RPC remplacé : aucun appel réseau, on contrôle chaque réponse de l'API.
vi.mock("@/app/lib/api", () => ({
  api: {
    manhwas: { import: { $post: mocks.importPost } },
    reading: { progress: { ":manhwaId": { $put: mocks.progressPut } } },
  },
}));

const respond = <T,>(status: number, data: T): FakeResponse<T> => ({
  ok: status < 400,
  status,
  json: async () => ({ data }),
});

beforeEach(() => {
  vi.clearAllMocks();
});

const openAndSubmit = async (reference: string) => {
  const user = userEvent.setup();
  render(<AddSeriesDialog />);
  await user.click(screen.getByRole("button", { name: "Ajouter une série" }));
  await user.type(screen.getByLabelText("URL ou identifiant"), reference);
  await user.click(screen.getByRole("button", { name: "Ajouter" }));
};

describe("AddSeriesDialog", () => {
  it("imports the series, adds it to the library, confirms and closes", async () => {
    mocks.importPost.mockResolvedValue(respond(201, { id: "manhwa-1", title: "Solo Leveling" }));
    mocks.progressPut.mockResolvedValue(respond(200, { manhwaId: "manhwa-1" }));

    await openAndSubmit("https://anilist.co/manga/105398/Na-Honjaman-Level-Up");

    await waitFor(() => expect(mocks.router.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.importPost).toHaveBeenCalledWith({ json: { provider: "anilist", externalId: "105398" } });
    // Corps vide : ajout « À lire » sans jamais écraser une progression existante.
    expect(mocks.progressPut).toHaveBeenCalledWith({ param: { manhwaId: "manhwa-1" }, json: {} });
    expect(mocks.toast.success).toHaveBeenCalledWith("« Solo Leveling » est maintenant suivi.", expect.anything());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the parsing error inline without calling the API", async () => {
    await openAndSubmit("https://evil.example/manga/1");

    expect(screen.getByRole("alert")).toHaveTextContent("Site non reconnu");
    expect(screen.getByLabelText("URL ou identifiant")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.importPost).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and explains an API refusal with a toast", async () => {
    mocks.importPost.mockResolvedValue(respond(404, { id: "", title: "" }));

    await openAndSubmit("105398");

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Ajout impossible", {
        description: "Cette œuvre est introuvable chez le fournisseur.",
      }),
    );
    // La transition se termine juste après le toast : on attend que le bouton redevienne actif.
    expect(await screen.findByRole("button", { name: "Ajouter" })).toBeEnabled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.progressPut).not.toHaveBeenCalled();
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });

  it("handles a network failure gracefully", async () => {
    mocks.importPost.mockRejectedValue(new TypeError("Failed to fetch"));

    await openAndSubmit("105398");

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Ajout impossible", {
        description: "Serveur injoignable. Vérifiez votre connexion.",
      }),
    );
  });
});
