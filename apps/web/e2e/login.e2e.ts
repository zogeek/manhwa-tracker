import { expect, test } from "@playwright/test";

test.describe("page de connexion", () => {
  test("affiche le formulaire de connexion", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveTitle(/Connexion/);
    await expect(page.getByText("Accédez à votre bibliothèque de manhwas.")).toBeVisible();
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await expect(page.getByLabel("Mot de passe")).toBeVisible();
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeEnabled();
  });

  test("bascule vers la création de compte", async ({ page }) => {
    await page.goto("/login");

    await page.getByRole("button", { name: "Créer un compte" }).click();

    await expect(page.getByLabel("Pseudo")).toBeVisible();
    await expect(page.getByRole("button", { name: "Créer mon compte" })).toBeVisible();
  });

  test("redirige un visiteur sans session du tableau de bord vers /login", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
  });
});
