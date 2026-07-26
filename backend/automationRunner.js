// backend/automationRunner.js
//
// Generic executor for automation plans using Playwright.
// It runs OPEN_URL / CLICK / FILL_FORM / WAIT / READ_PAGE steps for any web app.

const path = require("path");
const { chromium } = require("playwright");
const { appsConfig } = require("./appsConfig");

// Keep one persistent browser context per appId so login sessions are reused.
const appContexts = {}; // appId -> BrowserContext

async function createContext(appId) {
    const userDataDir = path.join(__dirname, `.pw-profile-${appId}`);

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false, // set to true if you want it completely in background
    });

    appContexts[appId] = context;
    return context;
}

async function getContextForApp(appId) {
    const existing = appContexts[appId];

    if (existing) {
        try {
            // Quick health check: try to list pages
            await existing.pages();
            return existing;
        } catch (err) {
            console.warn(
                `[Automation] Existing context for ${appId} seems dead, recreating...`,
                err.message
            );
            try {
                await existing.close();
            } catch (_) { }
            delete appContexts[appId];
        }
    }

    return createContext(appId);
}

// Get a fresh page, and if the context is dead, recreate once.
async function getPageForApp(appId) {
    let context = await getContextForApp(appId);

    try {
        return await context.newPage();
    } catch (err) {
        console.warn(
            `[Automation] context.newPage failed for ${appId}, recreating context...`,
            err.message
        );
        try {
            await context.close();
        } catch (_) { }
        delete appContexts[appId];

        context = await createContext(appId);
        return await context.newPage();
    }
}

// --- Helpers for form filling -------------------------------------------

// Normalize for fuzzy matching
function normalize(str) {
    return (str || "").toString().toLowerCase().replace(/\s+/g, "");
}

// Fill one logical field, using label / placeholder / name / id heuristics
async function fillSingleField(page, fieldSpec) {
    const value = fieldSpec.value ?? "";
    const labelOrName =
        fieldSpec.label ||
        fieldSpec.name ||
        fieldSpec.placeholder ||
        fieldSpec.hint ||
        "";

    if (!labelOrName && !fieldSpec.selector) {
        console.log(
            "[Automation] field has no label/name/selector, skipping",
            fieldSpec
        );
        return;
    }

    let locator = null;

    // 1) If planner gave an explicit selector, trust it first
    if (fieldSpec.selector) {
        locator = page.locator(fieldSpec.selector);
        if (await locator.count()) {
            console.log(
                "[Automation] using explicit selector for field",
                fieldSpec.selector
            );
        }
    }

    const norm = normalize(labelOrName);

    // 2) Try by accessible label
    if (!locator || !(await locator.count())) {
        locator = page.getByLabel(labelOrName, { exact: false });
    }

    // 3) Try by placeholder
    if (!(await locator.count())) {
        locator = page.getByPlaceholder(labelOrName, { exact: false });
    }

    // 4) Try name / id (contains match) on typical input elements
    if (!(await locator.count())) {
        locator = page.locator(
            [
                `input[name*="${norm}"]`,
                `textarea[name*="${norm}"]`,
                `select[name*="${norm}"]`,
                `input[id*="${norm}"]`,
                `textarea[id*="${norm}"]`,
                `select[id*="${norm}"]`,
            ].join(",")
        );
    }

    if (!(await locator.count())) {
        console.warn("[Automation] could not find element for field", fieldSpec);
        return;
    }

    locator = locator.first();
    const tagName = await locator.evaluate((el) => el.tagName.toLowerCase());
    const type = await locator.evaluate((el) =>
        (el.getAttribute("type") || "").toLowerCase()
    );

    console.log(
        `[Automation] filling field "${labelOrName}" as ${tagName}[type=${type}] with value "${value}"`
    );

    if (tagName === "select") {
        // Try option value/text matches
        await locator.selectOption({ label: value }).catch(async () => {
            await locator.selectOption({ value }).catch(async () => {
                // fall back: just set value via JS if nothing matches
                await locator.evaluate((el, v) => {
                    el.value = v;
                    el.dispatchEvent(new Event("change", { bubbles: true }));
                }, value);
            });
        });
    } else if (tagName === "input" && (type === "checkbox" || type === "radio")) {
        const normVal = normalize(value);
        const shouldCheck =
            normVal === "true" ||
            normVal === "yes" ||
            normVal === "1" ||
            normVal === "checked";

        await locator.setChecked(shouldCheck);
    } else {
        // Normal text-like field
        await locator.click({ force: true });
        await locator.fill(""); // clear first
        await locator.fill(value);

        // If it's a search field, press Enter to trigger the search
        if (labelOrName.toLowerCase().includes("search")) {
            console.log("[Automation] search field detected, pressing Enter");
            await locator.press("Enter");
            await page.waitForTimeout(3000); // Wait for results to load
        }
    }
}

// Fill all fields from one FILL_FORM step
async function fillFormFields(page, fields) {
    for (const field of fields || []) {
        try {
            await fillSingleField(page, field);
            // small pause between fields so dynamic UIs have time to react
            await page.waitForTimeout(150);
        } catch (err) {
            console.error("[Automation] error filling field", field, err);
        }
    }
}

// --- Main executor -------------------------------------------------------

// Run a single plan object:
// { type: "plan", appId: "frappe", steps: [ { action, ... }, ... ] }
async function runAutomationPlan(plan) {
    const appId = plan.appId;
    const appMeta = appsConfig[appId];

    if (!appMeta) {
        throw new Error(`Unknown app in plan: ${appId}`);
    }
    if (!Array.isArray(plan.steps)) {
        throw new Error("Plan has no steps");
    }

    const page = await getPageForApp(appId);

    try {
        for (const step of plan.steps) {
            const action = step.action;

            if (action === "OPEN_URL") {
                const url = step.url || appMeta.baseUrl;
                console.log("[Automation] OPEN_URL", url);
                await page.goto(url, { waitUntil: "domcontentloaded" });
                await page.waitForTimeout(2000); // extra safety after load
            } else if (action === "WAIT") {
                const ms = step.ms || 1000;
                console.log("[Automation] WAIT", ms);
                await page.waitForTimeout(ms);
            } else if (action === "CLICK") {
                const text = step?.target?.text;
                if (!text) continue;
                console.log("[Automation] CLICK", text);

                // Try button role
                let clicked = false;
                try {
                    await page
                        .getByRole("button", { name: text })
                        .first()
                        .click({ timeout: 2000 });
                    clicked = true;
                } catch (_) { }

                // Try link
                if (!clicked) {
                    try {
                        await page
                            .getByRole("link", { name: text })
                            .first()
                            .click({ timeout: 2000 });
                        clicked = true;
                    } catch (_) { }
                }

                // Try heading (common for card titles)
                if (!clicked) {
                    try {
                        await page
                            .getByRole("heading", { name: text })
                            .first()
                            .click({ timeout: 2000 });
                        clicked = true;
                    } catch (_) { }
                }

                // Try cell (common for table rows)
                if (!clicked) {
                    try {
                        await page
                            .getByRole("cell", { name: text })
                            .first()
                            .click({ timeout: 2000 });
                        clicked = true;
                    } catch (_) { }
                }

                // Fallback: any element containing that text
                if (!clicked) {
                    await page
                        .getByText(text, { exact: false })
                        .first()
                        .click({ timeout: 8000 });
                }

                await page.waitForTimeout(3000); // Increased wait for SPA navigation
            } else if (action === "FILL_FORM") {
                console.log("[Automation] FILL_FORM", step.fields);
                await fillFormFields(page, step.fields);
            } else if (action === "READ_PAGE") {
                console.log("[Automation] READ_PAGE");
                // Extract visible text
                const content = await page.evaluate(() => document.body.innerText);
                console.log("[Automation] Read content length:", content.length);

                // Close page and return content immediately
                await page.close();
                return { ok: true, pageContent: content };
            }
        }

        console.log("[Automation] plan complete for app:", appId);
        return { ok: true };
    } finally {
        if (!page.isClosed()) {
            await page.close();
        }
    }
}

module.exports = { runAutomationPlan };
