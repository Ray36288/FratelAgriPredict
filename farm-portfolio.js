/* =========================================================
   AGRIPREDICT — WHOLE-FARM PORTFOLIO & COST INTELLIGENCE
   Reads farm records from authenticated Supabase tables.
   Other enterprise modules can publish through the registry API below.
========================================================= */
(() => {
  "use strict";

  let portfolioOwnerId = null;
  const PERIODS = [
    {days:7,label:"7 days"},
    {days:14,label:"14 days"},
    {days:30,label:"1 month"},
    {days:365,label:"1 year"},
    {days:730,label:"2 years"},
    {days:3650,label:"10 years"}
  ];
  const currency = value => `UGX ${Math.round(Number(value)||0).toLocaleString("en-UG")}`;
  const number = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const localISODate = date => {
    const d = date || new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0,10);
  };
  const daysAgo = n => {
    const d = new Date();
    d.setHours(12,0,0,0);
    d.setDate(d.getDate() - n);
    return localISODate(d);
  };
  const today = localISODate(new Date());
  const startDate = daysAgo(29);
  const dateInWindow = value => {
    const date = String(value || "").slice(0,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= startDate && date <= today;
  };
  const text = (id,value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };

  let enrolledProjects = [];
  let enrolledRows = [];
  const sourceProviders = new Map();
  let latestModel = null;
  let cloudPortfolio = null;
  let cloudPortfolioPromise = null;

  function readBroiler() {
    if (window.FratelAgriPredictDashboard?.getData) return window.FratelAgriPredictDashboard.getData();
    return cloudPortfolio?.broilerBatches ? { batches: cloudPortfolio.broilerBatches } : { batches: [] };
  }
  function readFeed() {
    if (window.AgriPredictFeed?.state) return window.AgriPredictFeed.state;
    return cloudPortfolio?.feedState || {};
  }

  async function hydrateCloudPortfolio() {
    if (cloudPortfolioPromise) return cloudPortfolioPromise;
    if (!window.FratelCloud) {
      const status = document.getElementById("inventorySourceNote");
      if (status) status.textContent = "Supabase data service is unavailable.";
      return false;
    }
    cloudPortfolioPromise = (async () => {
      const { user } = await window.FratelCloud.ready();
      portfolioOwnerId = user.id;
      const [broilerBatches, feedState, portfolioData] = await Promise.all([
        window.FratelCloud.loadLivestockBatches("broiler", false),
        window.FratelCloud.loadFeedState(false),
        window.FratelCloud.loadPortfolioData(false)
      ]);
      cloudPortfolio = {
        broilerBatches: Array.isArray(broilerBatches) ? broilerBatches : [],
        feedState: feedState || {},
        inventory: Array.isArray(portfolioData?.inventory) ? portfolioData.inventory : [],
        expenses: Array.isArray(portfolioData?.expenses) ? portfolioData.expenses : []
      };
      render();
      return true;
    })().catch(error => {
      cloudPortfolioPromise = null;
      console.warn("Farm portfolio could not load cloud records:", error);
      const status = document.getElementById("inventorySourceNote");
      if (status) status.textContent = "Online farm records could not be loaded. Please check your sign-in and internet connection.";
      return false;
    });
    return cloudPortfolioPromise;
  }

  function normaliseProject(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  }
  function projectSlug(project) {
    return normaliseProject(project?.slug || project?.name);
  }
  function enterpriseGroup(slug) {
    const value=normaliseProject(slug);
    if(value.includes("broiler")) return "broiler";
    if(value.includes("croiler")) return "croiler";
    if(value.includes("layer")) return "layer";
    if(value.includes("pig")) return "pig";
    if(value.includes("dairy") || value.includes("cattle") || value.includes("cow")) return "cattle";
    if(value.includes("fish")) return "fish";
    if(value.includes("crop")) return "crop";
    return value;
  }
  function projectLabel(slug) {
    const names = {
      broiler:"Broiler birds", "broiler-farming":"Broiler birds",
      croiler:"Croiler birds", "croiler-farming":"Croiler birds",
      layer:"Layer birds", layers:"Layer birds", "layer-farming":"Layer birds",
      pig:"Pigs", pigs:"Pigs", piggery:"Pigs", "piggery-farming":"Pigs",
      cow:"Cattle", cattle:"Cattle", cows:"Cattle", dairy:"Cattle", "dairy-farming":"Cattle",
      fish:"Fish", fishes:"Fish", "fish-farming":"Fish"
    };
    return names[slug] || slug.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase());
  }
  function broilerBatches() {
    const saved = readBroiler();
    return Array.isArray(saved.batches) ? saved.batches.filter(Boolean) : [];
  }
  function liveBirds(batch) {
    const records = Array.isArray(batch.records) ? batch.records : [];
    const deaths = records.filter(r=>r?.type==="mortality").reduce((s,r)=>s+number(r.quantity),0);
    const sales = records.filter(r=>r?.type==="sale").reduce((s,r)=>s+number(r.quantity),0);
    return Math.max(0,number(batch.initialBirds)-deaths-sales);
  }

  function getInventory() {
    const rows = [];
    const batches = broilerBatches();
    const broilerCount = batches.reduce((s,b)=>s+liveBirds(b),0);
    if (batches.length) rows.push({slug:"broiler",label:"Broiler birds",count:broilerCount,detail:`${batches.length} recorded batch${batches.length===1?"":"es"}`,source:"Broiler Management"});

    const cloudGeneric = Array.isArray(cloudPortfolio?.inventory) ? cloudPortfolio.inventory : [];
    const generic = cloudGeneric;
    const extraByType = new Map();
    generic.forEach(item => {
      if (!item || typeof item !== "object") return;
      const slug = normaliseProject(item.enterprise || item.projectSlug || item.project || item.species || item.type || item.category);
      if (!slug || slug.includes("crop")) return;
      // Broiler inventory is already calculated from the canonical broiler batch store.
      if (slug.includes("broiler")) return;
      const qtyValue = item.currentQuantity ?? item.liveCount ?? item.quantity ?? item.count ?? item.currentStock;
      const qty = Number(qtyValue);
      if (!Number.isFinite(qty) || qty < 0) return;
      extraByType.set(slug,(extraByType.get(slug)||0)+qty);
    });
    extraByType.forEach((count,slug)=>rows.push({slug,label:projectLabel(slug),count,detail:"Connected inventory records",source:"Farm inventory registry"}));

    for (const [slug,provider] of sourceProviders) {
      try {
        const result = provider() || {};
        const items = Array.isArray(result.inventory) ? result.inventory : [];
        const count = items.reduce((s,item)=>s+number(item.currentQuantity ?? item.liveCount ?? item.quantity ?? item.count),0);
        if (items.length) rows.push({slug,label:projectLabel(slug),count,detail:`${items.length} inventory record${items.length===1?"":"s"}`,source:"Enterprise module"});
      } catch (error) { console.warn(`Inventory provider ${slug} failed:`,error); }
    }
    return rows;
  }

  function categoryFor(value) {
    const label = String(value || "other").toLowerCase();
    if (label.includes("feed") || label.includes("ration")) return "feed";
    if (label.includes("labour") || label.includes("labor") || label.includes("salary") || label.includes("wage") || label.includes("staff")) return "labour";
    if (label.includes("vet") || label.includes("health") || label.includes("medicat") || label.includes("vaccine") || label.includes("drug")) return "veterinary";
    return "other";
  }

  function getTransactions() {
    const transactions = [];
    const seen = new Set();
    const push = tx => {
      if (!tx || !Number.isFinite(Number(tx.amount)) || Number(tx.amount) < 0) return;
      const id = tx.id ? String(tx.id) : `${tx.date}|${tx.category}|${tx.amount}|${tx.description||""}`;
      if (seen.has(id)) return;
      seen.add(id);
      transactions.push({...tx,amount:Number(tx.amount)});
    };

    broilerBatches().forEach(batch => {
      const records = Array.isArray(batch.records) ? batch.records : [];
      records.forEach(record => {
        if (!record || !record.date) return;
        if (record.type === "feed") {
          const amount = number(record.totalCost) || number(record.quantity)*number(record.unitPrice);
          if (amount > 0) push({id:record.id,date:record.date,category:"feed",amount,description:`${batch.name||"Broiler batch"} · ${record.feedType||"Feed use"}`,enterprise:"broiler"});
        } else if (record.type === "expense") {
          const amount = number(record.amount);
          if (amount > 0) push({id:record.id,date:record.date,category:categoryFor(record.category),amount,description:record.description||record.category||"Farm expense",enterprise:"broiler"});
        } else if (record.type === "health") {
          const amount = number(record.cost);
          if (amount > 0) push({id:record.id,date:record.date,category:"veterinary",amount,description:record.description||record.eventType||"Health cost",enterprise:"broiler"});
        }
      });
      const chickCost = number(batch.initialBirds)*number(batch.chickCost);
      if (chickCost > 0 && batch.placementDate) push({id:`${batch.id}-chicks`,date:batch.placementDate,category:"other",amount:chickCost,description:`${batch.name||"Broiler batch"} · Initial chick purchase`,enterprise:"broiler",oneOff:true});
    });

    // Feed-management consumption is used only when a matching feed record was not
    // already synchronized into the broiler batch ledger.
    const feedState = readFeed();
    const consumption = Array.isArray(feedState.consumption) ? feedState.consumption : [];
    const allocations = Array.isArray(feedState.allocations) ? feedState.allocations : [];
    const broilerRecordIds = new Set(broilerBatches().flatMap(b=>(b.records||[]).filter(r=>r.type==="feed").map(r=>String(r.id))));
    consumption.filter(r=>r?.type==="feed").forEach(record=>{
      if (broilerRecordIds.has(String(record.id))) return;
      const allocation = allocations.find(a=>a.id===record.allocationId);
      const unitCost = number(allocation?.costPerKg) || (number(allocation?.totalCost)/Math.max(1,number(allocation?.quantity)));
      const amount = number(record.quantity)*unitCost;
      if (amount>0) push({id:record.id,date:record.date,category:"feed",amount,description:"Feed Management consumption",enterprise:"broiler"});
    });

    (cloudPortfolio?.expenses || []).filter(item => item.transactionType !== "income" && item.category !== "feed_purchase_payment").forEach(item => {
      push({id:item.id,date:item.date,category:categoryFor(item.category),amount:item.amount,description:item.description,enterprise:item.enterprise||"farm"});
    });

    for (const [slug,provider] of sourceProviders) {
      try {
        const result = provider() || {};
        (Array.isArray(result.expenses)?result.expenses:[]).forEach(item=>{
          const amount=Number(item.amount??item.cost??item.totalCost);
          if (!item.date || !Number.isFinite(amount) || amount<0) return;
          push({id:item.id?`${slug}:${item.id}`:undefined,date:item.date,category:categoryFor(item.category||item.type),amount,description:item.description||item.category||"Farm expense",enterprise:slug});
        });
      } catch(error) { console.warn(`Expense provider ${slug} failed:`,error); }
    }
    return transactions.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  }

  function buildModel() {
    const inventory = getInventory();
    const transactions = getTransactions();
    const recent = transactions.filter(t=>dateInWindow(t.date));
    const categories = ["feed","labour","veterinary","other"];
    const sums = Object.fromEntries(categories.map(category=>[category,recent.filter(t=>t.category===category && !t.oneOff).reduce((s,t)=>s+t.amount,0)]));
    const totals = Object.fromEntries(categories.map(category=>[category,sums[category]/30]));
    const historicalTotal = transactions.reduce((s,t)=>s+t.amount,0);
    const recentOperating = recent.filter(t=>!t.oneOff).reduce((s,t)=>s+t.amount,0);
    const recentRecords = recent.filter(t=>!t.oneOff).length;
    const categoryRecentCount = Object.fromEntries(categories.map(category=>[category,recent.filter(t=>t.category===category && !t.oneOff).length]));
    const dailyTotal = categories.reduce((s,category)=>s+totals[category],0);
    const providers = sourceProviders.size;
    return {inventory,transactions,recent,sums,totals,historicalTotal,recentOperating,recentRecords,categoryRecentCount,dailyTotal,providers};
  }

  function renderInventory(model) {
    const grid = document.getElementById("farmInventoryGrid");
    const knownTotal = model.inventory.reduce((s,row)=>s+row.count,0);
    text("totalLivestockCount",model.inventory.length ? Math.round(knownTotal).toLocaleString("en-UG") : "No data");
    text("performanceLivestockTotal",model.inventory.length ? Math.round(knownTotal).toLocaleString("en-UG") : "No data");
    if (!grid) return;
    const enrolledSlugs = enrolledProjects.map(projectSlug).filter(Boolean);
    const knownGroups = new Set(model.inventory.map(row=>enterpriseGroup(row.slug)));
    const placeholders = enrolledSlugs.filter(slug=>enterpriseGroup(slug)!=="crop" && !knownGroups.has(enterpriseGroup(slug)));
    const cards = model.inventory.map((row,index)=>`<article class="inventory-card inventory-tone-${index%5}"><span class="inventory-card-icon">${row.slug.includes("fish")?"🐟":row.slug.includes("dairy")||row.slug.includes("cattle")?"🐄":row.slug.includes("pig")?"🐖":row.slug.includes("layer")||row.slug.includes("chicken")?"🐔":"🐤"}</span><div><span class="inventory-label">${escapeHTML(row.label)}</span><strong>${Math.round(row.count).toLocaleString("en-UG")}</strong><small>${escapeHTML(row.detail)}</small></div></article>`);
    const missing = placeholders.map(slug=>`<article class="inventory-card inventory-pending"><span class="inventory-card-icon">＋</span><div><span class="inventory-label">${escapeHTML(projectLabel(slug))}</span><strong>—</strong><small>Project enrolled · inventory records not connected</small></div></article>`);
    grid.innerHTML = cards.concat(missing).join("") || `<div class="inventory-placeholder">No livestock inventory records have been connected yet. Broiler batches are read from this browser's saved farm records.</div>`;
    const status = document.getElementById("inventorySourceStatus");
    if(status) { status.textContent=model.inventory.length?`${model.inventory.length} connected stock group${model.inventory.length===1?"":"s"}`:"No inventory source"; status.classList.toggle("source-ready",model.inventory.length>0); }
    text("inventorySourceNote",model.inventory.length?`Recorded inventory totals ${Math.round(knownTotal).toLocaleString("en-UG")} live animals/birds across connected records. Enrolled projects without inventory data are shown as not connected, not counted as zero.`:"No inventory module has published livestock counts yet. Project enrolments alone are not used to invent animal quantities.");
  }

  function renderActivity(model) {
    const container=document.getElementById("recentFarmActivity");
    if(!container)return;
    const items=model.transactions.slice(0,5);
    container.innerHTML=items.length?items.map(tx=>`<div class="activity-row"><span class="activity-dot ${tx.category}"></span><div class="activity-main"><strong>${escapeHTML(tx.description||tx.category)}</strong><small>${escapeHTML(tx.date)} · ${escapeHTML(tx.enterprise||"Farm")}</small></div><b>${currency(tx.amount)}</b></div>`).join(""):`<div class="empty-state compact-empty"><span class="empty-state-icon">📋</span><h4>No expense activity connected</h4><p>Recorded feed use, labour, health and other farm costs will appear here.</p></div>`;
  }

  function renderPerformance(model) {
    text("totalExpenses",model.transactions.length?currency(model.historicalTotal):"No records");
    text("performanceRecordedCosts",model.transactions.length?currency(model.historicalTotal):"No records");
    text("performanceFeedCost30",model.categoryRecentCount.feed?currency(model.sums.feed):"No records");
    text("performanceDailyRunRate",model.recentRecords?currency(model.dailyTotal):"No recent records");
    const fin=document.getElementById("financialPerformance");
    if(fin) {
      const totals=[
        ["Feed use",model.sums.feed,"feed"],
        ["Labour",model.sums.labour,"labour"],
        ["Veterinary / health",model.sums.veterinary,"veterinary"],
        ["Other operating costs",model.sums.other,"other"]
      ];
      fin.innerHTML=totals.map(([name,value,key])=>`<div class="breakdown-row"><span>${name}</span><strong>${model.categoryRecentCount[key]?currency(value):"No recent records"}</strong></div>`).join("")+`<p class="data-note">Showing recorded operating costs from ${startDate} to ${today}.</p>`;
    }
    const prod=document.getElementById("productionPerformance");
    if(prod) {
      prod.innerHTML=model.inventory.length?model.inventory.map(row=>`<div class="breakdown-row"><span>${escapeHTML(row.label)}</span><strong>${Math.round(row.count).toLocaleString("en-UG")} recorded</strong></div>`).join(""):`<div class="empty-state compact-empty"><span class="empty-state-icon">📊</span><h4>No connected stock records</h4><p>Broiler batches and future enterprise inventory adapters will appear here.</p></div>`;
    }
  }

  function scenarioValues(model) {
    const delta = key => number(document.getElementById(`scenario${key}Delta`)?.value);
    const categories = {
      feed: Math.max(0,model.totals.feed+delta("Feed")),
      labour: Math.max(0,model.totals.labour+delta("Labour")),
      // The other-cost adjustment applies to the combined veterinary,
      // utilities, transport and miscellaneous daily-cost group.
      other: Math.max(0,model.totals.veterinary+model.totals.other+delta("Other"))
    };
    const baseline=model.dailyTotal;
    const simulated=Object.values(categories).reduce((s,v)=>s+v,0);
    return {categories,baseline,simulated,delta:simulated-baseline};
  }

  function renderForecast(model) {
    const hasRecent=model.recentRecords>0;
    text("forecastCount",hasRecent?PERIODS.length:"0");
    text("forecastDailyFeed",model.categoryRecentCount.feed?currency(model.totals.feed):"No data");
    text("forecastDailyLabour",model.categoryRecentCount.labour?currency(model.totals.labour):"No data");
    const otherCount=model.categoryRecentCount.veterinary+model.categoryRecentCount.other;
    text("forecastDailyOther",otherCount?currency(model.totals.veterinary+model.totals.other):"No data");
    text("forecastDailyTotal",hasRecent?currency(model.dailyTotal):"No data");
    text("forecastFeedNote",model.categoryRecentCount.feed?`${model.categoryRecentCount.feed} feed-use record(s) in last 30 days`:"No feed-use records in last 30 days");
    text("forecastDataWindow",hasRecent?`${model.recentRecords} cost records · last 30 days`:"No cost records in the last 30 days");
    const badge=document.getElementById("forecastCoverageBadge");
    if(badge){badge.textContent=hasRecent?"Using recorded costs":"Waiting for records";badge.classList.toggle("source-ready",hasRecent);}
    const mix=document.getElementById("dailySpendMixChart");
    if(mix) {
      const parts=[
        {key:"feed",label:"Feed",value:model.totals.feed,color:"#22C55E"},
        {key:"labour",label:"Labour",value:model.totals.labour,color:"#38BDF8"},
        {key:"veterinary",label:"Veterinary / health",value:model.totals.veterinary,color:"#F97316"},
        {key:"other",label:"Other",value:model.totals.other,color:"#8B5CF6"}
      ];
      const max=Math.max(1,...parts.map(part=>part.value));
      mix.innerHTML=hasRecent?parts.map(part=>`<div class="mix-row"><div class="mix-row-head"><span>${part.label}</span><strong>${model.categoryRecentCount[part.key]?currency(part.value)+" / day":"No recent records"}</strong></div><div class="mix-track"><span style="width:${Math.max(0,Math.min(100,part.value/max*100))}%;background:${part.color}"></span></div></div>`).join(""):`<div class="inventory-placeholder">No recent expense records are available to build the daily cost breakdown.</div>`;
    }
    const rows=document.getElementById("farmForecastRows");
    if(rows) rows.innerHTML=hasRecent?PERIODS.map(period=>{
      const feed=model.totals.feed*period.days,labour=model.totals.labour*period.days,vet=model.totals.veterinary*period.days,other=model.totals.other*period.days;
      return `<tr><td><strong>${period.label}</strong><small>${period.days.toLocaleString("en-UG")} days</small></td><td>${currency(feed)}</td><td>${currency(labour)}</td><td>${currency(vet+other)}</td><td><strong>${currency(feed+labour+vet+other)}</strong></td></tr>`;
    }).join(""):`<tr><td colspan="5" class="table-empty">No operating expense or feed-use entries were recorded during the last 30 days. Add actual daily entries to establish a spending run-rate.</td></tr>`;

    const scenario=scenarioValues(model);
    text("scenarioDailyTotal",hasRecent?currency(scenario.simulated):"No baseline");
    const percent=model.dailyTotal>0?scenario.delta/model.dailyTotal*100:0;
    text("scenarioDailyChange",hasRecent?(scenario.delta===0?"No adjustment applied":`${scenario.delta>0?"Increase":"Reduction"} of ${currency(Math.abs(scenario.delta))}/day (${percent>=0?"+":""}${percent.toFixed(1)}%)`):"Record daily costs before simulating");
    const annualImpact=scenario.delta*365;
    text("scenarioAnnualImpact",hasRecent?`${annualImpact>0?"+":""}${currency(annualImpact)}`:"No baseline");
    const scenarioRows=document.getElementById("scenarioForecastRows");
    if(scenarioRows) scenarioRows.innerHTML=hasRecent?PERIODS.map(period=>{
      const baseline=model.dailyTotal*period.days;
      const simulated=scenario.simulated*period.days;
      const diff=simulated-baseline;
      return `<tr><td><strong>${period.label}</strong></td><td>${currency(baseline)}</td><td><strong>${currency(simulated)}</strong></td><td class="${diff>0?"amount-up":diff<0?"amount-down":""}">${diff>0?"+":""}${currency(diff)}</td></tr>`;
    }).join(""):`<tr><td colspan="4" class="table-empty">A recorded daily baseline is needed before comparing scenarios.</td></tr>`;
  }

  function renderProjectsSummary() {
    const container=document.getElementById("dashboardProjectSummary");
    if(!container || !enrolledProjects.length)return;
    container.innerHTML=enrolledProjects.slice(0,5).map(project=>`<div class="project-summary-item"><div><strong>${escapeHTML(project.name||"Agricultural project")}</strong><span>${escapeHTML(project.category||"Enrolled project")}</span></div><span class="enrollment-status">Active</span></div>`).join("");
  }

  function render() {
    if(!document.body.classList.contains("dashboard-page"))return;
    const model=buildModel(); latestModel=model;
    renderInventory(model); renderActivity(model); renderPerformance(model); renderForecast(model); renderProjectsSummary();
  }

  function setProjects(projects,enrollments) {
    enrolledProjects=Array.isArray(projects)?projects:[];
    enrolledRows=Array.isArray(enrollments)?enrollments:[];
    render();
  }
  function registerSource(slug,provider) {
    if(!slug || typeof provider!=="function") throw new TypeError("Register an enterprise source with a slug and provider function.");
    sourceProviders.set(normaliseProject(slug),provider);
    render();
  }
  async function publishInventory(records) {
    if (!window.FratelCloud) throw new Error("Supabase inventory storage is unavailable.");
    const saved = Array.isArray(records) ? records : [];
    const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    saved.forEach(item=>{
      if(item && typeof item==="object"){
        if(!uuidPattern.test(String(item.id||"")))item.id=crypto.randomUUID();
        (Array.isArray(item.movements)?item.movements:[]).forEach(m=>{
          if(m && typeof m==="object" && !uuidPattern.test(String(m.id||"")))m.id=crypto.randomUUID();
        });
      }
    });
    const {user}=await window.FratelCloud.ready();
    if(portfolioOwnerId && portfolioOwnerId!==user.id)throw new Error("The signed-in farmer changed. Reload before saving inventory.");
    portfolioOwnerId=user.id;
    await window.FratelCloud.savePortfolioInventory(saved);
    cloudPortfolioPromise=null;
    await hydrateCloudPortfolio();
    window.dispatchEvent(new CustomEvent("agripredict:farm-records-updated"));
    return saved;
  }

  async function publishExpenses(records) {
    if (!window.FratelCloud) throw new Error("Supabase expense storage is unavailable.");
    const saved = Array.isArray(records) ? records : [];
    const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    saved.forEach(item=>{
      if(item && typeof item==="object" && !uuidPattern.test(String(item.id||"")))item.id=crypto.randomUUID();
    });
    const {user}=await window.FratelCloud.ready();
    if(portfolioOwnerId && portfolioOwnerId!==user.id)throw new Error("The signed-in farmer changed. Reload before saving expenses.");
    portfolioOwnerId=user.id;
    await window.FratelCloud.savePortfolioExpenses(saved);
    cloudPortfolioPromise=null;
    await hydrateCloudPortfolio();
    window.dispatchEvent(new CustomEvent("agripredict:farm-records-updated"));
    return saved;
  }

  window.AgriPredictFarmPortfolio = {render,setProjects,registerSource,publishInventory,publishExpenses,getSnapshot:()=>latestModel||buildModel(),keys:{...KEYS},periods:[...PERIODS],refreshCloud:hydrateCloudPortfolio};
  hydrateCloudPortfolio();
  window.addEventListener("focus", () => { cloudPortfolioPromise = null; hydrateCloudPortfolio(); });
})();
