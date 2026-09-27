import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressEditor } from "./progress-editor";

type Put = (args: { param: { manhwaId: string }; json: { currentChapter?: number } }) => Promise<{ ok: boolean; status: number }>;
type ToastOptions = { action?: { label: string; onClick: () => void | Promise<void> } };

const mocks = vi.hoisted(() => ({
  router: { refresh: vi.fn() },
  put: vi.fn<Put>(),
  toast: { success: vi.fn<(message: string, options?: ToastOptions) => void>(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/app/lib/api", () => ({ api: { reading: { progress: { ":manhwaId": { $put: mocks.put } } } } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.put.mockResolvedValue({ ok: true, status: 200 });
});

const renderEditor = (currentChapter = 12) =>
  render(<ProgressEditor manhwaId="m-1" title="TBATE" currentChapter={currentChapter} totalChapters={200} />);

const field = () => screen.getByRole("textbox", { name: "Chapitre actuel" });
const validate = () => screen.getByRole("button", { name: "Valider" });

describe("ProgressEditor", () => {
  it("sends an absolute update with the typed chapter, French comma included", async () => {
    renderEditor();

    await userEvent.clear(field());
    await userEvent.type(field(), "120,5{Enter}");

    await waitFor(() => expect(mocks.router.refresh).toHaveBeenCalled());
    expect(mocks.put).toHaveBeenCalledWith({ param: { manhwaId: "m-1" }, json: { currentChapter: 120.5 } });
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "Progression enregistrée : chapitre 120,5.",
      expect.objectContaining({ action: expect.objectContaining({ label: "Annuler" }) }),
    );
  });

  it("offers an undo that restores the previous chapter", async () => {
    renderEditor(12);
    await userEvent.clear(field());
    await userEvent.type(field(), "120{Enter}");
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());

    const undo = mocks.toast.success.mock.calls[0]?.[1]?.action?.onClick;
    await act(async () => {
      await undo?.();
    });

    expect(mocks.put).toHaveBeenLastCalledWith({ param: { manhwaId: "m-1" }, json: { currentChapter: 12 } });
    expect(mocks.toast.info).toHaveBeenCalledWith("Modification annulée.");
  });

  it("refuses invalid input locally, without any request", async () => {
    renderEditor();

    await userEvent.clear(field());
    await userEvent.type(field(), "12abc{Enter}");

    expect(screen.getByRole("alert")).toHaveTextContent(/Numéro invalide/);
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("disables validation while the value is unchanged, and Escape restores it", async () => {
    renderEditor(12);
    expect(validate()).toBeDisabled();

    await userEvent.type(field(), "5");
    expect(field()).toHaveValue("125");
    expect(validate()).toBeEnabled();

    await userEvent.keyboard("{Escape}");
    expect(field()).toHaveValue("12");
    expect(validate()).toBeDisabled();
  });

  it("keeps what the user typed when the server refuses, and reverts the displayed progress", async () => {
    mocks.put.mockResolvedValue({ ok: false, status: 503 });
    renderEditor(12);

    await userEvent.clear(field());
    await userEvent.type(field(), "120{Enter}");

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Progression non enregistrée", expect.anything()));
    expect(field()).toHaveValue("120");
    // L'affichage optimiste (« 120 / 200 ») est annulé : on revient à la valeur confirmée.
    await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "12"));
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });

  it("follows a new server value, but never overwrites a draft in progress", async () => {
    const { rerender } = renderEditor(12);

    rerender(<ProgressEditor manhwaId="m-1" title="TBATE" currentChapter={13} totalChapters={200} />);
    expect(field()).toHaveValue("13");

    await userEvent.clear(field());
    await userEvent.type(field(), "40");
    rerender(<ProgressEditor manhwaId="m-1" title="TBATE" currentChapter={14} totalChapters={200} />);
    expect(field()).toHaveValue("40");
  });
});
