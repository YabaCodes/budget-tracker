(() => {
  const DEFAULT_BUDGETS = {
    "Rent": 23000,
    "Sister's rent": 7600,
    "Tithe": 8200,
    "Family support": 3500,
    "Utilities": 1750,
    "SIM": 799,
    "Home Wi‑Fi": 899,
    "Apple One": 390,
    "iCloud+": 300,
    "Gym": 1088,
    "Transportation": 1000,
    "Food & groceries": 8000,
    "Dating": 3000,
    "Miscellaneous": 1000
  };

  const STORAGE = {
    legacyBudgets: "budgetTracker.budgets.v1",
    expenses: "budgetTracker.expenses.v1",
    cash: "budgetTracker.cash.v1",
    templateBudgets: "budgetTracker.templateBudgets.v3",
    monthBudgets: "budgetTracker.monthBudgets.v3"
  };

  const $ = id => document.getElementById(id);
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const money = n => "NT$" + Math.round(Number(n) || 0).toLocaleString("en-US");

  const todayISO = () => {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0,10);
  };

  const currentMonthKey = () => todayISO().slice(0,7);
  const monthKey = dateStr => String(dateStr || "").slice(0,7);

  function monthLabel(mk){
    const [y,m] = mk.split("-").map(Number);
    if (!y || !m) return mk;
    return new Intl.DateTimeFormat("en-US", {month:"short", year:"numeric"}).format(new Date(y, m-1, 1));
  }

  function loadJSON(key, fallback){
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : clone(fallback);
    } catch {
      return clone(fallback);
    }
  }

  const legacyBudgets = loadJSON(STORAGE.legacyBudgets, DEFAULT_BUDGETS);
  let templateBudgets = loadJSON(STORAGE.templateBudgets, legacyBudgets);
  let monthBudgets = loadJSON(STORAGE.monthBudgets, {});
  let expenses = loadJSON(STORAGE.expenses, []);
  let cashReserve = Number(localStorage.getItem(STORAGE.cash) || 76000);
  let selectedMonth = currentMonthKey();

  function ensureMonthBudget(mk){
    if (!monthBudgets[mk]) {
      monthBudgets[mk] = clone(templateBudgets);
      persistBudgets();
    }
    return monthBudgets[mk];
  }

  function persistBudgets(){
    localStorage.setItem(STORAGE.templateBudgets, JSON.stringify(templateBudgets));
    localStorage.setItem(STORAGE.monthBudgets, JSON.stringify(monthBudgets));
    // Keep legacy key updated for backward compatibility.
    localStorage.setItem(STORAGE.legacyBudgets, JSON.stringify(templateBudgets));
  }

  function persistAll(){
    persistBudgets();
    localStorage.setItem(STORAGE.expenses, JSON.stringify(expenses));
    localStorage.setItem(STORAGE.cash, String(cashReserve));
  }

  function expensesForMonth(mk){
    return expenses.filter(e => monthKey(e.date) === mk);
  }

  function totalBudgetForMonth(mk){
    return Object.values(ensureMonthBudget(mk)).reduce((s,v) => s + (Number(v)||0), 0);
  }

  function totalSpentForMonth(mk){
    return expensesForMonth(mk).reduce((s,e) => s + (Number(e.amount)||0), 0);
  }

  function spentByCategory(mk){
    const budgets = ensureMonthBudget(mk);
    const out = {};
    for (const key of Object.keys(budgets)) out[key] = 0;
    for (const e of expensesForMonth(mk)) {
      if (!(e.category in out)) out[e.category] = 0;
      out[e.category] += Number(e.amount) || 0;
    }
    return out;
  }

  function availableMonths(){
    const set = new Set([currentMonthKey(), selectedMonth, ...Object.keys(monthBudgets)]);
    expenses.forEach(e => {
      const mk = monthKey(e.date);
      if (mk) set.add(mk);
    });
    return [...set].filter(Boolean).sort().reverse();
  }

  function monthsForTrend(){
    const keys = availableMonths().sort();
    if (!keys.length) return [currentMonthKey()];
    const earliest = keys[0];
    const latest = currentMonthKey() > keys[keys.length-1] ? currentMonthKey() : keys[keys.length-1];
    const [ey,em] = earliest.split("-").map(Number);
    const [ly,lm] = latest.split("-").map(Number);
    const result = [];
    let y = ey, m = em;
    while (y < ly || (y === ly && m <= lm)) {
      result.push(`${y}-${String(m).padStart(2,"0")}`);
      m++;
      if (m === 13) { m = 1; y++; }
      if (result.length > 60) break;
    }
    return result;
  }

  function renderMonthSelect(){
    const sel = $("monthSelect");
    const months = availableMonths();
    sel.innerHTML = "";
    months.forEach(mk => {
      const opt = document.createElement("option");
      opt.value = mk;
      opt.textContent = monthLabel(mk);
      sel.appendChild(opt);
    });
    if (!months.includes(selectedMonth)) selectedMonth = currentMonthKey();
    sel.value = selectedMonth;
  }

  function renderSummary(){
    const spent = totalSpentForMonth(selectedMonth);
    const totalBudget = totalBudgetForMonth(selectedMonth);
    $("monthlyBudget").textContent = money(totalBudget);
    $("monthlySpent").textContent = money(spent);
    $("monthlyRemaining").textContent = money(Math.max(0, totalBudget - spent));
    $("cashReserve").textContent = money(cashReserve);

    const pct = Math.max(0, Math.min(100, cashReserve / 300000 * 100));
    $("goalPercent").textContent = pct.toFixed(1) + "%";
    $("goalBar").style.width = pct + "%";
    $("cashInput").value = Math.round(cashReserve);

    $("budgetMonthLabel").textContent = monthLabel(selectedMonth);
    $("historyTitle").textContent = `${monthLabel(selectedMonth)} expenses`;
    $("budgetEditorTitle").textContent = `Edit ${monthLabel(selectedMonth)} budgets`;
  }

  function renderCategorySelect(){
    const budgets = ensureMonthBudget(currentMonthKey());
    const sel = $("category");
    const previous = sel.value;
    sel.innerHTML = "";
    for (const name of Object.keys(budgets)) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
    if (previous && budgets[previous] !== undefined) sel.value = previous;
  }

  function renderCategories(){
    const budgets = ensureMonthBudget(selectedMonth);
    const spent = spentByCategory(selectedMonth);
    const wrap = $("categoryList");
    wrap.innerHTML = "";

    for (const [name,budget] of Object.entries(budgets)) {
      const used = spent[name] || 0;
      const remaining = Math.max(0, budget - used);
      const pct = budget > 0 ? Math.min(100, used / budget * 100) : (used > 0 ? 100 : 0);
      const statusClass = used > budget ? "over" : pct >= 80 ? "warn" : "";

      const row = document.createElement("div");
      row.className = "category-row";
      row.innerHTML = `
        <div class="category-top">
          <div>
            <div class="category-name">${escapeHtml(name)}</div>
            <div class="category-meta">${money(used)} spent · ${money(remaining)} remaining</div>
          </div>
          <strong>${money(budget)}</strong>
        </div>
        <div class="bar"><div class="${statusClass}" style="width:${pct}%"></div></div>
      `;
      wrap.appendChild(row);
    }
  }

  function renderExpenses(){
    const wrap = $("expenseList");
    const rows = [...expensesForMonth(selectedMonth)].sort((a,b) => {
      if (a.date === b.date) return (b.createdAt||0) - (a.createdAt||0);
      return b.date.localeCompare(a.date);
    });
    wrap.innerHTML = "";

    if (!rows.length) {
      wrap.innerHTML = `<div class="empty">No expenses recorded for ${escapeHtml(monthLabel(selectedMonth))}.</div>`;
      return;
    }

    for (const e of rows) {
      const row = document.createElement("div");
      row.className = "expense-row";

      const top = document.createElement("div");
      top.className = "expense-top";

      const left = document.createElement("div");
      left.innerHTML = `
        <div class="expense-name">${escapeHtml(e.category)}</div>
        <div class="expense-meta">${escapeHtml(e.date)}${e.note ? " · " + escapeHtml(e.note) : ""}</div>
      `;

      const right = document.createElement("div");
      right.className = "expense-actions";

      const amount = document.createElement("strong");
      amount.textContent = money(e.amount);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "delete-expense";
      deleteBtn.textContent = "Delete";
      deleteBtn.setAttribute("aria-label", `Delete ${e.category} expense of ${money(e.amount)}`);
      deleteBtn.addEventListener("click", () => {
        if (!confirm(`Delete this ${e.category} expense of ${money(e.amount)}?`)) return;
        expenses = expenses.filter(item => item.id !== e.id);
        persistAll();
        renderAll();
      });

      right.appendChild(amount);
      right.appendChild(deleteBtn);
      top.appendChild(left);
      top.appendChild(right);
      row.appendChild(top);
      wrap.appendChild(row);
    }
  }

  function renderBudgetEditor(){
    const budgets = ensureMonthBudget(selectedMonth);
    const wrap = $("budgetFields");
    wrap.innerHTML = "";
    for (const [name,value] of Object.entries(budgets)) {
      const label = document.createElement("label");
      label.textContent = name;
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "1";
      input.value = Math.round(value);
      input.dataset.category = name;
      input.inputMode = "numeric";
      label.appendChild(input);
      wrap.appendChild(label);
    }
  }

  function renderTrend(){
    const months = monthsForTrend();
    const chart = $("trendChart");
    const table = $("trendTable");
    chart.innerHTML = "";
    table.innerHTML = "";

    const data = months.map(mk => ({
      mk,
      spent: totalSpentForMonth(mk),
      budget: totalBudgetForMonth(mk)
    }));
    const maxValue = Math.max(1, ...data.map(d => Math.max(d.spent, d.budget)));

    data.slice(-12).forEach(d => {
      const col = document.createElement("div");
      col.className = "trend-col";
      const height = Math.max(2, Math.round((d.spent / maxValue) * 100));
      col.innerHTML = `
        <div class="trend-value">${money(d.spent)}</div>
        <div class="trend-track" title="${escapeHtml(monthLabel(d.mk))}: ${money(d.spent)} spent">
          <div class="trend-fill" style="height:${height}%"></div>
        </div>
        <div class="trend-label">${escapeHtml(monthLabel(d.mk).replace(" "," '"))}</div>
      `;
      chart.appendChild(col);
    });

    const header = document.createElement("div");
    header.className = "trend-row header";
    header.innerHTML = `<div>Month</div><div class="right">Budget</div><div class="right">Spent</div><div class="right">Variance</div>`;
    table.appendChild(header);

    [...data].reverse().forEach(d => {
      const variance = d.budget - d.spent;
      const row = document.createElement("div");
      row.className = "trend-row";
      row.innerHTML = `
        <div>${escapeHtml(monthLabel(d.mk))}</div>
        <div class="right">${money(d.budget)}</div>
        <div class="right">${money(d.spent)}</div>
        <div class="right ${variance >= 0 ? "good" : "bad"}">${variance >= 0 ? "+" : "−"}${money(Math.abs(variance)).replace("NT$","NT$")}</div>
      `;
      table.appendChild(row);
    });
  }

  function renderAll(){
    ensureMonthBudget(selectedMonth);
    renderMonthSelect();
    renderSummary();
    renderCategorySelect();
    renderCategories();
    renderExpenses();
    renderBudgetEditor();
    renderTrend();
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  function downloadText(filename, text, type){
    const blob = new Blob([text], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvEscape(value){
    const s = String(value ?? "");
    return `"${s.replace(/"/g,'""')}"`;
  }

  $("date").value = todayISO();

  $("monthSelect").addEventListener("change", () => {
    selectedMonth = $("monthSelect").value;
    $("budgetEditor").hidden = true;
    renderAll();
  });

  $("expenseForm").addEventListener("submit", ev => {
    ev.preventDefault();

    const amount = Number($("amount").value);
    const category = $("category").value;
    const date = $("date").value;
    const note = $("note").value.trim();

    if (!Number.isFinite(amount) || amount <= 0 || !category || !date) {
      $("formMessage").textContent = "Please enter a valid amount, category, and date.";
      return;
    }

    const expenseMonth = monthKey(date);
    ensureMonthBudget(expenseMonth);

    expenses.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      amount: Math.round(amount),
      category,
      date,
      note,
      createdAt: Date.now()
    });

    selectedMonth = expenseMonth;
    persistAll();
    $("expenseForm").reset();
    $("date").value = todayISO();
    $("formMessage").textContent = `${money(amount)} added to ${category}.`;
    renderAll();
  });

  $("saveCashBtn").addEventListener("click", () => {
    const value = Number($("cashInput").value);
    if (!Number.isFinite(value) || value < 0) return;
    cashReserve = Math.round(value);
    persistAll();
    renderSummary();
  });

  $("editBudgetsBtn").addEventListener("click", () => {
    $("budgetEditor").hidden = false;
    renderBudgetEditor();
  });

  $("closeBudgetsBtn").addEventListener("click", () => {
    $("budgetEditor").hidden = true;
  });

  $("saveBudgetsBtn").addEventListener("click", () => {
    const updated = clone(ensureMonthBudget(selectedMonth));
    const inputs = $("budgetFields").querySelectorAll("input[data-category]");

    inputs.forEach(input => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= 0) updated[input.dataset.category] = Math.round(v);
    });

    monthBudgets[selectedMonth] = updated;
    if ($("futureDefaultCheck").checked) templateBudgets = clone(updated);

    persistAll();
    $("budgetEditor").hidden = true;
    renderAll();
  });

  $("clearSelectedMonthBtn").addEventListener("click", () => {
    const label = monthLabel(selectedMonth);
    if (!confirm(`Delete ALL expenses recorded for ${label}? This cannot be undone.`)) return;
    expenses = expenses.filter(e => monthKey(e.date) !== selectedMonth);
    persistAll();
    renderAll();
  });

  $("exportBackupBtn").addEventListener("click", () => {
    const backup = {
      version: 3,
      exportedAt: new Date().toISOString(),
      cashReserve,
      templateBudgets,
      monthBudgets,
      expenses
    };
    downloadText(`budget-tracker-backup-${todayISO()}.json`, JSON.stringify(backup, null, 2), "application/json");
    $("backupMessage").textContent = "Backup exported.";
  });

  $("exportCsvBtn").addEventListener("click", () => {
    const header = ["Date","Category","Amount_NTD","Note"];
    const rows = [...expenses]
      .sort((a,b) => a.date.localeCompare(b.date))
      .map(e => [e.date, e.category, e.amount, e.note || ""]);
    const csv = [header, ...rows].map(row => row.map(csvEscape).join(",")).join("\n");
    downloadText(`budget-expenses-${todayISO()}.csv`, csv, "text/csv;charset=utf-8");
    $("backupMessage").textContent = "CSV exported.";
  });

  $("importBackupInput").addEventListener("change", async ev => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data || !Array.isArray(data.expenses) || typeof data.cashReserve === "undefined") {
        throw new Error("Invalid backup format");
      }

      if (!confirm("Import this backup and replace the data currently stored on this device?")) {
        ev.target.value = "";
        return;
      }

      expenses = data.expenses;
      cashReserve = Number(data.cashReserve) || 0;
      templateBudgets = data.templateBudgets && typeof data.templateBudgets === "object"
        ? data.templateBudgets
        : clone(DEFAULT_BUDGETS);
      monthBudgets = data.monthBudgets && typeof data.monthBudgets === "object"
        ? data.monthBudgets
        : {};

      selectedMonth = currentMonthKey();
      persistAll();
      renderAll();
      $("backupMessage").textContent = "Backup imported successfully.";
    } catch {
      $("backupMessage").textContent = "That file could not be imported. Please use a Budget Tracker backup JSON file.";
    } finally {
      ev.target.value = "";
    }
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  ensureMonthBudget(currentMonthKey());
  persistAll();
  renderAll();
})();
