(() => {
"use strict";

const DEFAULT_BUDGETS={
  "Rent":23000,"Sister's rent":7600,"Tithe":8200,"Family support":3500,"Utilities":1750,
  "SIM":799,"Home Wi‑Fi":899,"Apple One":390,"iCloud+":300,"Gym":1088,"Transportation":1000,
  "Food & groceries":8000,"Dating":3000,"Miscellaneous":1000
};
const DEFAULT_SPECIAL_CATEGORIES={
  travel:{"Food & drinks":0,"Transportation":0,"Attractions":0,"Shopping":0,"Accommodation":0,"Miscellaneous":0},
  purchase:{"Main purchase":0,"Accessories":0,"Fees":0,"Miscellaneous":0},
  event:{"Venue":0,"Food & drinks":0,"Gifts":0,"Transportation":0,"Miscellaneous":0},
  other:{"Main":0,"Miscellaneous":0}
};
const TYPE_META={
  travel:{label:"Travel / Vacation",icon:"✈️"},
  purchase:{label:"Large Purchase",icon:"🛍️"},
  event:{label:"Event",icon:"🎉"},
  other:{label:"Other",icon:"📦"}
};
const CURRENCIES=["TWD","ETB","JPY","USD","EUR","GBP","CHF","CNY","HKD","SGD","KRW","AUD","CAD","AED","SAR","THB","INR","NZD","SEK","NOK","DKK","ZAR"];
const CURRENCY_SYMBOLS={TWD:"NT$",ETB:"Br",JPY:"¥",USD:"$",EUR:"€",GBP:"£",CHF:"CHF",CNY:"CN¥",HKD:"HK$",SGD:"S$",KRW:"₩",AUD:"A$",CAD:"C$",AED:"AED",SAR:"SAR",THB:"฿",INR:"₹",NZD:"NZ$",SEK:"SEK",NOK:"NOK",DKK:"DKK",ZAR:"R"};
const CATEGORY_CHART_COLORS=[
  "#2563EB","#7C3AED","#0891B2","#DB2777","#4F46E5","#64748B",
  "#0EA5E9","#9333EA","#475569","#0369A1","#A21CAF","#1D4ED8"
];
const DEFAULT_SETTINGS={
  migrationNoticeDismissed:false,
  theme:"classic-functional",
  baseCurrency:"TWD",
  displayCurrency:"TWD",
  displayFxToBase:1,
  cashGoalBase:300000,
  quickCategories:["Food & groceries","Transportation","Miscellaneous","Dating"]
};

const STORAGE={
  legacyBudgets:"budgetTracker.budgets.v1",
  regularExpenses:"budgetTracker.expenses.v1",
  legacyCash:"budgetTracker.cash.v1",
  templateBudgets:"budgetTracker.templateBudgets.v3",
  monthBudgets:"budgetTracker.monthBudgets.v3",
  v6Accounts:"budgetTracker.accounts.v6",
  v6Trips:"budgetTracker.trips.v6",
  v6Transfers:"budgetTracker.transfers.v6",
  reserve:"budgetTracker.reserve.v7",
  specialBudgets:"budgetTracker.specialBudgets.v7",
  settings:"budgetTracker.settings.v7"
};

const $=id=>document.getElementById(id);
const clone=x=>JSON.parse(JSON.stringify(x));
function currencyText(value,code){
  code=String(code||"TWD").toUpperCase();
  const n=Number(value)||0;
  const decimals=["USD","EUR","GBP","CHF","AUD","CAD","NZD","SGD","HKD","AED","SAR"].includes(code)?2:0;
  const formatted=n.toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:decimals});
  const symbol=CURRENCY_SYMBOLS[code]||code;
  return ["CHF","AED","SAR","SEK","NOK","DKK"].includes(code)?`${symbol} ${formatted}`:`${symbol}${formatted}`;
}
function baseCurrency(){return String(settings?.baseCurrency||"TWD").toUpperCase()}
function displayCurrency(){return String(settings?.displayCurrency||baseCurrency()).toUpperCase()}
function displayFxToBase(){
  if(displayCurrency()===baseCurrency())return 1;
  const r=Number(settings?.displayFxToBase);
  return Number.isFinite(r)&&r>0?r:1;
}
function money(x){return currencyText(x,baseCurrency())}
function displayMoney(x){return currencyText((Number(x)||0)/displayFxToBase(),displayCurrency())}
function fmt(x,c){return currencyText(x,c)}
function maskedMoney(code){const symbol=CURRENCY_SYMBOLS[code]||code;return `${symbol}••••••`}
function baseReferenceText(x){return displayCurrency()===baseCurrency()?"":`≈ ${money(x)}`}
function baseReferenceHtml(x){const t=baseReferenceText(x);return t?`<div class="base-reference">${t}</div>`:""}
function setBaseReference(id,x,{masked=false}={}){
  const el=$(id);if(!el)return;
  let sub=el.nextElementSibling;
  if(!sub||!sub.classList.contains("base-reference")){
    sub=document.createElement("div");sub.className="base-reference";el.insertAdjacentElement("afterend",sub)
  }
  if(displayCurrency()===baseCurrency()){sub.hidden=true;sub.textContent="";return}
  sub.hidden=false;sub.textContent=masked?`≈ ${maskedMoney(baseCurrency())}`:`≈ ${money(x)}`
}
const uid=p=>`${p}-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;

function todayISO(){const d=new Date(),l=new Date(d.getTime()-d.getTimezoneOffset()*60000);return l.toISOString().slice(0,10)}
const currentMonthKey=()=>todayISO().slice(0,7);
const monthKey=d=>String(d||"").slice(0,7);
function monthLabel(mk){const[y,m]=String(mk).split("-").map(Number);return(!y||!m)?mk:new Intl.DateTimeFormat("en-US",{month:"short",year:"numeric"}).format(new Date(y,m-1,1))}
function shortMonth(mk){const[y,m]=String(mk).split("-").map(Number);return(!y||!m)?mk:new Intl.DateTimeFormat("en-US",{month:"short"}).format(new Date(y,m-1,1))}
function loadJSON(k,f){try{const r=localStorage.getItem(k);return r?JSON.parse(r):clone(f)}catch{return clone(f)}}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

const legacyBudgets=loadJSON(STORAGE.legacyBudgets,DEFAULT_BUDGETS);
let templateBudgets=loadJSON(STORAGE.templateBudgets,legacyBudgets);
let monthBudgets=loadJSON(STORAGE.monthBudgets,{});
let regularExpenses=normalizeRegular(loadJSON(STORAGE.regularExpenses,[]));
let specialBudgets=loadJSON(STORAGE.specialBudgets,[]);
let settings={...DEFAULT_SETTINGS,...loadJSON(STORAGE.settings,{})};
if(!CURRENCIES.includes(String(settings.baseCurrency||"").toUpperCase()))settings.baseCurrency="TWD";
if(!CURRENCIES.includes(String(settings.displayCurrency||"").toUpperCase()))settings.displayCurrency=settings.baseCurrency;
if(!Number.isFinite(Number(settings.displayFxToBase))||Number(settings.displayFxToBase)<=0)settings.displayFxToBase=1;
if(!Number.isFinite(Number(settings.cashGoalBase))||Number(settings.cashGoalBase)<0)settings.cashGoalBase=300000;
if(!Array.isArray(settings.quickCategories))settings.quickCategories=clone(DEFAULT_SETTINGS.quickCategories);
settings.theme="classic-functional";
let reserveBase=0;
let selectedMonth=currentMonthKey();
let selectedQuickCategory="Food & groceries";
let selectedSpecialId="";
let selectedSpecialType="travel";
let selectedInsightCategory="";
let privacyHidden=true;
let lastUndo=null,undoTimer=null;

function applyTheme(){
  settings.theme="classic-functional";
  document.documentElement.dataset.theme="classic-functional";
}

function normalizeRegular(list){
  if(!Array.isArray(list))return[];
  return list.map((e,i)=>({
    id:e.id||`legacy-${Date.now()}-${i}`,
    amount:Math.max(0,Number(e.amount)||0),
    category:String(e.category||"Miscellaneous"),
    date:/^\d{4}-\d{2}-\d{2}$/.test(String(e.date||""))?e.date:todayISO(),
    note:String(e.note||""),
    tripId:String(e.tripId||""),
    createdAt:Number(e.createdAt)||Date.now()
  }));
}

function normalizeSpecialBudgets(list){
  if(!Array.isArray(list))return[];
  return list.map(raw=>{
    const s={...raw};
    s.allocatedBase=Math.max(0,Number(s.allocatedBase ?? s.allocatedTwd ?? 0)||0);
    s.returnedBase=Math.max(0,Number(s.returnedBase ?? s.returnedTwd ?? 0)||0);
    s.retainedUnreturnedBase=Math.max(0,Number(s.retainedUnreturnedBase ?? s.retainedUnreturnedTwd ?? 0)||0);
    delete s.allocatedTwd; delete s.returnedTwd; delete s.retainedUnreturnedTwd;
    s.localCurrency=String(s.localCurrency||baseCurrency()).toUpperCase();
    s.fxRate=Math.max(0.000001,Number(s.fxRate)||1); // 1 local unit = fxRate base units
    s.categories=s.categories&&typeof s.categories==="object"?s.categories:{};
    s.wallets=Array.isArray(s.wallets)?s.wallets:[];
    s.transfers=Array.isArray(s.transfers)?s.transfers:[];
    s.expenses=Array.isArray(s.expenses)?s.expenses.map(e=>{
      const x={...e};
      x.amountBase=Math.max(0,Number(x.amountBase ?? x.amountTwd ?? x.amount ?? 0)||0);
      delete x.amountTwd;
      x.currency=String(x.currency||baseCurrency()).toUpperCase();
      x.fxRate=Math.max(0.000001,Number(x.fxRate)||1);
      x.originalAmount=Math.max(0,Number(x.originalAmount ?? x.amountBase)||0);
      return x
    }):[];
    return s
  })
}
specialBudgets=normalizeSpecialBudgets(specialBudgets);

function hasFinancialActivity(){
  return reserveBase>0 || regularExpenses.length>0 || specialBudgets.length>0;
}
function roundMoneyValue(v){return Math.round((Number(v)||0)*100)/100}
function scaleObjectValues(obj,factor){
  Object.keys(obj||{}).forEach(k=>obj[k]=roundMoneyValue((Number(obj[k])||0)*factor))
}
function convertBaseCurrency(newCode,factor){
  const old=baseCurrency();
  factor=Number(factor);
  if(!CURRENCIES.includes(newCode)||newCode===old)return true;
  if(!Number.isFinite(factor)||factor<=0)return false;

  reserveBase=roundMoneyValue(reserveBase*factor);
  settings.cashGoalBase=roundMoneyValue(Number(settings.cashGoalBase||0)*factor);
  scaleObjectValues(templateBudgets,factor);
  Object.values(monthBudgets).forEach(b=>scaleObjectValues(b,factor));
  regularExpenses.forEach(e=>e.amount=roundMoneyValue(Number(e.amount||0)*factor));

  specialBudgets.forEach(s=>{
    s.allocatedBase=roundMoneyValue(Number(s.allocatedBase||0)*factor);
    s.returnedBase=roundMoneyValue(Number(s.returnedBase||0)*factor);
    s.retainedUnreturnedBase=roundMoneyValue(Number(s.retainedUnreturnedBase||0)*factor);
    scaleObjectValues(s.categories,factor);
    const wasBaseLocal=s.localCurrency===old;
    if(s.type!=="travel"&&wasBaseLocal){s.localCurrency=newCode;s.fxRate=1}
    else s.fxRate=roundMoneyValue(Number(s.fxRate||1)*factor);
    (s.expenses||[]).forEach(e=>{
      e.amountBase=roundMoneyValue(Number(e.amountBase||0)*factor);
      e.fxRate=roundMoneyValue(Number(e.fxRate||1)*factor)
    })
  });

  settings.baseCurrency=newCode;
  settings.displayCurrency=newCode;
  settings.displayFxToBase=1;
  return true
}

function initReserve(){
  const saved=localStorage.getItem(STORAGE.reserve);
  if(saved!==null){reserveBase=Math.max(0,Number(saved)||0);return}
  const v6accounts=loadJSON(STORAGE.v6Accounts,[]);
  if(Array.isArray(v6accounts)&&v6accounts.length){
    const included=v6accounts.filter(a=>a.includeInReserve&&a.currency==="TWD").reduce((s,a)=>s+(Number(a.balance)||0),0);
    if(included>0){reserveBase=included;localStorage.setItem(STORAGE.reserve,String(reserveBase));return}
  }
  reserveBase=Math.max(0,Number(localStorage.getItem(STORAGE.legacyCash)||0));
  localStorage.setItem(STORAGE.reserve,String(reserveBase));
}

function migrateV6Trips(){
  if(specialBudgets.length)return;
  const v6trips=loadJSON(STORAGE.v6Trips,[]);
  if(!Array.isArray(v6trips)||!v6trips.length)return;
  const v6accounts=loadJSON(STORAGE.v6Accounts,[]);
  const v6transfers=loadJSON(STORAGE.v6Transfers,[]);

  v6trips.forEach(t=>{
    const linked=regularExpenses.filter(e=>e.tripId===t.id);
    const cats=clone(DEFAULT_SPECIAL_CATEGORIES.travel);
    linked.forEach(e=>{if(!(e.category in cats))cats[e.category]=0});
    const acctIds=new Set(linked.map(e=>e.accountId).filter(Boolean));
    const wallets=(Array.isArray(v6accounts)?v6accounts:[]).filter(a=>acctIds.has(a.id)).map(a=>({
      id:a.id,name:a.name,currency:a.currency,balance:Number(a.balance)||0
    }));
    const importedExpenses=linked.map(e=>({
      id:e.id,
      originalAmount:Number(e.originalAmount??e.amount)||0,
      currency:String(e.currency||"TWD"),
      fxRate:Number(e.fxRate)||1,
      amountBase:Number(e.amount)||0,
      category:e.category,
      date:e.date,
      note:e.note||"",
      walletId:e.accountId||"",
      createdAt:e.createdAt||Date.now(),
      importedFromV6:true
    }));
    const walletIds=new Set(wallets.map(w=>w.id));
    const importedTransfers=(Array.isArray(v6transfers)?v6transfers:[]).filter(tr=>walletIds.has(tr.fromAccountId)||walletIds.has(tr.toAccountId)).map(tr=>({
      id:tr.id||uid("tr"),
      fromWalletId:walletIds.has(tr.fromAccountId)?tr.fromAccountId:"pool",
      toWalletId:walletIds.has(tr.toAccountId)?tr.toAccountId:"pool",
      fromAmount:Number(tr.fromAmount)||0,
      toAmount:Number(tr.toAmount)||0,
      date:tr.date||todayISO(),
      note:tr.note||"",
      createdAt:tr.createdAt||Date.now(),
      importedFromV6:true
    }));
    specialBudgets.push({
      id:t.id||uid("special"),
      type:"travel",
      name:String(t.name||"Imported trip"),
      allocatedBase:Number(t.budgetTwd)||0,
      startDate:t.startDate||todayISO(),
      endDate:t.endDate||todayISO(),
      localCurrency:t.localCurrency||"JPY",
      fxRate:Number(t.fxRate)||1,
      categories:cats,
      wallets,
      expenses:importedExpenses,
      transfers:importedTransfers,
      status:"active",
      createdAt:Date.now(),
      importedFromV6:true
    });
  });
}

function persist(){
  localStorage.setItem(STORAGE.templateBudgets,JSON.stringify(templateBudgets));
  localStorage.setItem(STORAGE.monthBudgets,JSON.stringify(monthBudgets));
  localStorage.setItem(STORAGE.legacyBudgets,JSON.stringify(templateBudgets));
  localStorage.setItem(STORAGE.regularExpenses,JSON.stringify(regularExpenses));
  localStorage.setItem(STORAGE.reserve,String(reserveBase));
  localStorage.setItem(STORAGE.legacyCash,String(reserveBase));
  localStorage.setItem(STORAGE.specialBudgets,JSON.stringify(specialBudgets));
  localStorage.setItem(STORAGE.settings,JSON.stringify(settings));
}

function ensureMonthBudget(mk){if(!monthBudgets[mk])monthBudgets[mk]=clone(templateBudgets);return monthBudgets[mk]}
function isMigratedV6TripExpense(e){return e.tripId&&specialBudgets.some(s=>s.importedFromV6&&s.id===e.tripId)}
const regularForMonth=mk=>regularExpenses.filter(e=>monthKey(e.date)===mk&&!isMigratedV6TripExpense(e));
const totalRegularSpent=mk=>regularForMonth(mk).reduce((s,e)=>s+Number(e.amount||0),0);
const totalRegularBudget=mk=>Object.values(ensureMonthBudget(mk)).reduce((s,v)=>s+Number(v||0),0);
function regularSpentByCategory(mk){const o={};Object.keys(ensureMonthBudget(mk)).forEach(k=>o[k]=0);regularForMonth(mk).forEach(e=>o[e.category]=(o[e.category]||0)+Number(e.amount||0));return o}
function specialSpent(s){return (s.expenses||[]).reduce((sum,e)=>sum+Number(e.amountBase||0),0)}
function specialRemaining(s){return Number(s.allocatedBase||0)-specialSpent(s)}
const activeSpecials=()=>specialBudgets.filter(s=>s.status==="active");
const archivedSpecials=()=>specialBudgets.filter(s=>s.status==="archived");
const specialById=id=>specialBudgets.find(s=>s.id===id);

// Each Special Budget can choose a local reference currency. The app base currency remains the accounting currency.
function specialCurrencyCode(s){
  const code=String(s?.localCurrency||baseCurrency()).toUpperCase();
  return CURRENCIES.includes(code)?code:baseCurrency();
}
function specialFxRate(s){
  const code=specialCurrencyCode(s);
  if(code===baseCurrency())return 1;
  const rate=Number(s?.fxRate);
  return Number.isFinite(rate)&&rate>0?rate:null;
}
function localCurrencyText(twd,s,{masked=false}={}){
  if(!s)return "";
  const code=specialCurrencyCode(s),rate=specialFxRate(s);
  if(code===baseCurrency()||!rate)return "";
  if(masked)return `≈ ${code} ••••••`;
  const local=(Number(twd)||0)/rate;
  const zeroDecimal=["JPY","KRW"].includes(code);
  try{
    const formatted=new Intl.NumberFormat("en-US",{
      style:"currency",
      currency:code,
      currencyDisplay:"narrowSymbol",
      minimumFractionDigits:zeroDecimal?0:2,
      maximumFractionDigits:zeroDecimal?0:2
    }).format(local);
    return `≈ ${formatted}`;
  }catch{
    return `≈ ${code} ${local.toLocaleString("en-US",{maximumFractionDigits:zeroDecimal?0:2})}`;
  }
}
function localCurrencyHtml(twd,s){
  const text=localCurrencyText(twd,s);
  return text?`<div class="local-conversion">${text}</div>`:"";
}
function setLocalBelow(id,twd,s,{masked=false}={}){
  const el=$(id);if(!el)return;
  let sub=el.nextElementSibling;
  if(!sub||!sub.classList.contains("local-conversion")){
    sub=document.createElement("div");
    sub.className="local-conversion";
    el.insertAdjacentElement("afterend",sub)
  }
  const text=localCurrencyText(twd,s,{masked});
  sub.textContent=text;
  sub.hidden=!text;
}
function attachEditorLocal(input,s){
  const sub=document.createElement("div");
  sub.className="local-conversion editor-local";
  const update=()=>{
    const text=localCurrencyText(Number(input.value)||0,s);
    sub.textContent=text;
    sub.hidden=!text
  };
  input.insertAdjacentElement("afterend",sub);
  input.addEventListener("input",update);
  update()
}
function renderSpecialCurrencySettings(s){
  const sel=$("specialDisplayCurrency");
  fillCurrencySelect(sel,specialCurrencyCode(s));
  const code=specialCurrencyCode(s);
  const input=$("specialDisplayFxRate");
  input.value=code===baseCurrency()?"1":(Number(s.fxRate)||"");
  input.disabled=code===baseCurrency();
  $("specialDisplayFxHelp").textContent=code===baseCurrency()?`${baseCurrency()} is the accounting currency.`:`1 ${code} = ${currencyText(Number(input.value||0),baseCurrency())}`;
  updateSpecialCurrencyPreview(s)
}
function updateSpecialCurrencyPreview(s){
  if(!s)return;
  const code=$("specialDisplayCurrency").value||specialCurrencyCode(s);
  const rate=code===baseCurrency()?1:Number($("specialDisplayFxRate").value);
  if(code===baseCurrency()){
    $("specialCurrencyPreview").textContent=`${money(1000)} · no secondary conversion`;
    $("specialDisplayFxHelp").textContent=`${baseCurrency()} is the accounting currency.`;
    $("specialDisplayFxRate").disabled=true;
    return
  }
  $("specialDisplayFxRate").disabled=false;
  $("specialDisplayFxHelp").textContent=`1 ${code} = ${Number.isFinite(rate)&&rate>0?currencyText(rate,baseCurrency()):"?"}`;
  const temp={localCurrency:code,fxRate:rate};
  const text=localCurrencyText(1000,temp);
  $("specialCurrencyPreview").textContent=text?`${money(1000)} ${text}`:"Enter a valid FX rate to preview the conversion."
}

function availableMonths(){
  const set=new Set([currentMonthKey(),selectedMonth,...Object.keys(monthBudgets)]);
  regularExpenses.forEach(e=>{const m=monthKey(e.date);if(m)set.add(m)});
  return[...set].filter(Boolean).sort().reverse()
}
function addMonths(mk,d){const[y,m]=mk.split("-").map(Number),dt=new Date(y,m-1+d,1);return`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`}
function trendMonths(n=6){const all=availableMonths().sort(),cur=currentMonthKey();let end=all.length?all[all.length-1]:cur;if(cur>end)end=cur;const r=[];for(let i=n-1;i>=0;i--)r.push(addMonths(end,-i));return r}
function elapsedRatio(mk){if(mk!==currentMonthKey())return 1;const n=new Date(),dim=new Date(n.getFullYear(),n.getMonth()+1,0).getDate();return n.getDate()/dim}
function scoreForMonth(mk){
  const b=ensureMonthBudget(mk),sm=regularSpentByCategory(mk),tb=totalRegularBudget(mk),ts=totalRegularSpent(mk);
  let overall=40;if(tb>0&&ts>tb)overall=Math.max(0,40*(1-Math.min(1,(ts-tb)/tb)));
  const cats=Object.keys(b),cp=cats.length?40*cats.filter(c=>(sm[c]||0)<=Number(b[c]||0)).length/cats.length:40;
  let pace=20;if(mk===currentMonthKey()&&tb>0){const u=ts/tb,e=elapsedRatio(mk);if(u>e+.05)pace=Math.max(0,20*(1-Math.min(1,(u-(e+.05))/.35)))}else if(tb>0&&ts>tb)pace=0;
  return Math.round(overall+cp+pace)
}
function status(used,budget,mk){
  if(budget<=0)return used>0?"over":"good";if(used>budget)return"over";
  const r=used/budget;if(mk===currentMonthKey()&&(r>elapsedRatio(mk)+.08||r>=.85))return"watch";if(mk!==currentMonthKey()&&r>=.9)return"watch";return"good"
}
const statusLabel=s=>s==="over"?"Over budget":s==="watch"?"Watch":"On track";

function specialElapsedRatio(s){
  if(!s?.startDate||!s?.endDate)return 1;
  const start=new Date(`${s.startDate}T00:00:00`);
  const end=new Date(`${s.endDate}T23:59:59`);
  const now=new Date();
  if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<=start)return 1;
  if(now<=start)return 0;
  if(now>=end)return 1;
  return Math.min(1,Math.max(0,(now-start)/(end-start)));
}
function specialSpendStatus(used,budget,s){
  used=Number(used)||0;budget=Number(budget)||0;
  if(budget<=0)return used>0?"over":"good";
  if(used>budget)return"over";
  const usage=used/budget;
  const elapsed=specialElapsedRatio(s);

  // Watch if consumption is materially ahead of the Special Budget's timeline,
  // or if most of the budget has already been used.
  if(s?.status==="active" && (usage>elapsed+.08 || usage>=.85))return"watch";

  // For a period that has ended, near-total use is still worth flagging,
  // while staying within the allocation is not considered over budget.
  if(elapsed>=1 && usage>=.90)return"watch";
  return"good";
}
function specialStatusDetail(used,budget,s){
  const st=specialSpendStatus(used,budget,s);
  if(budget<=0){
    return used>0?"Spending recorded without a category budget.":"No spending yet.";
  }
  const usage=used/budget;
  const elapsed=specialElapsedRatio(s);
  if(st==="over")return `${money(used-budget)} over budget`;
  if(st==="watch"){
    if(s?.status==="active" && elapsed<1 && usage>elapsed+.08){
      return `${Math.round(usage*100)}% used · ${Math.round(elapsed*100)}% of period elapsed`;
    }
    return `${Math.round(usage*100)}% of budget used`;
  }
  if(s?.status==="active" && elapsed<1){
    return `${Math.round(usage*100)}% used · ${Math.round(elapsed*100)}% of period elapsed`;
  }
  return `${Math.round(usage*100)}% of budget used`;
}

function renderTabs(active){
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active",b.dataset.tab===active||(active==="special"&&b.dataset.specialId===selectedSpecialId)));
  document.querySelectorAll(".tab-panel").forEach(p=>p.hidden=p.id!==`tab-${active}`);
}
function renderSpecialTabs(){
  const mount=$("specialTabMount");mount.innerHTML="";
  activeSpecials().forEach(s=>{
    const b=document.createElement("button");b.type="button";b.className="tab-btn special-tab-btn";b.dataset.tab="special";b.dataset.specialId=s.id;b.dataset.specialType=s.type;
    b.textContent=`${TYPE_META[s.type]?.icon||"📦"} ${s.name}`;
    b.addEventListener("click",()=>{selectedSpecialId=s.id;renderSpecialPanel();renderTabs("special")});
    mount.appendChild(b)
  })
}
function renderMonthSelect(){
  const s=$("monthSelect"),months=availableMonths();s.innerHTML="";
  months.forEach(m=>{const o=document.createElement("option");o.value=m;o.textContent=monthLabel(m);s.appendChild(o)});
  if(!months.includes(selectedMonth))selectedMonth=currentMonthKey();s.value=selectedMonth
}
function renderReserve(){
  const goal=Math.max(0,Number(settings.cashGoalBase)||0),pct=goal>0?Math.min(100,reserveBase/goal*100):0,left=Math.max(0,goal-reserveBase);
  $("cashReserve").textContent=privacyHidden?maskedMoney(displayCurrency()):displayMoney(reserveBase);
  setBaseReference("cashReserve",reserveBase,{masked:privacyHidden});
  $("goalPercent").textContent=privacyHidden?"•••%":pct.toFixed(1)+"%";
  $("goalRemaining").textContent=privacyHidden?`${maskedMoney(displayCurrency())} to goal`:`${displayMoney(left)} to goal`;
  setBaseReference("goalRemaining",left,{masked:privacyHidden});
  $("goalBar").style.width=pct+"%";$("goalBar").className="progress-fill good";
  $("privacyBtn").textContent=privacyHidden?"👁":"🙈";$("reserveInput").value=roundMoneyValue(reserveBase);
  $("reserveInputLabel").textContent=`Available reserve (${baseCurrency()})`;
  const act=activeSpecials(),alloc=act.reduce((x,s)=>x+Number(s.allocatedBase||0),0),spent=act.reduce((x,s)=>x+specialSpent(s),0),remain=act.reduce((x,s)=>x+Math.max(0,specialRemaining(s)),0);
  $("activeSpecialAllocated").textContent=money(alloc);$("activeSpecialSpent").textContent=money(spent);$("activeSpecialRemaining").textContent=money(remain);
}
function renderRegularSummary(){
  const spent=totalRegularSpent(selectedMonth),budget=totalRegularBudget(selectedMonth),rem=budget-spent,u=budget?spent/budget:0,st=status(spent,budget,selectedMonth);
  $("monthSummaryTitle").textContent=`${monthLabel(selectedMonth)} regular budget`;
  $("monthlyBudget").textContent=displayMoney(budget);$("monthlySpent").textContent=displayMoney(spent);$("monthlyRemaining").textContent=displayMoney(Math.max(0,rem));
  setBaseReference("monthlyBudget",budget);setBaseReference("monthlySpent",spent);setBaseReference("monthlyRemaining",Math.max(0,rem));
  $("monthBudgetBar").style.width=Math.min(100,u*100)+"%";$("monthBudgetBar").className=`progress-fill ${st}`;
  if(selectedMonth===currentMonthKey()){const e=elapsedRatio(selectedMonth);$("paceMessage").textContent=u>e+.05?`Regular spending is ahead of pace: ${(u*100).toFixed(0)}% used with ${(e*100).toFixed(0)}% of the month elapsed.`:`Regular spending pace looks controlled: ${(u*100).toFixed(0)}% used with ${(e*100).toFixed(0)}% of the month elapsed.`}
  else $("paceMessage").textContent=rem>=0?`${displayMoney(rem)} finished unspent.`:`${displayMoney(Math.abs(rem))} over budget.`
}
function renderQuickCategories(){
  const b=ensureMonthBudget(currentMonthKey()),all=Object.keys(b),wrap=$("quickCategories");
  let names=(settings.quickCategories||[]).filter(n=>n in b);
  if(!names.length)names=DEFAULT_SETTINGS.quickCategories.filter(n=>n in b);
  if(!names.length)names=all.slice(0,4);
  if(!names.includes(selectedQuickCategory))selectedQuickCategory=names[0]||"Miscellaneous";wrap.innerHTML="";
  names.forEach(n=>{const btn=document.createElement("button");btn.type="button";btn.className="chip"+(n===selectedQuickCategory?" active":"");btn.textContent=n.replace(" & groceries","");btn.addEventListener("click",()=>{selectedQuickCategory=n;renderQuickCategories();$("quickMessage").textContent=`Selected: ${n}`});wrap.appendChild(btn)})
}
function renderDetailCategory(){
  const s=$("detailCategory"),prev=s.value,b=ensureMonthBudget(currentMonthKey());s.innerHTML="";
  Object.keys(b).forEach(n=>{const o=document.createElement("option");o.value=n;o.textContent=n;s.appendChild(o)});if(prev in b)s.value=prev
}
function renderRegularCategories(){
  const b=ensureMonthBudget(selectedMonth),sm=regularSpentByCategory(selectedMonth),wrap=$("categoryList");$("categoryMonthLabel").textContent=monthLabel(selectedMonth);wrap.innerHTML="";
  Object.entries(b).forEach(([n,bv])=>{const bud=Number(bv)||0,used=sm[n]||0,rem=bud-used,pct=bud?Math.min(100,used/bud*100):(used?100:0),st=status(used,bud,selectedMonth),row=document.createElement("div");row.className="category-row";row.innerHTML=`<div class="category-top"><div><div class="category-name">${esc(n)}</div><div class="category-meta">${displayMoney(used)} spent · ${displayMoney(Math.max(0,rem))} remaining${displayCurrency()!==baseCurrency()?` · ${money(used)} base`:""}</div><span class="status ${st}">${statusLabel(st)}</span></div><div class="budget-amount-block"><strong>${displayMoney(bud)}</strong>${baseReferenceHtml(bud)}</div></div><div class="progress"><div class="progress-fill ${st}" style="width:${pct}%"></div></div>`;wrap.appendChild(row)})
}
function createBudgetEditorRow(name,value){
  const row=document.createElement("div");
  row.className="budget-editor-row";
  row.dataset.category=name;

  const main=document.createElement("label");
  main.className="budget-editor-field";
  const title=document.createElement("span");
  title.className="budget-editor-name";
  title.textContent=name;
  const input=document.createElement("input");
  input.type="number";
  input.min="0";
  input.step="1";
  input.value=roundMoneyValue(Number(value)||0);
  input.dataset.category=name;
  main.appendChild(title);
  main.appendChild(input);

  const controls=document.createElement("div");
  controls.className="budget-editor-controls";

  const up=document.createElement("button");
  up.type="button";
  up.className="icon-order-btn";
  up.textContent="↑";
  up.setAttribute("aria-label",`Move ${name} up`);
  up.title="Move up";
  up.addEventListener("click",()=>{
    const prev=row.previousElementSibling;
    if(prev)row.parentElement.insertBefore(row,prev);
    updateBudgetEditorControls()
  });

  const down=document.createElement("button");
  down.type="button";
  down.className="icon-order-btn";
  down.textContent="↓";
  down.setAttribute("aria-label",`Move ${name} down`);
  down.title="Move down";
  down.addEventListener("click",()=>{
    const next=row.nextElementSibling;
    if(next)row.parentElement.insertBefore(next,row);
    updateBudgetEditorControls()
  });

  const remove=document.createElement("button");
  remove.type="button";
  remove.className="remove-category-btn";
  remove.textContent="Remove";
  remove.setAttribute("aria-label",`Remove ${name} category`);
  remove.addEventListener("click",()=>{
    row.remove();
    updateBudgetEditorControls();
    $("budgetSaveMessage").textContent=`${name} removed from the editor. Existing transactions are preserved. Tap Save budgets to apply.`
  });

  controls.appendChild(up);
  controls.appendChild(down);
  controls.appendChild(remove);
  row.appendChild(main);
  row.appendChild(controls);
  return row
}

function updateBudgetEditorControls(){
  const rows=[...$("budgetFields").querySelectorAll(".budget-editor-row")];
  rows.forEach((row,index)=>{
    const buttons=row.querySelectorAll(".icon-order-btn");
    if(buttons[0])buttons[0].disabled=index===0;
    if(buttons[1])buttons[1].disabled=index===rows.length-1
  })
}

function renderBudgetEditor(){
  const wrap=$("budgetFields");
  wrap.innerHTML="";
  $("budgetEditorTitle").textContent=`Edit ${monthLabel(selectedMonth)} budgets`;
  Object.entries(ensureMonthBudget(selectedMonth)).forEach(([name,value])=>{
    wrap.appendChild(createBudgetEditorRow(name,value))
  });
  updateBudgetEditorControls()
}

function renderSpecialSummary(){
  const wrap=$("specialBudgetSummaryList"),act=activeSpecials();wrap.innerHTML="";
  if(!act.length){wrap.innerHTML='<div class="empty">No active Special Budgets.</div>';return}
  act.forEach(s=>{const spent=specialSpent(s),rem=specialRemaining(s),st=specialSpendStatus(spent,s.allocatedBase,s),row=document.createElement("div");row.className="special-row";row.dataset.specialType=s.type;row.innerHTML=`<div><div class="special-name">${TYPE_META[s.type]?.icon||"📦"} ${esc(s.name)}</div><div class="special-meta">${TYPE_META[s.type]?.label||"Special"} · ${money(spent)} spent</div><span class="status ${st}">${statusLabel(st)}</span></div><div class="special-right"><strong>${money(Math.max(0,rem))}</strong>${localCurrencyHtml(Math.max(0,rem),s)}<div class="special-meta">remaining</div></div>`;row.addEventListener("click",()=>{selectedSpecialId=s.id;renderSpecialPanel();renderTabs("special")});wrap.appendChild(row)})
}
function renderSpecialPanel(){
  const s=specialById(selectedSpecialId)||activeSpecials()[0];if(!s)return;selectedSpecialId=s.id;
  $("tab-special").dataset.specialType=s.type;
  ["increaseSpecialBaseCurrency","finishSpecialBaseCurrency","specialExpenseBaseCurrency","specialCategoryBaseCurrency"].forEach(id=>{const el=$(id);if(el)el.textContent=baseCurrency()});
  $("specialCategoryEditor").hidden=true;
  $("showSpecialCategoryEditorBtn").textContent="Edit";
  const spent=specialSpent(s),rem=specialRemaining(s),pct=s.allocatedBase?Math.min(100,spent/s.allocatedBase*100):0,meta=TYPE_META[s.type]||TYPE_META.other;
  $("specialTypeLabel").textContent=meta.label;$("specialTitle").textContent=s.name;$("specialDates").textContent=`${s.startDate} → ${s.endDate}`;
  $("specialRemaining").textContent=money(Math.max(0,rem));$("specialAllocated").textContent=money(s.allocatedBase);$("specialSpent").textContent=money(spent);
  setLocalBelow("specialRemaining",Math.max(0,rem),s);setLocalBelow("specialAllocated",s.allocatedBase,s);setLocalBelow("specialSpent",spent,s);
  $("specialProgressBar").style.width=pct+"%";$("finishReturnAmount").value=Math.max(0,Math.floor(rem));
  const overallStatus=specialSpendStatus(spent,s.allocatedBase,s);
  $("specialProgressBar").className=`progress-fill ${overallStatus}`;
  $("specialOverallStatus").className=`status ${overallStatus}`;
  $("specialOverallStatus").textContent=statusLabel(overallStatus);
  $("specialPaceText").textContent=specialStatusDetail(spent,s.allocatedBase,s);
  renderSpecialCurrencySettings(s);renderSpecialCategorySelect(s);renderSpecialCategories(s);renderSpecialWallets(s);renderSpecialTransactions(s);
  const travel=s.type==="travel";$("travelWalletSection").hidden=!travel;$("specialExpenseCurrencyWrap").hidden=!travel;$("specialExpenseFxWrap").hidden=!travel;$("specialExpenseWalletWrap").hidden=!travel;
  if(travel){
    const cur=s.localCurrency||"JPY";fillCurrencySelect($("specialExpenseCurrency"),cur);$("specialExpenseFx").value=Number(s.fxRate)||1;
  }
}
function renderSpecialCategorySelect(s){
  const sel=$("specialExpenseCategory"),prev=sel.value;sel.innerHTML="";
  Object.keys(s.categories||{}).forEach(n=>{const o=document.createElement("option");o.value=n;o.textContent=n;sel.appendChild(o)});if(prev in(s.categories||{}))sel.value=prev
}
function renderSpecialCategories(s){
  const spentMap={};(s.expenses||[]).forEach(e=>spentMap[e.category]=(spentMap[e.category]||0)+Number(e.amountBase||0));
  const wrap=$("specialCategoryList");wrap.innerHTML="";
  Object.entries(s.categories||{}).forEach(([n,bv])=>{const bud=Number(bv)||0,used=spentMap[n]||0,rem=bud-used,pct=bud?Math.min(100,used/bud*100):(used?100:0),st=specialSpendStatus(used,bud,s),row=document.createElement("div");row.className="category-row";row.innerHTML=`<div class="category-top"><div><div class="category-name">${esc(n)}</div><div class="category-meta">${money(used)} spent${bud?` · ${money(Math.max(0,rem))} category balance`:""}</div><span class="status ${st}">${statusLabel(st)}</span><span class="category-status-detail">${esc(specialStatusDetail(used,bud,s))}</span></div><div class="budget-amount-block"><strong>${money(bud)}</strong>${localCurrencyHtml(bud,s)}</div></div><div class="progress"><div class="progress-fill ${st}" style="width:${pct}%"></div></div>`;wrap.appendChild(row)});
  renderSpecialCategoryEditor(s)
}
function renderSpecialCategoryEditor(s){
  const wrap=$("specialCategoryFields");wrap.innerHTML="";
  Object.entries(s.categories||{}).forEach(([n,v])=>{const l=document.createElement("label");l.textContent=n;const i=document.createElement("input");i.type="number";i.min="0";i.step="1";i.value=roundMoneyValue(Number(v)||0);i.dataset.category=n;l.appendChild(i);wrap.appendChild(l);attachEditorLocal(i,s)})
}
function fillCurrencySelect(sel,preferred){
  sel.innerHTML="";CURRENCIES.forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c;sel.appendChild(o)});if(CURRENCIES.includes(preferred))sel.value=preferred
}
function renderSpecialWallets(s){
  if(s.type!=="travel")return;
  const wrap=$("specialWalletList");wrap.innerHTML="";
  if(!(s.wallets||[]).length)wrap.innerHTML='<div class="empty">No wallets yet. Add a cash, card, or prepaid wallet below.</div>';
  (s.wallets||[]).forEach(w=>{const row=document.createElement("div");row.className="wallet-row";row.innerHTML=`<div><div class="wallet-name">${esc(w.name)}</div><div class="wallet-meta">${esc(w.currency)}</div></div><div class="wallet-right"><strong>${fmt(w.balance,w.currency)}</strong></div>`;wrap.appendChild(row)});
  fillCurrencySelect($("specialWalletCurrency"),s.localCurrency||"JPY");
  const expenseWallet=$("specialExpenseWallet"),to=$("specialTransferTo"),from=$("specialTransferFrom");
  expenseWallet.innerHTML='<option value="">Direct payment / no wallet</option>';to.innerHTML="";from.innerHTML='<option value="pool">Special Budget pool</option>';
  (s.wallets||[]).forEach(w=>{
    [expenseWallet,to,from].forEach(sel=>{const o=document.createElement("option");o.value=w.id;o.textContent=`${w.name} · ${w.currency}`;sel.appendChild(o)})
  })
}
function renderSpecialTransactions(s){
  const wrap=$("specialTransactionList"),items=[];
  (s.expenses||[]).forEach(e=>items.push({kind:"expense",date:e.date,createdAt:e.createdAt||0,data:e}));
  (s.transfers||[]).forEach(t=>items.push({kind:"transfer",date:t.date,createdAt:t.createdAt||0,data:t}));
  items.sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);wrap.innerHTML="";
  if(!items.length){wrap.innerHTML='<div class="empty">No activity yet.</div>';return}
  items.forEach(it=>{
    const row=document.createElement("div");row.className="expense-row";
    if(it.kind==="expense"){
      const e=it.data,w=(s.wallets||[]).find(x=>x.id===e.walletId);
      const orig=e.currency!==baseCurrency()?`<div class="expense-meta">${fmt(e.originalAmount,e.currency)} → ${money(e.amountBase)}</div>`:"";
      row.innerHTML=`<div class="expense-top"><div><div class="expense-name">${esc(e.category)}</div><div class="expense-meta">${esc(e.date)}${e.note?" · "+esc(e.note):""}${w?" · "+esc(w.name):""}</div></div><div class="special-right"><strong>${money(e.amountBase)}</strong>${orig}</div></div>`;
      const b=document.createElement("button");b.type="button";b.className="delete-btn";b.textContent="Delete";b.addEventListener("click",()=>deleteSpecialExpense(s.id,e.id));row.appendChild(b)
    }else{
      const t=it.data,fw=t.fromWalletId==="pool"?{name:"Budget pool",currency:baseCurrency()}:(s.wallets||[]).find(x=>x.id===t.fromWalletId),tw=(s.wallets||[]).find(x=>x.id===t.toWalletId);
      row.innerHTML=`<div class="expense-top"><div><div class="expense-name">Transfer · ${esc(fw?.name||"Unknown")} → ${esc(tw?.name||"Unknown")}</div><div class="expense-meta">${esc(t.date)}${t.note?" · "+esc(t.note):""}</div></div><div class="special-right"><strong>${fmt(t.toAmount,tw?.currency||"")}</strong><div class="expense-meta">Not spending</div></div></div>`;
      const b=document.createElement("button");b.type="button";b.className="delete-btn";b.textContent="Delete & reverse";b.addEventListener("click",()=>deleteSpecialTransfer(s.id,t.id));row.appendChild(b)
    }
    wrap.appendChild(row)
  })
}

function categoryColorMap(mk){
  const ordered=[...Object.keys(ensureMonthBudget(mk))];
  regularForMonth(mk).forEach(e=>{if(!ordered.includes(e.category))ordered.push(e.category)});
  const map={};ordered.forEach((name,i)=>map[name]=CATEGORY_CHART_COLORS[i%CATEGORY_CHART_COLORS.length]);return map
}
function renderCategoryBreakdownDetail(entries,total,colorMap){
  const detail=$("categoryBreakdownDetail");
  if(!entries.length){detail.hidden=true;return}
  if(!entries.some(x=>x.name===selectedInsightCategory))selectedInsightCategory=entries[0].name;
  const item=entries.find(x=>x.name===selectedInsightCategory)||entries[0],pct=total?item.amount/total*100:0;
  detail.hidden=false;
  $("categoryDetailDot").style.background=colorMap[item.name]||CATEGORY_CHART_COLORS[0];
  $("categoryDetailName").textContent=item.name;
  $("categoryDetailAmount").textContent=displayMoney(item.amount);
  $("categoryDetailPercent").textContent=`${pct.toFixed(pct<10?1:0)}% of total spending`;
  const txWrap=$("categoryDetailTransactions");txWrap.innerHTML="";
  const rows=regularForMonth(selectedMonth).filter(e=>e.category===item.name).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt).slice(0,5);
  if(!rows.length){txWrap.innerHTML='<div class="empty">No transactions in this category.</div>';return}
  rows.forEach(e=>{
    const r=document.createElement("div");r.className="insight-transaction-row";
    r.innerHTML=`<div><div class="expense-name">${esc(e.note||e.category)}</div><div class="expense-meta">${esc(e.date)}</div></div><strong>${displayMoney(e.amount)}</strong>`;
    txWrap.appendChild(r)
  })
}
function renderSpendingByCategory(){
  const spentMap=regularSpentByCategory(selectedMonth),colorMap=categoryColorMap(selectedMonth);
  const entries=Object.entries(spentMap).map(([name,amount])=>({name,amount:Number(amount)||0})).filter(x=>x.amount>0).sort((a,b)=>b.amount-a.amount);
  const total=entries.reduce((sum,x)=>sum+x.amount,0);
  $("categoryBreakdownMonth").textContent=monthLabel(selectedMonth);
  const empty=$("categoryBreakdownEmpty"),content=$("categoryBreakdownContent"),detail=$("categoryBreakdownDetail");
  if(!entries.length){empty.hidden=false;content.hidden=true;detail.hidden=true;$("categoryDonutChart").innerHTML="";$("categoryDonutLegend").innerHTML="";return}
  empty.hidden=true;content.hidden=false;
  if(!entries.some(x=>x.name===selectedInsightCategory))selectedInsightCategory=entries[0].name;
  $("categoryDonutTotal").textContent=displayMoney(total);

  const svg=$("categoryDonutChart");svg.innerHTML="";
  const NS="http://www.w3.org/2000/svg",r=78,circ=2*Math.PI*r;let offset=0;
  entries.forEach(item=>{
    const fraction=item.amount/total,seg=document.createElementNS(NS,"circle");
    seg.setAttribute("cx","110");seg.setAttribute("cy","110");seg.setAttribute("r",String(r));seg.setAttribute("fill","none");
    seg.setAttribute("stroke",colorMap[item.name]);seg.setAttribute("stroke-width",item.name===selectedInsightCategory?"42":"38");
    seg.setAttribute("stroke-dasharray",`${fraction*circ} ${circ-fraction*circ}`);seg.setAttribute("stroke-dashoffset",String(-offset*circ));
    seg.setAttribute("transform","rotate(-90 110 110)");seg.setAttribute("class","donut-segment");seg.setAttribute("tabindex","0");
    seg.setAttribute("role","button");seg.setAttribute("aria-label",`${item.name}: ${displayMoney(item.amount)}, ${(fraction*100).toFixed(0)} percent`);
    const choose=()=>{selectedInsightCategory=item.name;renderSpendingByCategory()};seg.addEventListener("click",choose);seg.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose()}});svg.appendChild(seg);offset+=fraction
  });

  const legend=$("categoryDonutLegend");legend.innerHTML="";
  entries.forEach(item=>{
    const pct=total?item.amount/total*100:0,b=document.createElement("button");b.type="button";b.className="donut-legend-row"+(item.name===selectedInsightCategory?" selected":"");
    b.innerHTML=`<span class="legend-main"><span class="legend-dot" style="background:${colorMap[item.name]}"></span><span class="legend-name">${esc(item.name)}</span></span><span class="legend-value"><strong>${displayMoney(item.amount)}</strong><small>${pct.toFixed(pct<10?1:0)}%</small></span>`;
    b.addEventListener("click",()=>{selectedInsightCategory=item.name;renderSpendingByCategory()});legend.appendChild(b)
  });
  renderCategoryBreakdownDetail(entries,total,colorMap)
}

function renderInsights(){
  renderSpendingByCategory();
  const sc=scoreForMonth(selectedMonth),b=totalRegularBudget(selectedMonth),sp=totalRegularSpent(selectedMonth),u=b?sp/b:0,e=elapsedRatio(selectedMonth);
  $("budgetScore").textContent=sc+" / 100";$("scoreSummary").textContent=sc>=90?"Excellent regular budget control.":sc>=80?"Strong month with a few areas to watch.":sc>=70?"Generally on track.":"Several regular categories need adjustment.";
  $("pacePercent").textContent=(u*100).toFixed(0)+"%";$("paceInsight").textContent=selectedMonth===currentMonthKey()?`${(e*100).toFixed(0)}% of the month has passed.`:(u<=1?"Finished within regular budget.":"Finished over regular budget.");
  const wrap=$("specialInsightsList");wrap.innerHTML="";const all=[...activeSpecials(),...archivedSpecials()];
  if(!all.length)wrap.innerHTML='<div class="empty">No Special Budget history yet.</div>';
  all.forEach(s=>{const r=document.createElement("div");r.className="special-row";r.innerHTML=`<div><div class="special-name">${TYPE_META[s.type]?.icon||"📦"} ${esc(s.name)}</div><div class="special-meta">${s.status==="active"?"Active":"Archived"} · allocated ${money(s.allocatedBase)} ${localCurrencyText(s.allocatedBase,s)?`· ${localCurrencyText(s.allocatedBase,s)}`:""}</div></div><div class="special-right"><strong>${money(specialSpent(s))}</strong>${localCurrencyHtml(specialSpent(s),s)}<div class="special-meta">spent</div></div>`;wrap.appendChild(r)})
}
function renderMonthlyTrend(){
  const months=trendMonths(6),data=months.map(m=>({m,spent:totalRegularSpent(m),budget:totalRegularBudget(m)})),max=Math.max(1,...data.map(d=>Math.max(d.spent,d.budget))),wrap=$("monthlyTrendChart");wrap.innerHTML="";
  data.forEach(d=>{const h=Math.max(2,Math.round(d.spent/max*100)),c=document.createElement("div");c.className="bar-col";c.innerHTML=`<div class="bar-value">${displayMoney(d.spent)}</div><div class="bar-track"><div class="bar-fill" style="height:${h}%"></div></div><div class="bar-label">${shortMonth(d.m)}</div>`;wrap.appendChild(c)})
}
function renderTrendSelect(){
  const s=$("trendCategory"),prev=s.value||"Food & groceries",b=ensureMonthBudget(selectedMonth);s.innerHTML="";Object.keys(b).forEach(n=>{const o=document.createElement("option");o.value=n;o.textContent=n;s.appendChild(o)});if(prev in b)s.value=prev
}
function renderCategoryTrend(){
  const cat=$("trendCategory").value||Object.keys(ensureMonthBudget(selectedMonth))[0],months=trendMonths(6),pts=months.map(m=>({m,spent:regularSpentByCategory(m)[cat]||0,budget:Number(ensureMonthBudget(m)[cat])||0}));
  const maxY=Math.max(1,...pts.map(p=>Math.max(p.spent,p.budget))),W=560,H=190,L=42,R=18,T=18,B=34,CW=W-L-R,CH=H-T-B,x=i=>L+(pts.length<=1?CW/2:i/(pts.length-1)*CW),y=v=>T+CH-(v/maxY*CH);
  const sp=pts.map((p,i)=>`${i?"L":"M"} ${x(i).toFixed(1)} ${y(p.spent).toFixed(1)}`).join(" "),bp=pts.map((p,i)=>`${i?"L":"M"} ${x(i).toFixed(1)} ${y(p.budget).toFixed(1)}`).join(" ");
  let svg=`<svg viewBox="0 0 ${W} ${H}">`;[0,.5,1].forEach(f=>{const yy=T+CH-f*CH;svg+=`<line class="chart-grid" x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}"></line><text class="chart-text" x="2" y="${yy+3}">${Math.round(maxY*f)}</text>`});svg+=`<path class="chart-budget" d="${bp}"></path><path class="chart-line" d="${sp}"></path>`;pts.forEach((p,i)=>svg+=`<circle class="chart-dot" cx="${x(i)}" cy="${y(p.spent)}" r="4"></circle><text class="chart-text" text-anchor="middle" x="${x(i)}" y="${H-8}">${shortMonth(p.m)}</text>`);svg+="</svg>";$("categoryTrendChart").innerHTML=svg;
  const vals=pts.map(p=>p.spent),avg=vals.reduce((a,b)=>a+b,0)/vals.length,nz=vals.filter(v=>v>0);let dir="Stable";if(nz.length>=2){const c=(nz[nz.length-1]-nz[0])/nz[0];if(c<=-.1)dir="Improving";else if(c>=.1)dir="Rising"}$("trendAverage").textContent=displayMoney(avg);$("trendBudget").textContent=displayMoney(Number(ensureMonthBudget(selectedMonth)[cat])||0);$("trendDirection").textContent=dir
}
function renderHistory(){
  const body=$("historyTableBody");body.innerHTML="";
  availableMonths().forEach(m=>{const b=totalRegularBudget(m),s=totalRegularSpent(m),v=b-s,tr=document.createElement("tr");tr.innerHTML=`<td>${monthLabel(m)}</td><td>${displayMoney(b)}</td><td>${displayMoney(s)}</td><td class="${v>=0?"positive":"negative"}">${v>=0?"+":"−"}${displayMoney(Math.abs(v))}</td><td>${scoreForMonth(m)}</td>`;body.appendChild(tr)});
  const wrap=$("expenseList"),rows=[...regularForMonth(selectedMonth)].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);$("historyTitle").textContent=`${monthLabel(selectedMonth)} regular expenses`;wrap.innerHTML="";
  if(!rows.length)wrap.innerHTML='<div class="empty">No regular expenses for this month.</div>';
  rows.forEach(e=>{const r=document.createElement("div");r.className="expense-row";r.innerHTML=`<div class="expense-top"><div><div class="expense-name">${esc(e.category)}</div><div class="expense-meta">${esc(e.date)}${e.note?" · "+esc(e.note):""}</div></div><div class="budget-amount-block"><strong>${displayMoney(e.amount)}</strong>${baseReferenceHtml(e.amount)}</div></div>`;const b=document.createElement("button");b.type="button";b.className="delete-btn";b.textContent="Delete";b.addEventListener("click",()=>deleteRegularExpense(e.id));r.appendChild(b);wrap.appendChild(r)});
  const ar=$("archivedSpecialList");ar.innerHTML="";if(!archivedSpecials().length)ar.innerHTML='<div class="empty">No archived Special Budgets yet.</div>';
  archivedSpecials().forEach(s=>{const r=document.createElement("div");r.className="special-row";r.innerHTML=`<div><div class="special-name">${TYPE_META[s.type]?.icon||"📦"} ${esc(s.name)}</div><div class="special-meta">Allocated ${money(s.allocatedBase)} · returned ${money(s.returnedBase||0)}</div></div><div class="special-right"><strong>${money(specialSpent(s))}</strong>${localCurrencyHtml(specialSpent(s),s)}<div class="special-meta">spent</div></div>`;ar.appendChild(r)})
}


function renderCurrencyLabels(){
  const base=baseCurrency();
  ["quickBaseCurrency","detailBaseCurrency","newCategoryBaseCurrency","specialAllocationBaseCurrency","specialCreateBaseCurrency","increaseSpecialBaseCurrency","finishSpecialBaseCurrency","specialExpenseBaseCurrency","specialCategoryBaseCurrency","specialDisplayBaseCurrency","cashGoalBaseCurrency"].forEach(id=>{const el=$(id);if(el)el.textContent=base});
  const fxHelp=$("specialCreateFxHelp");if(fxHelp)fxHelp.textContent=`Enter how many ${base} equal 1 unit of the selected currency.`;
  const creator=$("specialCurrency");
  if(creator){const preferred=creator.value||"JPY";fillCurrencySelect(creator,preferred)}
}
function renderQuickCategorySettings(){
  const wrap=$("quickCategorySettings");if(!wrap)return;wrap.innerHTML="";
  const names=Object.keys(templateBudgets);
  names.forEach(name=>{
    const label=document.createElement("label");label.className="check-option";
    const input=document.createElement("input");input.type="checkbox";input.value=name;input.checked=(settings.quickCategories||[]).includes(name);
    const span=document.createElement("span");span.textContent=name;
    label.appendChild(input);label.appendChild(span);wrap.appendChild(label)
  })
}
function renderBaseMigrationControls(){
  const sel=$("settingsBaseCurrency");if(!sel)return;
  const next=sel.value,current=baseCurrency(),box=$("baseCurrencyMigrationBox");
  if(next===current){box.hidden=true;return}
  box.hidden=false;
  const hasData=hasFinancialActivity();
  $("baseMigrationRateLabel").hidden=!hasData;
  $("baseMigrationRate").hidden=!hasData;
  $("baseMigrationHelp").hidden=!hasData;
  if(hasData){
    $("baseCurrencyMigrationText").textContent=`You already have financial data. v8 will convert all base-currency values instead of relabeling them.`;
    $("baseMigrationRateLabel").childNodes[0].nodeValue=`1 ${current} = how many ${next}? `;
    $("baseMigrationHelp").textContent=`Enter how many ${next} equal 1 ${current}.`;
  }else{
    $("baseCurrencyMigrationText").textContent=`No spending history or allocated money exists yet. The app will switch to ${next} without converting the starter category amounts. Review those amounts afterward.`;
  }
}
function updateDisplayCurrencyPreview(){
  const code=$("settingsDisplayCurrency")?.value||displayCurrency(),base=baseCurrency(),input=$("settingsDisplayFxRate");
  if(!input)return;
  if(code===base){
    input.value="1";input.disabled=true;
    $("settingsDisplayFxHelp").textContent=`Display and accounting currency are both ${base}.`;
    $("displayCurrencyPreview").textContent=`${money(1000)} stays ${money(1000)}.`;
    return
  }
  input.disabled=false;
  const rate=Number(input.value);
  $("settingsDisplayFxHelp").textContent=`1 ${code} = ${Number.isFinite(rate)&&rate>0?currencyText(rate,base):"? base currency"}`;
  $("displayCurrencyPreview").textContent=Number.isFinite(rate)&&rate>0?`${money(1000)} displays as ${currencyText(1000/rate,code)}.`:"Enter a valid FX rate."
}
function renderSettings(){
  if(!$("settingsBaseCurrency"))return;
  fillCurrencySelect($("settingsBaseCurrency"),baseCurrency());
  fillCurrencySelect($("settingsDisplayCurrency"),displayCurrency());
  $("currentBaseCurrency").textContent=baseCurrency();
  $("settingsDisplayFxRate").value=displayCurrency()===baseCurrency()?1:Number(settings.displayFxToBase||1);
  $("cashGoalInput").value=roundMoneyValue(Number(settings.cashGoalBase)||0);
  $("cashGoalPreview").textContent=`Current goal: ${money(settings.cashGoalBase)}${displayCurrency()!==baseCurrency()?` · ${displayMoney(settings.cashGoalBase)} display`:""}`;
  renderQuickCategorySettings();
  renderBaseMigrationControls();
  updateDisplayCurrencyPreview()
}

function renderAll(){
  ensureMonthBudget(currentMonthKey());ensureMonthBudget(selectedMonth);
  renderCurrencyLabels();renderSpecialTabs();renderMonthSelect();renderReserve();renderRegularSummary();renderQuickCategories();renderDetailCategory();renderRegularCategories();renderBudgetEditor();renderSpecialSummary();renderInsights();renderMonthlyTrend();renderTrendSelect();renderCategoryTrend();renderHistory();renderSettings();
  $("migrationNotice").hidden=!!settings.migrationNoticeDismissed;
  if(selectedSpecialId&&specialById(selectedSpecialId)?.status==="active")renderSpecialPanel();
  persist()
}

function addRegularExpense(amount,category,date,note){
  const v=Number(amount);if(!Number.isFinite(v)||v<=0||!category||!date)return null;
  const e={id:uid("exp"),amount:roundMoneyValue(v),category,date,note:String(note||""),tripId:"",createdAt:Date.now()};regularExpenses.push(e);lastUndo={kind:"regular",expense:e};selectedMonth=monthKey(date);persist();showUndo(`${money(e.amount)} added to ${category}.`);return e
}
function deleteRegularExpense(id){if(!confirm("Delete this regular expense?"))return;regularExpenses=regularExpenses.filter(e=>e.id!==id);persist();renderAll()}
function addSpecialExpense(s,{originalAmount,currency,fxRate,category,walletId,date,note}){
  const amt=Number(originalAmount),rate=currency===baseCurrency()?1:Number(fxRate);if(!Number.isFinite(amt)||amt<=0||!Number.isFinite(rate)||rate<=0)return null;
  const e={id:uid("sexp"),originalAmount:amt,currency,fxRate:rate,amountBase:roundMoneyValue(amt*rate),category,walletId:walletId||"",date,note:String(note||""),createdAt:Date.now()};
  if(walletId){const w=(s.wallets||[]).find(x=>x.id===walletId);if(!w)return null;w.balance=Number(w.balance||0)-amt}
  s.expenses=s.expenses||[];s.expenses.push(e);lastUndo={kind:"special",specialId:s.id,expense:e};persist();showUndo(`${fmt(amt,currency)} added to ${s.name}.`);return e
}
function deleteSpecialExpense(sid,eid){
  const s=specialById(sid),e=s?.expenses?.find(x=>x.id===eid);if(!s||!e||!confirm("Delete this Special Budget expense?"))return;
  if(e.walletId){const w=(s.wallets||[]).find(x=>x.id===e.walletId);if(w)w.balance=Number(w.balance||0)+Number(e.originalAmount||0)}
  s.expenses=s.expenses.filter(x=>x.id!==eid);persist();renderAll()
}
function deleteSpecialTransfer(sid,tid){
  const s=specialById(sid),t=s?.transfers?.find(x=>x.id===tid);if(!s||!t||!confirm("Delete this transfer and reverse wallet balances?"))return;
  const from=(s.wallets||[]).find(w=>w.id===t.fromWalletId),to=(s.wallets||[]).find(w=>w.id===t.toWalletId);
  if(from)from.balance=Number(from.balance||0)+Number(t.fromAmount||0);if(to)to.balance=Number(to.balance||0)-Number(t.toAmount||0);
  s.transfers=s.transfers.filter(x=>x.id!==tid);persist();renderAll()
}
function showUndo(text){if(undoTimer)clearTimeout(undoTimer);$("undoText").textContent=text;$("undoToast").hidden=false;undoTimer=setTimeout(()=>{$("undoToast").hidden=true;lastUndo=null},8000)}

function downloadText(name,text,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
const csvEscape=v=>`"${String(v??"").replace(/"/g,'""')}"`;

document.querySelectorAll(".tab-btn").forEach(b=>b.addEventListener("click",()=>{if(!b.dataset.specialId)renderTabs(b.dataset.tab)}));
$("monthSelect").addEventListener("change",()=>{selectedMonth=$("monthSelect").value;$("budgetEditor").hidden=true;renderAll()});
$("privacyBtn").addEventListener("click",()=>{privacyHidden=!privacyHidden;renderReserve()});
$("toggleReserveEditorBtn").addEventListener("click",()=>{$("reserveEditor").hidden=!$("reserveEditor").hidden});
$("saveReserveBtn").addEventListener("click",()=>{const v=Number($("reserveInput").value);if(!Number.isFinite(v)||v<0)return;reserveBase=roundMoneyValue(v);$("reserveEditor").hidden=true;persist();renderReserve()});
$("dismissMigrationNoticeBtn").addEventListener("click",()=>{settings.migrationNoticeDismissed=true;persist();$("migrationNotice").hidden=true});

$("settingsBaseCurrency").addEventListener("change",renderBaseMigrationControls);
$("baseMigrationRate").addEventListener("input",()=>{
  const old=baseCurrency(),next=$("settingsBaseCurrency").value,rate=Number($("baseMigrationRate").value);
  $("baseMigrationHelp").textContent=Number.isFinite(rate)&&rate>0?`${money(1000)} would become ${currencyText(1000*rate,next)}.`:`Enter how many ${next} equal 1 ${old}.`
});
$("saveBaseCurrencyBtn").addEventListener("click",()=>{
  const next=$("settingsBaseCurrency").value,current=baseCurrency();
  if(next===current){$("baseCurrencyMessage").textContent="Base currency is already set.";return}
  if(!hasFinancialActivity()){
    settings.baseCurrency=next;settings.displayCurrency=next;settings.displayFxToBase=1;
    $("baseCurrencyMessage").textContent=`Base currency changed to ${next}. Review your starter budget amounts and cash goal.`;
    persist();renderAll();return
  }
  const factor=Number($("baseMigrationRate").value);
  if(!Number.isFinite(factor)||factor<=0){$("baseCurrencyMessage").textContent=`Enter the conversion rate from ${current} to ${next}.`;return}
  if(!confirm(`Convert all accounting values from ${current} to ${next} using 1 ${current} = ${factor} ${next}? This changes stored base amounts.`))return;
  if(!convertBaseCurrency(next,factor)){ $("baseCurrencyMessage").textContent="Could not change the base currency.";return}
  $("baseCurrencyMessage").textContent=`Base currency changed to ${next}.`;
  $("baseMigrationRate").value="";
  persist();renderAll()
});
$("settingsDisplayCurrency").addEventListener("change",()=>{
  const code=$("settingsDisplayCurrency").value;
  if(code===baseCurrency())$("settingsDisplayFxRate").value="1";
  updateDisplayCurrencyPreview()
});
$("settingsDisplayFxRate").addEventListener("input",updateDisplayCurrencyPreview);
$("saveDisplayCurrencyBtn").addEventListener("click",()=>{
  const code=$("settingsDisplayCurrency").value,rate=code===baseCurrency()?1:Number($("settingsDisplayFxRate").value);
  if(code!==baseCurrency()&&(!Number.isFinite(rate)||rate<=0)){ $("displayCurrencyMessage").textContent="Enter a valid FX rate.";return}
  settings.displayCurrency=code;settings.displayFxToBase=rate;
  $("displayCurrencyMessage").textContent=code===baseCurrency()?`Main budget now displays in ${code}.`:`Main budget now displays in ${code}; records remain in ${baseCurrency()}.`;
  persist();renderAll()
});
$("saveCashGoalBtn").addEventListener("click",()=>{
  const v=Number($("cashGoalInput").value);
  if(!Number.isFinite(v)||v<0){$("cashGoalMessage").textContent="Enter a valid cash goal.";return}
  settings.cashGoalBase=roundMoneyValue(v);
  $("cashGoalMessage").textContent=`Cash goal saved at ${money(settings.cashGoalBase)}.`;
  persist();renderAll()
});
$("saveQuickCategoriesBtn").addEventListener("click",()=>{
  const selected=[...$("quickCategorySettings").querySelectorAll('input[type="checkbox"]:checked')].map(i=>i.value);
  if(!selected.length){$("quickCategorySettingsMessage").textContent="Choose at least one Quick Entry category.";return}
  settings.quickCategories=selected;
  $("quickCategorySettingsMessage").textContent="Quick Entry categories saved.";
  persist();renderAll()
});

$("quickExpenseForm").addEventListener("submit",e=>{e.preventDefault();const x=addRegularExpense($("quickAmount").value,selectedQuickCategory,todayISO(),"");if(x){$("quickAmount").value="";$("quickMessage").textContent=`Added ${money(x.amount)} to ${x.category}.`;renderAll()}});
$("moreDetailsBtn").addEventListener("click",()=>{const f=$("detailExpenseForm");f.hidden=!f.hidden;$("moreDetailsBtn").textContent=f.hidden?"More details":"Hide details";if(!f.hidden)$("detailDate").value=todayISO()});
$("detailExpenseForm").addEventListener("submit",e=>{e.preventDefault();const x=addRegularExpense($("detailAmount").value,$("detailCategory").value,$("detailDate").value,$("detailNote").value.trim());if(x){$("detailExpenseForm").reset();$("detailDate").value=todayISO();renderAll()}});

$("editBudgetsBtn").addEventListener("click",()=>{
  const editor=$("budgetEditor");
  renderBudgetEditor();
  editor.hidden=false;
  $("editBudgetsBtn").textContent="Editing…";
  requestAnimationFrame(()=>editor.scrollIntoView({behavior:"smooth",block:"start"}));
});
$("closeBudgetsBtn").addEventListener("click",()=>{
  $("budgetEditor").hidden=true;
  $("editBudgetsBtn").textContent="Edit budgets";
});
$("stageCategoryBtn").addEventListener("click",()=>{
  const name=$("newCategoryName").value.trim(),value=Number($("newCategoryBudget").value);
  if(!name||!Number.isFinite(value)||value<0){$("budgetSaveMessage").textContent="Enter a name and valid budget.";return}
  const existing=[...$("budgetFields").querySelectorAll(".budget-editor-row")].some(row=>row.dataset.category.toLowerCase()===name.toLowerCase());
  if(existing){$("budgetSaveMessage").textContent="That category is already in the editor.";return}
  $("budgetFields").appendChild(createBudgetEditorRow(name,value));
  updateBudgetEditorControls();
  $("newCategoryName").value="";
  $("newCategoryBudget").value="";
  $("budgetSaveMessage").textContent="Category staged. Tap Save budgets."
});
$("saveBudgetsBtn").addEventListener("click",()=>{
  const updated={};
  $("budgetFields").querySelectorAll(".budget-editor-row").forEach(row=>{
    const input=row.querySelector("input[data-category]");
    if(!input)return;
    const value=Number(input.value);
    if(Number.isFinite(value)&&value>=0)updated[input.dataset.category]=roundMoneyValue(value)
  });
  const scope=document.querySelector('input[name="budgetScope"]:checked')?.value||"month";
  monthBudgets[selectedMonth]=clone(updated);
  if(scope==="future"){
    templateBudgets=clone(updated);
    Object.keys(monthBudgets).forEach(month=>{
      if(month>selectedMonth)monthBudgets[month]=clone(updated)
    });
    settings.quickCategories=(settings.quickCategories||[]).filter(name=>name in templateBudgets)
  }
  persist();
  $("budgetSaveMessage").textContent="Budget categories and order saved.";
  renderAll();
  setTimeout(()=>{
    $("budgetEditor").hidden=true;
    $("editBudgetsBtn").textContent="Edit budgets";
    $("budgetSaveMessage").textContent=""
  },700)
});

$("openSpecialCreatorBtn").addEventListener("click",()=>{$("specialCreator").hidden=false});
$("closeSpecialCreatorBtn").addEventListener("click",()=>{$("specialCreator").hidden=true});
document.querySelectorAll(".type-btn").forEach(b=>b.addEventListener("click",()=>{selectedSpecialType=b.dataset.type;document.querySelectorAll(".type-btn").forEach(x=>x.classList.toggle("active",x===b));$("travelCreatorFields").hidden=selectedSpecialType!=="travel"}));
$("specialBudgetForm").addEventListener("submit",e=>{
  e.preventDefault();const name=$("specialName").value.trim(),alloc=Number($("specialAllocation").value),start=$("specialStart").value,end=$("specialEnd").value;
  if(!name||!Number.isFinite(alloc)||alloc<=0||alloc>reserveBase||!start||!end||end<start){$("specialCreateMessage").textContent=alloc>reserveBase?"Allocation is larger than your available cash reserve.":"Check the name, amount, and dates.";return}
  let currency=baseCurrency(),fx=1;if(selectedSpecialType==="travel"){currency=$("specialCurrency").value;fx=Number($("specialFxRate").value);if(!Number.isFinite(fx)||fx<=0){$("specialCreateMessage").textContent="Enter a valid FX rate.";return}}
  reserveBase-=alloc;
  const s={id:uid("special"),type:selectedSpecialType,name,allocatedBase:alloc,startDate:start,endDate:end,localCurrency:currency,fxRate:fx,categories:clone(DEFAULT_SPECIAL_CATEGORIES[selectedSpecialType]),wallets:[],expenses:[],transfers:[],status:"active",createdAt:Date.now(),returnedBase:0,retainedUnreturnedBase:0};
  specialBudgets.push(s);selectedSpecialId=s.id;$("specialBudgetForm").reset();$("specialStart").value=todayISO();$("specialEnd").value=todayISO();$("specialCreator").hidden=true;persist();renderAll();renderSpecialPanel();renderTabs("special")
});

$("specialDisplayCurrency").addEventListener("change",()=>{
  const s=specialById(selectedSpecialId);if(!s)return;
  const code=$("specialDisplayCurrency").value;
  if(code===baseCurrency())$("specialDisplayFxRate").value="1";
  else if(code===specialCurrencyCode(s)&&Number(s.fxRate)>0)$("specialDisplayFxRate").value=Number(s.fxRate);
  updateSpecialCurrencyPreview(s)
});
$("specialDisplayFxRate").addEventListener("input",()=>{
  const s=specialById(selectedSpecialId);if(s)updateSpecialCurrencyPreview(s)
});
$("saveSpecialCurrencyBtn").addEventListener("click",()=>{
  const s=specialById(selectedSpecialId);if(!s)return;
  const code=$("specialDisplayCurrency").value;
  const rate=code===baseCurrency()?1:Number($("specialDisplayFxRate").value);
  if(code!==baseCurrency()&&(!Number.isFinite(rate)||rate<=0)){
    $("specialCurrencyMessage").textContent="Enter a valid FX rate.";
    return
  }
  s.localCurrency=code;
  s.fxRate=rate;
  $("specialCurrencyMessage").textContent=code===baseCurrency()?"Secondary currency hidden for this Special Budget.":`Saved ${code}: 1 ${code} = ${currencyText(rate,baseCurrency())}.`;
  persist();renderAll();renderSpecialPanel()
});

$("increaseSpecialBtn").addEventListener("click",()=>{$("increaseSpecialForm").hidden=!$("increaseSpecialForm").hidden});
$("saveIncreaseSpecialBtn").addEventListener("click",()=>{const s=specialById(selectedSpecialId),v=Number($("increaseSpecialAmount").value);if(!s||!Number.isFinite(v)||v<=0||v>reserveBase){$("specialActionMessage").textContent=v>reserveBase?"Not enough available reserve.":"Enter a valid amount.";return}reserveBase-=v;s.allocatedBase=Number(s.allocatedBase||0)+v;$("increaseSpecialAmount").value="";$("increaseSpecialForm").hidden=true;persist();renderAll();renderSpecialPanel()});
$("finishSpecialBtn").addEventListener("click",()=>{const s=specialById(selectedSpecialId);if(!s)return;$("finishReturnAmount").value=Math.max(0,Math.floor(specialRemaining(s)));$("finishSpecialForm").hidden=!$("finishSpecialForm").hidden});
$("confirmFinishSpecialBtn").addEventListener("click",()=>{const s=specialById(selectedSpecialId),rem=Math.max(0,specialRemaining(s)),ret=Number($("finishReturnAmount").value);if(!s||!Number.isFinite(ret)||ret<0||ret>rem){$("specialActionMessage").textContent=`Return amount must be between ${money(0)} and the remaining allocation.`;return}reserveBase+=ret;s.returnedBase=ret;s.retainedUnreturnedBase=rem-ret;s.status="archived";s.closedAt=todayISO();selectedSpecialId="";persist();renderAll();renderTabs("budget")});

$("specialExpenseForm").addEventListener("submit",e=>{
  e.preventDefault();const s=specialById(selectedSpecialId);if(!s)return;
  const cur=s.type==="travel"?$("specialExpenseCurrency").value:baseCurrency(),fx=s.type==="travel"?Number($("specialExpenseFx").value):1,wid=s.type==="travel"?$("specialExpenseWallet").value:"";
  const x=addSpecialExpense(s,{originalAmount:$("specialExpenseAmount").value,currency:cur,fxRate:fx,category:$("specialExpenseCategory").value,walletId:wid,date:$("specialExpenseDate").value,note:$("specialExpenseNote").value.trim()});
  if(!x){$("specialExpenseMessage").textContent="Check the amount, FX rate and wallet.";return}
  const over=-specialRemaining(s);$("specialExpenseMessage").textContent=over>0?`Expense saved. This Special Budget is ${money(over)} over budget.`:"Expense saved.";
  $("specialExpenseForm").reset();$("specialExpenseDate").value=todayISO();renderAll();renderSpecialPanel()
});
$("showSpecialCategoryEditorBtn").addEventListener("click",()=>{
  const s=specialById(selectedSpecialId);
  const editor=$("specialCategoryEditor");
  if(!s)return;
  if(editor.hidden){
    renderSpecialCategoryEditor(s);
    editor.hidden=false;
    $("showSpecialCategoryEditorBtn").textContent="Close editor";
    requestAnimationFrame(()=>editor.scrollIntoView({behavior:"smooth",block:"center"}));
  }else{
    editor.hidden=true;
    $("showSpecialCategoryEditorBtn").textContent="Edit";
  }
});
$("addSpecialCategoryBtn").addEventListener("click",()=>{const s=specialById(selectedSpecialId),n=$("specialNewCategoryName").value.trim(),v=Number($("specialNewCategoryBudget").value);if(!s||!n||!Number.isFinite(v)||v<0)return;s.categories[n]=roundMoneyValue(v);$("specialNewCategoryName").value="";$("specialNewCategoryBudget").value="";renderSpecialCategories(s)});
$("saveSpecialCategoriesBtn").addEventListener("click",()=>{const s=specialById(selectedSpecialId);if(!s)return;const u={};$("specialCategoryFields").querySelectorAll("input[data-category]").forEach(i=>{const v=Number(i.value);if(Number.isFinite(v)&&v>=0)u[i.dataset.category]=roundMoneyValue(v)});s.categories=u;persist();$("specialCategoryEditor").hidden=true;$("showSpecialCategoryEditorBtn").textContent="Edit";renderSpecialPanel()});

$("specialWalletForm").addEventListener("submit",e=>{e.preventDefault();const s=specialById(selectedSpecialId),name=$("specialWalletName").value.trim(),bal=Number($("specialWalletBalance").value),cur=$("specialWalletCurrency").value;if(!s||s.type!=="travel"||!name||!Number.isFinite(bal)||bal<0)return;s.wallets.push({id:uid("wallet"),name,currency:cur,balance:bal});$("specialWalletForm").reset();persist();renderSpecialPanel()});
$("specialTransferForm").addEventListener("submit",e=>{
  e.preventDefault();const s=specialById(selectedSpecialId),fromId=$("specialTransferFrom").value,toId=$("specialTransferTo").value,fa=Number($("specialTransferFromAmount").value),ta=Number($("specialTransferToAmount").value);if(!s||!toId||!Number.isFinite(ta)||ta<=0){$("specialTransferMessage").textContent="Choose a destination wallet and valid amount.";return}
  const to=s.wallets.find(w=>w.id===toId),from=fromId==="pool"?null:s.wallets.find(w=>w.id===fromId);if(!to){return}
  if(fromId!=="pool"&&(!from||!Number.isFinite(fa)||fa<=0)){ $("specialTransferMessage").textContent="Enter the amount sent from the source wallet.";return}
  if(from)from.balance=Number(from.balance||0)-fa;to.balance=Number(to.balance||0)+ta;
  s.transfers.push({id:uid("tr"),fromWalletId:fromId,toWalletId:toId,fromAmount:from?fa:0,toAmount:ta,date:$("specialTransferDate").value||todayISO(),note:$("specialTransferNote").value.trim(),createdAt:Date.now()});
  $("specialTransferForm").reset();$("specialTransferDate").value=todayISO();$("specialTransferMessage").textContent="Transfer recorded. It did not count as spending.";persist();renderSpecialPanel()
});

$("undoBtn").addEventListener("click",()=>{if(!lastUndo)return;if(lastUndo.kind==="regular"){regularExpenses=regularExpenses.filter(e=>e.id!==lastUndo.expense.id)}else{const s=specialById(lastUndo.specialId),e=lastUndo.expense;if(s){if(e.walletId){const w=s.wallets.find(x=>x.id===e.walletId);if(w)w.balance=Number(w.balance||0)+Number(e.originalAmount||0)}s.expenses=s.expenses.filter(x=>x.id!==e.id)}}lastUndo=null;$("undoToast").hidden=true;if(undoTimer)clearTimeout(undoTimer);persist();renderAll();if(selectedSpecialId)renderSpecialPanel()});

$("trendCategory").addEventListener("change",renderCategoryTrend);
$("clearSelectedMonthBtn").addEventListener("click",()=>{if(!confirm(`Delete ALL regular expenses for ${monthLabel(selectedMonth)}? Special Budget activity will not be touched.`))return;regularExpenses=regularExpenses.filter(e=>monthKey(e.date)!==selectedMonth||isMigratedV6TripExpense(e));persist();renderAll()});

$("exportBackupBtn").addEventListener("click",()=>{const data={version:"8.2.1",exportedAt:new Date().toISOString(),reserveBase,templateBudgets,monthBudgets,regularExpenses,specialBudgets,settings};downloadText(`budget-tracker-backup-${todayISO()}.json`,JSON.stringify(data,null,2),"application/json");$("backupMessage").textContent="Backup exported."});
$("exportCsvBtn").addEventListener("click",()=>{
  const header=["Scope","Special_Budget","Date","Category","Original_Amount","Currency","FX_to_Base","Amount_Base","Base_Currency","Note"],rows=[];
  regularExpenses.filter(e=>!isMigratedV6TripExpense(e)).forEach(e=>rows.push(["Regular","",e.date,e.category,e.amount,baseCurrency(),1,e.amount,baseCurrency(),e.note||""]));
  specialBudgets.forEach(s=>(s.expenses||[]).forEach(e=>rows.push(["Special",s.name,e.date,e.category,e.originalAmount,e.currency,e.fxRate,e.amountBase,baseCurrency(),e.note||""])));
  const csv=[header,...rows].map(r=>r.map(csvEscape).join(",")).join("\n");downloadText(`budget-expenses-${todayISO()}.csv`,csv,"text/csv;charset=utf-8");$("backupMessage").textContent="CSV exported."
});
$("importBackupInput").addEventListener("change",async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const d=JSON.parse(await file.text());
    if(!d||(!Array.isArray(d.regularExpenses)&&!Array.isArray(d.expenses)))throw new Error();
    if(!confirm("Import this backup and replace data on this device?")){e.target.value="";return}

    const incomingSettings={...DEFAULT_SETTINGS,...(d.settings||{})};
    // Backups made before v8 were TWD accounting files.
    if(!(d.settings&&d.settings.baseCurrency))incomingSettings.baseCurrency="TWD";
    if(!(d.settings&&d.settings.displayCurrency))incomingSettings.displayCurrency=incomingSettings.baseCurrency;
    if(!(d.settings&&Number(d.settings.displayFxToBase)>0))incomingSettings.displayFxToBase=1;
    if(!(d.settings&&Number(d.settings.cashGoalBase)>=0))incomingSettings.cashGoalBase=300000;
    if(!Array.isArray(incomingSettings.quickCategories))incomingSettings.quickCategories=clone(DEFAULT_SETTINGS.quickCategories);
    incomingSettings.theme="classic-functional";

    settings=incomingSettings;
    reserveBase=Math.max(0,Number(d.reserveBase ?? d.reserveTwd ?? d.cashReserve ?? 0)||0);
    templateBudgets=d.templateBudgets||clone(DEFAULT_BUDGETS);
    monthBudgets=d.monthBudgets||{};
    regularExpenses=normalizeRegular(d.regularExpenses||d.expenses||[]);
    specialBudgets=normalizeSpecialBudgets(Array.isArray(d.specialBudgets)?d.specialBudgets:[]);
    selectedMonth=currentMonthKey();selectedSpecialId="";
    applyTheme();persist();renderAll();renderTabs("budget");
    $("backupMessage").textContent=`Backup imported. Base currency: ${baseCurrency()}.`;
  }catch{
    $("backupMessage").textContent="Could not import this backup file.";
  }finally{e.target.value=""}
});


if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));

$("detailDate").value=todayISO();$("specialStart").value=todayISO();$("specialEnd").value=todayISO();$("specialExpenseDate").value=todayISO();$("specialTransferDate").value=todayISO();$("travelCreatorFields").hidden=false;
initReserve();migrateV6Trips();ensureMonthBudget(currentMonthKey());applyTheme();persist();renderTabs("budget");renderAll();
})();
