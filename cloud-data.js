/* ============================================================
   FRATEL-AGRIPREDICT — SHARED SUPABASE DATA SERVICE
   This module centralises authenticated access to existing
   farm, enterprise, livestock and feed tables.
   It does not create tables or expose privileged credentials.
============================================================ */
(() => {
  "use strict";

  const TABLES = new Set([
    "farms", "farm_enterprises", "livestock_batches",
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

  async function loadLivestockBatches(enterpriseType = "broiler") {
    const enterprise = await ensureEnterprise(enterpriseType, "Broiler Farming");
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
    const enterprise = await ensureEnterprise(enterpriseType, "Broiler Farming");
    const localId = String(batch.id || "");
    let cloudId = UUID_RE.test(batch.cloudId || "") ? batch.cloudId : (UUID_RE.test(localId) ? localId : null);

    if (!cloudId && localId) {
      const existing = await select("livestock_batches", "id,metadata", query => query.eq("enterprise_id", enterprise.id));
      cloudId = existing.find(row => row.metadata?.localId === localId)?.id || null;
    }

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

  window.FratelCloud = Object.freeze({
    ready, getUser, ensureFarm, ensureEnterprise,
    select, insert, upsert, update, remove,
    loadLivestockBatches, saveLivestockBatch, deleteLivestockBatch
  });

  client().auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    farmPromise = null;
    enterprisePromises.clear();
  });
})();
