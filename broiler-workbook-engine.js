/* Fratel-AgriPredict Excel-parity broiler workbook calculation engine.
 * Benchmark: koudijce broiler.xlsx, worksheet "broilers".
 * Blank source cells remain null; no biological values are invented.
 */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;if(root)root.FratelBroilerWorkbook=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const MODEL_VERSION=1;
const STAGES=[
{id:"rearing_0_4",label:"REARING",ageRange:"0–4 weeks",excelColumns:{kg:"B",percent:"C"},excelRows:[4,20]},
{id:"rearing_4_8",label:"REARING",ageRange:"4–8 weeks",excelColumns:{kg:"D",percent:"E"},excelRows:[4,20]},
{id:"pullet_8_17",label:"PULLET",ageRange:"8–17 weeks",excelColumns:{kg:"F",percent:"G"},excelRows:[4,20]},
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
const WEEK_STAGE=["rearing_0_4","rearing_4_8","rearing_4_8","rearing_4_8","rearing_4_8","rearing_4_8","pullet_8_17"];
function createDefaultModel(){return{
modelVersion:MODEL_VERSION,source:{file:"koudijce broiler.xlsx",sheet:"broilers",sourceRows:"1–77",benchmark:"Excel formulas reproduced as written"},
currency:"UGX",birdCountByWeek:Array(7).fill(5000),stages:STAGES.map(x=>({...x})),
ingredients:RAW_INGREDIENTS.map(r=>({id:"excel-row-"+r[0],excelRow:r[0],name:r[1],inclusionKg:{rearing_0_4:r[2],rearing_4_8:r[3],pullet_8_17:r[4],pre_lay_17_20:r[5]},pricePerKg:r[6]})),
weeklySchedule:INTAKE.map((v,i)=>({week:i+1,dailyKgPerBird:v,days:DAYS[i],formulaStageId:WEEK_STAGE[i],excelStageLabel:["REARING ","REARING",null,null,null,null,"STARTER"][i],excelBirdCountColumn:String.fromCharCode(66+i),excelDailyIntakeColumn:String.fromCharCode(66+i)})),
layingPercentages:Array(7).fill(0),layingDaysPerWeek:Array(7).fill(7),
notes:{weeklyIntakeLabel:"Weekly intake Per Pig",weeklyIntakeDisplayLabel:"Weekly intake per bird (Excel label retained in source notes)",formulaMappingNote:"Week 1 uses column C percentages; Weeks 2–6 use column E percentages; Week 7 uses column G percentages.",blankStagePolicy:"Pre-lay ingredient quantities are blank in the source workbook and remain uncalculated until entered."}
};}
function finite(v,label){const n=Number(v);if(!Number.isFinite(n))throw new TypeError(label+" must be a valid number.");return n;}
function nonNegative(v,label){const n=finite(v,label);if(n<0)throw new RangeError(label+" cannot be negative.");return n;}
function sum(a){return a.reduce((s,v)=>s+v,0);}
function stageOf(model,id){return model.stages.find(x=>x.id===id);}
function ingredientKg(ingredient,stageId){const v=ingredient.inclusionKg?.[stageId];return v==null?0:nonNegative(v,ingredient.name+" inclusion");}
function calculateFormula(model,stageId,priceOverrides={}){
const stage=stageOf(model,stageId);if(!stage)throw new Error("Unknown feed stage: "+stageId);
const entries=model.ingredients.map(item=>{const kg=ingredientKg(item,stageId);const price=Object.prototype.hasOwnProperty.call(priceOverrides,item.id)?nonNegative(priceOverrides[item.id],item.name+" simulated price"):nonNegative(item.pricePerKg,item.name+" price");return{ingredientId:item.id,excelRow:item.excelRow,name:item.name,inclusionKg:kg,pricePerKg:price,lineCost:kg*price};});
const totalMixKg=sum(entries.map(x=>x.inclusionKg)),totalMixCost=sum(entries.map(x=>x.lineCost)),complete=stage.status!=="incomplete"&&totalMixKg>0;
return{stageId,stageLabel:stage.label,ageRange:stage.ageRange,complete,totalMixKg,totalMixCost,costPerKg:complete?totalMixCost/totalMixKg:null,percentageTotal:complete?sum(entries.map(x=>x.inclusionKg/totalMixKg)):null,entries};
}
function calculate(modelInput,options={}){
const model=modelInput||createDefaultModel();if(!Array.isArray(model.weeklySchedule)||model.weeklySchedule.length!==7)throw new Error("The workbook schedule must contain all seven weeks.");if(!Array.isArray(model.ingredients)||model.ingredients.length!==17)throw new Error("All 17 workbook ingredient rows must be retained.");
const overrides=options.priceOverrides||{},formulas=model.stages.map(stage=>calculateFormula(model,stage.id,overrides)),byId=new Map(formulas.map(x=>[x.stageId,x])),events=Array.isArray(options.flockEvents)?options.flockEvents:[];
const weeks=model.weeklySchedule.map((week,index)=>{
const days=Math.floor(nonNegative(week.days,"Week "+week.week+" days")),daily=nonNegative(week.dailyKgPerBird,"Week "+week.week+" daily intake"),start=nonNegative(model.birdCountByWeek[index],"Week "+week.week+" bird count"),dailyRows=[];let birds=start;
for(let d=0;d<days;d++){for(const event of events.filter(e=>Number(e.week)===Number(week.week)&&Number(e.dayIndex)===d)){const q=nonNegative(event.quantity,"Flock event quantity"),type=String(event.type||"").toLowerCase();if(type==="addition")birds+=q;else if(type==="sale"||type==="mortality"||type==="death")birds-=q;else throw new Error("Unsupported flock event type: "+event.type);if(birds<0)throw new RangeError("Week "+week.week+", day "+(d+1)+": flock count cannot fall below zero.");}dailyRows.push({day:d+1,birds,feedKg:daily*birds});}
const birdDays=sum(dailyRows.map(x=>x.birds)),feedKg=sum(dailyRows.map(x=>x.feedKg)),weeklyPerBird=daily*days,formula=byId.get(week.formulaStageId),ingredientRows=formula.entries.map(entry=>{const share=formula.totalMixKg>0?entry.inclusionKg/formula.totalMixKg:0,quantityKg=feedKg*share;return{...entry,proportion:share,quantityKg,totalCost:quantityKg*entry.pricePerKg};}),feedCost=sum(ingredientRows.map(x=>x.totalCost)),costPerKg=formula.costPerKg,feedCostPerBird=costPerKg==null?null:weeklyPerBird*costPerKg,laying=Number(model.layingPercentages?.[index]??0);
if(!Number.isFinite(laying)||laying<0||laying>1)throw new RangeError("Week "+week.week+" laying percentage must be between 0 and 1 (0%–100%).");
const eggDays=Math.floor(nonNegative(model.layingDaysPerWeek?.[index]??days,"Week "+week.week+" egg days"));
if(eggDays>7)throw new RangeError("Week "+week.week+" egg days cannot exceed seven.");
const eggBirdCounts=Array.from({length:eggDays},(_,d)=>dailyRows[Math.min(d,dailyRows.length-1)]?.birds??start),dailyEggs=eggBirdCounts.map(birds=>birds*laying);
return{week:week.week,stageId:week.formulaStageId,stage:stageOf(model,week.formulaStageId),dailyKgPerBird:daily,days,birdsAtWeekStart:start,dailyRows,birdsFedDays:birdDays,weeklyIntakePerBirdKg:weeklyPerBird,totalFeedKg:feedKg,costPerKg,feedCostPerBird,totalFeedCost:feedCost,ingredientRows,layingPercentage:laying,layingDays:eggDays,dailyEggs:dailyEggs[0]||0,weeklyEggs:sum(dailyEggs),averageBirds:days?birdDays/days:0};
});
let cumulativeStageBirdCost=0;const stageSummaries=model.stages.map(stage=>{const rows=weeks.filter(x=>x.stageId===stage.id),formula=byId.get(stage.id),perBird= sum(rows.map(x=>x.feedCostPerBird||0));if(formula.complete)cumulativeStageBirdCost+=perBird;return{stageId:stage.id,label:stage.label,ageRange:stage.ageRange,complete:formula.complete,formulaCostPerKg:formula.costPerKg,feedKg:sum(rows.map(x=>x.totalFeedKg)),feedCost:sum(rows.map(x=>x.totalFeedCost)),perBirdFeedCost:perBird,cumulativeFeedCostPerBird:formula.complete?cumulativeStageBirdCost:null,weeks:rows.map(x=>x.week)};});
const feedKg=sum(weeks.map(x=>x.totalFeedKg)),feedCost=sum(weeks.map(x=>x.totalFeedCost));
return{currency:model.currency||"UGX",formulas,weeks,stageSummaries,totals:{feedKg,feedCost,averageFeedCostPerKg:feedKg>0?feedCost/feedKg:null,feedCostPerBirdForFullSevenWeeks:sum(weeks.map(x=>x.feedCostPerBird||0)),eggs:sum(weeks.map(x=>x.weeklyEggs)),birdDays:sum(weeks.map(x=>x.birdsFedDays))},warnings:model.stages.filter(stage=>stage.status==="incomplete"||!byId.get(stage.id).complete).map(stage=>stage.label+" ("+stage.ageRange+") has no complete feed formulation in the workbook.")};
}

function buildFlockScheduleFromBatch(modelInput,batch){
if(!batch)throw new Error("Select a Broiler batch to calculate its live flock schedule.");
const initial=Number(batch.initialBirds);
if(!Number.isInteger(initial)||initial<0)throw new RangeError("The selected batch must have a valid whole-number starting bird count.");
const parseDay=value=>{const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)throw new Error("The batch placement date and flock event dates must use YYYY-MM-DD.");const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]),stamp=Date.UTC(y,m-1,d),check=new Date(stamp);if(check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d)throw new Error("A flock event contains an invalid calendar date.");return Math.floor(stamp/86400000);};
const placed=parseDay(batch.placementDate),changes=(batch.records||[]).filter(r=>["addition","sale","mortality"].includes(String(r.type||"").toLowerCase())).map(r=>{const quantity=Number(r.quantity);if(!Number.isInteger(quantity)||quantity<=0)throw new RangeError("Flock additions, sales and mortality must be positive whole numbers.");const ageDay=parseDay(r.date||String(r.createdAt||"").slice(0,10))-placed;if(ageDay<0)throw new RangeError("A flock event is dated before the batch placement date.");return{effectiveDay:ageDay+1,type:String(r.type).toLowerCase(),quantity};}).sort((a,b)=>a.effectiveDay-b.effectiveDay);
const nextModel=JSON.parse(JSON.stringify(modelInput)),flockEvents=[];
for(let week=1;week<=7;week++){const firstDay=(week-1)*7;let birds=initial;for(const change of changes){if(change.effectiveDay<firstDay)birds+=change.type==="addition"?change.quantity:-change.quantity;}if(birds<0)throw new RangeError("Recorded flock reductions exceed the birds available at the start of week "+week+".");nextModel.birdCountByWeek[week-1]=birds;let dailyBirds=birds;for(const change of changes){if(change.effectiveDay>=firstDay&&change.effectiveDay<firstDay+7){dailyBirds+=change.type==="addition"?change.quantity:-change.quantity;if(dailyBirds<0)throw new RangeError("Recorded flock reductions exceed the birds available on feeding day "+(change.effectiveDay+1)+".");flockEvents.push({week,dayIndex:change.effectiveDay-firstDay,type:change.type,quantity:change.quantity});}}}
return{model:nextModel,flockEvents,eventsApplied:changes.length,eventTiming:"Events take effect from the feeding day after their recorded date because the existing dashboard records dates, not times."};
}

function simulateIngredientPrice(model,id,newPrice){const ingredient=model.ingredients.find(x=>x.id===id);if(!ingredient)throw new Error("Select a valid ingredient from the workbook list.");const price=nonNegative(newPrice,"New ingredient price"),baseline=calculate(model),scenario=calculate(model,{priceOverrides:{[id]:price}});return{ingredientId:id,oldPrice:ingredient.pricePerKg,newPrice:price,changePerKg:price-ingredient.pricePerKg,baseline,scenario,changeInFeedCost:scenario.totals.feedCost-baseline.totals.feedCost,changeInAverageFeedCostPerKg:scenario.totals.averageFeedCostPerKg-baseline.totals.averageFeedCostPerKg};}
function calculateBreakEvenSalePrice(input){const birds=nonNegative(input.birdsToSell,"Birds to sell");if(birds<=0)throw new RangeError("Enter at least one bird to sell.");const perBird=nonNegative(input.accumulatedCostPerBird,"Accumulated cost per bird"),sale=nonNegative(input.saleCostsTotal||0,"Sale costs"),other=nonNegative(input.otherAllocatedCostsTotal||0,"Other allocated costs"),total=birds*perBird+sale+other,breakEven=total/birds,margin=input.profitMarginPercent==null?null:nonNegative(input.profitMarginPercent,"Profit margin");if(margin!=null&&margin>=100)throw new RangeError("Profit margin must be below 100% when expressed as a markup percentage.");return{birdsToSell:birds,allocatedCost:birds*perBird,saleCostsTotal:sale,otherAllocatedCostsTotal:other,totalCost:total,breakEvenPerBird:breakEven,suggestedPricePerBird:margin==null?null:breakEven*(1+margin/100),profitMarginPercent:margin};}
function validateModel(model){const errors=[];if(!model||!Array.isArray(model.ingredients)||model.ingredients.length!==17)errors.push("Workbook must contain all 17 ingredient rows.");if(!Array.isArray(model.weeklySchedule)||model.weeklySchedule.length!==7)errors.push("Workbook must contain all seven weekly intake columns.");for(const x of model.ingredients||[]){if(!x.id||!x.name)errors.push("Every ingredient row needs a stable ID and name.");if(!Number.isFinite(Number(x.pricePerKg))||Number(x.pricePerKg)<0)errors.push((x.name||"Ingredient")+": invalid price.");}for(const x of model.weeklySchedule||[]){if(!Number.isFinite(Number(x.dailyKgPerBird))||Number(x.dailyKgPerBird)<0)errors.push("Week "+x.week+": invalid daily intake.");if(!Number.isInteger(Number(x.days))||Number(x.days)<0||Number(x.days)>7)errors.push("Week "+x.week+": feeding days must be a whole number from 0 to 7.");}for(const [i,d] of (model.layingDaysPerWeek||[]).entries())if(!Number.isInteger(Number(d))||Number(d)<0||Number(d)>7)errors.push("Week "+(i+1)+": egg days must be a whole number from 0 to 7.");try{calculate(model);}catch(error){errors.push(error.message);}return{valid:errors.length===0,errors};}
return Object.freeze({MODEL_VERSION,STAGES,createDefaultModel,calculateFormula,calculate,simulateIngredientPrice,buildFlockScheduleFromBatch,calculateBreakEvenSalePrice,validateModel});
});
