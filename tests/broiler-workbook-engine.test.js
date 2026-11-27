const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../broiler-workbook-engine.js");
const close = (a,b,t=0.01) => assert.ok(Math.abs(a-b)<=t, a+" != "+b);

test("retains all 17 Excel ingredient rows including duplicates, zero and tiny values",()=>{
 const m=E.createDefaultModel();
 assert.equal(m.ingredients.length,17);
 assert.equal(m.ingredients.filter(x=>x.name==="hendrix 5%").length,2);
 assert.equal(m.ingredients.find(x=>x.excelRow===20).inclusionKg.rearing_0_4,1e-10);
 assert.equal(m.ingredients.find(x=>x.excelRow===20).inclusionKg.rearing_4_8,0.0001);
 assert.equal(m.ingredients.find(x=>x.excelRow===20).inclusionKg.pullet_8_17,1e-13);
 assert.equal(m.ingredients.find(x=>x.excelRow===7).inclusionKg.pullet_8_17,null);
});
test("reproduces formula weights and cost per kg",()=>{
 const r=E.calculate(E.createDefaultModel());
 close(r.formulas[0].totalMixKg,1000.0000000001,1e-9);
 close(r.formulas[0].costPerKg,1240.000000000296,1e-9);
 close(r.formulas[1].totalMixKg,1000.0001,1e-9);
 close(r.formulas[1].costPerKg,1240.0002959999704,1e-9);
 close(r.formulas[2].costPerKg,1156.0000000000002,1e-9);
 assert.equal(r.formulas[3].costPerKg,null);
});
test("matches seven Excel weekly feed totals and workbook expenditure",()=>{
 const r=E.calculate(E.createDefaultModel());
 assert.deepEqual(r.weeks.map(x=>x.totalFeedKg),[350,350,700,1050,1400,1400,1575]);
 const excel=[434000.0000001,434000.1036,868000.2072,1302000.3108,1736000.4144,1736000.4144,1820700];
 r.weeks.forEach((x,i)=>close(x.totalFeedCost,excel[i],0.01));
 close(r.totals.feedKg,6825,1e-9);
 close(r.totals.feedCost,8330701.45,0.01);
 close(r.totals.feedCostPerBirdForFullSevenWeeks,1666.14029008,0.000001);
});
test("generalises to different bird counts, daily intake and days",()=>{
 const m=E.createDefaultModel();m.birdCountByWeek=[1,2,3,4,5,6,7];m.weeklySchedule[0].dailyKgPerBird=.0125;m.weeklySchedule[0].days=5;
 const r=E.calculate(m);close(r.weeks[0].weeklyIntakePerBirdKg,.0625,1e-12);close(r.weeks[0].totalFeedKg,.0625,1e-12);close(r.weeks[1].totalFeedKg,.14,1e-12);close(r.weeks[6].totalFeedKg,2.205,1e-12);
});
test("applies sale events to daily flock size inside a week",()=>{
 const r=E.calculate(E.createDefaultModel(),{flockEvents:[{week:7,dayIndex:3,type:"sale",quantity:500}]});
 assert.deepEqual(r.weeks[6].dailyRows.map(x=>x.birds),[5000,5000,5000,4500,4500,4500,4500]);close(r.weeks[6].totalFeedKg,1485,1e-9);
});
test("ingredient price change propagates through every affected formula",()=>{
 const r=E.simulateIngredientPrice(E.createDefaultModel(),"excel-row-15",3500);
 close(r.changeInFeedCost,314999.97648,0.01);
 close(r.scenario.formulas[0].costPerKg-r.baseline.formulas[0].costPerKg,48,1e-9);
 close(r.scenario.formulas[2].costPerKg-r.baseline.formulas[2].costPerKg,40,1e-9);
});
test("egg calculations use the entered laying rate, not an assumed one",()=>{
 const m=E.createDefaultModel();m.birdCountByWeek[0]=100;m.layingPercentages[0]=.75;
 const r=E.calculate(m);close(r.weeks[0].dailyEggs,75,1e-12);close(r.weeks[0].weeklyEggs,525,1e-12);
});
test("break-even calculator includes entered cost only",()=>{
 const r=E.calculateBreakEvenSalePrice({birdsToSell:10,accumulatedCostPerBird:2500,saleCostsTotal:500,otherAllocatedCostsTotal:1000,profitMarginPercent:10});
 assert.equal(r.breakEvenPerBird,2650);close(r.suggestedPricePerBird,2915,1e-9);
});
test("rejects invalid percentages and negative flock counts",()=>{
 const m=E.createDefaultModel();m.layingPercentages[0]=1.2;assert.throws(()=>E.calculate(m),/between 0 and 1/);m.layingPercentages[0]=0;m.birdCountByWeek[0]=-1;assert.throws(()=>E.calculate(m),/cannot be negative/);
});
test("keeps egg-production days separate from feed-consumption days",()=>{
 const m=E.createDefaultModel();m.birdCountByWeek[0]=100;m.layingPercentages[0]=.75;m.layingDaysPerWeek[0]=5;
 const r=E.calculate(m);close(r.weeks[0].dailyEggs,75,1e-12);close(r.weeks[0].weeklyEggs,375,1e-12);
});

test("matches every ingredient-by-week quantity and cost cell from the workbook",()=>{
 const benchmark=require("./broiler-workbook-benchmark.json");
 const result=E.calculate(E.createDefaultModel());
 const closeRelative=(actual,expected)=>{
  const tolerance=Math.max(1e-14,Math.abs(expected)*1e-10);
  assert.ok(Math.abs(actual-expected)<=tolerance,actual+" differs from workbook cell "+expected+" by more than "+tolerance);
 };
 benchmark.ingredientExcelRows.forEach((excelRow,rowIndex)=>{
  for(let weekIndex=0;weekIndex<7;weekIndex++){
   const item=result.weeks[weekIndex].ingredientRows.find(x=>x.excelRow===excelRow);
   closeRelative(item.quantityKg,benchmark.feedKg[rowIndex][weekIndex]);
   closeRelative(item.totalCost,benchmark.feedCost[rowIndex][weekIndex]);
  }
 });
});
