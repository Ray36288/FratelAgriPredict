import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "broiler-workbook-engine.js"), "utf8");
const window = {};
const document = { readyState: "complete", querySelector: () => null, addEventListener: () => {}, };
vm.runInNewContext(source, { window, document, console, Date, Math, Number, Object, Array, String, Map, Set });
const math = window.FratelBroilerWorkbookMath;

test("source workbook benchmarks match all seven weekly feed and cost totals", () => {
  const result = math.benchmark();
  assert.equal(result.passed, result.total, JSON.stringify(result.checks.filter(x => !x.pass)));
});

test("different bird counts scale weekly intake and cost proportionally", () => {
  const model = math.createSourceModel();
  const result = math.calculateWorkbook(model, 100);
  assert.ok(Math.abs(result.weeks[0].totalFeedKg - 7) < 1e-10);
  assert.ok(Math.abs(result.weeks[0].totalFeedCost - 8680) < 0.01);
});

test("an ingredient price change recalculates the relevant formulation", () => {
  const model = math.createSourceModel();
  const result = math.calculatePriceScenario(model, "source_row_15", 3500);
  const starter = result.stageImpacts.find(x => x.stageId === "rearing_0_4");
  assert.ok(Math.abs(starter.deltaPerKg - 48) < 1e-9);
});

test("blank pre-lay cells remain unavailable rather than being invented", () => {
  const model = math.createSourceModel();
  const result = math.calculateFormula(model, "prelay_17_20");
  assert.equal(result.complete, false);
  assert.equal(result.totalWeightKg, 0);
});

test("mortality and sales on their recorded dates reduce later daily feed demand", () => {
  const model = math.createSourceModel();
  const batch = {
    initialBirds: 100,
    placementDate: "2026-01-01",
    records: [
      { type: "mortality", date: "2026-01-03", quantity: 10 },
      { type: "sale", date: "2026-01-05", quantity: 5 }
    ]
  };
  const result = math.calculateWorkbook(model, 100, batch);
  assert.equal(result.weeks[0].birdsAtStart, 100);
  assert.equal(result.weeks[0].birdsAtEnd, 85);
  assert.ok(Math.abs(result.weeks[0].totalFeedKg - 6.35) < 1e-10);
});

test("laying percentage calculates daily and weekly egg quantities", () => {
  const model = math.createSourceModel();
  model.layingPercentages = [80,0,0,0,0,0,0];
  const result = math.calculateWorkbook(model, 5000);
  assert.equal(result.weeks[0].dailyEggs, 4000);
  assert.equal(result.weeks[0].weeklyEggs, 28000);
});

test("selling floor is marked incomplete when chick and other costs are missing", () => {
  const model = math.createSourceModel();
  const result = math.calculateSellingFloor(model, 1, null, null);
  assert.equal(result.complete, false);
  assert.equal(result.knownCostOnly, true);
});
