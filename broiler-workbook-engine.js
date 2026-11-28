/* Fratel-AgriPredict Excel-parity broiler workbook calculation engine.
 * Benchmark: koudijce broiler.xlsx, worksheet "broilers".
 * Blank source cells remain null; no biological values are invented.
 */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;if(root)root.FratelBroilerWorkbook=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const MODEL_VERSION=2;
const STAGES=[
{id:"rearing_0_4",label:"REARING",ageRange:"0–4 weeks",excelColumns:{kg:"B",percent:"C"},excelRows:[4,20],status:"unverified"},
{id:"rearing_4_8",label:"REARING",ageRange:"4–8 weeks",excelColumns:{kg:"D",percent:"E"},excelRows:[4,20],status:"unverified"},
{id:"pullet_8_17",label:"PULLET",ageRange:"8–17 weeks",excelColumns:{kg:"F",percent:"G"},excelRows:[4,20],status:"unverified"},
{id:"pre_lay_17_20",label:"PRE-LAY",ageRange:"17–20 weeks",excelColumns:{kg:"H",percent:null},excelRows:[4,20],status:"incomplete"}
];
const RAW_INGREDIENTS=[
[4,"Knurse Meal",0,0,0,null,8900],[5,"Romelko",0,0,0,null,5100],[6,"hendrix 5%",60,60,50,null,4800],
[7,"intraco 20%",0,0,null,null,4100],[8,"hendrix 5%",0,0,null,null,4800],[9,"Maize Broken",180,180,200,null,1000],
[10,"Maize Bran",520,520,530,null,600],[11,"Limestone/Shells",20,20,20,null,400],[12,"Sugar",0,0,0,null,3780],
[13,"Whole Maize",0,0,0,null,1000],[14,"Wheat Bran",0,0,0,null,600],[15,"Soya",120,120,100,null,3100],
[16,"Sunflower",100,100,100,null,800],[17,"Essential Drug Premix",0,0,0,null,6000],[18,"Fintox",0,0,0,null,500],
[19,"25% feedlance ",0,0,0,null,4200],[20,"feedlance 5%",1e-10,0.0001,1e-13,null,4200]
];
const INTAKE=[0.01,0.01,0.02,0.03,0.04,0.04,0.045];
const DAYS=[7,7,7,7,7,7,7];
const WEEK_STAGE=["rearing_0_4","rearing_4_8","rearing_4_8","rearing_4_8","rearing_4_8","rearing_4_8",null];
function createDefaultModel(){return{
modelVersion:MODEL_VERSION,source:{file:"koudijce broiler.xlsx",sheet:"broilers",sourceRows:"1–77",benchmark:"Excel formulas reproduced as written"},
currency:"UGX",birdCountByWeek:Array(7).fill(0),stages:STAGES.map(x=>({...x})),
ingredients:RAW_INGREDIENTS.map(r=>({id:"excel-row-"+r[0],excelRow:r[0],name:r[1],inclusionKg:{rearing_0_4:r[2],rearing_4_8:r[3],pullet_8_17:r[4],pre_lay_17_20:r[5]},pricePerKg:r[6]})),
weeklySchedule:INTAKE.map((v,i)=>({week:i+1,dailyKgPerBird:null,sourceReferenceKgPerBird:v,days:DAYS[i],formulaStageId:WEEK_STAGE[i],sourceFormulaStageId:i===6?"pullet_8_17":WEEK_STAGE[i],formulaStageConfirmed:i!==6,excelStageLabel:["REARING ","REARING",null,null,null,null,"STARTER"][i],excelBirdCountColumn:String.fromCharCode(66+i),excelDailyIntakeColumn:String.fromCharCode(66+i)})),
layingPercentages:Array(7).fill(0),layingDaysPerWeek:Array(7).fill(7),
notes:{weeklyIntakeLabel:"Weekly intake Per Pig",weeklyIntakeDisplayLabel:"Weekly intake per bird (Excel label retained in source notes)",formulaMappingNote:"Source workbook: Week 1 uses column C percentages; Weeks 2–6 use column E percentages; Week 7 feed rows reference column G (PULLET 8–17) even though the week heading says STARTER.",blankStagePolicy:"Blank ingredient quantities remain uncalculated until entered.",dailyFeedPolicy:"Daily feed per bird is entered by the farmer in grams per bird per day. Workbook figures are imported references, not validated recommendations.",flockCountPolicy:"Flock totals use the selected Broiler batch and recorded additions, sales and mortality; the workbook sample count of 5,000 is not used as a live flock default."}
};}
function finite(v,label){const n=Number(v);if(!Number.isFinite(n))throw new TypeError(label+" must be a valid number.");return n;}
function nonNegative(v,label){const n=finite(v,label);if(n<0)throw new RangeError(label+" cannot be negative.");return n;}
function sum(a){return a.reduce((s,v)=>s+v,0);}
function stageOf(model,id){return model.stages.find(x=>x.id===id);}
function ingredientKg(ingredient,stageId){const v=ingredient.inclusionKg?.[stageId];return v==null?0:nonNegative(v,ingredient.name+" inclusion");}
function calculateFormula(model,stageId,priceOverrides={}){
const stage=stageOf(model,stageId);if(!stage)throw new Error("Unknown feed stage: "+stageId);
const entries=model.ingredients.map(item=>{const kg=ingredientKg(item,stageId);const price=Object.prototype.hasOwnProperty.call(priceOverrides,item.id)?nonNegative(priceOverrides[item.id],item.name+" simulated price"):nonNegative(item.pricePerKg,item.name+" price");return{ingredientId:item.id,excelRow:item.excelRow,name:item.name,inclusionKg:kg,pricePerKg:price,lineCost:kg*price};});
const totalMixKg=sum(entries.map(x=>x.inclusionKg)),rawMixCost=sum(entries.map(x=>x.lineCost)),allIngredientRowsEntered=model.ingredients.every(item=>Object.prototype.hasOwnProperty.call(item.inclusionKg||{},stageId)&&item.inclusionKg[stageId]!==null&&item.inclusionKg[stageId]!==""),entriesComplete=allIngredientRowsEntered&&totalMixKg>0,complete=entriesComplete&&stage.status==="active",totalMixCost=entriesComplete?rawMixCost:null;
return{stageId,stageLabel:stage.label,ageRange:stage.ageRange,complete,entriesComplete,totalMixKg,totalMixCost,costPerKg:complete?totalMixCost/totalMixKg:null,percentageTotal:entriesComplete?sum(entries.map(x=>x.inclusionKg/totalMixKg)):null,entries};
}
function calculate(modelInput,options={}) {
const model=modelInput||createDefaultModel();
if(!Array.isArray(model.weeklySchedule)||model.weeklySchedule.length<1)throw new Error("Add at least one week to the feeding schedule.");
if(model.weeklySchedule.length>20)throw new Error("The feeding planner supports up to 20 weeks per plan.");
if(!Array.isArray(model.ingredients)||model.ingredients.length!==17)throw new Error("All 17 workbook ingredient rows must be retained.");
const overrides=options.priceOverrides||{},formulas=model.stages.map(stage=>calculateFormula(model,stage.id,overrides)),byId=new Map(formulas.map(x=>[x.stageId,x])),events=Array.isArray(options.flockEvents)?options.flockEvents:[];
const weeks=model.weeklySchedule.map((week,index)=>{
const label="Week "+(week.week??index+1),days=Math.floor(nonNegative(week.days,label+" feeding days"));
if(days>7)throw new RangeError(label+" feeding days cannot exceed seven.");
const rawDaily=week.dailyKgPerBird,hasDaily=rawDaily!==null&&rawDaily!==undefined&&rawDaily!=="",daily=hasDaily?nonNegative(rawDaily,label+" daily feed per bird"):null;
const start=nonNegative(model.birdCountByWeek?.[index]??0,label+" bird count"),dailyRows=[];let birds=start;
for(let d=0;d<days;d++){
for(const event of events.filter(e=>Number(e.week)===Number(week.week??index+1)&&Number(e.dayIndex)===d)){
const q=nonNegative(event.quantity,"Flock event quantity"),type=String(event.type||"").toLowerCase();
if(type==="addition")birds+=q;else if(type==="sale"||type==="mortality"||type==="death")birds-=q;else throw new Error("Unsupported flock event type: "+event.type);
if(birds<0)throw new RangeError(label+", day "+(d+1)+": flock count cannot fall below zero.");
}
dailyRows.push({day:d+1,birds,feedKg:daily===null?null:daily*birds});
}
const birdDays=sum(dailyRows.map(x=>x.birds)),feedKg=daily===null?null:daily*birdDays,weeklyPerBird=daily===null?null:daily*days;
const stageId=week.formulaStageId||null,formula=stageId?byId.get(stageId):null;
if(stageId&&!formula)throw new Error(label+" uses an unknown feed formulation.");
const formulaReady=!!formula?.complete;
const ingredientRows=formulaReady&&feedKg!==null?formula.entries.map(entry=>{
const share=formula.totalMixKg>0?entry.inclusionKg/formula.totalMixKg:0,quantityKg=feedKg*share,quantityPerBirdKg=weeklyPerBird*share;
return{...entry,proportion:share,quantityKg,quantityPerBirdKg,totalCost:quantityKg*entry.pricePerKg};
}):[];
const feedCost=formulaReady&&feedKg!==null?sum(ingredientRows.map(x=>x.totalCost)):null,costPerKg=formulaReady?formula.costPerKg:null,feedCostPerBird=formulaReady&&weeklyPerBird!==null?weeklyPerBird*costPerKg:null;
const laying=Number(model.layingPercentages?.[index]??0);
if(!Number.isFinite(laying)||laying<0||laying>1)throw new RangeError(label+" laying percentage must be between 0 and 1 (0%–100%).");
const eggDays=Math.floor(nonNegative(model.layingDaysPerWeek?.[index]??days,label+" egg days"));
if(eggDays>7)throw new RangeError(label+" egg days cannot exceed seven.");
const eggBirdCounts=Array.from({length:eggDays},(_,d)=>dailyRows[Math.min(d,dailyRows.length-1)]?.birds??start),dailyEggs=eggBirdCounts.map(count=>count*laying);
return{week:week.week??index+1,stageId:stageId,stage:formula?.stage??null,formulaComplete:formulaReady,dailyKgPerBird:daily,dailyGramsPerBird:daily===null?null:daily*1000,days,birdsAtWeekStart:start,dailyRows,birdsFedDays:birdDays,weeklyIntakePerBirdKg:weeklyPerBird,totalFeedKg:feedKg,costPerKg,feedCostPerBird,totalFeedCost:feedCost,ingredientRows,layingPercentage:laying,layingDays:eggDays,dailyEggs:dailyEggs[0]||0,weeklyEggs:sum(dailyEggs),averageBirds:days?birdDays/days:0};
});
let cumulativeStageBirdCost=0,cumulativeCostKnown=true;
const stageSummaries=model.stages.map(stage=>{
const rows=weeks.filter(x=>x.stageId===stage.id),formula=byId.get(stage.id);
if(!rows.length)return{stageId:stage.id,label:stage.label,ageRange:stage.ageRange,complete:!!formula?.complete,formulaCostPerKg:formula?.costPerKg??null,feedKg:null,feedCost:null,perBirdFeedCost:null,cumulativeFeedCostPerBird:null,weeks:[]};
const feedKnown=rows.every(x=>x.totalFeedKg!==null),costKnown=feedKnown&&rows.every(x=>x.totalFeedKg===0||x.totalFeedCost!==null),perBirdKnown=rows.every(x=>x.weeklyIntakePerBirdKg!==null&&(x.weeklyIntakePerBirdKg===0||x.feedCostPerBird!==null));
const stageFeedKg=feedKnown?sum(rows.map(x=>x.totalFeedKg)):null,stageFeedCost=costKnown?sum(rows.map(x=>x.totalFeedCost||0)):null,perBird=perBirdKnown?sum(rows.map(x=>x.feedCostPerBird||0)):null;
if(perBirdKnown&&cumulativeCostKnown)cumulativeStageBirdCost+=perBird||0;else cumulativeCostKnown=false;
return{stageId:stage.id,label:stage.label,ageRange:stage.ageRange,complete:!!formula?.complete&&costKnown,formulaCostPerKg:formula?.costPerKg??null,feedKg:stageFeedKg,feedCost:stageFeedCost,perBirdFeedCost:perBird,cumulativeFeedCostPerBird:cumulativeCostKnown?cumulativeStageBirdCost:null,weeks:rows.map(x=>x.week)};
});
const allFeedKnown=weeks.every(x=>x.totalFeedKg!==null),knownFeedKg=sum(weeks.filter(x=>x.totalFeedKg!==null).map(x=>x.totalFeedKg)),allCostKnown=allFeedKnown&&weeks.every(x=>x.totalFeedKg===0||x.totalFeedCost!==null),knownFeedCost=sum(weeks.filter(x=>x.totalFeedCost!==null).map(x=>x.totalFeedCost));
const allPerBirdCostsKnown=weeks.every(x=>x.weeklyIntakePerBirdKg!==null&&(x.weeklyIntakePerBirdKg===0||x.feedCostPerBird!==null));
const warnings=[];
weeks.forEach(x=>{
if(x.dailyKgPerBird===null)warnings.push("Week "+x.week+": enter the daily feed allowance per bird; complete feed totals are not available yet.");
if(x.dailyKgPerBird!==null&&x.dailyKgPerBird>0&&!x.formulaComplete)warnings.push("Week "+x.week+": select a complete, verified feed formulation before using ingredient quantities or feed costs.");
const source=model.weeklySchedule.find(w=>Number(w.week)===Number(x.week));
if(source?.sourceFormulaStageId==="pullet_8_17"&&!source.formulaStageConfirmed)warnings.push("Week "+x.week+": the Excel heading says STARTER, but its ingredient formulas reference the PULLET 8–17 week percentages. No formula has been assumed.");
});
model.stages.filter(stage=>stage.status==="incomplete").forEach(stage=>warnings.push(stage.label+" ("+stage.ageRange+") has an incomplete source formulation."));
const feedKg=allFeedKnown?knownFeedKg:null,feedCost=allCostKnown?knownFeedCost:null;
return{currency:model.currency||"UGX",formulas,weeks,stageSummaries,totals:{feedKg,knownFeedKg,feedCost,knownFeedCost,averageFeedCostPerKg:feedCost!==null&&feedKg>0?feedCost/feedKg:null,feedCostPerBirdForFullSevenWeeks:allPerBirdCostsKnown?sum(weeks.map(x=>x.feedCostPerBird||0)):null,feedCostPerBirdForScheduledWeeks:allPerBirdCostsKnown?sum(weeks.map(x=>x.feedCostPerBird||0)):null,eggs:sum(weeks.map(x=>x.weeklyEggs)),birdDays:sum(weeks.map(x=>x.birdsFedDays)),feedInputsComplete:weeks.every(x=>x.dailyKgPerBird!==null),formulasComplete:allCostKnown},warnings};
}

function buildFlockScheduleFromBatch(modelInput,batch){
if(!batch)throw new Error("Select a Broiler batch to calculate its live flock schedule.");
const initial=Number(batch.initialBirds),scheduleWeeks=modelInput?.weeklySchedule?.length||0;
if(!Number.isInteger(initial)||initial<1)throw new RangeError("The selected batch must have a positive whole-number starting bird count.");
if(scheduleWeeks<1||scheduleWeeks>20)throw new Error("The feeding schedule must contain between one and 20 weeks.");
const parseDay=value=>{const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)throw new Error("The batch placement date and flock event dates must use YYYY-MM-DD.");const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]),stamp=Date.UTC(y,m-1,d),check=new Date(stamp);if(check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d)throw new Error("A flock event contains an invalid calendar date.");return Math.floor(stamp/86400000);};
const placed=parseDay(batch.placementDate),changes=(batch.records||[]).filter(r=>["addition","sale","mortality"].includes(String(r.type||"").toLowerCase())).map(r=>{const quantity=Number(r.quantity);if(!Number.isInteger(quantity)||quantity<=0)throw new RangeError("Flock additions, sales and mortality must be positive whole numbers.");const offset=parseDay(r.date||String(r.createdAt||"").slice(0,10))-placed;if(offset<0)throw new RangeError("A flock event is dated before the batch placement date.");return{effectiveDay:offset+1,type:String(r.type).toLowerCase(),quantity};}).sort((a,b)=>a.effectiveDay-b.effectiveDay);
const nextModel=JSON.parse(JSON.stringify(modelInput)),flockEvents=[];
nextModel.birdCountByWeek=Array(scheduleWeeks).fill(0);
for(let week=1;week<=scheduleWeeks;week++){
const firstDay=(week-1)*7;let birds=initial;
for(const change of changes){if(change.effectiveDay<firstDay)birds+=change.type==="addition"?change.quantity:-change.quantity;}
if(birds<0)throw new RangeError("Recorded flock reductions exceed the birds available at the start of week "+week+".");
nextModel.birdCountByWeek[week-1]=birds;
for(const change of changes){if(change.effectiveDay>=firstDay&&change.effectiveDay<firstDay+7){const dayIndex=change.effectiveDay-firstDay;flockEvents.push({week,dayIndex,type:change.type,quantity:change.quantity});}}
}
return{model:nextModel,flockEvents,eventsApplied:changes.length,eventTiming:"Date-only flock events take effect from the next calendar day after the recorded date."};
}

function simulateIngredientPrice(model,id,newPrice){const ingredient=model.ingredients.find(x=>x.id===id);if(!ingredient)throw new Error("Select a valid ingredient from the workbook list.");const price=nonNegative(newPrice,"New ingredient price"),baseline=calculate(model),scenario=calculate(model,{priceOverrides:{[id]:price}});return{ingredientId:id,oldPrice:ingredient.pricePerKg,newPrice:price,changePerKg:price-ingredient.pricePerKg,baseline,scenario,changeInFeedCost:scenario.totals.feedCost-baseline.totals.feedCost,changeInAverageFeedCostPerKg:scenario.totals.averageFeedCostPerKg-baseline.totals.averageFeedCostPerKg};}
function calculateBreakEvenSalePrice(input){const birds=nonNegative(input.birdsToSell,"Birds to sell");if(birds<=0)throw new RangeError("Enter at least one bird to sell.");const perBird=nonNegative(input.accumulatedCostPerBird,"Accumulated cost per bird"),sale=nonNegative(input.saleCostsTotal||0,"Sale costs"),other=nonNegative(input.otherAllocatedCostsTotal||0,"Other allocated costs"),total=birds*perBird+sale+other,breakEven=total/birds,margin=input.profitMarginPercent==null?null:nonNegative(input.profitMarginPercent,"Profit margin");if(margin!=null&&margin>=100)throw new RangeError("Profit margin must be below 100% when expressed as a markup percentage.");return{birdsToSell:birds,allocatedCost:birds*perBird,saleCostsTotal:sale,otherAllocatedCostsTotal:other,totalCost:total,breakEvenPerBird:breakEven,suggestedPricePerBird:margin==null?null:breakEven*(1+margin/100),profitMarginPercent:margin};}

function calculateBatchCostAllocation(input){
const batch=input?.batch;if(!batch||typeof batch!=="object")throw new TypeError("A Broiler batch is required.");
const saleDate=String(input.saleDate||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(saleDate))throw new TypeError("A valid sale date is required.");
if(input.allCostsConfirmed!==true)throw new Error("Confirm that all chick, health and other farm costs through the sale date have been recorded.");
const initial=finite(batch.initialBirds,"Initial birds");if(!Number.isInteger(initial)||initial<=0)throw new RangeError("The batch must have a positive whole-number starting bird count.");
if(batch.chickCost==null||batch.chickCost==="")throw new Error("Enter the actual chick purchase cost per chick in the batch record.");
const chickPrice=nonNegative(batch.chickCost,"Chick cost per bird"),records=Array.isArray(batch.records)?batch.records:[],relevant=records.filter(r=>String(r.date||"")<=saleDate);
let additions=0,mortality=0,sold=0,additionCost=0,otherCosts=0;
for(const r of relevant){
const type=String(r.type||"").toLowerCase(),date=String(r.date||"");
if(type==="addition"&&date<=saleDate){
const q=finite(r.quantity,"Added birds");if(!Number.isInteger(q)||q<=0)throw new RangeError("Added birds must be a positive whole number.");
let cost=r.amount!=null&&r.amount!==""?nonNegative(r.amount,"Added bird purchase cost"):r.unitPrice!=null&&r.unitPrice!==""?q*nonNegative(r.unitPrice,"Added bird price"):null;
if(cost==null)throw new Error("A bird addition on or before the sale date has no recorded purchase cost. Add its actual cost before calculating break-even.");
additions+=q;additionCost+=cost;
}
if(type==="mortality"&&date<=saleDate){const q=finite(r.quantity,"Mortality");if(!Number.isInteger(q)||q<0)throw new RangeError("Mortality must be a whole number.");mortality+=q;}
if(type==="sale"&&date<=saleDate){const q=finite(r.quantity,"Previously sold birds");if(!Number.isInteger(q)||q<0)throw new RangeError("Previously sold birds must be a whole number.");sold+=q;}
if(type==="expense")otherCosts+=nonNegative(r.amount,"Farm expense");
if(type==="health")otherCosts+=nonNegative(r.cost??0,"Health cost");
}
const saleableBirds=initial+additions-mortality,liveBirds=saleableBirds-sold;if(saleableBirds<=0||liveBirds<0)throw new RangeError("Recorded sales and mortality exceed the birds available by the sale date.");
const feedTotal=nonNegative(input.feedCostTotal,"Feed cost total"),saleCost=nonNegative(input.saleCostPerBird??0,"Sale cost per bird");
const chickPurchaseTotal=initial*chickPrice+additionCost,nonFeedCostTotal=chickPurchaseTotal+otherCosts;
const allocatedChickCostPerBird=chickPurchaseTotal/saleableBirds,allocatedOtherCostPerBird=otherCosts/saleableBirds,allocatedFeedCostPerBird=feedTotal/saleableBirds;
const breakEvenPerBird=allocatedChickCostPerBird+allocatedOtherCostPerBird+allocatedFeedCostPerBird+saleCost;
return{initialBirds:initial,addedBirds:additions,mortalityBirds:mortality,previouslySoldBirds:sold,saleableBirds,liveBirds,chickPurchaseTotal,otherCostsTotal:otherCosts,nonFeedCostTotal,feedCostTotal:feedTotal,allocatedChickCostPerBird,allocatedOtherCostPerBird,allocatedFeedCostPerBird,saleCostPerBird:saleCost,breakEvenPerBird,totalAllocatedCost:breakEvenPerBird*saleableBirds};
}

function validateModel(model){
const errors=[];
if(!model||!Array.isArray(model.ingredients)||model.ingredients.length!==17)errors.push("Workbook must retain all 17 ingredient rows.");
if(!Array.isArray(model.weeklySchedule)||model.weeklySchedule.length<1)errors.push("Add at least one week to the feeding schedule.");
if(Array.isArray(model.weeklySchedule)&&model.weeklySchedule.length>20)errors.push("A feeding plan cannot exceed 20 weeks.");
const stageIds=new Set((model?.stages||[]).map(x=>x.id));
for(const x of model?.ingredients||[]){
if(!x.id||!x.name)errors.push("Every ingredient row needs a stable ID and name.");
if(!Number.isFinite(Number(x.pricePerKg))||Number(x.pricePerKg)<0)errors.push((x.name||"Ingredient")+": invalid price.");
for(const [stageId,value] of Object.entries(x.inclusionKg||{}))if(value!==null&&value!==""&&(!Number.isFinite(Number(value))||Number(value)<0))errors.push((x.name||"Ingredient")+" ("+stageId+"): inclusion must be a non-negative number or left blank.");
}
for(const [i,x] of (model?.weeklySchedule||[]).entries()){
if(Number(x.week)!==i+1)errors.push("Feeding weeks must be numbered sequentially.");
if(x.dailyKgPerBird!==null&&x.dailyKgPerBird!==""&&(!Number.isFinite(Number(x.dailyKgPerBird))||Number(x.dailyKgPerBird)<0))errors.push("Week "+x.week+": daily feed per bird must be a non-negative number or left blank.");
if(!Number.isInteger(Number(x.days))||Number(x.days)<0||Number(x.days)>7)errors.push("Week "+x.week+": feeding days must be a whole number from 0 to 7.");
if(x.formulaStageId&&!stageIds.has(x.formulaStageId))errors.push("Week "+x.week+": selected feed formulation does not exist.");
}
for(const [i,d] of (model?.layingDaysPerWeek||[]).entries())if(!Number.isInteger(Number(d))||Number(d)<0||Number(d)>7)errors.push("Week "+(i+1)+": egg days must be a whole number from 0 to 7.");
let warnings=[];
if(errors.length===0){try{warnings=calculate(model).warnings;}catch(error){errors.push(error.message);}}
return{valid:errors.length===0,errors,warnings};
}
return Object.freeze({MODEL_VERSION,STAGES,createDefaultModel,calculateFormula,calculate,simulateIngredientPrice,buildFlockScheduleFromBatch,calculateBreakEvenSalePrice,calculateBatchCostAllocation,validateModel});
});
