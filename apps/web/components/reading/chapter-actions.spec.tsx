import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChapterActions } from "./chapter-actions";

const mocks = vi.hoisted(() => ({
  router: { refresh: vi.fn() },
  put: vi.fn<(args: { param: { manhwaId: string }; json: { currentChapter?: number } }) => Promise<{ ok: boolean; status: number }>>(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/app/lib/api", () => ({ api: { reading: { progress: { ":manhwaId": { $put: mocks.put } } } } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.put.mockResolvedValue({ ok: true, status: 200 });
});

const openMenu = async (number: number, currentChapter: number) => {
  render(<ChapterActions manhwaId="m-1" number={number} currentChapter={currentChapter} />);
  await userEvent.click(screen.getByRole("button", { name: `Actions pour le chapitre ${String(number).replace(".", ",")}` }));
};

describe("ChapterActions", () => {
  it("catches up to a later chapter with a single absolute update", async () => {
    await openMenu(120, 3);

    await userEvent.click(screen.getByRole("menuitem", { name: "Marquer comme lu jusqu'ici" }));

    await waitFor(() => expect(mocks.router.refresh).toHaveBeenCalled());
    expect(mocks.put).toHaveBeenCalledWith({ param: { manhwaId: "m-1" }, json: { currentChapter: 120 } });
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "Progression : lu jusqu'au chapitre 120.",
      expect.objectContaining({ action: expect.objectContaining({ label: "Annuler" }) }),
    );
  });

  it("goes back to an earlier chapter", async () => {
    await openMenu(10.5, 50);

    await userEvent.click(screen.getByRole("menuitem", { name: /Reprendre ici/ }));

    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith({ param: { manhwaId: "m-1" }, json: { currentChapter: 10.5 } }),
    );
  });

  it("has nothing to do on the current chapter", async () => {
    await openMenu(7, 7);

    expect(screen.getByRole("menuitem", { name: "Vous en êtes ici" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("menuitem", { name: /jusqu'ici/ })).not.toBeInTheDocument();
  });
});
