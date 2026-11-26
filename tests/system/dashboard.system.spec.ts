import {expect, test} from "@playwright/test";
import {signIn} from "../support/auth";

test.describe("dashboard system flows", () => {
    test.describe.configure({mode: "serial"});

    test("navigates between dashboard views and logs out", async ({page}) => {
        await signIn(page);

        const dashboardNav = page.getByRole("navigation", {name: "Dashboard views"});
        await expect(dashboardNav.getByRole("button", {name: "Entry view"})).toHaveClass(/current/);
        await dashboardNav.getByRole("button", {name: "Kanban View"}).click();
        await expect(page.locator("section.kanban-view.active")).toBeVisible();

        await dashboardNav.getByRole("button", {name: "Entry view"}).click();
        await expect(page.getByRole("region", {name: "Record list"})).toBeVisible();

        await page.getByRole("button", {name: "Logout"}).click();
        await expect(page.getByRole("button", {name: "Sign in"})).toBeVisible();
    });

    test("shows populated dashboard controls and enables CSV export", async ({page}) => {
        await signIn(page);

        await expect(page.locator("table tbody tr").filter({hasText: "IND-001"})).toBeVisible();
        await expect(page.getByRole("button", {name: "Export CSV"})).toBeEnabled();
        await expect(page.getByRole("button", {name: "All"})).toBeVisible();
        await expect(page.getByPlaceholder(/Search index no\./)).toBeVisible();
    });

    test("reviews a populated sample, filters it, opens details, and exports CSV", async ({page}) => {
        await signIn(page);

        const sampleId = "2026WS-IND-001-S01";
        const entryRow = page.locator("table tbody tr").filter({hasText: "IND-001"});
        await expect(entryRow).toBeVisible();
        await expect(entryRow).toContainText("2026WS");
        await expect(entryRow).toContainText("IND-001");
        // Sample 1 counts photo -01: 12.40 g / 30 g = 41.3%.
        await expect(entryRow).toContainText("41.3% · 12.40 g");

        await page.getByPlaceholder(/Search index no\./).fill("IND-001");
        await expect(entryRow).toBeVisible();
        await page.getByRole("button", {name: "All", exact: true}).click();
        await expect(entryRow).toBeVisible();

        await entryRow.click();
        const detail = page.getByRole("dialog", {name: "Entry detail"});
        await expect(detail).toBeVisible();
        await expect(detail).toContainText(sampleId);
        const sample1 = detail.locator(".sample-col").filter({hasText: "Sample 1 of 2"});
        await expect(sample1.getByRole("button")).toHaveCount(2);
        await expect(sample1.getByRole("button", {name: /-01/})).toContainText("Counts");
        await expect(sample1.getByRole("button", {name: /-02/})).toContainText("Older · not counted");
        await expect(sample1).toContainText("12.25 g");
        await expect(detail).toContainText("AI prediction (1)");
        await expect(detail).toContainText("Reviewer correction (1)");
        await expect(detail).toContainText("2026WS-IND-001-S01-01");
        await expect(detail.getByRole("button", {name: /Override/})).toHaveCount(0);

        const download = page.waitForEvent("download");
        await page.getByRole("button", {name: "Close entry detail"}).click();
        await page.getByRole("button", {name: "Export CSV"}).click();
        const exportedFile = await download;
        expect(exportedFile.suggestedFilename()).toMatch(/^granular-records-\d{8}\.csv$/);
    });

    test("searches an entry by index number, opens Entry detail with both samples, and exports CSV", async ({page}) => {
        const exportRequests: string[] = [];
        page.on("request", (request) => {
            if (request.url().includes("/api/replicates/export")) exportRequests.push(request.url());
        });
        await signIn(page);

        await page.getByPlaceholder(/Search index no\./).fill("IND-001");
        const entryRow = page.locator("table tbody tr").filter({hasText: "IND-001"});
        await expect(entryRow).toHaveCount(1);
        await entryRow.click();

        const detail = page.getByRole("dialog", {name: "Entry detail"});
        await expect(detail).toBeVisible();
        await expect(detail).toContainText("Sample 1 of 2");
        await expect(detail).toContainText("Sample 2 of 2");
        await expect(detail).toContainText("These results are calculated by the dashboard.");
        await expect(detail.locator(".tag-counts").first()).toHaveText("Counts");
        await page.getByRole("button", {name: "Close entry detail"}).click();

        const download = page.waitForEvent("download");
        await page.getByRole("button", {name: "Export CSV"}).click();
        const exportedFile = await download;
        expect(exportedFile.suggestedFilename()).toMatch(/^granular-records-\d{8}\.csv$/);
        expect(exportRequests).toEqual([]);
    });
});
