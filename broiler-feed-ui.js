/* ============================================================
   AGRIPREDICT — BROILER FEED MANAGEMENT UI
   Connects the existing 12-tab HTML to broiler-feed.js.
   All feed transactions are persisted by the feed engine.
============================================================ */
(() => {
  "use strict";
  const APP = window.AgriPredictFeed;
  if (!APP) { console.error("Feed engine missing. Load broiler-feed.js first."); return; }
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const fmt = v => n(v).toLocaleString("en-UG", {maximumFractionDigits:2});
  const money = v => `UGX ${Math.round(n(v)).toLocaleString("en-UG")}`;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const date = v => v ? new Date(`${v}T00:00:00`).toLocaleDateString("en-UG", {day:"numeric",month:"short",year:"numeric"}) : "—";
  const state = APP.state;
  let dialog = null;
  let draftFormulaItems = [];
  let editingFormulaId = null;

  function renderDraftFormula() {
    const body=$("#formulaIngredientTableBody");
    if(!body) return;
    if(!draftFormulaItems.length) {
      body.innerHTML='<tr><td colspan="6" class="empty-state">Add ingredients to begin formulating.</td></tr>';
      ["formulaTotalWeight","formulaSummaryWeight"].forEach(id=>{const el=$("#"+id);if(el)el.textContent="0 kg";});
      ["formulaTotalCost","formulaSummaryCost","formulaCostPerKg"].forEach(id=>{const el=$("#"+id);if(el)el.textContent="UGX 0";});
      const inclusion=$("#formulaTotalInclusion");if(inclusion)inclusion.textContent="0%";
      return;
    }
    const totalWeight=draftFormulaItems.reduce((s,x)=>s+n(x.quantity),0);
    const totalCost=draftFormulaItems.reduce((s,x)=>s+n(x.quantity)*n(x.unitPrice),0);
    body.innerHTML=draftFormulaItems.map((item,index)=>{
      const cost=n(item.quantity)*n(item.unitPrice);
      const rate=totalWeight>0?n(item.quantity)/totalWeight*100:0;
      return `<tr><td>${esc(item.name)}</td><td>${fmt(item.quantity)} kg</td><td>${money(item.unitPrice)}</td><td>${money(cost)}</td><td>${fmt(rate)}%</td><td><button type="button" class="text-button" data-draft-remove="${index}">Remove</button></td></tr>`;
    }).join("");
    setText("formulaTotalWeight",`${fmt(totalWeight)} kg`);
    setText("formulaSummaryWeight",`${fmt(totalWeight)} kg`);
    setText("formulaTotalCost",money(totalCost));
    setText("formulaSummaryCost",money(totalCost));
    setText("formulaCostPerKg",money(totalWeight>0?totalCost/totalWeight:0));
    setText("formulaTotalInclusion",`${fmt(totalWeight>0?100:0)}%`);
  }
  function setText(id,value) { const el=$("#"+id); if(el) el.textContent=value; }

  function renderSavedFormula(formula) {
    const body=$("#formulaIngredientTableBody"); if(!body) return;
    const items=formula?.items||[];
    body.innerHTML=items.length?items.map(item=>`<tr><td>${esc(item.name)}</td><td>${fmt(item.inclusionRate)}%</td><td>${fmt(item.quantity)} kg</td><td>${money(item.unitPrice)}</td><td>${money(item.cost)}</td><td>—</td></tr>`).join(""):'<tr><td colspan="6" class="empty-state">Add ingredients to begin formulating.</td></tr>';
    setText("formulaTotalWeight",`${fmt(formula?.totalWeight)} kg`); setText("formulaSummaryWeight",`${fmt(formula?.totalWeight)} kg`);
    setText("formulaTotalCost",money(formula?.totalCost)); setText("formulaSummaryCost",money(formula?.totalCost));
    setText("formulaCostPerKg",money(formula?.costPerKg)); setText("formulaTotalInclusion",items.length?"100%":"0%");
  }
  function clearFormulaEditor() {
    editingFormulaId=null; draftFormulaItems=[];
    ["formulaName","formulaStage","formulaTargetWeight","formulaNotes"].forEach(id=>{const el=$("#"+id);if(el)el.value="";});
    renderDraftFormula();
  }

  function notify(message) {
    const node = $("#appNotification");
    if (node) { node.textContent = message; node.hidden = false; clearTimeout(notify.timer); notify.timer=setTimeout(()=>node.hidden=true,3200); }
    else alert(message);
  }
  function currentBatch() {
    const batches = window.FratelAgriPredictDashboard?.getBatches?.() || [];
    const mapped = batches.map(b => {
      const records=Array.isArray(b.records)?b.records:[];
      const mortality=records.filter(r=>r.type==="mortality").reduce((sum,r)=>sum+n(r.quantity),0);
      const sold=records.filter(r=>r.type==="sale").reduce((sum,r)=>sum+n(r.quantity),0);
      return {
        id:b.id,name:b.name,placementDate:b.placementDate,initialBirds:n(b.initialBirds),
        currentBirds:Math.max(0,n(b.initialBirds)-mortality-sold),
        targetAgeDays:n(b.targetAgeDays)||28,targetWeight:n(b.targetWeight),targetFeedPerBird:3,active:true
      };
    });
    const selectedId = mapped[0]?.id || "";
    APP.setBatches(mapped, selectedId);
    return mapped[0] || null;
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "feed-entry-dialog";
    dialog.innerHTML = `<form method="dialog" class="feed-entry-card" id="feedEntryForm"><header><div><span class="eyebrow">FEED MANAGEMENT</span><h2 id="feedEntryTitle">New record</h2></div><button type="button" class="icon-button" data-dialog-close aria-label="Close">×</button></header><div id="feedEntryFields" class="feed-entry-fields"></div><p id="feedEntryError" class="form-error" role="alert"></p><footer><button type="button" class="btn btn-outline" data-dialog-close>Cancel</button><button type="submit" class="btn btn-primary">Save record</button></footer></form>`;
    document.body.append(dialog);
    dialog.addEventListener("click", e => { if (e.target === dialog || e.target.closest("[data-dialog-close]")) dialog.close(); });
    return dialog;
  }
  function field(name,label,type="text",opts={}) {
    const required = opts.required === false ? "" : "required";
    const min = opts.min !== undefined ? `min="${opts.min}"` : "";
    const step = opts.step ? `step="${opts.step}"` : "";
    if (type === "select") return `<label>${esc(label)}<select name="${esc(name)}" ${required}>${(opts.options||[]).map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select></label>`;
    if (type === "textarea") return `<label class="full">${esc(label)}<textarea name="${esc(name)}" rows="3" ${required}></textarea></label>`;
    return `<label>${esc(label)}<input name="${esc(name)}" type="${type}" ${required} ${min} ${step} ${opts.value!==undefined?`value="${esc(opts.value)}"`:""}></label>`;
  }
  function openForm(title, fields, onSave) {
    const d=ensureDialog(), form=$("#feedEntryForm",d);
    $("#feedEntryTitle",d).textContent=title;
    $("#feedEntryFields",d).innerHTML=fields.join("");
    $("#feedEntryError",d).textContent="";
    form.onsubmit=async e=>{
      e.preventDefault();
      const submit=form.querySelector('button[type="submit"]');
      if(submit)submit.disabled=true;
      try {
        const values=Object.fromEntries(new FormData(form).entries());
        await onSave(values);
        d.close(); refresh(); notify("Feed record saved to Supabase.");
      } catch(err) {
        $("#feedEntryError",d).textContent=err.message || "Could not save record online.";
      } finally { if(submit)submit.disabled=false; }
    };
    d.showModal();
  }
  const ingredientOptions=()=>state.ingredients.filter(x=>x.active).map(x=>({value:x.id,label:x.name}));
  const supplierOptions=()=>state.suppliers.filter(x=>x.active).map(x=>({value:x.id,label:x.name}));
  const formulaOptions=()=>state.formulas.filter(x=>x.status==="active").map(x=>({value:x.id,label:`${x.name} · ${x.stage}`}));
  const batchOptions=()=>state.batches.map(x=>({value:x.id,label:x.name}));

  function renderTable(id, headers, rows, empty) {
    const body=$(id); if(!body) return;
    body.innerHTML=rows.length ? rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" class="empty-state">${esc(empty)}</td></tr>`;
  }
  function render() {
    const ingredients=state.ingredients.filter(x=>x.active);
    const rawTotal=ingredients.reduce((s,x)=>s+Math.max(0,APP.rawStock(x.id)),0);
    const finishedTotal=state.formulas.reduce((s,x)=>s+Math.max(0,APP.finishedStock(x.id)),0);
    const consumed=state.consumption.filter(x=>x.type==="feed").reduce((s,x)=>s+n(x.quantity),0);
    const avg=APP.averageFeedCostPerKg();
    const set=(id,v)=>{const el=$(id);if(el)el.textContent=v;};
    const activeBatch=state.batches.find(b=>b.id===state.selectedBatch)||state.batches[0];
    const activeSummary=activeBatch?APP.batchFeedSummary(activeBatch.id):null;
    set("#feedTotalStock",`${fmt(finishedTotal)} kg`); set("#feedTotalConsumed",`${fmt(consumed)} kg`); set("#feedAverageCost",money(avg)); set("#rawMaterialStock",`${fmt(rawTotal)} kg`); set("#feedCostPerBird",money(activeSummary&&activeSummary.liveBirds>0?activeSummary.feedCost/activeSummary.liveBirds:0));
    const projectedNeed=state.batches.reduce((sum,b)=>{const remaining=Math.max(0,n(b.targetAgeDays)-APP.batchAge(b));return sum+APP.liveBirds(b.id)*n(b.targetFeedPerBird)*remaining/Math.max(1,n(b.targetAgeDays));},0);
    set("#feedProjectedNeed", state.batches.length ? `${fmt(projectedNeed)} kg` : "—");
    const alerts=ingredients.filter(x=>APP.rawStock(x.id)<=0).map(x=>`<p class="alert-item">${esc(x.name)}: no recorded stock</p>`);
    const alertBox=$("#feedStockAlerts"); if(alertBox)alertBox.innerHTML=alerts.join("")||'<p class="empty-state">No low-stock alerts.</p>';
    const cat=$("#feedCategorySummary"); if(cat)cat.innerHTML=ingredients.length?ingredients.reduce((acc,x)=>{acc[x.category]=(acc[x.category]||0)+Math.max(0,APP.rawStock(x.id));return acc;},{} ) && Object.entries(ingredients.reduce((a,x)=>(a[x.category]=(a[x.category]||0)+Math.max(0,APP.rawStock(x.id)),a),{})).map(([k,v])=>`<p>${esc(k)} <strong>${fmt(v)} kg</strong></p>`).join(""):'<p class="empty-state">No ingredients yet.</p>';
    renderTable("#ingredientTableBody",Array(9).fill(""),ingredients.map(x=>[esc(x.name),esc(x.category),esc(x.unit||"kg"),money(x.currentPrice),x.protein==null?"—":fmt(x.protein),x.energy==null?"—":fmt(x.energy),`${fmt(APP.rawStock(x.id))} kg`,APP.rawStock(x.id)>0?"In stock":"Out of stock",`<button class="text-button" data-feed-delete="ingredient" data-id="${x.id}">Archive</button>`]),"No ingredients recorded yet.");
    renderTable("#feedSupplierTableBody",Array(7).fill(""),state.suppliers.map(x=>[esc(x.name),esc(x.contact),esc(x.telephone),esc(x.address),esc(x.notes),x.active?"Active":"Archived",`<span>—</span>`]),"No suppliers recorded yet.");
    const purchaseRows=state.purchases.map(p=>{
      const i=APP.getIngredient(p.ingredientId),supplier=APP.getSupplier(p.supplierId);
      const tracked=Number.isFinite(Number(p.paidAmount));
      const paid=tracked?n(p.paidAmount):0;
      const balance=tracked?Math.max(0,n(p.totalCost)-paid):0;
      const status=tracked?(balance<=0.005?"Paid":paid>0?"Part paid":"Unpaid"):"Not tracked";
      const action=tracked&&balance>0?`<button type="button" class="text-button" data-purchase-payment="${esc(p.id)}">Record payment</button>`:"—";
      return [date(p.date),esc(p.invoiceNumber||p.id.slice(0,8)),esc(supplier?.name||"—"),esc(i?.name||"—"),`${fmt(p.quantity)} kg`,money(p.unitPrice),money(n(p.transportCost)+n(p.otherCost)),money(p.totalCost),status,action];
    });
    renderTable("#feedPurchaseTableBody",Array(10).fill(""),purchaseRows,"No purchases recorded yet.");
    set("#feedPurchaseTotal",money(state.purchases.reduce((s,x)=>s+n(x.totalCost),0)));
    set("#feedOutstandingPayments",money(state.purchases.reduce((s,x)=>s+(Number.isFinite(Number(x.paidAmount))?Math.max(0,n(x.totalCost)-n(x.paidAmount)):0),0)));
    set("#feedMonthlyPurchases",money(state.purchases.filter(x=>String(x.date).slice(0,7)===new Date().toISOString().slice(0,7)).reduce((s,x)=>s+n(x.totalCost),0)));
    renderTable("#rawInventoryTableBody",Array(8).fill(""),ingredients.map(x=>{const movements=state.rawMovements.filter(m=>m.ingredientId===x.id);const purchased=movements.filter(m=>m.type==="purchase").reduce((a,m)=>a+n(m.quantity),0);const used=movements.filter(m=>m.type==="production_use").reduce((a,m)=>a+Math.abs(n(m.quantity)),0);const adjustments=movements.filter(m=>String(m.type).startsWith("adjustment_")).reduce((a,m)=>a+n(m.quantity),0);const stock=APP.rawStock(x.id);return [esc(x.name),"0 kg",`${fmt(purchased)} kg`,`${fmt(used)} kg`,`${fmt(adjustments)} kg`,`${fmt(stock)} kg`,"Not set",money(Math.max(0,stock)*n(x.currentPrice))];}),"No inventory records available.");
    renderTable("#finishedInventoryTableBody",Array(7).fill(""),state.formulas.map(x=>{const produced=state.production.filter(p=>p.formulaId===x.id).reduce((a,p)=>a+n(p.quantity),0);const issued=state.allocations.filter(a=>a.formulaId===x.id).reduce((a,p)=>a+n(p.quantity),0);const stock=APP.finishedStock(x.id);return [esc(x.name),`${fmt(produced)} kg`,`${fmt(issued)} kg`,`0 kg`,`${fmt(stock)} kg`,money(x.costPerKg),money(stock*n(x.costPerKg))];}),"No finished feed recorded yet.");
    renderTable("#feedMovementTableBody",Array(7).fill(""),state.rawMovements.map(x=>[date(x.date),esc(APP.getIngredient(x.ingredientId)?.name||"—"),esc(x.type),x.quantity>0?`${fmt(x.quantity)} kg`:"—",x.quantity<0?`${fmt(Math.abs(x.quantity))} kg`:"—",esc(x.reference||"—"),"—"]),"No stock movements recorded yet.");
    const activeFormulas=state.formulas.filter(x=>x.status==="active");
    const formulaList=$("#feedFormulaList");
    if(formulaList) formulaList.innerHTML=activeFormulas.length?activeFormulas.map(x=>`<div class="feed-list-row"><div><strong>${esc(x.name)}</strong><span>${esc(x.stage)} · ${money(x.costPerKg)}/kg</span></div><button type="button" class="text-button" data-formula-edit="${esc(x.id)}">Edit</button></div>`).join(""):'<p class="empty-state">No feed formulas created yet.</p>';
    const latestFormula=activeFormulas.slice(-1)[0];
    if(editingFormulaId || draftFormulaItems.length) renderDraftFormula();
    else if(latestFormula) renderSavedFormula(latestFormula);
    else renderDraftFormula();
    const priceHistory=$("#ingredientPriceHistory");if(priceHistory){const history=[...state.purchases].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,8);priceHistory.innerHTML=history.length?history.map(x=>`<p>${date(x.date)} · ${esc(APP.getIngredient(x.ingredientId)?.name||"Ingredient")} · ${money(x.unitPrice)}/kg</p>`).join(""):'<p class="empty-state">No ingredient price history yet.</p>'; }
    const batchCosts=$("#feedBatchCostComparison");if(batchCosts){batchCosts.innerHTML=state.batches.length?state.batches.map(b=>{const x=APP.batchFeedSummary(b.id);return `<p><strong>${esc(b.name)}</strong> · ${money(x.feedCost)} allocated feed cost · ${fmt(x.feedPerLiveBird)} kg per live bird</p>`;}).join(""):'<p class="empty-state">No batch cost data available.</p>'; }
    const nutrientBody=$("#formulaNutritionTableBody");
    if(nutrientBody){const names=[["protein","Crude protein (%)"],["energy","Metabolizable energy (kcal/kg)"],["fibre","Crude fibre (%)"],["calcium","Calcium (%)"],["phosphorus","Phosphorus (%)"],["lysine","Lysine (%)"],["methionine","Methionine (%)"]];nutrientBody.innerHTML=latestFormula?names.map(([key,label])=>`<tr><td>${label}</td><td>${latestFormula.nutrients[key]==null?"Not available":fmt(latestFormula.nutrients[key])}</td><td>Not set</td><td>—</td></tr>`).join(""):'<tr><td colspan="4" class="empty-state">Nutrient data not available.</td></tr>'; }
    const batchSummary=$("#feedBatchSummary");if(batchSummary){batchSummary.innerHTML=state.batches.length?state.batches.map(b=>{const x=APP.batchFeedSummary(b.id);return `<p><strong>${esc(b.name)}</strong> · ${fmt(x.consumed)} kg consumed · ${fmt(x.remainingAllocated)} kg allocated balance</p>`;}).join(""):'<p class="empty-state">No active broiler batch linked.</p>'; }
    const produced=state.production.reduce((s,x)=>s+n(x.quantity),0);const productionCost=state.production.reduce((s,x)=>s+n(x.productionCost),0);set("#totalFeedProduced",`${fmt(produced)} kg`);set("#totalFeedProductionCost",money(productionCost));set("#productionAverageCost",money(produced>0?productionCost/produced:0));
    const activity=$("#feedRecentActivity");if(activity){const items=[...state.purchases.map(x=>({date:x.date,label:"Ingredient purchase",detail:money(x.totalCost)})),...state.production.map(x=>({date:x.date,label:"Feed production",detail:`${fmt(x.quantity)} kg`})),...state.allocations.map(x=>({date:x.date,label:"Feed allocation",detail:`${fmt(x.quantity)} kg`}))].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,6);activity.innerHTML=items.length?items.map(x=>`<p>${date(x.date)} · <strong>${esc(x.label)}</strong> · ${esc(x.detail)}</p>`).join(""):'<p class="empty-state">No feed activity yet.</p>'; }
    renderTable("#feedProductionTableBody",Array(9).fill(""),state.production.map(x=>[date(x.date),esc(x.id.slice(0,8)),esc(state.formulas.find(f=>f.id===x.formulaId)?.name||"—"),`${fmt(x.quantity)} kg`,"0 kg",`${fmt(x.quantity)} kg`,money(x.productionCost),money(x.costPerKg),"—"]),"No production records yet.");
    renderTable("#feedAllocationTableBody",Array(8).fill(""),state.allocations.map(x=>[date(x.date),esc(APP.getBatch(x.batchId)?.name||"—"),esc(state.formulas.find(f=>f.id===x.formulaId)?.name||"—"),`${fmt(x.quantity)} kg`,money(x.costPerKg),money(x.totalCost),"—","—"]),"No feed allocations yet.");
    renderTable("#batchFeedBalanceTableBody",Array(6).fill(""),state.batches.map(b=>{const x=APP.batchFeedSummary(b.id);return [esc(b.name),`${fmt(x.allocated)} kg`,`${fmt(x.consumed)} kg`,`${fmt(x.remainingAllocated)} kg`,money(x.feedCost),money(x.liveBirds>0?x.feedCost/x.liveBirds:0)];}),"No batch balances available.");
    renderTable("#dailyFeedConsumptionTableBody",Array(10).fill(""),state.consumption.filter(x=>x.type==="feed").map(x=>{
      const allocation=state.allocations.find(a=>a.id===x.allocationId);
      const prior=state.consumption.filter(c=>c.type==="feed"&&c.allocationId===x.allocationId&&String(c.date)<String(x.date)).reduce((sum,c)=>sum+n(c.quantity),0);
      const opening=Math.max(0,n(allocation?.quantity)-prior),closing=Math.max(0,opening-n(x.quantity)),birds=APP.liveBirds(x.batchId);
      return [date(x.date),esc(APP.getBatch(x.batchId)?.name||"—"),`${APP.batchAge(APP.getBatch(x.batchId),x.date)} days`,esc(state.formulas.find(f=>f.id===allocation?.formulaId)?.name||"—"),`${fmt(opening)} kg`,`${fmt(x.quantity)} kg`,`${fmt(closing)} kg`,fmt(birds),`${fmt(birds>0?n(x.quantity)/birds:0)} kg`,"—"];
    }),"No feed consumption recorded.");
    set("#feedTotalExpenditure",money(state.purchases.reduce((s,x)=>s+n(x.totalCost),0)));
    set("#feedCostBirdAnalysis",money(activeSummary&&activeSummary.liveBirds>0?activeSummary.feedCost/activeSummary.liveBirds:0));
    const mainBatch=(window.FratelAgriPredictDashboard?.getBatches?.()||[]).find(b=>b.id===activeBatch?.id);
    const weightRecords=(mainBatch?.records||[]).filter(x=>x.type==="weight").sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const latestWeight=weightRecords[weightRecords.length-1];
    const weightGain=latestWeight&&n(mainBatch?.initialWeight)>0?(n(latestWeight.averageWeight)-n(mainBatch.initialWeight))*APP.liveBirds(activeBatch.id):0;
    const mainFeedRecords=(mainBatch?.records||[]).filter(x=>x.type==="feed");
    const mainFeedConsumed=mainFeedRecords.reduce((sum,x)=>sum+n(x.quantity),0);
    const mainFeedCost=mainFeedRecords.reduce((sum,x)=>sum+(n(x.totalCost)||n(x.quantity)*n(x.unitPrice)),0);
    const fcr=weightGain>0&&mainFeedConsumed>0?mainFeedConsumed/weightGain:null;
    set("#feedAverageFCR",fcr==null?"Add feed and weight records":`${fmt(fcr)} : 1`);
    set("#feedCostPerKgLiveWeight",weightGain>0?money(mainFeedCost/weightGain):"—");
    const select=(id,opts)=>{const el=$(id);if(el){const old=el.value;el.innerHTML='<option value="">Select</option>'+opts.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");if(opts.some(o=>o.value===old))el.value=old;}};
    select("#forecastBatch",batchOptions()); select("#feedConsumptionBatchFilter",batchOptions()); select("#sensitivityIngredient",ingredients.map(x=>({value:x.id,label:x.name})));
    select("#forecastBatch",batchOptions());
  }

  async function syncFeedConsumptionToBroiler(record) {
    const batch=(window.FratelAgriPredictDashboard?.getBatches?.()||[]).find(x=>x.id===record.batchId);
    if(!batch)return;
    batch.records=Array.isArray(batch.records)?batch.records:[];
    if(batch.records.some(x=>x.id===record.id))return;
    const allocation=state.allocations.find(x=>x.id===record.allocationId);
    const formula=state.formulas.find(x=>x.id===allocation?.formulaId);
    const unitPrice=n(allocation?.costPerKg);
    batch.records.push({
      id:record.id,type:"feed",date:record.date,quantity:n(record.quantity),
      feedType:formula?.name||"Feed management allocation",unitPrice,
      totalCost:n(record.quantity)*unitPrice,source:"feed-management",
      notes:"Recorded through Feed Management"
    });
    if (!window.FratelCloud) throw new Error("Supabase broiler storage is unavailable.");
    const saved = await window.FratelCloud.saveLivestockBatch(batch, "broiler");
    batch.cloudId = saved.cloudId;
    window.dispatchEvent(new CustomEvent("agripredict:broiler-data-updated"));
  }

  function switchTab(name) {
    $$("[data-feed-tab]").forEach(b=>b.classList.toggle("active",b.dataset.feedTab===name));
    $$(".feed-tab-content").forEach(p=>{const active=p.id===`feedTab-${name}`;p.classList.toggle("active",active);p.hidden=!active;});
    state.activeTab=name;
  }

  function bind() {
    const page=$("#feedView"); if(!page || page.dataset.feedUiBound) return; page.dataset.feedUiBound="true";
    page.addEventListener("click",async e=>{
      const tab=e.target.closest("[data-feed-tab]"); if(tab){switchTab(tab.dataset.feedTab);return;}
      const inventoryTab=e.target.closest("[data-inventory-tab]"); if(inventoryTab){const name=inventoryTab.dataset.inventoryTab;$$('[data-inventory-tab]').forEach(b=>b.classList.toggle("active",b===inventoryTab));$$(".inventory-tab-content").forEach(panel=>{const active=panel.id===`inventoryTab-${name}`;panel.classList.toggle("active",active);panel.hidden=!active;});return;}
      const paymentButton=e.target.closest("[data-purchase-payment]");
      if(paymentButton){
        const purchase=state.purchases.find(x=>x.id===paymentButton.dataset.purchasePayment);
        if(!purchase)return;
        const balance=Math.max(0,n(purchase.totalCost)-n(purchase.paidAmount));
        openForm("Record supplier payment",[field("amount","Payment amount (UGX)","number",{min:0.01,step:"0.01",value:balance}),field("date","Payment date","date",{value:new Date().toISOString().slice(0,10)}),field("reference","Payment reference","text",{required:false})],v=>APP.recordPurchasePayment(purchase.id,v));
        return;
      }
      const removeDraft=e.target.closest("[data-draft-remove]");
      if(removeDraft){draftFormulaItems.splice(Number(removeDraft.dataset.draftRemove),1);renderDraftFormula();return;}
      const editFormula=e.target.closest("[data-formula-edit]");
      if(editFormula){
        const formula=state.formulas.find(x=>x.id===editFormula.dataset.formulaEdit && x.status==="active"); if(!formula)return;
        editingFormulaId=formula.id;
        draftFormulaItems=(formula.items||[]).map(x=>({ingredientId:x.ingredientId,name:x.name,quantity:n(x.quantity),unitPrice:n(x.unitPrice)}));
        if($("#formulaName"))$("#formulaName").value=formula.name||"";
        if($("#formulaStage"))$("#formulaStage").value=formula.stage||"";
        if($("#formulaTargetWeight"))$("#formulaTargetWeight").value=formula.targetWeight||formula.totalWeight||"";
        if($("#formulaNotes"))$("#formulaNotes").value=formula.notes||"";
        renderDraftFormula();notify(`Editing ${formula.name}. Save Formula to create a new version.`);return;
      }
      const archive=e.target.closest("[data-feed-delete=\"ingredient\"]"); if(archive){try{await APP.archiveIngredient(archive.dataset.id);refresh();notify("Ingredient archived in Supabase.");}catch(err){notify(err.message||"Could not archive ingredient online.");}return;}
      const button=e.target.closest("#addIngredientBtn,#addFeedSupplierBtn,#addFeedPurchaseBtn,#addStockAdjustmentBtn,#createFeedFormulaBtn,#addFormulaIngredientBtn,#saveFormulaDraftBtn,#saveFeedFormulaBtn,#addProductionRecordBtn,#allocateFeedBtn,#recordDailyFeedBtn,#recordFeedProductionBtn,#feedReportsBtn"); if(!button)return;
      if(button.id==="feedReportsBtn"){switchTab("reports");return;}
      if(button.id==="createFeedFormulaBtn"){clearFormulaEditor();notify("New formula draft started.");return;}
      if(button.id==="addFormulaIngredientBtn"){
        if(!state.ingredients.some(x=>x.active))return notify("Add ingredients to the catalogue first.");
        openForm("Add formula ingredient",[field("ingredientId","Ingredient","select",{options:ingredientOptions()}),field("quantity","Quantity in mix (kg)","number",{min:0.01,step:"0.01"}),field("unitPrice","Unit price (UGX/kg)","number",{min:0.01,step:"0.01"})],v=>{
          const ingredient=APP.getIngredient(v.ingredientId);if(!ingredient)throw new Error("Select a valid ingredient.");
          const existing=draftFormulaItems.find(x=>x.ingredientId===ingredient.id);
          if(existing){existing.quantity+=n(v.quantity);existing.unitPrice=n(v.unitPrice)||n(ingredient.currentPrice);}
          else draftFormulaItems.push({ingredientId:ingredient.id,name:ingredient.name,quantity:n(v.quantity),unitPrice:n(v.unitPrice)||n(ingredient.currentPrice)});
          renderDraftFormula();
        });
        const ingredientSelect=$("#feedEntryForm select[name='ingredientId']"),priceInput=$("#feedEntryForm input[name='unitPrice']");
        if(ingredientSelect&&priceInput){const updatePrice=()=>{const item=APP.getIngredient(ingredientSelect.value);if(item)priceInput.value=item.currentPrice||"";};ingredientSelect.addEventListener("change",updatePrice);updatePrice();}
        return;
      }
      if(button.id==="saveFormulaDraftBtn"){
        const draft={name:$("#formulaName")?.value||"",stage:$("#formulaStage")?.value||"",targetWeight:$("#formulaTargetWeight")?.value||"",notes:$("#formulaNotes")?.value||"",items:draftFormulaItems,editingFormulaId,savedAt:new Date().toISOString()};
        draftFormulaItems=Array.isArray(draft.items)?draft.items:[];editingFormulaId=draft.editingFormulaId||null;notify("Draft remains temporary in this page. Save the formula to store it in Supabase.");return;
      }
      if(button.id==="saveFeedFormulaBtn"){
        const name=$("#formulaName")?.value?.trim()||"",stage=$("#formulaStage")?.value||"custom";
        if(!name)return notify("Enter a formula name.");
        if(!draftFormulaItems.length)return notify("Add at least one ingredient before saving the formula.");
        const payload={name,stage,targetWeight:n($("#formulaTargetWeight")?.value),notes:$("#formulaNotes")?.value||"",items:draftFormulaItems.map(x=>({ingredientId:x.ingredientId,quantity:n(x.quantity),unitPrice:n(x.unitPrice)}))};
        const wasEditing=!!editingFormulaId;
        (async()=>{try{const saved=await (wasEditing?APP.reviseFormula(editingFormulaId,payload):APP.createFormula(payload));clearFormulaEditor();refresh();notify(`${saved.name} ${wasEditing?"revised":"saved"} to Supabase.`);}catch(err){notify(err.message||"Could not save formula online.");}})();
        return;
      }
      if(button.id==="addIngredientBtn") openForm("Add ingredient",[field("name","Ingredient name"),field("category","Category","select",{options:["energy","protein","minerals","vitamins","amino_acids","additives"].map(x=>({value:x,label:x}))}),field("currentPrice","Current price per kg (UGX)","number",{min:0,step:"0.01"}),field("protein","Crude protein (%)","number",{required:false,min:0,step:"0.01"}),field("energy","Metabolizable energy (kcal/kg)","number",{required:false,min:0,step:"0.01"})],v=>APP.addIngredient(v));
      if(button.id==="addFeedSupplierBtn") openForm("Add supplier",[field("name","Supplier name"),field("contact","Contact person","text",{required:false}),field("telephone","Telephone","tel",{required:false}),field("address","Location","text",{required:false}),field("notes","Payment terms / notes","text",{required:false})],v=>APP.addSupplier(v));
      if(button.id==="addFeedPurchaseBtn") openForm("Record ingredient purchase",[field("supplierId","Supplier","select",{options:supplierOptions()}),field("ingredientId","Ingredient","select",{options:ingredientOptions()}),field("invoiceNumber","Invoice / reference","text",{required:false}),field("quantity","Quantity (kg)","number",{min:0.01,step:"0.01"}),field("unitPrice","Price per kg (UGX)","number",{min:0.01,step:"0.01"}),field("transportCost","Transport cost (UGX)","number",{required:false,min:0,step:"0.01",value:0}),field("otherCost","Other cost (UGX)","number",{required:false,min:0,step:"0.01",value:0}),field("paidAmount","Amount paid now (UGX)","number",{required:false,min:0,step:"0.01",value:0}),field("date","Purchase date","date",{value:new Date().toISOString().slice(0,10)})],v=>APP.recordPurchase(v));
      if(button.id==="addStockAdjustmentBtn") openForm("Adjust raw-material stock",[field("ingredientId","Ingredient","select",{options:ingredientOptions()}),field("type","Movement","select",{options:[{value:"adjustment_in",label:"Stock increase"},{value:"adjustment_out",label:"Stock decrease"}]}),field("quantity","Quantity (kg)","number",{min:0.01,step:"0.01"}),field("reference","Reference / reason","text",{required:false})],v=>APP.addRawMovement(v));
      if(button.id==="addProductionRecordBtn"||button.id==="recordFeedProductionBtn") openForm("Record feed production",[field("formulaId","Formula","select",{options:formulaOptions()}),field("quantity","Quantity produced (kg)","number",{min:0.01,step:"0.01"}),field("batchNumber","Production lot","text",{required:false}),field("date","Production date","date",{value:new Date().toISOString().slice(0,10)})],v=>APP.produceFeed(v));
      if(button.id==="allocateFeedBtn") openForm("Allocate feed to batch",[field("batchId","Broiler batch","select",{options:batchOptions()}),field("formulaId","Feed formula","select",{options:formulaOptions()}),field("quantity","Quantity (kg)","number",{min:0.01,step:"0.01"}),field("costPerKg","Cost per kg (UGX)","number",{min:0,step:"0.01",value:0}),field("date","Allocation date","date",{value:new Date().toISOString().slice(0,10)})],v=>APP.allocateFeed(v));
      if(button.id==="recordDailyFeedBtn") {const allocations=state.allocations.map(x=>({value:x.id,label:`${APP.getBatch(x.batchId)?.name||"Batch"} · ${state.formulas.find(f=>f.id===x.formulaId)?.name||"Feed"} · ${fmt(x.quantity)} kg`})); openForm("Record feed consumption",[field("batchId","Batch","select",{options:batchOptions()}),field("allocationId","Feed allocation","select",{options:allocations}),field("quantity","Quantity consumed (kg)","number",{min:0.01,step:"0.01"}),field("date","Date","date",{value:new Date().toISOString().slice(0,10)})],async v=>{const record=await APP.recordConsumption(v);await syncFeedConsumptionToBroiler(record);});}
    });
    $("#runFeedSensitivityBtn")?.addEventListener("click",()=>{const id=$("#sensitivityIngredient")?.value;const change=n($("#sensitivityPriceChange")?.value);const formula=state.formulas.find(f=>f.status==="active");const out=$("#feedSensitivityResults");if(!out)return;if(!formula)return out.textContent="Create a formula first.";try{const result=APP.formulaPriceSimulation(formula.id,{[id]:change});out.textContent=`Estimated formula cost: ${money(result.simulatedCostPerKg)} per kg (${result.percentageChange>=0?"+":""}${fmt(result.percentageChange)}%).`; }catch(err){out.textContent=err.message;}});
    $("#calculateFeedForecastBtn")?.addEventListener("click",()=>{
      const batchId=$("#forecastBatch")?.value;
      const days=n($("#forecastPeriod")?.value)||7;
      if(!batchId)return notify("Select a batch for the forecast.");
      try{
        const baseline=APP.forecastBatch(batchId,days);
        const batch=APP.getBatch(batchId);
        const birdsInput=$("#forecastBirds")?.value;
        const dailyInput=$("#forecastDailyConsumption")?.value;
        const priceInput=$("#forecastFeedPrice")?.value;
        const hasCustom=[birdsInput,dailyInput,priceInput].some(v=>String(v||"").trim()!=="");
        let requirement=n(baseline.projectedFeedRequirement);
        let estimatedCost=n(baseline.estimatedFeedCost);
        let shortage=n(baseline.projectedAdditionalFeed);
        if(hasCustom){
          const birds=birdsInput!==""?Math.max(0,n(birdsInput)):APP.liveBirds(batchId);
          const daily=dailyInput!==""?Math.max(0,n(dailyInput)):requirement/Math.max(1,days*Math.max(1,birds));
          const price=priceInput!==""?Math.max(0,n(priceInput)):(requirement>0?estimatedCost/requirement:0);
          requirement=birds*daily*days;
          estimatedCost=requirement*price;
          const stock=state.formulas.reduce((sum,f)=>sum+Math.max(0,APP.finishedStock(f.id)),0);
          shortage=Math.max(0,requirement-stock);
        }
        setText("forecastFeedRequirement",`${fmt(requirement)} kg`);
        setText("forecastFeedCost",money(estimatedCost));
        setText("forecastFeedShortage",`${fmt(shortage)} kg`);
        notify("Feed forecast calculated using the selected assumptions.");
      }catch(err){notify(err.message);}
    });
    $("#runFeedScenarioBtn")?.addEventListener("click",()=>{
      const out=$("#feedScenarioResults");
      const batchId=$("#forecastBatch")?.value;
      if(!out)return;
      if(!batchId){out.textContent="Select a batch and calculate a forecast before comparing scenarios.";return;}
      try{
        const days=n($("#forecastPeriod")?.value)||7;
        const baseline=APP.forecastBatch(batchId,days);
        const batch=APP.getBatch(batchId);
        const priceChange=n($("#scenarioFeedPrice")?.value)/100;
        const mortalityChange=Math.min(100,Math.max(0,n($("#scenarioMortality")?.value)))/100;
        const saleChange=n($("#scenarioSalePrice")?.value)/100;
        const baseBirds=APP.liveBirds(batchId);
        const adjustedBirds=baseBirds*(1-mortalityChange);
        const baselineFeed=n(baseline.projectedFeedRequirement);
        const scenarioFeed=baselineFeed*(1-mortalityChange);
        const baselineCost=n(baseline.estimatedFeedCost);
        const scenarioCost=baselineCost*(1-mortalityChange)*(1+priceChange);
        const revenueUnits=batch?.priceBasis==="kg"
          ? n(batch?.targetWeight)*baseBirds
          : baseBirds;
        const baseRevenue=revenueUnits*n(batch?.expectedPrice);
        const scenarioRevenue=revenueUnits*(1-mortalityChange)*n(batch?.expectedPrice)*(1+saleChange);
        out.innerHTML=`<div class="feed-scenario-grid"><div><small>Baseline feed cost</small><strong>${money(baselineCost)}</strong></div><div><small>Scenario feed cost</small><strong>${money(scenarioCost)}</strong></div><div><small>Baseline birds</small><strong>${fmt(baseBirds)}</strong></div><div><small>Scenario birds</small><strong>${fmt(adjustedBirds)}</strong></div><div><small>Baseline indicative revenue</small><strong>${money(baseRevenue)}</strong></div><div><small>Scenario indicative revenue</small><strong>${money(scenarioRevenue)}</strong></div></div><p class="form-help">Illustrative comparison only. It applies the entered percentage assumptions to the selected batch's current forecast and expected selling price; it is not a guaranteed outcome.</p>`;
      }catch(err){out.textContent=err.message;}
    });
    $$('[data-feed-report]').forEach(btn=>btn.addEventListener("click",()=>{
      const type=btn.dataset.feedReport;
      const out=$("#feedReportOutput");
      if(!out)return;
      const reportMap={
        inventory:{headers:["Ingredient","Category","Unit","Current price (UGX/kg)","Stock (kg)"],rows:state.ingredients.filter(x=>x.active).map(x=>[x.name,x.category,x.unit||"kg",x.currentPrice,APP.rawStock(x.id)])},
        formulation:{headers:["Formula","Stage","Version","Ingredient","Quantity (kg)","Unit price (UGX)","Cost (UGX)","Inclusion (%)"],rows:state.formulas.flatMap(f=>(f.items||[]).map(i=>[f.name,f.stage,f.version,i.name,i.quantity,i.unitPrice,i.cost,i.inclusionRate]))},
        production:{headers:["Date","Production lot","Formula","Quantity (kg)","Cost (UGX)","Cost/kg (UGX)"],rows:state.production.map(x=>[x.date,x.batchNumber,state.formulas.find(f=>f.id===x.formulaId)?.name||"",x.quantity,x.productionCost,x.costPerKg])},
        consumption:{headers:["Date","Batch","Type","Quantity (kg)","Allocation"],rows:state.consumption.map(x=>[x.date,APP.getBatch(x.batchId)?.name||"",x.type,x.quantity,x.allocationId||""])},
        financial:{headers:["Date","Transaction","Description","Amount (UGX)"],rows:[...state.purchases.map(x=>[x.date,"Purchase",APP.getIngredient(x.ingredientId)?.name||"",x.totalCost]),...state.production.map(x=>[x.date,"Production","Feed production",x.productionCost])]},
        prices:{headers:["Purchase date","Supplier","Ingredient","Quantity (kg)","Unit price (UGX/kg)","Total (UGX)"],rows:state.purchases.map(x=>[x.date,APP.getSupplier(x.supplierId)?.name||"",APP.getIngredient(x.ingredientId)?.name||"",x.quantity,x.unitPrice,x.totalCost])}
      };
      const report=reportMap[type]||reportMap.inventory;
      const csv=[report.headers,...report.rows].map(row=>row.map(value=>`"${String(value??"").replace(/"/g,'""')}"`).join(",")).join("\\n");
      const blob=new Blob(["\\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
      const url=URL.createObjectURL(blob);
      const link=document.createElement("a");
      link.href=url;link.download=`agripredict_feed_${type}_report.csv`;
      document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);
      out.innerHTML=`<div class="feed-report-confirmation"><strong>${esc(type)} report generated</strong><p>${report.rows.length} record(s) included. Your CSV download should begin automatically.</p></div>`;
      notify(`${type.charAt(0).toUpperCase()+type.slice(1)} report generated.`);
    }));
    $("#ingredientSearch")?.addEventListener("input",e=>{$$("#ingredientTableBody tr").forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(e.target.value.toLowerCase()));});
    $("#ingredientCategoryFilter")?.addEventListener("change",e=>{$$("#ingredientTableBody tr").forEach(row=>row.hidden=!!e.target.value&&!row.textContent.toLowerCase().includes(e.target.value.toLowerCase()));});
    const filterConsumption=()=>{const batchId=$("#feedConsumptionBatchFilter")?.value||"";const from=$("#feedConsumptionStartDate")?.value||"";const to=$("#feedConsumptionEndDate")?.value||"";const rows=state.consumption.filter(x=>x.type==="feed"&&(!batchId||x.batchId===batchId)&&(!from||x.date>=from)&&(!to||x.date<=to));renderTable("#dailyFeedConsumptionTableBody",Array(10).fill(""),rows.map(x=>{const allocation=state.allocations.find(a=>a.id===x.allocationId);const prior=state.consumption.filter(c=>c.type==="feed"&&c.allocationId===x.allocationId&&(String(c.date)<String(x.date)||(c.date===x.date&&String(c.createdAt)<String(x.createdAt)))).reduce((sum,c)=>sum+n(c.quantity),0);const opening=Math.max(0,n(allocation?.quantity)-prior),closing=Math.max(0,opening-n(x.quantity)),birds=APP.liveBirds(x.batchId);return [date(x.date),esc(APP.getBatch(x.batchId)?.name||"—"),`${APP.batchAge(APP.getBatch(x.batchId),x.date)} days`,esc(state.formulas.find(f=>f.id===allocation?.formulaId)?.name||"—"),`${fmt(opening)} kg`,`${fmt(x.quantity)} kg`,`${fmt(closing)} kg`,fmt(birds),`${fmt(birds>0?n(x.quantity)/birds:0)} kg`,"—"];}),"No feed consumption matches these filters.");};
    $("#filterFeedConsumptionBtn")?.addEventListener("click",filterConsumption);
  }
  function refresh(batch) { if(batch) currentBatch(); render(); }
  async function initialise() {
    if (typeof APP.hydrate === "function") await APP.hydrate();
    currentBatch();
    bind();
    document.addEventListener("agripredict:feed-data-updated", () => render());
    document.addEventListener("agripredict:cloud-save-error", event => {
      if (event.detail?.module === "feed") notify("Feed cloud sync failed: " + (event.detail.message || "Check your connection."));
    });
    document.addEventListener("agripredict:cloud-load-error", event => {
      if (event.detail?.module === "feed") notify("Feed records could not be loaded online: " + (event.detail.message || "Check your connection."));
    });

    const savedTab=state.activeTab;
    switchTab($("#feedTab-"+savedTab)?savedTab:"dashboard");
    const raw=$("#inventoryTab-raw");
    if(raw){$$(".inventory-tab-content").forEach(panel=>{const active=panel.id==="inventoryTab-raw";panel.classList.toggle("active",active);panel.hidden=!active;});}
    render();
    if(draftFormulaItems.length)renderDraftFormula();
  }
  window.AgriPredictFeedUI={refresh,render,initialise};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initialise,{once:true});else initialise();
})();
