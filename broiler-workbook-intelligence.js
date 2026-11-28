/* Fratel-AgriPredict — integrated Broiler daily feed planner.
   Farmer-entered daily feed per bird. Source workbook figures are references only. */
(() => {
"use strict";
const E=window.FratelBroilerWorkbook;
if(!E){console.error("Broiler workbook engine is missing.");return;}
const $=(s,r=document)=>r.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=v=>Number(v).toLocaleString("en-UG",{maximumFractionDigits:3});
const money=v=>"UGX "+Math.round(Number(v)).toLocaleString("en-UG");
const kg=v=>v==null?"Incomplete":fmt(v)+" kg";
const price=v=>v==null?"Incomplete":money(v);
const MAX_WEEKS=20;
let model=E.createDefaultModel(),result=null,modelReady=false,busy=false,formulaStage="rearing_0_4",sourceMode="batch";

function activeBatch(){
 const batches=window.FratelAgriPredictDashboard?.getBatches?.()||[];
 const selected=String($("#batchSelect")?.value||"");
 return batches.find(b=>String(b.id)===selected)||null;
}
function migrateModel(saved){
 const defaults=E.createDefaultModel();
 if(!saved||typeof saved!=="object")return defaults;
 const savedVersion=Number(saved.modelVersion||1);
 const merged={...defaults,...saved};
 ["stages","ingredients","weeklySchedule","birdCountByWeek","layingPercentages","layingDaysPerWeek"].forEach(k=>{if(Array.isArray(saved[k]))merged[k]=saved[k];});
 if(savedVersion<2){
  merged.weeklySchedule=(merged.weeklySchedule||defaults.weeklySchedule).map((w,i)=>({...defaults.weeklySchedule[i],...w,sourceReferenceKgPerBird:w.sourceReferenceKgPerBird??w.dailyKgPerBird??null,dailyKgPerBird:null,formulaStageConfirmed:false}));
  merged.birdCountByWeek=Array(merged.weeklySchedule.length).fill(0);
 }
 if(savedVersion<3){
  merged.stages=(merged.stages||defaults.stages).map(stage=>({...stage,status:stage.id==="pre_lay_17_20"?"incomplete":"unverified"}));
 }
 while(merged.weeklySchedule.length<7){
  const n=merged.weeklySchedule.length+1;
  merged.weeklySchedule.push({week:n,dailyKgPerBird:null,sourceReferenceKgPerBird:null,days:7,formulaStageId:null,sourceFormulaStageId:null,formulaStageConfirmed:false});
 }
 merged.birdCountByWeek=merged.weeklySchedule.map((_,i)=>Number.isFinite(Number(merged.birdCountByWeek?.[i]))?Number(merged.birdCountByWeek[i]):0);
 merged.modelVersion=E.MODEL_VERSION;
 return merged;
}
function mount(){
 const page=$("#feedView");
 if(!page||$("#feedTab-daily-plan"))return;
 const nav=$(".feed-module-nav",page);
 if(nav){const btn=document.createElement("button");btn.type="button";btn.dataset.feedTab="daily-plan";btn.textContent="Daily Feed Plan";nav.append(btn);}
 const panel=document.createElement("div");
 panel.className="feed-tab-content bwi-plan";panel.id="feedTab-daily-plan";panel.hidden=true;
 panel.innerHTML=
 '<div class="bwi-plan-heading"><div><span class="eyebrow">BROILER FEED PLANNING</span><h2>Daily feed plan</h2><p>Enter daily feed per bird. AgriPredict scales it to the live flock and calculates ingredient requirements and feed costs from the selected formulation.</p></div><div class="bwi-plan-actions"><button type="button" class="btn btn-outline" id="bwiUseBatch">Use selected batch</button><button type="button" class="btn btn-outline" id="bwiAddWeek">+ Add week</button><button type="button" class="btn btn-primary" id="bwiSave">Save feed plan</button></div></div>'+
 '<div class="bwi-notice" id="bwiMsg" role="status">Enter a daily feed allowance per bird. Blank entries are not treated as zero.</div>'+
 '<section class="bwi-card"><div class="bwi-section-title"><div><h3>Flock and planning settings</h3><p>Flock size follows the selected batch and its dated mortality, sales and addition records.</p></div></div><div class="bwi-settings-grid"><label>Selected flock<input id="bwiBatchName" type="text" readonly value="Select a Broiler batch"></label><label>Bird-count source<select id="bwiBirdSource"><option value="batch">Selected batch records (automatic)</option><option value="manual">Enter weekly bird counts manually</option></select></label><label>Plan length<input id="bwiPlanLength" type="text" readonly value="7 weeks"></label></div></section>'+
 '<section class="bwi-kpis"><article><span>Planned feed per bird</span><strong id="bwiKpiBird">Incomplete</strong><small>All scheduled weeks</small></article><article><span>Total flock feed</span><strong id="bwiKpiFeed">Incomplete</strong><small>Based on live bird-days</small></article><article><span>Total feed cost</span><strong id="bwiKpiCost">Incomplete</strong><small>Requires complete feed formulas</small></article><article><span>Average feed cost/kg</span><strong id="bwiKpiUnitCost">Incomplete</strong><small>Ingredient-price weighted</small></article></section>'+
 '<section class="bwi-card"><div class="bwi-section-title"><div><h3>Daily feed allowance per bird</h3><p>Enter grams per bird per day for each age-week. The system multiplies this by feeding days and the birds present on each day.</p></div></div><div class="bwi-table-wrap"><table class="bwi-table bwi-week-table"><thead><tr><th>Age</th><th>Feed formula</th><th>Daily feed / bird</th><th>Days</th><th>Birds at week start</th><th>Feed / bird / week</th><th>Total flock feed</th><th>Feed cost</th><th>Status</th></tr></thead><tbody id="bwiWeeks"></tbody></table></div><p class="bwi-footnote">Enter grams per bird per day. Blank means no allowance has been entered. Excel figures are displayed as historical references only and are not recommendations.</p></section>'+
 '<section class="bwi-card"><div class="bwi-section-title"><div><h3>Feed formulation and ingredient prices</h3><p>Enter or confirm every ingredient quantity and price. Enter 0 where an ingredient is genuinely not used; missing rows prevent cost calculations.</p></div><label class="bwi-stage-choice">Formulation stage<select id="bwiStage"></select></label></div><div id="bwiFormulaTotals" class="bwi-formula-summary"></div><div class="bwi-table-wrap"><table class="bwi-table"><thead><tr><th>Ingredient</th><th>Mix quantity (kg)</th><th>Inclusion (%)</th><th>Price / kg (UGX)</th><th>Ingredient cost (UGX)</th><th>Status</th></tr></thead><tbody id="bwiIngredients"></tbody></table></div><div class="bwi-formula-actions"><button type="button" class="btn btn-outline" id="bwiActivateStage">Confirm formulation is complete</button><span id="bwiStageStatus">Formulation not yet verified</span></div></section>'+
 '<section class="bwi-card"><div class="bwi-section-title"><div><h3>Ingredient requirements and feed costs</h3><p>Available only for weeks with a daily allowance and a complete selected formulation.</p></div></div><div class="bwi-table-wrap"><table class="bwi-table"><thead><tr><th>Week</th><th>Ingredient</th><th>Required quantity (kg)</th><th>Estimated cost (UGX)</th></tr></thead><tbody id="bwiIngredientNeeds"><tr><td colspan="4">Enter feed quantities and complete a formulation to calculate ingredient needs.</td></tr></tbody></table></div></section>'+
 '<section class="bwi-card"><div class="bwi-section-title"><div><h3>Accuracy checks and source notes</h3><p>Resolve these issues before relying on totals.</p></div></div><div id="bwiWarnings" class="bwi-warnings"></div></section>';
 page.append(panel);fillStageChoices();render();
}
function fillStageChoices(){
 $("#bwiStage").innerHTML=model.stages.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.label)+' · '+esc(s.ageRange)+'</option>').join("");
 $("#bwiStage").value=formulaStage;
}
function calculate(){
 const batch=activeBatch();let calculationModel=model,options={};
 if(sourceMode==="batch"&&batch){const schedule=E.buildFlockScheduleFromBatch(model,batch);calculationModel=schedule.model;options={flockEvents:schedule.flockEvents};}
 else if(sourceMode==="batch"&&!batch)calculationModel={...model,birdCountByWeek:model.weeklySchedule.map(()=>0)};
 result=E.calculate(calculationModel,options);return{batch,result};
}
function renderWeeks(){
 const body=$("#bwiWeeks");if(!body||!result)return;
 body.innerHTML=result.weeks.map((w,i)=>{
  const source=model.weeklySchedule[i],stageOptions='<option value="">Select formula</option>'+model.stages.map(s=>'<option value="'+esc(s.id)+'" '+(source.formulaStageId===s.id?'selected':'')+'>'+esc(s.label)+' · '+esc(s.ageRange)+'</option>').join("");
  const grams=source.dailyKgPerBird==null?"":fmt(source.dailyKgPerBird*1000);
  const ref=source.sourceReferenceKgPerBird==null?"":'<small class="bwi-source-ref">Excel reference: '+fmt(source.sourceReferenceKgPerBird*1000)+' g/day</small>';
  const status=source.dailyKgPerBird==null?"Enter daily feed":!w.formulaComplete?"Feed quantity only":"Calculated";
  return '<tr><td><strong>Week '+w.week+'</strong><small>Day '+((w.week-1)*7+1)+'–'+(w.week*7)+'</small></td>'+
   '<td><select data-week-stage="'+i+'" aria-label="Feed formula for week '+w.week+'">'+stageOptions+'</select><small>'+(w.formulaComplete?"Formula complete":source.formulaStageId?"Formula incomplete":"Formula not selected")+'</small></td>'+
   '<td><input type="number" min="0" step="0.1" inputmode="decimal" placeholder="g / bird / day" value="'+esc(grams)+'" data-intake="'+i+'" aria-label="Daily feed for week '+w.week+'">'+ref+'</td>'+
   '<td><input type="number" min="0" max="7" step="1" value="'+esc(source.days)+'" data-days="'+i+'" aria-label="Feeding days for week '+w.week+'"></td>'+
   '<td>'+(sourceMode==="batch"?fmt(w.birdsAtWeekStart):'<input type="number" min="0" step="1" value="'+fmt(model.birdCountByWeek[i]||0)+'" data-birds="'+i+'" aria-label="Birds in week '+w.week+'">')+'</td>'+
   '<td>'+(w.weeklyIntakePerBirdKg==null?"Incomplete":kg(w.weeklyIntakePerBirdKg))+'</td><td>'+(w.totalFeedKg==null?"Incomplete":kg(w.totalFeedKg))+'</td><td>'+(w.totalFeedCost==null?"Incomplete":price(w.totalFeedCost))+'</td>'+
   '<td><span class="bwi-pill '+(status==="Calculated"?"is-good":"is-pending")+'">'+status+'</span></td></tr>';
 }).join("");
}
function renderFormula(){
 const stage=model.stages.find(s=>s.id===formulaStage),formula=result?.formulas.find(f=>f.stageId===formulaStage);if(!stage||!formula)return;
 $("#bwiStage").value=formulaStage;
 $("#bwiFormulaTotals").innerHTML='<span>Mix weight <strong>'+fmt(formula.totalMixKg)+' kg</strong></span><span>Mix cost <strong>'+price(formula.totalMixCost)+'</strong></span><span>Cost/kg <strong>'+price(formula.costPerKg)+'</strong></span><span>Entry status <strong>'+(formula.entriesComplete?(formula.complete?"Confirmed":"Needs confirmation"):"Missing ingredient rows")+'</strong></span>';
 $("#bwiIngredients").innerHTML=formula.entries.map(x=>{
  const item=model.ingredients.find(i=>i.id===x.ingredientId),raw=item.inclusionKg?.[formulaStage],entered=raw!==null&&raw!==undefined&&raw!=="";
  return '<tr><td><strong>'+esc(x.name)+'</strong><small>Excel row '+x.excelRow+'</small></td><td><input type="number" min="0" step="any" value="'+(entered?esc(raw):'')+'" placeholder="Enter kg or 0" data-mix="'+esc(x.ingredientId)+'" aria-label="'+esc(x.name)+' mix kg"></td><td>'+(formula.totalMixKg?fmt(x.inclusionKg/formula.totalMixKg*100)+'%':'—')+'</td><td><input type="number" min="0" step="any" value="'+esc(x.pricePerKg)+'" data-price="'+esc(x.ingredientId)+'" aria-label="'+esc(x.name)+' price per kg"></td><td>'+money(x.lineCost)+'</td><td>'+(entered?"Entered":"Missing — confirm 0 or quantity")+'</td></tr>';
 }).join("");
 const complete=formula.complete&&stage.status!=="incomplete";$("#bwiActivateStage").disabled=complete;
 $("#bwiStageStatus").textContent=complete?"Formulation complete":"Formulation not yet verified";
 $("#bwiStageStatus").classList.toggle("is-good",complete);
}
function renderNeeds(){
 const body=$("#bwiIngredientNeeds");if(!body||!result)return;const rows=[];
 result.weeks.forEach(w=>{if(!w.totalFeedKg||!w.formulaComplete)return;w.ingredientRows.forEach(x=>rows.push('<tr><td>Week '+w.week+'</td><td>'+esc(x.name)+'</td><td>'+fmt(x.quantityKg)+' kg</td><td>'+money(x.totalCost)+'</td></tr>'));});
 body.innerHTML=rows.length?rows.join(""):'<tr><td colspan="4">No ingredient quantities are available. Enter daily feed and complete the relevant formulation first.</td></tr>';
}
function renderWarnings(){
 const warnings=[...(result?.warnings||[])],batch=activeBatch();
 if(!batch&&sourceMode==="batch")warnings.unshift("Select a Broiler batch to calculate flock totals, or switch to manual bird counts.");
 if(batch&&Number(batch.initialBirds)>0){
  const records=Array.isArray(batch.records)?batch.records:[];
  const mortality=records.filter(r=>r.type==="mortality").reduce((s,r)=>s+Number(r.quantity||0),0),sold=records.filter(r=>r.type==="sale").reduce((s,r)=>s+Number(r.quantity||0),0);
  if(mortality+sold>Number(batch.initialBirds))warnings.unshift("Recorded mortality and sales exceed birds placed. Check flock records.");
 }
 if(!modelReady)warnings.push("Changes have not yet been saved to your farm account.");
 if(!warnings.length)warnings.push("No calculation warnings. Verify ingredient specifications and daily feed observations against farm records.");
 $("#bwiWarnings").innerHTML=warnings.map(w=>"<p>"+esc(w)+"</p>").join("");
}
function render(){
 if(!$("#feedTab-daily-plan"))return;
 try{
  const state=calculate(),r=state.result;renderWeeks();renderFormula();renderNeeds();
  const perBirdComplete=r.weeks.every(w=>w.weeklyIntakePerBirdKg!==null);
  const plannedPerBird=perBirdComplete?r.weeks.reduce((s,w)=>s+w.weeklyIntakePerBirdKg,0):null;
  $("#bwiKpiBird").textContent=kg(plannedPerBird);$("#bwiKpiFeed").textContent=kg(r.totals.feedKg);
  $("#bwiKpiCost").textContent=price(r.totals.feedCost);$("#bwiKpiUnitCost").textContent=price(r.totals.averageFeedCostPerKg);
  $("#bwiPlanLength").value=model.weeklySchedule.length+" weeks";
  $("#bwiBatchName").value=state.batch?(state.batch.name||"Broiler batch")+" · "+fmt(state.batch.initialBirds)+" placed":sourceMode==="manual"?"Manual bird counts":"Select a Broiler batch";
  $("#bwiBirdSource").value=sourceMode;$("#bwiAddWeek").disabled=model.weeklySchedule.length>=MAX_WEEKS;renderWarnings();
 }catch(error){setMessage(error.message,"error");}
}
function setMessage(message,kind="success"){const el=$("#bwiMsg");el.textContent=message;el.dataset.kind=kind;}
function updateWeek(target){
 const i=Number(target.dataset.intake??target.dataset.days??target.dataset.birds??target.dataset.weekStage),w=model.weeklySchedule[i];if(!w)return;
 if(target.dataset.intake!==undefined){const raw=target.value.trim();if(raw!==""&&(!Number.isFinite(Number(raw))||Number(raw)<0))throw new Error("Daily feed per bird must be a non-negative number in grams.");w.dailyKgPerBird=raw===""?null:Number(raw)/1000;}
 else if(target.dataset.days!==undefined){const n=Number(target.value);if(!Number.isInteger(n)||n<0||n>7)throw new Error("Feeding days must be a whole number from 0 to 7.");w.days=n;}
 else if(target.dataset.birds!==undefined){const n=Number(target.value);if(!Number.isInteger(n)||n<0)throw new Error("Bird count must be a whole number of zero or more.");model.birdCountByWeek[i]=n;}
 else if(target.dataset.weekStage!==undefined){w.formulaStageId=target.value||null;w.formulaStageConfirmed=!!target.value;}
}
function updateFormula(target){
 const item=model.ingredients.find(x=>x.id===(target.dataset.mix||target.dataset.price));if(!item)return;
 if(target.dataset.mix!==undefined){const raw=target.value.trim();if(raw!==""&&(!Number.isFinite(Number(raw))||Number(raw)<0))throw new Error("Ingredient quantity must be a non-negative number.");item.inclusionKg[formulaStage]=raw===""?null:Number(raw);
  const stage=model.stages.find(s=>s.id===formulaStage);
  if(stage)stage.status="unverified";
 }else{const n=Number(target.value);if(!Number.isFinite(n)||n<0)throw new Error("Ingredient price must be a non-negative amount.");item.pricePerKg=n;}
}
function addWeek(){
 if(model.weeklySchedule.length>=MAX_WEEKS)return;
 const n=model.weeklySchedule.length+1;model.weeklySchedule.push({week:n,dailyKgPerBird:null,sourceReferenceKgPerBird:null,days:7,formulaStageId:null,sourceFormulaStageId:null,formulaStageConfirmed:false});model.birdCountByWeek.push(0);
 setMessage("Week "+n+" added. Enter its daily feed allowance and select a verified formulation.");render();
}
function confirmStage(){
 const stage=model.stages.find(s=>s.id===formulaStage),formula=E.calculateFormula(model,formulaStage);if(!stage)return;
 if(!formula.entriesComplete){setMessage("This formulation still has blank ingredient quantities. Enter the actual quantity or 0 for every row before confirming.","error");return;}
 stage.status="active";setMessage(stage.label+" ("+stage.ageRange+") confirmed. Verify ingredient specifications and nutrient suitability before using this ration.");render();
}
async function load(){
 if(busy)return;busy=true;
 try{
  await window.FratelCloud?.ready?.();const saved=await window.FratelCloud?.loadBroilerWorkbookModel?.();
  if(saved?.modelData){model=migrateModel(saved.modelData);modelReady=true;setMessage("Saved Broiler feed plan loaded from your farm account.");}
  else{model=E.createDefaultModel();modelReady=false;setMessage("Workbook reference values loaded. Enter daily feed allowances and confirm the saved plan to keep changes in your farm account.");}
 }catch(error){model=E.createDefaultModel();modelReady=false;setMessage("Saved feed plan could not load: "+error.message+". Review entries; cloud saving must be restored.","error");}
 finally{busy=false;fillStageChoices();render();document.dispatchEvent(new Event("fratel:workbook-model-ready"));}
}
async function save(){
 const validation=E.validateModel(model);if(!validation.valid){setMessage(validation.errors.join(" "),"error");return;}
 try{
  if(!window.FratelCloud||typeof window.FratelCloud.saveBroilerWorkbookModel!=="function")throw new Error("Authenticated farm cloud storage is unavailable.");
  await window.FratelCloud.saveBroilerWorkbookModel(model,E.MODEL_VERSION);
  modelReady=true;setMessage("Feed plan saved to your authenticated farm account.");renderWarnings();
 }catch(error){setMessage("Feed plan could not be saved: "+error.message,"error");}
}
function useBatch(){if(!activeBatch()){setMessage("Create or select a Broiler batch first.","error");return;}sourceMode="batch";render();setMessage("Flock totals follow the selected batch and recorded additions, sales and mortality.");}
function forecast(batchId,daysAhead){
 const batch=(window.FratelAgriPredictDashboard?.getBatches?.()||[]).find(b=>String(b.id)===String(batchId));if(!batch)throw new Error("Select a valid Broiler batch.");
 const requestedDays=Number(daysAhead);if(!Number.isInteger(requestedDays)||requestedDays<1||requestedDays>MAX_WEEKS*7)throw new Error("Forecast period must be 1–140 days; add the required weeks to the daily feed plan.");
 const schedule=E.buildFlockScheduleFromBatch(model,batch),calc=E.calculate(schedule.model,{flockEvents:schedule.flockEvents});
 const age=window.AgriPredictFeed?.batchAge?.(batch);if(!Number.isInteger(age)||age<0)throw new Error("Could not establish batch age from its placement date.");
 const targetAge=Number(batch.targetAgeDays);
 if(!Number.isInteger(targetAge)||targetAge<1)throw new Error("Set a valid target harvest age in the Broiler batch setup before forecasting feed.");
 const remaining=Math.max(0,targetAge-age),days=Math.min(requestedDays,remaining);
 if(days<1)throw new Error("The batch has reached its target harvest age. Check the batch target or create a new feeding plan.");
 let total=0,cost=0,costComplete=true;const dailyRows=[];
 for(let offset=0;offset<days;offset++){
  const dayIndex=age+offset,wi=Math.floor(dayIndex/7),di=dayIndex%7,w=calc.weeks[wi],planned=model.weeklySchedule[wi];
  if(!w||!planned)throw new Error("Week "+(wi+1)+" is not in the feed plan. Add that week first.");
  if(planned.dailyKgPerBird==null)throw new Error("Daily feed per bird is missing for Week "+(wi+1)+".");
  if(di>=w.dailyRows.length)throw new Error("Week "+(wi+1)+" has no feeding entry for Day "+(di+1)+".");
  const row=w.dailyRows[di],feed=planned.dailyKgPerBird*row.birds;total+=feed;
  if(w.costPerKg==null)costComplete=false;else cost+=feed*w.costPerKg;
  dailyRows.push({day:dayIndex+1,birds:row.birds,feedKg:feed});
 }
 return{batch:batch.name,currentAge:age,forecastDays:days,projectedBirds:dailyRows[0]?.birds??0,projectedFeedRequirement:total,estimatedFeedCost:costComplete?cost:null,dailyRows,note:costComplete?"Calculated from saved daily allowances and confirmed formulas.":"Feed quantity calculated. Cost is incomplete because one or more required formulas are incomplete."};
}
function bind(){
 const page=$("#feedView");if(!page||page.dataset.bwiBound)return;page.dataset.bwiBound="true";
 page.addEventListener("click",e=>{if(e.target.closest("#bwiAddWeek"))addWeek();if(e.target.closest("#bwiSave"))save();if(e.target.closest("#bwiUseBatch"))useBatch();if(e.target.closest("#bwiActivateStage"))confirmStage();});
 page.addEventListener("change",e=>{
  const t=e.target;
  if(t.id==="bwiStage"){formulaStage=t.value;render();return;}
  if(t.id==="bwiBirdSource"){sourceMode=t.value;render();return;}
  try{
   if(t.matches("[data-intake],[data-days],[data-birds],[data-week-stage]")){updateWeek(t);render();setMessage("Feed totals recalculated. Save the plan to keep these changes.");}
   else if(t.matches("[data-mix],[data-price]")){updateFormula(t);render();setMessage("Formulation recalculated. Save the plan to keep these changes.");}
   else if(t.id==="batchSelect")render();
  }catch(error){setMessage(error.message,"error");render();}
 });
 document.addEventListener("change",event=>{if(event.target?.id==="batchSelect")render();});
 document.addEventListener("agripredict:broiler-data-updated",render);
 document.addEventListener("fratel:workbook-model-ready",render);
}
function init(){mount();bind();load();document.addEventListener("click",e=>{if(e.target.closest('[data-view="feed"]'))setTimeout(render,0);});}
window.FratelBroilerWorkbookUI=Object.freeze({getModel:()=>JSON.parse(JSON.stringify(model)),calculate:()=>result,refresh:render,isReady:()=>modelReady,forecast});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();