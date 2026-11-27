/* =========================================================
   FRATEL-AGRIPREDICT — BROILER MANAGEMENT
   Matches broiler-dashboard.html
   Storage: agripredict_broiler_v1
   Frontend prototype — no Supabase connection yet
========================================================= */

(() => {
  "use strict";

  const STORAGE_KEY = "agripredict_broiler_v1";
  const ACTIVE_KEY = "agripredict_broiler_active";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const today = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const makeId = () =>
    globalThis.crypto?.randomUUID?.() ||
    `record-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const number = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const money = value =>
    `UGX ${Math.round(number(value)).toLocaleString("en-UG")}`;

  const formatNumber = value =>
    number(value).toLocaleString("en-UG", {
      maximumFractionDigits: 2
    });

  const formatDate = value => {
    if (!value) return "Not recorded";

    const date = new Date(`${value}T00:00:00`);

    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString("en-UG", {
          day: "numeric",
          month: "short",
          year: "numeric"
        });
  };

  const escapeHTML = value =>
    String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);

  function notify(message) {
    const element = $("#appNotification");

    if (!element) {
      alert(message);
      return;
    }

    element.textContent = message;
    element.hidden = false;

    clearTimeout(notify.timer);

    notify.timer = setTimeout(() => {
      element.hidden = true;
    }, 3500);
  }

  function readData() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));

      if (saved && typeof saved === "object") {
        if (!Array.isArray(saved.batches)) saved.batches = [];
        return saved;
      }
    } catch (error) {
      console.error("Could not read saved broiler data:", error);
    }

    return { batches: [] };
  }

  let data = readData();
  let activeBatchId = localStorage.getItem(ACTIVE_KEY) || "";
  // Read-only bridge for the forecasting module. It always exposes the
  // same in-memory batch records used by the dashboard itself.
  window.FratelAgriPredictDashboard = {
    getBatches: () => Array.isArray(data.batches) ? data.batches : [],
    getData: () => data
  };
  let editingBatchId = null;
  let selectedPriceCategory = "feed";

  function normaliseBatch(batch) {
    batch.records = Array.isArray(batch.records)
      ? batch.records
      : [];

    batch.priceChanges = Array.isArray(batch.priceChanges)
      ? batch.priceChanges
      : Array.isArray(batch.feedPrices)
        ? batch.feedPrices
        : Array.isArray(batch.feed_prices)
          ? batch.feed_prices
          : [];

    batch.id ||= makeId();

    return batch;
  }

  data.batches = data.batches.map(normaliseBatch);

  let cloudSaveQueue = Promise.resolve();

  function saveData() {
    // Keep a recoverable browser cache, but Supabase is the permanent store.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      localStorage.setItem(ACTIVE_KEY, activeBatchId);
    } catch (error) {
      console.warn("Could not update the local recovery cache:", error);
    }

    document.dispatchEvent(new CustomEvent("agripredict:broiler-data-updated"));

    const task = cloudSaveQueue.catch(() => {}).then(async () => {
      if (!window.FratelCloud) throw new Error("The cloud data service is not loaded.");
      await window.FratelCloud.ready();

      for (const batch of data.batches) {
        const saved = await window.FratelCloud.saveLivestockBatch(batch, "broiler");
        batch.cloudId = saved.cloudId;
      }

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (error) {
        console.warn("Cloud save succeeded, but the local recovery cache could not be updated:", error);
      }
      return true;
    });

    cloudSaveQueue = task;
    task.catch(error => {
      console.error("Broiler cloud synchronisation failed:", error);
      notify("Cloud save failed: " + (error.message || "Please check your connection and try again."));
    });
    return task;
  }

  function getBatch() {
    return data.batches.find(batch => batch.id === activeBatchId) || null;
  }

  function getRecords(batch = getBatch()) {
    if (!batch) return [];

    return [...(batch.records || [])].sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    );
  }

  function ageOf(batch) {
    if (!batch?.placementDate) return 0;

    const start = new Date(`${batch.placementDate}T00:00:00`);
    const now = new Date(`${today()}T00:00:00`);

    const elapsedDays = Math.floor((now - start) / 86400000);
    // Count the placement date as Day 1. A flock placed today is day-old,
    // not Day 0; future-dated placements remain at age 0 until placement.
    return elapsedDays < 0 ? 0 : elapsedDays + 1;
  }

  function calculate(batch = getBatch()) {
    if (!batch) return {};

    const records = batch.records || [];

    const mortality = records
      .filter(record => record.type === "mortality")
      .reduce((sum, record) => sum + number(record.quantity), 0);

    const sold = records
      .filter(record => record.type === "sale")
      .reduce((sum, record) => sum + number(record.quantity), 0);

    const feedRecords = records.filter(record => record.type === "feed");

    const feedConsumed = feedRecords.reduce(
      (sum, record) => sum + number(record.quantity),
      0
    );

    const expenses = records
      .filter(record => record.type === "expense")
      .reduce((sum, record) => sum + number(record.amount), 0);

    const chickCost =
      number(batch.initialBirds) * number(batch.chickCost);

    const feedCost = feedRecords.reduce((sum, record) => {
      const recordedCost = number(record.totalCost);

      return sum + (
        recordedCost ||
        number(record.quantity) * number(record.unitPrice)
      );
    }, 0);

    const healthCost = records
      .filter(record => record.type === "health")
      .reduce((sum, record) => sum + number(record.cost), 0);

    const revenue = records
      .filter(record => record.type === "sale")
      .reduce((sum, record) => sum + number(record.amount), 0);

    const totalCosts = chickCost + expenses + feedCost + healthCost;

    const initialBirds = number(batch.initialBirds);
    const alive = Math.max(0, initialBirds - mortality - sold);

    const survival = initialBirds > 0
      ? (alive / initialBirds) * 100
      : 0;

    const weights = records
      .filter(record => record.type === "weight")
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const latestWeight = weights.length
      ? weights[weights.length - 1]
      : null;

    const age = ageOf(batch);
    const targetAge = number(batch.targetAgeDays) || 28;

    return {
      records,
      mortality,
      sold,
      alive,
      survival,
      feedConsumed,
      feedRecords,
      weights,
      latestWeight,
      expenses,
      chickCost,
      feedCost,
      healthCost,
      totalCosts,
      revenue,
      profit: revenue - totalCosts,
      age,
      targetAge,
      remainingDays: Math.max(0, targetAge - age)
    };
  }

  /* =======================================================
     NAVIGATION
  ======================================================= */

  function navigate(view) {
    const page = $(`[data-page="${view}"]`);

    if (!page) {
      console.warn("Unknown page:", view);
      return;
    }

    $$(".app-page").forEach(section => {
      section.classList.toggle("active", section === page);
    });

    $$("[data-view]").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.view === view
      );
    });

    $("#appSidebar")?.classList.remove("open");

    if (view === "overview" || view === "home") renderDashboard();
    if (view === "daily-records") renderActivity();
    if (view === "growth") renderGrowth();
    if (view === "predictions") renderPredictions();
    if (view === "financials") renderFinancials();
    if (view === "health") renderHealth();
    if (view === "feed") renderFeed();
    if (view === "prices") renderPrices();
    if (view === "batch-settings") renderBatchSettings();
  }

  document.addEventListener("click", event => {
    const viewButton = event.target.closest("[data-view]");

    if (viewButton) {
      event.preventDefault();
      navigate(viewButton.dataset.view);
    }
  });

  /* =======================================================
     BATCH CREATION AND EDITING
  ======================================================= */

  function showSetup(editBatch = null) {
    editingBatchId = editBatch?.id || null;

    const form = $("#batchSetupForm");
    form.reset();

    $("#setupError").textContent = "";

    const values = editBatch || {};

    [
      "name",
      "house",
      "breed",
      "supplier",
      "initialBirds",
      "placementDate",
      "chickCost",
      "initialWeight",
      "targetAgeDays",
      "targetWeight",
      "expectedPrice",
      "priceBasis",
      "notes"
    ].forEach(name => {
      const field = form.elements[name];

      if (field) field.value = values[name] ?? "";
    });

    const submit = form.querySelector('[type="submit"]');
    const cancelButton = $("#cancelBatchSetupBtn");
    if (cancelButton) cancelButton.hidden = data.batches.length === 0;

    submit.innerHTML = editBatch
      ? 'Save changes <span aria-hidden="true">→</span>'
      : 'Create batch <span aria-hidden="true">→</span>';

    $("#setupView").hidden = false;
    $("#workspaceView").hidden = true;

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openWorkspace() {
    $("#setupView").hidden = true;
    $("#workspaceView").hidden = false;

    populateBatchSelect();
    renderDashboard();
    navigate("home");
  }

  function populateBatchSelect() {
    const select = $("#batchSelect");

    select.innerHTML = "";

    if (!data.batches.length) {
      select.innerHTML = '<option value="">No batches</option>';
      return;
    }

    data.batches.forEach(batch => {
      const option = document.createElement("option");

      option.value = batch.id;
      option.textContent = batch.name || "Unnamed batch";
      option.selected = batch.id === activeBatchId;

      select.appendChild(option);
    });
  }

  async function createOrUpdateBatch(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());

    const initialBirds = number(values.initialBirds);

    if (!values.name.trim()) {
      $("#setupError").textContent = "Enter a batch name.";
      return;
    }

    if (initialBirds < 1) {
      $("#setupError").textContent = "Enter a valid number of chicks.";
      return;
    }

    if (!values.placementDate) {
      $("#setupError").textContent = "Select the placement date.";
      return;
    }

    let batch;

    if (editingBatchId) {
      batch = data.batches.find(item => item.id === editingBatchId);

      if (!batch) {
        $("#setupError").textContent = "The batch could not be found.";
        return;
      }

      Object.assign(batch, values);
    } else {
      batch = {
        id: makeId(),
        records: [],
        priceChanges: [],
        createdAt: new Date().toISOString(),
        ...values
      };

      data.batches.push(batch);
    }

    batch.initialBirds = initialBirds;
    batch.chickCost = number(values.chickCost);
    batch.initialWeight = number(values.initialWeight);
    batch.targetAgeDays = number(values.targetAgeDays) || 28;
    batch.targetWeight = number(values.targetWeight);
    batch.expectedPrice = number(values.expectedPrice);
    batch.priceBasis = values.priceBasis || "bird";

    activeBatchId = batch.id;
    editingBatchId = null;

    try {
      await saveData();
      openWorkspace();
      notify("Batch saved securely to your farm account.");
    } catch (error) {
      $("#setupError").textContent = "The batch could not be saved online: " + (error.message || "Please try again.");
    }
  }

  $("#batchSetupForm").addEventListener("submit", createOrUpdateBatch);

  $("#addBatchBtn")?.addEventListener("click", () => showSetup());
  $("#settingsAddBatchBtn")?.addEventListener("click", () => showSetup());
  $("#cancelBatchSetupBtn")?.addEventListener("click", () => {
    if (data.batches.length) openWorkspace();
    else notify("Create your first batch to open the workspace.");
  });

  $("#editBatchBtn")?.addEventListener("click", () => {
    const batch = getBatch();

    if (batch) showSetup(batch);
  });

  $("#batchSelect")?.addEventListener("change", event => {
    if (!data.batches.some(batch => batch.id === event.target.value)) return;

    activeBatchId = event.target.value;
    saveData();
    renderDashboard();
    navigate("overview");

    notify("Active batch changed.");
  });

  /* =======================================================
     RECORD MODAL
  ======================================================= */

  const recordDefinitions = {
    feed: {
      title: "Record feed intake",
      fields: [
        ["date", "Date", "date", "required"],
        ["feedType", "Feed type", "select", "required", ["Starter", "Grower", "Finisher", "Other"]],
        ["quantity", "Quantity supplied (kg)", "number", "required"],
        ["unitPrice", "Price per kg (UGX)", "number", ""],
        ["notes", "Notes", "textarea", ""]
      ]
    },

    weight: {
      title: "Record bird weight",
      fields: [
        ["date", "Measurement date", "date", "required"],
        ["sampleSize", "Number of birds sampled", "number", ""],
        ["averageWeight", "Average weight (kg)", "number", "required"],
        ["notes", "Notes", "textarea", ""]
      ]
    },

    mortality: {
      title: "Record mortality",
      fields: [
        ["date", "Date", "date", "required"],
        ["quantity", "Number of birds lost", "number", "required"],
        ["cause", "Possible cause", "text", ""],
        ["notes", "Observations", "textarea", ""]
      ]
    },

    health: {
      title: "Record health event",
      fields: [
        ["date", "Date", "date", "required"],
        ["eventType", "Event type", "select", "required", ["Vaccination", "Treatment", "Medication", "Disease", "Other"]],
        ["description", "Description", "text", "required"],
        ["quantity", "Birds affected", "number", ""],
        ["cost", "Cost (UGX)", "number", ""],
        ["notes", "Notes", "textarea", ""]
      ]
    },

    expense: {
      title: "Record farm expense",
      fields: [
        ["date", "Date", "date", "required"],
        ["category", "Expense category", "select", "required", ["Labour", "Electricity", "Water", "Bedding", "Transport", "Equipment", "Medication", "Other"]],
        ["description", "Description", "text", "required"],
        ["amount", "Amount (UGX)", "number", "required"],
        ["notes", "Notes", "textarea", ""]
      ]
    },

    sale: {
      title: "Record bird sale",
      fields: [
        ["date", "Sale date", "date", "required"],
        ["quantity", "Number of birds sold", "number", "required"],
        ["unitPrice", "Selling price per bird (UGX)", "number", ""],
        ["amount", "Total amount received (UGX)", "number", ""],
        ["customer", "Customer", "text", ""],
        ["notes", "Notes", "textarea", ""]
      ]
    },

    feed_price: {
      title: "Change a farm price",
      fields: [
        ["date", "Effective date", "date", "required"],
        ["category", "Price category", "select", "required", ["Feed", "Chick", "Other input", "Selling"]],
        ["item", "Item / feed type", "text", "required"],
        ["supplier", "Supplier / source", "text", ""],
        ["price", "New price (UGX)", "number", "required"],
        ["unit", "Price unit", "select", "", ["Per kg", "Per bird", "Per bag", "Per item"]],
        ["notes", "Notes", "textarea", ""]
      ]
    }
  };

  function fieldHTML(field) {
    const [name, label, type, required, options] = field;
    const fieldId = `record-${name}`;
    const requiredAttribute = required === "required" ? "required" : "";
    const defaultValue = name === "date" ? today() : "";
    let control = "";

    if (type === "select") {
      control = `
        <select id="${fieldId}" name="${name}" ${requiredAttribute}>
          <option value="">Select ${label.toLowerCase()}</option>
          ${options.map(option => `<option value="${escapeHTML(option)}">${escapeHTML(option)}</option>`).join("")}
        </select>`;
    } else if (type === "textarea") {
      control = `<textarea id="${fieldId}" name="${name}" rows="3" ${requiredAttribute}></textarea>`;
    } else {
      control = `<input id="${fieldId}" type="${type}" name="${name}" ${type === "number" ? 'min="0" step="any"' : ""} value="${defaultValue}" ${requiredAttribute}>`;
    }

    return `<div class="form-field"><label for="${fieldId}">${escapeHTML(label)}</label>${control}</div>`;
  }

  function openRecord(type, category = "") {
    const definition = recordDefinitions[type];

    if (!definition) {
      notify("This record type is not supported.");
      return;
    }

    if (!getBatch()) {
      notify("Create or select a batch first.");
      return;
    }

    if (type === "feed_price" && category) {
      selectedPriceCategory = category;
    }

    $("#modalTitle").textContent = definition.title;

    $("#recordFields").innerHTML = definition.fields
      .map(fieldHTML)
      .join("");

    const categoryField = $("#recordFields [name='category']");

    if (type === "feed_price" && categoryField) {
      const categoryMap = {
        feed: "Feed",
        chick: "Chick",
        input: "Other input",
        selling: "Selling"
      };

      categoryField.value = categoryMap[selectedPriceCategory] || "Feed";
    }

    $("#recordError").textContent = "";
    $("#recordModal").hidden = false;

    $("#recordFields input, #recordFields select, #recordFields textarea")
      ?.focus();
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-record]");

    if (button) {
      openRecord(button.dataset.record);
    }
  });

  $$("[data-close]").forEach(button => {
    button.addEventListener("click", closeModal);
  });

  function closeModal() {
    $("#recordModal").hidden = true;
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeModal();
  });

  $("#recordForm").addEventListener("submit", event => {
    event.preventDefault();

    const batch = getBatch();

    if (!batch) {
      $("#recordError").textContent = "No active batch selected.";
      return;
    }

    const values = Object.fromEntries(
      new FormData(event.currentTarget).entries()
    );

    const type = $("#modalTitle").textContent;

    const recordType = Object.keys(recordDefinitions).find(key =>
      recordDefinitions[key].title === type
    );

    if (!recordType) return;

    const record = {
      id: makeId(),
      type: recordType,
      date: values.date || today(),
      createdAt: new Date().toISOString(),
      ...values
    };

    if (["feed", "mortality", "sale"].includes(recordType) && number(record.quantity) <= 0) {
      $("#recordError").textContent = "Enter a quantity greater than zero.";
      return;
    }
    if (["mortality", "sale"].includes(recordType) && !Number.isInteger(number(record.quantity))) {
      $("#recordError").textContent = "Bird quantities must be whole numbers.";
      return;
    }
    if (recordType === "weight" && number(record.averageWeight) <= 0) {
      $("#recordError").textContent = "Enter an average weight greater than zero.";
      return;
    }
    if (recordType === "weight" && values.sampleSize && (!Number.isInteger(number(values.sampleSize)) || number(values.sampleSize) < 1)) {
      $("#recordError").textContent = "Sample size must be a whole number greater than zero.";
      return;
    }
    if (recordType === "expense" && number(record.amount) <= 0) {
      $("#recordError").textContent = "Enter an expense amount greater than zero.";
      return;
    }
    if (recordType === "feed_price" && number(record.price) <= 0) {
      $("#recordError").textContent = "Enter a price greater than zero.";
      return;
    }

    if (recordType === "feed") {
      const applicablePrice = getPriceAtDate(
        batch,
        values.feedType,
        values.date
      );

      record.unitPrice = number(values.unitPrice) ||
        number(applicablePrice?.price);

      record.totalCost =
        number(record.quantity) * number(record.unitPrice);
    }

    if (recordType === "sale") {
      if (!number(record.amount)) {
        record.amount =
          number(record.quantity) * number(record.unitPrice);
      }
    }

    if (recordType === "feed_price") {
      record.price = number(values.price);
      record.category = values.category;
      record.item = values.item;
      record.unit = values.unit || "";
      batch.priceChanges.push(record);

      saveData();
      closeModal();
      renderDashboard();
      renderPrices();

      notify("Price change saved. Previous prices were preserved.");
      return;
    }

    if (recordType === "mortality") {
      const totals = calculate(batch);

      if (number(record.quantity) > totals.alive) {
        $("#recordError").textContent =
          "Mortality cannot exceed the number of birds currently alive.";
        return;
      }
    }

    if (recordType === "sale") {
      const totals = calculate(batch);

      if (number(record.quantity) > totals.alive) {
        $("#recordError").textContent =
          "You cannot sell more birds than are currently alive.";
        return;
      }
    }

    batch.records.push(record);

    saveData();
    closeModal();
    renderDashboard();
    renderCurrentPage();

    notify("Record saved successfully.");
  });

  function getPriceAtDate(batch, feedType, date) {
    const matching = (batch.priceChanges || [])
      .filter(price =>
        String(price.category).toLowerCase() === "feed" &&
        String(price.date) <= String(date) &&
        (
          !price.item ||
          price.item.toLowerCase() === String(feedType).toLowerCase()
        )
      )
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    return matching[0] || null;
  }

  function renderCurrentPage() {
    const activePage = $(".app-page.active")?.dataset.page;

    const renderers = {
      home: renderDashboard,
      overview: renderDashboard,
      "daily-records": renderActivity,
      growth: renderGrowth,
      predictions: renderPredictions,
      financials: renderFinancials,
      health: renderHealth,
      feed: renderFeed,
      prices: renderPrices,
      "batch-settings": renderBatchSettings
    };

    renderers[activePage]?.();
  }

  /* =======================================================
     DASHBOARD / HOME
  ======================================================= */

  function renderDashboard() {
    const batch = getBatch();

    if (!batch) return;

    const stats = calculate(batch);

    const title = batch.name || "Unnamed batch";
    const meta = [
      batch.house,
      batch.breed,
      `Placed ${formatDate(batch.placementDate)}`
    ].filter(Boolean).join(" · ");

    $("#homeBatchTitle").textContent = title;
    $("#homeBatchMeta").textContent = meta;
    $("#homeBatchStatus").textContent = "Active batch";

    $("#batchTitle").textContent = title;
    $("#batchMeta").textContent = meta;

    $("#batchStatus").textContent = "Active";
    $("#ageNumber").textContent = stats.age;
    $("#currentStage").textContent = lifecycleStage(stats.age);

    $("#stageHint").textContent =
      `Your flock is currently in the ${lifecycleStage(stats.age).toLowerCase()} stage.`;

    const targetDate = new Date(
      `${batch.placementDate}T00:00:00`
    );

    targetDate.setDate(targetDate.getDate() + Math.max(0, stats.targetAge - 1));

    $("#targetDate").textContent = formatDate(
      targetDate.toISOString().slice(0, 10)
    );

    $("#daysToTarget").textContent = stats.remainingDays;

    const progress = Math.min(
      100,
      (stats.age / stats.targetAge) * 100
    );

    $("#timelineProgress").style.width = `${progress}%`;

    $("#birdsAlive").textContent = formatNumber(stats.alive);
    $("#birdsPlacedNote").textContent =
      `Birds placed: ${formatNumber(batch.initialBirds)}`;

    $("#survivalRate").textContent =
      `${stats.survival.toFixed(1)}%`;

    $("#mortalityNote").textContent =
      `${formatNumber(stats.mortality)} deaths recorded`;

    $("#feedConsumed").textContent =
      `${formatNumber(stats.feedConsumed)} kg`;

    $("#latestWeight").textContent = stats.latestWeight
      ? `${formatNumber(stats.latestWeight.averageWeight)} kg`
      : "--";

    $("#weightDate").textContent = stats.latestWeight
      ? formatDate(stats.latestWeight.date)
      : "No weight record yet";

    $("#totalCosts").textContent = money(stats.totalCosts);
    $("#totalRevenue").textContent = money(stats.revenue);
    $("#profit").textContent = money(stats.profit);

    $("#summaryPlaced").textContent = formatNumber(batch.initialBirds);
    $("#summarySold").textContent = formatNumber(stats.sold);
    $("#summaryMortality").textContent = formatNumber(stats.mortality);

    renderGrowthChart();
    renderActivity();
    populateBatchSelect();
  }

  function lifecycleStage(age) {
    if (age <= 0) return "Pre-placement";
    if (age === 1) return "Day-old chicks · Brooding";
    if (age <= 7) return "Brooding";
    if (age <= 14) return "Starter";
    if (age <= 21) return "Grower";
    return "Finisher";
  }

  /* =======================================================
     GROWTH
  ======================================================= */

  function renderGrowthChart() {
    const batch = getBatch();

    if (!batch) return;

    const stats = calculate(batch);

    const chartHTML = stats.weights.length
      ? `
        <div class="growth-chart-list">
          ${stats.weights.map(record => `
            <div class="growth-chart-row">
              <span>${formatDate(record.date)}</span>
              <strong>${formatNumber(record.averageWeight)} kg</strong>
              <div class="growth-bar-track">
                <div class="growth-bar" style="width:${
                  Math.min(
                    100,
                    number(record.averageWeight) /
                    Math.max(number(batch.targetWeight), 0.1) * 100
                  )
                }%"></div>
              </div>
            </div>
          `).join("")}
        </div>`
      : `
        <div class="empty-state">
          <span class="empty-icon">↗</span>
          <p>Record bird weights to build your growth history.</p>
        </div>`;

    ["#growthChart", "#growthDetailChart"].forEach(selector => {
      const chart = $(selector);
      if (chart) chart.innerHTML = chartHTML;
    });

    if (stats.latestWeight && number(batch.targetWeight) > 0) {
      const difference =
        number(batch.targetWeight) -
        number(stats.latestWeight.averageWeight);

      $("#growthEstimate").textContent =
        `${formatNumber(Math.abs(difference))} kg ${
          difference > 0 ? "below" : "above"
        } target weight`;

      $("#growthEstimateNote").textContent =
        "This comparison uses your latest recorded sample, not a validated growth forecast.";
    } else {
      $("#growthEstimate").textContent = "";
      $("#growthEstimateNote").textContent =
        "Record a weight and set a target to compare flock progress.";
    }
  }

  function renderGrowth() {
    const batch = getBatch();

    if (!batch) return;

    const stats = calculate(batch);

    $("#growthLatestWeight").textContent = stats.latestWeight
      ? `${formatNumber(stats.latestWeight.averageWeight)} kg`
      : "--";

    $("#growthTargetWeight").textContent =
      number(batch.targetWeight)
        ? `${formatNumber(batch.targetWeight)} kg`
        : "--";

    $("#growthAge").textContent = `${stats.age} day${stats.age === 1 ? "" : "s"}`;

    const weights = stats.weights;
    const firstWeight = weights[0];
    const lastWeight = stats.latestWeight;
    const initialKg = number(batch.initialWeight) > 0 ? number(batch.initialWeight) / 1000 : null;
    let gainKg = null;
    let elapsedDays = 0;
    if (weights.length >= 2) {
      gainKg = number(lastWeight.averageWeight) - number(firstWeight.averageWeight);
      elapsedDays = Math.max(1, Math.round((new Date(`${lastWeight.date}T00:00:00`) - new Date(`${firstWeight.date}T00:00:00`)) / 86400000));
    } else if (lastWeight && initialKg !== null && stats.age > 0) {
      gainKg = number(lastWeight.averageWeight) - initialKg;
      elapsedDays = Math.max(1, stats.age);
    }
    const biomassGain = gainKg !== null && gainKg > 0 ? gainKg * Math.max(1, stats.alive) : null;
    const fcr = biomassGain && stats.feedConsumed > 0 ? stats.feedConsumed / biomassGain : null;
    const adg = gainKg !== null && gainKg > 0 && elapsedDays > 0 ? (gainKg * 1000) / elapsedDays : null;
    const mortalityRate = number(batch.initialBirds) > 0 ? stats.mortality / number(batch.initialBirds) * 100 : null;
    const targetGap = lastWeight && number(batch.targetWeight) > 0
      ? (number(lastWeight.averageWeight) - number(batch.targetWeight)) / number(batch.targetWeight) * 100 : null;
    $("#performanceFCR").textContent = fcr !== null ? formatNumber(fcr) : "Not enough data";
    $("#performanceADG").textContent = adg !== null ? `${formatNumber(adg)} g/day` : "Not enough data";
    $("#performanceMortality").textContent = mortalityRate !== null ? `${formatNumber(mortalityRate)}%` : "Not available";
    $("#performanceTargetGap").textContent = targetGap !== null ? `${targetGap >= 0 ? "+" : ""}${formatNumber(targetGap)}%` : "Not available";
    $("#performanceMethodNote").textContent = fcr === null
      ? "FCR needs feed consumption and at least two weight points, or an initial weight plus a later measurement. ADG uses the measured weight change over elapsed days. Missing values are not guessed."
      : "FCR uses total recorded feed divided by estimated live-weight gain since the first available weight baseline. ADG uses measured average-weight change.";

    renderGrowthChart();

    $("#weightHistory").innerHTML = stats.weights.length
      ? `
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Sample size</th>
              <th>Average weight</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${[...stats.weights].reverse().map(record => `
              <tr>
                <td>${formatDate(record.date)}</td>
                <td>${escapeHTML(record.sampleSize || "--")}</td>
                <td>${formatNumber(record.averageWeight)} kg</td>
                <td>${escapeHTML(record.notes || "--")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>`
      : '<p class="empty-message">No weight records available.</p>';
  }

  /* =======================================================
     ACTIVITY HISTORY
  ======================================================= */

  function renderActivity() {
    const batch = getBatch();

    if (!batch) return;

    const filter = $("#activityFilter")?.value || "all";

    const records = getRecords(batch).filter(record =>
      filter === "all" || record.type === filter
    );

    const html = records.length
      ? records.map(record => `
          <div class="activity-item">
            <div>
              <strong>${escapeHTML(recordTitle(record))}</strong>
              <small>${formatDate(record.date)}</small>
            </div>
            <div>
              <strong>${escapeHTML(recordSummary(record))}</strong>
              <small>${escapeHTML(record.notes || record.description || "")}</small>
            </div>
          </div>
        `).join("")
      : '<div class="empty-state"><p>No records found.</p></div>';

    $("#activityList").innerHTML = html;
    $("#activityListRecords").innerHTML = html;
  }

  $("#activityFilter")?.addEventListener("change", renderActivity);

  function recordTitle(record) {
    const names = {
      feed: "Feed intake",
      weight: "Bird weight",
      mortality: "Mortality",
      health: "Health event",
      expense: "Farm expense",
      sale: "Bird sale"
    };

    return names[record.type] || record.type;
  }

  function recordSummary(record) {
    switch (record.type) {
      case "feed":
        return `${formatNumber(record.quantity)} kg`;
      case "weight":
        return `${formatNumber(record.averageWeight)} kg average`;
      case "mortality":
        return `${formatNumber(record.quantity)} birds`;
      case "health":
        return record.description || record.eventType || "Health event";
      case "expense":
        return money(record.amount);
      case "sale":
        return `${formatNumber(record.quantity)} birds · ${money(record.amount)}`;
      default:
        return "";
    }
  }

  /* =======================================================
     PREDICTIONS
  ======================================================= */

  function renderPredictions() {
    const batch = getBatch();

    if (!batch) return;

    const stats = calculate(batch);

    const harvestDate = new Date(
      `${batch.placementDate}T00:00:00`
    );

    harvestDate.setDate(harvestDate.getDate() + Math.max(0, stats.targetAge - 1));

    $("#predictedHarvestDate").textContent = formatDate(
      harvestDate.toISOString().slice(0, 10)
    );

    $("#predictedBirds").textContent =
      `${formatNumber(stats.alive)} birds`;

    if (stats.latestWeight) {
      const weightRows = stats.weights;
      let dailyGainKg = null;
      if (weightRows.length >= 2) {
        const first = weightRows[0], last = weightRows[weightRows.length - 1];
        const elapsed = Math.max(1, (new Date(`${last.date}T00:00:00`) - new Date(`${first.date}T00:00:00`)) / 86400000);
        const gain = number(last.averageWeight) - number(first.averageWeight);
        if (gain > 0) dailyGainKg = gain / elapsed;
      } else if (number(batch.initialWeight) > 0 && stats.age > 0) {
        const gain = number(stats.latestWeight.averageWeight) - number(batch.initialWeight) / 1000;
        if (gain > 0) dailyGainKg = gain / stats.age;
      }
      if (dailyGainKg !== null && stats.remainingDays > 0) {
        const harvestWeight = number(stats.latestWeight.averageWeight) + dailyGainKg * stats.remainingDays;
        $("#predictedWeight").textContent = `${formatNumber(harvestWeight)} kg`;
        $("#predictedWeight").nextElementSibling.textContent =
          `Illustrative harvest weight using measured ADG of ${formatNumber(dailyGainKg * 1000)} g/day.`;
      } else {
        $("#predictedWeight").textContent = `${formatNumber(stats.latestWeight.averageWeight)} kg`;
        $("#predictedWeight").nextElementSibling.textContent =
          "Latest measured average; harvest weight forecast needs at least two dated weights or an initial weight baseline.";
      }
    } else {
      $("#predictedWeight").textContent = "Not available";
    }

    if (stats.feedRecords.length && stats.age > 0) {
      const dailyFeed = stats.feedConsumed / stats.age;
      const remaining = dailyFeed * stats.remainingDays;

      $("#predictedFeed").textContent =
        `${formatNumber(remaining)} kg`;

      $("#predictedFeed").nextElementSibling.textContent =
        "Simple estimate using average recorded daily consumption.";
    } else {
      $("#predictedFeed").textContent = "Not available";
    }

    $("#predictionTimeline").innerHTML = `
      <div class="prediction-timeline-item">
        <strong>Current age</strong>
        <span>${stats.age} day${stats.age === 1 ? "" : "s"}</span>
      </div>
      <div class="prediction-timeline-item">
        <strong>Target harvest age</strong>
        <span>${stats.targetAge} days</span>
      </div>
      <div class="prediction-timeline-item">
        <strong>Days remaining</strong>
        <span>${stats.remainingDays} day${stats.remainingDays === 1 ? "" : "s"}</span>
      </div>
      <div class="prediction-timeline-item">
        <strong>Lifecycle stage</strong>
        <span>${lifecycleStage(stats.age)}</span>
      </div>
    `;

    const confidenceItems = [
      `${stats.weights.length} weight measurements`,
      `${stats.feedRecords.length} feed records`,
      `${stats.records.filter(record => record.type === "mortality").length} mortality records`,
      `${stats.records.filter(record => record.type === "health").length} health records`
    ];

    renderFeedBudget();

    $("#predictionConfidence").innerHTML = `
      <p>Available information for this forecast:</p>
      <ul>
        ${confidenceItems.map(item => `<li>${escapeHTML(item)}</li>`).join("")}
      </ul>
      <p>These estimates are based on recorded information and simple assumptions.
      They are not yet a validated poultry growth model.</p>
    `;
  }

  /* =======================================================
     FINANCIALS
  ======================================================= */

  function renderFinancials() {
    const batch = getBatch();

    if (!batch) return;

    const stats = calculate(batch);

    $("#financialCosts").textContent = money(stats.totalCosts);
    $("#financialRevenue").textContent = money(stats.revenue);
    $("#financialProfit").textContent = money(stats.profit);

    const categories = {};

    categories["Chick purchase"] = stats.chickCost;
    categories["Feed"] = stats.feedCost;
    categories["Health"] = stats.healthCost;

    stats.records
      .filter(record => record.type === "expense")
      .forEach(record => {
        const key = record.category || "Other";
        categories[key] = (categories[key] || 0) + number(record.amount);
      });

    $("#costBreakdown").innerHTML = Object.entries(categories)
      .filter(([, amount]) => amount > 0)
      .map(([category, amount]) => `
        <div class="financial-summary-row">
          <span>${escapeHTML(category)}</span>
          <strong>${money(amount)}</strong>
        </div>
      `).join("") || '<p class="empty-message">No expenses recorded.</p>';

    const transactions = [];
    if (stats.chickCost > 0) transactions.push({date:batch.placementDate,type:"Chick purchase",description:`${formatNumber(batch.initialBirds)} chicks`,amount:stats.chickCost});
    stats.records.forEach(record=>{
      if(record.type==="expense") transactions.push({date:record.date,type:"Expense",description:record.description||record.category||"Farm expense",amount:number(record.amount)});
      if(record.type==="feed") transactions.push({date:record.date,type:"Feed",description:`${formatNumber(record.quantity)} kg · ${record.feedType||"Feed intake"}`,amount:number(record.totalCost)||number(record.quantity)*number(record.unitPrice)});
      if(record.type==="health" && number(record.cost)>0) transactions.push({date:record.date,type:"Health",description:record.description||record.eventType||"Health event",amount:number(record.cost)});
      if(record.type==="sale") transactions.push({date:record.date,type:"Sale",description:record.description||record.customer||`${formatNumber(record.quantity)} birds sold`,amount:number(record.amount)});
    });
    transactions.sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));

    $("#financialHistory").innerHTML = transactions.length
      ? `
        <table>
          <thead>
            <tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th></tr>
          </thead>
          <tbody>
            ${transactions.map(record => `
              <tr>
                <td>${formatDate(record.date)}</td>
                <td>${escapeHTML(record.type)}</td>
                <td>${escapeHTML(record.description || "--")}</td>
                <td>${money(record.amount)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>`
      : '<p class="empty-message">No financial transactions available.</p>';
  }

  /* =======================================================
     HEALTH
  ======================================================= */

  function renderHealth() {
    const batch = getBatch();

    if (!batch) return;

    const stats = calculate(batch);

    $("#healthBirdsAlive").textContent = formatNumber(stats.alive);
    $("#healthMortality").textContent = formatNumber(stats.mortality);
    $("#healthSurvival").textContent = `${stats.survival.toFixed(1)}%`;

    const records = stats.records.filter(record =>
      ["health", "mortality"].includes(record.type)
    );

    $("#healthHistory").innerHTML = records.length
      ? records.map(record => `
        <div class="activity-item">
          <div>
            <strong>${escapeHTML(recordTitle(record))}</strong>
            <small>${formatDate(record.date)}</small>
          </div>
          <div>
            <strong>${escapeHTML(recordSummary(record))}</strong>
            <small>${escapeHTML(record.notes || record.cause || "")}</small>
          </div>
        </div>
      `).join("")
      : '<p class="empty-message">No health records available.</p>';
  }

  /* =======================================================
     FEED MANAGEMENT
  ======================================================= */

  function renderFeed() {
    const batch = getBatch();
    if (!batch) return;

    const stats = calculate(batch);
    const consumed = $("#feedTotalConsumed");
    if (consumed) consumed.textContent = `${formatNumber(stats.feedConsumed)} kg`;

    if (window.AgriPredictFeedUI?.refresh) {
      window.AgriPredictFeedUI.refresh(batch);
    } else {
      console.warn("Feed interface has not loaded. Check broiler-feed.js and broiler-feed-ui.js script references.");
    }
  }

  /* =======================================================
     PRICE MANAGEMENT
  ======================================================= */

  $$("[data-price-category]").forEach(button => {
    button.addEventListener("click", () => {
      selectedPriceCategory = button.dataset.priceCategory;
      openRecord("feed_price", selectedPriceCategory);
    });
  });

  
  const feedStandardDefaults = { starter: 35, grower: 75, finisher: 120 };
  function dailyFeedStandard(age, controls) {
    if (age <= 14) return number(controls.starter) / 1000;
    if (age <= 28) return number(controls.grower) / 1000;
    return number(controls.finisher) / 1000;
  }

  function latestFeedPrice(batch) {
    return [...(batch.priceChanges || [])]
      .filter(p => String(p.category).toLowerCase() === "feed" && number(p.price) > 0)
      .sort((a,b) => String(b.date || "").localeCompare(String(a.date || "")))[0]?.price || 0;
  }

  function estimateBatchFeed(batch, days) {
    const stats = calculate(batch);
    const endAge = stats.age + days;
    const feedRows = (batch.records || []).filter(r => r.type === "feed" && number(r.quantity) > 0);
    const recent = feedRows.filter(r => {
      const age = Math.floor((new Date(`${r.date}T00:00:00`) - new Date(`${batch.placementDate}T00:00:00`)) / 86400000);
      return age >= Math.max(0, stats.age - 14) && age <= stats.age;
    });
    const actualDailyKg = recent.length
      ? recent.reduce((s,r) => s + number(r.quantity),0) / Math.max(1, Math.min(14, stats.age || 1))
      : (feedRows.length && stats.age > 0 ? stats.feedConsumed / stats.age : null);
    const birds = Math.max(0, stats.alive);
    const standards = {
      starter: $("#feedStandardStarter")?.value || feedStandardDefaults.starter,
      grower: $("#feedStandardGrower")?.value || feedStandardDefaults.grower,
      finisher: $("#feedStandardFinisher")?.value || feedStandardDefaults.finisher
    };
    let projected = 0;
    for (let d = 1; d <= days; d++) {
      const age = stats.age + d;
      if (age > stats.targetAge) break;
      const standardDaily = dailyFeedStandard(age, standards) * birds;
      projected += actualDailyKg !== null ? actualDailyKg : standardDaily;
    }
    return {batch, birds, projected, actualDailyKg, stats};
  }

  function renderFeedBudget() {
    const output = $("#feedBudgetResults");
    if (!output) return;
    const days = Math.max(1, number($("#farmFeedForecastPeriod")?.value) || 30);
    const scope = $("#forecastScope")?.value || "active";
    const batches = scope === "farm" ? data.batches : [getBatch()].filter(Boolean);
    if (!batches.length) { output.innerHTML = '<p class="empty-message">No batches available.</p>'; return; }
    const rows = batches.map(b => estimateBatchFeed(b, days));
    const totalFeed = rows.reduce((s,r)=>s+r.projected,0);
    const latest = rows.map(r=>latestFeedPrice(r.batch)).filter(v=>number(v)>0);
    const price = number($("#feedPriceAssumption")?.value) || (latest.length ? latest.reduce((a,b)=>a+number(b),0)/latest.length : 0);
    const totalCost = totalFeed * price;
    output.innerHTML = `
      <div class="simulation-results-grid">
        <div class="simulation-result"><span>Estimated feed required</span><strong>${formatNumber(totalFeed)} kg</strong></div>
        <div class="simulation-result"><span>Estimated feed budget</span><strong>${money(totalCost)}</strong></div>
        <div class="simulation-result"><span>Forecast period</span><strong>${days} days</strong></div>
      </div>
      <div class="table-container"><table><thead><tr><th>Batch</th><th>Birds alive</th><th>Feed estimate</th><th>Basis</th><th>Estimated cost</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${escapeHTML(r.batch.name || "Batch")}</td><td>${formatNumber(r.birds)}</td><td>${formatNumber(r.projected)} kg</td><td>${r.actualDailyKg !== null ? "Recorded daily use" : "Editable age standard"}</td><td>${money(r.projected*price)}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="form-help">Only days up to each batch's target harvest age are counted. Where records exist, recent average daily feed is used; otherwise the age standard is used. Price uses the entered assumption or latest recorded feed price.</p>`;
  }

  $("#recalculateFeedBudgetBtn")?.addEventListener("click", renderFeedBudget);
  ["forecastScope","farmFeedForecastPeriod","feedPriceAssumption","feedStandardStarter","feedStandardGrower","feedStandardFinisher"].forEach(id => {
    $(`#${id}`)?.addEventListener("input", renderFeedBudget);
    $(`#${id}`)?.addEventListener("change", renderFeedBudget);
  });

  function renderLivePriceSimulation() {
    const output = $("#priceSimulationOutput");
    const batch = getBatch();
    if (!output || !batch) return;
    const change = number($("#priceSimulationChange")?.value);
    $("#priceChangeValue").textContent = `${change > 0 ? "+" : ""}${change}%`;
    const days = number($("#priceSimulationHorizon")?.value) || 60;
    const scope = $("#priceSimulationScope")?.value || "active";
    const batches = scope === "farm" ? data.batches : [batch];
    let baselineFeed = 0;
    let feedCost = 0;
    let currentRevenue = 0;
    let recordedCosts = 0;
    const rows = batches.map(b => {
      const estimate = estimateBatchFeed(b, days);
      const unitPrice = number($("#feedPriceAssumption")?.value) || number(latestFeedPrice(b));
      baselineFeed += estimate.projected;
      feedCost += estimate.projected * unitPrice;
      const s = estimate.stats;
      currentRevenue += s.revenue;
      recordedCosts += s.totalCosts;
      return {name:b.name || "Batch", feed:estimate.projected, price:unitPrice, cost:estimate.projected*unitPrice};
    });
    const simulatedFeedCost = feedCost * (1 + change/100);
    const delta = simulatedFeedCost - feedCost;
    const projectedCost = recordedCosts + simulatedFeedCost;
    const projectedProfit = currentRevenue - projectedCost;
    output.innerHTML = `
      <div class="simulation-results-grid">
        <div class="simulation-result"><span>Forecast feed requirement</span><strong>${formatNumber(baselineFeed)} kg</strong></div>
        <div class="simulation-result"><span>Current-price feed budget</span><strong>${money(feedCost)}</strong></div>
        <div class="simulation-result"><span>Simulated feed budget</span><strong>${money(simulatedFeedCost)}</strong></div>
        <div class="simulation-result"><span>Budget impact</span><strong class="${delta > 0 ? "negative-value" : "positive-value"}">${delta > 0 ? "+" : ""}${money(delta)}</strong></div>
        <div class="simulation-result"><span>Estimated costs incl. forecast feed</span><strong>${money(projectedCost)}</strong></div>
        <div class="simulation-result"><span>Illustrative profit / loss</span><strong>${money(projectedProfit)}</strong></div>
      </div>
      <div class="table-container"><table><thead><tr><th>Batch</th><th>Forecast feed</th><th>Current price/kg</th><th>Simulated feed cost</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${escapeHTML(r.name)}</td><td>${formatNumber(r.feed)} kg</td><td>${money(r.price)}</td><td>${money(r.cost*(1+change/100))}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="form-help">Simulation only: actual price history and transactions are unchanged. Profit estimate adds forecast feed to recorded costs and compares it with revenue already recorded; it is not a final-batch profit forecast. Enter a selling-price assumption separately in batch setup/records to improve revenue projections.</p>`;
  }

  $("#priceSimulationChange")?.addEventListener("input", renderLivePriceSimulation);
  $("#priceSimulationHorizon")?.addEventListener("change", renderLivePriceSimulation);
  $("#priceSimulationScope")?.addEventListener("change", renderLivePriceSimulation);
  $("#runPriceSimulationBtn")?.addEventListener("click", renderLivePriceSimulation);

function renderPriceSimulation() {
    renderLivePriceSimulation();
  }

  function renderPrices() {
    const batch = getBatch();

    if (!batch) return;

    const prices = [...(batch.priceChanges || [])]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const latest = [];

    prices.forEach(price => {
      const key = `${price.category}-${price.item}`;

      if (!latest.some(item => `${item.category}-${item.item}` === key)) {
        latest.push(price);
      }
    });

    $("#currentPrices").innerHTML = latest.length
      ? `
        <table>
          <thead>
            <tr><th>Category</th><th>Item</th><th>Supplier</th><th>Current price</th><th>Effective date</th></tr>
          </thead>
          <tbody>
            ${latest.map(price => `
              <tr>
                <td>${escapeHTML(price.category)}</td>
                <td>${escapeHTML(price.item)}</td>
                <td>${escapeHTML(price.supplier || "--")}</td>
                <td>${money(price.price)} ${escapeHTML(price.unit || "")}</td>
                <td>${formatDate(price.date)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>`
      : '<p class="empty-message">No price information available.</p>';

    $("#priceHistory").innerHTML = prices.length
      ? `
        <table>
          <thead>
            <tr><th>Effective date</th><th>Category</th><th>Item</th><th>Supplier</th><th>Price</th><th>Notes</th></tr>
          </thead>
          <tbody>
            ${prices.map(price => `
              <tr>
                <td>${formatDate(price.date)}</td>
                <td>${escapeHTML(price.category)}</td>
                <td>${escapeHTML(price.item)}</td>
                <td>${escapeHTML(price.supplier || "--")}</td>
                <td>${money(price.price)} ${escapeHTML(price.unit || "")}</td>
                <td>${escapeHTML(price.notes || "--")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>`
      : '<p class="empty-message">No price changes recorded yet.</p>';

    renderLivePriceSimulation();
  }

  /* =======================================================
     BATCH SETTINGS
  ======================================================= */

  function renderBatchSettings() {
    const batch = getBatch();

    if (!batch) {
      $("#batchDetails").innerHTML = '<p class="empty-message">No active batch selected. Create a batch or choose one from the list.</p>';
      $("#batchList").innerHTML = data.batches.map(item => `
        <div class="batch-list-item">
          <div class="batch-list-info">
            <strong>${escapeHTML(item.name || "Unnamed batch")}</strong>
            <small>${formatDate(item.placementDate)}</small>
          </div>
          <div class="batch-list-actions">
            <button type="button" class="btn btn-outline" data-switch-batch="${escapeHTML(item.id)}">Switch</button>
            <button type="button" class="btn btn-danger" data-delete-batch="${escapeHTML(item.id)}">Delete</button>
          </div>
        </div>
      `).join("");
      return;
    }

    const details = [
      ["Batch name", batch.name],
      ["Poultry house", batch.house],
      ["Breed", batch.breed],
      ["Supplier", batch.supplier],
      ["Birds placed", formatNumber(batch.initialBirds)],
      ["Placement date", formatDate(batch.placementDate)],
      ["Cost per chick", money(batch.chickCost)],
      ["Target age", `${batch.targetAgeDays || 28} days`],
      ["Target weight", `${batch.targetWeight || "--"} kg`],
      ["Expected selling price", money(batch.expectedPrice)],
      ["Price basis", batch.priceBasis],
      ["Notes", batch.notes]
    ];

    $("#batchDetails").innerHTML = `
      <div class="settings-detail-list">
        ${details.map(([label, value]) => `
          <div class="financial-summary-row">
            <span>${escapeHTML(label)}</span>
            <strong>${escapeHTML(value || "--")}</strong>
          </div>
        `).join("")}
      </div>
    `;

    $("#batchList").innerHTML = data.batches.map(item => `
      <div class="batch-list-item">
        <div class="batch-list-info">
          <strong>${escapeHTML(item.name || "Unnamed batch")}</strong>
          <small>${formatDate(item.placementDate)}${item.records?.length ? ` · ${item.records.length} daily records` : ""}</small>
        </div>
        <div class="batch-list-actions">
          <button type="button" class="btn btn-outline" data-switch-batch="${escapeHTML(item.id)}">
            ${item.id === activeBatchId ? "Active" : "Switch"}
          </button>
          <button type="button" class="btn btn-danger" data-delete-batch="${escapeHTML(item.id)}">Delete</button>
        </div>
      </div>
    `).join("");
  }

  async function deleteBatch(batchId) {
    const batch = data.batches.find(item => item.id === batchId);
    if (!batch) return;

    const recordCount = Array.isArray(batch.records) ? batch.records.length : 0;
    const confirmed = window.confirm(
      `Delete batch "${batch.name || "Unnamed batch"}"?\n\nThis permanently deletes the batch and its ${recordCount} daily record(s). Feed allocations and consumption linked to this batch will also be removed. This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await window.FratelCloud.deleteLivestockBatch(batch, "broiler");
    } catch (error) {
      notify("Could not delete the batch from the cloud: " + (error.message || "Please try again."));
      return;
    }

    data.batches = data.batches.filter(item => item.id !== batchId);

    // Remove only feed transactions linked to this batch; retain shared stock,
    // purchases, ingredients, formulas and other batches.
    try {
      const feedKey = "agripredict_broiler_feed_v1";
      const feedState = JSON.parse(localStorage.getItem(feedKey) || "null");
      if (feedState && typeof feedState === "object") {
        ["allocations", "consumption", "batches"].forEach(key => {
          if (Array.isArray(feedState[key])) {
            feedState[key] = feedState[key].filter(item =>
              item.batchId !== batchId && item.id !== batchId
            );
          }
        });
        if (feedState.selectedBatch === batchId) feedState.selectedBatch = "";
        localStorage.setItem(feedKey, JSON.stringify(feedState));
      }
    } catch (error) {
      console.error("Could not clean linked feed batch records:", error);
    }

    if (activeBatchId === batchId) {
      activeBatchId = data.batches[0]?.id || "";
    }

    saveData();
    populateBatchSelect();
    if (data.batches.length) {
      renderDashboard();
      renderBatchSettings();
    } else {
      activeBatchId = "";
      saveData();
      $("#workspaceView").hidden = true;
      $("#setupView").hidden = false;
      $("#batchDetails").innerHTML = '<p class="empty-message">No batches yet. Create a new batch to get started.</p>';
      $("#batchList").innerHTML = '<p class="empty-message">No batches to display.</p>';
    }
    window.dispatchEvent(new CustomEvent("agripredict:broiler-data-updated"));
    notify("Batch deleted.");
  }

  $("#batchList").addEventListener("click", event => {
    const deleteButton = event.target.closest("[data-delete-batch]");
    if (deleteButton) {
      deleteBatch(deleteButton.dataset.deleteBatch);
      return;
    }

    const button = event.target.closest("[data-switch-batch]");
    if (!button) return;

    activeBatchId = button.dataset.switchBatch;
    saveData();
    populateBatchSelect();
    renderDashboard();
    renderBatchSettings();
    notify("Batch switched.");
  });

  /* =======================================================
     REPORTS AND EXPORTS
  ======================================================= */

  function reportRows(reportType) {
    const batch = getBatch();

    if (!batch) return [];

    const stats = calculate(batch);

    if (reportType === "summary") {
      return [
        ["Batch", batch.name],
        ["House", batch.house],
        ["Breed", batch.breed],
        ["Placement date", batch.placementDate],
        ["Birds placed", batch.initialBirds],
        ["Birds alive", stats.alive],
        ["Mortality", stats.mortality],
        ["Birds sold", stats.sold],
        ["Age in days", stats.age],
        ["Feed consumed (kg)", stats.feedConsumed],
        ["Total expenditure (UGX)", stats.totalCosts],
        ["Revenue (UGX)", stats.revenue],
        ["Profit/loss (UGX)", stats.profit]
      ];
    }

    if (reportType === "growth") {
      return [
        ["Date", "Sample size", "Average weight (kg)"],
        ...stats.weights.map(record => [
          record.date,
          record.sampleSize,
          record.averageWeight
        ])
      ];
    }

    if (reportType === "financials") {
      const rows=[];
      if(stats.chickCost>0) rows.push([batch.placementDate,"Chick purchase",`${batch.initialBirds} chicks`,stats.chickCost]);
      stats.records.forEach(record=>{
        if(record.type==="expense") rows.push([record.date,"Expense",record.description||record.category||"Farm expense",record.amount]);
        if(record.type==="feed") rows.push([record.date,"Feed",`${record.quantity} kg · ${record.feedType||"Feed intake"}`,number(record.totalCost)||number(record.quantity)*number(record.unitPrice)]);
        if(record.type==="health"&&number(record.cost)>0) rows.push([record.date,"Health",record.description||record.eventType||"Health event",record.cost]);
        if(record.type==="sale") rows.push([record.date,"Sale",record.description||record.category||record.customer||"Bird sale",record.amount]);
      });
      return [["Date","Type","Description","Amount (UGX)"],...rows.sort((a,b)=>String(b[0]||"").localeCompare(String(a[0]||"")))];
    }

    return [
      ["Date", "Activity", "Details"],
      ...stats.records.map(record => [
        record.date,
        recordTitle(record),
        recordSummary(record)
      ])
    ];
  }

  function downloadCSV(rows, filename) {
    const csv = rows.map(row =>
      row.map(value =>
        `"${String(value ?? "").replace(/"/g, '""')}"`
      ).join(",")
    ).join("\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  $$("[data-report]").forEach(button => {
    button.addEventListener("click", () => {
      const type = button.dataset.report;
      const batch = getBatch();

      if (!batch) return notify("Select a batch first.");

      downloadCSV(
        reportRows(type),
        `${batch.name.replace(/[^a-z0-9]/gi, "_")}_${type}.csv`
      );

      notify("Report generated.");
    });
  });

  $("#exportCsvBtn")?.addEventListener("click", () => {
    const batch = getBatch();

    if (!batch) return notify("Select a batch first.");

    downloadCSV(
      reportRows("activities"),
      `${batch.name.replace(/[^a-z0-9]/gi, "_")}_activities.csv`
    );

    notify("CSV exported.");
  });

  $("#printReportBtn")?.addEventListener("click", () => {
    const batch = getBatch();

    if (!batch) return notify("Select a batch first.");

    const rows = reportRows("summary");

    const reportWindow = window.open("", "_blank");

    if (!reportWindow) {
      notify("Allow pop-ups to print the report.");
      return;
    }

    reportWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>AgriPredict Batch Report</title>
        <style>
          body{font-family:Arial,sans-serif;padding:35px;color:#26352c}
          h1{color:#176b43}
          table{width:100%;border-collapse:collapse;margin-top:25px}
          td{padding:12px;border-bottom:1px solid #ddd}
          td:first-child{font-weight:bold;width:40%}
        </style>
      </head>
      <body>
        <h1>AgriPredict</h1>
        <h2>Broiler batch report</h2>
        <p>Generated: ${formatDate(today())}</p>
        <table>
          ${rows.map(row => `
            <tr>
              <td>${escapeHTML(row[0])}</td>
              <td>${escapeHTML(row[1])}</td>
            </tr>
          `).join("")}
        </table>
        <script>window.onload=()=>window.print();<\/script>
      </body>
      </html>
    `);

    reportWindow.document.close();
  });

  /* =======================================================
     HEADER ACTIONS
  ======================================================= */

  $("#notificationBtn")?.addEventListener("click", () => {
    const batch = getBatch();

    if (!batch) return notify("No active batch selected.");

    const stats = calculate(batch);

    notify(
      `${batch.name}: ${stats.alive} birds alive, ${stats.remainingDays} days to target harvest.`
    );
  });

  $("#profileBtn")?.addEventListener("click", () => {
    const batch=getBatch();
    const details=batch?`${batch.name} · ${formatNumber(calculate(batch).alive)} birds currently alive`:"No active batch selected";
    notify(`${details}. AgriPredict is using local browser storage; cloud account sign-in is not configured in this standalone version.`);
  });

  window.addEventListener("agripredict:broiler-data-updated", () => {
    data = readData();
    data.batches = data.batches.map(normaliseBatch);
    const storedActive = localStorage.getItem(ACTIVE_KEY) || "";
    if (data.batches.some(batch => batch.id === storedActive)) activeBatchId = storedActive;
    else if (!data.batches.some(batch => batch.id === activeBatchId)) activeBatchId = data.batches[0]?.id || "";
    renderDashboard();
    renderCurrentPage();
    if (window.FratelCloud && data.batches.length) saveData();
  });

  /* =======================================================
     INITIALISE
  ======================================================= */

  async function initialise() {
    $("#setupView").hidden = false;
    $("#workspaceView").hidden = true;

    const dateInput = $("#placementDate");
    if (dateInput && !dateInput.value) dateInput.value = today();

    try {
      if (!window.FratelCloud) throw new Error("Cloud data service is missing from this page.");
      await window.FratelCloud.ready();

      // Import any existing browser-only batches once, preserving their IDs
      // and full daily records inside the existing livestock_batches metadata.
      for (const localBatch of data.batches) {
        await window.FratelCloud.saveLivestockBatch(localBatch, "broiler");
      }

      const cloudBatches = await window.FratelCloud.loadLivestockBatches("broiler");
      data.batches = cloudBatches.map(normaliseBatch);

      const preferred = localStorage.getItem(ACTIVE_KEY) || activeBatchId;
      if (data.batches.some(batch => batch.id === preferred)) activeBatchId = preferred;
      else activeBatchId = data.batches[0]?.id || "";

      if (!data.batches.length) {
        activeBatchId = "";
        return;
      }

      await saveData();
      openWorkspace();
    } catch (error) {
      console.error("Could not initialise broiler cloud records:", error);
      $("#setupError").textContent = "Could not load your online farm records. " +
        (error.message || "Please sign in and check your internet connection.");
      $("#setupView").hidden = false;
      $("#workspaceView").hidden = true;
    }
  }

  initialise();

})();
