import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportButton } from "./import-button";

type FakeResponse = { ok: boolean; status: number; json: () => Promise<{ data: { id: string; title: string } }> };

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn() },
  importPost: vi.fn<(args: { json: { provider: string; externalId: string } }) => Promise<FakeResponse>>(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
// Le client RPC est remplacé : aucun appel réseau, on contrôle la réponse de l'API.
vi.mock("@/app/lib/api", () => ({ api: { manhwas: { import: { $post: mocks.importPost } } } }));

const imported = (status: number): FakeResponse => ({
  ok: true,
  status,
  json: async () => ({ data: { id: "manhwa-1", title: "The Beginning After the End" } }),
});

beforeEach(() => {
  vi.clearAllMocks();
});

const clickImport = async () => {
  render(<ImportButton provider="mangadex" externalId="a1c7c817" title="TBATE" />);
  await userEvent.click(screen.getByRole("button", { name: "Importer" }));
};

describe("ImportButton", () => {
  it("imports the work, confirms with a toast and refreshes the server-rendered results", async () => {
    let resolve: (res: FakeResponse) => void = () => undefined;
    mocks.importPost.mockReturnValue(new Promise((done) => (resolve = done)));

    await clickImport();

    // Pendant l'appel : bouton désactivé, libellé explicite.
    expect(screen.getByRole("button", { name: /Import en cours/ })).toBeDisabled();
    expect(mocks.importPost).toHaveBeenCalledWith({ json: { provider: "mangadex", externalId: "a1c7c817" } });

    resolve(imported(201));
    await waitFor(() => expect(mocks.router.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "« The Beginning After the End » a été ajouté au catalogue.",
      expect.objectContaining({ action: expect.objectContaining({ label: "Voir la fiche" }) }),
    );
  });

  it("tells the user when the work was already in the catalogue (200)", async () => {
    mocks.importPost.mockResolvedValue(imported(200));

    await clickImport();

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("« The Beginning After the End » était déjà au catalogue.", expect.anything()),
    );
  });

  it("shows a readable error and does not refresh when the API refuses", async () => {
    mocks.importPost.mockResolvedValue({ ok: false, status: 409, json: async () => ({ data: { id: "", title: "" } }) });

    await clickImport();

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Import de « TBATE » impossible", {
        description: "Cette œuvre a été retirée du catalogue par un administrateur.",
      }),
    );
    expect(mocks.router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Importer" })).toBeEnabled();
  });

  it("handles a network failure gracefully", async () => {
    mocks.importPost.mockRejectedValue(new TypeError("Failed to fetch"));

    await clickImport();

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Import de « TBATE » impossible", {
        description: "Serveur injoignable. Vérifiez votre connexion.",
      }),
    );
  });
});
