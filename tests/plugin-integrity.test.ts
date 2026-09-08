import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  computePluginBundleHash,
  getPluginBundlePin,
  listPinnedPluginUrls,
  removePluginBundlePin,
  verifyPluginBundleIntegrity,
} from "../apps/geolibre-desktop/src/lib/plugin-integrity";
import { unloadRemovedUrlPlugins } from "../apps/geolibre-desktop/src/lib/external-plugins";
import { PluginManager } from "../packages/plugins/src/plugin-manager";

// plugin-integrity reads/writes the bare `localStorage` global (=== window's in
// the browser). Emulate just enough for Node's test runner.
function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

describe("plugin bundle integrity pinning", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("hashes deterministically and distinguishes entry/style", async () => {
    const a = await computePluginBundleHash({
      entrySource: "export const plugin = {}",
      styleSource: ".x{}",
    });
    const same = await computePluginBundleHash({
      entrySource: "export const plugin = {}",
      styleSource: ".x{}",
    });
    const differentEntry = await computePluginBundleHash({
      entrySource: "export const plugin = { evil: true }",
      styleSource: ".x{}",
    });
    const differentStyle = await computePluginBundleHash({
      entrySource: "export const plugin = {}",
      styleSource: ".y{}",
    });
    assert.equal(a, same);
    assert.notEqual(a, differentEntry);
    assert.notEqual(a, differentStyle);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it("pins on first use, passes when unchanged, blocks when changed", async () => {
    const url = "https://plugins.example.com/foo/plugin.json";
    const bundle = { entrySource: "v1", styleSource: null };

    const first = await verifyPluginBundleIntegrity(url, bundle);
    assert.equal(first.status, "pinned-first-use");
    assert.equal(getPluginBundlePin(url), await computePluginBundleHash(bundle));

    const second = await verifyPluginBundleIntegrity(url, bundle);
    assert.equal(second.status, "unchanged");

    // A silently-changed bundle is blocked and NOT re-pinned.
    const tampered = { entrySource: "v2-evil", styleSource: null };
    const changed = await verifyPluginBundleIntegrity(url, tampered);
    assert.equal(changed.status, "changed");
    assert.equal(getPluginBundlePin(url), await computePluginBundleHash(bundle));

    // Removing the pin resets to first-use trust.
    removePluginBundlePin(url);
    assert.equal(getPluginBundlePin(url), null);
    const afterRemoval = await verifyPluginBundleIntegrity(url, tampered);
    assert.equal(afterRemoval.status, "pinned-first-use");
  });

  it("lists all pinned plugin manifest URLs", async () => {
    const urlA = "https://plugins.example.com/a/plugin.json";
    const urlB = "https://plugins.example.com/b/plugin.json";
    assert.deepEqual(listPinnedPluginUrls(), []);

    await verifyPluginBundleIntegrity(urlA, { entrySource: "a", styleSource: null });
    assert.deepEqual(listPinnedPluginUrls(), [urlA]);

    await verifyPluginBundleIntegrity(urlB, { entrySource: "b", styleSource: null });
    assert.deepEqual(listPinnedPluginUrls().sort(), [urlA, urlB].sort());

    removePluginBundlePin(urlA);
    assert.deepEqual(listPinnedPluginUrls(), [urlB]);
  });

  it("unloadRemovedUrlPlugins drops pins for URLs that failed initial load and never registered (#2318)", async () => {
    const failedUrl = "https://plugins.example.com/failed/plugin.json";
    const keptUrl = "https://plugins.example.com/kept/plugin.json";
    await verifyPluginBundleIntegrity(failedUrl, { entrySource: "v1", styleSource: null });
    await verifyPluginBundleIntegrity(keptUrl, { entrySource: "v1", styleSource: null });

    const manager = new PluginManager();
    // When the user uninstalls failedUrl (leaving only keptUrl in settings)
    unloadRemovedUrlPlugins(manager, [keptUrl]);

    // The stale pin for failedUrl must be cleared even though it never successfully registered
    assert.equal(getPluginBundlePin(failedUrl), null);
    assert.notEqual(getPluginBundlePin(keptUrl), null);
  });
});
