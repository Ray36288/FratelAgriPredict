/* ============================================================
   FRATEL-AGRIPREDICT — SHARED SUPABASE DATA SERVICE
   This module centralises authenticated access to existing
   farm, enterprise, livestock and feed tables.
   It does not create tables or expose privileged credentials.
============================================================ */
(() => {
  "use strict";

  const TABLES = new Set([
    "farms", "farm_enterprises", "livestock_batches", "livestock_records",
    "production_records", "feed_ingredients", "feed_suppliers",
    "feed_purchases", "feed_stock_movements", "feed_formulas",
    "feed_formula_versions", "feed_formula_items", "feed_production",
    "finished_feed_movements", "feed_allocations", "feed_consumption",
    "farm_transactions", "farm_price_history", "forecast_runs",
    "forecast_scenarios", "inventory_items", "inventory_movements",
    "layer_enterprise_data"
  ]);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let currentUser = null;
  let farmPromise = null;
  const enterprisePromises = new Map();

  function client() {
    const db = window.supabaseClient;
    if (!db || typeof db.from !== "function") {
      throw new Error("Supabase is not ready. Check the Supabase scripts in this page.");
    }
    return db;
  }

  async function getUser(forceRefresh = false) {
    if (currentUser && !forceRefresh) return currentUser;
    const { data, error } = await client().auth.getUser();
    if (error) throw error;
    if (!data?.user) throw new Error("Your session has expired. Sign in again to access farm records.");
    currentUser = data.user;
    return currentUser;
  }

  async function ready() {
    const user = await getUser();
    return { user, client: client() };
  }

  async function ensureFarm() {
    if (farmPromise) return farmPromise;
    farmPromise = (async () => {
      const { user, client: db } = await ready();
      const { data: existing, error: readError } = await db
        .from("farms").select("id,name").eq("farmer_id", user.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (readError) throw readError;
      if (existing) return existing;

      const { data, error } = await db
        .from("farms")
        .insert({ farmer_id: user.id, name: "My Farm" })
        .select("id,name").single();
      if (error) throw error;
      return data;
    })().catch(error => {
      farmPromise = null;
      throw error;
    });
    return farmPromise;
  }

  async function findFarm() {
    const { user, client: db } = await ready();
    const { data, error } = await db.from("farms")
      .select("id,name").eq("farmer_id", user.id)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function findEnterprise(type) {
    const farm = await findFarm();
    if (!farm) return null;
    const { data, error } = await client().from("farm_enterprises")
      .select("id,farm_id,enterprise_type,name,status")
      .eq("farm_id", farm.id).eq("enterprise_type", String(type || "").trim().toLowerCase())
      .eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function ensureEnterprise(type, displayName) {
    const enterpriseType = String(type || "").trim().toLowerCase();
    if (!enterpriseType) throw new Error("An enterprise type is required.");
    if (enterprisePromises.has(enterpriseType)) return enterprisePromises.get(enterpriseType);

    const promise = (async () => {
      const farm = await ensureFarm();
      const db = client();
      const { data: existing, error: readError } = await db
        .from("farm_enterprises")
        .select("id,farm_id,enterprise_type,name,status")
        .eq("farm_id", farm.id)
        .eq("enterprise_type", enterpriseType)
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (readError) throw readError;
      if (existing) return existing;

      const { data, error } = await db.from("farm_enterprises").insert({
        farm_id: farm.id,
        enterprise_type: enterpriseType,
        name: displayName || enterpriseType.replace(/\b\w/g, letter => letter.toUpperCase()),
        status: "active"
      }).select("id,farm_id,enterprise_type,name,status").single();
      if (error) throw error;
      return data;
    })().catch(error => {
      enterprisePromises.delete(enterpriseType);
      throw error;
    });
    enterprisePromises.set(enterpriseType, promise);
    return promise;
  }

  function table(name) {
    if (!TABLES.has(name)) throw new Error("This table is not enabled in the AgriPredict data service.");
    return client().from(name);
  }

  async function select(name, columns = "*", configure = null) {
    await ready();
    let request = table(name).select(columns);
    if (typeof configure === "function") request = configure(request) || request;
    const { data, error } = await request;
    if (error) throw error;
    return data || [];
  }

  async function insert(name, rows, returning = "*") {
    await ready();
    const { data, error } = await table(name).insert(rows).select(returning);
    if (error) throw error;
    return data;
  }

  async function upsert(name, rows, conflictColumns, returning = "*") {
    await ready();
    const options = conflictColumns ? { onConflict: conflictColumns } : undefined;
    const { data, error } = await table(name).upsert(rows, options).select(returning);
    if (error) throw error;
    return data;
  }

  async function update(name, values, configure, returning = "*") {
    await ready();
    let request = table(name).update(values);
    if (typeof configure === "function") request = configure(request) || request;
    const { data, error } = await request.select(returning);
    if (error) throw error;
    return data;
  }

  async function remove(name, configure) {
    await ready();
    let request = table(name).delete();
    if (typeof configure === "function") request = configure(request) || request;
    const { data, error } = await request.select("id");
    if (error) throw error;
    return data || [];
  }

  async function loadLivestockBatches(enterpriseType = "broiler", createIfMissing = true) {
    const enterprise = createIfMissing
      ? await ensureEnterprise(enterpriseType, "Broiler Farming")
      : await findEnterprise(enterpriseType);
    if (!enterprise) return [];
    const rows = await select("livestock_batches", "*", query =>
      query.eq("enterprise_id", enterprise.id).order("start_date", { ascending: false })
    );
    return rows.map(row => {
      const saved = row.metadata?.appBatch && typeof row.metadata.appBatch === "object"
        ? row.metadata.appBatch : {};
      return {
        ...saved,
        id: row.metadata?.localId || row.id,
        cloudId: row.id,
        name: saved.name || row.batch_name,
        breed: saved.breed || row.breed || "",
        placementDate: saved.placementDate || row.start_date,
        initialBirds: saved.initialBirds ?? row.opening_quantity,
        initialWeight: saved.initialWeight ?? (row.opening_avg_weight_kg ? row.opening_avg_weight_kg * 1000 : 0),
        targetAgeDays: saved.targetAgeDays ?? null,
        notes: saved.notes || row.notes || "",
        records: Array.isArray(saved.records) ? saved.records : [],
        priceChanges: Array.isArray(saved.priceChanges) ? saved.priceChanges : []
      };
    });
  }

  async function saveLivestockBatch(batch, enterpriseType = "broiler") {
    if (!batch || typeof batch !== "object") throw new Error("A valid livestock batch is required.");
    const { user } = await ready();
    if (batch.ownerId && batch.ownerId !== user.id) throw new Error("Cannot sync a broiler batch from another farmer account.");
    const enterprise = await ensureEnterprise(enterpriseType, "Broiler Farming");
    const localId = String(batch.id || "");
    let cloudId = UUID_RE.test(batch.cloudId || "") ? batch.cloudId : (UUID_RE.test(localId) ? localId : null);

    if (!cloudId && localId) {
      const existing = await select("livestock_batches", "id,metadata", query => query.eq("enterprise_id", enterprise.id));
      cloudId = existing.find(row => row.metadata?.localId === localId)?.id || null;
    }

    if (Array.isArray(batch.records)) batch.records.forEach(ensureUuid);
    if (Array.isArray(batch.priceChanges)) batch.priceChanges.forEach(ensureUuid);

    const payload = {
      enterprise_id: enterprise.id,
      batch_name: String(batch.name || batch.batchName || "Unnamed batch"),
      species: "chicken",
      breed: batch.breed || null,
      start_date: batch.placementDate || batch.startDate || new Date().toISOString().slice(0, 10),
      opening_quantity: Number(batch.initialBirds || batch.openingQuantity || 0),
      opening_avg_weight_kg: Number(batch.initialWeight || 0) > 0
        ? Number(batch.initialWeight) / 1000 : null,
      target_market_date: batch.targetMarketDate || null,
      status: ["planned", "active", "completed", "closed"].includes(batch.status) ? batch.status : "active",
      notes: batch.notes || null,
      metadata: {
        appBatch: batch,
        localId: localId || null,
        source: "fratel-agripredict"
      },
      updated_at: new Date().toISOString()
    };
    if (cloudId) payload.id = cloudId;
    if (!payload.opening_quantity || payload.opening_quantity < 1) {
      throw new Error("Batch opening quantity must be greater than zero.");
    }

    const { data, error } = await client()
      .from("livestock_batches")
      .upsert(payload, { onConflict: "id" })
      .select("id")
      .single();
    if (error) throw error;

    const recordRows = (Array.isArray(batch.records) ? batch.records : []).map(record => {
      const quantity = Number(record.quantity || 0);
      return {
        id: record.id,
        batch_id: data.id,
        record_type: String(record.type || "other"),
        quantity_change: ["mortality", "sale"].includes(record.type) ? -Math.abs(quantity) : quantity,
        measurement_value: record.averageWeight == null ? null : Number(record.averageWeight),
        measurement_unit: record.averageWeight == null ? null : "kg",
        cost_amount: record.amount != null ? Number(record.amount) :
          record.cost != null ? Number(record.cost) :
          record.totalCost != null ? Number(record.totalCost) : null,
        occurred_at: record.date ? new Date(record.date + "T12:00:00").toISOString() : new Date().toISOString(),
        cause_or_description: record.description || record.eventType || record.category || null,
        notes: record.notes || null,
        metadata: record,
        recorded_by: user.id
      };
    });
    if (recordRows.length) await upsert("livestock_records", recordRows, "id");

    const farm = await ensureFarm();
    const priceRows = (Array.isArray(batch.priceChanges) ? batch.priceChanges : []).map(price => ({
      id: price.id,
      farm_id: farm.id,
      enterprise_id: enterprise.id,
      price_category: String(price.category || "feed"),
      item_name: String(price.item || price.category || "Farm input"),
      unit: String(price.unit || "kg"),
      price: Number(price.price || 0),
      currency: "UGX",
      effective_date: price.date || new Date().toISOString().slice(0, 10),
      recorded_by: user.id,
      notes: price.notes || null
    }));
    if (priceRows.length) await upsert("farm_price_history", priceRows, "id");

    return { ...batch, cloudId: data.id, ownerId: user.id };
  }

  async function deleteLivestockBatch(batch, enterpriseType = "broiler") {
    const enterprise = await ensureEnterprise(enterpriseType, "Broiler Farming");
    let cloudId = UUID_RE.test(batch?.cloudId || "") ? batch.cloudId : null;
    if (!cloudId && UUID_RE.test(batch?.id || "")) cloudId = batch.id;
    if (!cloudId && batch?.id) {
      const rows = await select("livestock_batches", "id,metadata", query => query.eq("enterprise_id", enterprise.id));
      cloudId = rows.find(row => row.metadata?.localId === String(batch.id))?.id || null;
    }
    if (!cloudId) return [];

    // These foreign keys use ON DELETE RESTRICT, so remove only the feed
    // allocation/consumption rows belonging to this batch first.
    await remove("feed_consumption", query =>
      query.eq("livestock_batch_id", cloudId).eq("enterprise_id", enterprise.id)
    );
    await remove("feed_allocations", query =>
      query.eq("livestock_batch_id", cloudId).eq("enterprise_id", enterprise.id)
    );
    return remove("livestock_batches", query =>
      query.eq("id", cloudId).eq("enterprise_id", enterprise.id)
    );
  }


  function ensureUuid(record) {
    if (UUID_RE.test(record?.id || "")) return record.id;
    if (!record || typeof record !== "object") throw new Error("A feed record is invalid.");
    record.id = crypto.randomUUID();
    return record.id;
  }

  function rootFormulaId(formula, byId) {
    let current = formula;
    const visited = new Set();
    while (current?.previousVersionId && byId.has(current.previousVersionId) && !visited.has(current.id)) {
      visited.add(current.id);
      current = byId.get(current.previousVersionId);
    }
    return current?.id || formula.id;
  }

  async function cloudBatchesForFeed() {
    const { user } = await ready();
    let batches = await loadLivestockBatches("broiler");
    const local = (() => {
      try {
        const saved = JSON.parse(localStorage.getItem("agripredict_broiler_v1") || "{}");
        if (saved.ownerId && saved.ownerId !== user.id) return [];
        return Array.isArray(saved.batches) ? saved.batches : [];
      } catch { return []; }
    })();

    const known = new Set(batches.map(batch => String(batch.id)));
    for (const batch of local) {
      if (!known.has(String(batch.id))) {
        await saveLivestockBatch(batch, "broiler");
      }
    }
    if (local.length) batches = await loadLivestockBatches("broiler");
    return batches;
  }

  async function saveFeedState(feedState) {
    if (!feedState || typeof feedState !== "object") throw new Error("Feed data is missing.");
    const { user } = await ready();
    const farm = await ensureFarm();
    const enterprise = await ensureEnterprise("broiler", "Broiler Farming");
    const db = client();
    const now = new Date().toISOString();
    const batches = await cloudBatchesForFeed();
    const batchIdByLocal = new Map(batches.map(batch => [String(batch.id), batch.cloudId || batch.id]));

    const ingredients = Array.isArray(feedState.ingredients) ? feedState.ingredients : [];
    const suppliers = Array.isArray(feedState.suppliers) ? feedState.suppliers : [];
    const purchases = Array.isArray(feedState.purchases) ? feedState.purchases : [];
    const rawMovements = Array.isArray(feedState.rawMovements) ? feedState.rawMovements : [];
    const formulas = Array.isArray(feedState.formulas) ? feedState.formulas : [];
    const production = Array.isArray(feedState.production) ? feedState.production : [];
    const finishedMovements = Array.isArray(feedState.finishedMovements) ? feedState.finishedMovements : [];
    const allocations = Array.isArray(feedState.allocations) ? feedState.allocations : [];
    const consumption = Array.isArray(feedState.consumption) ? feedState.consumption : [];

    for (const list of [ingredients, suppliers, purchases, rawMovements, formulas, production, finishedMovements, allocations, consumption]) {
      list.forEach(ensureUuid);
    }

    if (ingredients.length) {
      const priorPrices = await select("feed_ingredients", "id,current_price",
        query => query.eq("enterprise_id", enterprise.id));
      const priorPriceById = new Map(priorPrices.map(row => [row.id, Number(row.current_price || 0)]));
      const rows = ingredients.map(item => ({
        id: item.id, enterprise_id: enterprise.id, name: String(item.name || "Ingredient"),
        category: String(item.category || "other"), unit: item.unit || "kg",
        current_price: Number(item.currentPrice || 0),
        protein: item.protein == null ? null : Number(item.protein),
        energy: item.energy == null ? null : Number(item.energy),
        fibre: item.fibre == null ? null : Number(item.fibre),
        calcium: item.calcium == null ? null : Number(item.calcium),
        phosphorus: item.phosphorus == null ? null : Number(item.phosphorus),
        lysine: item.lysine == null ? null : Number(item.lysine),
        methionine: item.methionine == null ? null : Number(item.methionine),
        nutrient_profile: item.nutrientProfile || {},
        is_active: item.active !== false, updated_at: now
      }));
      await upsert("feed_ingredients", rows, "id");

      const changedPrices = ingredients.filter(item => {
        const next = Number(item.currentPrice || 0);
        return next > 0 && (!priorPriceById.has(item.id) || priorPriceById.get(item.id) !== next);
      }).map(item => ({
        id: crypto.randomUUID(), farm_id: farm.id, enterprise_id: enterprise.id,
        price_category: "feed_ingredient", item_name: String(item.name || "Feed ingredient"),
        unit: item.unit || "kg", price: Number(item.currentPrice || 0),
        currency: "UGX", effective_date: now.slice(0, 10),
        recorded_by: user.id, notes: "Ingredient price entry or update"
      }));
      if (changedPrices.length) await insert("farm_price_history", changedPrices);
    }

    if (suppliers.length) {
      const rows = suppliers.map(item => ({
        id: item.id, farm_id: farm.id, name: String(item.name || "Supplier"),
        contact_person: item.contact || null, telephone: item.telephone || null,
        address: item.address || null, notes: item.notes || null,
        is_active: item.active !== false, updated_at: now
      }));
      await upsert("feed_suppliers", rows, "id");
    }

    const formulaById = new Map(formulas.map(item => [item.id, item]));
    const rootIds = new Set(formulas.map(item => rootFormulaId(item, formulaById)));
    const rootRows = [...rootIds].map(rootId => {
      const versions = formulas.filter(item => rootFormulaId(item, formulaById) === rootId);
      const newest = versions.reduce((a, b) => Number(a.version || 1) >= Number(b.version || 1) ? a : b);
      return {
        id: rootId, enterprise_id: enterprise.id, name: newest.name || "Feed formula",
        stage: newest.stage || "custom",
        status: versions.some(item => item.status === "active") ? "active" : "archived",
        notes: newest.notes || null, created_by: user.id, updated_at: now
      };
    });
    if (rootRows.length) await upsert("feed_formulas", rootRows, "id");

    const versionRows = formulas.map(item => ({
      id: item.id,
      formula_id: rootFormulaId(item, formulaById),
      version_number: Math.max(1, Number(item.version) || 1),
      status: ["active", "superseded", "archived"].includes(item.status) ? item.status : "active",
      total_weight: Number(item.totalWeight || 0),
      total_cost: Number(item.totalCost || 0),
      cost_per_kg: Number(item.costPerKg || 0),
      nutrient_profile: item.nutrients || {},
      target_weight: item.targetWeight == null ? null : Number(item.targetWeight),
      notes: item.notes || null,
      previous_version_id: UUID_RE.test(item.previousVersionId || "") ? item.previousVersionId : null,
      created_by: user.id
    }));
    if (versionRows.length) await upsert("feed_formula_versions", versionRows, "id");

    for (const formula of formulas) {
      const existingItems = await select("feed_formula_items", "id,ingredient_id",
        query => query.eq("formula_version_id", formula.id));
      const existingByIngredient = new Map(existingItems.map(item => [item.ingredient_id, item]));
      const itemRows = (Array.isArray(formula.items) ? formula.items : []).map(item => ({
        id: existingByIngredient.get(item.ingredientId)?.id || crypto.randomUUID(),
        formula_version_id: formula.id,
        ingredient_id: item.ingredientId,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unitPrice || 0),
        line_cost: Number(item.cost ?? (Number(item.quantity || 0) * Number(item.unitPrice || 0))),
        inclusion_rate: item.inclusionRate == null ? null : Number(item.inclusionRate),
        nutrient_snapshot: item.nutrients || {}
      }));
      if (itemRows.length) await upsert("feed_formula_items", itemRows, "id");
      const keep = new Set(itemRows.map(item => item.id));
      const staleIds = existingItems.filter(item => !keep.has(item.id)).map(item => item.id);
      if (staleIds.length) await remove("feed_formula_items", query => query.in("id", staleIds));
    }

    if (purchases.length) {
      const rows = purchases.map(item => ({
        id: item.id, enterprise_id: enterprise.id,
        ingredient_id: item.ingredientId,
        supplier_id: item.supplierId || null,
        invoice_number: item.invoiceNumber || null,
        purchased_on: item.date,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unitPrice || 0),
        transport_cost: Number(item.transportCost || 0),
        other_cost: Number(item.otherCost || 0),
        total_cost: Number(item.totalCost || 0),
        landed_unit_cost: Number(item.landedUnitCost || 0),
        notes: item.notes || null, recorded_by: user.id
      }));
      await upsert("feed_purchases", rows, "id");

      const priceRows = purchases.filter(item => Number(item.landedUnitCost) >= 0).map(item => {
        const ingredient = ingredients.find(x => x.id === item.ingredientId);
        return {
          id: item.id, farm_id: farm.id, enterprise_id: enterprise.id,
          price_category: "feed_ingredient", item_name: ingredient?.name || "Feed ingredient",
          unit: ingredient?.unit || "kg", price: Number(item.landedUnitCost || 0),
          currency: "UGX", effective_date: item.date, recorded_by: user.id,
          notes: "Landed cost recorded from feed purchase"
        };
      });
      if (priceRows.length) await upsert("farm_price_history", priceRows, "id");

      const paymentRows = purchases.flatMap(purchase =>
        (Array.isArray(purchase.payments) ? purchase.payments : []).map(payment => {
          ensureUuid(payment);
          return {
            id: payment.id, farm_id: farm.id, enterprise_id: enterprise.id,
            transaction_type: "expense", category: "feed_purchase_payment",
            description: `Payment for feed purchase ${purchase.invoiceNumber || purchase.id.slice(0, 8)}`,
            amount: Number(payment.amount || 0), currency: "UGX",
            transaction_date: payment.date || purchase.date,
            reference: purchase.id, notes: payment.reference || null,
            recorded_by: user.id, updated_at: now
          };
        })
      ).filter(row => row.amount > 0);
      if (paymentRows.length) await upsert("farm_transactions", paymentRows, "id");
    }

    if (rawMovements.length) {
      await upsert("feed_stock_movements", rawMovements.map(item => ({
        id: item.id, enterprise_id: enterprise.id, ingredient_id: item.ingredientId,
        movement_type: item.type, quantity_change: Number(item.quantity || 0),
        unit_cost: Number(item.unitCost || 0), reference: item.reference || null,
        occurred_on: item.date, notes: item.notes || null, recorded_by: user.id
      })), "id");
    }

    if (production.length) {
      await upsert("feed_production", production.map(item => ({
        id: item.id, enterprise_id: enterprise.id,
        formula_version_id: item.formulaId, quantity: Number(item.quantity || 0),
        production_cost: Number(item.productionCost || 0),
        cost_per_kg: Number(item.costPerKg || 0),
        produced_on: item.date, batch_number: item.batchNumber || null,
        notes: item.notes || null, recorded_by: user.id
      })), "id");
    }

    if (finishedMovements.length) {
      await upsert("finished_feed_movements", finishedMovements.map(item => ({
        id: item.id, enterprise_id: enterprise.id,
        formula_version_id: item.formulaId, movement_type: item.type,
        quantity_change: Number(item.quantity || 0),
        unit_cost: Number(item.unitCost || 0), reference: item.reference || null,
        occurred_on: item.date, notes: item.notes || null, recorded_by: user.id
      })), "id");
    }

    if (allocations.length) {
      const rows = allocations.map(item => {
        const cloudBatchId = batchIdByLocal.get(String(item.batchId));
        if (!cloudBatchId) throw new Error("A feed allocation refers to a batch that has not been synchronised to the cloud.");
        return {
          id: item.id, enterprise_id: enterprise.id,
          livestock_batch_id: cloudBatchId,
          formula_version_id: item.formulaId,
          quantity: Number(item.quantity || 0),
          cost_per_kg: Number(item.costPerKg || 0),
          total_cost: Number(item.totalCost || 0),
          allocated_on: item.date, notes: item.notes || null,
          recorded_by: user.id
        };
      });
      await upsert("feed_allocations", rows, "id");
    }

    if (consumption.length) {
      const rows = consumption.map(item => {
        const cloudBatchId = batchIdByLocal.get(String(item.batchId));
        if (!cloudBatchId) throw new Error("A feed consumption record refers to a batch that has not been synchronised to the cloud.");
        return {
          id: item.id, enterprise_id: enterprise.id,
          allocation_id: item.allocationId,
          livestock_batch_id: cloudBatchId,
          quantity: Number(item.quantity || 0),
          consumed_on: item.date, notes: item.notes || null,
          recorded_by: user.id
        };
      });
      await upsert("feed_consumption", rows, "id");
    }

    return { farmId: farm.id, enterpriseId: enterprise.id, syncedAt: now };
  }

  async function loadFeedState(createIfMissing = true) {
    await ready();
    const farm = createIfMissing ? await ensureFarm() : await findFarm();
    const enterprise = createIfMissing
      ? await ensureEnterprise("broiler", "Broiler Farming")
      : await findEnterprise("broiler");
    if (!farm || !enterprise) {
      return {
        ingredients: [], suppliers: [], purchases: [], rawMovements: [], formulas: [],
        production: [], finishedMovements: [], allocations: [], consumption: [],
        priceHistory: [], batches: [], selectedBatch: "", activeTab: "overview"
      };
    }
    const [ingredientRows, supplierRows, purchaseRows, movementRows, formulaRows, productionRows, finishedRows, allocationRows, consumptionRows, priceHistoryRows, paymentRows] = await Promise.all([
      select("feed_ingredients", "*", q => q.eq("enterprise_id", enterprise.id)),
      select("feed_suppliers", "*", q => q.eq("farm_id", farm.id)),
      select("feed_purchases", "*", q => q.eq("enterprise_id", enterprise.id)),
      select("feed_stock_movements", "*", q => q.eq("enterprise_id", enterprise.id)),
      select("feed_formulas", "*", q => q.eq("enterprise_id", enterprise.id)),
      select("feed_production", "*", q => q.eq("enterprise_id", enterprise.id)),
      select("finished_feed_movements", "*", q => q.eq("enterprise_id", enterprise.id)),
      select("feed_allocations", "*", q => q.eq("enterprise_id", enterprise.id)),
      select("feed_consumption", "*", q => q.eq("enterprise_id", enterprise.id)),
      select("farm_price_history", "*", q => q.eq("enterprise_id", enterprise.id).eq("price_category", "feed_ingredient")),
      select("farm_transactions", "*", q => q.eq("enterprise_id", enterprise.id).eq("category", "feed_purchase_payment"))
    ]);
    const formulaIds = formulaRows.map(formula => formula.id);
    const versionRows = formulaIds.length
      ? await select("feed_formula_versions", "*", q => q.in("formula_id", formulaIds))
      : [];
    const versionIds = versionRows.map(version => version.id);
    const itemRows = versionIds.length
      ? await select("feed_formula_items", "*", q => q.in("formula_version_id", versionIds))
      : [];

    const ingredients = ingredientRows.map(row => ({
      id: row.id, name: row.name, category: row.category, unit: row.unit,
      currentPrice: Number(row.current_price || 0),
      protein: row.protein == null ? null : Number(row.protein),
      energy: row.energy == null ? null : Number(row.energy),
      fibre: row.fibre == null ? null : Number(row.fibre),
      calcium: row.calcium == null ? null : Number(row.calcium),
      phosphorus: row.phosphorus == null ? null : Number(row.phosphorus),
      lysine: row.lysine == null ? null : Number(row.lysine),
      methionine: row.methionine == null ? null : Number(row.methionine),
      nutrientProfile: row.nutrient_profile || {}, active: row.is_active,
      createdAt: row.created_at
    }));
    const suppliers = supplierRows.map(row => ({
      id: row.id, name: row.name, contact: row.contact_person || "",
      telephone: row.telephone || "", address: row.address || "",
      notes: row.notes || "", active: row.is_active, createdAt: row.created_at
    }));
    const paymentsByPurchase = new Map();
    paymentRows.forEach(row => {
      const purchaseId = row.reference;
      if (!purchaseId) return;
      if (!paymentsByPurchase.has(purchaseId)) paymentsByPurchase.set(purchaseId, []);
      paymentsByPurchase.get(purchaseId).push({
        id: row.id, amount: Number(row.amount), date: row.transaction_date,
        reference: row.notes || ""
      });
    });
    const purchases = purchaseRows.map(row => {
      const payments = paymentsByPurchase.get(row.id) || [];
      const paidAmount = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const balanceDue = Math.max(0, Number(row.total_cost) - paidAmount);
      return {
        id: row.id, supplierId: row.supplier_id, ingredientId: row.ingredient_id,
        invoiceNumber: row.invoice_number || "", date: row.purchased_on,
        quantity: Number(row.quantity), unitPrice: Number(row.unit_price),
        transportCost: Number(row.transport_cost), otherCost: Number(row.other_cost),
        totalCost: Number(row.total_cost), landedUnitCost: Number(row.landed_unit_cost),
        paidAmount, balanceDue,
        paymentStatus: balanceDue <= 0.005 ? "Paid" : paidAmount > 0 ? "Part paid" : "Unpaid",
        payments, notes: row.notes || "", createdAt: row.created_at
      };
    });
    const rawMovements = movementRows.map(row => ({
      id: row.id, ingredientId: row.ingredient_id, type: row.movement_type,
      quantity: Number(row.quantity_change), unitCost: Number(row.unit_cost),
      reference: row.reference || "", date: row.occurred_on,
      notes: row.notes || "", createdAt: row.created_at
    }));
    const priceHistory = priceHistoryRows.map(row => ({
      id: row.id, ingredientName: row.item_name, unit: row.unit,
      price: Number(row.price), date: row.effective_date,
      category: row.price_category, notes: row.notes || ""
    }));

    const itemsByVersion = new Map();
    itemRows.forEach(row => {
      if (!itemsByVersion.has(row.formula_version_id)) itemsByVersion.set(row.formula_version_id, []);
      const ingredient = ingredients.find(item => item.id === row.ingredient_id);
      itemsByVersion.get(row.formula_version_id).push({
        ingredientId: row.ingredient_id, name: ingredient?.name || "Ingredient",
        quantity: Number(row.quantity), unitPrice: Number(row.unit_price),
        cost: Number(row.line_cost), inclusionRate: Number(row.inclusion_rate || 0),
        nutrients: row.nutrient_snapshot || {}
      });
    });
    const formulas = versionRows.map(row => ({
      id: row.id,
      name: formulaRows.find(formula => formula.id === row.formula_id)?.name || "Feed formula",
      stage: formulaRows.find(formula => formula.id === row.formula_id)?.stage || "custom",
      version: Number(row.version_number), status: row.status,
      items: itemsByVersion.get(row.id) || [],
      totalWeight: Number(row.total_weight), totalCost: Number(row.total_cost),
      costPerKg: Number(row.cost_per_kg), nutrients: row.nutrient_profile || {},
      targetWeight: row.target_weight == null ? null : Number(row.target_weight),
      notes: row.notes || "", previousVersionId: row.previous_version_id || null,
      createdAt: row.created_at
    }));

    const production = productionRows.map(row => ({
      id: row.id, formulaId: row.formula_version_id,
      formulaVersion: Number(formulas.find(f => f.id === row.formula_version_id)?.version || 1),
      quantity: Number(row.quantity), productionCost: Number(row.production_cost),
      costPerKg: Number(row.cost_per_kg), date: row.produced_on,
      batchNumber: row.batch_number || "", notes: row.notes || "", createdAt: row.created_at
    }));
    const finishedMovements = finishedRows.map(row => ({
      id: row.id, formulaId: row.formula_version_id, type: row.movement_type,
      quantity: Number(row.quantity_change), unitCost: Number(row.unit_cost),
      reference: row.reference || "", date: row.occurred_on,
      notes: row.notes || "", createdAt: row.created_at
    }));

    const batches = await loadLivestockBatches("broiler", createIfMissing);
    const localBatchIdByCloud = new Map(batches.map(batch => [String(batch.cloudId || batch.id), String(batch.id)]));
    const allocations = allocationRows.map(row => ({
      id: row.id, batchId: localBatchIdByCloud.get(String(row.livestock_batch_id)) || row.livestock_batch_id,
      formulaId: row.formula_version_id, quantity: Number(row.quantity),
      costPerKg: Number(row.cost_per_kg), totalCost: Number(row.total_cost),
      date: row.allocated_on, notes: row.notes || "", createdAt: row.created_at
    }));
    const consumption = consumptionRows.map(row => ({
      id: row.id, type: "feed",
      batchId: localBatchIdByCloud.get(String(row.livestock_batch_id)) || row.livestock_batch_id,
      allocationId: row.allocation_id, quantity: Number(row.quantity),
      date: row.consumed_on, notes: row.notes || "", createdAt: row.created_at
    }));

    return {
      ingredients, suppliers, purchases, rawMovements, formulas, production,
      finishedMovements, allocations, consumption, priceHistory, batches,
      selectedBatch: batches[0]?.id || "", activeTab: "overview"
    };
  }


  async function savePortfolioInventory(records) {
    const { user } = await ready();
    const farm = await ensureFarm();
    const items = Array.isArray(records) ? records : [];
    const rows = [];
    const movementRows = [];

    for (const item of items) {
      ensureUuid(item);
      const enterpriseType = item.enterprise || item.projectSlug || item.project || "";
      const enterprise = enterpriseType ? await findEnterprise(enterpriseType) : null;
      const quantity = Number(item.currentQuantity ?? item.liveCount ?? item.quantity ?? item.count ?? item.currentStock ?? 0);
      rows.push({
        id: item.id, farm_id: farm.id, enterprise_id: enterprise?.id || null,
        category: String(item.category || item.type || item.species || "general"),
        name: String(item.name || item.itemName || item.product || "Farm inventory item"),
        unit: String(item.unit || "unit"),
        reorder_level: Math.max(0, Number(item.reorderLevel || item.minimumStock || 0)),
        is_active: item.active !== false && item.is_active !== false,
        notes: item.notes || null,
        metadata: { ...item, currentQuantity: quantity },
        updated_at: new Date().toISOString()
      });

      (Array.isArray(item.movements) ? item.movements : []).forEach(movement => {
        ensureUuid(movement);
        const type = ["purchase", "production", "sale", "use", "wastage", "adjustment", "transfer"].includes(movement.type || movement.movementType)
          ? (movement.type || movement.movementType) : "adjustment";
        const amount = Number(movement.quantityChange ?? movement.quantity ?? 0);
        if (!amount) return;
        movementRows.push({
          id: movement.id, farm_id: farm.id, item_id: item.id,
          enterprise_id: enterprise?.id || null, movement_type: type,
          quantity_change: amount, unit_cost: movement.unitCost == null ? null : Number(movement.unitCost),
          reference: movement.reference || null,
          occurred_at: movement.date ? new Date(movement.date).toISOString() : new Date().toISOString(),
          notes: movement.notes || null, recorded_by: user.id
        });
      });
    }

    if (rows.length) await upsert("inventory_items", rows, "id");
    if (movementRows.length) await upsert("inventory_movements", movementRows, "id");
    return { saved: rows.length, movements: movementRows.length };
  }

  async function savePortfolioExpenses(records) {
    const { user } = await ready();
    const farm = await ensureFarm();
    const items = Array.isArray(records) ? records : [];
    const rows = [];

    for (const item of items) {
      ensureUuid(item);
      const enterpriseType = item.enterprise || item.projectSlug || item.project || "";
      const enterprise = enterpriseType ? await findEnterprise(enterpriseType) : null;
      const amount = Number(item.amount ?? item.totalCost ?? item.cost ?? 0);
      if (!Number.isFinite(amount) || amount < 0) continue;
      const rawType = String(item.transactionType || item.type || "expense").toLowerCase();
      rows.push({
        id: item.id, farm_id: farm.id, enterprise_id: enterprise?.id || null,
        transaction_type: rawType === "income" || rawType === "sale" ? "income" : "expense",
        category: String(item.category || item.type || "other"),
        description: String(item.description || item.name || item.category || "Farm transaction"),
        amount, currency: item.currency || "UGX",
        transaction_date: String(item.date || item.expenseDate || item.createdAt || new Date().toISOString()).slice(0, 10),
        payment_method: item.paymentMethod || null,
        reference: item.reference || null, notes: item.notes || null,
        recorded_by: user.id, updated_at: new Date().toISOString()
      });
    }
    if (rows.length) await upsert("farm_transactions", rows, "id");
    return { saved: rows.length };
  }

  async function loadPortfolioData(createIfMissing = false) {
    await ready();
    const farm = createIfMissing ? await ensureFarm() : await findFarm();
    if (!farm) return { inventory: [], expenses: [] };

    const [itemRows, movementRows, transactionRows] = await Promise.all([
      select("inventory_items", "*", q => q.eq("farm_id", farm.id)),
      select("inventory_movements", "*", q => q.eq("farm_id", farm.id)),
      select("farm_transactions", "*", q => q.eq("farm_id", farm.id).order("transaction_date", { ascending: false }))
    ]);

    const movementTotals = new Map();
    movementRows.forEach(row => movementTotals.set(row.item_id,
      (movementTotals.get(row.item_id) || 0) + Number(row.quantity_change || 0)
    ));
    const movementsByItem = new Set(movementRows.map(row => row.item_id));
    const inventory = itemRows.map(row => {
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      return {
        ...metadata, id: row.id, name: row.name, category: row.category, unit: row.unit,
        reorderLevel: Number(row.reorder_level || 0), active: row.is_active,
        currentQuantity: metadata.currentQuantity != null
          ? Number(metadata.currentQuantity)
          : movementsByItem.has(row.id) ? movementTotals.get(row.id) : 0
      };
    });
    const expenses = transactionRows.map(row => ({
      id: row.id, date: row.transaction_date, category: row.category,
      amount: Number(row.amount), description: row.description,
      enterprise: row.enterprise_id || "farm", transactionType: row.transaction_type,
      paymentMethod: row.payment_method || "", reference: row.reference || "",
      notes: row.notes || ""
    }));
    return { inventory, expenses };
  }

  window.FratelCloud = Object.freeze({
    ready, getUser, ensureFarm, findFarm, ensureEnterprise, findEnterprise,
    select, insert, upsert, update, remove,
    loadLivestockBatches, saveLivestockBatch, deleteLivestockBatch,
    saveFeedState, loadFeedState,
    savePortfolioInventory, savePortfolioExpenses, loadPortfolioData
  });

  client().auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    farmPromise = null;
    enterprisePromises.clear();
  });
})();
