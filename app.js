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
    budgets: "budgetTracker.budgets.v1",
    expenses: "budgetTracker.expenses.v1",
    cash: "budgetTracker.cash.v1"
  };

  const money = n => "NT$" + Math.round(Number(n) || 0).toLocaleString("en-US");
  const todayISO = () => {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset()*60000);
    return local.toISOString().slice(0,10);
  };
  const monthKey = (dateStr = todayISO()) => dateStr.slice(0,7);

  let budgets = loadJSON(STORAGE.budgets, DEFAULT_BUDGETS);
  let expenses = loadJSON(STORAGE.expenses, []);
  let cashReserve = Number(localStorage.getItem(STORAGE.cash) || 76000);

  const $ = id => document.getElementById(id);

  function loadJSON(key, fallback){
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : structuredClone(fallback);
    } catch {
      return structuredClone(fallback);
    }
  }

  function persist(){
    localStorage.setItem(STORAGE.budgets, JSON.stringify(budgets));
    localStorage.setItem(STORAGE.expenses, JSON.stringify(expenses));
    localStorage.setItem(STORAGE.cash, String(cashReserve));
  }

  function currentMonthExpenses(){
    const mk = monthKey();
    return expenses.filter(e => monthKey(e.date) === mk);
  }

  function spentByCategory(){
    const out = {};
    for (const key of Object.keys(budgets)) out[key] = 0;
    for (const e of currentMonthExpenses()) {
      if (!(e.category in out)) out[e.category] = 0;
      out[e.category] += Number(e.amount) || 0;
    }
    return out;
  }

  function renderSummary(){
    const spent = currentMonthExpenses().reduce((s,e) => s + (Number(e.amount)||0), 0);
    const totalBudget = Object.values(budgets).reduce((s,v) => s + (Number(v)||0), 0);
    $("monthlyBudget").textContent = money(totalBudget);
    $("monthlySpent").textContent = money(spent);
    $("monthlyRemaining").textContent = money(Math.max(0, totalBudget - spent));
    $("cashReserve").textContent = money(cashReserve);

    const pct = Math.max(0, Math.min(100, cashReserve / 300000 * 100));
    $("goalPercent").textContent = pct.toFixed(1) + "%";
    $("goalBar").style.width = pct + "%";
    $("cashInput").value = Math.round(cashReserve);
  }

  function renderCategorySelect(){
    const sel = $("category");
    sel.innerHTML = "";
    for (const name of Object.keys(budgets)) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
  }

  function renderCategories(){
    const spent = spentByCategory();
    const wrap = $("categoryList");
    wrap.innerHTML = "";
    for (const [name,budget] of Object.entries(budgets)) {
      const used = spent[name] || 0;
      const remaining = Math.max(0, budget - used);
      const pct = budget > 0 ? Math.min(100, used / budget * 100) : 100;
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
    const rows = [...currentMonthExpenses()].sort((a,b) => {
      if (a.date === b.date) return b.createdAt - a.createdAt;
      return b.date.localeCompare(a.date);
    });
    wrap.innerHTML = "";
    if (!rows.length) {
      wrap.innerHTML = `<div class="empty">No expenses entered yet this month.</div>`;
      return;
    }
    for (const e of rows.slice(0,50)) {
      const row = document.createElement("div");
      row.className = "expense-row";
      row.innerHTML = `
        <div class="expense-top">
          <div>
            <div class="expense-name">${escapeHtml(e.category)}</div>
            <div class="expense-meta">${escapeHtml(e.date)}${e.note ? " · " + escapeHtml(e.note) : ""}</div>
          </div>
          <strong>${money(e.amount)}</strong>
        </div>
      `;
      wrap.appendChild(row);
    }
  }

  function renderBudgetEditor(){
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

  function renderAll(){
    renderSummary();
    renderCategorySelect();
    renderCategories();
    renderExpenses();
    renderBudgetEditor();
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  $("date").value = todayISO();

  $("expenseForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const amount = Number($("amount").value);
    const category = $("category").value;
    const date = $("date").value;
    const note = $("note").value.trim();

    if (!Number.isFinite(amount) || amount <= 0 || !category || !date) {
      $("formMessage").textContent = "Please enter a valid amount, category, and date.";
      return;
    }

    expenses.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      amount: Math.round(amount),
      category,
      date,
      note,
      createdAt: Date.now()
    });
    persist();
    $("expenseForm").reset();
    $("date").value = todayISO();
    $("formMessage").textContent = `${money(amount)} added to ${category}.`;
    renderAll();
  });

  $("saveCashBtn").addEventListener("click", () => {
    const value = Number($("cashInput").value);
    if (!Number.isFinite(value) || value < 0) return;
    cashReserve = Math.round(value);
    persist();
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
    const inputs = $("budgetFields").querySelectorAll("input[data-category]");
    inputs.forEach(input => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= 0) budgets[input.dataset.category] = Math.round(v);
    });
    persist();
    $("budgetEditor").hidden = true;
    renderAll();
  });

  $("clearExpensesBtn").addEventListener("click", () => {
    if (!confirm("Clear all recorded expenses? This cannot be undone.")) return;
    expenses = [];
    persist();
    renderAll();
  });

  $("resetMonthBtn").addEventListener("click", () => {
    const mk = monthKey();
    if (!confirm("Clear expenses for the current month only?")) return;
    expenses = expenses.filter(e => monthKey(e.date) !== mk);
    persist();
    renderAll();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  renderAll();
})();
