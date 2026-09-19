import { expect, test, type Download, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "/modules";
const LAYOUT_NAME = "Fabric export regression";
const FABRIC_URL = "https://fabric-fixture.example.test/fabric.jpg";
const FABRIC_JPEG = readFileSync(
  resolve(
    process.cwd(),
    "../api-server/src/dev-assets/fabric-compare-source.jpg",
  ),
);

const layout = {
  id: 71,
  name: LAYOUT_NAME,
  rows: 2,
  cols: 2,
  cells: [
    { blockId: 17, rotation: 0 },
    { blockId: 17, rotation: 90 },
    { blockId: 17, rotation: 180 },
    { blockId: 17, rotation: 270 },
  ],
  dominantColors: [],
  sashingWidthInches: 0.25,
  sashingColor: "fab:41",
  borderWidthInches: 0.5,
  borderColor: "fab:41",
  cornerstoneColor: "fab:41",
  categories: [],
  createdAt: "2026-09-07T12:00:00.000Z",
};

async function mockLayoutApis(page: Page) {
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/auth/me") {
      return route.fulfill({
        json: {
          id: 1,
          email: "browser-test@example.test",
          firstName: "Browser",
          lastName: "Test",
          timezone: "UTC",
        },
      });
    }
    if (pathname === "/api/quilting/layouts") {
      return route.fulfill({ json: [layout] });
    }
    if (pathname === "/api/quilting/blocks") {
      return route.fulfill({
        json: [
          {
            id: 17,
            name: "Fabric block",
            gridSize: 2,
            cells: ["fab:41", "#20c997", "#f59e0b", "fab:41"],
            seams: [],
            blockSizeInches: 12,
            dominantColors: ["#20c997", "#f59e0b"],
            categories: [],
            createdAt: "2026-09-07T12:00:00.000Z",
          },
        ],
      });
    }
    if (pathname === "/api/quilting/fabrics") {
      return route.fulfill({
        json: {
          items: [
            {
              id: 41,
              name: "High contrast fabric",
              quantity: 1,
              quantityUnit: "yards",
              dominantColors: ["#ff0000", "#0000ff"],
              motifs: [],
              styleDescriptors: [],
              lockedFields: [],
              categories: [],
              images: [],
              imageUrl: FABRIC_URL,
              tileImageUrl: FABRIC_URL,
              hasEmbedding: false,
              recognitionRefreshStatus: null,
              createdAt: "2026-09-07T12:00:00.000Z",
            },
          ],
          total: 1,
          page: 1,
          pageSize: 200,
        },
      });
    }
    if (pathname === "/api/quilting/categories") {
      return route.fulfill({ json: [] });
    }
    if (pathname === "/api/quilting/stats") {
      return route.fulfill({
        json: {
          totalFabrics: 1,
          totalPatterns: 0,
          totalQuilts: 0,
          totalBlocks: 1,
          totalLayouts: 1,
        },
      });
    }
    return route.fulfill({ status: 404, json: { message: "Not mocked" } });
  });
  await page.route(FABRIC_URL, (route) =>
    route.fulfill({
      body: FABRIC_JPEG,
      contentType: "image/jpeg",
      headers: { "access-control-allow-origin": "*" },
    }),
  );
}

async function openExportMenu(page: Page, format: "PNG" | "JPEG") {
  const card = page
    .getByText(LAYOUT_NAME, { exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'group')][1]");
  await card.hover();
  await card.getByRole("button", { name: "Options" }).click();
  await page.getByRole("menuitem", { name: "Export" }).hover();
  await page.getByRole("menuitem", { name: format, exact: true }).click();
}

async function assertFabricPixels(page: Page, download: Download) {
  const bytes = await download.createReadStream().then(async (stream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  });
  expect(bytes.length).toBeGreaterThan(1_000);

  const pixels = await page.evaluate(
    async (raw) => {
      const blob = new Blob([new Uint8Array(raw)]);
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas context unavailable");
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let colorful = 0;
      let greyPlaceholder = 0;
      let sampled = 0;
      for (let offset = 0; offset < data.length; offset += 4 * 97) {
        sampled++;
        const [red, green, blue, alpha] = data.slice(offset, offset + 4);
        if (
          alpha > 0 &&
          Math.max(red, green, blue) - Math.min(red, green, blue) > 45
        )
          colorful++;
        if (
          alpha > 0 &&
          Math.abs(red - 209) < 12 &&
          Math.abs(green - 213) < 12 &&
          Math.abs(blue - 219) < 12
        )
          greyPlaceholder++;
      }
      return {
        width: bitmap.width,
        height: bitmap.height,
        colorful,
        greyPlaceholder,
        sampled,
      };
    },
    [...bytes],
  );

  expect(pixels.width).toBeGreaterThan(100);
  expect(pixels.height).toBeGreaterThan(100);
  expect(pixels.colorful).toBeGreaterThan(50);
  // A real fabric photo may contain isolated pixels close to the placeholder
  // grey. Reject a substantial placeholder-coloured area instead of requiring
  // a photograph to contain none of that colour at all.
  expect(pixels.greyPlaceholder / pixels.sampled).toBeLessThan(0.01);
}

test.beforeEach(async ({ page }) => {
  await mockLayoutApis(page);
  await page.goto(`${BASE}/quilting/layouts`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText(LAYOUT_NAME, { exact: true })).toBeVisible();
});

for (const format of ["PNG", "JPEG"] as const) {
  test(`quilting layout ${format} export decodes with fabric pixels`, async ({
    page,
  }) => {
    const downloadPromise = page.waitForEvent("download");
    await openExportMenu(page, format);
    await assertFabricPixels(page, await downloadPromise);
    await expect(page.getByText(`Exported as ${format}.`)).toBeVisible();
  });
}

test("quilting layout export failure stays visible and does not download", async ({
  page,
}) => {
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      callback(null);
    };
  });
  let downloaded = false;
  page.once("download", () => {
    downloaded = true;
  });

  await openExportMenu(page, "PNG");

  await expect(
    page.getByText(
      "Couldn’t create the download. Try again. If it still fails, download as SVG instead.",
    ),
  ).toBeVisible();
  expect(downloaded).toBe(false);
});

test("quilting layout export identifies a failed fabric photo and does not download", async ({
  page,
}) => {
  await page.route(FABRIC_URL, (route) => route.abort("failed"));
  let downloaded = false;
  page.once("download", () => {
    downloaded = true;
  });

  await openExportMenu(page, "PNG");

  await expect(
    page.getByText(
      "Couldn’t load the photo for “High contrast fabric” (fabric #41). Try the download again. If it still fails, open that fabric and replace its photo.",
    ),
  ).toBeVisible();
  expect(downloaded).toBe(false);
});
