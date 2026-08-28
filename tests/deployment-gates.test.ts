import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Command } from "../apps/geolibre-desktop/src/lib/commands";
import {
  commandCapability,
  filterCommandsByCapabilities,
  projectMenuItemCapability,
} from "../apps/geolibre-desktop/src/lib/deployment-gates";
import {
  ALL_DEPLOYMENT_CAPABILITIES,
  type DeploymentCapability,
} from "../packages/core/src/deployment-capabilities";

function command(id: string): Command {
  return { id, title: id, group: "Group", run: () => {} };
}

describe("commandCapability", () => {
  it("maps each command family to the capability it needs", () => {
    assert.equal(commandCapability("add.vector"), "data:add");
    assert.equal(commandCapability("proc.whitebox"), "processing:run");
    assert.equal(commandCapability("proc.conversion.pmtiles"), "processing:run");
    assert.equal(commandCapability("project.save"), "project:edit");
    assert.equal(commandCapability("project.open-url"), "project:edit");
    assert.equal(commandCapability("settings.style-manager"), "settings:manage");
  });

  it("treats the print layout as an export, not project authoring", () => {
    assert.equal(commandCapability("project.print-layout"), "export:data");
  });

  it("treats a review comment as project authoring, not adding data", () => {
    assert.equal(commandCapability("add.comment"), "project:edit");
  });

  it("leaves camera, decoration, and help commands unprivileged", () => {
    assert.equal(commandCapability("view.zoom-in"), undefined);
    assert.equal(commandCapability("control.legend"), undefined);
    assert.equal(commandCapability("help.about"), undefined);
  });
});

describe("filterCommandsByCapabilities", () => {
  const registry = [
    "project.save",
    "add.vector",
    "proc.whitebox",
    "settings.style-manager",
    "view.zoom-in",
  ].map(command);

  it("keeps every command when the deployment grants everything", () => {
    assert.deepEqual(
      filterCommandsByCapabilities(registry, ALL_DEPLOYMENT_CAPABILITIES).map((c) => c.id),
      registry.map((c) => c.id),
    );
  });

  it("drops the commands whose capability was withheld", () => {
    assert.deepEqual(
      filterCommandsByCapabilities(registry, new Set<DeploymentCapability>()).map((c) => c.id),
      ["view.zoom-in"],
    );
  });

  it("keeps a granted family while dropping a denied one", () => {
    assert.deepEqual(
      filterCommandsByCapabilities(registry, new Set<DeploymentCapability>(["data:add"])).map(
        (c) => c.id,
      ),
      ["add.vector", "view.zoom-in"],
    );
  });
});

describe("projectMenuItemCapability", () => {
  it("gates the authoring items on project:edit", () => {
    for (const id of [
      "project.new",
      "project.openFrom",
      "project.openRecent",
      "project.import",
      "project.history",
      "project.save",
      "project.saveAs",
      "project.duplicate",
      "project.saveAsTemplate",
      "project.collaborate",
      "project.storymap",
    ]) {
      assert.equal(projectMenuItemCapability(id), "project:edit", id);
    }
  });

  it("gates the items that get data back out on export:data", () => {
    for (const id of [
      "project.share",
      "project.exportHtml",
      "project.print",
      "project.printLayout",
      "project.offlineRegion",
    ]) {
      assert.equal(projectMenuItemCapability(id), "export:data", id);
    }
  });

  it("returns undefined for an id it does not gate", () => {
    assert.equal(projectMenuItemCapability("project.unknown"), undefined);
  });
});
