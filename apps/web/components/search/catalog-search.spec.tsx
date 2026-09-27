import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogSearch } from "./catalog-search";

const navigation = vi.hoisted(() => {
  const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
  const state = { searchParams: new URLSearchParams() };
  return { router, state };
});

vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  usePathname: () => "/catalog",
  useSearchParams: () => navigation.state.searchParams,
}));

beforeEach(() => {
  // `shouldAdvanceTime` : le temps simulé avance aussi seul, sinon user-event attend indéfiniment.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  navigation.state.searchParams = new URLSearchParams();
  navigation.router.replace.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

const setup = () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<CatalogSearch />);
  return { user, input: screen.getByRole("searchbox", { name: "Rechercher une série" }) };
};

describe("CatalogSearch", () => {
  it("writes the query in the URL once the user pauses typing (debounce)", async () => {
    const { user, input } = setup();

    await user.type(input, "solo lev");
    expect(navigation.router.replace).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(350));
    expect(navigation.router.replace).toHaveBeenCalledTimes(1);
    expect(navigation.router.replace).toHaveBeenCalledWith("/catalog?q=solo+lev", { scroll: false });
  });

  it("waits for 2 characters (API rule) and says so", async () => {
    const { user, input } = setup();

    await user.type(input, "s");
    await act(() => vi.advanceTimersByTimeAsync(1_000));

    expect(navigation.router.replace).not.toHaveBeenCalled();
    expect(screen.getByText(/Encore 1 caractère/)).toBeInTheDocument();
  });

  it("searches immediately on Enter", async () => {
    const { user, input } = setup();

    await user.type(input, "tbate{Enter}");

    expect(navigation.router.replace).toHaveBeenCalledWith("/catalog?q=tbate", { scroll: false });
  });

  it("toggles the online catalogues and clears the search", async () => {
    navigation.state.searchParams = new URLSearchParams({ q: "tbate" });
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: /Chercher aussi en ligne/ }));
    expect(navigation.router.replace).toHaveBeenLastCalledWith("/catalog?q=tbate&external=true", { scroll: false });

    await user.click(screen.getByRole("button", { name: "Effacer la recherche" }));
    expect(navigation.router.replace).toHaveBeenLastCalledWith("/catalog", { scroll: false });
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
});
