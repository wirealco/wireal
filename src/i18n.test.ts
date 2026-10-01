import assert from "node:assert/strict";
import test from "node:test";

const stored = new Map<string, string>([["wireal.language", "tr"]]);
const root = { lang: "", dir: "" };

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  },
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: { documentElement: root },
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { language: "tr-TR" },
});

test("English is the only app language regardless of browser and stored preferences", async () => {
  const {
    currentLanguage,
    default: i18n,
    supportedLanguages,
  } = await import("./i18n");

  assert.deepEqual(supportedLanguages, ["en"]);
  assert.equal(currentLanguage(), "en");
  assert.equal(root.lang, "en");
  assert.equal(stored.get("wireal.language"), "en");

  await i18n.changeLanguage("tr");
  assert.equal(currentLanguage(), "en");
  assert.equal(root.lang, "en");
});
