
/* ============================================================
   AGRIPREDICT — BROILER FEED MANAGEMENT ENGINE
   Production-oriented frontend module
   Version: 1.0
   Database: authenticated Supabase storage with a local recovery cache

   STORAGE:
   - Feed operations are saved in browser localStorage.
   - Feed records remain on this device and browser.
   - Broiler batch details are read from the broiler dashboard store.
   - Historical transaction prices are retained in their records.
   ============================================================ */

(() => {
  "use strict";

  const APP = window.AgriPredictFeed = {};

  const CONFIG = {
    currency: "UGX",
    forecastDays: [7, 14, 21, 28],
    defaultFeedPerBirdKg: 3,
    defaultProductionDays: 28,
    lowStockDays: 7
  };

  const STORAGE_KEY = "agripredict_broiler_feed_v1";

  const state = {
    ingredients: [],
    suppliers: [],
    purchases: [],
    rawMovements: [],
    formulas: [],
    production: [],
    finishedMovements: [],
    allocations: [],
    consumption: [],
    priceHistory: [],
    batches: [],
    selectedBatch: "",
    activeTab: "overview"
  };

  let cloudSaveQueue = Promise.resolve();
  let cloudHydrationPromise = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return;
      for (const key of Object.keys(state)) {
        if (Array.isArray(saved[key])) state[key] = saved[key];
      }
      if (typeof saved.selectedBatch === "string") state.selectedBatch = saved.selectedBatch;
      if (typeof saved.activeTab === "string") state.activeTab = saved.activeTab;
    } catch (error) {
      console.error("Could not load feed records:", error);
    }
  }

  function saveState() {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    ["ingredients", "suppliers", "purchases", "rawMovements", "formulas",
      "production", "finishedMovements", "allocations", "consumption", "priceHistory"].forEach(key => {
      state[key].forEach(item => {
        if (!uuidPattern.test(String(item.id || ""))) item.id = crypto.randomUUID();
      });
    });

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("Could not update the local feed recovery cache:", error);
    }

    if (!window.FratelCloud || typeof window.FratelCloud.saveFeedState !== "function") {
      return Promise.resolve(false);
    }

    const snapshot = JSON.parse(JSON.stringify(state));
    const task = cloudSaveQueue.catch(() => {}).then(async () => {
      await window.FratelCloud.ready();
      await window.FratelCloud.saveFeedState(snapshot);
      document.dispatchEvent(new CustomEvent("agripredict:feed-cloud-saved"));
      return true;
    });
    cloudSaveQueue = task;
    task.catch(error => {
      console.error("Feed records could not be synchronised to Supabase:", error);
      document.dispatchEvent(new CustomEvent("agripredict:cloud-save-error", {
        detail: { module: "feed", message: error.message || "Feed cloud save failed." }
      }));
    });
    return task;
  }

  function mergeRecords(remoteRows, localRows) {
    const merged = new Map();
    (Array.isArray(remoteRows) ? remoteRows : []).forEach(row => {
      if (row && row.id) merged.set(String(row.id), row);
    });
    (Array.isArray(localRows) ? localRows : []).forEach(row => {
      if (row && row.id && !merged.has(String(row.id))) merged.set(String(row.id), row);
    });
    return [...merged.values()];
  }

  async function hydrateFromCloud() {
    if (cloudHydrationPromise) return cloudHydrationPromise;
    cloudHydrationPromise = (async () => {
      if (!window.FratelCloud || typeof window.FratelCloud.loadFeedState !== "function") return false;
      await window.FratelCloud.ready();
      const remote = await window.FratelCloud.loadFeedState();
      const arrayKeys = [
        "ingredients", "suppliers", "purchases", "rawMovements", "formulas",
        "production", "finishedMovements", "allocations", "consumption", "priceHistory"
      ];
      const remoteHasRecords = arrayKeys.some(key => Array.isArray(remote[key]) && remote[key].length);
      const localSnapshot = JSON.parse(JSON.stringify(state));

      if (remoteHasRecords) {
        arrayKeys.forEach(key => { state[key] = mergeRecords(remote[key], localSnapshot[key]); });
        state.batches = Array.isArray(remote.batches) && remote.batches.length
          ? remote.batches : localSnapshot.batches;
      } else {
        arrayKeys.forEach(key => {
          if (Array.isArray(remote[key]) && remote[key].length) state[key] = remote[key];
        });
        if (Array.isArray(remote.batches) && remote.batches.length) state.batches = remote.batches;
      }

      state.selectedBatch = localSnapshot.selectedBatch || remote.selectedBatch || state.batches[0]?.id || "";
      state.activeTab = localSnapshot.activeTab || remote.activeTab || "overview";
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

      // Existing browser records are imported; remote records are merged by ID,
      // so this does not erase cloud-only or previously saved farmer data.
      await saveState();
      document.dispatchEvent(new CustomEvent("agripredict:feed-data-updated", {
        detail: { operation: "cloud-hydration" }
      }));
      return true;
    })().catch(error => {
      cloudHydrationPromise = null;
      console.error("Could not load feed records from Supabase:", error);
      document.dispatchEvent(new CustomEvent("agripredict:cloud-load-error", {
        detail: { module: "feed", message: error.message || "Feed cloud load failed." }
      }));
      return false;
    });
    return cloudHydrationPromise;
  }

  loadState();

  /* ============================================================
     1. UTILITIES
     ============================================================ */

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

  const uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const today = () => {
    const date = new Date();
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset)
      .toISOString()
      .slice(0, 10);
  };

  const number = value => {
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
  };

  const positive = (value, label) => {
    const result = Number(value);

    if (!Number.isFinite(result) || result <= 0) {
      throw new Error(`${label} must be greater than zero.`);
    }

    return result;
  };

  const money = value =>
    new Intl.NumberFormat("en-UG", {
      style: "currency",
      currency: CONFIG.currency,
      maximumFractionDigits: 0
    }).format(number(value));

  const quantity = value =>
    new Intl.NumberFormat("en-UG", {
      maximumFractionDigits: 2
    }).format(number(value));

  const escapeHTML = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);

  const sum = (items, getter) =>
    items.reduce((total, item) => total + number(getter(item)), 0);

  const dateIsValid = value =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00`));

  function notify(message, type = "success") {
    let element = $("#feedNotification");

    if (!element) {
      element = document.createElement("div");
      element.id = "feedNotification";
      element.className = "app-notification";
      document.body.appendChild(element);
    }

    element.textContent = message;
    element.dataset.type = type;
    element.hidden = false;

    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => {
      element.hidden = true;
    }, 3500);
  }

  function assertDate(value, label = "Date") {
    if (!dateIsValid(value)) {
      throw new Error(`${label} is invalid.`);
    }

    if (value > today()) {
      throw new Error(`${label} cannot be in the future.`);
    }
  }

  function assertText(value, label) {
    if (!String(value ?? "").trim()) {
      throw new Error(`${label} is required.`);
    }

    return String(value).trim();
  }

  /* ============================================================
     2. INGREDIENT CATALOGUE
     ============================================================ */

  function getIngredient(id) {
    return state.ingredients.find(item => item.id === id);
  }

  function addIngredient(data) {
    const name = assertText(data.name, "Ingredient name");

    if (state.ingredients.some(
      item => item.name.toLowerCase() === name.toLowerCase()
    )) {
      throw new Error("This ingredient already exists.");
    }

    const ingredient = {
      id: uid(),
      name,
      category: assertText(data.category, "Category"),
      unit: data.unit || "kg",
      currentPrice: number(data.currentPrice ?? data.price),
      protein: data.protein === "" ? null : number(data.protein),
      energy: data.energy === "" ? null : number(data.energy),
      fibre: data.fibre === "" ? null : number(data.fibre),
      calcium: data.calcium === "" ? null : number(data.calcium),
      phosphorus: data.phosphorus === "" ? null : number(data.phosphorus),
      lysine: data.lysine === "" ? null : number(data.lysine),
      methionine: data.methionine === "" ? null : number(data.methionine),
      active: true,
      createdAt: new Date().toISOString()
    };

    for (const field of [
      "protein", "energy", "fibre",
      "calcium", "phosphorus", "lysine", "methionine"
    ]) {
      if (ingredient[field] !== null && ingredient[field] < 0) {
        throw new Error(`${field} cannot be negative.`);
      }
    }

    state.ingredients.push(ingredient);
    return ingredient;
  }

  function updateIngredient(id, changes) {
    const ingredient = getIngredient(id);

    if (!ingredient) {
      throw new Error("Ingredient not found.");
    }

    if (changes.name) {
      const duplicate = state.ingredients.some(item =>
        item.id !== id &&
        item.name.toLowerCase() === changes.name.toLowerCase()
      );

      if (duplicate) {
        throw new Error("An ingredient with this name already exists.");
      }
    }

    Object.assign(ingredient, changes);
    return ingredient;
  }

  function archiveIngredient(id) {
    const ingredient = getIngredient(id);

    if (!ingredient) {
      throw new Error("Ingredient not found.");
    }

    ingredient.active = false;
  }

  /* ============================================================
     3. SUPPLIER MANAGEMENT
     ============================================================ */

  function addSupplier(data) {
    const supplier = {
      id: uid(),
      name: assertText(data.name, "Supplier name"),
      contact: data.contact || "",
      telephone: data.telephone || "",
      address: data.address || "",
      notes: data.notes || "",
      active: true,
      createdAt: new Date().toISOString()
    };

    state.suppliers.push(supplier);
    return supplier;
  }

  function getSupplier(id) {
    return state.suppliers.find(item => item.id === id);
  }

  /* ============================================================
     4. INVENTORY LEDGER
     ============================================================ */

  function rawStock(ingredientId) {
    return sum(
      state.rawMovements.filter(
        movement => movement.ingredientId === ingredientId
      ),
      movement => movement.quantity
    );
  }

  function finishedStock(formulaId) {
    return sum(
      state.finishedMovements.filter(
        movement => movement.formulaId === formulaId
      ),
      movement => movement.quantity
    );
  }

  function addRawMovement(data) {
    const ingredient = getIngredient(data.ingredientId);

    if (!ingredient) {
      throw new Error("Select a valid ingredient.");
    }

    const qty = positive(data.quantity, "Quantity");

    const movement = {
      id: uid(),
      ingredientId: ingredient.id,
      type: data.type,
      quantity: qty,
      unitCost: number(data.unitCost),
      reference: data.reference || "",
      date: data.date || today(),
      notes: data.notes || "",
      createdAt: new Date().toISOString()
    };

    if (!dateIsValid(movement.date)) {
      throw new Error("Invalid stock movement date.");
    }

    const allowedTypes = [
      "purchase",
      "production_use",
      "adjustment_in",
      "adjustment_out",
      "wastage"
    ];

    if (!allowedTypes.includes(movement.type)) {
      throw new Error("Invalid raw-material movement type.");
    }

    if (movement.type === "production_use" ||
        movement.type === "adjustment_out" ||
        movement.type === "wastage") {
      if (rawStock(ingredient.id) < qty) {
        throw new Error("Insufficient raw-material stock.");
      }

      movement.quantity = -qty;
    }

    state.rawMovements.push(movement);
    return movement;
  }

  function addFinishedMovement(data) {
    const qty = positive(data.quantity, "Quantity");

    const movement = {
      id: uid(),
      formulaId: data.formulaId,
      type: data.type,
      quantity: qty,
      unitCost: number(data.unitCost),
      date: data.date || today(),
      reference: data.reference || "",
      notes: data.notes || "",
      createdAt: new Date().toISOString()
    };

    if (["allocation", "wastage", "adjustment_out"].includes(data.type)) {
      if (finishedStock(data.formulaId) < qty) {
        throw new Error("Insufficient finished-feed stock.");
      }

      movement.quantity = -qty;
    }

    state.finishedMovements.push(movement);
    return movement;
  }

  /* ============================================================
     5. PROCUREMENT
     ============================================================ */

  function recordPurchase(data) {
    const supplier = getSupplier(data.supplierId);

    if (!supplier) {
      throw new Error("Select a valid supplier.");
    }

    const ingredient = getIngredient(data.ingredientId);

    if (!ingredient) {
      throw new Error("Select a valid ingredient.");
    }

    const qty = positive(data.quantity, "Purchase quantity");
    const unitPrice = positive(data.unitPrice, "Unit price");

    const totalCost = qty * unitPrice + number(data.transportCost) + number(data.otherCost);
    const paidAmount = number(data.paidAmount);
    const purchase = {
      id: uid(),
      supplierId: supplier.id,
      ingredientId: ingredient.id,
      invoiceNumber: data.invoiceNumber || "",
      date: data.date || today(),
      quantity: qty,
      unitPrice,
      transportCost: number(data.transportCost),
      otherCost: number(data.otherCost),
      totalCost,
      landedUnitCost: totalCost / qty,
      paidAmount,
      balanceDue: totalCost - paidAmount,
      paymentStatus: totalCost - paidAmount <= 0 ? "Paid" : paidAmount > 0 ? "Part paid" : "Unpaid",
      payments: paidAmount > 0 ? [{id:uid(),amount:paidAmount,date:data.date||today(),reference:"Initial payment"}] : [],
      notes: data.notes || "",
      createdAt: new Date().toISOString()
    };

    if (!dateIsValid(purchase.date)) throw new Error("Purchase date is invalid.");
    if (purchase.transportCost < 0 || purchase.otherCost < 0) {
      throw new Error("Additional purchase costs cannot be negative.");
    }
    if (paidAmount < 0 || paidAmount > totalCost) {
      throw new Error("Amount paid must be between zero and the purchase total.");
    }

    state.purchases.push(purchase);
    ingredient.currentPrice = purchase.landedUnitCost;

    addRawMovement({
      ingredientId: ingredient.id,
      type: "purchase",
      quantity: qty,
      unitCost: purchase.landedUnitCost,
      reference: purchase.id,
      date: purchase.date
    });

    return purchase;
  }

  function recordPurchasePayment(purchaseId, data) {
    const purchase=state.purchases.find(item=>item.id===purchaseId);
    if(!purchase) throw new Error("Purchase record not found.");
    const amount=positive(data.amount,"Payment amount");
    const paid=number(purchase.paidAmount);
    const balance=Math.max(0,number(purchase.totalCost)-paid);
    if(amount>balance) throw new Error("Payment cannot exceed the outstanding balance.");
    const paymentDate=data.date||today();
    assertDate(paymentDate,"Payment date");
    purchase.payments=Array.isArray(purchase.payments)?purchase.payments:[];
    purchase.payments.push({id:uid(),amount,date:paymentDate,reference:data.reference||""});
    purchase.paidAmount=paid+amount;
    purchase.balanceDue=Math.max(0,number(purchase.totalCost)-purchase.paidAmount);
    purchase.paymentStatus=purchase.balanceDue<=0.005?"Paid":"Part paid";
    return purchase;
  }

  function purchaseSummary() {
    return {
      totalPurchases: state.purchases.length,
      quantityPurchased: sum(state.purchases, p => p.quantity),
      totalSpent: sum(state.purchases, p => p.totalCost)
    };
  }

  /* ============================================================
     6. FEED FORMULATION
     ============================================================ */

  function calculateFormula(items) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("A formula must contain ingredients.");
    }

    const resolved = items.map(item => {
      const ingredient = getIngredient(item.ingredientId);

      if (!ingredient || !ingredient.active) {
        throw new Error("A selected ingredient is unavailable.");
      }

      const qty = positive(item.quantity, ingredient.name + " quantity");
      const unitPrice = positive(
        item.unitPrice,
        ingredient.name + " unit price"
      );

      return {
        ingredientId: ingredient.id,
        name: ingredient.name,
        quantity: qty,
        unitPrice,
        cost: qty * unitPrice,
        nutrients: {
          protein: ingredient.protein,
          energy: ingredient.energy,
          fibre: ingredient.fibre,
          calcium: ingredient.calcium,
          phosphorus: ingredient.phosphorus,
          lysine: ingredient.lysine,
          methionine: ingredient.methionine
        }
      };
    });

    const totalWeight = sum(resolved, item => item.quantity);
    const totalCost = sum(resolved, item => item.cost);

    const nutrientNames = [
      "protein", "energy", "fibre",
      "calcium", "phosphorus", "lysine", "methionine"
    ];

    const nutrients = {};

    nutrientNames.forEach(name => {
      const complete = resolved.every(
        item => item.nutrients[name] !== null
      );

      if (!complete) {
        nutrients[name] = null;
        return;
      }

      nutrients[name] = resolved.reduce(
        (total, item) =>
          total + item.quantity * item.nutrients[name],
        0
      ) / totalWeight;
    });

    return {
      items: resolved.map(item => ({
        ...item,
        inclusionRate: item.quantity / totalWeight * 100
      })),
      totalWeight,
      totalCost,
      costPerKg: totalCost / totalWeight,
      nutrients
    };
  }

  function createFormula(data) {
    const name = assertText(data.name, "Formula name");

    const calculated = calculateFormula(data.items);

    const formula = {
      id: uid(),
      name,
      stage: data.stage || "custom",
      version: 1,
      status: "active",
      items: calculated.items,
      totalWeight: calculated.totalWeight,
      totalCost: calculated.totalCost,
      costPerKg: calculated.costPerKg,
      nutrients: calculated.nutrients,
      targetWeight: number(data.targetWeight) || calculated.totalWeight,
      notes: data.notes || "",
      createdAt: new Date().toISOString()
    };

    state.formulas.push(formula);
    return formula;
  }

  function reviseFormula(id, data) {
    const original = state.formulas.find(item => item.id === id);

    if (!original) {
      throw new Error("Formula not found.");
    }

    const calculated = calculateFormula(data.items);

    original.status = "superseded";

    const revision = {
      id: uid(),
      name: data.name || original.name,
      stage: data.stage || original.stage,
      version: original.version + 1,
      status: "active",
      items: calculated.items,
      totalWeight: calculated.totalWeight,
      totalCost: calculated.totalCost,
      costPerKg: calculated.costPerKg,
      nutrients: calculated.nutrients,
      targetWeight: number(data.targetWeight) || calculated.totalWeight,
      notes: data.notes || "",
      previousVersionId: original.id,
      createdAt: new Date().toISOString()
    };

    state.formulas.push(revision);
    return revision;
  }

  /* ============================================================
     7. FEED PRODUCTION
     ============================================================ */

  function produceFeed(data) {
    const formula = state.formulas.find(
      item => item.id === data.formulaId &&
      item.status === "active"
    );

    if (!formula) {
      throw new Error("Select an active formula.");
    }

    const targetWeight = positive(
      data.quantity,
      "Production quantity"
    );

    const scale = targetWeight / formula.totalWeight;

    const requiredIngredients = formula.items.map(item => ({
      ingredientId: item.ingredientId,
      quantity: item.quantity * scale,
      unitCost: item.unitPrice
    }));

    for (const item of requiredIngredients) {
      if (rawStock(item.ingredientId) < item.quantity) {
        const ingredient = getIngredient(item.ingredientId);

        throw new Error(
          `Insufficient stock of ${ingredient.name}.`
        );
      }
    }

    const productionCost = sum(
      requiredIngredients,
      item => item.quantity * item.unitCost
    );

    const record = {
      id: uid(),
      formulaId: formula.id,
      formulaVersion: formula.version,
      quantity: targetWeight,
      productionCost,
      costPerKg: productionCost / targetWeight,
      date: data.date || today(),
      batchNumber: data.batchNumber || "",
      notes: data.notes || "",
      createdAt: new Date().toISOString()
    };

    // Only deduct ingredients after all stock checks pass.
    requiredIngredients.forEach(item => {
      addRawMovement({
        ingredientId: item.ingredientId,
        type: "production_use",
        quantity: item.quantity,
        unitCost: item.unitCost,
        reference: record.id,
        date: record.date
      });
    });

    state.production.push(record);

    addFinishedMovement({
      formulaId: formula.id,
      type: "production",
      quantity: targetWeight,
      unitCost: record.costPerKg,
      reference: record.id,
      date: record.date
    });

    return record;
  }

  /* ============================================================
     8. BROILER BATCH REGISTRATION
     ============================================================ */

  function addBatch(data) {
    const batch = {
      id: uid(),
      name: assertText(data.name, "Batch name"),
      placementDate: data.placementDate,
      initialBirds: positive(data.initialBirds, "Initial birds"),
      targetAgeDays: number(
        data.targetAgeDays || CONFIG.defaultProductionDays
      ),
      targetWeight: number(data.targetWeight),
      targetFeedPerBird: number(
        data.targetFeedPerBird || CONFIG.defaultFeedPerBirdKg
      ),
      active: true,
      createdAt: new Date().toISOString()
    };

    assertDate(batch.placementDate, "Placement date");

    if (batch.targetAgeDays <= 0) {
      throw new Error("Target age must be positive.");
    }

    if (batch.targetFeedPerBird <= 0) {
      throw new Error("Feed requirement must be positive.");
    }

    state.batches.push(batch);
    return batch;
  }

  function getBatch(id) {
    return state.batches.find(item => item.id === id);
  }

  function batchAge(batch, date = today()) {
    const start = new Date(`${batch.placementDate}T00:00:00`);
    const end = new Date(`${date}T00:00:00`);

    const elapsedDays = Math.floor((end - start) / 86400000);
    // Inclusive flock age: placement date is Day 1, not Day 0.
    return elapsedDays < 0 ? 0 : elapsedDays + 1;
  }

  function liveBirds(batchId) {
    const batch = getBatch(batchId);

    if (!batch) return 0;

    if (Number.isFinite(Number(batch.currentBirds))) {
      return Math.max(0, number(batch.currentBirds));
    }

    const mortality = sum(
      state.consumption.filter(
        item => item.batchId === batchId && item.type === "mortality"
      ),
      item => item.quantity
    );

    return Math.max(0, batch.initialBirds - mortality);
  }

  /* ============================================================
     9. FEED ALLOCATION AND CONSUMPTION
     ============================================================ */

  function allocateFeed(data) {
    const batch = getBatch(data.batchId);

    if (!batch) {
      throw new Error("Select a valid broiler batch.");
    }

    const formula = state.formulas.find(
      item => item.id === data.formulaId
    );

    if (!formula) {
      throw new Error("Select a valid feed formula.");
    }

    const qty = positive(data.quantity, "Allocation quantity");

    if (finishedStock(formula.id) < qty) {
      throw new Error("Insufficient finished-feed stock.");
    }

    const allocation = {
      id: uid(),
      batchId: batch.id,
      formulaId: formula.id,
      quantity: qty,
      costPerKg: number(data.costPerKg),
      totalCost: qty * number(data.costPerKg),
      date: data.date || today(),
      notes: data.notes || "",
      createdAt: new Date().toISOString()
    };

    addFinishedMovement({
      formulaId: formula.id,
      type: "allocation",
      quantity: qty,
      unitCost: allocation.costPerKg,
      reference: allocation.id,
      date: allocation.date
    });

    state.allocations.push(allocation);
    return allocation;
  }

  function recordConsumption(data) {
    const batch = getBatch(data.batchId);

    if (!batch) {
      throw new Error("Select a valid batch.");
    }

    const allocation = state.allocations.find(
      item => item.id === data.allocationId &&
      item.batchId === batch.id
    );

    if (!allocation) {
      throw new Error("Select a valid feed allocation.");
    }

    const qty = positive(data.quantity, "Consumption quantity");

    const alreadyConsumed = sum(
      state.consumption.filter(
        item => item.allocationId === allocation.id &&
        item.type === "feed"
      ),
      item => item.quantity
    );

    if (alreadyConsumed + qty > allocation.quantity) {
      throw new Error("Consumption exceeds allocated feed.");
    }

    const record = {
      id: uid(),
      type: "feed",
      batchId: batch.id,
      allocationId: allocation.id,
      quantity: qty,
      date: data.date || today(),
      createdAt: new Date().toISOString()
    };

    assertDate(record.date);

    state.consumption.push(record);
    return record;
  }

  function recordMortality(data) {
    const batch = getBatch(data.batchId);

    if (!batch) {
      throw new Error("Select a valid batch.");
    }

    const qty = positive(data.quantity, "Mortality quantity");

    const record = {
      id: uid(),
      type: "mortality",
      batchId: batch.id,
      quantity: qty,
      date: data.date || today(),
      notes: data.notes || "",
      createdAt: new Date().toISOString()
    };

    assertDate(record.date);

    const historicalBirds = birdsAliveOnDate(batch.id, record.date);

    if (qty > historicalBirds) {
      throw new Error("Mortality exceeds birds alive on that date.");
    }

    state.consumption.push(record);
    return record;
  }

  function birdsAliveOnDate(batchId, date) {
    const batch = getBatch(batchId);

    if (!batch) return 0;

    const deaths = sum(
      state.consumption.filter(
        item =>
          item.batchId === batchId &&
          item.type === "mortality" &&
          item.date <= date
      ),
      item => item.quantity
    );

    return Math.max(0, batch.initialBirds - deaths);
  }

  /* ============================================================
     10. PRODUCTION PERFORMANCE
     ============================================================ */

  function batchFeedSummary(batchId) {
    const batch = getBatch(batchId);

    if (!batch) {
      throw new Error("Batch not found.");
    }

    const allocated = sum(
      state.allocations.filter(item => item.batchId === batchId),
      item => item.quantity
    );

    const consumed = sum(
      state.consumption.filter(
        item => item.batchId === batchId && item.type === "feed"
      ),
      item => item.quantity
    );

    const feedCost = sum(
      state.allocations.filter(item => item.batchId === batchId),
      item => item.totalCost
    );

    return {
      allocated,
      consumed,
      remainingAllocated: Math.max(0, allocated - consumed),
      feedCost,
      liveBirds: liveBirds(batchId),
      feedPerLiveBird:
        liveBirds(batchId) > 0 ? consumed / liveBirds(batchId) : 0
    };
  }

  function calculateFCR(batchId, weightGainKg) {
    const feed = batchFeedSummary(batchId);
    const gain = number(weightGainKg);

    if (gain <= 0) return null;

    return feed.consumed / gain;
  }

  function calculateMortalityRate(batchId) {
    const batch = getBatch(batchId);

    if (!batch || batch.initialBirds <= 0) return 0;

    return (
      (batch.initialBirds - liveBirds(batchId)) /
      batch.initialBirds
    ) * 100;
  }

  /* ============================================================
     11. FEED PRICE ANALYSIS
     ============================================================ */

  function formulaPriceSimulation(formulaId, changes) {
    const formula = state.formulas.find(
      item => item.id === formulaId
    );

    if (!formula) {
      throw new Error("Formula not found.");
    }

    const simulatedItems = formula.items.map(item => {
      const percentage = number(changes[item.ingredientId]);

      const newPrice = item.unitPrice * (1 + percentage / 100);

      return {
        ingredientId: item.ingredientId,
        quantity: item.quantity,
        unitPrice: newPrice
      };
    });

    const result = calculateFormula(simulatedItems);

    return {
      originalCostPerKg: formula.costPerKg,
      simulatedCostPerKg: result.costPerKg,
      differencePerKg:
        result.costPerKg - formula.costPerKg,
      percentageChange:
        formula.costPerKg > 0
          ? (
              (result.costPerKg - formula.costPerKg) /
              formula.costPerKg
            ) * 100
          : 0
    };
  }

  /* ============================================================
     12. FORECASTING
     ============================================================ */

  function forecastBatch(batchId, daysAhead) {
    const batch = getBatch(batchId);

    if (!batch) {
      throw new Error("Batch not found.");
    }

    if (![7, 14, 21, 28].includes(Number(daysAhead))) {
      throw new Error("Forecast horizon must be 7, 14, 21 or 28 days.");
    }

    const age = batchAge(batch);
    const birds = liveBirds(batchId);
    const feed = batchFeedSummary(batchId);

    const daysRemaining = Math.max(0, number(batch.targetAgeDays) - age);
    const forecastDays = Math.min(Number(daysAhead), daysRemaining);
    const dailyRequirement =
      (birds * number(batch.targetFeedPerBird)) / Math.max(1, number(batch.targetAgeDays));

    const projectedRequirement =
      dailyRequirement * forecastDays;

    const stock = sum(
      state.finishedMovements,
      item => item.quantity
    );

    return {
      batch: batch.name,
      currentAge: age,
      forecastDays,
      projectedBirds: birds,
      projectedFeedRequirement: projectedRequirement,
      currentAllocatedFeed: feed.remainingAllocated,
      projectedAdditionalFeed:
        Math.max(0, projectedRequirement - feed.remainingAllocated),
      estimatedFeedCost:
        projectedRequirement * averageFeedCostPerKg(),
      estimatedTargetAge:
        Math.max(0, batch.targetAgeDays - age),
      note:
        "Projection uses the batch feed target and current live-bird count. " +
        "It is a planning estimate, not a biological guarantee."
    };
  }

  function averageFeedCostPerKg() {
    const totalProduction = sum(
      state.production,
      item => item.quantity
    );

    const totalCost = sum(
      state.production,
      item => item.productionCost
    );

    return totalProduction > 0
      ? totalCost / totalProduction
      : 0;
  }

  /* ============================================================
     13. FARM-WIDE SUMMARY
     ============================================================ */

  function farmSummary() {
    const raw = state.ingredients.map(ingredient => ({
      ingredient: ingredient.name,
      stock: rawStock(ingredient.id)
    }));

    const finished = state.formulas.map(formula => ({
      formula: formula.name,
      stock: finishedStock(formula.id)
    }));

    const totalProduced = sum(
      state.production,
      item => item.quantity
    );

    const totalProductionCost = sum(
      state.production,
      item => item.productionCost
    );

    const totalAllocated = sum(
      state.allocations,
      item => item.quantity
    );

    const totalConsumed = sum(
      state.consumption.filter(item => item.type === "feed"),
      item => item.quantity
    );

    const totalPurchases = sum(
      state.purchases,
      item => item.totalCost
    );

    return {
      ingredientStock: raw,
      finishedFeedStock: finished,
      totalProduced,
      totalProductionCost,
      averageProductionCostPerKg:
        totalProduced > 0
          ? totalProductionCost / totalProduced
          : 0,
      totalAllocated,
      totalConsumed,
      totalPurchases,
      activeBatches: state.batches.filter(batch => batch.active).length,
      lowStockIngredients: raw.filter(item => item.stock <= 0).length
    };
  }

  /* ============================================================
     14. BASIC VALIDATION AND DATA EXPORT
     ============================================================ */

  function validateState() {
    const errors = [];

    state.ingredients.forEach(item => {
      if (!item.id || !item.name) {
        errors.push("Invalid ingredient record.");
      }
    });

    state.purchases.forEach(item => {
      if (item.quantity <= 0 || item.totalCost < 0) {
        errors.push(`Invalid purchase: ${item.id}`);
      }
    });

    state.production.forEach(item => {
      if (item.quantity <= 0 || item.productionCost < 0) {
        errors.push(`Invalid production record: ${item.id}`);
      }
    });

    state.allocations.forEach(item => {
      if (item.quantity <= 0) {
        errors.push(`Invalid allocation: ${item.id}`);
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  function exportData() {
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      state
    }, null, 2);
  }

  function downloadJSON() {
    const blob = new Blob([exportData()], {
      type: "application/json"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `agripredict-feed-${today()}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ============================================================
     15. PUBLIC APPLICATION API
     ============================================================ */

  const persistAfter = fn => (...args) => {
    const result = fn(...args);
    saveState();
    document.dispatchEvent(new CustomEvent("agripredict:feed-data-updated", { detail: { operation: fn.name || "feed-update" } }));
    return result;
  };

  Object.assign(APP, {
    config: CONFIG,
    state,
    save: saveState,
    reload: loadState,
    setBatches(batches, selectedId = "") {
      state.batches = Array.isArray(batches) ? batches : [];
      state.selectedBatch = state.batches.some(batch => batch.id === selectedId)
        ? selectedId
        : (state.batches.some(batch => batch.id === state.selectedBatch)
          ? state.selectedBatch : (state.batches[0]?.id || ""));
      saveState();
    },
    addIngredient: persistAfter(addIngredient),
    updateIngredient: persistAfter(updateIngredient),
    archiveIngredient: persistAfter(archiveIngredient),
    getIngredient,
    addSupplier: persistAfter(addSupplier),
    getSupplier,
    recordPurchase: persistAfter(recordPurchase),
    recordPurchasePayment: persistAfter(recordPurchasePayment),
    purchaseSummary,
    rawStock,
    finishedStock,
    addRawMovement: persistAfter(addRawMovement),
    calculateFormula,
    createFormula: persistAfter(createFormula),
    reviseFormula: persistAfter(reviseFormula),
    produceFeed: persistAfter(produceFeed),
    addBatch: persistAfter(addBatch),
    getBatch,
    batchAge,
    liveBirds,
    allocateFeed: persistAfter(allocateFeed),
    recordConsumption: persistAfter(recordConsumption),
    recordMortality: persistAfter(recordMortality),
    birdsAliveOnDate,
    batchFeedSummary,
    calculateFCR,
    calculateMortalityRate,
    formulaPriceSimulation,
    forecastBatch,
    averageFeedCostPerKg,
    farmSummary,
    validateState,
    exportData,
    downloadJSON
  });

  /* ============================================================
     16. CONNECT TO EXISTING DASHBOARD NAVIGATION
     ============================================================ */

  function getFeedPage() {
    return (
      $('[data-page="feed"]') ||
      $("#feedView")
    );
  }

  async function initialise() {
    const page = getFeedPage();

    if (!page) {
      console.warn(
        "AgriPredict Feed: Feed page was not found. " +
        'Expected [data-page="feed"] or #feedView.'
      );
      return;
    }

    if (!page.classList.contains("app-page")) {
      console.warn(
        "AgriPredict Feed: Add the app-page class to the Feed page."
      );
    }

    console.info("AgriPredict Feed Management engine initialised.");
    await hydrateFromCloud();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialise, {
      once: true
    });
  } else {
    initialise();
  }

})();
