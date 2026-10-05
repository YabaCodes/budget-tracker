(() => {
  "use strict";

  // Budget Tracker v9 — simple personal budget: Cash + Bank Account, income, expenses,
  // and Fixed / Flexible monthly items. Balances are always calculated from the entries,
  // so editing or deleting an entry corrects them automatically.

  const APP_VERSION = "9.0.0"; // bump together with CACHE in sw.js
  const KEY = "budgetTracker.v9";
  const LEGACY = {
    templateBudgets: "budgetTracker.templateBudgets.v3",
    monthBudgets: "budgetTracker.monthBudgets.v3",
    legacyBudgets: "budgetTracker.budgets.v1",
    expenses: "budgetTracker.expenses.v1",
    reserve: "budgetTracker.reserve.v7",
    cash: "budgetTracker.cash.v1",
    specialBudgets: "budgetTracker.specialBudgets.v7",
    settings: "budgetTracker.settings.v7",
  };
  // The categories and amounts the previous version started with. Untouched copies are not carried over.
  const OLD_DEFAULTS = {
    Rent: 23000, "Sister's rent": 7600, Tithe: 8200, "Family support": 3500, Utilities: 1750, SIM: 799,
    "Home Wi‑Fi": 899, "Apple One": 390, "iCloud+": 300, Gym: 1088, Transportation: 1000,
    "Food & groceries": 8000, Dating: 3000, Miscellaneous: 1000,
  };
  const SUGGESTIONS = { fixed: ["Business Payment", "Phone", "Transport"], flexible: ["Food", "Household"] };
  const INCOME_TYPES = [
    ["salary", "Salary"],
    ["stipend", "Stipend"],
    ["gift", "Gift"],
    ["reimbursement", "Reimbursement"],
    ["other", "Other"],
  ];
  const CURRENCIES = [
    ["TWD", "NT$", 0], ["ETB", "Br", 2], ["USD", "$", 2], ["EUR", "€", 2], ["GBP", "£", 2], ["JPY", "¥", 0],
    ["CNY", "CN¥", 2], ["HKD", "HK$", 2], ["SGD", "S$", 2], ["KRW", "₩", 0], ["AUD", "A$", 2], ["CAD", "C$", 2],
    ["AED", "AED ", 2], ["SAR", "SAR ", 2], ["THB", "฿", 2], ["INR", "₹", 2], ["CHF", "CHF ", 2],
  ];
  const OTHERS_ID = "others";

  const $ = (id) => document.getElementById(id);
  const view = $("view");
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const round2 = (v) => Math.round(num(v) * 100) / 100;

  // ---------- dates ----------
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const monthOf = (iso) => String(iso || "").slice(0, 7);
  const thisMonth = () => monthOf(todayISO());
  function addMonths(mk, n) {
    const [y, m] = mk.split("-").map(Number),
      d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  function monthLabel(mk, short = false) {
    const [y, m] = mk.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", short ? { month: "short" } : { month: "long", year: "numeric" }).format(
      new Date(y, m - 1, 1),
    );
  }
  function dayLabel(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return iso || "";
    const [y, m, d] = iso.split("-").map(Number);
    const opts = { month: "short", day: "numeric", ...(y !== new Date().getFullYear() ? { year: "numeric" } : {}) };
    return new Intl.DateTimeFormat("en-US", opts).format(new Date(y, m - 1, d));
  }
  const daysInMonth = (mk) => {
    const [y, m] = mk.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  };

  // ---------- money ----------
  const currencyInfo = () => CURRENCIES.find((c) => c[0] === state.currency) || CURRENCIES[0];
  function money(v, { sign = false } = {}) {
    const [, sym, dp] = currencyInfo();
    const r = dp ? round2(v) : Math.round(num(v));
    const text = `${sym}${new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp }).format(Math.abs(r))}`;
    if (r < 0) return `−${text}`;
    return sign && r > 0 ? `+${text}` : text;
  }
  const hidden = () => state.meta.privacy;
  const privateMoney = (v) => (hidden() ? `${currencyInfo()[1]}••••` : money(v));

  // ---------- state ----------
  function freshState() {
    return {
      version: 9,
      setupDone: false,
      currency: "TWD",
      accounts: [
        { id: "cash", name: "Cash" },
        { id: "bank", name: "Bank Account" },
      ],
      items: [{ id: OTHERS_ID, name: "Others", group: "flexible", amounts: [], archived: false, builtIn: true, createdAt: Date.now() }],
      entries: [],
      meta: { createdAt: Date.now(), updatedAt: Date.now(), lastBackupAt: null, lastAccountId: "bank", privacy: false, migratedFrom: null, welcome: false },
    };
  }
  let state = load();
  let tab = "home",
    viewMonth = thisMonth(),
    activityFilter = "all",
    saveFailed = false,
    undo = null,
    toastTimer = null;

  function normalize(s) {
    const base = freshState();
    const out = { ...base, ...s, meta: { ...base.meta, ...(s.meta || {}) } };
    out.accounts = Array.isArray(s.accounts) && s.accounts.length ? s.accounts : base.accounts;
    out.items = Array.isArray(s.items) ? s.items : base.items;
    if (!out.items.some((i) => i.id === OTHERS_ID)) out.items.push(base.items[0]);
    out.items.forEach((i) => {
      i.amounts = Array.isArray(i.amounts) ? i.amounts : [];
      i.group = i.group === "fixed" ? "fixed" : "flexible";
    });
    out.entries = Array.isArray(s.entries) ? s.entries : [];
    if (!CURRENCIES.some((c) => c[0] === out.currency)) out.currency = "TWD";
    return out;
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) {
      console.warn("Could not read saved data", e);
    }
    const legacy = readLegacy();
    if (legacy) {
      const s = fromLegacy(legacy);
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch {}
      return s;
    }
    return freshState();
  }
  function save() {
    state.meta.updatedAt = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      if (saveFailed) {
        saveFailed = false;
        renderBanner();
      }
      return true;
    } catch (e) {
      console.warn("Save failed", e);
      saveFailed = true;
      renderBanner();
      return false;
    }
  }

  // ---------- moving data from the previous version (v7/v8) ----------
  function readJSON(key) {
    try {
      const r = localStorage.getItem(key);
      return r == null ? null : JSON.parse(r);
    } catch {
      return null;
    }
  }
  function readLegacy() {
    const expenses = readJSON(LEGACY.expenses),
      template = readJSON(LEGACY.templateBudgets) || readJSON(LEGACY.legacyBudgets),
      reserve = localStorage.getItem(LEGACY.reserve) ?? localStorage.getItem(LEGACY.cash);
    if (expenses == null && template == null && reserve == null) return null;
    return {
      expenses: Array.isArray(expenses) ? expenses : [],
      templateBudgets: template && typeof template === "object" ? template : {},
      monthBudgets: readJSON(LEGACY.monthBudgets) || {},
      reserve: num(reserve),
      specialBudgets: readJSON(LEGACY.specialBudgets) || [],
      settings: readJSON(LEGACY.settings) || {},
      fromDevice: true,
    };
  }
  // Works for data on this phone and for backup files made by the previous version.
  function fromLegacy(L) {
    const s = freshState();
    const today = todayISO();
    s.setupDone = true;
    s.currency = String(L.settings?.baseCurrency || "TWD").toUpperCase();
    if (!CURRENCIES.some((c) => c[0] === s.currency)) s.currency = "TWD";
    s.meta.migratedFrom = "8";
    s.meta.welcome = true;
    const expenses = (L.expenses || []).filter((e) => num(e.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || "")));
    const used = new Set(expenses.map((e) => String(e.category || "Miscellaneous")));
    const names = new Set([...Object.keys(L.templateBudgets || {}), ...Object.values(L.monthBudgets || {}).flatMap((b) => Object.keys(b || {})), ...used]);
    const idFor = {};
    names.forEach((name) => {
      if (name === "Miscellaneous") return void (idFor[name] = OTHERS_ID);
      const tmpl = L.templateBudgets?.[name];
      const untouchedDefault = name in OLD_DEFAULTS && num(tmpl) === OLD_DEFAULTS[name] && !used.has(name);
      if (untouchedDefault) return;
      const item = { id: uid("item"), name, group: "flexible", amounts: [], archived: false, createdAt: Date.now() };
      const months = Object.keys(L.monthBudgets || {}).sort();
      let last = null;
      months.forEach((mk) => {
        const v = L.monthBudgets[mk]?.[name];
        if (v == null || num(v) === last) return;
        item.amounts.push({ from: mk, amount: num(v) });
        last = num(v);
      });
      if (tmpl != null && num(tmpl) !== last) item.amounts.push({ from: thisMonth(), amount: num(tmpl) });
      item.amounts.sort((a, b) => a.from.localeCompare(b.from));
      s.items.push(item);
      idFor[name] = item.id;
    });
    const others = s.items.find((i) => i.id === OTHERS_ID);
    const misc = L.templateBudgets?.Miscellaneous;
    if (misc != null && !(num(misc) === OLD_DEFAULTS.Miscellaneous && !used.has("Miscellaneous"))) others.amounts.push({ from: thisMonth(), amount: num(misc) });
    // Past expenses keep their month and category, but they were never taken out of the reserve,
    // so they don't change balances (no account).
    expenses.forEach((e) =>
      s.entries.push({
        id: String(e.id || uid("exp")),
        type: "expense",
        amount: round2(e.amount),
        date: e.date,
        itemId: idFor[String(e.category || "Miscellaneous")] || OTHERS_ID,
        accountId: null,
        note: String(e.note || ""),
        createdAt: num(e.createdAt) || Date.now(),
        legacy: true,
      }),
    );
    // The reserve the previous version showed becomes today's Bank Account balance. Money set aside for a
    // Special Budget that is still running left the reserve, so whatever wasn't spent yet is added back.
    const specials = Array.isArray(L.specialBudgets) ? L.specialBudgets : [];
    const setAside = specials
      .filter((sp) => sp && sp.status === "active")
      .reduce((sum, sp) => sum + Math.max(0, num(sp.allocatedBase) - (sp.expenses || []).reduce((t, x) => t + num(x.amountBase), 0)), 0);
    s.entries.push({ id: uid("open"), type: "opening", amount: round2(Math.max(0, L.reserve) + setAside), date: today, accountId: "bank", note: "Starting balance (from the previous version)", createdAt: Date.now() });
    s.entries.push({ id: uid("open"), type: "opening", amount: 0, date: today, accountId: "cash", note: "Starting balance", createdAt: Date.now() });
    s.meta.legacySpecialCount = specials.length;
    return s;
  }

  // ---------- calculations ----------
  // Items in the order they were added, with the catch-all Others always last.
  const orderedItems = () => [...state.items].sort((x, y) => (x.id === OTHERS_ID) - (y.id === OTHERS_ID));
  const activeItems = (group) => orderedItems().filter((i) => i.group === group && !i.archived);
  const itemById = (id) => state.items.find((i) => i.id === id);
  const accountById = (id) => state.accounts.find((a) => a.id === id);
  const accountName = (id) => accountById(id)?.name || "";
  // The planned amount of an item for a month: the latest amount set on or before that month.
  function itemAmount(item, mk) {
    let v = 0;
    (item.amounts || []).forEach((a) => {
      if (a.from <= mk) v = num(a.amount);
    });
    return v;
  }
  function setItemAmount(item, amount) {
    const mk = thisMonth();
    item.amounts = (item.amounts || []).filter((a) => a.from !== mk);
    const before = itemAmount(item, mk);
    if (round2(amount) !== round2(before)) item.amounts.push({ from: mk, amount: round2(amount) });
    item.amounts.sort((a, b) => a.from.localeCompare(b.from));
  }
  function balances() {
    const b = Object.fromEntries(state.accounts.map((a) => [a.id, 0]));
    state.entries.forEach((e) => {
      const amt = num(e.amount);
      if (e.type === "expense" && e.accountId in b) b[e.accountId] -= amt;
      else if ((e.type === "income" || e.type === "opening" || e.type === "correction") && e.accountId in b) b[e.accountId] += amt;
      else if (e.type === "move") {
        if (e.accountId in b) b[e.accountId] -= amt;
        if (e.toAccountId in b) b[e.toAccountId] += amt;
      }
    });
    Object.keys(b).forEach((k) => (b[k] = round2(b[k])));
    return b;
  }
  const monthEntries = (mk) => state.entries.filter((e) => monthOf(e.date) === mk && e.type !== "opening");
  function spentBy(mk) {
    const o = {};
    monthEntries(mk)
      .filter((e) => e.type === "expense")
      .forEach((e) => (o[e.itemId] = round2((o[e.itemId] || 0) + num(e.amount))));
    return o;
  }
  function monthStats(mk) {
    const es = monthEntries(mk);
    const moneyIn = round2(es.filter((e) => e.type === "income").reduce((s, e) => s + num(e.amount), 0));
    const moneyOut = round2(es.filter((e) => e.type === "expense").reduce((s, e) => s + num(e.amount), 0));
    const spent = spentBy(mk);
    const shown = (group) =>
      orderedItems().filter((i) => i.group === group && (!i.archived || spent[i.id]) && (group === "fixed" || itemAmount(i, mk) > 0 || spent[i.id] || i.id === OTHERS_ID));
    const fixed = shown("fixed").map((i) => ({ item: i, planned: itemAmount(i, mk), spent: spent[i.id] || 0 }));
    const flexible = shown("flexible").map((i) => ({ item: i, planned: itemAmount(i, mk), spent: spent[i.id] || 0 }));
    const flexLimit = round2(flexible.reduce((s, x) => s + x.planned, 0));
    const flexSpent = round2(flexible.reduce((s, x) => s + x.spent, 0));
    const fixedPlanned = round2(fixed.reduce((s, x) => s + x.planned, 0));
    const fixedPaid = round2(fixed.reduce((s, x) => s + x.spent, 0));
    return { moneyIn, moneyOut, kept: round2(moneyIn - moneyOut), fixed, flexible, flexLimit, flexSpent, fixedPlanned, fixedPaid };
  }
  const firstMonth = () => state.entries.map((e) => monthOf(e.date)).filter(Boolean).sort()[0] || thisMonth();

  // ---------- rendering ----------
  function render() {
    document.querySelectorAll(".nav-btn").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-current", on ? "page" : "false");
    });
    const titles = { home: "Money", activity: "Activity", budget: "Budget", more: "More" };
    $("pageTitle").textContent = state.setupDone ? titles[tab] : "Welcome";
    const showMonth = state.setupDone && tab !== "more";
    $("monthNav").hidden = !showMonth;
    $("monthLabel").textContent = monthLabel(viewMonth);
    $("prevMonth").disabled = viewMonth <= firstMonth();
    $("nextMonth").disabled = viewMonth >= thisMonth();
    document.querySelector(".bottom-nav").hidden = !state.setupDone;
    renderBanner();
    if (!state.setupDone) return renderSetup();
    if (tab === "home") renderHome();
    else if (tab === "activity") renderActivity();
    else if (tab === "budget") renderBudget();
    else renderMore();
  }
  function renderBanner() {
    const el = $("banner");
    el.hidden = !saveFailed;
    el.innerHTML = saveFailed
      ? `<strong>Changes aren't being saved.</strong> The phone's storage for this app is full or blocked. Export a backup from More now.`
      : "";
  }

  function balanceCard() {
    const b = balances(),
      total = round2(Object.values(b).reduce((s, v) => s + v, 0));
    return `<section class="card balance-card">
      <div class="row"><span class="label">Balance today</span><button class="icon-btn small" id="privacyBtn" type="button" aria-pressed="${hidden()}" aria-label="${hidden() ? "Show amounts" : "Hide amounts"}">${hidden() ? "Show" : "Hide"}</button></div>
      <div class="big ${total < 0 ? "neg" : ""}">${privateMoney(total)}</div>
      <div class="accounts">${state.accounts
        .map(
          (a) =>
            `<button class="account" type="button" data-fix="${a.id}" aria-label="${esc(a.name)}: ${hidden() ? "hidden" : money(b[a.id])}. Fix balance"><span>${esc(a.name)}</span><strong class="${b[a.id] < 0 ? "neg" : ""}">${privateMoney(b[a.id])}</strong><small>Fix balance</small></button>`,
        )
        .join("")}</div>
    </section>`;
  }

  function renderHome() {
    const st = monthStats(viewMonth),
      isNow = viewMonth === thisMonth();
    const leftToSpend = round2(st.flexLimit - st.flexSpent);
    const recent = monthEntries(viewMonth)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .slice(0, 5);
    const welcome = state.meta.welcome
      ? `<section class="card note"><strong>Welcome to the new Budget Tracker.</strong><p>Your previous balance is now your Bank Account balance. If part of it is cash, use <b>Move money</b>. Your past expenses are still in Activity and Budget. Income and expenses you add now change your balance automatically.</p><button class="btn secondary" id="dismissWelcome" type="button">Got it</button></section>`
      : "";
    const backupDue = !state.meta.lastBackupAt || Date.now() - state.meta.lastBackupAt > 30 * 864e5;
    const backup =
      backupDue && state.entries.filter((e) => e.type !== "opening").length >= 5
        ? `<section class="card note"><strong>${state.meta.lastBackupAt ? "Time for a backup" : "Back up your data"}</strong><p>Your records live only on this phone. Save a copy to Files.</p><div class="btn-row"><button class="btn primary" id="homeBackup" type="button">Export backup</button></div></section>`
        : "";
    view.innerHTML = `${welcome}${balanceCard()}
      <section class="actions">
        <button class="btn primary big-btn" data-add="expense" type="button">+ Expense</button>
        <button class="btn secondary big-btn" data-add="income" type="button">+ Income</button>
        <button class="btn ghost" data-add="move" type="button">Move money</button>
      </section>
      <section class="card">
        <h2>${isNow ? "This month" : monthLabel(viewMonth)}</h2>
        <div class="stat-rows">
          <div><span>Money in</span><strong class="pos">${money(st.moneyIn)}</strong></div>
          <div><span>Money out</span><strong>${money(st.moneyOut)}</strong></div>
          ${st.moneyIn > 0 ? `<div class="total"><span>${st.kept >= 0 ? "Kept" : "Spent more than came in"}</span><strong class="${st.kept < 0 ? "neg" : "pos"}">${money(Math.abs(st.kept))}</strong></div>` : ""}
        </div>
      </section>
      ${fixedCard(st)}
      ${flexibleCard(st, leftToSpend)}
      <section class="card">
        <div class="row"><h2>Recent</h2>${recent.length ? `<button class="link" data-goto="activity" type="button">See all</button>` : ""}</div>
        <div class="list">${recent.map(entryRow).join("") || `<p class="empty">Nothing recorded ${isNow ? "this month yet" : "in this month"}.</p>`}</div>
      </section>${backup}`;
  }
  function fixedCard(st) {
    if (!st.fixed.length)
      return `<section class="card"><h2>Fixed</h2><p class="empty">Add the costs you pay every month, like your phone, in <button class="link" data-goto="budget" type="button">Budget</button>.</p></section>`;
    const paidCount = st.fixed.filter((x) => x.spent > 0).length;
    return `<section class="card"><div class="row"><h2>Fixed</h2><span class="meta">${paidCount} of ${st.fixed.length} paid</span></div>
      <div class="list">${st.fixed
        .map(
          (x) =>
            `<div class="list-row"><div><strong>${esc(x.item.name)}</strong><span class="meta">${x.planned ? `${money(x.planned)} expected` : "No amount set"}</span></div>${
              x.spent > 0
                ? `<span class="paid">Paid ${money(x.spent)} ✓</span>`
                : viewMonth === thisMonth() && !x.item.archived
                  ? `<button class="btn secondary small" data-pay="${x.item.id}" type="button">Pay</button>`
                  : `<span class="meta">Not paid</span>`
            }</div>`,
        )
        .join("")}</div></section>`;
  }
  function flexibleCard(st, left) {
    const rows = st.flexible
      .filter((x) => x.planned > 0 || x.spent > 0)
      .map((x) => {
        const over = x.planned > 0 && x.spent > x.planned,
          pct = x.planned > 0 ? Math.min(100, (x.spent / x.planned) * 100) : 0;
        return `<div class="flex-row"><div class="row"><strong>${esc(x.item.name)}</strong><span class="meta">${money(x.spent)}${x.planned > 0 ? ` of ${money(x.planned)}` : ""}</span></div>${
          x.planned > 0 ? `<div class="bar"><span class="${over ? "over" : pct > 85 ? "watch" : ""}" style="width:${pct}%"></span></div>` : ""
        }</div>`;
      })
      .join("");
    const head =
      st.flexLimit > 0
        ? `<div class="left ${left < 0 ? "neg" : ""}"><span>${left >= 0 ? "Left to spend" : "Over your limits by"}</span><strong>${money(Math.abs(left))}</strong></div>`
        : "";
    return `<section class="card"><div class="row"><h2>Flexible</h2>${st.flexSpent ? `<span class="meta">${money(st.flexSpent)} spent</span>` : ""}</div>${head}${
      rows || `<p class="empty">Everyday spending like food goes here. Set monthly limits in <button class="link" data-goto="budget" type="button">Budget</button>.</p>`
    }</section>`;
  }
  function entryTitle(e) {
    if (e.type === "expense") return itemById(e.itemId)?.name || "Expense";
    if (e.type === "income") return INCOME_TYPES.find((t) => t[0] === e.incomeType)?.[1] || "Income";
    if (e.type === "move") return `${accountName(e.accountId)} → ${accountName(e.toAccountId)}`;
    if (e.type === "correction") return `Balance correction`;
    return "Starting balance";
  }
  function entryRow(e) {
    const amount =
      e.type === "expense" ? money(-e.amount) : e.type === "income" ? money(e.amount, { sign: true }) : e.type === "correction" ? money(e.amount, { sign: true }) : money(e.amount);
    const cls = e.type === "expense" ? "neg" : e.type === "income" ? "pos" : "";
    const where = e.type === "move" ? "Move money" : e.accountId ? accountName(e.accountId) : "Before balances";
    const meta = [dayLabel(e.date), where, e.note].filter(Boolean).map(esc).join(" · ");
    return `<button class="entry" type="button" data-entry="${e.id}"><span class="entry-main"><strong>${esc(entryTitle(e))}</strong><span class="meta">${meta}</span></span><span class="amount ${cls}">${amount}</span></button>`;
  }

  function renderActivity() {
    const es = monthEntries(viewMonth).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const filters = [
      ["all", "All"],
      ["expense", "Expenses"],
      ["income", "Income"],
      ["move", "Moves"],
    ];
    const shown = es.filter((e) => activityFilter === "all" || e.type === activityFilter || (activityFilter === "move" && e.type === "correction"));
    view.innerHTML = `${donutCard()}${trendCard()}
      <section class="card">
        <div class="seg fit" role="group" aria-label="Show">${filters
          .map(([v, l]) => `<button type="button" data-filter="${v}" class="${activityFilter === v ? "active" : ""}" aria-pressed="${activityFilter === v}">${l}</button>`)
          .join("")}</div>
        <div class="list">${shown.map(entryRow).join("") || `<p class="empty">Nothing to show for ${monthLabel(viewMonth)}.</p>`}</div>
      </section>`;
  }
  const COLORS = ["#2563eb", "#7c3aed", "#0891b2", "#db2777", "#ea580c", "#16a34a", "#64748b", "#ca8a04"];
  function donutCard() {
    const spent = spentBy(viewMonth),
      rows = Object.entries(spent)
        .map(([id, v]) => ({ name: itemById(id)?.name || "Others", v }))
        .sort((a, b) => b.v - a.v),
      total = rows.reduce((s, r) => s + r.v, 0);
    if (!total) return "";
    let acc = 0;
    const top = rows.slice(0, 5),
      rest = rows.slice(5).reduce((s, r) => s + r.v, 0);
    if (rest) top.push({ name: "Everything else", v: rest });
    const stops = top
      .map((r, i) => {
        const a = (acc / total) * 360;
        acc += r.v;
        return `${COLORS[i % COLORS.length]} ${a}deg ${(acc / total) * 360}deg`;
      })
      .join(", ");
    return `<section class="card"><h2>Where the money went</h2><div class="donut-wrap"><div class="donut" style="background:conic-gradient(${stops})" role="img" aria-label="Spending by item, ${money(total)} total"><div><span>Spent</span><strong>${money(total)}</strong></div></div>
      <ul class="legend">${top
        .map((r, i) => `<li><i style="background:${COLORS[i % COLORS.length]}"></i><span>${esc(r.name)}</span><small>${money(r.v)} · ${(r.v / total) * 100 < 1 ? "&lt;1" : Math.round((r.v / total) * 100)}%</small></li>`)
        .join("")}</ul></div></section>`;
  }
  function trendCard() {
    const months = Array.from({ length: 6 }, (_, i) => addMonths(viewMonth, i - 5)).filter((mk) => mk >= firstMonth());
    if (months.length < 2) return "";
    const data = months.map((mk) => ({ mk, ...monthStats(mk) })),
      max = Math.max(1, ...data.flatMap((d) => [d.moneyIn, d.moneyOut]));
    return `<section class="card"><div class="row"><h2>In vs out</h2><span class="legend-inline"><i class="in"></i>In <i class="out"></i>Out</span></div>
      <div class="bars" role="img" aria-label="Money in and out by month">${data
        .map(
          (d) =>
            `<div class="bar-col ${d.mk === viewMonth ? "current" : ""}"><div class="bar-pair"><span class="in" style="height:${(d.moneyIn / max) * 100}%"></span><span class="out" style="height:${(d.moneyOut / max) * 100}%"></span></div><small>${monthLabel(d.mk, true)}</small></div>`,
        )
        .join("")}</div></section>`;
  }

  function renderBudget() {
    const st = monthStats(viewMonth),
      spent = spentBy(viewMonth);
    const group = (g, title, help) => {
      const items = orderedItems().filter((i) => i.group === g && (!i.archived || spent[i.id]));
      const sugg = SUGGESTIONS[g].filter((n) => !state.items.some((i) => i.name.toLowerCase() === n.toLowerCase() && !i.archived));
      return `<section class="card"><div class="row"><h2>${title}</h2><button class="btn secondary small" data-new-item="${g}" type="button">+ Add</button></div><p class="meta">${help}</p>
        <div class="list">${items
          .map((i) => {
            const planned = itemAmount(i, viewMonth),
              s = spent[i.id] || 0;
            const right =
              g === "fixed"
                ? `${planned ? money(planned) : "—"}<small>${s ? `paid ${money(s)}` : "not paid"}</small>`
                : `${planned ? money(planned) : "No limit"}<small>${money(s)} spent</small>`;
            return `<button class="entry" type="button" data-item="${i.id}"><span class="entry-main"><strong>${esc(i.name)}${i.archived ? " (archived)" : ""}</strong></span><span class="amount stacked">${right}</span></button>`;
          })
          .join("") || `<p class="empty">Nothing here yet.</p>`}</div>
        ${sugg.length ? `<div class="suggest"><span class="meta">Suggestions</span>${sugg.map((n) => `<button class="chip" type="button" data-suggest="${g}" data-name="${esc(n)}">+ ${esc(n)}</button>`).join("")}</div>` : ""}
      </section>`;
    };
    view.innerHTML = `<section class="card"><h2>${monthLabel(viewMonth)}</h2><div class="tiles two">
        <div class="tile"><span>Fixed</span><strong>${money(st.fixedPlanned)}</strong><small>${money(st.fixedPaid)} paid</small></div>
        <div class="tile"><span>Flexible limits</span><strong>${st.flexLimit ? money(st.flexLimit) : "None set"}</strong><small>${money(st.flexSpent)} spent</small></div>
      </div>${viewMonth !== thisMonth() ? `<p class="meta">Amounts you change apply from this month on; past months keep theirs.</p>` : ""}</section>
      ${group("fixed", "Fixed", "Costs you pay every month, like your phone or transport pass. Tap Pay on Home when you pay them.")}
      ${group("flexible", "Flexible", "Everyday spending. Give each a monthly limit to see what's left to spend.")}`;
  }

  function renderMore() {
    const b = balances();
    const legacyLeft = Object.values(LEGACY).some((k) => localStorage.getItem(k) != null);
    view.innerHTML = `<section class="card"><h2>Accounts</h2><div class="list">${state.accounts
      .map(
        (a) =>
          `<div class="list-row acct-row"><div><strong>${esc(a.name)}</strong><span class="meta">${privateMoney(b[a.id])}</span></div><div class="btn-row"><button class="btn secondary small" data-rename="${a.id}" type="button">Rename</button><button class="btn secondary small" data-fix="${a.id}" type="button">Fix balance</button></div></div>`,
      )
      .join("")}</div><p class="meta">If your bank app or wallet shows a different amount, use Fix balance. It records the difference so nothing changes silently.</p></section>
      <section class="card"><h2>Currency</h2><label class="field"><span>Shown on every amount</span><select id="currencySelect">${CURRENCIES.map(
        ([c, sym]) => `<option value="${c}" ${c === state.currency ? "selected" : ""}>${c} (${sym.trim()})</option>`,
      ).join("")}</select></label><p class="meta">Changing this only changes the symbol; amounts are not converted.</p></section>
      <section class="card"><h2>Backup</h2><p class="meta">${state.meta.lastBackupAt ? `Last backup ${dayLabel(new Date(state.meta.lastBackupAt).toISOString().slice(0, 10))}.` : "No backup yet."} Your records live only on this phone.</p>
        <div class="btn-grid"><button class="btn primary" id="exportBtn" type="button">Export backup</button><label class="btn secondary file">Import backup<input id="importInput" type="file" accept="application/json,.json" hidden></label><button class="btn secondary span" id="csvBtn" type="button">Export spreadsheet (CSV)</button></div></section>
      ${
        legacyLeft
          ? `<section class="card"><h2>Previous version's data</h2><p class="meta">A copy of the data from the previous version${state.meta.legacySpecialCount ? `, including ${state.meta.legacySpecialCount} Special Budget${state.meta.legacySpecialCount > 1 ? "s" : ""},` : ""} is still on this phone. Download it if you want to keep it, then remove it.</p><div class="btn-row"><button class="btn secondary" id="legacyDownload" type="button">Download copy</button><button class="btn danger" id="legacyRemove" type="button">Remove</button></div></section>`
          : ""
      }
      <section class="card"><h2>About</h2><p class="meta">Budget Tracker v${APP_VERSION} · works offline · no account needed.</p><button class="btn danger" id="resetBtn" type="button">Start over</button></section>`;
  }

  // ---------- first launch ----------
  let setupStep = 1;
  const setupDraft = { currency: "TWD", cash: "", bank: "", bankName: "Bank Account", picks: new Set() };
  function renderSetup() {
    const step = (n, t) => `<p class="eyebrow">Step ${n} of 3</p><h2>${t}</h2>`;
    let body = "";
    if (setupStep === 1)
      body = `${step(1, "Which currency do you use?")}<label class="field"><span>Currency</span><select id="setupCurrency">${CURRENCIES.map(
        ([c, sym]) => `<option value="${c}" ${c === setupDraft.currency ? "selected" : ""}>${c} (${sym.trim()})</option>`,
      ).join("")}</select></label>`;
    if (setupStep === 2)
      body = `${step(2, "How much do you have right now?")}<p class="meta">Check your wallet and your bank app. You can fix these later.</p>
        <label class="field"><span>Cash</span><input id="setupCash" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="${esc(setupDraft.cash)}"></label>
        <label class="field"><span>Bank account name</span><input id="setupBankName" type="text" maxlength="30" value="${esc(setupDraft.bankName)}"></label>
        <label class="field"><span>Bank balance</span><input id="setupBank" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="${esc(setupDraft.bank)}"></label>`;
    if (setupStep === 3)
      body = `${step(3, "What do you spend on?")}<p class="meta">Tap what applies to you. You can add your own, set amounts and change anything later in Budget.</p>
        ${["fixed", "flexible"]
          .map(
            (g) =>
              `<p class="group-label">${g === "fixed" ? "Fixed — paid every month" : "Flexible — everyday spending"}</p><div class="chips">${SUGGESTIONS[g]
                .map((n) => `<button type="button" class="chip ${setupDraft.picks.has(n) ? "on" : ""}" data-pick="${esc(n)}" aria-pressed="${setupDraft.picks.has(n)}">${esc(n)}</button>`)
                .join("")}${g === "flexible" ? `<span class="chip fixed-chip">Others ✓</span>` : ""}</div>`,
          )
          .join("")}`;
    view.innerHTML = `<section class="card setup">${body}<div class="btn-row end">${setupStep > 1 ? `<button class="btn secondary" id="setupBack" type="button">Back</button>` : ""}<button class="btn primary" id="setupNext" type="button">${setupStep < 3 ? "Next" : "Start"}</button></div></section>
      ${setupStep === 1 ? `<p class="meta center">Have a backup? <label class="link file">Import it<input id="setupImport" type="file" accept="application/json,.json" hidden></label></p>` : ""}`;
  }
  function readSetup() {
    if ($("setupCurrency")) setupDraft.currency = $("setupCurrency").value;
    if ($("setupCash")) setupDraft.cash = $("setupCash").value;
    if ($("setupBank")) setupDraft.bank = $("setupBank").value;
    if ($("setupBankName")) setupDraft.bankName = $("setupBankName").value.trim() || "Bank Account";
  }
  function finishSetup() {
    const today = todayISO();
    state.currency = setupDraft.currency;
    state.accounts.find((a) => a.id === "bank").name = setupDraft.bankName;
    [["cash", setupDraft.cash], ["bank", setupDraft.bank]].forEach(([id, v]) =>
      state.entries.push({ id: uid("open"), type: "opening", amount: round2(Math.max(0, num(v))), date: today, accountId: id, note: "Starting balance", createdAt: Date.now() }),
    );
    ["fixed", "flexible"].forEach((g) =>
      SUGGESTIONS[g].filter((n) => setupDraft.picks.has(n)).forEach((name) => state.items.push({ id: uid("item"), name, group: g, amounts: [], archived: false, createdAt: Date.now() })),
    );
    state.meta.lastAccountId = num(setupDraft.bank) > 0 || !num(setupDraft.cash) ? "bank" : "cash";
    state.setupDone = true;
    save();
    tab = "home";
    render();
  }

  // ---------- pop-up forms ----------
  const sheet = $("sheet");
  let sheetDirty = false;
  let ctx = {}; // what the open pop-up is editing (kept off the DOM so it can never be mistaken for a tap target)
  function openSheet(title, body, actions) {
    ctx = {};
    $("sheetTitle").textContent = title;
    $("sheetBody").innerHTML = body;
    $("sheetActions").innerHTML = actions;
    sheetDirty = false;
    if (!sheet.open) sheet.showModal();
    const first = sheet.querySelector("[data-autofocus]");
    if (first) setTimeout(() => first.focus(), 60);
  }
  function closeSheet() {
    if (sheet.open) sheet.close();
  }
  // One choice out of a few. "chips" wraps onto more lines, for lists too long for one row.
  const segHTML = (name, opts, cur, look = "seg") =>
    `<div class="${look}" role="group" aria-label="${esc(name)}" data-seg="${esc(name)}">${opts
      .map(([v, l]) => `<button type="button" data-value="${esc(v)}" class="${look === "chips" ? "chip " : ""}${v === cur ? "active" : ""}" aria-pressed="${v === cur}">${esc(l)}</button>`)
      .join("")}</div>`;
  const segValue = (name) => sheet.querySelector(`[data-seg="${name}"] .active`)?.dataset.value;
  const accountOpts = () => state.accounts.map((a) => [a.id, a.name]);

  function openEntrySheet(type, entry = null, prefill = {}) {
    const e = entry || {},
      isEdit = !!entry;
    const amount = e.amount ?? prefill.amount ?? "";
    const date = e.date || (viewMonth === thisMonth() ? todayISO() : `${viewMonth}-${String(daysInMonth(viewMonth)).padStart(2, "0")}`);
    const account = e.accountId || prefill.accountId || state.meta.lastAccountId || "bank";
    let fields = "";
    if (type === "expense") {
      const cur = e.itemId || prefill.itemId || "";
      // Everyday items first, then fixed ones, then Others.
      const list = orderedItems().filter((i) => !i.archived || i.id === cur);
      const chips = [...list.filter((i) => i.group === "flexible" && i.id !== OTHERS_ID), ...list.filter((i) => i.group === "fixed"), ...list.filter((i) => i.id === OTHERS_ID)]
        .map((i) => `<button type="button" class="chip ${i.id === cur ? "on" : ""}" data-choose="${i.id}" aria-pressed="${i.id === cur}">${esc(i.name)}</button>`)
        .join("");
      fields = `<div class="field"><span>For</span><div class="chips" id="itemChips" role="group" aria-label="Item">${chips}</div></div>`;
    }
    if (type === "income") fields = `<div class="field"><span>Type</span>${segHTML("incomeType", INCOME_TYPES, e.incomeType || prefill.incomeType || "salary", "chips")}</div>`;
    const accountField =
      type === "move"
        ? `<div class="field"><span>From</span>${segHTML("from", accountOpts(), e.accountId || "bank")}</div><div class="field"><span>To</span>${segHTML("to", accountOpts(), e.toAccountId || "cash")}</div>`
        : e.legacy && !e.accountId
          ? `<p class="meta">Recorded before balances were tracked, so it doesn't change a balance.</p>`
          : `<div class="field"><span>${type === "income" ? "Into" : "Paid from"}</span>${segHTML("account", accountOpts(), account)}</div>`;
    const titles = { expense: isEdit ? "Edit expense" : "Add expense", income: isEdit ? "Edit income" : "Add income", move: isEdit ? "Edit move" : "Move money", correction: "Balance correction" };
    if (type === "correction") {
      openSheet(
        titles.correction,
        `<p class="meta">${esc(dayLabel(e.date))} · ${esc(accountName(e.accountId))}: ${money(e.amount, { sign: true })}. Corrections are added by Fix balance. Delete this one if it was a mistake.</p>`,
        `<button class="btn danger" id="deleteEntry" type="button">Delete</button>`,
      );
      ctx.type = "correction";
      ctx.entry = e.id;
      return;
    }
    openSheet(
      titles[type],
      `<label class="field amount-field"><span>Amount</span><div class="amount-input"><b>${esc(currencyInfo()[1].trim())}</b><input id="fAmount" type="number" inputmode="decimal" min="0" step="any" value="${esc(amount)}" placeholder="0" required data-autofocus></div></label>
       ${fields}${accountField}
       <div class="two"><label class="field"><span>Date</span><input id="fDate" type="date" value="${esc(date)}" max="${todayISO()}"></label>
       <label class="field"><span>Note</span><input id="fNote" type="text" maxlength="80" placeholder="Optional" value="${esc(e.note || "")}"></label></div>
       <p class="form-error" id="fError" role="alert"></p>`,
      `${isEdit ? `<button class="btn danger" id="deleteEntry" type="button">Delete</button>` : ""}<button class="btn primary" id="saveEntry" type="submit">${isEdit ? "Save" : "Add"}</button>`,
    );
    ctx.type = type;
    ctx.entry = e.id || "";
    ctx.legacy = e.legacy && !e.accountId ? "1" : "";
  }
  function saveEntryFromSheet() {
    const type = ctx.type,
      id = ctx.entry;
    const amount = round2($("fAmount").value),
      date = $("fDate").value,
      note = $("fNote").value.trim(),
      err = $("fError");
    if (!(amount > 0)) return (err.textContent = "Enter an amount above zero."), $("fAmount").focus();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return (err.textContent = "Choose a date.");
    const existing = state.entries.find((x) => x.id === id);
    const e = existing ? { ...existing } : { id: uid(type), type, createdAt: Date.now() };
    Object.assign(e, { amount, date, note });
    if (type === "expense") {
      e.itemId = sheet.querySelector("#itemChips .on")?.dataset.choose;
      if (!e.itemId) return (err.textContent = "Choose what it was for.");
    }
    if (type === "income") e.incomeType = segValue("incomeType");
    if (type === "move") {
      e.accountId = segValue("from");
      e.toAccountId = segValue("to");
      if (e.accountId === e.toAccountId) return (err.textContent = "Choose two different accounts.");
    } else if (ctx.legacy !== "1") {
      e.accountId = segValue("account");
      state.meta.lastAccountId = e.accountId;
    }
    if (existing) state.entries[state.entries.indexOf(existing)] = e;
    else state.entries.push(e);
    save();
    closeSheet();
    if (monthOf(date) !== viewMonth) viewMonth = monthOf(date) > thisMonth() ? thisMonth() : monthOf(date);
    render();
    showToast(existing ? "Saved." : `${entryTitle(e)} ${type === "expense" ? money(-amount) : money(amount)} added.`, existing ? null : { kind: "add", id: e.id });
  }
  function deleteEntryFromSheet() {
    const e = state.entries.find((x) => x.id === ctx.entry);
    if (!e) return closeSheet();
    state.entries = state.entries.filter((x) => x !== e);
    save();
    closeSheet();
    render();
    showToast("Deleted.", { kind: "delete", entry: e });
  }

  function openFixSheet(accountId) {
    const b = balances();
    openSheet(
      `Fix ${accountName(accountId)} balance`,
      `<p class="meta">The app shows <b>${money(b[accountId])}</b>. Enter what your ${accountId === "cash" ? "wallet" : "bank app"} actually shows.</p>
       <label class="field amount-field"><span>Actual balance</span><div class="amount-input"><b>${esc(currencyInfo()[1].trim())}</b><input id="fixAmount" type="number" inputmode="decimal" step="any" value="${b[accountId]}" data-autofocus></div></label>
       <p class="meta" id="fixDiff"></p><p class="form-error" id="fError" role="alert"></p>`,
      `<button class="btn primary" id="saveFix" type="submit">Save</button>`,
    );
    ctx.type = "fix";
    ctx.account = accountId;
    const upd = () => {
      const d = round2(num($("fixAmount").value) - b[accountId]);
      $("fixDiff").textContent = d ? `A correction of ${money(d, { sign: true })} will be recorded.` : "No change.";
    };
    $("fixAmount").addEventListener("input", upd);
    upd();
  }
  function saveFix() {
    const id = ctx.account,
      v = $("fixAmount").value;
    if (v === "" || !Number.isFinite(Number(v))) return ($("fError").textContent = "Enter the balance.");
    const d = round2(num(v) - balances()[id]);
    if (d) state.entries.push({ id: uid("fix"), type: "correction", amount: d, date: todayISO(), accountId: id, note: "", createdAt: Date.now() });
    save();
    closeSheet();
    render();
    showToast(d ? `${accountName(id)} corrected by ${money(d, { sign: true })}.` : "Balance already matches.", d ? { kind: "add", id: state.entries.at(-1).id } : null);
  }

  function openItemSheet(item, group, name = "") {
    const isEdit = !!item,
      g = item?.group || group,
      used = item ? state.entries.some((e) => e.itemId === item.id) : false;
    const amount = item ? itemAmount(item, thisMonth()) : "";
    openSheet(
      isEdit ? `Edit ${item.name}` : `Add ${g === "fixed" ? "fixed" : "flexible"} item`,
      `<label class="field"><span>Name</span><input id="iName" type="text" maxlength="40" value="${esc(item?.name || name)}" ${item?.builtIn ? "readonly" : ""} data-autofocus></label>
       ${item?.builtIn ? "" : `<div class="field"><span>Type</span>${segHTML("group", [["fixed", "Fixed"], ["flexible", "Flexible"]], g)}</div>`}
       <label class="field amount-field"><span id="iAmountLabel">${g === "fixed" ? "Expected each month" : "Monthly limit (optional)"}</span><div class="amount-input"><b>${esc(currencyInfo()[1].trim())}</b><input id="iAmount" type="number" inputmode="decimal" min="0" step="any" value="${amount || ""}" placeholder="0"></div></label>
       ${isEdit && !item.builtIn ? `<label class="check"><input id="iArchived" type="checkbox" ${item.archived ? "checked" : ""}> Archive — hide it from new entries (its history stays)</label>` : ""}
       <p class="form-error" id="fError" role="alert"></p>`,
      `${isEdit && !item.builtIn && !used ? `<button class="btn danger" id="deleteItem" type="button">Delete</button>` : ""}<button class="btn primary" id="saveItem" type="submit">${isEdit ? "Save" : "Add"}</button>`,
    );
    ctx.type = "item";
    ctx.item = item?.id || "";
    ctx.group = g;
    sheet.querySelectorAll('[data-seg="group"] button').forEach((b) =>
      b.addEventListener("click", () => ($("iAmountLabel").textContent = b.dataset.value === "fixed" ? "Expected each month" : "Monthly limit (optional)")),
    );
  }
  function saveItem() {
    const name = $("iName").value.trim(),
      amount = round2(Math.max(0, num($("iAmount").value))),
      id = ctx.item;
    if (!name) return ($("fError").textContent = "Give it a name.");
    if (state.items.some((i) => i.id !== id && !i.archived && i.name.toLowerCase() === name.toLowerCase())) return ($("fError").textContent = "You already have an item with this name.");
    let item = itemById(id);
    if (!item) {
      item = { id: uid("item"), name, group: ctx.group, amounts: [], archived: false, createdAt: Date.now() };
      state.items.push(item);
    }
    if (!item.builtIn) {
      item.name = name;
      item.group = segValue("group") || item.group;
      item.archived = !!$("iArchived")?.checked;
    }
    setItemAmount(item, amount);
    save();
    closeSheet();
    render();
    showToast(id ? "Saved." : `${name} added.`);
  }
  function deleteItem() {
    const id = ctx.item;
    if (state.entries.some((e) => e.itemId === id)) return;
    state.items = state.items.filter((i) => i.id !== id);
    save();
    closeSheet();
    render();
    showToast("Deleted.");
  }
  function openRenameSheet(accountId) {
    openSheet(
      "Rename account",
      `<label class="field"><span>Name</span><input id="rName" type="text" maxlength="30" value="${esc(accountName(accountId))}" data-autofocus></label><p class="form-error" id="fError" role="alert"></p>`,
      `<button class="btn primary" id="saveRename" type="submit">Save</button>`,
    );
    ctx.type = "rename";
    ctx.account = accountId;
  }

  // ---------- toast + undo ----------
  function showToast(text, undoInfo = null) {
    undo = undoInfo;
    $("toastText").textContent = text;
    $("toastUndo").hidden = !undoInfo;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      $("toast").hidden = true;
      undo = null;
    }, undoInfo ? 6000 : 2200);
  }
  function doUndo() {
    if (!undo) return;
    if (undo.kind === "add") state.entries = state.entries.filter((e) => e.id !== undo.id);
    if (undo.kind === "delete") state.entries.push(undo.entry);
    undo = null;
    save();
    render();
    $("toast").hidden = true;
  }

  // ---------- backup ----------
  function download(name, text, type) {
    const blob = new Blob([text], { type }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function shareOrDownload(name, text, type) {
    try {
      const file = new File([text], name, { type });
      if (window.matchMedia?.("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return true;
      }
    } catch (e) {
      if (e?.name === "AbortError") return false;
    }
    download(name, text, type);
    return true;
  }
  async function exportBackup() {
    const stamp = Date.now();
    const text = JSON.stringify({ app: "budget-tracker", version: APP_VERSION, exportedAt: new Date(stamp).toISOString(), state: { ...state, meta: { ...state.meta, lastBackupAt: stamp } } }, null, 2);
    if (!(await shareOrDownload(`budget-tracker-backup-${todayISO()}.json`, text, "application/json"))) return showToast("Backup not saved.");
    state.meta.lastBackupAt = stamp;
    save();
    render();
    showToast("Backup saved.");
  }
  function exportCsv() {
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const rows = [["Date", "Type", "For", "Account", "Amount", "Currency", "Note"]];
    [...state.entries]
      .filter((e) => e.type !== "opening")
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((e) =>
        rows.push([e.date, e.type, entryTitle(e), e.type === "move" ? `${accountName(e.accountId)} → ${accountName(e.toAccountId)}` : accountName(e.accountId), e.type === "expense" ? -e.amount : e.amount, state.currency, e.note || ""]),
      );
    download(`budget-tracker-${todayISO()}.csv`, rows.map((r) => r.map(q).join(",")).join("\n"), "text/csv;charset=utf-8");
  }
  async function importFile(file) {
    let d;
    try {
      d = JSON.parse(await file.text());
    } catch {
      return showToast("That file isn't a backup. Nothing was changed.");
    }
    let next = null;
    if (d?.app === "budget-tracker" && d.state && Array.isArray(d.state.entries)) next = normalize(d.state);
    else if (d && (Array.isArray(d.regularExpenses) || Array.isArray(d.expenses)))
      next = fromLegacy({ expenses: d.regularExpenses || d.expenses, templateBudgets: d.templateBudgets || {}, monthBudgets: d.monthBudgets || {}, reserve: num(d.reserveBase ?? d.reserveTwd ?? d.cashReserve), specialBudgets: d.specialBudgets || [], settings: d.settings || {} });
    if (!next) return showToast("That file isn't a Budget Tracker backup. Nothing was changed.");
    const count = next.entries.filter((e) => e.type !== "opening").length;
    if (state.setupDone && !confirm(`Replace everything on this phone with this backup (${count} entries)?`)) return;
    state = next;
    state.setupDone = true;
    save();
    viewMonth = thisMonth();
    tab = "home";
    render();
    showToast("Backup imported.");
  }

  // ---------- events ----------
  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("button, label.file");
    if (!t) return;
    const d = t.dataset;
    if (d.tab) {
      tab = d.tab;
      window.scrollTo(0, 0);
      return render();
    }
    if (d.goto) {
      tab = d.goto;
      window.scrollTo(0, 0);
      return render();
    }
    if (t.id === "prevMonth" && viewMonth > firstMonth()) return (viewMonth = addMonths(viewMonth, -1)), render();
    if (t.id === "nextMonth" && viewMonth < thisMonth()) return (viewMonth = addMonths(viewMonth, 1)), render();
    if (t.id === "privacyBtn") return (state.meta.privacy = !state.meta.privacy), save(), render();
    if (t.id === "dismissWelcome") return (state.meta.welcome = false), save(), render();
    if (d.add) return openEntrySheet(d.add);
    if (d.pay) return openEntrySheet("expense", null, { itemId: d.pay, amount: itemAmount(itemById(d.pay), thisMonth()) || "" });
    if (d.entry) {
      const e = state.entries.find((x) => x.id === d.entry);
      if (e && e.type !== "opening") openEntrySheet(e.type, e);
      return;
    }
    if (d.fix) return openFixSheet(d.fix);
    if (d.rename) return openRenameSheet(d.rename);
    if (d.filter) return (activityFilter = d.filter), render();
    if (d.newItem) return openItemSheet(null, d.newItem);
    if (d.suggest) return openItemSheet(null, d.suggest, d.name);
    if (d.item) return openItemSheet(itemById(d.item));
    if (d.pick) {
      setupDraft.picks.has(d.pick) ? setupDraft.picks.delete(d.pick) : setupDraft.picks.add(d.pick);
      return renderSetup();
    }
    if (d.choose) {
      t.parentElement.querySelectorAll(".chip").forEach((c) => {
        c.classList.toggle("on", c === t);
        c.setAttribute("aria-pressed", String(c === t));
      });
      return;
    }
    if (t.closest("[data-seg]") && d.value) {
      t.parentElement.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("active", b === t);
        b.setAttribute("aria-pressed", String(b === t));
      });
      return;
    }
    if (t.id === "setupNext") {
      readSetup();
      if (setupStep < 3) return setupStep++, renderSetup();
      return finishSetup();
    }
    if (t.id === "setupBack") return readSetup(), setupStep--, renderSetup();
    if (t.id === "sheetClose") return closeSheet();
    if (t.id === "deleteEntry") return deleteEntryFromSheet();
    if (t.id === "deleteItem") return deleteItem();
    if (t.id === "toastUndo") return doUndo();
    if (t.id === "exportBtn" || t.id === "homeBackup") return exportBackup();
    if (t.id === "csvBtn") return exportCsv();
    if (t.id === "legacyDownload") {
      const copy = Object.fromEntries(Object.entries(LEGACY).map(([k, key]) => [k, readJSON(key) ?? localStorage.getItem(key)]));
      return download(`budget-tracker-previous-version-${todayISO()}.json`, JSON.stringify(copy, null, 2), "application/json");
    }
    if (t.id === "legacyRemove") {
      if (!confirm("Remove the previous version's data from this phone? Download a copy first if you want to keep it.")) return;
      Object.values(LEGACY).forEach((k) => localStorage.removeItem(k));
      return render();
    }
    if (t.id === "resetBtn") {
      if (!confirm("Delete everything and start over? Export a backup first if you want to keep your records.")) return;
      state = freshState();
      setupStep = 1;
      save();
      return render();
    }
  });
  $("sheetForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const type = ctx.type;
    if (["expense", "income", "move"].includes(type)) return saveEntryFromSheet();
    if (type === "fix") return saveFix();
    if (type === "item") return saveItem();
    if (type === "rename") {
      const name = $("rName").value.trim();
      if (!name) return ($("fError").textContent = "Give it a name.");
      accountById(ctx.account).name = name;
      save();
      closeSheet();
      return render();
    }
  });
  $("sheetForm").addEventListener("input", () => (sheetDirty = true));
  // Tapping outside a pop-up closes it, but never silently throws away what was typed.
  sheet.addEventListener("click", (ev) => {
    if (ev.target !== sheet) return;
    if (sheetDirty && !confirm("Discard what you've entered?")) return;
    closeSheet();
  });
  document.addEventListener("change", (ev) => {
    if (ev.target.id === "importInput" || ev.target.id === "setupImport") {
      const f = ev.target.files?.[0];
      ev.target.value = "";
      if (f) importFile(f);
    }
    if (ev.target.id === "currencySelect") {
      state.currency = ev.target.value;
      save();
      render();
    }
  });

  render();
  if ("serviceWorker" in navigator) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (had) showToast("Updated to the latest version.");
    });
  }
})();
