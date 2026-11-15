import { expect, test } from "@playwright/test";

const creatorRoutes = [
  { path: "/ascii-art", product: '[data-testid="ascii-art-output"]' },
  { path: "/aurora", product: '[data-testid="aurora-canvas"]' },
  { path: "/flow-field", product: '[data-testid="flow-field-canvas"]' },
  {
    path: "/grid-lines",
    product: 'canvas[aria-label="Grid Lines background preview"]',
  },
  { path: "/halftone", product: "[data-halftone-canvas]" },
] as const;

for (const creator of creatorRoutes) {
  test(`${creator.path} renders its Toolcraft creator`, async ({ page }) => {
    await page.goto(creator.path);

    await expect(page.locator('[data-slot="toolcraft-runtime-app"]')).toBeVisible();
    await expect(page.locator(creator.product)).toBeVisible();
  });
}

test("the root route lists every background creator", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Background creators" }),
  ).toBeVisible();

  for (const creator of creatorRoutes) {
    await expect(page.locator(`a[href="${creator.path}"]`)).toBeVisible();
  }

  await page.getByRole("link", { name: /Halftone/u }).click();

  await expect(page).toHaveURL(/\/halftone$/u);
  await expect(page.locator("[data-halftone-canvas]")).toBeVisible();
});
