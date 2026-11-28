/* ============================================================
   FRATEL-AGRIPREDICT — AGRICULTURAL FORECASTING INTELLIGENCE
   Data-led forecasting using recorded farm transactions.
   Forecast period: farmer-selected days, weeks or months.
   Currency: UGX. Landed ingredient costs are used throughout.

   Important: outputs are estimates, not guarantees. The module
   never creates synthetic historical observations. Sparse data
   is reported as insufficient rather than silently imputed.
============================================================ */
(() => {
  "use strict";

  const FEED = window.AgriPredictFeed;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const HORIZONS = [7, 14, 30, 60, 90];
  const BROILER_KEY = "agripredict_broiler_v1";
  let latestForecastSnapshot = null;
  const fmt = value => Number(value || 0).toLocaleString("en-UG", { maximumFractionDigits: 2 });
  const money = value => `UGX ${Math.round(Number(value || 0)).toLocaleString("en-UG")}`;
  function horizonSettings() {
    const unit = $("#afiHorizonUnit")?.value || "months";
    const maxAmount = unit === "days" ? 3650 : unit === "weeks" ? 520 : 120;
    const amountInput = $("#afiHorizonAmount");
    if (amountInput) amountInput.max = String(maxAmount);
    const amount = Math.min(maxAmount, Math.max(1, Math.round(Number(amountInput?.value) || 1)));
    if (amountInput && Number(amountInput.value) !== amount) amountInput.value = String(amount);
    const multiplier = unit === "weeks" ? 7 : unit === "months" ? 30 : 1;
    const days = Math.min(3650, amount * multiplier);
    const unitLabel = unit.replace(/s$/,"" ) + (amount === 1 ? "" : "s");
    return {amount,unit,days,label:`${amount} ${unitLabel}`,resolved:`${amount} ${unitLabel} · ${days} days`};
  }
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const parseDate = value => {
    if (!value) return NaN;
    const raw = String(value).trim();
    // Dashboard date inputs are YYYY-MM-DD; imported records may contain ISO timestamps.
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T00:00:00`).getTime()
      : new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  function readBroilerBatches() {
    const live = window.FratelAgriPredictDashboard?.getBatches?.();
    if (Array.isArray(live)) return live.filter(Boolean);
    const feedBatches = FEED?.state?.batches;
    return Array.isArray(feedBatches) ? feedBatches.filter(Boolean) : [];
  }

  const daysBetween = (a, b) => (b - a) / 86400000;

  function landedCost(purchase) {
    const qty = Number(purchase.quantity) || 0;
    if (qty <= 0) return null;
    if (Number.isFinite(Number(purchase.landedUnitCost)) && Number(purchase.landedUnitCost) > 0) {
      return Number(purchase.landedUnitCost);
    }
    const total = Number(purchase.totalCost);
    if (Number.isFinite(total) && total > 0) return total / qty;
    return (qty * (Number(purchase.unitPrice) || 0) + (Number(purchase.transportCost) || 0) + (Number(purchase.otherCost) || 0)) / qty;
  }

  function regression(points) {
    const origin = points[0].day;
    const xs = points.map(p => (p.day - origin) / 86400000);
    const ys = points.map(p => p.price);
    const meanX = xs.reduce((a,b)=>a+b,0) / xs.length;
    const meanY = ys.reduce((a,b)=>a+b,0) / ys.length;
    const numerator = xs.reduce((s,x,i)=>s+(x-meanX)*(ys[i]-meanY),0);
    const denominator = xs.reduce((s,x)=>s+(x-meanX)**2,0);
    if (!denominator) return {slope:0, r2:0};
    const slope = numerator / denominator;
    const intercept = meanY - slope * meanX;
    const predicted = xs.map(x => intercept + slope*x);
    const residual = ys.reduce((s,y,i)=>s+(y-predicted[i])**2,0);
    const total = ys.reduce((s,y)=>s+(y-meanY)**2,0);
    const r2 = total > 0 ? Math.max(0, Math.min(1, 1-residual/total)) : 1;
    return {slope, r2};
  }

  function ingredientSeries(ingredient) {
    const purchases = (FEED?.state?.purchases || [])
      .filter(p => p.ingredientId === ingredient.id)
      .map(p => ({ id:p.id, date: p.date, day: parseDate(p.date), price: landedCost(p), quantity: Number(p.quantity)||0, source: "purchase" }))
      .filter(p => Number.isFinite(p.day) && Number.isFinite(p.price) && p.price > 0)
      .sort((a,b)=>a.day-b.day);
    const purchaseIds = new Set(purchases.map(point => String(point.id)));
    const manualPrices = (FEED?.state?.priceHistory || [])
      .filter(row => row && !purchaseIds.has(String(row.id)) &&
        String(row.ingredientName || "").toLowerCase() === String(ingredient.name || "").toLowerCase())
      .map(row => ({ id:row.id, date:row.date, day:parseDate(row.date), price:Number(row.price), quantity:1, source:"recorded-price-change" }))
      .filter(point => Number.isFinite(point.day) && Number.isFinite(point.price) && point.price > 0);
    const observations = [...purchases, ...manualPrices].sort((a,b)=>a.day-b.day);
    // Deliveries on one day use quantity-weighted landed cost. A manual price
    // observation is kept as a dated price point and is not invented data.
    const daily = [];
    observations.forEach(point => {
      const last = daily[daily.length-1];
      if (last && last.day === point.day) {
        const oldQty = last.quantity;
        last.price = (last.price*oldQty + point.price*point.quantity) / Math.max(0.000001, oldQty+point.quantity);
        last.quantity += point.quantity;
        if (point.source !== "purchase") last.source = point.source;
      } else daily.push({...point});
    });
    return daily;
  }

  function forecastIngredient(ingredient, horizon) {
    const points = ingredientSeries(ingredient);
    const latest = points[points.length-1];
    if (!latest) {
      const current = Number(ingredient.currentPrice) || 0;
      return { ingredient, points, latestPrice: current || null, forecastPrice: null, slope: null, r2: null, confidence: "Insufficient data", status: current ? "A current catalogue price exists, but no dated purchase history supports a trend forecast." : "No recorded price is available.", trend: "unknown" };
    }
    if (points.length < 3) {
      return { ingredient, points, latestPrice: latest.price, forecastPrice: latest.price, slope: null, r2: null, confidence: "Low", status: `${points.length} dated price observation(s). A directional trend is not estimated until at least three dated observations are available.`, trend: "insufficient" };
    }
    const model = regression(points);
    const forecastPrice = Math.max(0, latest.price + model.slope * horizon);
    const span = daysBetween(points[0].day, latest.day);
    let confidence = points.length >= 6 && span >= 60 && model.r2 >= 0.55 ? "High" : points.length >= 4 && span >= 21 ? "Moderate" : "Low";
    const longHorizon = horizon > 180;
    if (longHorizon) confidence = "Low · long horizon";
    const change = forecastPrice - latest.price;
    const statusText = `${points.length} dated observations across ${Math.round(span)} days; trend fit R² ${fmt(model.r2)}. Confidence is a data-support rating, not a probability guarantee.${longHorizon ? " This forecast extends beyond six months; linear extrapolation is highly uncertain and should be treated as a planning scenario, not a likely market quote." : ""}`;
    return {
      ingredient, points, latestPrice: latest.price, forecastPrice, slope: model.slope, r2: model.r2,
      confidence, status: statusText,
      trend: Math.abs(change) < Math.max(1, latest.price*0.005) ? "stable" : change > 0 ? "rising" : "falling"
    };
  }

  function getFormulaForecast(formula, horizon, priceModels) {
    const items = (formula.items || []).map(item => {
      const model = priceModels.get(item.ingredientId);
      const ingredient = FEED.getIngredient(item.ingredientId);
      const currentCataloguePrice = Number(ingredient?.currentPrice);
      const formulaSavedPrice = Number(item.unitPrice);
      const latestUnitPrice = Number(model?.latestPrice) > 0
        ? Number(model.latestPrice)
        : currentCataloguePrice > 0 ? currentCataloguePrice : formulaSavedPrice > 0 ? formulaSavedPrice : 0;
      const projectedUnitPrice = Number(model?.forecastPrice) > 0
        ? Number(model.forecastPrice)
        : latestUnitPrice;
      const quantity = Number(item.quantity) || 0;
      const priceAvailable = projectedUnitPrice > 0 && latestUnitPrice > 0;
      return {
        name: item.name || ingredient?.name || "Ingredient",
        ingredientId: item.ingredientId,
        quantity,
        latestUnitPrice,
        unitPrice: projectedUnitPrice,
        cost: priceAvailable ? quantity * projectedUnitPrice : 0,
        priceAvailable,
        supported: !!model?.points?.length && model.points.length >= 3,
        confidence: model?.confidence || "Insufficient data"
      };
    });
    const weight = items.reduce((sum,item)=>sum+item.quantity,0);
    const costSupported = items.length > 0 && items.every(item=>item.quantity > 0 && item.priceAvailable);
    const total = items.reduce((sum,item)=>sum+item.cost,0);
    const latestTotal = items.reduce((sum,item)=>sum+item.quantity*item.latestUnitPrice,0);
    return {
      formula, items, totalWeight: weight,
      projectedCost: costSupported ? total : null,
      projectedCostPerKg: costSupported && weight>0 ? total/weight : null,
      baselineCost: costSupported ? latestTotal : null,
      costSupported,
      supportedItems: items.filter(item=>item.supported).length
    };
  }

  function flockStage(age) {
    if (age == null || age <= 0) return "Placement date not reached";
    if (age === 1) return "Day-old chicks · Brooding";
    if (age <= 7) return "Brooding";
    if (age <= 14) return "Starter";
    if (age <= 21) return "Grower";
    return "Finisher";
  }

  function feedAvailability(horizon = 30) {
    const state = FEED?.state || {};
    const allocations = Array.isArray(state.allocations) ? state.allocations : [];
    const consumption = (Array.isArray(state.consumption) ? state.consumption : [])
      .filter(row => row && row.type === "feed" && Number(row.quantity) > 0 && Number.isFinite(parseDate(row.date)));
    const today = new Date(); today.setHours(0,0,0,0);
    const cutoff = today.getTime() - 28 * 86400000;
    const recent = consumption.filter(row => parseDate(row.date) >= cutoff);
    const batches = readBroilerBatches();
    const batchMap = new Map(batches.map(batch => [batch.id, batch]));
    const finished = (state.formulas || []).filter(formula => formula.status === "active").map(formula => {
      let projectedNeed = 0;
      let supportedBatches = 0;
      let dailyUse = 0;
      let usageDays = 0;
      const formulaAllocations = allocations.filter(item => item && item.formulaId === formula.id);
      const allocatedRemaining = formulaAllocations.reduce((sum,allocation) => {
        const consumed = consumption.filter(row => row.allocationId === allocation.id).reduce((s,row)=>s+Number(row.quantity||0),0);
        return sum + Math.max(0,Number(allocation.quantity||0)-consumed);
      },0);
      const formulaUsage = recent.filter(row => {
        const allocation = allocations.find(item => item && item.id === row.allocationId);
        return allocation?.formulaId === formula.id;
      });
      const batchIds = [...new Set(formulaUsage.map(row => row.batchId).filter(Boolean))];
      batchIds.forEach(batchId => {
        const rows = formulaUsage.filter(row => row.batchId === batchId);
        const dates = [...new Set(rows.map(row => String(row.date).slice(0,10)))].sort();
        if (dates.length < 3) return;
        const firstDay = parseDate(dates[0]);
        const observedDays = Number.isFinite(firstDay) ? Math.max(1,Math.floor(daysBetween(firstDay,today.getTime()))+1) : 0;
        if (!observedDays) return;
        const used = rows.reduce((sum,row)=>sum+Number(row.quantity||0),0);
        const rate = used / observedDays;
        const batch = batchMap.get(batchId);
        const placed = parseDate(batch?.placementDate);
        const elapsed = Number.isFinite(placed) ? Math.floor(daysBetween(placed,today.getTime())) : null;
        const age = elapsed == null ? null : elapsed < 0 ? 0 : elapsed + 1;
        const remaining = Number(batch?.targetAgeDays)>0 && age!=null ? Math.max(0,Number(batch.targetAgeDays)-age) : horizon;
        const forecastDays = Math.min(horizon,remaining);
        projectedNeed += rate * forecastDays;
        dailyUse += rate;
        usageDays += dates.length;
        supportedBatches += 1;
      });
      const unallocatedStock = Math.max(0,Number(FEED.finishedStock(formula.id)) || 0);
      const available = unallocatedStock + allocatedRemaining;
      const need = supportedBatches ? projectedNeed : null;
      const coverDays = dailyUse > 0 ? available / dailyUse : null;
      return {id:formula.id,name:formula.name,stock:available,unallocatedStock,allocatedRemaining,dailyUse: supportedBatches?dailyUse:null,coverDays,need,shortfall:need==null?null:Math.max(0,need-available),supportedBatches,usageDays};
    });
    const raw = (state.ingredients || []).filter(item => item.active).map(item => ({
      name:item.name,
      stock:Math.max(0,Number(FEED.rawStock(item.id)) || 0),
      unit:item.unit || "kg"
    }));
    return {finished,raw};
  }

  function projectedFeedPurchaseCost(stockModel, formulaModels) {
    const costs = new Map(formulaModels.map(model => [model.formula.id,model]));
    const supported = stockModel.finished.filter(row => row.need != null);
    if (!supported.length) return null;
    if (supported.some(row => row.shortfall > 0 && !costs.get(row.id)?.costSupported)) return null;
    return supported.reduce((sum,row) => {
      const costPerKg = costs.get(row.id)?.projectedCostPerKg;
      return sum + row.shortfall * (Number(costPerKg) || 0);
    },0);
  }

  function broilerProductionInsights(formulaModels = [], horizon = 30) {
    const batches = readBroilerBatches();
    const today = new Date(); today.setHours(0,0,0,0);
    const active = batches.filter(b => {
      const status = String(b.status || "active").toLowerCase();
      return !["completed", "closed", "harvested", "inactive"].includes(status) && b.active !== false;
    });
    const results = active.map(batch => {
      // Ignore malformed/empty entries so one damaged historical row cannot stop the whole table.
      const records = (Array.isArray(batch.records) ? batch.records : []).filter(r => r && typeof r === "object");
      const weights = records.filter(r=>r.type==="weight" && Number(r.averageWeight)>0 && Number.isFinite(parseDate(r.date))).sort((a,b)=>parseDate(a.date)-parseDate(b.date));
      const feeds = records.filter(r=>r.type==="feed" && Number(r.quantity)>0 && Number.isFinite(parseDate(r.date))).sort((a,b)=>parseDate(a.date)-parseDate(b.date));
      const mortality = records.filter(r=>r.type==="mortality" && Number(r.quantity)>0);
      const sold = records.filter(r=>r.type==="sale").reduce((s,r)=>s+(Number(r.quantity)||0),0);
      const deaths = mortality.reduce((s,r)=>s+(Number(r.quantity)||0),0);
      const initialBirds = Number(batch.initialBirds)||0;
      const birds = Math.max(0,initialBirds-deaths-sold);
      const mortalityRate = initialBirds>0 ? deaths/initialBirds*100 : null;
      const placed = parseDate(batch.placementDate);
      const elapsedAge = Number.isFinite(placed) ? Math.floor((today.getTime()-placed)/86400000) : null;
      // Placement date is Day 1 (not Day 0). Future placements remain at age 0.
      const age = elapsedAge == null ? null : elapsedAge < 0 ? 0 : elapsedAge + 1;
      const stage = flockStage(age);
      let adg = null;
      if (weights.length >= 2) {
        const first = weights[0], last = weights[weights.length-1];
        const span = daysBetween(parseDate(first.date), parseDate(last.date));
        if (span > 0) adg = (Number(last.averageWeight)-Number(first.averageWeight))/span;
      }
      const latestWeight = weights.length ? Number(weights[weights.length-1].averageWeight) : null;
      const remainingAge = Math.max(0,(Number(batch.targetAgeDays)||0)-(age||0));
      const harvestWeight = adg !== null && adg > 0 && latestWeight !== null && remainingAge > 0 ? latestWeight + adg*remainingAge : null;
      const recentCutoff = today.getTime()-28*86400000;
      const recentFeed = feeds.filter(r=>parseDate(r.date)>=recentCutoff);
      const feedDays = new Set(recentFeed.map(r=>r.date)).size;
      const feedTotal = recentFeed.reduce((s,r)=>s+(Number(r.quantity)||0),0);
      const firstFeedDay = recentFeed.length ? Math.min(...recentFeed.map(r=>parseDate(r.date))) : NaN;
      const feedObservationSpan = Number.isFinite(firstFeedDay) ? Math.max(1, Math.floor(daysBetween(firstFeedDay, today.getTime())) + 1) : 0;
      const dailyFeed = feedDays >= 3 ? feedTotal / feedObservationSpan : null;
      const feedState = FEED?.state;
      const batchConsumptions = (Array.isArray(feedState?.consumption) ? feedState.consumption : []).filter(r=>r && r.batchId===batch.id && r.type==="feed" && parseDate(r.date)>=recentCutoff);
      const linkedFeedDays = new Set(batchConsumptions.map(r=>r.date)).size;
      const linkedFeedTotal = batchConsumptions.reduce((sum,r)=>sum+(Number(r.quantity)||0),0);
      const linkedFirstDay = batchConsumptions.length ? Math.min(...batchConsumptions.map(r=>parseDate(r.date))) : NaN;
      const linkedSpan = Number.isFinite(linkedFirstDay) ? Math.max(1,Math.floor(daysBetween(linkedFirstDay,today.getTime()))+1) : 0;
      const formulaLookup = new Map(formulaModels.map(m=>[m.formula.id,m]));
      const formulaCosts = batchConsumptions.reduce((sum,r)=>{
        const allocation=(Array.isArray(feedState?.allocations) ? feedState.allocations : []).find(a=>a && a.id===r.allocationId);
        const formula=allocation ? formulaLookup.get(allocation.formulaId) : null;
        return sum + (Number(r.quantity)||0) * (formula?.projectedCostPerKg || Number(allocation?.costPerKg) || 0);
      },0);
      const forecastDays = Math.min(horizon,remainingAge);
      let remainingAllocatedFeed = 0;
      try { remainingAllocatedFeed = Number(FEED?.batchFeedSummary?.(batch.id)?.remainingAllocated) || 0; } catch (_) { remainingAllocatedFeed = 0; }
      let plannedFeedForecast = null;
      if (forecastDays > 0 && forecastDays <= 140) {
        try { plannedFeedForecast = window.FratelBroilerWorkbookUI?.forecast(batch.id,forecastDays) || null; }
        catch (_) { plannedFeedForecast = null; }
      }
      const futureFeedNeed = plannedFeedForecast?.projectedFeedRequirement ?? null;
      const additionalFeedToBuy = futureFeedNeed === null ? null : Math.max(0,futureFeedNeed-remainingAllocatedFeed);
      const futureFeedCost = plannedFeedForecast?.estimatedFeedCost ?? null;
      const recordedCosts = records.reduce((sum,r)=>sum + (r.type==="expense"?Number(r.amount)||0:r.type==="health"?Number(r.cost)||0:r.type==="feed"?(Number(r.totalCost)||((Number(r.quantity)||0)*(Number(r.unitPrice)||0))):0),0) + (Number(batch.initialBirds)||0)*(Number(batch.chickCost)||0);
      const expectedRevenue = Number(batch.expectedPrice)>0 ? (batch.priceBasis==="kg" ? birds*(Number(batch.targetWeight)||latestWeight||0)*Number(batch.expectedPrice) : birds*Number(batch.expectedPrice)) : null;
      const projectedTotalCost = futureFeedCost==null ? null : recordedCosts+futureFeedCost;
      const projectedProfit = expectedRevenue!=null && projectedTotalCost!=null ? expectedRevenue-projectedTotalCost : null;
      const fcr = weights.length >= 2 && feeds.length && adg !== null && adg > 0 && latestWeight !== null
        ? feeds.reduce((s,r)=>s+(Number(r.quantity)||0),0) / Math.max(0.0001, (latestWeight-Number(weights[0].averageWeight))*birds)
        : null;
      return {name:batch.name||"Unnamed batch", age, stage, birds, latestWeight, adg, harvestWeight, remainingAge, dailyFeed, futureFeedNeed, feedDays, fcr, mortalityRate, mortalityEvents:mortality.length, weightRecords:weights.length, feedRecords:feeds.length, targetAgeDays:Number(batch.targetAgeDays)||null, futureFeedCost, recordedCosts, expectedRevenue, projectedTotalCost, projectedProfit, linkedFeedDays, remainingAllocatedFeed, additionalFeedToBuy};
    });
    return { batches: results, activeCount: results.length, recordedWeightPoints: results.reduce((s,b)=>s+b.weightRecords,0), recordedFeedPoints:results.reduce((s,b)=>s+b.feedRecords,0) };
  }

  function makeInsights(priceModels, formulaModels, production) {
    const insights = [];
    const priceRows = [...priceModels.values()];
    const rising = priceRows.filter(x=>x.trend==="rising");
    if (rising.length) insights.push({level:"watch", title:`${rising.length} ingredient price trend(s) rising`, detail:`${rising.slice(0,4).map(x=>x.ingredient.name).join(", ")} show rising trends in dated landed-cost records. Review upcoming procurement needs.`});
    const sparse = priceRows.filter(x=>x.points.length<3);
    if (sparse.length) insights.push({level:"info",title:"More price history is needed",detail:`${sparse.length} ingredient(s) have fewer than three dated price observations. Their forecasts are held at the latest recorded landed price and marked low-confidence.`});
    const missingNutrients = (FEED?.state?.formulas||[]).filter(f=>f.status==="active").filter(f=>["protein","energy","fibre","calcium","phosphorus","lysine","methionine"].some(k=>f.nutrients?.[k]==null));
    if (missingNutrients.length) insights.push({level:"watch",title:"Nutrient assessment has data gaps",detail:`${missingNutrients.length} active formula(s) lack one or more ingredient nutrient values. Nutritional adequacy cannot be judged reliably until composition data and the applicable breed/phase specification are available.`});
    const noEnv = true;
    if (noEnv) insights.push({level:"info",title:"Environmental risk data not connected",detail:"Temperature, humidity and ventilation observations are not present in the current farm records. Heat-stress and housing-risk forecasts are therefore not inferred."});
    if (production.activeCount && production.batches.every(b=>b.weightRecords<2)) insights.push({level:"info",title:"Growth forecasts need repeated weighing",detail:"At least two dated weight measurements per batch are needed to estimate a farm-specific growth rate."});
    if (!insights.length) insights.push({level:"good",title:"No immediate data-quality warning",detail:"Continue recording purchases, feed intake, weights and flock events to strengthen future forecasts."});
    return insights;
  }

  function svgChart(model, horizon) {
    const points = model.points || [];
    if (!points.length) return `<div class="afi-chart-empty">No dated purchase history is available for this ingredient.</div>`;
    const history = points.slice(-10);
    const future = model.forecastPrice == null ? [] : [{day:history[history.length-1].day+horizon,price:model.forecastPrice}];
    const values = [...history,...future].map(p=>p.price);
    const min = Math.min(...values), max = Math.max(...values);
    const spread = Math.max(1,max-min);
    const x = i => 30 + (i/Math.max(1,history.length+future.length-1))*540;
    const y = v => 140 - ((v-min)/spread)*105;
    const histPath = history.map((p,i)=>`${i?"L":"M"}${x(i)},${y(p.price)}`).join(" ");
    const forecastPath = future.length ? `M${x(history.length-1)},${y(history[history.length-1].price)} L${x(history.length)},${y(future[0].price)}` : "";
    const dots = history.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.price)}" r="3.5" fill="currentColor"><title>${esc(p.date)}: ${money(p.price)}/kg</title></circle>`).join("");
    return `<svg class="afi-chart" viewBox="0 0 600 170" role="img" aria-label="Recorded ingredient landed prices and forecast"><line x1="30" y1="140" x2="570" y2="140" stroke="currentColor" opacity=".18"/><line x1="30" y1="35" x2="570" y2="35" stroke="currentColor" opacity=".12"/><path d="${histPath}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${dots}<path d="${forecastPath}" fill="none" stroke="#8B5CF6" stroke-width="3" stroke-dasharray="7 6" stroke-linecap="round"/><text x="30" y="160" font-size="10" fill="currentColor">Oldest record</text><text x="570" y="160" font-size="10" text-anchor="end" fill="currentColor">${horizon} days ahead</text></svg>`;
  }

  function renderContent() {
    const page = $("#forecastIntelligencePage");
    if (!page || !FEED) return;
    const state = FEED.state;
    const ingredients = state.ingredients.filter(x=>x.active);
    const horizonInfo = horizonSettings();
    const horizon = horizonInfo.days;
    const selectedId = $("#afiIngredient")?.value || ingredients[0]?.id || "";
    const priceModels = new Map(ingredients.map(i=>[i.id,forecastIngredient(i,horizon)]));
    const formulas = state.formulas.filter(f=>f.status==="active");
    const formulaModels = formulas.map(f=>getFormulaForecast(f,horizon,priceModels));
    const production = broilerProductionInsights(formulaModels,horizon);
    const pricePoints = [...priceModels.values()].reduce((s,m)=>s+m.points.length,0);
    const selected = priceModels.get(selectedId) || [...priceModels.values()][0];

    const ingredientSelect = $("#afiIngredient");
    if (ingredientSelect) {
      const previous = ingredientSelect.value;
      ingredientSelect.innerHTML = ingredients.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join("") || '<option value="">No ingredients recorded</option>';
      if (ingredients.some(i=>i.id===previous)) ingredientSelect.value=previous;
      else if (ingredients[0]) ingredientSelect.value=ingredients[0].id;
    }
    const chosen = priceModels.get(ingredientSelect?.value || selectedId) || selected;

    const simInput = $("#afiSimPrice");
    if (simInput && chosen) {
      if (simInput.dataset.ingredientId !== String(chosen.ingredient.id)) {
        simInput.dataset.ingredientId = String(chosen.ingredient.id);
        simInput.dataset.scenarioEdited = "false";
        simInput.value = Number(chosen.latestPrice ?? chosen.forecastPrice ?? 0).toFixed(2);
      }
    }
    const simulatedPrice = Number(simInput?.value);
    const hasSimulation = !!chosen && Number.isFinite(simulatedPrice) && simulatedPrice > 0;
    const simulationModels = new Map(priceModels);
    if (hasSimulation) simulationModels.set(chosen.ingredient.id, {...chosen, forecastPrice: simulatedPrice, confidence: "Farmer scenario", trend: "simulated"});
    const simulationFormulaModels = formulas.map(f=>getFormulaForecast(f,horizon,simulationModels));
    const feedAvailabilityData = feedAvailability(horizon);

    const set = (id,value) => { const el=$(id); if(el)el.textContent=value; };
    set("#afiIngredientCount",ingredients.length);
    set("#afiPurchaseCount",pricePoints);
    set("#afiFormulaCount",formulas.length);
    set("#afiBatchCount",production.activeCount);
    set("#afiHorizonLabel",`${horizonInfo.label} · ${horizon}-day outlook`);
    set("#afiStockHorizonLabel",`${horizonInfo.label} · feed need`);
    set("#afiHorizonResolved",horizonInfo.resolved);

    const flockOutlook = $("#afiFlockOutlook");
    if (flockOutlook) {
      if (production.batches.length) {
        flockOutlook.innerHTML = production.batches.map(batch => {
          const ageLabel = batch.age === 1 ? "Day 1 · Day-old chicks" : batch.age == null ? "Age not recorded" : `Day ${batch.age}`;
          const weightText = batch.latestWeight == null ? "No weight sample yet" : `${fmt(batch.latestWeight)} kg latest average`;
          const growthText = batch.adg == null ? "Growth rate awaiting 2 dated weight records" : `${fmt(batch.adg*1000)} g/day observed gain`;
          const harvestText = batch.remainingAge > 0 ? `${batch.remainingAge} days to target age` : "Target age reached or missing";
          return `<article class="afi-flock-card"><div class="afi-flock-card-top"><span class="afi-flock-icon">🐤</span><span class="afi-stage-pill">${esc(batch.stage)}</span></div><strong>${esc(batch.name)}</strong><small>${ageLabel} · ${fmt(batch.birds)} birds currently alive</small><div class="afi-flock-facts"><span>${esc(weightText)}</span><span>${esc(growthText)}</span><span>${esc(harvestText)}</span></div></article>`;
        }).join("");
      } else {
        flockOutlook.innerHTML = '<div class="afi-flock-empty">No active broiler batch is connected. Create or activate a batch to see its lifecycle outlook.</div>';
      }
    }

    const summary = $("#afiPriceSummary");
    if(summary) {
      if(chosen) {
        const change = chosen.forecastPrice!=null && chosen.latestPrice!=null ? chosen.forecastPrice-chosen.latestPrice : null;
        const changePct = change!=null && chosen.latestPrice>0 ? change/chosen.latestPrice*100 : null;
        summary.innerHTML = `<div class="afi-price-kpis"><div><small>Latest landed cost</small><strong>${chosen.latestPrice==null?"Not recorded":money(chosen.latestPrice)+"/kg"}</strong></div><div><small>Forecast landed cost</small><strong>${chosen.forecastPrice==null?"Insufficient data":money(chosen.forecastPrice)+"/kg"}</strong></div><div><small>Projected movement</small><strong>${changePct==null?"—":`${changePct>=0?"+":""}${fmt(changePct)}%`}</strong></div><div><small>Data support</small><strong>${esc(chosen.confidence)}</strong></div></div><p class="afi-method-note">Method: ordinary least-squares trend across dated landed-cost observations, projected forward from the latest recorded price. ${esc(chosen.status)}</p>`;
      } else summary.innerHTML='<p class="afi-empty">Add ingredient records in Feed Management to begin price intelligence.</p>';
    }
    const chart = $("#afiPriceChart"); if(chart) chart.innerHTML = chosen ? svgChart(chosen,horizon) : '<div class="afi-chart-empty">No ingredient selected.</div>';

    const formulaBody = $("#afiFormulaRows");
    if(formulaBody) formulaBody.innerHTML = formulaModels.length ? formulaModels.map(m=>`<tr><td><strong>${esc(m.formula.name)}</strong><small>${esc(m.formula.stage||"Feed formula")}</small></td><td>${m.baselineCost==null?"Missing ingredient prices":`${money(m.baselineCost)} / batch mix`}</td><td>${m.projectedCost==null?"Not available":`${money(m.projectedCost)} / batch mix`}</td><td>${m.projectedCostPerKg==null?"Not available":`${money(m.projectedCostPerKg)} / kg`}</td><td>${m.supportedItems}/${m.items.length} ingredients trend-supported</td></tr>`).join("") : '<tr><td colspan="5" class="afi-empty">No active feed formulations are recorded.</td></tr>';

    const productionBody = $("#afiProductionRows");
    if(productionBody) productionBody.innerHTML = production.batches.length ? production.batches.map(b=>`<tr><td><strong>${esc(b.name)}</strong><small>${b.age===1?"Day 1 · Day-old chicks":b.age==null?"Age unavailable":`Day ${b.age} · ${esc(b.stage)}`} · ${fmt(b.birds)} birds alive</small></td><td>${b.latestWeight==null?"Not recorded":`${fmt(b.latestWeight)} kg`}</td><td>${b.adg==null?"Need 2+ dated weights":`${fmt(b.adg*1000)} g/day`}</td><td>${b.harvestWeight==null?"Not supported":`${fmt(b.harvestWeight)} kg`}</td><td>${b.futureFeedNeed==null?"Need 3+ feed days in last 28 days":`${fmt(b.futureFeedNeed)} kg`}</td><td>${b.fcr==null?"Not enough comparable data":`${fmt(b.fcr)} : 1`}</td><td>${b.mortalityRate==null?"Not available":`${fmt(b.mortalityRate)}%`}</td></tr>`).join("") : '<tr><td colspan="7" class="afi-empty">No active broiler batches are recorded.</td></tr>';

    const financeBody = $("#afiFinancialRows");
    if(financeBody) financeBody.innerHTML = production.batches.length ? production.batches.map(b=>`<tr><td><strong>${esc(b.name)}</strong><small>${fmt(b.birds)} birds · ${b.remainingAge} days to target age</small></td><td>${b.futureFeedCost==null?"Need 3+ linked feed-consumption days":money(b.futureFeedCost)}</td><td>${b.expectedRevenue==null?"Expected selling price not recorded":money(b.expectedRevenue)}</td><td>${b.projectedTotalCost==null?"Insufficient feed-cost history":money(b.projectedTotalCost)}</td><td>${b.projectedProfit==null?"Not enough data":money(b.projectedProfit)}</td></tr>`).join("") : '<tr><td colspan="5" class="afi-empty">No active batches are available for financial forecasting.</td></tr>';

    const simulationRows = $("#afiSimulationFormulaRows");
    if (simulationRows) simulationRows.innerHTML = simulationFormulaModels.length ? simulationFormulaModels.map((model,index)=>{
      const base = formulaModels[index];
      const delta = model.projectedCostPerKg!=null && base.projectedCostPerKg!=null ? model.projectedCostPerKg - base.projectedCostPerKg : null;
      const klass = delta==null ? "afi-cost-neutral" : delta > 0.005 ? "afi-cost-up" : delta < -0.005 ? "afi-cost-down" : "afi-cost-neutral";
      return `<tr><td><strong>${esc(model.formula.name)}</strong></td><td>${base.projectedCostPerKg==null?"Not available":`${money(base.projectedCostPerKg)}/kg`}</td><td>${model.projectedCostPerKg==null?"Not available":`${money(model.projectedCostPerKg)}/kg`}</td><td class="${klass}">${delta==null?"Need ingredient prices":`${delta>0?"+":""}${money(delta)}/kg`}</td></tr>`;
    }).join("") : '<tr><td colspan="4" class="afi-empty">Save feed formulations to see how an ingredient price change affects each ration.</td></tr>';
    const priceDelta = hasSimulation && chosen.forecastPrice != null ? simulatedPrice - chosen.forecastPrice : null;
    set("#afiSimCurrentPrice",chosen?.latestPrice==null?"Not recorded":`${money(chosen.latestPrice)}/kg`);
    set("#afiSimModelPrice",chosen?.forecastPrice==null?"Insufficient history":`${money(chosen.forecastPrice)}/kg`);
    set("#afiSimEnteredPrice",hasSimulation?`${money(simulatedPrice)}/kg`:"Enter a valid price");
    set("#afiSimPriceDelta",priceDelta==null?"—":`${priceDelta>0?"+":""}${money(priceDelta)}/kg`);
    const baseFeedCost = projectedFeedPurchaseCost(feedAvailabilityData,formulaModels);
    const simFeedCost = hasSimulation ? projectedFeedPurchaseCost(feedAvailabilityData,simulationFormulaModels) : null;
    const feedCostDelta = baseFeedCost!=null && simFeedCost!=null ? simFeedCost-baseFeedCost : null;
    set("#afiSimFeedCostImpact",feedCostDelta==null?"Need linked feed history":`${feedCostDelta>0?"+":""}${money(feedCostDelta)}`);
    set("#afiSimProfitImpact",feedCostDelta==null?"Not enough data":`${feedCostDelta>0?"−":"+"}${money(Math.abs(feedCostDelta))}`);
    const impactNote = $("#afiSimImpactNote");
    if(impactNote) impactNote.textContent = feedCostDelta==null ? "Feed-cost and margin impacts need at least three dated feed-consumption days linked to saved formulations." : feedCostDelta>0 ? "After subtracting finished feed and feed already allocated to batches, the simulated price raises the expected cost of feed still needing purchase. With revenue unchanged, the indicative margin falls by the same amount." : feedCostDelta<0 ? "After subtracting finished feed and feed already allocated to batches, the simulated price lowers the expected cost of feed still needing purchase. With revenue unchanged, the indicative margin improves by the same amount." : "Current finished-feed stock and allocations cover the supported feed requirement, or this price change does not alter the modelled purchase cost over the selected horizon.";

    const finishedRows = $("#afiFinishedStockRows");
    if(finishedRows) finishedRows.innerHTML = feedAvailabilityData.finished.length ? feedAvailabilityData.finished.map(row=>`<tr><td><strong>${esc(row.name)}</strong></td><td>${fmt(row.stock)} kg<small>${fmt(row.unallocatedStock)} kg unallocated · ${fmt(row.allocatedRemaining)} kg allocated</small></td><td>${row.dailyUse==null?"Need 3+ usage days":`${fmt(row.dailyUse)} kg/day`}</td><td>${row.coverDays==null?"Not enough usage history":`${fmt(row.coverDays)} days`}</td><td>${row.shortfall==null?"Not estimated":row.shortfall>0?`${fmt(row.shortfall)} kg short`:`Covered for ${horizon} days`}</td></tr>`).join("") : '<tr><td colspan="5" class="afi-empty">No active finished-feed formulations or stock records are available.</td></tr>';
    const rawRows = $("#afiRawStockRows");
    if(rawRows) rawRows.innerHTML = feedAvailabilityData.raw.length ? feedAvailabilityData.raw.map(row=>`<tr><td>${esc(row.name)}</td><td>${fmt(row.stock)} ${esc(row.unit)}</td></tr>`).join("") : '<tr><td colspan="2" class="afi-empty">No active raw ingredients are recorded.</td></tr>';
    set("#afiFinishedStockCount",feedAvailabilityData.finished.length);
    set("#afiRawStockCount",feedAvailabilityData.raw.length);

    const insights = makeInsights(priceModels,formulaModels,production);
    const insightBox = $("#afiInsights");
    if(insightBox) insightBox.innerHTML = insights.map(i=>`<article class="afi-insight afi-${i.level}"><span>${i.level==="watch"?"Monitor":i.level==="good"?"Positive":"Data note"}</span><div><strong>${esc(i.title)}</strong><p>${esc(i.detail)}</p></div></article>`).join("");

    const knowledge = $("#afiKnowledgeStatus");
    if(knowledge) knowledge.innerHTML = `<div><strong>Poultry nutrition</strong><span>${formulas.length?"Formula nutrient profiles can be analysed where ingredient composition is recorded.":"Awaiting feed formulations."}</span></div><div><strong>Growth science</strong><span>${production.recordedWeightPoints?`${production.recordedWeightPoints} dated weight records available.`:"Awaiting repeated weight measurements."}</span></div><div><strong>Health and biosecurity</strong><span>${production.batches.reduce((s,b)=>s+b.mortalityEvents,0)} mortality event(s) recorded; diagnosis is not inferred from mortality alone.</span></div><div><strong>Environment and climate</strong><span>Temperature, humidity and ventilation data are not yet connected.</span></div><div><strong>Agricultural economics</strong><span>${pricePoints} dated landed-cost observations available for ingredient price modelling.</span></div><div><strong>Wider agriculture</strong><span>Framework is extensible to crop and other livestock enterprises; no crop records are currently connected.</span></div>`;

    const revenueSupported = production.batches.length > 0 && production.batches.every(batch => batch.expectedRevenue != null);
    const profitSupported = production.batches.length > 0 && production.batches.every(batch => batch.projectedProfit != null);
    const projectedRevenue = revenueSupported
      ? production.batches.reduce((sum, batch) => sum + Number(batch.expectedRevenue || 0), 0) : null;
    const projectedProfit = profitSupported
      ? production.batches.reduce((sum, batch) => sum + Number(batch.projectedProfit || 0), 0) : null;
    const r2Values = [...priceModels.values()].map(model => model.r2).filter(value => Number.isFinite(value));
    const confidenceScore = r2Values.length
      ? Math.max(0, Math.min(100, r2Values.reduce((sum, value) => sum + value, 0) / r2Values.length * 100))
      : null;
    const scenarioEdited = simInput?.dataset.scenarioEdited === "true" && hasSimulation;
    const scenarioResult = {
      selectedIngredient: chosen ? {
        id: chosen.ingredient.id, name: chosen.ingredient.name,
        latestLandedPrice: chosen.latestPrice, modelForecastPrice: chosen.forecastPrice,
        enteredPrice: scenarioEdited ? simulatedPrice : null
      } : null,
      formulaForecasts: formulaModels.map(model => ({
        formulaId: model.formula.id, name: model.formula.name,
        baselineCostPerKg: model.baselineCost == null || !model.totalWeight ? null : model.baselineCost / model.totalWeight,
        forecastCostPerKg: model.projectedCostPerKg
      })),
      productionForecasts: production.batches.map(batch => ({
        batchId: batch.id, name: batch.name, ageDays: batch.age, birdsAlive: batch.birds,
        projectedHarvestWeight: batch.harvestWeight, projectedFeedNeed: batch.futureFeedNeed,
        projectedFeedCost: batch.futureFeedCost, expectedRevenue: batch.expectedRevenue,
        projectedProfit: batch.projectedProfit
      })),
      feedPurchaseCost: baseFeedCost,
      simulatedFeedPurchaseCost: scenarioEdited ? simFeedCost : null,
      simulatedFeedCostChange: scenarioEdited ? feedCostDelta : null
    };
    latestForecastSnapshot = {
      horizonDays: horizon,
      dataThroughDate: new Date().toISOString().slice(0, 10),
      method: "landed-ingredient-price-trend-and-record-led-broiler-performance",
      modelVersion: "afi-1.0",
      baselineDailyCost: null,
      projectedCost: baseFeedCost,
      projectedRevenue,
      projectedProfit,
      confidenceScore,
      assumptions: {
        currency: "UGX",
        ingredientPriceBasis: "landed",
        horizonLabel: horizonInfo.label,
        trendMethod: "ordinary-least-squares on dated landed-cost observations",
        confidenceScoreMeaning: "mean R-squared of ingredient trends with sufficient observations; not a probability"
      },
      inputSnapshot: {
        ingredients: ingredients.map(item => ({
          id: item.id, name: item.name, currentPrice: item.currentPrice,
          datedPriceObservations: priceModels.get(item.id)?.points?.length || 0
        })),
        purchases: state.purchases.map(item => ({
          id: item.id, ingredientId: item.ingredientId, date: item.date,
          quantity: item.quantity, landedUnitCost: item.landedUnitCost
        })),
        formulas: formulaModels.map(model => ({
          id: model.formula.id, name: model.formula.name, version: model.formula.version,
          items: model.items.map(item => ({
            ingredientId: item.ingredientId, quantity: item.quantity, unitPrice: item.latestUnitPrice
          }))
        })),
        batches: production.batches.map(batch => ({
          id: batch.id, name: batch.name, ageDays: batch.age, birdsAlive: batch.birds,
          weightObservations: batch.weightPoints
        }))
      },
      resultSnapshot: scenarioResult,
      scenarios: scenarioEdited ? [{
        name: `${chosen.ingredient.name} landed-price simulation`,
        horizonDays: horizon,
        inputChanges: {
          ingredientId: chosen.ingredient.id,
          ingredientName: chosen.ingredient.name,
          baselineLandedPrice: chosen.latestPrice,
          modelForecastPrice: chosen.forecastPrice,
          simulatedLandedPrice: simulatedPrice
        },
        resultSnapshot: scenarioResult
      }] : []
    };
  }

  function render() {
    try {
      renderContent();
    } catch (error) {
      console.error("Forecast intelligence render failed:", error);
      const productionBody = $("#afiProductionRows");
      if (productionBody) productionBody.innerHTML = `<tr><td colspan="7" class="afi-empty">Batch data could not be displayed: ${esc(error.message || "Unexpected data format")}. Your saved records have not been changed.</td></tr>`;
      const financeBody = $("#afiFinancialRows");
      if (financeBody) financeBody.innerHTML = '<tr><td colspan="5" class="afi-empty">Financial outlook is unavailable until the batch records can be read.</td></tr>';
    }
  }

  function bind() {
    $("#afiHorizonAmount")?.addEventListener("input",render);
    $("#afiHorizonUnit")?.addEventListener("change",render);
    $("#afiIngredient")?.addEventListener("change",render);
    $("#afiSimPrice")?.addEventListener("input",event=>{event.target.dataset.scenarioEdited="true";render();});
    $("#afiSimReset")?.addEventListener("click",()=>{
      const input=$("#afiSimPrice");
      const selected=FEED?.state?.ingredients?.find(item=>item.id===$("#afiIngredient")?.value);
      if(input && selected){
        const latestModel=forecastIngredient(selected,horizonSettings().days);
        const resetPrice=latestModel.latestPrice ?? Number(selected.currentPrice) ?? 0;
        input.dataset.ingredientId=String(selected.id);
        input.dataset.scenarioEdited="false";
        input.value=Number(resetPrice).toFixed(2);
      }
      render();
    });
    $("#afiRefresh")?.addEventListener("click",render);
    $("#afiSaveSnapshot")?.addEventListener("click",async()=>{
      const status=$("#afiSaveStatus");
      const button=$("#afiSaveSnapshot");
      if(!window.FratelCloud){
        if(status)status.textContent="Cloud storage is not available on this page.";
        return;
      }
      try{
        if(!latestForecastSnapshot)renderContent();
        if(!latestForecastSnapshot)throw new Error("Generate a forecast before saving.");
        if(status)status.textContent="Saving forecast to your farm account…";
        if(button)button.disabled=true;
        const saved=await window.FratelCloud.saveForecastRun(latestForecastSnapshot);
        if(status)status.textContent=`Saved forecast ${saved.run?.id ? saved.run.id.slice(0,8) : "successfully"}${saved.scenarios?.length ? " with what-if scenario" : ""}.`;
      }catch(error){
        console.error("Could not save forecast snapshot:",error);
        if(status)status.textContent="Could not save forecast: "+(error.message||"Please try again.");
      }finally{
        if(button)button.disabled=false;
      }
    });
    document.addEventListener("agripredict:feed-data-updated",render);
    document.addEventListener("agripredict:broiler-data-updated",render);
    window.addEventListener("storage",event=>{if(!event.key||event.key===BROILER_KEY||event.key==="agripredict_broiler_feed_v1")render();});
    window.addEventListener("pageshow",render);
    window.addEventListener("load",render,{once:true});
    document.addEventListener("click",event=>{if(event.target.closest('[data-view="forecasting"]'))setTimeout(render,0);});
  }

  function initialise() {
    if(!FEED) { console.warn("Forecast intelligence requires the feed engine."); return; }
    bind();
    render();
  }
  window.FratelAgriPredictIntelligence = {render, forecastIngredient, broilerProductionInsights, feedAvailability, projectedFeedPurchaseCost, flockStage};
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",initialise,{once:true});
  else initialise();
})();
