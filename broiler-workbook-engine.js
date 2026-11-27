/* ============================================================
   FRATEL-AGRIPREDICT — WORKBOOK-FAITHFUL BROILER CALCULATOR
   Source: koudijce broiler.xlsx, worksheet "broilers"
   Calculation model version: 1
   This module preserves the workbook's inputs and equations.
   Missing workbook cells remain missing; no biological targets
   or prices are invented.
============================================================ */
(() => {
  "use strict";
  const $ = (selector, root=document) => root.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num = value => value === null || value === "" || value === undefined ? null : Number(value);
  const money = value => Number.isFinite(value) ? "UGX " + value.toLocaleString("en-UG",{maximumFractionDigits:2}) : "—";
  const kg = value => Number.isFinite(value) ? value.toLocaleString("en-UG",{maximumFractionDigits:6}) + " kg" : "—";
  const DAY = 86400000;
  const MODEL_VERSION = 1;

  // Rows 4–20, columns A and I, plus B/D/F/H quantities.
  // Duplicate ingredient names are deliberately separate source rows.
  const SOURCE_INGREDIENTS = [
    ["Knurse Meal",8900,0,0,0,null],
    ["Romelko",5100,0,0,0,null],
    ["hendrix 5%",4800,60,60,50,null],
    ["intraco 20%",4100,0,0,null,null],
    ["hendrix 5%",4800,0,0,null,null],
    ["Maize Broken",1000,180,180,200,null],
    ["Maize Bran",600,520,520,530,null],
    ["Limestone/Shells",400,20,20,20,null],
    ["Sugar",3780,0,0,0,null],
    ["Whole Maize",1000,0,0,0,null],
    ["Wheat Bran",600,0,0,0,null],
    ["Soya",3100,120,120,100,null],
    ["Sunflower",800,100,100,100,null],
    ["Essential Drug Premix",6000,0,0,0,null],
    ["Fintox",500,0,0,0,null],
    ["25% feedlance ",4200,0,0,0,null],
    ["feedlance 5%",4200,1e-10,0.0001,1e-13,null]
  ];
  const STAGES = [
    {id:"rearing_0_4",label:"Rearing · 0–4 weeks",source:"B4:B20 / C4:C20",quantities:2},
    {id:"rearing_4_8",label:"Rearing · 4 to 8 weeks",source:"D4:D20 / E4:E20",quantities:3},
    {id:"pullet_8_17",label:"Pullet · 8 to 17 weeks",source:"F4:F20 / G4:G20",quantities:4},
    {id:"prelay_17_20",label:"Pre-lay · 17 to 20 weeks",source:"H4:H20",quantities:5}
  ];
  const SOURCE_WEEKLY_INTAKE = [
    {week:1,dailyKg:0.01,days:7,layingPercent:0},
    {week:2,dailyKg:0.01,days:7,layingPercent:0},
    {week:3,dailyKg:0.02,days:7,layingPercent:0},
    {week:4,dailyKg:0.03,days:7,layingPercent:0},
    {week:5,dailyKg:0.04,days:7,layingPercent:0},
    {week:6,dailyKg:0.04,days:7,layingPercent:0},
    {week:7,dailyKg:0.045,days:7,layingPercent:0}
  ];
  const WEEK_STAGE = ["rearing_0_4","rearing_4_8","rearing_4_8","rearing_4_8","rearing_4_8","rearing_4_8","pullet_8_17"];
  const EXCEL_BENCHMARKS = {
    weeklyFeedKg:[350,350,700,1050,1400,1400,1575],
    weeklyFeedCost:[434000,434000.1036,868000.2072,1302000.3108,1736000.4144,1736000.4144,1820700],
    totalFeedKg:6825,
    totalFeedCost:8330701.45
  };

  function createSourceModel() {
    return {
      source:{file:"koudijce broiler.xlsx",sheet:"broilers",ingredientHeading:"INGRIDIENTS",currency:"UGX"},
      version:MODEL_VERSION,
      defaultBirds:5000,
      sellingCostInputs:{chickCostPerBird:null,otherCostPerBird:null},
      ingredients:SOURCE_INGREDIENTS.map((r,i)=>({id:"source_row_"+(i+4),sourceRow:i+4,name:r[0],pricePerKg:r[1],quantities:{rearing_0_4:r[2],rearing_4_8:r[3],pullet_8_17:r[4],prelay_17_20:r[5]}})),
      stages:STAGES.map(s=>({id:s.id,label:s.label,source:s.source})),
      weeklyIntake:SOURCE_WEEKLY_INTAKE.map(x=>({...x})),
      additionalWeeklyIntake:Array.from({length:13},(_,i)=>({week:i+8,dailyKg:null,days:null,stageId:null,layingPercent:null})),
      weekStageMap:[...WEEK_STAGE],
      layingPercentages:SOURCE_WEEKLY_INTAKE.map(x=>x.layingPercent)
    };
  }

  function validateModel(model) {
    const errors=[],warnings=[];
    if(!model || !Array.isArray(model.ingredients) || model.ingredients.length!==17) errors.push("The workbook ingredient list must contain all 17 source rows.");
    if(!Array.isArray(model.weeklyIntake) || model.weeklyIntake.length!==7) errors.push("The workbook must contain all seven daily intake rows.");
    (model.ingredients||[]).forEach(item=>{
      if(!item.name) errors.push("An ingredient name is missing.");
      if(!Number.isFinite(Number(item.pricePerKg)) || Number(item.pricePerKg)<0) errors.push("Invalid price for "+item.name+".");
      Object.entries(item.quantities||{}).forEach(([stage,q])=>{
        if(q!==null && (!Number.isFinite(Number(q)) || Number(q)<0)) errors.push("Invalid inclusion quantity for "+item.name+" ("+stage+").");
      });
    });
    (model.weeklyIntake||[]).forEach(row=>{
      if(!Number.isFinite(Number(row.dailyKg)) || Number(row.dailyKg)<0) errors.push("Invalid daily intake in week "+row.week+".");
      if(!Number.isInteger(Number(row.days)) || Number(row.days)<1 || Number(row.days)>7) errors.push("Days per week must be a whole number from 1 to 7.");
    });
    (model.additionalWeeklyIntake||[]).forEach(row=>{
      const anyEntered=row.dailyKg!==null || row.days!==null || row.stageId!==null;
      if(anyEntered && (!Number.isFinite(Number(row.dailyKg)) || Number(row.dailyKg)<0 || !Number.isInteger(Number(row.days)) || Number(row.days)<1 || Number(row.days)>7 || !row.stageId)) warnings.push("Week "+row.week+" needs a daily intake, days per week and feed stage before it can be costed.");
      if(row.layingPercent!==null && (!Number.isFinite(Number(row.layingPercent)) || Number(row.layingPercent)<0 || Number(row.layingPercent)>100)) errors.push("Laying percentage in week "+row.week+" must be between 0 and 100.");
    });
    for(const stage of (model.stages||[])){
      const quantities=(model.ingredients||[]).map(i=>i.quantities?.[stage.id]);
      if(quantities.some(q=>q===null || q===undefined)) warnings.push(stage.label+" is incomplete in the source workbook.");
    }
    return {valid:errors.length===0,errors,warnings};
  }

  function calculateFormula(model, stageId, priceOverrides={}) {
    const lines=(model.ingredients||[]).map(item=>{
      const raw=item.quantities?.[stageId];
      const quantity=raw===null || raw===undefined ? null : Number(raw);
      const effectiveQuantity=quantity===null?0:quantity; // Excel SUM and multiplication treat blank cells as zero.
      const price=Object.prototype.hasOwnProperty.call(priceOverrides,item.id) ? Number(priceOverrides[item.id]) : Number(item.pricePerKg);
      return {id:item.id,name:item.name,sourceRow:item.sourceRow,quantityKg:quantity,effectiveQuantityKg:effectiveQuantity,pricePerKg:price,lineCost:effectiveQuantity*price,inclusionPercent:null};
    });
    const totalWeightKg=lines.reduce((sum,line)=>sum+line.effectiveQuantityKg,0);
    const totalCost=lines.reduce((sum,line)=>sum+line.lineCost,0);
    lines.forEach(line=>line.inclusionPercent=totalWeightKg>0?line.effectiveQuantityKg/totalWeightKg*100:0);
    if(totalWeightKg<=0) return {stageId,complete:false,lines,totalWeightKg,totalCost,costPerKg:null,costPerTonne:null,reason:"The source workbook has no ingredient quantities for this stage."};
    return {stageId,complete:totalWeightKg>0,lines,totalWeightKg,totalCost,costPerKg:totalWeightKg>0?totalCost/totalWeightKg:null,costPerTonne:totalWeightKg>0?totalCost/totalWeightKg*1000:null,reason:totalWeightKg>0?"":"Formula total weight is zero."};
  }

  function calculateWorkbook(model, birdsOverride, batch) {
    const validation=validateModel(model);
    const birdsDefault=Number(birdsOverride ?? model.defaultBirds);
    const formulas=Object.fromEntries((model.stages||[]).map(stage=>[stage.id,calculateFormula(model,stage.id)]));
    const rows=[...(model.weeklyIntake||[]),...(model.additionalWeeklyIntake||[])];
    const weeks=rows.map((row,index)=>{
      const dailyValue=num(row.dailyKg);
      const daysValue=num(row.days);
      const stageId=row.stageId || model.weekStageMap?.[index] || null;
      const formula=formulas[stageId];
      const configured=dailyValue!==null && daysValue!==null && Boolean(stageId) && Boolean(formula?.complete);
      const dailyCounts=configured && batch?.placementDate ? weeklyBirdCounts(batch,row.week,daysValue) : null;
      const birdsAtStart=dailyCounts?.[0]?.birds ?? birdsDefault;
      const birdsAtEnd=dailyCounts?.[dailyCounts.length-1]?.birds ?? birdsDefault;
      const weeklyPerBirdKg=configured?dailyValue*daysValue:null;
      const totalBirdDays=dailyCounts ? dailyCounts.reduce((sum,day)=>sum+day.birds,0) : configured?birdsDefault*daysValue:null;
      const totalFeedKg=!configured?null:(dailyCounts ? dailyCounts.reduce((sum,day)=>sum+dailyValue*day.birds,0) : weeklyPerBirdKg*birdsDefault);
      const feedCostPerBird=configured?weeklyPerBirdKg*formula.costPerKg:null;
      const totalFeedCost=configured?totalFeedKg*formula.costPerKg:null;
      const ingredients=configured?formula.lines.map(line=>({id:line.id,name:line.name,quantityKg:totalFeedKg*line.effectiveQuantityKg/formula.totalWeightKg,cost:totalFeedKg*line.effectiveQuantityKg/formula.totalWeightKg*line.pricePerKg})): [];
      const layingValue=num(row.layingPercent ?? model.layingPercentages?.[index]);
      const layingPercent=layingValue;
      const dailyEggs=layingValue===null?null:(dailyCounts?dailyCounts.reduce((sum,day)=>sum+day.birds*layingValue/100,0)/(daysValue||1):birdsAtStart*layingValue/100);
      const weeklyEggs=layingValue===null?null:(dailyCounts?dailyCounts.reduce((sum,day)=>sum+day.birds*layingValue/100,0):dailyEggs*(daysValue||0));
      return {week:row.week,dailyKgPerBird:dailyValue,days:daysValue,weeklyKgPerBird:weeklyPerBirdKg,birds:birdsDefault,birdsAtStart,birdsAtEnd,totalBirdDays,totalFeedKg,stageId,formulaCostPerKg:formula?.costPerKg??null,feedCostPerBird,totalFeedCost,ingredients,layingPercent,dailyEggs,weeklyEggs,complete:configured};
    });
    const sourceWeeks=weeks.slice(0,7);
    return {
      validation,formulas,weeks,sourceWeeks,additionalWeeks:weeks.slice(7),
      totalFeedKg:sourceWeeks.reduce((s,w)=>s+(w.totalFeedKg||0),0),
      totalFeedCost:sourceWeeks.every(w=>w.complete)?sourceWeeks.reduce((s,w)=>s+w.totalFeedCost,0):null,
      configuredFeedKg:weeks.reduce((s,w)=>s+(w.totalFeedKg||0),0)
    };
  }

  function calculatePriceScenario(model, ingredientId, newPrice) {
    const selected=(model.ingredients||[]).find(x=>x.id===ingredientId);
    if(!selected || !Number.isFinite(Number(newPrice)) || Number(newPrice)<0) throw new Error("Choose an ingredient and enter a valid price.");
    const oldPrice=Number(selected.pricePerKg),delta=Number(newPrice)-oldPrice;
    const overrides={[ingredientId]:Number(newPrice)};
    const formulas=Object.fromEntries((model.stages||[]).map(s=>[s.id,calculateFormula(model,s.id,overrides)]));
    return {ingredientId,oldPrice,newPrice:Number(newPrice),priceDelta:delta,formulas,stageImpacts:Object.values(formulas).map(f=>({stageId:f.stageId,costPerKg:f.costPerKg,deltaPerKg:f.complete?f.costPerKg-calculateFormula(model,f.stageId).costPerKg:null}))};
  }

  function calculateSellingFloor(model, weekNumber, chickCostPerBird, otherCostPerBird) {
    const result=calculateWorkbook(model);
    const weekIndex=Number(weekNumber)-1;
    if(!Number.isInteger(weekIndex)||weekIndex<0||weekIndex>=result.weeks.length) return {complete:false,reason:"Choose a week from the available workbook schedule."};
    const cumulative=result.weeks.filter(w=>Number(w.week)<=Number(weekNumber));
    if(cumulative.length!==weekIndex+1 || cumulative.some(w=>!w.complete || !Number.isFinite(w.feedCostPerBird))) return {complete:false,reason:"The workbook does not contain a complete daily intake and feed formula for every week up to this sale stage. Add verified values for the missing weeks; the system will not extrapolate them."};
    const feedCostPerBird=cumulative.reduce((s,w)=>s+w.feedCostPerBird,0);
    const chick=num(chickCostPerBird),other=num(otherCostPerBird);
    const knownCostPerBird=feedCostPerBird+(chick??0)+(other??0);
    const complete=chick!==null && other!==null;
    return {complete,feedCostPerBird,chickCostPerBird:chick,otherCostPerBird:other,knownCostPerBird,breakEvenPrice:complete?knownCostPerBird:null,knownCostOnly:!complete,reason:complete?"Includes workbook feed cost, chick cost and the other cost per bird entered.":"Only a partial cost is available. Enter chick cost and other costs per bird before treating this as a break-even price."};
  }

  function dayISO(date,offset) {
    const d=new Date(date+"T00:00:00");
    d.setDate(d.getDate()+offset);
    return d.toISOString().slice(0,10);
  }
  function birdsAliveAt(batch,date) {
    let alive=Number(batch?.initialBirds)||0;
    (batch?.records||[]).filter(r=>String(r.date||"")<=date).forEach(r=>{
      if(r.type==="mortality") alive-=Number(r.quantity)||0;
      if(r.type==="sale") alive-=Number(r.quantity)||0;
    });
    return Math.max(0,alive);
  }
  function weeklyBirdCounts(batch,week,days=7) {
    if(!batch?.placementDate) return null;
    const first=(Number(week)-1)*7;
    return Array.from({length:Number(days)||7},(_,day)=>({date:dayISO(batch.placementDate,first+day),birds:birdsAliveAt(batch,dayISO(batch.placementDate,first+day))}));
  }

  function benchmark() {
    const model=createSourceModel(),result=calculateWorkbook(model);
    const checks=[];
    checks.push({name:"Seven daily intake values preserved",pass:model.weeklyIntake.map(x=>x.dailyKg).join(",")==="0.01,0.01,0.02,0.03,0.04,0.04,0.045"});
    checks.push({name:"Weekly flock kilograms match Excel",pass:result.weeks.every((w,i)=>Math.abs(w.totalFeedKg-EXCEL_BENCHMARKS.weeklyFeedKg[i])<1e-8)});
    checks.push({name:"Weekly feed costs match Excel",pass:result.weeks.every((w,i)=>Math.abs(w.totalFeedCost-EXCEL_BENCHMARKS.weeklyFeedCost[i])<0.01)});
    checks.push({name:"Seven-week total feed matches Excel",pass:Math.abs(result.totalFeedKg-EXCEL_BENCHMARKS.totalFeedKg)<1e-8});
    checks.push({name:"Seven-week total feed cost matches Excel",pass:Math.abs(result.totalFeedCost-EXCEL_BENCHMARKS.totalFeedCost)<0.02});
    const small=calculateWorkbook(model,100);
    checks.push({name:"Different flock size scales correctly",pass:Math.abs(small.weeks[0].totalFeedKg-7)<1e-9 && Math.abs(small.weeks[0].totalFeedCost-result.weeks[0].totalFeedCost/50)<0.01});
    const changed=calculatePriceScenario(model,"source_row_15",3500);
    checks.push({name:"Ingredient price change reprices formula",pass:Math.abs(changed.stageImpacts.find(x=>x.stageId==="rearing_0_4").deltaPerKg-48)<1e-8});
    const formula=calculateFormula(model,"prelay_17_20");
    checks.push({name:"Blank pre-lay formula remains unavailable",pass:!formula.complete && formula.totalWeightKg===0});
    return {passed:checks.filter(x=>x.pass).length,total:checks.length,checks,calculatedTotalFeedCost:result.totalFeedCost};
  }

  const API={createSourceModel,validateModel,calculateFormula,calculateWorkbook,calculatePriceScenario,calculateSellingFloor,birdsAliveAt,weeklyBirdCounts,benchmark,EXCEL_BENCHMARKS};
  window.FratelBroilerWorkbookMath=API;

  const ids={status:"#wbStatus",stage:"#wbStage",birds:"#wbBirdCount",ingredientBody:"#wbIngredientRows",formulaWeight:"#wbFormulaWeight",formulaCost:"#wbFormulaCost",formulaKg:"#wbFormulaKg",weeklyBody:"#wbWeeklyRows",layingBody:"#wbLayingRows",totalFeed:"#wbTotalFeed",totalCost:"#wbTotalCost",saleWeek:"#wbSaleWeek",saleBirds:"#wbSaleBirds",chickCost:"#wbChickCost",otherCost:"#wbOtherCost",saleFloor:"#wbSaleFloor",saleNote:"#wbSaleNote",save:"#wbSave",reset:"#wbReset"};
  let model=createSourceModel(),enterprise=null,activeBatch=null,loaded=false,saleObserver=null;
  const getBatches=()=>window.FratelAgriPredictDashboard?.getBatches?.()||[];
  function chooseBatch() {
    const batches=getBatches();
    const select=$("#wbBatch");
    if(!select)return;
    const previous=select.value;
    select.innerHTML=batches.length?batches.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name||"Unnamed batch")+'</option>').join(""):'<option value="">No broiler batch yet</option>';
    activeBatch=batches.find(b=>b.id===(previous||batches[0]?.id))||batches[0]||null;
    if(activeBatch) select.value=activeBatch.id;
  }
  function currentBirds() {
    if(!activeBatch)return Number(model.defaultBirds)||0;
    return birdsAliveAt(activeBatch,new Date().toISOString().slice(0,10));
  }
  function render() {
    if(!$("#broilerWorkbookPanel"))return;
    chooseBatch();
    const stageId=$(ids.stage)?.value||"rearing_0_4";
    const formula=calculateFormula(model,stageId);
    const birdCount=Number($(ids.birds)?.value||currentBirds()||model.defaultBirds);
    const useBatchTimeline=activeBatch && Number($(ids.birds)?.value)===currentBirds();
    const result=calculateWorkbook(model,birdCount,useBatchTimeline?activeBatch:null);
    if($(ids.formulaWeight))$(ids.formulaWeight).textContent=formula.complete?kg(formula.totalWeightKg):"Not configured";
    if($(ids.formulaCost))$(ids.formulaCost).textContent=formula.complete?money(formula.totalCost):"Not available";
    if($(ids.formulaKg))$(ids.formulaKg).textContent=formula.complete?money(formula.costPerKg)+"/kg":"Not available";
    if($(ids.ingredientBody))$(ids.ingredientBody).innerHTML=formula.lines.map(line=>'<tr><td>'+esc(line.name)+' <small>Row '+line.sourceRow+'</small></td><td><input type="number" min="0" step="any" data-wb-quantity="'+esc(line.id)+'" value="'+(line.quantityKg===null?"":line.quantityKg)+'" '+(line.quantityKg===null?'placeholder="Blank in Excel"':'')+'></td><td><input type="number" min="0" step="any" data-wb-price="'+esc(line.id)+'" value="'+esc(model.ingredients.find(x=>x.id===line.id).pricePerKg)+'"></td><td>'+money(line.lineCost)+'</td><td>'+ (line.inclusionPercent===null?"—":line.inclusionPercent.toLocaleString("en-UG",{maximumFractionDigits:8})+"%")+'</td></tr>').join("");
    if($("#wbStageSummaryRows"))$("#wbStageSummaryRows").innerHTML=(model.stages||[]).map(stage=>{const f=result.formulas[stage.id];return '<tr><td>'+esc(stage.label)+'</td><td>'+(f.complete?kg(f.totalWeightKg):"Blank in workbook")+'</td><td>'+(f.complete?money(f.totalCost):"—")+'</td><td>'+(f.complete?money(f.costPerKg)+"/kg":"Not calculable")+'</td></tr>';}).join("");
    const weekHeaders=result.weeks.map(w=>'<th>Week '+w.week+'</th>').join("");
    if($("#wbWeeklyIngredientHead"))$("#wbWeeklyIngredientHead").innerHTML='<tr><th>Ingredient</th>'+weekHeaders+'</tr>';
    if($("#wbWeeklyCostHead"))$("#wbWeeklyCostHead").innerHTML='<tr><th>Ingredient</th>'+weekHeaders+'</tr>';
    if($("#wbWeeklyIngredientRows"))$("#wbWeeklyIngredientRows").innerHTML=model.ingredients.map(item=>'<tr><td>'+esc(item.name)+' <small>Excel row '+item.sourceRow+'</small></td>'+result.weeks.map(w=>{const line=w.ingredients.find(x=>x.id===item.id);return '<td>'+(line?line.quantityKg.toLocaleString("en-UG",{maximumFractionDigits:9}):"—")+'</td>';}).join("")+'</tr>').join("")+'<tr><th>Total feed</th>'+result.weeks.map(w=>'<th>'+(w.totalFeedKg===null?"—":w.totalFeedKg.toLocaleString("en-UG",{maximumFractionDigits:6}))+'</th>').join("")+'</tr>';
    if($("#wbWeeklyCostRows"))$("#wbWeeklyCostRows").innerHTML=model.ingredients.map(item=>'<tr><td>'+esc(item.name)+' <small>Excel row '+item.sourceRow+'</small></td>'+result.weeks.map(w=>{const line=w.ingredients.find(x=>x.id===item.id);return '<td>'+(line?money(line.cost):"—")+'</td>';}).join("")+'</tr>').join("")+'<tr><th>Total feed cost</th>'+result.weeks.map(w=>'<th>'+(w.complete?money(w.totalFeedCost):"—")+'</th>').join("")+'</tr>';
    if($("#wbAdditionalScheduleRows"))$("#wbAdditionalScheduleRows").innerHTML=(model.additionalWeeklyIntake||[]).map(row=>'<tr><td>Week '+row.week+'</td><td><input type="number" min="0" step="any" data-wb-extra-intake="'+row.week+'" value="'+(row.dailyKg??"")+'" placeholder="Enter kg"></td><td><input type="number" min="1" max="7" step="1" data-wb-extra-days="'+row.week+'" value="'+(row.days??"")+'" placeholder="1–7"></td><td><select data-wb-extra-stage="'+row.week+'"><option value="">Choose stage</option>'+(model.stages||[]).map(st=>'<option value="'+st.id+'" '+(row.stageId===st.id?"selected":"")+'>'+esc(st.label)+'</option>').join("")+'</select></td><td><input type="number" min="0" max="100" step="any" data-wb-extra-laying="'+row.week+'" value="'+(row.layingPercent??"")+'" placeholder="If applicable"></td></tr>').join("");
    if($(ids.weeklyBody))$(ids.weeklyBody).innerHTML=result.weeks.map(w=>'<tr><td>Week '+w.week+'</td><td>'+(w.dailyKgPerBird===null?"Not entered":w.dailyKgPerBird.toLocaleString("en-UG",{maximumFractionDigits:6}))+'</td><td>'+(w.days===null?"—":w.days)+'</td><td>'+(w.weeklyKgPerBird===null?"—":w.weeklyKgPerBird.toLocaleString("en-UG",{maximumFractionDigits:6}))+'</td><td>'+w.birdsAtStart.toLocaleString("en-UG")+' → '+w.birdsAtEnd.toLocaleString("en-UG")+'</td><td>'+(w.totalFeedKg===null?"Not configured":kg(w.totalFeedKg))+'</td><td>'+(w.complete?money(w.feedCostPerBird):"Not configured")+'</td><td>'+(w.complete?money(w.totalFeedCost):"Not configured")+'</td></tr>').join("");
    if($(ids.layingBody))$(ids.layingBody).innerHTML=result.weeks.map(w=>'<tr><td>Week '+w.week+'</td><td>'+(w.week<=7?'<input type="number" min="0" max="100" step="any" data-wb-laying="'+w.week+'" value="'+w.layingPercent+'">':(w.layingPercent===null?"Not entered":'<input type="number" min="0" max="100" step="any" data-wb-extra-laying="'+w.week+'" value="'+w.layingPercent+'">'))+'</td><td>'+(w.dailyEggs===null?"—":w.dailyEggs.toLocaleString("en-UG",{maximumFractionDigits:2}))+'</td><td>'+(w.weeklyEggs===null?"—":w.weeklyEggs.toLocaleString("en-UG",{maximumFractionDigits:2}))+'</td></tr>').join("");
    if($(ids.totalFeed))$(ids.totalFeed).textContent=kg(result.totalFeedKg);
    if($(ids.totalCost))$(ids.totalCost).textContent=result.totalFeedCost===null?"Incomplete":money(result.totalFeedCost);
    const saleWeek=Number($(ids.saleWeek)?.value||1);
    const sale=calculateSellingFloor(model,saleWeek,num($(ids.chickCost)?.value),num($(ids.otherCost)?.value));
    if($(ids.saleFloor))$(ids.saleFloor).textContent=sale.complete?money(sale.breakEvenPrice):money(sale.knownCostPerBird)+" (partial)";
    const saleQuantity=Math.max(0,Number($(ids.saleBirds)?.value)||0);
    const saleTotal=sale.complete&&saleQuantity>0?" Estimated minimum total for "+saleQuantity.toLocaleString("en-UG")+" birds: "+money(sale.breakEvenPrice*saleQuantity)+".":"";
    if($(ids.saleNote))$(ids.saleNote).textContent=sale.reason+saleTotal+" This uses scheduled workbook feed costs; it is not a market-price guarantee. It excludes costs not entered here, and does not infer a liveweight-based market value.";
    const validation=validateModel(model);
    if($(ids.status))$(ids.status).textContent=validation.errors.length?validation.errors.join(" "):validation.warnings.length?validation.warnings.join(" "):"Workbook inputs loaded. Calculations are linked to the selected flock.";
  }
  function bind() {
    document.addEventListener("change",event=>{
      const q=event.target.closest("[data-wb-quantity]");
      const p=event.target.closest("[data-wb-price]");
      const l=event.target.closest("[data-wb-laying]");
      const extraIntake=event.target.closest("[data-wb-extra-intake]");
      const extraDays=event.target.closest("[data-wb-extra-days]");
      const extraStage=event.target.closest("[data-wb-extra-stage]");
      const extraLaying=event.target.closest("[data-wb-extra-laying]");
      if(q){const item=model.ingredients.find(x=>x.id===q.dataset.wbQuantity);if(item)item.quantities[$(ids.stage).value]=q.value===""?null:Number(q.value);render();}
      if(p){const item=model.ingredients.find(x=>x.id===p.dataset.wbPrice);if(item)item.pricePerKg=Number(p.value);render();}
      if(l){const index=Number(l.dataset.wbLaying)-1;if(index>=0&&index<7)model.layingPercentages[index]=Number(l.value);render();}
      const extraWeek=Number(extraIntake?.dataset.wbExtraIntake||extraDays?.dataset.wbExtraDays||extraStage?.dataset.wbExtraStage||extraLaying?.dataset.wbExtraLaying);
      const extra=model.additionalWeeklyIntake?.find(x=>x.week===extraWeek);
      if(extraIntake&&extra)extra.dailyKg=extraIntake.value===""?null:Number(extraIntake.value);
      if(extraDays&&extra)extra.days=extraDays.value===""?null:Number(extraDays.value);
      if(extraStage&&extra)extra.stageId=extraStage.value||null;
      if(extraLaying&&extra)extra.layingPercent=extraLaying.value===""?null:Number(extraLaying.value);
      if(extra)render();
      if(event.target.matches("#wbBirdCount,#wbChickCost,#wbOtherCost,#wbSaleBirds,#wbSaleWeek")){
        if(event.target.id==="wbChickCost")model.sellingCostInputs.chickCostPerBird=num(event.target.value);
        if(event.target.id==="wbOtherCost")model.sellingCostInputs.otherCostPerBird=num(event.target.value);
        render();
      }
    });
    $(ids.stage)?.addEventListener("change",render);
    $("#wbBatch")?.addEventListener("change",event=>{activeBatch=getBatches().find(b=>b.id===event.target.value)||null;$(ids.birds).value=currentBirds();if($(ids.chickCost))$(ids.chickCost).value=Number(activeBatch?.chickCost)>0?Number(activeBatch.chickCost):"";render();});
    $(ids.birds)?.addEventListener("change",render);
    $(ids.saleWeek)?.addEventListener("change",render);
    $(ids.reset)?.addEventListener("click",()=>{model=createSourceModel();render();});
    $(ids.save)?.addEventListener("click",save);
    document.addEventListener("agripredict:broiler-data-updated",()=>{const before=activeBatch?.id;chooseBatch();if(activeBatch&&activeBatch.id!==before)$(ids.birds).value=currentBirds();render();});
  }
  async function load() {
    try {
      if(!window.FratelCloud)throw new Error("Cloud data service is not available.");
      const {user}=await window.FratelCloud.ready();
      enterprise=await window.FratelCloud.ensureEnterprise("broiler","Broiler Farming");
      const rows=await window.FratelCloud.select("broiler_workbook_models","*",q=>q.eq("enterprise_id",enterprise.id).limit(1));
      if(rows[0]?.model_data)model={...createSourceModel(),...rows[0].model_data};
      else model=createSourceModel();
      model.sellingCostInputs=model.sellingCostInputs||{chickCostPerBird:null,otherCostPerBird:null};
      loaded=true;
      if($(ids.status))$(ids.status).textContent=rows.length?"Saved farm workbook model loaded.":"Original workbook values loaded. Save after reviewing to keep your farm's settings.";
      if($(ids.birds))$(ids.birds).value=currentBirds()||model.defaultBirds;
      if($(ids.chickCost)&&activeBatch&&Number(activeBatch.chickCost)>0)$(ids.chickCost).value=Number(activeBatch.chickCost);
      if($(ids.chickCost)&&!$(ids.chickCost).value&&model.sellingCostInputs.chickCostPerBird!==null)$(ids.chickCost).value=model.sellingCostInputs.chickCostPerBird;
      if($(ids.otherCost)&&model.sellingCostInputs.otherCostPerBird!==null)$(ids.otherCost).value=model.sellingCostInputs.otherCostPerBird;
      render();
    } catch(error) {
      if($(ids.status))$(ids.status).textContent="Could not load the saved workbook model: "+(error.message||"Check connection and sign-in.");
      console.error("Broiler workbook model load failed:",error);
    }
  }
  async function save() {
    try {
      if(!loaded)throw new Error("The saved workbook model has not loaded yet.");
      const validation=validateModel(model);
      if(validation.errors.length)throw new Error(validation.errors.join(" "));
      const {user}=await window.FratelCloud.ready();
      const rows=await window.FratelCloud.upsert("broiler_workbook_models",[{
        enterprise_id:enterprise.id,model_version:MODEL_VERSION,model_data:model,updated_by:user.id,updated_at:new Date().toISOString()
      }],"enterprise_id","id,enterprise_id,updated_at");
      if($(ids.status))$(ids.status).textContent="Saved to your farm account. "+rows.length+" workbook model record confirmed.";
    } catch(error) {
      if($(ids.status))$(ids.status).textContent="Save failed: "+(error.message||"Please try again.");
      console.error("Broiler workbook model save failed:",error);
    }
  }
  function installSaleGuidance() {
    const modal=$("#recordModal");
    if(!modal || typeof MutationObserver==="undefined")return;
    const refreshGuidance=()=>{
      if(modal.hidden || $("#modalTitle")?.textContent!=="Record bird sale")return;
      const fields=$("#recordFields",modal);
      if(!fields)return;
      let hint=$("#wbSaleGuidance",modal);
      if(!hint){hint=document.createElement("p");hint.id="wbSaleGuidance";hint.className="wb-note";fields.appendChild(hint);}
      const batch=activeBatch||getBatches()[0]||null;
      const priceField=$("#record-unitPrice",modal);
      if(!batch?.placementDate){hint.textContent="Select a batch with a placement date before calculating a sale cost floor.";if(priceField)priceField.removeAttribute("min");return;}
      const placed=new Date(batch.placementDate+"T00:00:00");
      const today=new Date(new Date().toISOString().slice(0,10)+"T00:00:00");
      const ageDays=Math.floor((today-placed)/DAY)+1;
      const week=Math.ceil(ageDays/7);
      if(week<1){hint.textContent="This batch has not reached its placement date.";return;}
      if(week>20){hint.textContent="The workbook's four production stages end at Week 20. This batch is beyond the source workbook's configured stages, so the system cannot calculate a source-supported cost floor.";if(priceField)priceField.removeAttribute("min");return;}
      const chickFromBatch=Number(batch.chickCost)>0?Number(batch.chickCost):num($(ids.chickCost)?.value);
      const otherPerBird=num($(ids.otherCost)?.value);
      const floor=calculateSellingFloor(model,week,chickFromBatch,otherPerBird);
      const quantityField=$("#record-quantity",modal);
      if(floor.complete){
        const count=Number(quantityField?.value)||0;
        hint.textContent="Workbook cost floor for the current age (Week "+week+"): "+money(floor.breakEvenPrice)+" per bird. "+(count>0?"For "+count.toLocaleString("en-UG")+" birds, minimum total: "+money(floor.breakEvenPrice*count)+". ":"")+"This includes scheduled feed, chick cost and the other cost per bird entered in Forecasting Intelligence. It is not a market-price guarantee; unrecorded costs and mortality allocation are not included.";
        if(priceField){priceField.min=String(floor.breakEvenPrice);priceField.title="Do not enter less than the calculated cost floor unless you deliberately accept a loss.";if(!priceField.value)priceField.value=floor.breakEvenPrice.toFixed(2);}
      } else {
        if(priceField)priceField.removeAttribute("min");
        hint.textContent="Known feed-cost subtotal for Week "+week+": "+money(floor.knownCostPerBird)+" per bird. "+floor.reason+" The sale price field has not been restricted because the full cost is incomplete.";
      }
    };
    saleObserver=new MutationObserver(refreshGuidance);
    saleObserver.observe(modal,{attributes:true,attributeFilter:["hidden","class"]});
    document.addEventListener("input",event=>{
      if(event.target?.id==="record-quantity" || event.target?.id==="record-unitPrice")refreshGuidance();
    });
  }

  function initialise() {
    if(!$("#broilerWorkbookPanel"))return;
    const checks=benchmark();
    console.info("Broiler workbook benchmark:",checks);
    if(checks.passed!==checks.total)console.error("Workbook benchmark mismatch:",checks);
    chooseBatch();
    if($(ids.birds))$(ids.birds).value=currentBirds()||model.defaultBirds;
    bind();installSaleGuidance();render();load();
  }
  window.FratelBroilerWorkbook={render,load,save,getModel:()=>model,benchmark,calculateWorkbook,calculateFormula,calculateSellingFloor};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initialise,{once:true});else initialise();
})();