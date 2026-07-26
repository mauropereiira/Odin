import { expect, test } from "@playwright/test";

test("synthetic demo pages load without browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const pages: Array<[string, string | RegExp]> = [
    ["/", /Good morning|Good afternoon|Good evening|Late night/],
    ["/converse", "Converse"],
    ["/fleet", "Fleet"],
    ["/brain", "Brain"],
    ["/skills", "Skills"],
    ["/usage", "Claude Code Usage & Plan"],
    ["/sessions", "Claude Code Sessions"],
    ["/mcp", "MCP servers"],
    ["/projects", "Projects"],
  ];

  for (const [path, heading] of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText("Demo · read only")).toBeVisible();
  }
  expect((await page.request.head("/brain")).status()).toBe(200);
  const apiLikeRoute = await page.request.get("/apiary");
  expect(apiLikeRoute.status()).toBe(200);
  expect(apiLikeRoute.headers()["x-odin-mode"]).toBeUndefined();
  expect(errors).toEqual([]);
});

test("demo mode disables live mutations", async ({ page }) => {
  await page.goto("/brain");
  await expect(page.getByRole("button", { name: "Capture" })).toBeDisabled();

  await page.goto("/converse");
  await expect(page.getByPlaceholder("Demo mode is read-only")).toBeDisabled();
  const historyToggle = page.getByRole("button", { name: /History 2/ });
  if (await historyToggle.isVisible()) await historyToggle.click();
  await expect(page.getByRole("button", { name: /Permanently delete/ }).first()).toBeDisabled();

  await page.goto("/fleet");
  await expect(page.getByRole("button", { name: /Dispatch agent/i })).toBeDisabled();

  await page.goto("/skills");
  const skillMutation = page.getByTitle("Demo mode is read-only").first();
  await expect(skillMutation).toBeDisabled();
});

test("expanded memory graph supports filters, zoom, keyboard navigation, and focus return", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/brain");
  const expand = page.getByRole("button", { name: "Expand memory graph" });
  await expand.click();

  const dialog = page.getByRole("dialog", { name: "Memory constellation" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("100%", { exact: true })).toBeVisible();

  const graph = dialog.getByRole("group", { name: "Memory graph" });
  await graph.hover();
  await page.mouse.wheel(0, -100);
  await expect(dialog.getByText("115%", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Reset view" }).click();

  await dialog.getByRole("button", { name: "Zoom in" }).click();
  await expect(dialog.getByText("125%", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Reset view" }).click();
  await expect(dialog.getByText("100%", { exact: true })).toBeVisible();

  const projectFilter = dialog.getByRole("button", { name: /project 2/i });
  await expect(projectFilter).toHaveAttribute("aria-pressed", "true");
  await projectFilter.click();
  await expect(projectFilter).toHaveAttribute("aria-pressed", "false");

  const nodes = dialog.getByRole("button", { name: /Open memory/ });
  await nodes.first().focus();
  const firstName = await nodes.first().getAttribute("aria-label");
  await page.keyboard.press("ArrowRight");
  await expect(nodes.nth(1)).toBeFocused();
  expect(await nodes.nth(1).getAttribute("aria-label")).not.toBe(firstName);

  await dialog.getByRole("button", { name: "Zoom in" }).click();
  const camera = graph.locator(":scope > g");
  const beforePan = await camera.getAttribute("transform");
  const box = await graph.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.58, { steps: 30 });
    await page.mouse.up();
  }
  await expect(camera).not.toHaveAttribute("transform", beforePan ?? "");
  await page.waitForTimeout(50);
  await nodes.first().click();
  await expect(dialog).toBeHidden();

  await expand.click();
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(expand).toBeFocused();
  expect(errors).toEqual([]);
});
