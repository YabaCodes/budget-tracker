(() => {
  "use strict";

  // Budget Tracker v10 — a simple budget built on the same design as Wealth OS:
  // Bank Account + Cash balances, income, expenses, a Fixed / Flexible monthly budget and savings goals.
  // Balances are always calculated from the entries, so editing or deleting an entry corrects them.
  // Goal money stays in the accounts but is set aside, so "Available to spend" = balance − goal savings.

  const APP_VERSION = "10.0.0"; // bump together with CACHE in sw.js
  const KEY = "budgetTracker.v10";
  const V9_KEY = "budgetTracker.v9";
  const THEME_KEY = "budgetTrackerTheme";
  // v10 starts everyone fresh once: earlier money entries are cleared, except the expenses recorded in
  // version 8, and today's balances are entered again. The data from before is kept under this key.
  const CLEAN_START = "v10";
  const BEFORE_CLEAN_KEY = "budgetTracker.beforeFreshStart";
  // Data from version 8 and earlier (kept on the phone as a safety copy until removed in Settings).
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
  // The categories and amounts version 8 started with. Untouched copies are not carried over.
  const OLD_DEFAULTS = {
    Rent: 23000, "Sister's rent": 7600, Tithe: 8200, "Family support": 3500, Utilities: 1750, SIM: 799,
    "Home Wi‑Fi": 899, "Apple One": 390, "iCloud+": 300, Gym: 1088, Transportation: 1000,
    "Food & groceries": 8000, Dating: 3000, Miscellaneous: 1000,
  };
  const SUGGESTIONS = { fixed: ["Business Payment", "Phone", "Transport"], flexible: ["Food", "Household"] };
  const GROUP_LABEL = { fixed: "Monthly bills", flexible: "Everyday spending" };
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

  const root = document.getElementById("app");
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
  function monthLabel(mk, opts = { month: "long", year: "numeric" }) {
    const [y, m] = mk.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", opts).format(new Date(y, m - 1, 1));
  }
  // "Oct 4" this year, "Oct 4, 2025" otherwise.
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
  const monthsBetween = (fromMk, toMk) => {
    const [a, b] = [fromMk, toMk].map((x) => x.split("-").map(Number));
    return (b[0] - a[0]) * 12 + (b[1] - a[1]);
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
  const hidden = () => !!state.meta.privacy;
  const privateMoney = (v, opts) => (hidden() ? `${currencyInfo()[1]}••••` : money(v, opts));
  const pct = (r) => `${(Math.max(0, r) * 100).toFixed(r > 0 && r < 0.1 ? 1 : 0)}%`;

  // ---------- state ----------
  function freshState() {
    return {
      version: 10,
      setupDone: false,
      currency: "TWD",
      accounts: [
        { id: "bank", name: "Bank Account" },
        { id: "cash", name: "Cash" },
      ],
      items: [{ id: OTHERS_ID, name: "Others", group: "flexible", amounts: [], archived: false, builtIn: true, createdAt: Date.now() }],
      goals: [],
      entries: [],
      meta: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastBackupAt: null,
        backupSnoozeUntil: null,
        lastAccountId: "bank",
        lastItemId: null,
        privacy: false,
        theme: "system",
        migratedFrom: null,
        welcome: null,
        legacySpecialCount: 0,
      },
    };
  }
  // Accepts data saved by v9 or v10 (and the state inside their backup files).
  function normalize(s) {
    const base = freshState();
    const out = { ...base, ...s, version: 10, meta: { ...base.meta, ...(s.meta || {}) } };
    const accounts = Array.isArray(s.accounts) && s.accounts.length ? s.accounts : base.accounts;
    out.accounts = ["bank", "cash"].map((id) => accounts.find((a) => a.id === id) || base.accounts.find((a) => a.id === id));
    out.items = Array.isArray(s.items) ? s.items : base.items;
    if (!out.items.some((i) => i.id === OTHERS_ID)) out.items.push(base.items[0]);
    out.items.forEach((i) => {
      i.amounts = Array.isArray(i.amounts) ? i.amounts : [];
      i.group = i.group === "fixed" ? "fixed" : "flexible";
    });
    out.goals = Array.isArray(s.goals) ? s.goals : [];
    out.entries = Array.isArray(s.entries) ? s.entries : [];
    if (!CURRENCIES.some((c) => c[0] === out.currency)) out.currency = "TWD";
    if (out.meta.welcome === true) out.meta.welcome = "v8"; // v9 kept this as true/false
    if (out.meta.welcome === false) out.meta.welcome = null;
    if (!["system", "light", "dark"].includes(out.meta.theme)) out.meta.theme = "system";
    return out;
  }
  function load() {
    const raw = localStorage.getItem(KEY);
    try {
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) {
      // Keep the unreadable copy instead of overwriting it, so it can still be recovered.
      console.warn("Could not read saved data", e);
      try {
        localStorage.setItem(`${KEY}.unreadable-${Date.now()}`, raw);
      } catch {}
    }
    let s = null;
    try {
      const v9 = localStorage.getItem(V9_KEY);
      if (v9) {
        s = normalize(JSON.parse(v9));
        s.meta.migratedFrom = s.meta.migratedFrom || "9";
        if (s.setupDone && s.meta.welcome !== "v8") s.meta.welcome = "v10";
      }
    } catch (e) {
      console.warn("Could not read version 9 data", e);
    }
    if (!s) {
      const legacy = readLegacy();
      if (legacy) s = fromLegacy(legacy);
    }
    if (!s) return freshState();
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
    return s;
  }
  let saveFailed = false;
  function save() {
    state.meta.updatedAt = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      saveFailed = false;
      return true;
    } catch (e) {
      console.warn("Save failed", e);
      saveFailed = true;
      return false;
    }
  }

  // ---------- moving data from version 8 ----------
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
    };
  }
  // Works for data on this phone and for backup files made by version 8.
  function fromLegacy(L) {
    const s = freshState();
    const today = todayISO();
    s.setupDone = true;
    s.currency = String(L.settings?.baseCurrency || "TWD").toUpperCase();
    if (!CURRENCIES.some((c) => c[0] === s.currency)) s.currency = "TWD";
    s.meta.migratedFrom = "8";
    s.meta.welcome = "v8";
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
      let last = null;
      Object.keys(L.monthBudgets || {})
        .sort()
        .forEach((mk) => {
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
    // Past expenses keep their month and category, but version 8 never took them out of the reserve,
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
    // The reserve becomes today's Bank Account balance. Money set aside for a Special Budget that is
    // still running left the reserve, so whatever wasn't spent yet is added back.
    const specials = Array.isArray(L.specialBudgets) ? L.specialBudgets : [];
    const setAside = specials
      .filter((sp) => sp && sp.status === "active")
      .reduce((sum, sp) => sum + Math.max(0, num(sp.allocatedBase) - (sp.expenses || []).reduce((t, x) => t + num(x.amountBase), 0)), 0);
    s.entries.push({ id: uid("open"), type: "opening", amount: round2(Math.max(0, L.reserve) + setAside), date: today, accountId: "bank", note: "Starting balance (from the previous version)", createdAt: Date.now() });
    s.entries.push({ id: uid("open"), type: "opening", amount: 0, date: today, accountId: "cash", note: "Starting balance", createdAt: Date.now() });
    s.meta.legacySpecialCount = specials.length;
    return s;
  }
  const previousVersionKeys = () => [...Object.values(LEGACY), V9_KEY, BEFORE_CLEAN_KEY].filter((k) => localStorage.getItem(k) != null);
  function applyCleanStart() {
    try {
      localStorage.setItem(BEFORE_CLEAN_KEY, JSON.stringify(state));
    } catch {}
    state.entries = state.entries.filter((e) => e.type === "expense" && e.legacy);
    state.meta.cleanStart = CLEAN_START;
    state.meta.cleanPending = true;
    state.meta.welcome = "fresh";
    state.setupDone = false;
    save();
  }

  let state = load();
  let tab = "home",
    viewMonth = thisMonth(),
    activityFilter = "all",
    activitySearch = "",
    modal = null,
    modalDirty = false,
    undo = null,
    toastTimer = null,
    setupStep = 1;
  const setupDraft = { currency: "TWD", cash: "", bank: "", bankName: "Bank Account", picks: new Set() };

  // ---------- theme (same behaviour as Wealth OS) ----------
  const resolvedTheme = (pref) =>
    pref === "dark" || (pref === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  function applyTheme(pref) {
    const t = resolvedTheme(pref || "system");
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0d1017" : "#f6f7fb");
    try {
      localStorage.setItem(THEME_KEY, pref || "system");
    } catch {}
  }
  if (window.matchMedia) {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => state.meta.theme === "system" && applyTheme("system");
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener?.(onChange);
  }

  // ---------- calculations ----------
  // Items in the order they were added, with the catch-all Others always last.
  const orderedItems = () => [...state.items].sort((x, y) => (x.id === OTHERS_ID) - (y.id === OTHERS_ID));
  const itemById = (id) => state.items.find((i) => i.id === id);
  const goalById = (id) => state.goals.find((g) => g.id === id);
  const accountById = (id) => state.accounts.find((a) => a.id === id);
  const accountName = (id) => accountById(id)?.name || "";
  const bankName = () => accountName("bank");
  // The planned amount of an item for a month: the latest amount set on or before that month.
  function itemAmount(item, mk) {
    let v = 0;
    (item.amounts || []).forEach((a) => {
      if (a.from <= mk) v = num(a.amount);
    });
    return v;
  }
  // A changed amount applies from this month on; earlier months keep theirs.
  function setItemAmount(item, amount) {
    const mk = thisMonth();
    item.amounts = (item.amounts || []).filter((a) => a.from !== mk);
    if (round2(amount) !== round2(itemAmount(item, mk))) item.amounts.push({ from: mk, amount: round2(amount) });
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
  const totalBalance = () => round2(Object.values(balances()).reduce((s, v) => s + v, 0));
  const goalBal = (g) => round2(state.entries.filter((e) => e.type === "goal" && e.goalId === g.id).reduce((s, e) => s + num(e.amount), 0));
  const setAsideTotal = () => round2(state.entries.filter((e) => e.type === "goal").reduce((s, e) => s + num(e.amount), 0));
  const available = () => round2(totalBalance() - setAsideTotal());
  const activeGoals = () => state.goals.filter((g) => !g.archived);

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
    const sum = (list) => round2(list.reduce((s, e) => s + num(e.amount), 0));
    const moneyIn = sum(es.filter((e) => e.type === "income"));
    const spentTotal = sum(es.filter((e) => e.type === "expense"));
    const saved = sum(es.filter((e) => e.type === "goal"));
    const spent = spentBy(mk);
    const lines = (group) =>
      orderedItems()
        .filter((i) => i.group === group && (!i.archived || spent[i.id]))
        .map((i) => ({ item: i, planned: itemAmount(i, mk), spent: spent[i.id] || 0 }));
    const fixed = lines("fixed"),
      flexible = lines("flexible");
    const total = (xs, k) => round2(xs.reduce((s, x) => s + x[k], 0));
    const goalPlanned = round2(activeGoals().filter((g) => goalBal(g) < num(g.target)).reduce((s, g) => s + num(g.monthly), 0));
    return {
      moneyIn, spentTotal, saved, fixed, flexible, goalPlanned,
      fixedPlanned: total(fixed, "planned"), fixedPaid: total(fixed, "spent"),
      flexLimit: total(flexible, "planned"), flexSpent: total(flexible, "spent"),
    };
  }
  const firstMonth = () => [thisMonth(), ...state.entries.map((e) => monthOf(e.date)).filter(Boolean)].sort()[0];
  // Average set aside per month over the last three months (this one included), or since the goal started.
  function goalPace(g) {
    const c = new Date(num(g.createdAt) || Date.now()),
      started = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}`;
    const months = Math.min(3, Math.max(1, monthsBetween(started, thisMonth()) + 1));
    const since = addMonths(thisMonth(), 1 - months);
    const added = state.entries.filter((e) => e.type === "goal" && e.goalId === g.id && monthOf(e.date) >= since).reduce((s, e) => s + num(e.amount), 0);
    return Math.max(0, added / months);
  }
  function goalPaceText(g) {
    const remaining = round2(num(g.target) - goalBal(g));
    if (remaining <= 0) return "Goal reached. Take the money out when you use it.";
    if (g.targetDate && /^\d{4}-\d{2}/.test(g.targetDate)) {
      const months = monthsBetween(thisMonth(), monthOf(g.targetDate)) + 1;
      if (months <= 0) return `The target date has passed · ${money(remaining)} to go`;
      return `Set aside ~${money(remaining / months)} a month to reach it by ${monthLabel(monthOf(g.targetDate), { month: "short", year: "numeric" })}`;
    }
    const pace = goalPace(g) || num(g.monthly);
    if (pace <= 0) return "Add money to it regularly to see when you'll get there.";
    const when = monthLabel(addMonths(thisMonth(), Math.ceil(remaining / pace)), { month: "short", year: "numeric" });
    return `At ${money(pace)} a month: ${when}`;
  }

  // ---------- small pieces shared by the screens (same markup as Wealth OS) ----------
  function icon(name) {
    const paths = {
      home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
      budget: '<circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/><path d="M9 6h11M9 12h11M9 18h11"/>',
      activity: '<path d="M8 4v16M8 4 4.5 7.5M8 4l3.5 3.5M16 20V4M16 20l-3.5-3.5M16 20l3.5-3.5"/>',
      goals: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
      expense: '<path d="M12 4v13M7.5 12.5 12 17l4.5-4.5"/><path d="M5 20h14"/>',
      income: '<path d="M12 20V7M7.5 11.5 12 7l4.5 4.5"/><path d="M5 4h14"/>',
      transfer: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
      save: '<path d="M5 9.5a7 7 0 0 1 12.4-2.3L20 6.5v4.8l-1.4 1.1V17h-2.8l-.8 2h-2.5l-.6-1.6H9.6L9 19H6.5l-.9-3A6.6 6.6 0 0 1 5 9.5z"/><circle cx="15.5" cy="10" r=".6"/>',
      eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/>',
      eyeOff:
        '<path d="M3 3l18 18"/><path d="M10.6 6.2A8.8 8.8 0 0 1 12 6c6 0 9.5 6 9.5 6a15.8 15.8 0 0 1-3.1 3.8M6.1 6.1C3.8 7.7 2.5 12 2.5 12s3.5 6 9.5 6c1.5 0 2.9-.4 4.1-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
      settings:
        '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.1.36.31.7.6 1 .3.29.66.5 1.1.6h.1v4h-.1c-.44.1-.8.31-1.1.6-.29.3-.5.64-.6 1z"/>',
    };
    return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
  }
  const row = (label, value, cls = "") => `<div class="row"><span>${label}</span><span class="amount ${cls}">${value}</span></div>`;
  const sectionTitle = (title, sub = "", extra = "") =>
    `<div class="section-title${extra ? " with-link" : ""}"><h2>${title}</h2>${sub ? `<span class="sub">${sub}</span>` : ""}${extra}</div>`;
  const emptyCard = (title, text, button = "") =>
    `<section class="card"><div class="empty compact-empty"><strong>${title}</strong><span>${text}</span>${button}</div></section>`;
  function progress(ratio, over = false) {
    return `<div class="progress ${over ? "over" : ""}"><span style="width:${Math.min(100, Math.max(0, ratio * 100))}%"></span></div>`;
  }
  function periodSelector() {
    const months = [];
    for (let mk = thisMonth(); mk >= firstMonth(); mk = addMonths(mk, -1)) months.push(mk);
    const idx = months.indexOf(viewMonth),
      older = months[idx + 1],
      newer = months[idx - 1];
    const now = viewMonth === thisMonth();
    return `<div class="period-nav full"><button class="period-step" type="button" data-action="period-step" data-month="${older || ""}" ${older ? "" : "disabled"} aria-label="Previous month">‹</button><label class="period-current"><span class="period-name">${monthLabel(viewMonth)}</span>${now ? `<span class="tag period-state good-tag">This month</span>` : ""}<select id="period-select" aria-label="Month">${months
      .map((mk) => `<option value="${mk}" ${mk === viewMonth ? "selected" : ""}>${monthLabel(mk)}</option>`)
      .join("")}</select></label><button class="period-step" type="button" data-action="period-step" data-month="${newer || ""}" ${newer ? "" : "disabled"} aria-label="Next month">›</button></div>`;
  }
  function budgetMini(x) {
    const left = round2(x.planned - x.spent);
    return `<div class="row"><div style="flex:1;min-width:0"><strong>${esc(x.item.name)}</strong>${progress(x.planned ? x.spent / x.planned : 0, left < 0)}<div class="sub">${money(x.spent)} of ${money(x.planned)}</div></div><div class="amount ${left < 0 ? "bad" : ""}">${left < 0 ? `${money(-left)} over` : `${money(left)} left`}</div></div>`;
  }
  function obligationRow(x, canRecord) {
    const remaining = Math.max(0, round2(x.planned - x.spent)),
      paid = x.spent > 0 && remaining <= 0.5;
    const status = paid ? "paid" : x.spent > 0 ? "partly paid" : x.planned ? "not paid yet" : "no amount set";
    const action = paid
      ? `<span class="tag good-tag">Paid</span>`
      : canRecord
        ? `<button class="btn ghost small" type="button" data-action="record-bill" data-id="${x.item.id}">${remaining ? `Record ${money(remaining)}` : "Record"}</button>`
        : `<span class="tag">${x.spent > 0 ? `${money(remaining)} left` : "Not paid"}</span>`;
    return `<div class="obligation-row"><div class="obligation-status ${paid ? "done" : ""}" aria-hidden="true">${paid ? "✓" : "•"}</div><div class="obligation-copy"><strong>${esc(x.item.name)}</strong><div class="sub">${x.planned ? `${money(x.spent)} of ${money(x.planned)} · ${status}` : x.spent ? `${money(x.spent)} paid · no amount set` : "No amount set yet"}</div></div>${action}</div>`;
  }
  function entryTitle(e) {
    if (e.type === "expense") return itemById(e.itemId)?.name || "Expense";
    if (e.type === "income") return INCOME_TYPES.find((t) => t[0] === e.incomeType)?.[1] || "Income";
    if (e.type === "move") return `${accountName(e.accountId)} → ${accountName(e.toAccountId)}`;
    if (e.type === "correction") return `${accountName(e.accountId)} balance update`;
    if (e.type === "goal") return `${num(e.amount) >= 0 ? "Set aside for" : "Taken from"} ${goalById(e.goalId)?.name || "a goal"}`;
    return `Starting balance · ${accountName(e.accountId)}`;
  }
  const KIND = { expense: "expense", income: "income", move: "transfer", correction: "update", goal: "goal", opening: "start" };
  function entryAmount(e) {
    if (e.type === "expense") return { text: money(-e.amount), cls: "bad" };
    if (e.type === "income") return { text: money(e.amount, { sign: true }), cls: "good" };
    if (e.type === "move") return { text: `↔ ${money(e.amount)}`, cls: "" };
    if (e.type === "correction") return { text: money(e.amount, { sign: true }), cls: "" };
    if (e.type === "goal") return { text: money(Math.abs(e.amount)), cls: "" };
    return { text: money(e.amount), cls: "" };
  }
  function entryMeta(e) {
    const where = e.type === "expense" && e.legacy && !e.accountId ? "Before balances were tracked" : e.type === "move" || e.type === "goal" ? "" : accountName(e.accountId);
    return [dayLabel(e.date), where, e.note].filter(Boolean).join(" · ");
  }
  function txLine(e) {
    const a = entryAmount(e),
      title = entryTitle(e);
    return `<div class="tx"><div class="tx-main"><div class="tx-title">${esc(title)}</div><div class="tx-meta">${esc(entryMeta(e))}</div></div><div class="right"><div class="amount ${a.cls}">${a.text}</div><span class="tag">${KIND[e.type]}</span></div>${
      e.type === "opening" ? "<span></span>" : `<button class="row-menu" type="button" data-action="row-actions" data-id="${e.id}" aria-label="Options for ${esc(title)}">⋯</button>`
    }</div>`;
  }
  function miniRow(e) {
    const a = entryAmount(e);
    return `<div class="mini-activity-row"><div style="min-width:0"><strong>${esc(entryTitle(e))}</strong><div class="sub">${esc(entryMeta(e))}</div></div><span class="amount ${a.cls}">${a.text}</span></div>`;
  }
  const byNewest = (a, b) => b.date.localeCompare(a.date) || num(b.createdAt) - num(a.createdAt);

  // ---------- shell ----------
  function render() {
    applyTheme(state.meta.theme);
    if (!state.setupDone) return shell(setupView());
    const views = { home: homeView, budget: budgetView, activity: activityView, goals: goalsView };
    shell((views[tab] || homeView)());
  }
  function shell(content) {
    const ready = state.setupDone;
    root.innerHTML = `<main class="shell">
      <header class="topbar"><div class="brand"><h1>Budget Tracker</h1><p>Spend with a plan. Save with purpose.</p></div>${
        ready
          ? `<div class="topbar-actions"><button class="btn ghost small privacy-btn" type="button" data-action="privacy-toggle" aria-label="${hidden() ? "Show" : "Hide"} balances" aria-pressed="${hidden()}">${icon(hidden() ? "eyeOff" : "eye")}<span>${hidden() ? "Show" : "Hide"}</span></button><button class="btn ghost small settings-btn" type="button" data-action="settings" aria-label="Settings">${icon("settings")}<span>Settings</span></button></div>`
          : ""
      }</header>
      ${saveFailed ? `<div class="notice danger-notice" role="alert"><strong>Couldn't save on this phone.</strong><br>Your last change may be lost if you close the app. Export a backup from Settings.</div>` : ""}
      ${content}
    </main>${ready ? nav() : ""}${modal ? renderModal() : ""}`;
    linkFieldLabels();
    modalDirty = false;
  }
  function nav() {
    const items = [
      ["home", "home", "Home"],
      ["budget", "budget", "Budget"],
      ["activity", "activity", "Activity"],
      ["goals", "goals", "Goals"],
    ];
    return `<nav class="tabs" aria-label="Sections"><div class="tabs-inner four">${items
      .map(([id, ic, label]) => `<button class="tab ${tab === id ? "active" : ""}" type="button" data-tab="${id}" aria-label="${label}" ${tab === id ? 'aria-current="page"' : ""}><span class="tab-icon">${icon(ic)}</span><span class="tab-label">${label}</span></button>`)
      .join("")}</div></nav>`;
  }
  // Connect each form label to its field so screen readers announce what the field is for.
  function linkFieldLabels() {
    let n = 0;
    root.querySelectorAll(".field").forEach((f) => {
      const label = f.querySelector(":scope > label"),
        control = f.querySelector("input:not([type=hidden]), select, textarea");
      if (!label || !control || label.htmlFor) return;
      if (!control.id) control.id = `field-${++n}`;
      label.htmlFor = control.id;
    });
  }

  // ---------- Home ----------
  function welcomeCard() {
    const w = state.meta.welcome;
    if (!w) return "";
    if (w === "fresh") {
      const kept = state.entries.some((e) => e.legacy);
      return `<section class="card welcome-card" style="margin-top:14px"><div class="metric-label">Fresh start</div><strong>Budget Tracker has a new look and a fresh start</strong><div class="sub" style="margin-top:4px">Your balances start from what you entered today.${kept ? " Expenses from the previous version are still in Activity and Budget; they don't change your balance." : ""} New: <strong>Goals</strong>. Set money aside for something and Home shows what's really available to spend.</div><div class="actions" style="margin-top:12px"><button class="btn secondary" type="button" data-action="dismiss-welcome">Got it</button></div></section>`;
    }
    const text =
      w === "v8"
        ? `Your previous balance is now your ${esc(bankName())} balance. If part of it is cash, use <strong>Transfer</strong>. Past expenses are still in Activity and Budget. From now on, income and expenses update your balance automatically.`
        : `Your balances, entries and categories are exactly as they were. New: <strong>Goals</strong>. Set money aside for something and Home shows what's really available to spend.`;
    return `<section class="card welcome-card" style="margin-top:14px"><div class="metric-label">${w === "v8" ? "Welcome" : "What's new"}</div><strong>${w === "v8" ? "Welcome to the new Budget Tracker" : "Budget Tracker has a new look"}</strong><div class="sub" style="margin-top:4px">${text}</div><div class="actions" style="margin-top:12px"><button class="btn secondary" type="button" data-action="dismiss-welcome">Got it</button></div></section>`;
  }
  function backupReminder() {
    const m = state.meta,
      count = state.entries.filter((e) => e.type !== "opening").length;
    if (count < 5) return "";
    const days = m.lastBackupAt ? Math.floor((Date.now() - m.lastBackupAt) / 864e5) : null;
    if (days !== null && days < 14) return "";
    if (m.backupSnoozeUntil && m.backupSnoozeUntil > Date.now()) return "";
    return `<section class="card backup-reminder" style="margin-top:14px"><div class="metric-label">Backup</div><strong>${days === null ? "You haven't backed up yet" : `Last backup ${days} days ago`}</strong><div class="sub">Your records live only on this phone. Save a copy to Files or iCloud Drive.</div><div class="actions" style="margin-top:12px"><button class="btn" type="button" data-action="export-backup">Export Backup</button><button class="btn ghost" type="button" data-action="backup-snooze">Remind me later</button></div></section>`;
  }
  function balanceCard() {
    const b = balances(),
      aside = setAsideTotal(),
      avail = available();
    const accounts = state.accounts
      .map(
        (a) =>
          `<div class="row"><div><strong>${esc(a.name)}</strong><div class="sub">${a.id === "cash" ? "Cash on hand" : "Bank balance"}</div></div><div class="row-end"><span class="amount ${b[a.id] < 0 ? "bad" : ""}">${privateMoney(b[a.id])}</span><button class="row-menu" type="button" data-action="account-actions" data-id="${a.id}" aria-label="Options for ${esc(a.name)}">⋯</button></div></div>`,
      )
      .join("");
    const asideRow = aside
      ? `<div class="row"><div><strong>Set aside for goals</strong><div class="sub">Not for spending</div></div><div class="row-end"><span class="amount">−${privateMoney(aside)}</span><span class="row-menu-space"></span></div></div>`
      : "";
    return `<section class="card balance-card" style="margin-top:14px"><div class="metric-label">Available to spend</div><div class="metric ${avail < 0 ? "bad" : ""}">${privateMoney(avail)}</div><div class="sub">${
      avail < 0 ? "More is set aside for goals than you have. Take some out of a goal." : aside ? `Out of ${privateMoney(totalBalance())} in your accounts` : "Everything in your accounts"
    }</div><div class="balance-rows">${accounts}${asideRow}</div></section>`;
  }
  function homeView() {
    const st = monthStats(viewMonth),
      isNow = viewMonth === thisMonth();
    const flexLeft = round2(st.flexLimit - st.flexSpent);
    const caps = st.flexible.filter((x) => x.planned > 0).sort((a, b) => b.planned - a.planned);
    const paidCount = st.fixed.filter((x) => x.spent > 0 && x.planned - x.spent <= 0.5).length;
    const goal = activeGoals().find((g) => goalBal(g) < num(g.target)) || activeGoals()[0];
    const recent = monthEntries(viewMonth).sort(byNewest).slice(0, 3);
    const left = round2(st.moneyIn - st.spentTotal - st.saved);
    return `<div class="period-row">${periodSelector()}</div>
      ${welcomeCard()}${backupReminder()}${balanceCard()}
      ${sectionTitle("Quick add")}
      <div class="quick-action-grid four"><button class="quick-action" type="button" data-action="add-expense">${icon("expense")}<span>Expense</span></button><button class="quick-action" type="button" data-action="add-income">${icon("income")}<span>Income</span></button><button class="quick-action" type="button" data-action="add-transfer">${icon("transfer")}<span>Transfer</span></button><button class="quick-action" type="button" data-action="goal-add">${icon("save")}<span>Save</span></button></div>
      ${sectionTitle(isNow ? "This month" : monthLabel(viewMonth))}
      <section class="card flow-card">${row("Income", privateMoney(st.moneyIn), st.moneyIn ? "good" : "")}${row("Spent", money(st.spentTotal))}${row("Set aside for goals", privateMoney(st.saved))}${
        st.moneyIn ? row(left >= 0 ? "Left from income" : "Spent more than came in", privateMoney(Math.abs(left)), left < 0 ? "bad" : "") : ""
      }</section>
      ${sectionTitle("Flexible budget", st.flexLimit ? (flexLeft >= 0 ? `${money(flexLeft)} left of ${money(st.flexLimit)}` : `${money(-flexLeft)} over your limits`) : "")}
      ${caps.length ? `<section class="card">${caps.map(budgetMini).join("")}</section>` : emptyCard("No spending limits yet.", "Give everyday spending like food a monthly limit to see what's left.", `<button class="btn secondary small" type="button" data-action="manage-categories">Set limits</button>`)}
      ${sectionTitle("Bills", st.fixed.length ? `${paidCount} of ${st.fixed.length} paid` : "")}
      ${st.fixed.length ? `<section class="card obligation-list">${st.fixed.map((x) => obligationRow(x, isNow && !x.item.archived)).join("")}</section>` : emptyCard("No monthly bills yet.", "Add what you pay every month, like your phone or transport pass.", `<button class="btn secondary small" type="button" data-action="manage-categories">Add bills</button>`)}
      ${sectionTitle("Goal")}
      ${goal ? goalMini(goal) : emptyCard("Save for something.", "Set money aside for a trip, a phone or an emergency fund. It stays in your account but isn't counted as spending money.", `<button class="btn secondary small" type="button" data-action="new-goal">New Goal</button>`)}
      ${sectionTitle("Recent", "", recent.length ? `<button class="text-btn" type="button" data-tab="activity">See all</button>` : "")}
      <section class="card mini-activity">${recent.length ? recent.map(miniRow).join("") : `<div class="empty compact-empty"><strong>Nothing recorded ${isNow ? "this month yet" : "in this month"}.</strong><span>Use Quick add above.</span></div>`}</section>`;
  }
  function goalMini(g) {
    const bal = goalBal(g),
      target = num(g.target),
      r = target ? bal / target : 0;
    return `<section class="card goal-mini"><div class="split"><div><strong>${esc(g.name)}</strong><div class="sub">${privateMoney(bal)} of ${money(target)}</div></div><span class="tag ${bal >= target ? "good-tag" : ""}">${pct(Math.min(1, r))}</span></div>${progress(r)}<div class="actions"><button class="btn secondary small" type="button" data-action="goal-add" data-id="${g.id}">Add Money</button><button class="btn ghost small" type="button" data-tab="goals">All goals</button></div></section>`;
  }

  // ---------- Budget ----------
  function budgetKpi(label, value, sub, bad = false) {
    return `<section class="card budget-kpi"><div class="metric-label">${label}</div><div class="kpi-value ${bad ? "bad" : ""}">${value}</div><div class="sub">${sub}</div></section>`;
  }
  function budgetCategoryRow(x) {
    const limit = x.planned,
      remaining = round2(limit - x.spent),
      ratio = limit ? x.spent / limit : 0;
    return `<div class="budget-category"><div class="split"><div><strong>${esc(x.item.name)}</strong><div class="sub">${limit ? (remaining >= 0 ? `${money(remaining)} left` : `${money(-remaining)} over`) : "No limit set"}${x.item.archived ? " · archived" : ""}</div></div><div class="budget-numbers"><strong class="${remaining < 0 && limit ? "bad" : ""}">${limit ? `${money(x.spent)} / ${money(limit)}` : money(x.spent)}</strong><span>${limit ? pct(ratio) : "spent"}</span></div></div>${limit ? progress(ratio, remaining < 0) : ""}</div>`;
  }
  function budgetView() {
    const st = monthStats(viewMonth),
      isNow = viewMonth === thisMonth();
    const flexOver = st.flexSpent > st.flexLimit && st.flexLimit > 0;
    const planned = round2(st.fixedPlanned + st.flexLimit + st.goalPlanned);
    const unplanned = round2(st.moneyIn - planned);
    return `<div class="budget-head"><div><h2 style="margin:0">Budget</h2><div class="sub">Plan vs actual for the month</div></div>${periodSelector()}</div>
      <div class="budget-overview" style="margin-top:14px">
        ${budgetKpi("Income", privateMoney(st.moneyIn), "Recorded this month")}
        ${budgetKpi("Bills", `${money(st.fixedPaid)} / ${money(st.fixedPlanned)}`, st.fixedPaid >= st.fixedPlanned ? "All paid" : `${money(st.fixedPlanned - st.fixedPaid)} to pay`)}
        ${budgetKpi("Flexible", `${money(st.flexSpent)} / ${money(st.flexLimit)}`, flexOver ? `${money(st.flexSpent - st.flexLimit)} over` : `${money(Math.max(0, st.flexLimit - st.flexSpent))} left`, flexOver)}
        ${budgetKpi("Goals", `${privateMoney(st.saved)} / ${money(st.goalPlanned)}`, "Set aside this month")}
      </div>
      ${sectionTitle("Monthly plan", "Where this month's income is going")}
      <section class="card flow-card">${row("Income", privateMoney(st.moneyIn))}${row("Monthly bills", money(st.fixedPlanned))}${row("Everyday spending limits", money(st.flexLimit))}${row("Goal savings", money(st.goalPlanned))}${
        st.moneyIn ? row(unplanned >= 0 ? "Not planned yet" : "Planned more than income", privateMoney(Math.abs(unplanned)), unplanned < 0 ? "bad" : "good") : `<div class="sub" style="padding-top:8px">Add this month's income to see how much is left unplanned.</div>`
      }</section>
      ${sectionTitle("Monthly bills", st.fixed.length ? `${st.fixed.filter((x) => x.spent > 0 && x.planned - x.spent <= 0.5).length} of ${st.fixed.length} paid` : "")}
      ${st.fixed.length ? `<section class="card obligation-list">${st.fixed.map((x) => obligationRow(x, isNow && !x.item.archived)).join("")}</section>` : emptyCard("No monthly bills yet.", "Add what you pay every month in Categories below.")}
      ${sectionTitle("Everyday spending")}
      <section class="card budget-category-list">${st.flexible.map(budgetCategoryRow).join("")}</section>
      ${sectionTitle("Categories")}
      <section class="card"><div class="row"><div><strong>Bills and spending limits</strong><div class="sub">Add, rename, change amounts or archive</div></div><button class="btn ghost small" type="button" data-action="manage-categories">Manage</button></div></section>`;
  }

  // ---------- Activity ----------
  function activityView() {
    const q = activitySearch.trim().toLowerCase();
    const pool = q ? state.entries : monthEntries(viewMonth);
    const kinds = { expense: ["expense"], income: ["income"], move: ["move", "correction"], goal: ["goal"] };
    let list = pool.filter((e) => activityFilter === "all" || kinds[activityFilter]?.includes(e.type));
    if (q) list = list.filter((e) => [entryTitle(e), entryMeta(e), e.note].join(" ").toLowerCase().includes(q));
    list.sort(byNewest);
    return `<div><h2 style="margin:0">Activity</h2><div class="sub">Expenses, income, transfers and goal savings</div></div>
      <div class="period-row" style="margin-top:12px">${periodSelector()}</div>
      ${sectionTitle(q ? "Search results" : monthLabel(viewMonth), q ? `${list.length} found in all months` : `${list.length} shown`)}
      <form id="activity-search-form" class="activity-search"><input id="activity-search-input" type="search" value="${esc(activitySearch)}" placeholder="Search category, note or account" aria-label="Search activity"><button class="btn ghost small" type="submit">Search</button>${activitySearch ? `<button class="btn ghost small" type="button" data-action="clear-search">Clear</button>` : ""}</form>
      <div class="filter-chips wrap">${[
        ["all", "All"],
        ["expense", "Expenses"],
        ["income", "Income"],
        ["move", "Transfers"],
        ["goal", "Goals"],
      ]
        .map(([id, label]) => `<button class="filter-chip ${activityFilter === id ? "active" : ""}" type="button" data-action="activity-filter" data-filter="${id}" aria-pressed="${activityFilter === id}">${label}</button>`)
        .join("")}</div>
      <section class="card activity-list">${list.length ? list.slice(0, 300).map(txLine).join("") : `<div class="empty compact-empty"><strong>No matching activity.</strong><span>${q ? "Try another search." : "Try another filter or month."}</span></div>`}</section>`;
  }

  // ---------- Goals ----------
  function goalCard(g) {
    const bal = goalBal(g),
      target = num(g.target),
      r = target ? bal / target : 0,
      reached = target > 0 && bal >= target;
    const status = reached ? ["Reached", "good-tag"] : bal > 0 ? ["Saving", "good-tag"] : ["Not started", ""];
    return `<section class="card goal-card"><div class="split"><div><strong>${esc(g.name)}</strong><div class="sub">${num(g.monthly) ? `Plan: ${money(g.monthly)} a month` : "Save at your own pace"}</div></div><span class="tag ${status[1]}">${status[0]}</span></div>
      <div class="goal-metric-row"><div><div class="metric">${privateMoney(bal)}</div><div class="sub">${reached ? "Target reached" : `${privateMoney(target - bal)} to go`}</div></div><div class="right"><strong>${pct(Math.min(1, r))}</strong><div class="sub">of ${money(target)}</div></div></div>
      ${progress(r)}<div class="goal-pace">${esc(goalPaceText(g))}</div>${g.targetDate ? `<div class="sub">Target date: ${esc(dayLabel(g.targetDate))}</div>` : ""}
      <div class="actions goal-actions"><button class="btn" type="button" data-action="goal-add" data-id="${g.id}">Add Money</button><button class="btn secondary" type="button" data-action="goal-take" data-id="${g.id}" ${bal > 0 ? "" : "disabled"}>Take Out</button><button class="btn ghost" type="button" data-action="goal-edit" data-id="${g.id}">Edit</button></div></section>`;
  }
  function goalsView() {
    const goals = activeGoals();
    return `<div><h2 style="margin:0">Goals</h2><div class="sub">Money set aside stays in your accounts but isn't counted as spending money.</div></div>
      <section class="card strategy-card" style="margin-top:14px"><div class="split"><div><div class="metric-label">Set aside</div><div class="metric">${privateMoney(setAsideTotal())}</div></div><div class="right"><strong class="amount">${privateMoney(available())}</strong><div class="sub">available to spend</div></div></div></section>
      ${goals.length ? `<div class="grid g2 goals-grid" style="margin-top:14px">${goals.map(goalCard).join("")}</div>` : `<section class="card hero-action" style="margin-top:14px"><div class="metric-label">Start a goal</div><div class="metric">Save for something</div><p class="sub">A trip home, a new phone or an emergency fund. Add money to it whenever you can, and Home shows what's left to spend.</p><button class="btn" type="button" data-action="new-goal">New Goal</button></section>`}
      ${goals.length ? `<button class="btn secondary" style="width:100%;margin-top:14px" type="button" data-action="new-goal">New Goal</button>` : ""}`;
  }

  // ---------- first launch ----------
  function setupView() {
    const fresh = !!state.meta.cleanPending;
    const head = (n, title, sub) =>
      `<div class="metric-label">${fresh ? `Fresh start · ${n - 1} of 2` : `Step ${n} of 3`}</div><h2 class="setup-title">${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ""}`;
    const kept = orderedItems().filter((i) => !i.builtIn && !i.archived).map((i) => i.name);
    const hasOld = state.entries.some((e) => e.legacy);
    const isNew = (n) => !state.items.some((i) => !i.archived && i.name.toLowerCase() === n.toLowerCase());
    let body = "";
    if (setupStep === 1)
      body = `${head(1, "Which currency do you use?", "Every amount is shown in it. You can change it later.")}<div class="field" style="margin-top:14px"><label>Currency</label><select id="setup-currency">${CURRENCIES.map(
        ([c, sym]) => `<option value="${c}" ${c === setupDraft.currency ? "selected" : ""}>${c} (${sym.trim()})</option>`,
      ).join("")}</select></div>`;
    if (setupStep === 2)
      body = `${head(2, fresh ? "Start fresh with today's balances" : "How much do you have right now?", fresh ? `Check your bank app and your wallet.${hasOld ? " Your expenses from the previous version are kept in Activity and Budget." : ""}` : "Check your bank app and your wallet. You can update these later.")}<div style="margin-top:14px"><div class="field"><label>Bank account name</label><input id="setup-bank-name" type="text" maxlength="30" value="${esc(setupDraft.bankName)}"></div><div class="form-grid"><div class="field"><label>Bank balance</label><input id="setup-bank" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="${esc(setupDraft.bank)}"></div><div class="field"><label>Cash on hand</label><input id="setup-cash" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="${esc(setupDraft.cash)}"></div></div></div>`;
    if (setupStep === 3)
      body = `${head(3, fresh ? "Anything to add?" : "What do you spend on?", fresh && kept.length ? `Your categories are kept: ${esc(kept.join(", "))}. Tap any you'd like to add.` : "Tap what applies to you. You can add your own and set amounts later in Budget.")}${["fixed", "flexible"]
        .map(
          (g) =>
            !SUGGESTIONS[g].some(isNew) && g === "fixed"
              ? ""
              : `<div class="setup-group"><div class="metric-label">${GROUP_LABEL[g]}${g === "fixed" ? " · the same every month" : ""}</div><div class="filter-chips wrap">${SUGGESTIONS[g]
              .filter(isNew)
              .map((n) => `<button type="button" class="filter-chip ${setupDraft.picks.has(n) ? "active" : ""}" data-action="setup-pick" data-name="${esc(n)}" aria-pressed="${setupDraft.picks.has(n)}">${esc(n)}</button>`)
              .join("")}${g === "flexible" ? `<span class="filter-chip locked">Others ✓</span>` : ""}</div></div>`,
        )
        .join("")}`;
    return `<section class="card setup-card">${body}<div class="actions setup-actions">${setupStep > (fresh ? 2 : 1) ? `<button class="btn ghost" type="button" data-action="setup-back">Back</button>` : ""}<button class="btn" type="button" data-action="setup-next">${setupStep < 3 ? "Next" : "Start"}</button></div></section>
      ${setupStep === 1 && !fresh ? `<p class="sub center" style="margin-top:16px">Have a backup? <label class="text-btn file-link">Restore it<input id="setup-restore" type="file" accept="application/json,.json" hidden></label></p>` : ""}`;
  }
  function readSetup() {
    if ($("setup-currency")) setupDraft.currency = $("setup-currency").value;
    if ($("setup-cash")) setupDraft.cash = $("setup-cash").value;
    if ($("setup-bank")) setupDraft.bank = $("setup-bank").value;
    if ($("setup-bank-name")) setupDraft.bankName = $("setup-bank-name").value.trim() || "Bank Account";
  }
  function finishSetup() {
    const today = todayISO();
    state.currency = setupDraft.currency;
    accountById("bank").name = setupDraft.bankName;
    [["bank", setupDraft.bank], ["cash", setupDraft.cash]].forEach(([id, v]) =>
      state.entries.push({ id: uid("open"), type: "opening", amount: round2(Math.max(0, num(v))), date: today, accountId: id, note: "Starting balance", createdAt: Date.now() }),
    );
    ["fixed", "flexible"].forEach((g) =>
      SUGGESTIONS[g]
        .filter((n) => setupDraft.picks.has(n) && !state.items.some((i) => !i.archived && i.name.toLowerCase() === n.toLowerCase()))
        .forEach((name) => state.items.push({ id: uid("item"), name, group: g, amounts: [], archived: false, createdAt: Date.now() })),
    );
    state.meta.lastAccountId = num(setupDraft.bank) > 0 || !num(setupDraft.cash) ? "bank" : "cash";
    state.meta.cleanStart = CLEAN_START;
    delete state.meta.cleanPending;
    state.setupDone = true;
    save();
    tab = "home";
    viewMonth = thisMonth();
    render();
  }

  // ---------- pop-up forms ----------
  function modalWrap(title, body) {
    return `<div class="modal-backdrop" data-backdrop="1"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="split"><h3>${esc(title)}</h3><button class="btn ghost small" type="button" data-action="close-modal">Close</button></div>${body}</section></div>`;
  }
  function renderModal() {
    const m = modal;
    const entry = m.id ? state.entries.find((e) => e.id === m.id) : null;
    if (m.type === "expense") return modalWrap(entry ? "Edit Expense" : "Add Expense", expenseForm(entry, m.prefill));
    if (m.type === "income") return modalWrap(entry ? "Edit Income" : "Add Income", incomeForm(entry));
    if (m.type === "transfer") return modalWrap(entry ? "Edit Transfer" : "Transfer", transferForm(entry, m.prefill));
    if (m.type === "goal-money") return modalWrap(m.mode === "take" ? "Take Out of a Goal" : "Set Money Aside", goalMoneyForm(m.mode, m.goalId, entry));
    if (m.type === "goal-form") return modalWrap(m.goalId ? "Edit Goal" : "New Goal", goalForm(goalById(m.goalId)));
    if (m.type === "row-actions") return modalWrap(entry ? entryTitle(entry) : "Entry", rowActionsView(entry));
    if (m.type === "account-actions") return modalWrap(accountName(m.accountId), accountActionsView(m.accountId));
    if (m.type === "update-balance") return modalWrap(`Update ${accountName(m.accountId)} Balance`, updateBalanceForm(m.accountId));
    if (m.type === "rename-account") return modalWrap("Rename Account", renameForm(m.accountId));
    if (m.type === "settings") return modalWrap("Settings", settingsView());
    if (m.type === "manage-categories") return modalWrap("Bills and Spending Limits", manageCategoriesView());
    if (m.type === "category-form") return modalWrap(m.id ? "Edit Category" : "Add Category", categoryForm(m.id ? itemById(m.id) : null, m.prefill));
    return "";
  }
  const amountField = (label, value, extra = "") =>
    `<div class="field"><label>${label}</label><input name="amount" type="number" inputmode="decimal" min="0" step="any" value="${value === "" || value == null ? "" : esc(value)}" placeholder="0" required ${extra}></div>`;
  const accountOptions = (cur) => state.accounts.map((a) => `<option value="${a.id}" ${a.id === cur ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  const defaultDate = () => (viewMonth === thisMonth() ? todayISO() : `${viewMonth}-${String(daysInMonth(viewMonth)).padStart(2, "0")}`);
  const dateField = (label, value) => `<div class="field"><label>${label}</label><input name="date" type="date" value="${esc(value)}" max="${todayISO()}" required></div>`;
  const formError = `<p class="form-error" id="form-error" role="alert"></p>`;
  function categoryOptions(cur) {
    const opt = (i) => `<option value="${i.id}" ${i.id === cur ? "selected" : ""}>${esc(i.name)}</option>`;
    const list = orderedItems().filter((i) => !i.archived || i.id === cur);
    return ["flexible", "fixed"]
      .map((g) => {
        const xs = list.filter((i) => i.group === g);
        return xs.length ? `<optgroup label="${GROUP_LABEL[g]}">${xs.map(opt).join("")}</optgroup>` : "";
      })
      .join("");
  }
  function expenseForm(x, prefill = {}) {
    const p = prefill || {};
    const lastItem = itemById(state.meta.lastItemId);
    const cur = x?.itemId || p.itemId || (lastItem && !lastItem.archived ? lastItem.id : orderedItems().find((i) => !i.archived)?.id);
    const legacy = x && x.legacy && !x.accountId;
    return `<form id="expense-form" novalidate data-id="${x?.id || ""}">${amountField("Amount", x?.amount ?? p.amount, x ? "" : "data-autofocus")}
      <div class="field"><label>Category</label><select name="item">${categoryOptions(cur)}</select></div>
      <div class="form-grid">${dateField("Date", x?.date || p.date || defaultDate())}${
        legacy
          ? `<div class="field"><label>Paid from</label><input type="text" value="Not tracked" disabled></div>`
          : `<div class="field"><label>Paid from</label><select name="account">${accountOptions(x?.accountId || p.accountId || state.meta.lastAccountId)}</select></div>`
      }</div>
      ${legacy ? `<div class="sub" style="margin-bottom:10px">Recorded before balances were tracked, so it doesn't change a balance.</div>` : ""}
      <div class="field"><label>Note (optional)</label><input name="note" maxlength="80" value="${esc(x?.note ?? p.note ?? "")}" placeholder="Lunch, groceries, top-up…"></div>
      ${formError}<button class="btn" style="width:100%" type="submit">${x ? "Save Changes" : "Save Expense"}</button></form>`;
  }
  function incomeForm(x) {
    const type = x?.incomeType || "salary";
    return `<form id="income-form" novalidate data-id="${x?.id || ""}">${amountField("Amount", x?.amount, x ? "" : "data-autofocus")}
      <div class="field"><label>Income type</label><select name="incomeType">${INCOME_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="form-grid">${dateField("Date received", x?.date || defaultDate())}<div class="field"><label>Into</label><select name="account">${accountOptions(x?.accountId || "bank")}</select></div></div>
      <div class="field"><label>Note (optional)</label><input name="note" maxlength="80" value="${esc(x?.note || "")}" placeholder="October stipend, birthday gift…"></div>
      ${formError}<button class="btn" style="width:100%" type="submit">${x ? "Save Changes" : "Save Income"}</button></form>`;
  }
  function transferForm(x, prefill = {}) {
    const p = prefill || {};
    const from = x?.accountId || p.from || "bank",
      to = x?.toAccountId || p.to || (from === "bank" ? "cash" : "bank");
    return `<form id="transfer-form" novalidate data-id="${x?.id || ""}"><div class="notice" style="margin-bottom:14px">Moving money between your accounts, like an ATM withdrawal, isn't spending or income.</div>${amountField("Amount", x?.amount, x ? "" : "data-autofocus")}
      <div class="form-grid"><div class="field"><label>From</label><select name="from">${accountOptions(from)}</select></div><div class="field"><label>To</label><select name="to">${accountOptions(to)}</select></div></div>
      ${dateField("Date", x?.date || defaultDate())}
      <div class="field"><label>Note (optional)</label><input name="note" maxlength="80" value="${esc(x?.note || "")}" placeholder="ATM withdrawal"></div>
      ${formError}<button class="btn" style="width:100%" type="submit">${x ? "Save Changes" : "Save Transfer"}</button></form>`;
  }
  function goalMoneyForm(mode, goalId, x) {
    const goals = activeGoals();
    if (!goals.length) return `<div class="empty compact-empty"><strong>No goals yet.</strong><span>Create a goal first, then set money aside for it.</span><button class="btn" type="button" data-action="new-goal">New Goal</button></div>`;
    const take = mode === "take",
      g = goalById(goalId) || goals.find((y) => goalBal(y) < num(y.target)) || goals[0];
    const amount = x ? Math.abs(num(x.amount)) : "";
    const info = take
      ? `This puts money back into what's available to spend. ${esc(g.name)} has ${privateMoney(goalBal(g))}.`
      : `The money stays in your accounts; no bank transfer is needed. Available to spend: <strong>${privateMoney(available() + (x ? amount : 0))}</strong>.`;
    return `<form id="goal-money-form" novalidate data-id="${x?.id || ""}" data-mode="${take ? "take" : "add"}"><div class="notice" style="margin-bottom:14px">${info}</div>
      <div class="field"><label>Goal</label><select name="goal">${goals.map((y) => `<option value="${y.id}" ${y.id === g.id ? "selected" : ""}>${esc(y.name)}</option>`).join("")}</select></div>
      ${amountField("Amount", amount, x ? "" : "data-autofocus")}${dateField("Date", x?.date || defaultDate())}
      ${formError}<button class="btn" style="width:100%" type="submit">${x ? "Save Changes" : take ? "Take Out" : "Set Aside"}</button></form>`;
  }
  function goalForm(g) {
    const canDelete = g && goalBal(g) === 0;
    return `<form id="goal-form" novalidate data-id="${g?.id || ""}"><div class="field"><label>Name</label><input name="name" maxlength="40" required value="${esc(g?.name || "")}" placeholder="Trip home, new phone, emergency fund…" ${g ? "" : "data-autofocus"}></div>
      <div class="form-grid"><div class="field"><label>Target amount</label><input name="target" type="number" inputmode="decimal" min="1" step="any" required value="${g ? esc(g.target) : ""}"></div><div class="field"><label>Target date (optional)</label><input name="targetDate" type="date" min="${todayISO()}" value="${esc(g?.targetDate || "")}"></div></div>
      <div class="field"><label>Plan to save each month (optional)</label><input name="monthly" type="number" inputmode="decimal" min="0" step="any" value="${g && num(g.monthly) ? esc(g.monthly) : ""}" placeholder="0"></div>
      <div class="sub" style="margin-bottom:12px">The monthly amount is counted in your Budget plan.</div>
      ${formError}<button class="btn" style="width:100%" type="submit">${g ? "Save Goal" : "Create Goal"}</button>
      ${g ? `<div class="action-sheet-danger" style="margin-top:14px">${canDelete ? `<button class="btn ghost" style="width:100%" type="button" data-action="goal-delete" data-id="${g.id}">Delete Goal</button>` : `<div class="sub">To delete this goal, take its money out first.</div>`}</div>` : ""}</form>`;
  }
  function rowActionsView(e) {
    if (!e) return `<div class="empty compact-empty"><strong>This entry no longer exists.</strong></div>`;
    const a = entryAmount(e);
    const btn = (action, label, cls = "secondary") => `<button class="btn ${cls}" type="button" data-action="${action}" data-id="${e.id}">${label}</button>`;
    const label = { expense: "expense", income: "income", move: "transfer", correction: "balance update", goal: "entry" }[e.type];
    return `<div class="sub" style="margin-bottom:12px">${esc([dayLabel(e.date), a.text, e.note].filter(Boolean).join(" · "))}</div><div class="action-sheet">${[
      e.type === "expense" && btn("repeat-expense", "Repeat expense"),
      e.type !== "correction" && btn("edit-entry", "Edit"),
    ]
      .filter(Boolean)
      .join("")}<div class="action-sheet-danger">${btn("delete-entry", `Delete ${label}`, "ghost")}</div></div>`;
  }
  function accountActionsView(id) {
    const b = balances()[id];
    const isCash = id === "cash";
    return `<div class="sub" style="margin-bottom:12px">${isCash ? "Cash on hand" : "Bank balance"}: ${privateMoney(b)}</div><div class="action-sheet">
      <button class="btn secondary" type="button" data-action="update-balance" data-id="${id}">${isCash ? "Count cash" : "Update balance"}</button>
      <button class="btn secondary" type="button" data-action="add-transfer" data-from="${isCash ? "cash" : "bank"}">${isCash ? `Put cash into ${esc(bankName())}` : "Withdraw cash"}</button>
      <button class="btn ghost" type="button" data-action="rename-account" data-id="${id}">Rename</button></div>`;
  }
  function updateBalanceForm(id) {
    const tracked = balances()[id],
      isCash = id === "cash";
    return `<form id="balance-form" novalidate data-account="${id}"><div class="notice" style="margin-bottom:14px">${isCash ? "Count the cash you actually have." : `Enter the exact balance shown in your ${esc(accountName(id))} app.`} The difference is recorded as a balance update, so nothing changes silently.</div>
      <div class="field"><label>${isCash ? "Cash you have now" : "Balance in your bank app"}</label><input name="actual" type="number" inputmode="decimal" step="any" value="${tracked}" required data-autofocus></div>
      <div class="form-grid"><div class="field"><label>Tracked here</label><input type="text" value="${money(tracked)}" disabled></div><div class="field"><label>Difference</label><input id="balance-diff" type="text" value="${money(0)}" disabled></div></div>
      ${formError}<button class="btn" style="width:100%" type="submit">Save Balance</button></form>`;
  }
  function renameForm(id) {
    return `<form id="rename-form" novalidate data-account="${id}"><div class="field"><label>Name</label><input name="name" maxlength="30" required value="${esc(accountName(id))}" data-autofocus></div>${formError}<button class="btn" style="width:100%" type="submit">Save</button></form>`;
  }
  function manageCategoriesView() {
    const items = orderedItems();
    const rowFor = (i) =>
      `<div class="row"><div><strong>${esc(i.name)}</strong><div class="sub">${i.group === "fixed" ? `${itemAmount(i, thisMonth()) ? money(itemAmount(i, thisMonth())) : "No amount"} each month` : itemAmount(i, thisMonth()) ? `Limit ${money(itemAmount(i, thisMonth()))} a month` : "No limit"}${i.builtIn ? " · always there" : ""}</div></div><button class="btn ghost small" type="button" data-action="edit-category" data-id="${i.id}">Edit</button></div>`;
    const group = (title, list) => (list.length ? `${sectionTitle(title)}<section class="card">${list.map(rowFor).join("")}</section>` : "");
    const suggestions = ["fixed", "flexible"].flatMap((g) => SUGGESTIONS[g].filter((n) => !items.some((i) => !i.archived && i.name.toLowerCase() === n.toLowerCase())).map((n) => [g, n]));
    return `<div class="notice">Changing an amount applies from this month. Earlier months keep theirs.</div>
      <button class="btn" style="width:100%;margin-top:12px" type="button" data-action="new-category">Add Category</button>
      ${suggestions.length ? `${sectionTitle("Suggestions", "Tap to add")}<div class="filter-chips wrap">${suggestions.map(([g, n]) => `<button class="filter-chip" type="button" data-action="suggest-category" data-group="${g}" data-name="${esc(n)}">+ ${esc(n)}</button>`).join("")}</div>` : ""}
      ${group("Monthly bills", items.filter((i) => !i.archived && i.group === "fixed"))}${group("Everyday spending", items.filter((i) => !i.archived && i.group === "flexible"))}${group("Archived", items.filter((i) => i.archived))}
      ${modal.from === "settings" ? `<button class="btn ghost" style="width:100%;margin-top:14px" type="button" data-action="settings">Back to Settings</button>` : ""}`;
  }
  function categoryForm(c, prefill = {}) {
    const p = prefill || {};
    const used = c ? state.entries.some((e) => e.itemId === c.id) : false;
    const group = c?.group || p.group || "flexible";
    const amount = c ? itemAmount(c, thisMonth()) : "";
    return `<form id="category-form" novalidate data-id="${c?.id || ""}"><div class="field"><label>Name</label><input name="name" required maxlength="40" value="${esc(c?.name || p.name || "")}" placeholder="e.g. Phone, Food, Gym" ${c?.builtIn ? "readonly" : ""} ${c || p.name ? "" : "data-autofocus"}></div>
      <div class="form-grid">${
        c?.builtIn
          ? `<div class="field"><label>Type</label><input type="text" value="Everyday spending" disabled></div>`
          : `<div class="field"><label>Type</label><select name="group"><option value="fixed" ${group === "fixed" ? "selected" : ""}>Monthly bill</option><option value="flexible" ${group === "flexible" ? "selected" : ""}>Everyday spending</option></select></div>`
      }<div class="field"><label>Amount each month</label><input name="amount" type="number" inputmode="decimal" min="0" step="any" value="${amount || ""}" placeholder="0" ${p.name ? "data-autofocus" : ""}></div></div>
      <div class="sub" style="margin-bottom:10px">Monthly bill: the same each month, like a phone plan or transport pass. Everyday spending: a limit for things like food.</div>
      ${c && !c.builtIn ? `<label class="check-line"><input type="checkbox" name="archived" ${c.archived ? "checked" : ""}> Archived (hidden from new expenses${used ? "; past expenses keep it" : ""})</label>` : ""}
      ${formError}<button class="btn" style="width:100%;margin-top:6px" type="submit">${c ? "Save Category" : "Add Category"}</button>
      ${c && !c.builtIn && !used ? `<button class="btn ghost danger-text" style="width:100%;margin-top:8px" type="button" data-action="delete-category" data-id="${c.id}">Delete Category</button>` : ""}
      <button class="btn ghost" style="width:100%;margin-top:8px" type="button" data-action="manage-categories">Back</button></form>`;
  }
  function settingsView() {
    const m = state.meta,
      b = balances();
    const lastBackup = m.lastBackupAt ? new Date(m.lastBackupAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Never";
    const old = previousVersionKeys();
    return `<section class="card appearance-card"><div class="metric-label">Appearance</div><strong>Theme</strong><div class="sub">System follows your phone's light or dark setting.</div><div class="theme-switch" role="group" aria-label="Theme">${[
      ["system", "System"],
      ["light", "Light"],
      ["dark", "Dark"],
    ]
      .map(([v, l]) => `<button type="button" class="theme-option ${m.theme === v ? "active" : ""}" data-action="set-theme" data-theme="${v}" aria-pressed="${m.theme === v}">${l}</button>`)
      .join("")}</div></section>
      ${sectionTitle("Accounts", "Rename, update a balance or withdraw cash")}
      <section class="card">${state.accounts
        .map((a) => `<div class="row"><div><strong>${esc(a.name)}</strong><div class="sub">${privateMoney(b[a.id])}</div></div><button class="btn ghost small" type="button" data-action="account-actions" data-id="${a.id}">Options</button></div>`)
        .join("")}</section>
      ${sectionTitle("Budget")}
      <section class="card"><div class="row"><div><strong>Bills and spending limits</strong><div class="sub">Add, rename or archive categories</div></div><button class="btn ghost small" type="button" data-action="manage-categories" data-from="settings">Manage</button></div>
        <div class="field" style="margin:12px 0 0"><label>Currency</label><select id="currency-select">${CURRENCIES.map(([c, sym]) => `<option value="${c}" ${c === state.currency ? "selected" : ""}>${c} (${sym.trim()})</option>`).join("")}</select></div><div class="sub" style="margin-top:6px">Changes the symbol only; amounts are not converted.</div></section>
      ${sectionTitle("Backup", "Your records live only on this phone")}
      <section class="card app-info-card">${row("Last backup", esc(lastBackup))}<div class="actions settings-export-actions" style="margin-top:12px"><button class="btn secondary" type="button" data-action="export-backup">Export Backup</button><label class="btn secondary">Restore Backup<input id="restore-file" type="file" accept="application/json,.json" hidden></label><button class="btn ghost" type="button" data-action="export-csv">Activity CSV</button></div></section>
      ${
        old.length
          ? `${sectionTitle("Previous version's data")}<section class="card"><div class="sub">A copy of the data from the previous version${m.legacySpecialCount ? `, including ${m.legacySpecialCount} Special Budget${m.legacySpecialCount > 1 ? "s" : ""}` : ""}, is still on this phone. Download it if you want to keep it, then remove it.</div><div class="actions" style="margin-top:12px"><button class="btn secondary" type="button" data-action="legacy-download">Download</button><button class="btn ghost" type="button" data-action="legacy-remove">Remove</button></div></section>`
          : ""
      }
      ${sectionTitle("About")}
      <section class="card"><div class="split"><div><strong>Budget Tracker v${APP_VERSION}</strong><div class="sub">Works offline · no account needed</div></div><span class="tag good-tag">On this phone</span></div></section>
      <section class="card danger-zone" style="margin-top:14px"><div class="split"><div><strong>Start over</strong><div class="sub">Deletes everything on this phone. Export a backup first.</div></div><button class="btn danger small" type="button" data-action="reset">Start over</button></div></section>`;
  }

  // ---------- saving forms ----------
  function fail(msg, field) {
    const err = $("form-error");
    if (err) err.textContent = msg;
    if (field) root.querySelector(`.modal [name="${field}"]`)?.focus();
    return false;
  }
  const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= todayISO();
  function upsertEntry(id, data) {
    const existing = id ? state.entries.find((e) => e.id === id) : null;
    if (existing) Object.assign(existing, data);
    else state.entries.push({ id: uid(data.type), createdAt: Date.now(), ...data });
    return existing ? null : state.entries.at(-1);
  }
  function finishEntry(added, date, message) {
    save();
    modal = null;
    const mk = monthOf(date);
    if (mk !== viewMonth && mk <= thisMonth()) viewMonth = mk;
    render();
    showToast(message, added ? { kind: "add", id: added.id } : null);
  }
  function saveExpense(f) {
    const fd = new FormData(f),
      amount = round2(fd.get("amount")),
      date = String(fd.get("date") || ""),
      itemId = String(fd.get("item") || "");
    if (!(amount > 0)) return fail("Enter an amount above zero.", "amount");
    if (!validDate(date)) return fail("Choose a date that isn't in the future.", "date");
    if (!itemById(itemId)) return fail("Choose a category.", "item");
    const data = { type: "expense", amount, date, itemId, note: String(fd.get("note") || "").trim() };
    if (fd.has("account")) data.accountId = String(fd.get("account"));
    const added = upsertEntry(f.dataset.id, data);
    if (data.accountId) state.meta.lastAccountId = data.accountId;
    state.meta.lastItemId = itemId;
    finishEntry(added, date, added ? `${itemById(itemId).name} ${money(-amount)} added.` : "Saved.");
  }
  function saveIncome(f) {
    const fd = new FormData(f),
      amount = round2(fd.get("amount")),
      date = String(fd.get("date") || "");
    if (!(amount > 0)) return fail("Enter an amount above zero.", "amount");
    if (!validDate(date)) return fail("Choose a date that isn't in the future.", "date");
    const added = upsertEntry(f.dataset.id, { type: "income", amount, date, incomeType: String(fd.get("incomeType")), accountId: String(fd.get("account")), note: String(fd.get("note") || "").trim() });
    finishEntry(added, date, added ? `Income ${money(amount, { sign: true })} added.` : "Saved.");
  }
  function saveTransfer(f) {
    const fd = new FormData(f),
      amount = round2(fd.get("amount")),
      date = String(fd.get("date") || ""),
      from = String(fd.get("from")),
      to = String(fd.get("to"));
    if (!(amount > 0)) return fail("Enter an amount above zero.", "amount");
    if (from === to) return fail("Choose two different accounts.", "to");
    if (!validDate(date)) return fail("Choose a date that isn't in the future.", "date");
    const added = upsertEntry(f.dataset.id, { type: "move", amount, date, accountId: from, toAccountId: to, note: String(fd.get("note") || "").trim() });
    finishEntry(added, date, added ? `${money(amount)} moved to ${accountName(to)}.` : "Saved.");
  }
  function saveGoalMoney(f) {
    const fd = new FormData(f),
      amount = round2(fd.get("amount")),
      date = String(fd.get("date") || ""),
      g = goalById(String(fd.get("goal"))),
      take = f.dataset.mode === "take";
    const existing = f.dataset.id ? state.entries.find((e) => e.id === f.dataset.id) : null;
    if (!g) return fail("Choose a goal.", "goal");
    if (!(amount > 0)) return fail("Enter an amount above zero.", "amount");
    if (!validDate(date)) return fail("Choose a date that isn't in the future.", "date");
    const before = existing ? num(existing.amount) : 0;
    if (take) {
      const inGoal = goalBal(g) - (existing && existing.goalId === g.id ? before : 0);
      if (amount > inGoal + 0.001) return fail(`${g.name} only has ${money(inGoal)}.`, "amount");
    } else {
      const free = available() + (existing ? before : 0);
      if (free <= 0) return fail("Nothing is available to set aside right now.", "amount");
      if (amount > free + 0.001) return fail(`Only ${money(free)} is available to set aside.`, "amount");
    }
    const added = upsertEntry(f.dataset.id, { type: "goal", goalId: g.id, amount: take ? -amount : amount, date, note: "" });
    finishEntry(added, date, added ? (take ? `${money(amount)} taken out of ${g.name}.` : `${money(amount)} set aside for ${g.name}.`) : "Saved.");
  }
  function saveGoal(f) {
    const fd = new FormData(f),
      name = String(fd.get("name") || "").trim(),
      target = round2(fd.get("target")),
      monthly = round2(fd.get("monthly")),
      targetDate = String(fd.get("targetDate") || "");
    if (!name) return fail("Give the goal a name.", "name");
    if (!(target > 0)) return fail("Enter a target above zero.", "target");
    if (monthly < 0) return fail("The monthly amount can't be negative.", "monthly");
    const g = goalById(f.dataset.id);
    if (state.goals.some((x) => x !== g && !x.archived && x.name.toLowerCase() === name.toLowerCase())) return fail("You already have a goal with this name.", "name");
    if (g) Object.assign(g, { name, target, monthly, targetDate });
    else state.goals.push({ id: uid("goal"), name, target, monthly, targetDate, archived: false, createdAt: Date.now() });
    save();
    modal = null;
    tab = "goals";
    render();
    showToast(g ? "Goal saved." : `${name} created.`);
  }
  function saveBalance(f) {
    const id = f.dataset.account,
      v = String(new FormData(f).get("actual") ?? "");
    if (v === "" || !Number.isFinite(Number(v))) return fail("Enter the balance.", "actual");
    const d = round2(num(v) - balances()[id]);
    if (d) state.entries.push({ id: uid("fix"), type: "correction", amount: d, date: todayISO(), accountId: id, note: "", createdAt: Date.now() });
    save();
    modal = null;
    render();
    showToast(d ? `${accountName(id)} updated by ${money(d, { sign: true })}.` : "Balance already matches.", d ? { kind: "add", id: state.entries.at(-1).id } : null);
  }
  function saveRename(f) {
    const name = String(new FormData(f).get("name") || "").trim();
    if (!name) return fail("Give it a name.", "name");
    accountById(f.dataset.account).name = name;
    save();
    modal = null;
    render();
    showToast("Renamed.");
  }
  function saveCategory(f) {
    const fd = new FormData(f),
      c = itemById(f.dataset.id),
      name = c?.builtIn ? c.name : String(fd.get("name") || "").trim(),
      amount = round2(Math.max(0, num(fd.get("amount"))));
    if (!name) return fail("Give it a name.", "name");
    if (state.items.some((i) => i !== c && !i.archived && i.name.toLowerCase() === name.toLowerCase())) return fail("You already have a category with this name.", "name");
    const item = c || { id: uid("item"), name, group: "flexible", amounts: [], archived: false, createdAt: Date.now() };
    if (!c) state.items.push(item);
    if (!item.builtIn) {
      item.name = name;
      item.group = fd.get("group") === "fixed" ? "fixed" : "flexible";
      item.archived = fd.get("archived") === "on";
    }
    setItemAmount(item, amount);
    save();
    modal = { type: "manage-categories", from: modal?.from };
    render();
    showToast(c ? "Category saved." : `${name} added.`);
  }

  // ---------- toast + undo ----------
  function showToast(text, undoInfo = null) {
    undo = undoInfo;
    $("toast-text").textContent = text;
    $("toast-undo").hidden = !undoInfo;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      $("toast").hidden = true;
      undo = null;
    }, undoInfo ? 6000 : 2400);
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
    const url = URL.createObjectURL(new Blob([text], { type })),
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
    const rows = [["Date", "Type", "Description", "Account", "Amount", "Currency", "Note"]];
    [...state.entries]
      .filter((e) => e.type !== "opening")
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((e) =>
        rows.push([e.date, KIND[e.type], entryTitle(e), e.type === "goal" ? "" : e.type === "move" ? `${accountName(e.accountId)} → ${accountName(e.toAccountId)}` : accountName(e.accountId), e.type === "expense" ? -e.amount : e.amount, state.currency, e.note || ""]),
      );
    download(`budget-tracker-${todayISO()}.csv`, "﻿" + rows.map((r) => r.map(q).join(",")).join("\n"), "text/csv;charset=utf-8");
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
    state.meta.cleanStart = CLEAN_START;
    delete state.meta.cleanPending;
    save();
    modal = null;
    viewMonth = thisMonth();
    tab = "home";
    render();
    showToast("Backup restored.");
  }

  // ---------- events ----------
  function openModal(m) {
    modal = m;
    $("toast").hidden = true; // never cover a form
    render();
    // New entries start with the amount field ready to type in.
    root.querySelector(".modal [data-autofocus]")?.focus();
  }
  function closeModal() {
    modal = null;
    render();
  }
  function handleAction(a, el) {
    const d = el.dataset;
    switch (a) {
      case "period-step":
        if (d.month) viewMonth = d.month;
        return render();
      case "privacy-toggle":
        state.meta.privacy = !state.meta.privacy;
        save();
        return render();
      case "settings":
        return openModal({ type: "settings" });
      case "close-modal":
        return closeModal();
      case "dismiss-welcome":
        state.meta.welcome = null;
        save();
        return render();
      case "backup-snooze":
        state.meta.backupSnoozeUntil = Date.now() + 3 * 864e5;
        save();
        return render();
      case "export-backup":
        return exportBackup();
      case "export-csv":
        return exportCsv();
      case "add-expense":
        return openModal({ type: "expense" });
      case "add-income":
        return openModal({ type: "income" });
      case "add-transfer":
        return openModal({ type: "transfer", prefill: d.from ? { from: d.from } : {} });
      case "record-bill": {
        const st = monthStats(thisMonth()).fixed.find((x) => x.item.id === d.id);
        return openModal({ type: "expense", prefill: { itemId: d.id, amount: st ? Math.max(0, round2(st.planned - st.spent)) || "" : "" } });
      }
      case "row-actions":
        return openModal({ type: "row-actions", id: d.id });
      case "repeat-expense": {
        const e = state.entries.find((x) => x.id === d.id);
        return openModal({ type: "expense", prefill: { itemId: e.itemId, amount: e.amount, accountId: e.accountId || state.meta.lastAccountId, note: e.note, date: todayISO() } });
      }
      case "edit-entry": {
        const e = state.entries.find((x) => x.id === d.id);
        if (!e) return closeModal();
        if (e.type === "goal") return openModal({ type: "goal-money", id: e.id, goalId: e.goalId, mode: num(e.amount) < 0 ? "take" : "add" });
        return openModal({ type: { expense: "expense", income: "income", move: "transfer" }[e.type], id: e.id });
      }
      case "delete-entry": {
        const e = state.entries.find((x) => x.id === d.id);
        if (!e) return closeModal();
        if (e.type === "goal" && num(e.amount) > 0 && goalById(e.goalId) && goalBal(goalById(e.goalId)) - num(e.amount) < -0.001)
          return showToast("Take the money out of the goal first.");
        state.entries = state.entries.filter((x) => x !== e);
        save();
        modal = null;
        render();
        return showToast("Deleted.", { kind: "delete", entry: e });
      }
      case "account-actions":
        return openModal({ type: "account-actions", accountId: d.id });
      case "update-balance":
        return openModal({ type: "update-balance", accountId: d.id });
      case "rename-account":
        return openModal({ type: "rename-account", accountId: d.id });
      case "goal-add":
        return openModal({ type: "goal-money", mode: "add", goalId: d.id });
      case "goal-take":
        return openModal({ type: "goal-money", mode: "take", goalId: d.id });
      case "new-goal":
        return openModal({ type: "goal-form" });
      case "goal-edit":
        return openModal({ type: "goal-form", goalId: d.id });
      case "goal-delete": {
        const g = goalById(d.id);
        if (!g || goalBal(g) !== 0) return;
        if (!confirm(`Delete ${g.name}?`)) return;
        state.goals = state.goals.filter((x) => x !== g);
        state.entries = state.entries.filter((e) => !(e.type === "goal" && e.goalId === g.id));
        save();
        modal = null;
        render();
        return showToast("Goal deleted.");
      }
      case "manage-categories":
        return openModal({ type: "manage-categories", from: d.from || modal?.from });
      case "new-category":
        return openModal({ type: "category-form", from: modal?.from });
      case "suggest-category":
        return openModal({ type: "category-form", from: modal?.from, prefill: { name: d.name, group: d.group } });
      case "edit-category":
        return openModal({ type: "category-form", id: d.id, from: modal?.from });
      case "delete-category": {
        const c = itemById(d.id);
        if (!c || c.builtIn || state.entries.some((e) => e.itemId === c.id)) return;
        state.items = state.items.filter((i) => i !== c);
        save();
        modal = { type: "manage-categories", from: modal?.from };
        render();
        return showToast("Deleted.");
      }
      case "activity-filter":
        activityFilter = d.filter;
        return render();
      case "clear-search":
        activitySearch = "";
        return render();
      case "set-theme":
        state.meta.theme = d.theme;
        save();
        return render();
      case "legacy-download": {
        const copy = Object.fromEntries(previousVersionKeys().map((k) => [k, readJSON(k) ?? localStorage.getItem(k)]));
        return download(`budget-tracker-previous-version-${todayISO()}.json`, JSON.stringify(copy, null, 2), "application/json");
      }
      case "legacy-remove":
        if (!confirm("Remove the previous version's data from this phone? Download a copy first if you want to keep it.")) return;
        previousVersionKeys().forEach((k) => localStorage.removeItem(k));
        return render();
      case "reset":
        if (!confirm("Delete everything and start over? Export a backup first if you want to keep your records.")) return;
        state = freshState();
        setupStep = 1;
        modal = null;
        save();
        return render();
      case "setup-pick":
        readSetup();
        setupDraft.picks.has(d.name) ? setupDraft.picks.delete(d.name) : setupDraft.picks.add(d.name);
        return render();
      case "setup-next":
        readSetup();
        if (setupStep < 3) return setupStep++, render();
        return finishSetup();
      case "setup-back":
        readSetup();
        setupStep--;
        return render();
    }
  }
  document.addEventListener("click", (ev) => {
    if (ev.target.id === "toast-undo") return doUndo();
    if (ev.target.matches?.("[data-backdrop]")) {
      if (modalDirty && !confirm("Discard what you've entered?")) return;
      return closeModal();
    }
    const t = ev.target.closest("[data-tab], [data-action]");
    if (!t || t.disabled) return;
    if (t.dataset.tab) {
      tab = t.dataset.tab;
      modal = null;
      window.scrollTo(0, 0);
      return render();
    }
    handleAction(t.dataset.action, t);
  });
  document.addEventListener("submit", (ev) => {
    const f = ev.target;
    ev.preventDefault();
    const handlers = {
      "expense-form": saveExpense,
      "income-form": saveIncome,
      "transfer-form": saveTransfer,
      "goal-money-form": saveGoalMoney,
      "goal-form": saveGoal,
      "balance-form": saveBalance,
      "rename-form": saveRename,
      "category-form": saveCategory,
    };
    if (f.id === "activity-search-form") {
      activitySearch = $("activity-search-input").value;
      return render();
    }
    handlers[f.id]?.(f);
  });
  document.addEventListener("input", (ev) => {
    if (ev.target.closest(".modal")) modalDirty = true;
    if (ev.target.name === "actual" && $("balance-diff")) {
      const id = ev.target.form.dataset.account;
      $("balance-diff").value = money(round2(num(ev.target.value) - balances()[id]), { sign: true });
    }
  });
  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.id === "period-select") {
      viewMonth = t.value;
      return render();
    }
    if (t.id === "currency-select") {
      state.currency = t.value;
      save();
      return render();
    }
    if (t.id === "restore-file" || t.id === "setup-restore") {
      const f = t.files?.[0];
      t.value = "";
      if (f) importFile(f);
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && modal) closeModal();
  });

  if (state.setupDone && state.meta.cleanStart !== CLEAN_START) applyCleanStart();
  if (!state.setupDone && state.meta.cleanPending) {
    setupStep = 2;
    setupDraft.currency = state.currency;
    setupDraft.bankName = bankName();
  }
  render();
  if ("serviceWorker" in navigator) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (had) showToast("Updated to the latest version.");
    });
  }
})();
