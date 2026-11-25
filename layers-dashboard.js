/* Fratel-AgriPredict Layers Enterprise
 * Farmer-owned records are stored in Supabase row public.layer_enterprise_data.
 * Browser code uses only the public publishable key from supabase-config.js.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const uid = () => globalThis.crypto?.randomUUID?.() || `layer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const money = (v) => `UGX ${Math.round(num(v)).toLocaleString('en-UG')}`;
  const kg = (v) => `${num(v).toLocaleString('en-UG',{maximumFractionDigits:2})} kg`;
  const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const dateObj = (s) => { const [y,m,d]=String(s||'').slice(0,10).split('-').map(Number); return y&&m&&d?new Date(y,m-1,d):null; };
  const isoPlusDays = (s,days) => { const d=dateObj(s)||new Date(); d.setDate(d.getDate()+Math.round(days)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const dayDiff = (a,b) => { const x=dateObj(a),y=dateObj(b); if(!x||!y)return 0; return Math.floor((Date.UTC(y.getFullYear(),y.getMonth(),y.getDate())-Date.UTC(x.getFullYear(),x.getMonth(),x.getDate()))/86400000); };
  const fmtDate = (s) => { const d=dateObj(s); return d?new Intl.DateTimeFormat('en-UG',{day:'2-digit',month:'short',year:'numeric'}).format(d):'—'; };
  const esc = (v) => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STAGES = [
    {id:'rearing',name:'Rearing',range:'0–8 weeks',start:0,end:56,detail:'Brooding and early growth'},
    {id:'pullet',name:'Pullet',range:'8–17 weeks',start:56,end:119,detail:'Frame and body development'},
    {id:'prelay',name:'Pre-lay',range:'17–20 weeks',start:119,end:140,detail:'Transition and sexual maturity'},
    {id:'laying1',name:'Laying 1',range:'20–45 weeks',start:140,end:315,detail:'Early and peak production'},
    {id:'laying2',name:'Laying 2',range:'45+ weeks',start:315,end:Infinity,detail:'Persistency and later lay'}
  ];
  const STAGE_WEIGHT = {production:30,survival:25,feed:20,water:10,management:15};
  const STAGE_LABELS = {production:'Production / growth',survival:'Health & survival',feed:'Feed management',water:'Water management',management:'Farm management'};
  const BLANK = () => ({version:1,batches:[],formulas:[],purchases:[],production:[],feedConsumption:[],events:[],expenses:[],stageTargets:{},updatedAt:null});
  let state=BLANK(), user=null, client=null, saveTimer=null, saving=false, formulaDraft=[];

  function setNotice(message,type='success') { const el=$('notice'); el.textContent=message; el.className=`notice visible${type==='error'?' error':''}`; }
  function clearNotice(){ $('notice').className='notice'; $('notice').textContent=''; }
  function setSync(label,isError=false){ $('syncStatus').textContent=label; $('syncStatus').style.color=isError?'#b34141':'#176b43'; }
  function cleanState(data){ const out=BLANK(); if(!data||typeof data!=='object')return out; for(const key of Object.keys(out)){ if(key==='stageTargets')out[key]=data[key]&&typeof data[key]==='object'?data[key]:{}; else if(Array.isArray(out[key]))out[key]=Array.isArray(data[key])?data[key]:[]; else if(key==='version')out.version=Number(data.version)||1; else out[key]=data[key]??out[key]; } return out; }
  async function loadCloud(){
    const {data,error}=await client.from('layer_enterprise_data').select('data').eq('farmer_id',user.id).maybeSingle();
    if(error) throw new Error(`Could not load Layers records: ${error.message}. Run layers-dashboard.sql in Supabase first.`);
    state=cleanState(data?.data);
  }
  async function saveCloud(){
    if(!client||!user)return;
    saving=true; setSync('Saving…');
    try{
      state.updatedAt=new Date().toISOString();
      const {error}=await client.from('layer_enterprise_data').upsert({farmer_id:user.id,data:state,updated_at:new Date().toISOString()},{onConflict:'farmer_id'});
      if(error)throw error;
      setSync('● Saved to cloud');
    }catch(error){ console.error(error); setSync('Save failed',true); setNotice(error.message||'Could not save records to Supabase.','error'); }
    finally{saving=false;}
  }
  function scheduleSave(){ clearTimeout(saveTimer); setSync('Changes pending…'); saveTimer=setTimeout(saveCloud,450); }
  async function forceSave(){ clearTimeout(saveTimer); await saveCloud(); }
  function changed(message){ scheduleSave(); renderAll(); if(message)setNotice(message); }

  function getBatch(id){ return state.batches.find(x=>x.id===id)||null; }
  function ageDays(batch,date=today()){ return Math.max(0,num(batch.arrivalAgeDays)+dayDiff(batch.arrivalDate,date)); }
  function stageForAge(days){ return STAGES.find(s=>days>=s.start&&days<s.end)||STAGES[4]; }
  function liveBirds(batch,date=today()){
    const additions=state.events.filter(e=>e.batchId===batch.id&&e.type==='addition'&&e.date<=date).reduce((s,e)=>s+num(e.quantity),0);
    const deaths=state.events.filter(e=>e.batchId===batch.id&&e.type==='mortality'&&e.date<=date).reduce((s,e)=>s+num(e.quantity),0);
    const sold=state.events.filter(e=>e.batchId===batch.id&&e.type==='sale'&&e.date<=date).reduce((s,e)=>s+num(e.quantity),0);
    return Math.max(0,num(batch.initialBirds)+additions-deaths-sold);
  }
  function mortalityTotal(batch,date=today()){ return state.events.filter(e=>e.batchId===batch.id&&e.type==='mortality'&&e.date<=date).reduce((s,e)=>s+num(e.quantity),0); }
  function saleIncome(batchId=null){ return state.events.filter(e=>e.type==='sale'&&(!batchId||e.batchId===batchId)).reduce((s,e)=>s+num(e.amount),0); }
  function allCashOutflows(){
    const rows=[];
    state.batches.forEach(b=>{ const cost=num(b.initialBirds)*num(b.birdCost); if(cost>0)rows.push({date:b.arrivalDate,category:'Bird purchase',description:`${b.name} · opening birds`,amount:cost,source:'Batch setup'}); });
    state.events.filter(e=>e.type==='addition').forEach(e=>{if(num(e.amount)>0)rows.push({date:e.date,category:'Bird purchase',description:e.description||'Additional birds',amount:num(e.amount),source:'Farm record'});});
    state.purchases.forEach(p=>rows.push({date:p.date,category:'Feed ingredients',description:`${p.ingredient} · ${kg(p.quantityKg)}`,amount:num(p.quantityKg)*num(p.unitCost),source:'Ingredient purchase'}));
    state.expenses.forEach(e=>rows.push({date:e.date,category:e.category,description:e.description,amount:num(e.amount),source:'Other expense'}));
    return rows.filter(x=>x.date&&x.amount>0).sort((a,b)=>b.date.localeCompare(a.date));
  }
  function expensesByWindow(start,end=today()){ return allCashOutflows().filter(x=>x.date>=start&&x.date<=end); }
  function sum(arr,fn=x=>x){ return arr.reduce((s,x)=>s+num(fn(x)),0); }

  function rawInventory(){
    const names=new Map();
    state.purchases.forEach(p=>{ const k=String(p.ingredient||'').trim().toLowerCase(); if(!k)return; const r=names.get(k)||{name:p.ingredient,quantity:0,value:0}; r.quantity+=num(p.quantityKg); r.value+=num(p.quantityKg)*num(p.unitCost); names.set(k,r); });
    state.production.forEach(prod=>(prod.inputs||[]).forEach(i=>{const k=String(i.ingredient||'').trim().toLowerCase(); const r=names.get(k); if(r){r.quantity-=num(i.quantityKg);r.value-=num(i.quantityKg)*num(i.unitCost);} }));
    return [...names.values()].map(r=>{r.quantity=Math.max(0,r.quantity);r.value=Math.max(0,r.value);r.costPerKg=r.quantity>0?r.value/r.quantity:0;r.stockValue=r.quantity*r.costPerKg;return r;}).sort((a,b)=>a.name.localeCompare(b.name));
  }
  function finishedStock(){
    return state.production.map(p=>{const used=state.feedConsumption.filter(c=>c.productionId===p.id).reduce((s,c)=>s+num(c.quantityKg),0);return {...p,availableKg:Math.max(0,num(p.quantityKg)-used),usedKg:used};});
  }
  function finishedAverageCost(){ const lots=finishedStock().filter(x=>x.availableKg>0); const qty=sum(lots,x=>x.availableKg); return qty>0?sum(lots,x=>x.availableKg*x.costPerKg)/qty:0; }
  function formulaForStage(stage){ return state.formulas.filter(f=>f.stage===stage).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]||null; }
  function formulaCost(formula){ return num(formula?.costPerKg); }
  function rawAvailable(name){ return rawInventory().find(x=>x.name.toLowerCase()===name.toLowerCase())?.quantity||0; }
  function rawCost(name){ return rawInventory().find(x=>x.name.toLowerCase()===name.toLowerCase())?.costPerKg||0; }
  // Daily intake is measured from actual feed consumed by the flock, not from
  // the quantity produced by a recipe or a generic age-based allowance.
  // Multiple lots recorded on the same date are combined before averaging.
  function feedIntakeProfile(rows,batch,source){
    const byDate=new Map();
    rows.forEach(r=>byDate.set(r.date,(byDate.get(r.date)||0)+num(r.quantityKg)));
    const daily=[...byDate.entries()].sort((a,b)=>b[0].localeCompare(a[0])).slice(0,7);
    const perBird=daily.map(([date,qty])=>{const birds=liveBirds(batch,date);return birds>0?qty*1000/birds:null;}).filter(v=>v!==null&&v>=0);
    const grams=perBird.length?sum(perBird)/perBird.length:0;
    return {grams,observations:perBird.length,dailyKg:grams/1000*liveBirds(batch),source};
  }
  function averageDailyFeedRate(rows,batch){ return feedIntakeProfile(rows,batch,'recorded intake').grams; }
  function recentIntakeProfile(batch){
    const records=state.feedConsumption.filter(c=>c.batchId===batch.id&&c.kind==='consumption'&&c.date>=isoPlusDays(today(),-30)&&c.date<=today());
    return feedIntakeProfile(records,batch,records.length?'recent actual flock intake':'no actual feed-intake records');
  }
  function stageRate(stageId,batchId){
    const batch=getBatch(batchId);
    if(!batch)return {grams:0,observations:0,dailyKg:0,source:'batch unavailable'};
    const records=state.feedConsumption.filter(c=>c.batchId===batchId&&c.kind==='consumption'&&c.date>=isoPlusDays(today(),-30)&&c.date<=today());
    const stageRows=records.filter(c=>stageForAge(ageDays(batch,c.date)).id===stageId);
    if(stageRows.length)return feedIntakeProfile(stageRows,batch,`actual intake recorded in ${STAGES.find(x=>x.id===stageId)?.name||stageId}`);
    if(records.length)return feedIntakeProfile(records,batch,'latest recorded daily intake carried forward; no intake record yet for this future stage');
    return {grams:0,observations:0,dailyKg:0,source:'record daily feed intake to enable forecasting'};
  }
  function stageRateDefaultFor(batch,stageId){ return stageRate(stageId,batch.id); }
  function feedUnitCost(stageId){
    const selectedId=state.stageTargets?.[stageId]?.formulaId;
    const selected=selectedId?state.formulas.find(f=>f.id===selectedId&&f.stage===stageId):null;
    const stageFormula=selected||formulaForStage(stageId);
    if(!stageFormula)return {cost:0,formula:null,source:'No formula for stage'};
    const lots=finishedStock().filter(p=>p.formulaId===stageFormula.id&&p.availableKg>0);
    if(lots.length){const q=sum(lots,x=>x.availableKg);return {cost:sum(lots,x=>x.availableKg*x.costPerKg)/q,formula:stageFormula,source:'weighted cost of available production lots'};}
    return {cost:formulaCost(stageFormula),formula:stageFormula,source:'current formula ingredient prices; production not yet recorded'};
  }
  function estimateRecurringDaily(batch=null){
    const latest=new Map();
    state.expenses.filter(e=>e.recurring==='weekly'||e.recurring==='monthly').forEach(e=>{const key=[e.category,e.description,e.batchId||'shared',e.recurring].join('|');const old=latest.get(key);if(!old||e.date>old.date)latest.set(key,e);});
    const rows=[...latest.values()].filter(e=>{const age=dayDiff(e.date,today());return e.recurring==='weekly'?age<=14:age<=60;});
    if(!batch)return sum(rows,e=>num(e.amount)/(e.recurring==='weekly'?7:30));
    const allBirds=sum(state.batches,b=>liveBirds(b));const share=allBirds>0?liveBirds(batch)/allBirds:0;
    return sum(rows.filter(e=>e.batchId===batch.id||!e.batchId),e=>(num(e.amount)/(e.recurring==='weekly'?7:30))*(e.batchId===batch.id?1:share));
  }
  function periodDays(amount,unit){ return Math.max(1,Math.round(num(amount)*(unit==='weeks'?7:unit==='months'?30:unit==='years'?365:1))); }

  function forecastBatch(batch,days){
    const birds=liveBirds(batch),harvest=batch.harvestDate||isoPlusDays(batch.arrivalDate,730),daysToEnd=Math.max(0,dayDiff(today(),harvest));
    const selectedDays=Math.min(days,Math.max(0,daysToEnd));
    let feedKg=0,feedCost=0; const intakeMissing=[],costMissing=[],byStage={},requiredByFormula={};
    for(let d=1;d<=selectedDays;d++){
      const stage=stageForAge(ageDays(batch)+d-1); const rate=stageRateDefaultFor(batch,stage.id); const unit=feedUnitCost(stage.id);
      if(rate.grams<=0){
        if(!intakeMissing.includes(stage.name))intakeMissing.push(stage.name);
        continue;
      }
      // Observed intake is expressed per live bird/day, then scaled to the
      // current surviving flock. Future deaths/sales are never guessed.
      const dayKg=birds*rate.grams/1000;
      feedKg+=dayKg;
      byStage[stage.id]??={kg:0,cost:0,rate:rate.grams,observations:rate.observations,rateSource:rate.source,formula:unit.formula?.name||'—',formulaId:unit.formula?.id||null,costAvailable:unit.cost>0};
      byStage[stage.id].kg+=dayKg;
      if(unit.cost<=0||!unit.formula){
        if(!costMissing.includes(stage.name))costMissing.push(stage.name);
        byStage[stage.id].costAvailable=false;
        continue;
      }
      const dayCost=dayKg*unit.cost;
      feedCost+=dayCost; byStage[stage.id].cost+=dayCost;
      if(unit.formula?.id)requiredByFormula[unit.formula.id]=(requiredByFormula[unit.formula.id]||0)+dayKg;
    }
    const stockByFormula={}; finishedStock().forEach(lot=>{stockByFormula[lot.formulaId]=(stockByFormula[lot.formulaId]||0)+lot.availableKg;});
    const additionalFeedToProduce=(intakeMissing.length||costMissing.length)?null:sum(Object.entries(requiredByFormula),([id,qty])=>Math.max(0,qty-(stockByFormula[id]||0)));
    const otherCost=estimateRecurringDaily(batch)*selectedDays;
    const currentRate=stageRateDefaultFor(batch,stageForAge(ageDays(batch)).id);
    return {days,selectedDays,daysToEnd,birds,feedKg,feedCost,otherCost,total:feedCost+otherCost,byStage,intakeMissing,costMissing,harvest,assumption:'recent actual daily feed intake per live bird, scaled to the current flock; future bird numbers held constant',cutOff:selectedDays<days,dailyFeedKg:currentRate.dailyKg,dailyIntakeGrams:currentRate.grams,intakeObservations:currentRate.observations,intakeSource:currentRate.source,additionalFeedToProduce};
  }

  function expenseShareForBatch(expense,batch,date){
    if(expense.batchId)return expense.batchId===batch.id?num(expense.amount):0;
    const allBirds=sum(state.batches,b=>liveBirds(b,date)); if(allBirds<=0)return 0;
    return num(expense.amount)*liveBirds(batch,date)/allBirds;
  }
  function batchCostToDate(batch,date){
    let cost=0;
    if(batch.arrivalDate<=date)cost+=num(batch.initialBirds)*num(batch.birdCost);
    const additions=state.events.filter(e=>e.batchId===batch.id&&e.type==='addition'&&e.date<=date);
    additions.forEach(e=>cost+=num(e.amount));
    state.feedConsumption.filter(c=>c.batchId===batch.id&&c.kind==='consumption'&&c.date<=date).forEach(c=>cost+=num(c.quantityKg)*num(c.costPerKg));
    state.expenses.filter(e=>e.date<=date).forEach(e=>cost+=expenseShareForBatch(e,batch,date));
    const deaths=mortalityTotal(batch,date); const saleableBirds=Math.max(0,num(batch.initialBirds)+sum(additions,e=>e.quantity)-deaths);
    const alive=liveBirds(batch,date);
    // Mortality losses are distributed over birds that survive or have been sold;
    // a sale does not shift the sold birds' historic cost onto the remaining flock.
    return {cost,alive,saleableBirds,costPerBird:saleableBirds>0?cost/saleableBirds:0};
  }
  function estimateBirdCost(batch,targetAge){
    const elapsed=targetAge-num(batch.arrivalAgeDays); const targetDate=isoPlusDays(batch.arrivalDate,elapsed); const currentAge=ageDays(batch);
    if(batch.harvestDate&&targetDate>batch.harvestDate)return {error:"Selected age is later than the batch expected end date. Change the batch date before projecting beyond it."};
    if(targetAge<num(batch.arrivalAgeDays))return {error:'The farmer did not own this batch at the requested age, so earlier costs are not available.'};
    if(targetAge<=currentAge){const hist=batchCostToDate(batch,targetDate);return {...hist,age:targetAge,date:targetDate,future:false};}
    const current=batchCostToDate(batch,today()); const extraDays=targetAge-currentAge;
    const projection=forecastBatch(batch,extraDays);
    if(projection.intakeMissing.length||projection.costMissing.length)return {error:`Record actual daily feed intake and select a formula with a recorded cost/kg for: ${[...new Set([...projection.intakeMissing,...projection.costMissing])].join(', ')} before estimating this future age.`};
    const futureOther=estimateRecurringDaily(batch)*extraDays;
    const futureCost=projection.feedCost+futureOther;
    const alive=current.alive;
    if(alive<=0)return {error:'No live birds remain in this batch to value at a future age.'};
    return {cost:current.cost+futureCost,alive,costPerBird:current.costPerBird+futureCost/alive,age:targetAge,date:targetDate,future:true,additionalCost:futureCost};
  }

  function lastWeight(batch){ return state.events.filter(e=>e.batchId===batch.id&&e.type==='weight').sort((a,b)=>b.date.localeCompare(a.date))[0]||null; }
  function getScore(batch){
    const components=[];
    const age=ageDays(batch), stage=stageForAge(age), alive=liveBirds(batch), opening=num(batch.initialBirds)+sum(state.events.filter(e=>e.batchId===batch.id&&e.type==='addition'&&e.date<=today()),e=>e.quantity); const deaths=mortalityTotal(batch); const survivingOfPlaced=Math.max(0,opening-deaths);
    // The score is a weighted, evidence-based diagnostic, not an official certification.
    let production=null,productionNote='';
    if(stage.id==='laying1'||stage.id==='laying2'){
      const eggs=state.events.filter(e=>e.batchId===batch.id&&e.type==='eggs'&&e.date>=isoPlusDays(today(),-7)&&e.date<=today());
      const target=num(state.stageTargets?.[stage.id]?.targetEggRate)||num(batch.targetEggRate);
      if(eggs.length&&target>0&&alive>0){ const byDay=new Map(); eggs.forEach(e=>byDay.set(e.date,(byDay.get(e.date)||0)+num(e.quantity))); const dailyRates=[...byDay].map(([date,count])=>count/Math.max(1,liveBirds(batch,date))*100); const observed=sum(dailyRates)/dailyRates.length; production=Math.max(0,Math.min(100,100-Math.abs(observed-target)/target*100)); productionNote=`Hen-day estimate ${observed.toFixed(1)}% vs ${target}% target`; }
    }else{
      const w=lastWeight(batch),target=num(state.stageTargets?.[stage.id]?.targetWeightG);
      if(w&&target>0){const actual=num(w.extra);production=Math.max(0,Math.min(100,100-Math.abs(actual-target)/target*100));productionNote=`Latest sample ${actual} g vs ${target} g target`;}
    }
    if(production!==null)components.push({key:'production',value:production,note:productionNote});
    const mortalityChecks=state.events.filter(e=>e.batchId===batch.id&&e.type==='mortality'&&e.date>=isoPlusDays(today(),-30)&&e.date<=today());
    if(opening>0&&mortalityChecks.length)components.push({key:'survival',value:Math.max(0,Math.min(100,(survivingOfPlaced/opening)*100)),note:`${survivingOfPlaced.toLocaleString('en-UG')} birds surviving mortality from ${opening.toLocaleString('en-UG')} placed/additional birds; sales are excluded`});
    const recentFeed=state.feedConsumption.filter(c=>c.batchId===batch.id&&c.kind==='consumption'&&c.date>=isoPlusDays(today(),-14)&&c.date<=today());
    const targetFeed=num(state.stageTargets?.[stage.id]?.gramsPerBirdDay);
    if(new Set(recentFeed.map(r=>r.date)).size>=3&&targetFeed>0){const observed=averageDailyFeedRate(recentFeed,batch);const score=Math.max(0,Math.min(100,100-Math.abs(observed-targetFeed)/targetFeed*100));components.push({key:'feed',value:score,note:`${observed.toFixed(1)} g/bird/day vs ${targetFeed} g target`});}
    const water=state.events.filter(e=>e.batchId===batch.id&&e.type==='water'&&e.date>=isoPlusDays(today(),-7)&&e.date<=today());
    const targetWater=num(batch.targetWaterMl);
    if(new Set(water.map(r=>r.date)).size>=3&&targetWater>0&&alive>0){const byDay=new Map();water.forEach(e=>byDay.set(e.date,(byDay.get(e.date)||0)+num(e.quantity)));const dailyRates=[...byDay].map(([date,litres])=>litres*1000/Math.max(1,liveBirds(batch,date)));const observed=sum(dailyRates)/dailyRates.length;const score=Math.max(0,Math.min(100,100-Math.abs(observed-targetWater)/targetWater*100));components.push({key:'water',value:score,note:`${observed.toFixed(0)} ml/bird/day vs ${targetWater} ml target`});}
    const checks=state.events.filter(e=>e.batchId===batch.id&&e.type==='management'&&e.date>=isoPlusDays(today(),-30)&&e.date<=today());
    if(checks.length)components.push({key:'management',value:sum(checks,e=>e.status==='pass'?1:0)/checks.length*100,note:`${checks.length} recorded management checks in the last 30 days`});
    const weightTotal=sum(components,c=>STAGE_WEIGHT[c.key]);
    const coverage=weightTotal;
    const score=coverage>=60?sum(components,c=>c.value*STAGE_WEIGHT[c.key])/weightTotal:null;
    return {score,coverage,components,stage};
  }
  function getFarmScore(){
    const rows=state.batches.map(b=>({batch:b,live:liveBirds(b),score:getScore(b)})).filter(x=>x.live>0);
    const totalLive=sum(rows,x=>x.live); if(!totalLive)return null;
    const coverage=sum(rows,x=>x.score.coverage*x.live)/totalLive;
    const keys=['production','survival','feed','water','management'];
    const components=keys.map(key=>{const available=rows.filter(x=>x.score.components.some(c=>c.key===key));if(!available.length)return null;const live=sum(available,x=>x.live);const value=sum(available,x=>x.score.components.find(c=>c.key===key).value*x.live)/live;return {key,value};}).filter(Boolean);
    const weight=sum(components,c=>STAGE_WEIGHT[c.key]);const score=coverage>=60&&weight>0?sum(components,c=>c.value*STAGE_WEIGHT[c.key])/weight:null;
    const stageSummary=[...new Set(rows.map(x=>x.score.stage.name))].join(', ');
    return {score,coverage,components,stageSummary};
  }

  function renderOverview(){
    const batches=state.batches; const active=batches[0]||null; const live=sum(batches,b=>liveBirds(b));
    const avail=sum(finishedStock(),p=>p.availableKg); const cash=allCashOutflows(); const total=sum(cash,e=>e.amount); const todaySpend=sum(cash.filter(e=>e.date===today()),e=>e.amount);
    $('metricLiveBirds').textContent=live.toLocaleString('en-UG'); $('metricBirdsNote').textContent=`Across ${batches.length} registered batch${batches.length===1?'':'es'}`;
    $('metricFeedAvailable').textContent=kg(avail); $('metricTodaySpend').textContent=money(todaySpend); $('metricTotalSpend').textContent=money(total);
    const intakeProfiles=batches.map(batch=>recentIntakeProfile(batch)).filter(profile=>profile.observations>0);
    const dailyFarmIntake=sum(intakeProfiles,profile=>profile.dailyKg);
    $('overviewDailyIntake').textContent=intakeProfiles.length?kg(dailyFarmIntake):'No records';
    $('overviewWeeklyNeed').textContent=intakeProfiles.length?kg(dailyFarmIntake*7):'—';
    $('overviewMonthlyNeed').textContent=intakeProfiles.length?kg(dailyFarmIntake*30):'—';
    const intakeDays=sum(intakeProfiles,profile=>profile.observations);
    $('overviewIntakeBasis').textContent=intakeProfiles.length?`${intakeProfiles.length} batch(es) · ${intakeDays} recorded batch-days`:'Record daily intake in Feed & Inventory';
    $('overviewIntakeNote').textContent=intakeProfiles.length?'Recent recorded intake is normalised per live bird and scaled to the current live flock. Weekly and 30-day values are planning estimates, not guaranteed consumption.':'No feed requirement is estimated until actual daily feed intake has been recorded.';
    const b=active; const score=getFarmScore();
    $('operatingScore').textContent=score?.score===null||!score?'—':`${Math.round(score.score)}%`;
    $('scoreRing').style.background=score?.score===null||!score?'conic-gradient(#eaf0ec 0deg,#eaf0ec 360deg)':`conic-gradient(#1b8a50 ${score.score*3.6}deg,#eaf0ec 0deg)`;
    $('scoreCoverage').textContent=`${score?.coverage||0}%`; $('coverageBar').style.width=`${score?.coverage||0}%`;
    $('operatingLabel').textContent=!score?'Awaiting records':score.score===null?'Insufficient evidence':score.score>=90?'Operating well':score.score>=75?'Needs attention':'Action required';
    $('operatingLabel').className=`tag ${score?.score===null?'warning':score?.score>=90?'good':'warning'}`;
    $('scoreExplanation').textContent=!b?'Create a batch and enter performance targets to calculate a farm operating score.':!score?'No live batch data is available.':score.score===null?'Not enough evidence is available yet. At least 60% of weighted indicators must have valid records before a score is displayed.':`Farm-wide weighted performance across these live batch stages: ${score.stageSummary}. Missing indicators are excluded and shown in data coverage.`;
    $('scoreBasis').textContent='Proposed Fratel-AgriPredict diagnostic; not an official breed certification.';
    $('scoreBreakdown').innerHTML=score?.components.length?score.components.map(c=>`<div class="score-item"><span>${esc(STAGE_LABELS[c.key])}</span><b>${Math.round(c.value)}%</b></div>`).join(''):'';
    $('activeBatchSummary').innerHTML=b?`<div class="stock-row"><span>${esc(b.name)}</span><b>${ageDays(b)} days · ${esc(stageForAge(ageDays(b)).name)}</b></div><div class="stock-row"><span>Birds alive</span><b>${liveBirds(b).toLocaleString('en-UG')}</b></div><div class="stock-row"><span>Expected harvest / end</span><b>${fmtDate(b.harvestDate||isoPlusDays(b.arrivalDate,730))}</b></div><div class="stock-row"><span>Capacity utilisation</span><b>${num(b.capacity)>0?`${(liveBirds(b)/num(b.capacity)*100).toFixed(1)}%`:'Not set'}</b></div>`:'No layer batch has been created yet.';
    const stocks=new Map(); finishedStock().forEach(p=>{const f=state.formulas.find(x=>x.id===p.formulaId);const name=f?.name||'Archived formula';stocks.set(name,(stocks.get(name)||0)+p.availableKg);});
    $('overviewFeedStock').innerHTML=stocks.size?[...stocks].map(([name,value])=>`<div class="stock-row"><span>${esc(name)}</span><b>${kg(value)}</b></div>`).join(''):'No finished feed production recorded.';
    $('recentActivity').innerHTML=recentActivity().slice(0,5).map(a=>`<div class="activity-row"><span class="activity-dot"></span><div class="activity-main"><strong>${esc(a.title)}</strong><small>${fmtDate(a.date)} · ${esc(a.subtitle||'Farm record')}</small></div></div>`).join('')||'No recent records.';
    const expCats=new Map(); cash.forEach(x=>expCats.set(x.category,(expCats.get(x.category)||0)+x.amount));
    $('overviewExpenseBreakdown').innerHTML=expCats.size?[...expCats].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,value])=>`<div class="expense-tile"><span>${esc(name)}</span><b>${money(value)}</b></div>`).join(''):'No expenditure has been recorded.';
  }
  function recentActivity(){
    const rows=[];
    state.events.forEach(e=>rows.push({date:e.date,title:e.type==='mortality'?'Mortality recorded':e.type==='sale'?'Bird sale recorded':e.type==='addition'?'Birds added':e.type==='eggs'?'Egg production recorded':e.type==='weight'?'Weight sample recorded':e.type==='water'?'Water use recorded':e.type==='management'?'Management check':'Health activity',subtitle:e.description||`${num(e.quantity)} ${e.type==='eggs'?'eggs':e.type==='weight'?'g':''}`}));
    state.expenses.forEach(e=>rows.push({date:e.date,title:`${e.category} expense`,subtitle:e.description}));
    state.purchases.forEach(e=>rows.push({date:e.date,title:'Feed ingredient purchased',subtitle:e.ingredient}));
    state.production.forEach(e=>rows.push({date:e.date,title:'Feed produced',subtitle:e.lotName}));
    state.feedConsumption.forEach(e=>rows.push({date:e.date,title:e.kind==='loss'?'Feed loss recorded':'Daily feed intake recorded',subtitle:kg(e.quantityKg)}));
    return rows.sort((a,b)=>b.date.localeCompare(a.date));
  }

  function renderBatches(){
    $('batchTable').innerHTML=state.batches.length?state.batches.map(b=>`<tr><td><b>${esc(b.name)}</b><small>${esc(b.house||'No house specified')} · ${esc(b.breed||'Breed not specified')}</small></td><td>${ageDays(b)} days</td><td><b>${liveBirds(b).toLocaleString('en-UG')}</b></td><td><span class="pill">${esc(stageForAge(ageDays(b)).name)}</span></td><td>${fmtDate(b.harvestDate||isoPlusDays(b.arrivalDate,730))}</td><td>${liveBirds(b)>0?'<span class="pill">Active</span>':'<span class="pill red">No live birds</span>'}</td></tr>`).join(''):'<tr><td colspan="6" class="empty-cell">No batches yet.</td></tr>';
  }
  function renderStageCards(){
    $('stageCards').innerHTML=STAGES.map(s=>{const count=state.formulas.filter(f=>f.stage===s.id).length;const target=num(state.stageTargets?.[s.id]?.gramsPerBirdDay);const formula=state.formulas.find(f=>f.id===state.stageTargets?.[s.id]?.formulaId)||formulaForStage(s.id);return `<div class="stage-card"><b>${s.name}</b><span>${s.range} · ${s.detail}</span><small>${count} formula${count===1?'':'s'} · ${target>0?`${target} g/bird/day reference`:'No intake reference'}</small><small>Forecast: ${esc(formula?.name||'No formula selected')}</small></div>`;}).join('');
    $('stageTargetsForm').innerHTML=STAGES.map(s=>{const formulas=state.formulas.filter(f=>f.stage===s.id).slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));const selected=state.stageTargets?.[s.id]?.formulaId||formulas[0]?.id||'';const weightTarget=num(state.stageTargets?.[s.id]?.targetWeightG);const eggTarget=num(state.stageTargets?.[s.id]?.targetEggRate);return `<div class="stage-plan-card"><strong>${s.name}</strong><small>${s.range}</small><label>Reference intake target · g/bird/day<input type="number" min="0" step="0.1" name="${s.id}" value="${num(state.stageTargets?.[s.id]?.gramsPerBirdDay)||''}" placeholder="Enter target"></label>${s.id==='rearing'||s.id==='pullet'||s.id==='prelay'?`<label>Target body weight · grams<input type="number" min="0" step="1" name="${s.id}Weight" value="${weightTarget||''}" placeholder="Age-specific target"></label>`:''}${s.id==='laying1'||s.id==='laying2'?`<label>Target hen-day production · %<input type="number" min="0" max="100" step="0.1" name="${s.id}Egg" value="${eggTarget||''}" placeholder="Set stage target"></label>`:''}<label>Forecast feed formula<select name="${s.id}Formula"><option value="">Use latest formula</option>${formulas.map(f=>`<option value="${esc(f.id)}" ${f.id===selected?'selected':''}>${esc(f.name)} · v${num(f.version)||1}</option>`).join('')}</select></label></div>`;}).join('')+`<div class="span-2 form-actions"><button class="btn btn-light" type="submit">Save stage plan</button></div>`;
  }
  function renderFormulaList(){
    $('formulaList').innerHTML=state.formulas.length?state.formulas.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(f=>`<article class="formula-card"><div class="panel-head"><div><h4>${esc(f.name)} <span class="pill">${esc(STAGES.find(s=>s.id===f.stage)?.name||f.stage)}</span></h4><p>Version ${f.version||1} · ${fmtDate(f.createdAt?.slice(0,10))}</p></div></div><div class="formula-meta"><span>${kg(f.totalWeight)} per recipe</span><span>${money(f.totalCost)} total</span><b>${money(f.costPerKg)}/kg</b></div><p>${(f.items||[]).map(i=>`${esc(i.ingredient)} ${num(i.quantityKg)}kg`).join(' · ')}</p></article>`).join(''):'No formulas have been created.';
  }
  function renderInventory(){
    const raw=rawInventory(),lots=finishedStock();
    $('rawStockTotal').textContent=kg(sum(raw,x=>x.quantity)); $('finishedStockTotal').textContent=kg(sum(lots,x=>x.availableKg)); $('averageFeedCost').textContent=finishedAverageCost()>0?`${money(finishedAverageCost())}/kg`:'—'; $('productionCount').textContent=String(state.production.length);
    $('rawStockTable').innerHTML=raw.length?raw.map(r=>`<tr><td>${esc(r.name)}</td><td>${kg(r.quantity)}</td><td>${money(r.costPerKg)}</td><td>${money(r.stockValue)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-cell">No ingredient purchases.</td></tr>';
    $('finishedStockTable').innerHTML=lots.length?lots.map(p=>{const f=state.formulas.find(x=>x.id===p.formulaId);return `<tr><td><b>${esc(p.lotName)}</b><small>${fmtDate(p.date)}</small></td><td>${esc(f?.name||'Archived formula')}</td><td>${kg(p.quantityKg)}</td><td><b>${kg(p.availableKg)}</b></td><td>${money(p.costPerKg)}</td></tr>`;}).join(''):'<tr><td colspan="5" class="empty-cell">No feed production.</td></tr>';
    const ingredients=[...new Set(state.formulas.flatMap(f=>(f.items||[]).map(i=>i.ingredient)))]; $('ingredientOptions').innerHTML=ingredients.map(x=>`<option value="${esc(x)}"></option>`).join('');
  }
  function fillSelect(id,rows,placeholder,selected){const el=$(id);if(!el)return;el.innerHTML=`<option value="">${esc(placeholder)}</option>`+rows.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.name||x.lotName)}</option>`).join('');}
  function renderSelectors(){
    const batches=state.batches.map(b=>({id:b.id,name:`${b.name} · ${liveBirds(b)} live`}));
    ['consumptionBatch','recordBatch','expenseBatch','forecastBatch','valuationBatch','scenarioBatch'].forEach(id=>fillSelect(id,batches,'Select batch',$(id)?.value));
    const formulas=state.formulas.map(f=>({id:f.id,name:`${f.name} · ${STAGES.find(s=>s.id===f.stage)?.name||f.stage}`}));
    ['productionFormula','scenarioFormula'].forEach(id=>fillSelect(id,formulas,'Select formula',$(id)?.value));
    const scenarioFormula=state.formulas.find(f=>f.id===$('scenarioFormula').value);
    $('scenarioIngredient').innerHTML=scenarioFormula?(scenarioFormula.items||[]).map(i=>`<option value="${esc(i.ingredient)}">${esc(i.ingredient)}</option>`).join(''):'<option value="">Select formula first</option>';
    const lots=finishedStock().filter(p=>p.availableKg>0).map(p=>({id:p.id,name:`${p.lotName} · ${p.availableKg.toFixed(1)} kg available`})); fillSelect('consumptionLot',lots,'Select feed lot',$('consumptionLot')?.value);
  }
  function renderRecords(){
    const rows=state.events.slice().sort((a,b)=>b.date.localeCompare(a.date));
    $('recordTable').innerHTML=rows.length?rows.slice(0,100).map(e=>{const b=getBatch(e.batchId);const details=e.type==='sale'?money(e.amount):e.type==='weight'?`${num(e.extra)} g average`:e.type==='water'?`${num(e.quantity)} L`:e.type==='management'?e.status:e.type==='eggs'?`${num(e.quantity)} eggs`:e.type==='addition'?money(e.amount):e.description||'—';return `<tr><td>${fmtDate(e.date)}</td><td>${esc(b?.name||'Batch removed')}</td><td>${esc(e.type)}</td><td>${num(e.quantity).toLocaleString('en-UG')}</td><td>${esc(details)}</td></tr>`;}).join(''):'<tr><td colspan="5" class="empty-cell">No records yet.</td></tr>';
  }
  function renderExpenses(){
    const cash=allCashOutflows(),todayRows=cash.filter(x=>x.date===today()),last30=cash.filter(x=>x.date>=isoPlusDays(today(),-29)&&x.date<=today());
    $('expenseToday').textContent=money(sum(todayRows,x=>x.amount)); $('expense30').textContent=money(sum(last30,x=>x.amount)); $('expenseAll').textContent=money(sum(cash,x=>x.amount)); $('salesIncome').textContent=money(saleIncome());
    $('expenseTable').innerHTML=cash.length?cash.slice(0,150).map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(x.category)}</td><td>${esc(x.description)}</td><td>${esc(x.source)}</td><td><b>${money(x.amount)}</b></td></tr>`).join(''):'<tr><td colspan="5" class="empty-cell">No expenditure recorded.</td></tr>';
  }
  function renderReports(){ $('reportBatches').textContent=state.batches.length; $('reportFormulas').textContent=state.formulas.length; $('reportLots').textContent=state.production.length; $('reportRecords').textContent=state.events.length+state.expenses.length+state.feedConsumption.length+state.purchases.length; }
  function renderAll(){ renderOverview(); renderBatches(); renderStageCards(); renderFormulaList(); renderInventory(); renderSelectors(); renderRecords(); renderExpenses(); renderReports(); }

  function openView(name){
    const meta={overview:['LAYER ENTERPRISE','Overview'],batches:['FLOCK MANAGEMENT','Bird batches'],planning:['FEED AND PRODUCTION PLANNING','Planning & formulas'],feed:['FEED INVENTORY CONTROL','Feed & inventory'],records:['FLOCK AND PRODUCTION RECORDS','Farm records'],expenses:['FINANCIAL MANAGEMENT','Expenditure'],forecast:['DECISION SUPPORT','Forecast & bird value'],reports:['FARM INTELLIGENCE','Reports']};
    if(!meta[name])return; document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${name}`));document.querySelectorAll('.nav-link').forEach(x=>x.classList.toggle('active',x.dataset.view===name));$('pageEyebrow').textContent=meta[name][0];$('pageTitle').textContent=meta[name][1];$('sidebar').classList.remove('open');
  }
  function addIngredientRow(data={}){
    const tr=document.createElement('tr');tr.innerHTML=`<td><input class="ing-name" aria-label="Ingredient" required value="${esc(data.ingredient||'')}" placeholder="e.g. maize meal"></td><td><input class="ing-qty" aria-label="Quantity in kg" type="number" min="0.001" step="any" required value="${data.quantityKg??''}"></td><td><input class="ing-price" aria-label="Price per kg" type="number" min="0" step="any" required value="${data.unitPrice??''}"></td><td><input class="ing-protein" aria-label="Crude protein percent" type="number" min="0" max="100" step="any" value="${data.crudeProtein??''}"></td><td><input class="ing-energy" aria-label="Energy kcal per kg" type="number" min="0" step="any" value="${data.energyKcal??''}"></td><td><button type="button" class="btn btn-light btn-small remove-ingredient" aria-label="Remove ingredient">×</button></td>`;$('formulaItemsBody').appendChild(tr);updateFormulaPreview();
  }
  function formulaItemsFromForm(){return [...$('formulaItemsBody').querySelectorAll('tr')].map(tr=>({ingredient:tr.querySelector('.ing-name').value.trim(),quantityKg:num(tr.querySelector('.ing-qty').value),unitPrice:num(tr.querySelector('.ing-price').value),crudeProtein:tr.querySelector('.ing-protein').value===''?null:num(tr.querySelector('.ing-protein').value),energyKcal:tr.querySelector('.ing-energy').value===''?null:num(tr.querySelector('.ing-energy').value)})).filter(x=>x.ingredient&&x.quantityKg>0);}
  function formulaTotals(items){const weight=sum(items,x=>x.quantityKg),cost=sum(items,x=>x.quantityKg*x.unitPrice),protein=items.length&&items.every(x=>x.crudeProtein!==null)?sum(items,x=>x.quantityKg*x.crudeProtein)/weight:null,energy=items.length&&items.every(x=>x.energyKcal!==null)?sum(items,x=>x.quantityKg*x.energyKcal)/weight:null;return {weight,cost,costPerKg:weight>0?cost/weight:0,protein,energy};}
  function updateFormulaPreview(){const x=formulaTotals(formulaItemsFromForm());$('formulaPreview').innerHTML=`<span>Total mix <b>${kg(x.weight)}</b></span><span>Total cost <b>${money(x.cost)}</b></span><span>Cost per kg <b>${money(x.costPerKg)}</b></span><span>Crude protein <b>${x.protein===null?'Not fully specified':`${x.protein.toFixed(2)}%`}</b></span><span>Energy <b>${x.energy===null?'Not fully specified':`${Math.round(x.energy)} kcal/kg`}</b></span>`;}

  function bindNavigation() {
    document.querySelectorAll('.nav-link').forEach(button => {
        button.addEventListener('click', () => {
            openView(button.dataset.view);
        });
    });

    document.querySelectorAll('[data-go]').forEach(button => {
        button.addEventListener('click', () => {
            openView(button.dataset.go);
        });
    });

    $('mobileMenu').addEventListener('click', () => {
        $('sidebar').classList.toggle('open');
    });
}
  function bind() {
    if (document.body.dataset.layersEventsBound === 'true') return;
    document.body.dataset.layersEventsBound = 'true';

    // MAIN MENU NAVIGATION
    document.addEventListener('click', event => {
        const nav = event.target.closest('.nav-link');
        const go = event.target.closest('[data-go]');

        if (nav) {
            openView(nav.dataset.view);
            return;
        }

        if (go) {
            openView(go.dataset.go);
        }
    });

    // MOBILE MENU
    $('mobileMenu').addEventListener('click', () => {
        $('sidebar').classList.toggle('open');
    });

    // REFRESH
    $('refreshButton').addEventListener('click', async () => {
        try {
            await loadCloud();
            renderAll();
            setSync('● Synced');
            clearNotice();
        } catch (error) {
            setSync('Refresh failed', true);
            setNotice(error.message, 'error');
        }
    });

    // SIGN OUT
    $('signOutButton').addEventListener('click', async () => {
        if (!confirm('Sign out of Layers Management?')) return;
        await client.auth.signOut();
        location.replace(new URL('auth.html', location.href).toString());
    });

    // CREATE BATCH
    $('batchForm').addEventListener('submit', event => {
        event.preventDefault();
        const v = Object.fromEntries(new FormData(event.currentTarget));
        const batch = {
            id: uid(),
            name: v.name.trim(),
            house: v.house.trim(),
            breed: v.breed.trim(),
            initialBirds: num(v.birds),
            arrivalDate: v.arrivalDate,
            arrivalAgeDays: num(v.arrivalAgeDays),
            birdCost: num(v.birdCost),
            harvestDate: v.harvestDate || isoPlusDays(v.arrivalDate, 730),
            capacity: num(v.capacity),
            targetWaterMl: num(v.targetWaterMl),
            notes: v.notes,
            createdAt: new Date().toISOString()
        };

        if (!batch.name || !batch.arrivalDate || batch.initialBirds <= 0) {
            return setNotice('Enter a batch name, arrival date and positive bird count.', 'error');
        }

        state.batches.push(batch);
        event.currentTarget.reset();
        $('batchForm').elements.arrivalDate.value = today();
        $('batchForm').elements.arrivalAgeDays.value = '0';
        $('batchForm').elements.harvestDate.value = isoPlusDays(today(), 730);

        changed('Batch created successfully.');
        openView('batches');
    });

    // STAGE PLANNING
    $('stageTargetsForm').addEventListener('submit', event => {
        event.preventDefault();
        const v = Object.fromEntries(new FormData(event.currentTarget));

        STAGES.forEach(stage => {
            state.stageTargets[stage.id] = {
                gramsPerBirdDay: num(v[stage.id]),
                targetWeightG: num(v[`${stage.id}Weight`]),
                targetEggRate: num(v[`${stage.id}Egg`]),
                formulaId: v[`${stage.id}Formula`] || ''
            };
        });

        changed('Stage targets and selected feed formulas saved.');
    });

    // FORMULA INGREDIENTS
    $('addIngredientRow').addEventListener('click', () => addIngredientRow());
    $('formulaItemsBody').addEventListener('input', updateFormulaPreview);

    $('formulaItemsBody').addEventListener('click', event => {
        if (event.target.closest('.remove-ingredient')) {
            event.target.closest('tr').remove();
            updateFormulaPreview();
        }
    });

    // CREATE FORMULA
    $('formulaForm').addEventListener('submit', event => {
        event.preventDefault();
        const v = Object.fromEntries(new FormData(event.currentTarget));
        const items = formulaItemsFromForm();

        if (!items.length) return setNotice('Add at least one valid ingredient.', 'error');
        if (items.some(item => item.unitPrice < 0)) {
            return setNotice('Ingredient prices cannot be negative.', 'error');
        }

        const totals = formulaTotals(items);
        if (totals.weight <= 0) return setNotice('Formula quantity must be positive.', 'error');

        const previous = state.formulas.filter(
            f => f.name.toLowerCase() === v.name.trim().toLowerCase()
                && f.stage === v.stage
        );

        const formula = {
            id: uid(),
            name: v.name.trim(),
            stage: v.stage,
            version: previous.length
                ? Math.max(...previous.map(f => num(f.version))) + 1
                : 1,
            status: 'active',
            items,
            totalWeight: totals.weight,
            totalCost: totals.cost,
            costPerKg: totals.costPerKg,
            nutrients: {
                crudeProtein: totals.protein,
                energyKcal: totals.energy
            },
            notes: v.notes,
            createdAt: new Date().toISOString()
        };

        state.formulas.push(formula);
        event.currentTarget.reset();
        $('formulaItemsBody').innerHTML = '';
        addIngredientRow();

        changed(`Formula ${formula.name} saved. Record production to create feed stock.`);
    });

    // INGREDIENT PURCHASE
    $('purchaseForm').addEventListener('submit', event => {
        event.preventDefault();
        const v = Object.fromEntries(new FormData(event.currentTarget));

        if (num(v.quantity) <= 0 || num(v.unitCost) < 0) {
            return setNotice('Enter a positive purchase quantity and valid unit cost.', 'error');
        }

        state.purchases.push({
            id: uid(),
            ingredient: v.ingredient.trim(),
            quantityKg: num(v.quantity),
            unitCost: num(v.unitCost),
            date: v.date,
            supplier: v.supplier.trim(),
            createdAt: new Date().toISOString()
        });

        event.currentTarget.reset();
        event.currentTarget.elements.date.value = today();
        changed('Ingredient purchase saved.');
    });

    // FEED PRODUCTION
    $('productionFormula').addEventListener('change', updateProductionPreview);
    $('productionForm').elements.quantity.addEventListener('input', updateProductionPreview);
    $('productionForm').elements.mixQuantity.addEventListener('input', updateProductionPreview);

    $('productionForm').addEventListener('submit', event => {
        event.preventDefault();
        const v = Object.fromEntries(new FormData(event.currentTarget));
        const formula = state.formulas.find(f => f.id === v.formulaId);

        if (!formula) return setNotice('Select a saved formula.', 'error');

        const quantity = num(v.quantity);
        if (quantity <= 0) return setNotice('Enter a positive production output.', 'error');

        const mixQuantity = num(v.mixQuantity) || quantity;
        const scale = mixQuantity / formula.totalWeight;

        const inputs = formula.items.map(item => {
            const q = item.quantityKg * scale;
            const stock = rawInventory().find(
                x => x.name.toLowerCase() === item.ingredient.toLowerCase()
            );

            return {
                ingredient: item.ingredient,
                quantityKg: q,
                unitCost: stock?.costPerKg || 0
            };
        });

        const shortage = inputs.find(
            item => rawAvailable(item.ingredient) + 1e-8 < item.quantityKg
        );

        if (shortage) {
            return setNotice(
                `Insufficient ${shortage.ingredient} stock. Purchase ingredients first.`,
                'error'
            );
        }

        const cost = sum(inputs, item => item.quantityKg * item.unitCost);

        state.production.push({
            id: uid(),
            formulaId: formula.id,
            formulaVersion: formula.version,
            lotName: v.lotName.trim(),
            mixQuantityKg: mixQuantity,
            quantityKg: quantity,
            cost,
            costPerKg: cost / quantity,
            inputs,
            date: v.date,
            notes: v.notes,
            createdAt: new Date().toISOString()
        });

        event.currentTarget.reset();
        event.currentTarget.elements.date.value = today();
        changed('Feed production recorded. Inventory updated.');
    });

    // DAILY FEED INTAKE AND FEED LOSSES
    $('consumptionForm').elements.kind.addEventListener('change', updateConsumptionFields);

    $('consumptionForm').addEventListener('submit', event => {
        event.preventDefault();
        const v = Object.fromEntries(new FormData(event.currentTarget));
        const lot = finishedStock().find(p => p.id === v.productionId);
        const quantity = num(v.quantity);

        if (!lot || quantity <= 0) {
            return setNotice('Select an available feed lot and enter a positive quantity.', 'error');
        }

        if (quantity > lot.availableKg + 1e-8) {
            return setNotice('The selected feed lot does not have enough stock.', 'error');
        }

        state.feedConsumption.push({
            id: uid(),
            batchId: v.batchId,
            productionId: v.productionId,
            quantityKg: quantity,
            costPerKg: lot.costPerKg,
            kind: v.kind || 'consumption',
            date: v.date,
            createdAt: new Date().toISOString()
        });

        event.currentTarget.reset();
        event.currentTarget.elements.date.value = today();

        changed(v.kind === 'loss'
            ? 'Feed loss recorded.'
            : 'Daily feed intake recorded. Forecasts updated.');
    });

    // FARM RECORDS
    $('recordType').addEventListener('change', updateRecordFields);

    $('recordForm').addEventListener('submit', event => {
        event.preventDefault();
        const v = Object.fromEntries(new FormData(event.currentTarget));
        const type = v.type;
        const quantity = num(v.quantity);
        const batch = getBatch(v.batchId);

        if (!batch || !v.date) return setNotice('Select a batch and date.', 'error');

        if (['sale', 'addition', 'eggs', 'water'].includes(type) && quantity <= 0) {
            return setNotice('Enter a positive quantity or measurement.', 'error');
        }

        if (type === 'mortality' && quantity < 0) {
            return setNotice('Mortality cannot be negative.', 'error');
        }

        if (type === 'weight' && num(v.extra) <= 0) {
            return setNotice('Enter a positive average sample weight.', 'error');
        }

        if (type === 'sale' && num(v.amount) <= 0) {
            return setNotice('Enter the total sale income.', 'error');
        }

        if (['mortality', 'sale'].includes(type) && quantity > liveBirds(batch, v.date)) {
            return setNotice('The recorded number exceeds the live flock.', 'error');
        }

        if (type === 'addition') {
            state.events.push({
                id: uid(),
                batchId: v.batchId,
                type,
                date: v.date,
                quantity,
                amount: quantity * num(v.unitValue),
                description: v.description,
                createdAt: new Date().toISOString()
            });
        } else {
            state.events.push({
                id: uid(),
                batchId: v.batchId,
                type,
                date: v.date,
                quantity: type === 'weight' ? 1 : quantity,
                amount: num(v.amount),
                extra: num(v.extra),
                unitValue: num(v.unitValue),
                status: v.status || 'pass',
                description: v.description,
                createdAt: new Date().toISOString()
            });
        }

        event.currentTarget.reset();
        event.currentTarget.elements.date.value = today();
        updateRecordFields();
        changed('Farm record saved. Relevant totals and forecasts updated.');
    });

    // OTHER EXPENDITURE
    $('expenseForm').addEventListener('submit', event => {
        event.preventDefault();
        const v = Object.fromEntries(new FormData(event.currentTarget));

        if (num(v.amount) <= 0) return setNotice('Expense must be greater than zero.', 'error');

        state.expenses.push({
            id: uid(),
            category: v.category,
            batchId: v.batchId || null,
            amount: num(v.amount),
            date: v.date,
            recurring: v.recurring,
            description: v.description.trim(),
            createdAt: new Date().toISOString()
        });

        event.currentTarget.reset();
        event.currentTarget.elements.date.value = today();
        changed('Expenditure recorded. Farm totals updated.');
    });

    // FORECASTS
    $('forecastForm').addEventListener('submit', event => {
        event.preventDefault();
        const v = Object.fromEntries(new FormData(event.currentTarget));
        const batch = getBatch(v.batchId);

        if (!batch) return setNotice('Select a batch.', 'error');

        const days = periodDays(v.amount, v.unit);
        const result = forecastBatch(batch, days);
        renderForecastResult(result, batch, v.amount, v.unit);
    });

    // COST PER BIRD AND SELLING VALUE
    $('valuationForm').addEventListener('submit', event => {
        event.preventDefault();
        const v = Object.fromEntries(new FormData(event.currentTarget));
        const batch = getBatch(v.batchId);
        if (!batch) return setNotice('Select a batch.', 'error');

        const calc = estimateBirdCost(batch, periodDays(v.age, v.ageUnit));

        if (calc.error) {
            $('valuationResults').innerHTML =
                `<div class="forecast-note">${esc(calc.error)}</div>`;
            return;
        }

        const expected = num(v.salePrice) * (v.basis === 'kg' ? num(v.weightKg) : 1);
        const difference = expected > 0 ? expected - calc.costPerBird : null;

        $('valuationResults').innerHTML = `
            <div class="forecast-card-grid">
                <div class="forecast-card">
                    <span>Estimated cost per bird at ${calc.age} days</span>
                    <strong>${money(calc.costPerBird)}</strong>
                    <small>${calc.future ? 'Projected to selected age' : 'Based on recorded costs'} · ${fmtDate(calc.date)}</small>
                </div>
                <div class="forecast-card">
                    <span>Estimated sale value</span>
                    <strong>${expected > 0 ? money(expected) : 'Not entered'}</strong>
                </div>
                <div class="forecast-card">
                    <span>Estimated margin per bird</span>
                    <strong>${difference === null ? '—' : money(difference)}</strong>
                </div>
            </div>
            <div class="forecast-note">Production cost and market value are different measures.</div>
        `;
    });

    // INGREDIENT PRICE SCENARIO
    $('priceScenarioForm').addEventListener('submit', event => {
        event.preventDefault();
        const v = Object.fromEntries(new FormData(event.currentTarget));
        const formula = state.formulas.find(f => f.id === v.formulaId);
        const batch = getBatch(v.batchId);

        if (!formula || !batch) {
            return setNotice('Select a formula and batch.', 'error');
        }

        const ingredient = formula.items.find(i => i.ingredient === v.ingredient);
        if (!ingredient) return setNotice('Select an ingredient.', 'error');

        const percent = num(v.changePct) / 100;
        const changePerKg =
            (ingredient.quantityKg / formula.totalWeight) *
            ingredient.unitPrice * percent;

        const days = periodDays(v.periodAmount, v.periodUnit);
        const result = forecastBatch(batch, days);
        const impact = result.feedKg * changePerKg;

        $('priceScenarioResult').innerHTML = `
            <div class="forecast-card-grid">
                <div class="forecast-card">
                    <span>Current formula cost/kg</span>
                    <strong>${money(formula.costPerKg)}</strong>
                </div>
                <div class="forecast-card">
                    <span>Scenario formula cost/kg</span>
                    <strong>${money(formula.costPerKg + changePerKg)}</strong>
                </div>
                <div class="forecast-card">
                    <span>Estimated expenditure impact</span>
                    <strong>${money(impact)}</strong>
                </div>
            </div>
        `;
    });

    // INITIAL FORM VALUES
    $('productionForm').elements.date.value = today();
    $('purchaseForm').elements.date.value = today();
    $('consumptionForm').elements.date.value = today();
    updateConsumptionFields();
    $('recordForm').elements.date.value = today();
    $('expenseForm').elements.date.value = today();
    $('batchForm').elements.arrivalDate.value = today();
    $('batchForm').elements.harvestDate.value = isoPlusDays(today(), 730);

    // CSV EXPORTS
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-export]');
        if (button) exportData(button.dataset.export);
    });
}
  function updateConsumptionFields(){
    const loss=$('consumptionForm').elements.kind.value==='loss';
    $('consumptionQuantityText').textContent=loss?'Feed wastage / loss (kg)':'Actual daily feed intake by flock (kg)';
    $('consumptionHint').textContent=loss?'Record feed spilled, spoiled or otherwise lost. It reduces finished stock but is not counted as feed eaten by birds.':'Record the net quantity actually eaten by this batch for the date (feed issued less measurable leftovers/returns). If several production lots are used, record each lot on the same date.';
  }
  function updateProductionPreview(){const id=$('productionFormula').value;const f=state.formulas.find(x=>x.id===id);const output=num($('productionForm').elements.quantity.value);const mix=num($('productionForm').elements.mixQuantity.value)||output;if(!f||output<=0){$('productionEstimate').textContent='Choose a formula and enter the actual output quantity.';return;}const scale=mix/f.totalWeight;const rows=f.items.map(i=>{const q=i.quantityKg*scale;return `${i.ingredient}: ${kg(q)} needed · ${kg(rawAvailable(i.ingredient))} available`;});$('productionEstimate').innerHTML=`<b>Scaled ingredient requirement for ${kg(mix)} recipe input</b><br>${rows.map(esc).join('<br>')}<br><b>Estimated production cost: ${money(sum(f.items,i=>i.quantityKg*scale*(rawCost(i.ingredient))))}</b><br>Actual finished output: ${kg(output)} · Estimated yield: ${mix>0?(output/mix*100).toFixed(1):0}%`;}
  function updateRecordFields(){
    const type=$('recordType').value;const qLabel=$('recordQuantityLabel'),aLabel=$('recordAmountLabel'),uLabel=$('recordUnitLabel'),xLabel=$('recordExtraLabel'),sLabel=$('recordStatusLabel');
    [qLabel,aLabel,uLabel,xLabel,sLabel].forEach(x=>x.hidden=true);
    $('recordQuantity').required=false;$('recordAmount').required=false;$('recordUnitValue').required=false;$('recordExtra').required=false;
    $('recordQuantity').value='';$('recordAmount').value='';$('recordUnitValue').value='';$('recordExtra').value='';
    if(type==='mortality'){qLabel.hidden=false;$('recordQuantity').required=true;qLabel.firstChild.textContent='Number of birds that died';$('recordQuantity').placeholder='Birds';$('recordHint').textContent='Deaths reduce live birds and future feed requirements. Historical costs remain in the batch ledger.';}
    else if(type==='sale'){qLabel.hidden=false;$('recordQuantity').required=true;$('recordAmount').required=true;qLabel.firstChild.textContent='Number of birds sold';aLabel.hidden=false;$('recordAmountLabel').firstChild.textContent='Total sale income (UGX)';$('recordHint').textContent='Sales reduce the live flock and future feed needs; sale income is recorded separately from expenditure.';}
    else if(type==='addition'){qLabel.hidden=false;$('recordQuantity').required=true;$('recordUnitValue').required=true;qLabel.firstChild.textContent='Number of birds added';uLabel.hidden=false;$('recordUnitLabel').firstChild.textContent='Purchase price per bird (UGX)';$('recordHint').textContent='Additional birds increase future feed requirements and purchase outlay.';}
    else if(type==='eggs'){qLabel.hidden=false;$('recordQuantity').required=true;qLabel.firstChild.textContent='Eggs collected';$('recordHint').textContent='Egg records are used to estimate hen-day production when the batch has a target egg-production percentage.';}
    else if(type==='weight'){xLabel.hidden=false;$('recordExtra').required=true;$('recordExtraLabel').firstChild.textContent='Average sample weight (grams)';$('recordHint').textContent='Enter the average body weight of the sampled birds in grams. Use a consistent sample method.';}
    else if(type==='water'){qLabel.hidden=false;$('recordQuantity').required=true;qLabel.firstChild.textContent='Water used (litres for this day)';$('recordHint').textContent='Water score is calculated only when a target in ml per bird per day is configured for the batch.';}
    else if(type==='management'){sLabel.hidden=false;$('recordHint').textContent='Use for documented cleaning, disinfection, vaccination or biosecurity checks. Record pass or needs attention.';}
    else {$('recordHint').textContent='Enter a health or veterinary activity in the description. Record its financial cost separately under Expenditure.';}
  }
  function renderForecastResult(f,b,amount,unit){
    const intakeComplete=f.intakeMissing.length===0;const costComplete=f.costMissing.length===0;const durationLabel=`${amount} ${unit}`;
    const sourceText=f.intakeObservations?`${f.intakeObservations} recorded intake day(s); ${f.dailyIntakeGrams.toFixed(1)} g/bird/day`:'No actual feed-intake baseline';
    $('forecastResults').innerHTML=`<div class="forecast-card-grid"><div class="forecast-card"><span>Current live birds</span><strong>${f.birds.toLocaleString('en-UG')}</strong><small>Deaths and sales already recorded are reflected</small></div><div class="forecast-card"><span>Observed daily feed intake</span><strong>${f.intakeObservations?kg(f.dailyFeedKg):'—'}</strong><small>${esc(sourceText)}</small></div><div class="forecast-card"><span>Feed required in ${esc(durationLabel)}</span><strong>${intakeComplete?kg(f.feedKg):'Incomplete data'}</strong><small>Calculated from daily intake records</small></div></div><div class="forecast-card-grid" style="margin-top:10px"><div class="forecast-card"><span>Feed requirement value</span><strong>${!intakeComplete?'Incomplete intake data':!costComplete?'Incomplete price data':money(f.feedCost)}</strong><small>Using selected stage formula cost/kg</small></div><div class="forecast-card"><span>Other recurring costs</span><strong>${money(f.otherCost)}</strong></div><div class="forecast-card"><span>Total projected operating cost</span><strong>${!intakeComplete?'Incomplete intake data':!costComplete?'Incomplete price data':money(f.total)}</strong><small>Feed requirement value plus recorded recurring costs</small></div><div class="forecast-card"><span>Additional feed to produce</span><strong>${f.additionalFeedToProduce===null?'—':kg(f.additionalFeedToProduce)}</strong><small>Requirement less available feed of selected formulas</small></div></div>${f.intakeMissing.length?`<div class="forecast-note">Feed quantity is incomplete for: ${f.intakeMissing.map(esc).join(', ')}. Record actual daily feed intake in these stages. No generic ration is substituted.</div>`:''}${f.costMissing.length?`<div class="forecast-note">Feed quantity can be estimated, but feed cost is incomplete for: ${f.costMissing.map(esc).join(', ')}. Select a stage formula with a cost/kg and record its ingredient prices or production costs.</div>`:''}${f.cutOff?`<div class="forecast-note">The selected prediction (${esc(durationLabel)}) extends beyond the batch end date. The forecast is limited to ${f.selectedDays} days up to the expected end date.</div>`:''}<p class="form-hint">Forecast model: ${esc(f.assumption)}. For a reliable baseline, record intake on several days. With fewer than three recorded days, treat the result as preliminary. The estimate holds future bird numbers constant; newly recorded deaths, sales or additions will recalculate it.</p>${f.byStage&&Object.keys(f.byStage).length?`<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Future stage</th><th>Feed needed</th><th>Feed value</th><th>Daily intake basis</th><th>Formula</th></tr></thead><tbody>${Object.entries(f.byStage).map(([id,x])=>`<tr><td>${esc(STAGES.find(s=>s.id===id)?.name||id)}</td><td>${kg(x.kg)}</td><td>${x.costAvailable?money(x.cost):'Cost not configured'}</td><td>${esc(x.rateSource)}${x.observations?` · ${x.observations} days`:''}</td><td>${esc(x.formula||'—')}</td></tr>`).join('')}</tbody></table></div>`:''}`;
  }

  function exportData(type){
    const data={batches:state.batches,formulas:state.formulas,production:state.production,records:state.events,expenses:allCashOutflows()}[type]||[];
    if(!data.length)return setNotice('There are no records to export for this section.','error');
    const keys=[...new Set(data.flatMap(x=>Object.keys(x)))];const cell=v=>`"${String(typeof v==='object'?JSON.stringify(v):v??'').replace(/"/g,'""')}"`;
    const csv=[keys.map(cell).join(','),...data.map(row=>keys.map(k=>cell(row[k])).join(','))].join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`layers-${type}-${today()}.csv`;a.click();URL.revokeObjectURL(url);
  }
async function start() {
    try {
        if (!window.supabaseClient) {
            throw new Error(
                'Supabase client was not initialized. Check supabase-config.js.'
            );
        }

        client = window.supabaseClient;

        const { data, error } = await client.auth.getSession();

        if (error) throw error;

        user = data.session?.user;

        if (!user) {
            location.replace(
                new URL('auth.html', location.href).toString()
            );
            return;
        }

        // Attach navigation and application events FIRST.
        bind();

        // Show the application before loading database records.
        $('loadingScreen').hidden = true;
        $('appShell').hidden = false;

        // Protect records from accidental editing until cloud data loads.
        const setEntryControlsEnabled = enabled => {
            document.querySelectorAll(
                '#appShell form input, ' +
                '#appShell form select, ' +
                '#appShell form textarea, ' +
                '#appShell form button'
            ).forEach(element => {
                element.disabled = !enabled;
            });
        };

        setEntryControlsEnabled(false);
        setSync('Loading farm records…');

        // Keep authentication active.
        client.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT' || !session) {
                location.replace(
                    new URL('auth.html', location.href).toString()
                );
            }
        });

        try {
            // Load farmer profile.
            const { data: profile, error: profileError } =
                await client
                    .from('profiles')
                    .select('full_name,role,account_status')
                    .eq('id', user.id)
                    .maybeSingle();

            if (profileError) {
                throw new Error(
                    `Profile could not be loaded: ${profileError.message}`
                );
            }

            if (profile?.account_status === 'suspended') {
                await client.auth.signOut();
                return;
            }

            const name =
                profile?.full_name ||
                user.user_metadata?.full_name ||
                user.email ||
                'Farmer';

            $('farmerName').textContent = name;

            $('farmerAvatar').textContent = name
                .trim()
                .split(/\s+/)
                .slice(0, 2)
                .map(x => x[0])
                .join('')
                .toUpperCase();

            $('welcomeHeading').textContent =
                `Welcome, ${name.split(/\s+/)[0]}.`;

            $('todayLabel').textContent =
                new Intl.DateTimeFormat('en-UG', {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                }).format(new Date());

            $('footerYear').textContent =
                new Date().getFullYear();

            // Load existing farmer records.
            await loadCloud();

            renderAll();

            if (!$('formulaItemsBody').children.length) {
                addIngredientRow();
            }

            updateRecordFields();

            // Enable data entry only after records load successfully.
            setEntryControlsEnabled(true);

            setSync('● Saved to cloud');
            clearNotice();

        } catch (error) {
            console.error('[Layers data loading]', error);

            try {
                renderAll();
            } catch (renderError) {
                console.error('[Layers rendering]', renderError);
            }

            setEntryControlsEnabled(false);

            setSync('Database unavailable', true);

            setNotice(
                `${error.message}. Menu navigation is available, ` +
                'but data entry is paused until the database connection is restored.',
                'error'
            );
        }

    } catch (error) {
        console.error('[Layers startup]', error);

        $('loadingScreen').innerHTML = `
            <div class="panel" style="max-width:560px;margin:24px">
                <h2>Layers Dashboard could not start</h2>
                <p>${esc(error.message || 'Unexpected error')}</p>
                <a class="btn btn-light" href="dashboard.html">
                    Return to farmer dashboard
                </a>
            </div>
        `;
    }
}

  document.addEventListener('DOMContentLoaded',start);
})();
