import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkReadButton } from "./mark-read-button";

const mocks = vi.hoisted(() => ({
  router: { refresh: vi.fn() },
  readsPost: vi.fn<(args: { json: { chapterId: string } }) => Promise<{ ok: boolean; status: number }>>(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/app/lib/api", () => ({ api: { reading: { reads: { $post: mocks.readsPost } } } }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MarkReadButton", () => {
  it("logs the read and refreshes the page so the progress and the list update", async () => {
    mocks.readsPost.mockResolvedValue({ ok: true, status: 201 });
    render(<MarkReadButton chapterId="chapter-1" number={10.5} />);

    await userEvent.click(screen.getByRole("button", { name: "Marquer le chapitre 10,5 comme lu" }));

    await waitFor(() => expect(mocks.router.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.readsPost).toHaveBeenCalledWith({ json: { chapterId: "chapter-1" } });
    expect(mocks.toast.success).toHaveBeenCalledWith("Chapitre 10,5 marqué comme lu.");
  });

  it("explains an expired session instead of failing silently", async () => {
    mocks.readsPost.mockResolvedValue({ ok: false, status: 401 });
    render(<MarkReadButton chapterId="chapter-1" number={3} />);

    await userEvent.click(screen.getByRole("button", { name: /chapitre 3/ }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Lecture non enregistrée", {
        description: "Votre session a expiré, reconnectez-vous.",
      }),
    );
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });
});
