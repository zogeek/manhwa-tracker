import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/** Crée un compte neuf via le formulaire : chaque test a sa propre bibliothèque, vide. */
async function signUp(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Créer un compte" }).click();
  await page.getByLabel("Pseudo").fill("Lecteur E2E");
  await page.getByLabel("E-mail").fill(`e2e-${randomUUID()}@test.local`);
  await page.getByLabel("Mot de passe").fill("motdepasse-e2e-solide");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe("tableau de bord", () => {
  test("accueille un nouveau lecteur avec un suivi vide", async ({ page }) => {
    await signUp(page);

    await expect(page.getByRole("heading", { name: /Bonjour Lecteur E2E/ })).toBeVisible();
    await expect(page.getByText("Vous ne suivez encore aucune série")).toBeVisible();
    await expect(page.getByRole("link", { name: "Explorer le catalogue" })).toBeVisible();
  });

  test("valide la référence saisie dans la modale « Ajouter une série »", async ({ page }) => {
    await signUp(page);

    await page.getByRole("button", { name: "Ajouter une série" }).click();
    const dialog = page.getByRole("dialog", { name: "Ajouter une série" });
    await expect(dialog).toBeVisible();

    // Refusé côté client, avant tout appel au catalogue externe.
    await dialog.getByLabel("URL ou identifiant").fill("https://example.com/manga/42");
    await dialog.getByRole("button", { name: "Ajouter" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/Site non reconnu/);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
