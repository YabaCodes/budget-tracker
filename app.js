(() => {
"use strict";

const GOAL=300000;
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
const CURRENCIES=["TWD","JPY","USD","EUR","CHF","KRW","GBP"];

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
const money=x=>"NT$"+Math.round(Number(x)||0).toLocaleString("en-US");
const fmt=(x,c)=>`${c} ${Number(x||0).toLocaleString("en-US",{maximumFractionDigits:2})}`;
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
let settings=loadJSON(STORAGE.settings,{migrationNoticeDismissed:false});
let reserveTwd=0;
let selectedMonth=currentMonthKey();
let selectedQuickCategory="Food & groceries";
let selectedSpecialId="";
let selectedSpecialType="travel";
let privacyHidden=true;
let lastUndo=null,undoTimer=null;

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

function initReserve(){
  const saved=localStorage.getItem(STORAGE.reserve);
  if(saved!==null){reserveTwd=Math.max(0,Number(saved)||0);return}
  const v6accounts=loadJSON(STORAGE.v6Accounts,[]);
  if(Array.isArray(v6accounts)&&v6accounts.length){
    const included=v6accounts.filter(a=>a.includeInReserve&&a.currency==="TWD").reduce((s,a)=>s+(Number(a.balance)||0),0);
    if(included>0){reserveTwd=included;localStorage.setItem(STORAGE.reserve,String(reserveTwd));return}
  }
  reserveTwd=Math.max(0,Number(localStorage.getItem(STORAGE.legacyCash)||0));
  localStorage.setItem(STORAGE.reserve,String(reserveTwd));
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
      amountTwd:Number(e.amount)||0,
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
      allocatedTwd:Number(t.budgetTwd)||0,
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
  localStorage.setItem(STORAGE.reserve,String(reserveTwd));
  localStorage.setItem(STORAGE.legacyCash,String(reserveTwd));
  localStorage.setItem(STORAGE.specialBudgets,JSON.stringify(specialBudgets));
  localStorage.setItem(STORAGE.settings,JSON.stringify(settings));
}

function ensureMonthBudget(mk){if(!monthBudgets[mk])monthBudgets[mk]=clone(templateBudgets);return monthBudgets[mk]}
function isMigratedV6TripExpense(e){return e.tripId&&specialBudgets.some(s=>s.importedFromV6&&s.id===e.tripId)}
const regularForMonth=mk=>regularExpenses.filter(e=>monthKey(e.date)===mk&&!isMigratedV6TripExpense(e));
const totalRegularSpent=mk=>regularForMonth(mk).reduce((s,e)=>s+Number(e.amount||0),0);
const totalRegularBudget=mk=>Object.values(ensureMonthBudget(mk)).reduce((s,v)=>s+Number(v||0),0);
function regularSpentByCategory(mk){const o={};Object.keys(ensureMonthBudget(mk)).forEach(k=>o[k]=0);regularForMonth(mk).forEach(e=>o[e.category]=(o[e.category]||0)+Number(e.amount||0));return o}
function specialSpent(s){return (s.expenses||[]).reduce((sum,e)=>sum+Number(e.amountTwd||0),0)}
function specialRemaining(s){return Number(s.allocatedTwd||0)-specialSpent(s)}
const activeSpecials=()=>specialBudgets.filter(s=>s.status==="active");
const archivedSpecials=()=>specialBudgets.filter(s=>s.status==="archived");
const specialById=id=>specialBudgets.find(s=>s.id===id);

// v7.2: JPY convenience conversion. Uses the active Japan/Japanese-yen travel budget rate
// when available, otherwise the most recent JPY travel budget rate.
function getJpyFxRate(){
  const selected=specialById(selectedSpecialId);
  if(selected?.type==="travel"&&selected.localCurrency==="JPY"&&Number(selected.fxRate)>0)return Number(selected.fxRate);
  const active=activeSpecials().find(s=>s.type==="travel"&&s.localCurrency==="JPY"&&Number(s.fxRate)>0);
  if(active)return Number(active.fxRate);
  const recent=[...specialBudgets].filter(s=>s.type==="travel"&&s.localCurrency==="JPY"&&Number(s.fxRate)>0).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0];
  return recent?Number(recent.fxRate):null;
}
function jpyText(twd,{masked=false}={}){
  const rate=getJpyFxRate();
  if(!rate)return "";
  if(masked)return "≈ ¥••••••";
  const yen=Math.round((Number(twd)||0)/rate);
  return `≈ ¥${yen.toLocaleString("en-US")}`;
}
function jpyHtml(twd){
  const text=jpyText(twd);
  return text?`<div class="jpy-conversion">${text}</div>`:"";
}
function setJpyBelow(id,twd,{masked=false}={}){
  const el=$(id);if(!el)return;
  let sub=el.nextElementSibling;
  if(!sub||!sub.classList.contains("jpy-conversion")){sub=document.createElement("div");sub.className="jpy-conversion";el.insertAdjacentElement("afterend",sub)}
  const text=jpyText(twd,{masked});
  sub.textContent=text;sub.hidden=!text;
}
function attachEditorJpy(input){
  const sub=document.createElement("div");sub.className="jpy-conversion editor-jpy";
  const update=()=>{const text=jpyText(Number(input.value)||0);sub.textContent=text;sub.hidden=!text};
  input.insertAdjacentElement("afterend",sub);input.addEventListener("input",update);update();
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

function renderTabs(active){
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active",b.dataset.tab===active||(active==="special"&&b.dataset.specialId===selectedSpecialId)));
  document.querySelectorAll(".tab-panel").forEach(p=>p.hidden=p.id!==`tab-${active}`);
}
function renderSpecialTabs(){
  const mount=$("specialTabMount");mount.innerHTML="";
  activeSpecials().forEach(s=>{
    const b=document.createElement("button");b.type="button";b.className="tab-btn special-tab-btn";b.dataset.tab="special";b.dataset.specialId=s.id;
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
  const pct=Math.min(100,reserveTwd/GOAL*100),left=Math.max(0,GOAL-reserveTwd);
  $("cashReserve").textContent=privacyHidden?"NT$••••••":money(reserveTwd);
  setJpyBelow("cashReserve",reserveTwd,{masked:privacyHidden});
  $("goalPercent").textContent=privacyHidden?"•••%":pct.toFixed(1)+"%";
  $("goalRemaining").textContent=privacyHidden?"NT$•••••• to goal":money(left)+" to goal";
  $("goalBar").style.width=pct+"%";$("privacyBtn").textContent=privacyHidden?"👁":"🙈";$("reserveInput").value=Math.round(reserveTwd);
  const act=activeSpecials(),alloc=act.reduce((x,s)=>x+Number(s.allocatedTwd||0),0),spent=act.reduce((x,s)=>x+specialSpent(s),0),remain=act.reduce((x,s)=>x+Math.max(0,specialRemaining(s)),0);
  $("activeSpecialAllocated").textContent=money(alloc);$("activeSpecialSpent").textContent=money(spent);$("activeSpecialRemaining").textContent=money(remain);
  setJpyBelow("activeSpecialAllocated",alloc);setJpyBelow("activeSpecialSpent",spent);setJpyBelow("activeSpecialRemaining",remain)
}
function renderRegularSummary(){
  const spent=totalRegularSpent(selectedMonth),budget=totalRegularBudget(selectedMonth),rem=budget-spent,u=budget?spent/budget:0;
  $("monthSummaryTitle").textContent=`${monthLabel(selectedMonth)} regular budget`;
  $("monthlyBudget").textContent=money(budget);$("monthlySpent").textContent=money(spent);$("monthlyRemaining").textContent=money(Math.max(0,rem));
  setJpyBelow("monthlyBudget",budget);setJpyBelow("monthlySpent",spent);setJpyBelow("monthlyRemaining",Math.max(0,rem));
  $("monthBudgetBar").style.width=Math.min(100,u*100)+"%";
  if(selectedMonth===currentMonthKey()){const e=elapsedRatio(selectedMonth);$("paceMessage").textContent=u>e+.05?`Regular spending is ahead of pace: ${(u*100).toFixed(0)}% used with ${(e*100).toFixed(0)}% of the month elapsed.`:`Regular spending pace looks controlled: ${(u*100).toFixed(0)}% used with ${(e*100).toFixed(0)}% of the month elapsed.`}
  else $("paceMessage").textContent=rem>=0?`${money(rem)} finished unspent.`:`${money(Math.abs(rem))} over budget.`
}
function renderQuickCategories(){
  const b=ensureMonthBudget(currentMonthKey()),names=Object.keys(b),wrap=$("quickCategories");
  if(!(selectedQuickCategory in b))selectedQuickCategory=names[0]||"Miscellaneous";wrap.innerHTML="";
  names.slice(0,8).forEach(n=>{const btn=document.createElement("button");btn.type="button";btn.className="chip"+(n===selectedQuickCategory?" active":"");btn.textContent=n.replace(" & groceries","");btn.addEventListener("click",()=>{selectedQuickCategory=n;renderQuickCategories();$("quickMessage").textContent=`Selected: ${n}`});wrap.appendChild(btn)})
}
function renderDetailCategory(){
  const s=$("detailCategory"),prev=s.value,b=ensureMonthBudget(currentMonthKey());s.innerHTML="";
  Object.keys(b).forEach(n=>{const o=document.createElement("option");o.value=n;o.textContent=n;s.appendChild(o)});if(prev in b)s.value=prev
}
function renderRegularCategories(){
  const b=ensureMonthBudget(selectedMonth),sm=regularSpentByCategory(selectedMonth),wrap=$("categoryList");$("categoryMonthLabel").textContent=monthLabel(selectedMonth);wrap.innerHTML="";
  Object.entries(b).forEach(([n,bv])=>{const bud=Number(bv)||0,used=sm[n]||0,rem=bud-used,pct=bud?Math.min(100,used/bud*100):(used?100:0),st=status(used,bud,selectedMonth),row=document.createElement("div");row.className="category-row";row.innerHTML=`<div class="category-top"><div><div class="category-name">${esc(n)}</div><div class="category-meta">${money(used)} spent · ${money(Math.max(0,rem))} remaining</div><span class="status ${st}">${statusLabel(st)}</span></div><div class="budget-amount-block"><strong>${money(bud)}</strong>${jpyHtml(bud)}</div></div><div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>`;wrap.appendChild(row)})
}
function renderBudgetEditor(){
  const wrap=$("budgetFields");wrap.innerHTML="";$("budgetEditorTitle").textContent=`Edit ${monthLabel(selectedMonth)} budgets`;
  Object.entries(ensureMonthBudget(selectedMonth)).forEach(([n,v])=>{const l=document.createElement("label");l.textContent=n;const i=document.createElement("input");i.type="number";i.min="0";i.step="1";i.value=Math.round(Number(v)||0);i.dataset.category=n;l.appendChild(i);wrap.appendChild(l);attachEditorJpy(i)})
}

function renderSpecialSummary(){
  const wrap=$("specialBudgetSummaryList"),act=activeSpecials();wrap.innerHTML="";
  if(!act.length){wrap.innerHTML='<div class="empty">No active Special Budgets.</div>';return}
  act.forEach(s=>{const spent=specialSpent(s),rem=specialRemaining(s),row=document.createElement("div");row.className="special-row";row.innerHTML=`<div><div class="special-name">${TYPE_META[s.type]?.icon||"📦"} ${esc(s.name)}</div><div class="special-meta">${TYPE_META[s.type]?.label||"Special"} · ${money(spent)} spent</div></div><div class="special-right"><strong>${money(Math.max(0,rem))}</strong>${jpyHtml(Math.max(0,rem))}<div class="special-meta">remaining</div></div>`;row.addEventListener("click",()=>{selectedSpecialId=s.id;renderSpecialPanel();renderTabs("special")});wrap.appendChild(row)})
}
function renderSpecialPanel(){
  const s=specialById(selectedSpecialId)||activeSpecials()[0];if(!s)return;selectedSpecialId=s.id;
  $("specialCategoryEditor").hidden=true;
  $("showSpecialCategoryEditorBtn").textContent="Edit";
  const spent=specialSpent(s),rem=specialRemaining(s),pct=s.allocatedTwd?Math.min(100,spent/s.allocatedTwd*100):0,meta=TYPE_META[s.type]||TYPE_META.other;
  $("specialTypeLabel").textContent=meta.label;$("specialTitle").textContent=s.name;$("specialDates").textContent=`${s.startDate} → ${s.endDate}`;
  $("specialRemaining").textContent=money(Math.max(0,rem));$("specialAllocated").textContent=money(s.allocatedTwd);$("specialSpent").textContent=money(spent);
  setJpyBelow("specialRemaining",Math.max(0,rem));setJpyBelow("specialAllocated",s.allocatedTwd);setJpyBelow("specialSpent",spent);
  $("specialProgressBar").style.width=pct+"%";$("finishReturnAmount").value=Math.max(0,Math.floor(rem));
  renderSpecialCategorySelect(s);renderSpecialCategories(s);renderSpecialWallets(s);renderSpecialTransactions(s);
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
  const spentMap={};(s.expenses||[]).forEach(e=>spentMap[e.category]=(spentMap[e.category]||0)+Number(e.amountTwd||0));
  const wrap=$("specialCategoryList");wrap.innerHTML="";
  Object.entries(s.categories||{}).forEach(([n,bv])=>{const bud=Number(bv)||0,used=spentMap[n]||0,rem=bud-used,pct=bud?Math.min(100,used/bud*100):(used?100:0),row=document.createElement("div");row.className="category-row";row.innerHTML=`<div class="category-top"><div><div class="category-name">${esc(n)}</div><div class="category-meta">${money(used)} spent${bud?` · ${money(Math.max(0,rem))} category balance`:""}</div></div><div class="budget-amount-block"><strong>${money(bud)}</strong>${jpyHtml(bud)}</div></div><div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>`;wrap.appendChild(row)});
  renderSpecialCategoryEditor(s)
}
function renderSpecialCategoryEditor(s){
  const wrap=$("specialCategoryFields");wrap.innerHTML="";
  Object.entries(s.categories||{}).forEach(([n,v])=>{const l=document.createElement("label");l.textContent=n;const i=document.createElement("input");i.type="number";i.min="0";i.step="1";i.value=Math.round(Number(v)||0);i.dataset.category=n;l.appendChild(i);wrap.appendChild(l);attachEditorJpy(i)})
}
function fillCurrencySelect(sel,preferred){
  sel.innerHTML="";CURRENCIES.forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c;sel.appendChild(o)});if(CURRENCIES.includes(preferred))sel.value=preferred
}
function renderSpecialWallets(s){
  if(s.type!=="travel")return;
  const wrap=$("specialWalletList");wrap.innerHTML="";
  if(!(s.wallets||[]).length)wrap.innerHTML='<div class="empty">No trip wallets yet. Add Suica, cash, or another prepaid wallet below.</div>';
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
      const orig=e.currency!=="TWD"?`<div class="expense-meta">${fmt(e.originalAmount,e.currency)} → ${money(e.amountTwd)}</div>`:"";
      row.innerHTML=`<div class="expense-top"><div><div class="expense-name">${esc(e.category)}</div><div class="expense-meta">${esc(e.date)}${e.note?" · "+esc(e.note):""}${w?" · "+esc(w.name):""}</div></div><div class="special-right"><strong>${money(e.amountTwd)}</strong>${orig}</div></div>`;
      const b=document.createElement("button");b.type="button";b.className="delete-btn";b.textContent="Delete";b.addEventListener("click",()=>deleteSpecialExpense(s.id,e.id));row.appendChild(b)
    }else{
      const t=it.data,fw=t.fromWalletId==="pool"?{name:"Budget pool",currency:"TWD"}:(s.wallets||[]).find(x=>x.id===t.fromWalletId),tw=(s.wallets||[]).find(x=>x.id===t.toWalletId);
      row.innerHTML=`<div class="expense-top"><div><div class="expense-name">Transfer · ${esc(fw?.name||"Unknown")} → ${esc(tw?.name||"Unknown")}</div><div class="expense-meta">${esc(t.date)}${t.note?" · "+esc(t.note):""}</div></div><div class="special-right"><strong>${fmt(t.toAmount,tw?.currency||"")}</strong><div class="expense-meta">Not spending</div></div></div>`;
      const b=document.createElement("button");b.type="button";b.className="delete-btn";b.textContent="Delete & reverse";b.addEventListener("click",()=>deleteSpecialTransfer(s.id,t.id));row.appendChild(b)
    }
    wrap.appendChild(row)
  })
}

function renderInsights(){
  const sc=scoreForMonth(selectedMonth),b=totalRegularBudget(selectedMonth),sp=totalRegularSpent(selectedMonth),u=b?sp/b:0,e=elapsedRatio(selectedMonth);
  $("budgetScore").textContent=sc+" / 100";$("scoreSummary").textContent=sc>=90?"Excellent regular budget control.":sc>=80?"Strong month with a few areas to watch.":sc>=70?"Generally on track.":"Several regular categories need adjustment.";
  $("pacePercent").textContent=(u*100).toFixed(0)+"%";$("paceInsight").textContent=selectedMonth===currentMonthKey()?`${(e*100).toFixed(0)}% of the month has passed.`:(u<=1?"Finished within regular budget.":"Finished over regular budget.");
  const wrap=$("specialInsightsList");wrap.innerHTML="";const all=[...activeSpecials(),...archivedSpecials()];
  if(!all.length)wrap.innerHTML='<div class="empty">No Special Budget history yet.</div>';
  all.forEach(s=>{const r=document.createElement("div");r.className="special-row";r.innerHTML=`<div><div class="special-name">${TYPE_META[s.type]?.icon||"📦"} ${esc(s.name)}</div><div class="special-meta">${s.status==="active"?"Active":"Archived"} · allocated ${money(s.allocatedTwd)} ${jpyText(s.allocatedTwd)?`· ${jpyText(s.allocatedTwd)}`:""}</div></div><div class="special-right"><strong>${money(specialSpent(s))}</strong>${jpyHtml(specialSpent(s))}<div class="special-meta">spent</div></div>`;wrap.appendChild(r)})
}
function renderMonthlyTrend(){
  const months=trendMonths(6),data=months.map(m=>({m,spent:totalRegularSpent(m),budget:totalRegularBudget(m)})),max=Math.max(1,...data.map(d=>Math.max(d.spent,d.budget))),wrap=$("monthlyTrendChart");wrap.innerHTML="";
  data.forEach(d=>{const h=Math.max(2,Math.round(d.spent/max*100)),c=document.createElement("div");c.className="bar-col";c.innerHTML=`<div class="bar-value">${money(d.spent)}</div><div class="bar-track"><div class="bar-fill" style="height:${h}%"></div></div><div class="bar-label">${shortMonth(d.m)}</div>`;wrap.appendChild(c)})
}
function renderTrendSelect(){
  const s=$("trendCategory"),prev=s.value||"Food & groceries",b=ensureMonthBudget(selectedMonth);s.innerHTML="";Object.keys(b).forEach(n=>{const o=document.createElement("option");o.value=n;o.textContent=n;s.appendChild(o)});if(prev in b)s.value=prev
}
function renderCategoryTrend(){
  const cat=$("trendCategory").value||Object.keys(ensureMonthBudget(selectedMonth))[0],months=trendMonths(6),pts=months.map(m=>({m,spent:regularSpentByCategory(m)[cat]||0,budget:Number(ensureMonthBudget(m)[cat])||0}));
  const maxY=Math.max(1,...pts.map(p=>Math.max(p.spent,p.budget))),W=560,H=190,L=42,R=18,T=18,B=34,CW=W-L-R,CH=H-T-B,x=i=>L+(pts.length<=1?CW/2:i/(pts.length-1)*CW),y=v=>T+CH-(v/maxY*CH);
  const sp=pts.map((p,i)=>`${i?"L":"M"} ${x(i).toFixed(1)} ${y(p.spent).toFixed(1)}`).join(" "),bp=pts.map((p,i)=>`${i?"L":"M"} ${x(i).toFixed(1)} ${y(p.budget).toFixed(1)}`).join(" ");
  let svg=`<svg viewBox="0 0 ${W} ${H}">`;[0,.5,1].forEach(f=>{const yy=T+CH-f*CH;svg+=`<line class="chart-grid" x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}"></line><text class="chart-text" x="2" y="${yy+3}">${Math.round(maxY*f)}</text>`});svg+=`<path class="chart-budget" d="${bp}"></path><path class="chart-line" d="${sp}"></path>`;pts.forEach((p,i)=>svg+=`<circle class="chart-dot" cx="${x(i)}" cy="${y(p.spent)}" r="4"></circle><text class="chart-text" text-anchor="middle" x="${x(i)}" y="${H-8}">${shortMonth(p.m)}</text>`);svg+="</svg>";$("categoryTrendChart").innerHTML=svg;
  const vals=pts.map(p=>p.spent),avg=vals.reduce((a,b)=>a+b,0)/vals.length,nz=vals.filter(v=>v>0);let dir="Stable";if(nz.length>=2){const c=(nz[nz.length-1]-nz[0])/nz[0];if(c<=-.1)dir="Improving";else if(c>=.1)dir="Rising"}$("trendAverage").textContent=money(avg);$("trendBudget").textContent=money(Number(ensureMonthBudget(selectedMonth)[cat])||0);$("trendDirection").textContent=dir
}
function renderHistory(){
  const body=$("historyTableBody");body.innerHTML="";
  availableMonths().forEach(m=>{const b=totalRegularBudget(m),s=totalRegularSpent(m),v=b-s,tr=document.createElement("tr");tr.innerHTML=`<td>${monthLabel(m)}</td><td>${money(b)}</td><td>${money(s)}</td><td class="${v>=0?"positive":"negative"}">${v>=0?"+":"−"}${money(Math.abs(v))}</td><td>${scoreForMonth(m)}</td>`;body.appendChild(tr)});
  const wrap=$("expenseList"),rows=[...regularForMonth(selectedMonth)].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);$("historyTitle").textContent=`${monthLabel(selectedMonth)} regular expenses`;wrap.innerHTML="";
  if(!rows.length)wrap.innerHTML='<div class="empty">No regular expenses for this month.</div>';
  rows.forEach(e=>{const r=document.createElement("div");r.className="expense-row";r.innerHTML=`<div class="expense-top"><div><div class="expense-name">${esc(e.category)}</div><div class="expense-meta">${esc(e.date)}${e.note?" · "+esc(e.note):""}</div></div><strong>${money(e.amount)}</strong></div>`;const b=document.createElement("button");b.type="button";b.className="delete-btn";b.textContent="Delete";b.addEventListener("click",()=>deleteRegularExpense(e.id));r.appendChild(b);wrap.appendChild(r)});
  const ar=$("archivedSpecialList");ar.innerHTML="";if(!archivedSpecials().length)ar.innerHTML='<div class="empty">No archived Special Budgets yet.</div>';
  archivedSpecials().forEach(s=>{const r=document.createElement("div");r.className="special-row";r.innerHTML=`<div><div class="special-name">${TYPE_META[s.type]?.icon||"📦"} ${esc(s.name)}</div><div class="special-meta">Allocated ${money(s.allocatedTwd)} · returned ${money(s.returnedTwd||0)}</div></div><div class="special-right"><strong>${money(specialSpent(s))}</strong><div class="special-meta">spent</div></div>`;ar.appendChild(r)})
}

function renderAll(){
  ensureMonthBudget(currentMonthKey());ensureMonthBudget(selectedMonth);
  renderSpecialTabs();renderMonthSelect();renderReserve();renderRegularSummary();renderQuickCategories();renderDetailCategory();renderRegularCategories();renderBudgetEditor();renderSpecialSummary();renderInsights();renderMonthlyTrend();renderTrendSelect();renderCategoryTrend();renderHistory();
  $("migrationNotice").hidden=!!settings.migrationNoticeDismissed;
  if(selectedSpecialId&&specialById(selectedSpecialId)?.status==="active")renderSpecialPanel();
  persist()
}

function addRegularExpense(amount,category,date,note){
  const v=Number(amount);if(!Number.isFinite(v)||v<=0||!category||!date)return null;
  const e={id:uid("exp"),amount:Math.round(v),category,date,note:String(note||""),tripId:"",createdAt:Date.now()};regularExpenses.push(e);lastUndo={kind:"regular",expense:e};selectedMonth=monthKey(date);persist();showUndo(`${money(e.amount)} added to ${category}.`);return e
}
function deleteRegularExpense(id){if(!confirm("Delete this regular expense?"))return;regularExpenses=regularExpenses.filter(e=>e.id!==id);persist();renderAll()}
function addSpecialExpense(s,{originalAmount,currency,fxRate,category,walletId,date,note}){
  const amt=Number(originalAmount),rate=currency==="TWD"?1:Number(fxRate);if(!Number.isFinite(amt)||amt<=0||!Number.isFinite(rate)||rate<=0)return null;
  const e={id:uid("sexp"),originalAmount:amt,currency,fxRate:rate,amountTwd:amt*rate,category,walletId:walletId||"",date,note:String(note||""),createdAt:Date.now()};
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
$("saveReserveBtn").addEventListener("click",()=>{const v=Number($("reserveInput").value);if(!Number.isFinite(v)||v<0)return;reserveTwd=Math.round(v);$("reserveEditor").hidden=true;persist();renderReserve()});
$("dismissMigrationNoticeBtn").addEventListener("click",()=>{settings.migrationNoticeDismissed=true;persist();$("migrationNotice").hidden=true});

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
$("stageCategoryBtn").addEventListener("click",()=>{const n=$("newCategoryName").value.trim(),v=Number($("newCategoryBudget").value);if(!n||!Number.isFinite(v)||v<0){$("budgetSaveMessage").textContent="Enter a name and valid budget.";return}const l=document.createElement("label");l.textContent=n;const i=document.createElement("input");i.type="number";i.min="0";i.step="1";i.value=Math.round(v);i.dataset.category=n;l.appendChild(i);$("budgetFields").appendChild(l);$("newCategoryName").value="";$("newCategoryBudget").value="";$("budgetSaveMessage").textContent="Category staged. Tap Save budgets."});
$("saveBudgetsBtn").addEventListener("click",()=>{const u={};$("budgetFields").querySelectorAll("input[data-category]").forEach(i=>{const v=Number(i.value);if(Number.isFinite(v)&&v>=0)u[i.dataset.category]=Math.round(v)});const sc=document.querySelector('input[name="budgetScope"]:checked')?.value||"month";monthBudgets[selectedMonth]=clone(u);if(sc==="future"){templateBudgets=clone(u);Object.keys(monthBudgets).forEach(m=>{if(m>selectedMonth)monthBudgets[m]=clone(u)})}persist();$("budgetSaveMessage").textContent="Budget saved.";renderAll();setTimeout(()=>{$("budgetEditor").hidden=true;$("editBudgetsBtn").textContent="Edit budgets";$("budgetSaveMessage").textContent=""},700)});

$("openSpecialCreatorBtn").addEventListener("click",()=>{$("specialCreator").hidden=false});
$("closeSpecialCreatorBtn").addEventListener("click",()=>{$("specialCreator").hidden=true});
document.querySelectorAll(".type-btn").forEach(b=>b.addEventListener("click",()=>{selectedSpecialType=b.dataset.type;document.querySelectorAll(".type-btn").forEach(x=>x.classList.toggle("active",x===b));$("travelCreatorFields").hidden=selectedSpecialType!=="travel"}));
$("specialBudgetForm").addEventListener("submit",e=>{
  e.preventDefault();const name=$("specialName").value.trim(),alloc=Number($("specialAllocation").value),start=$("specialStart").value,end=$("specialEnd").value;
  if(!name||!Number.isFinite(alloc)||alloc<=0||alloc>reserveTwd||!start||!end||end<start){$("specialCreateMessage").textContent=alloc>reserveTwd?"Allocation is larger than your available cash reserve.":"Check the name, amount, and dates.";return}
  let currency="TWD",fx=1;if(selectedSpecialType==="travel"){currency=$("specialCurrency").value;fx=Number($("specialFxRate").value);if(!Number.isFinite(fx)||fx<=0){$("specialCreateMessage").textContent="Enter a valid FX rate.";return}}
  reserveTwd-=alloc;
  const s={id:uid("special"),type:selectedSpecialType,name,allocatedTwd:alloc,startDate:start,endDate:end,localCurrency:currency,fxRate:fx,categories:clone(DEFAULT_SPECIAL_CATEGORIES[selectedSpecialType]),wallets:[],expenses:[],transfers:[],status:"active",createdAt:Date.now(),returnedTwd:0};
  specialBudgets.push(s);selectedSpecialId=s.id;$("specialBudgetForm").reset();$("specialStart").value=todayISO();$("specialEnd").value=todayISO();$("specialCreator").hidden=true;persist();renderAll();renderSpecialPanel();renderTabs("special")
});

$("increaseSpecialBtn").addEventListener("click",()=>{$("increaseSpecialForm").hidden=!$("increaseSpecialForm").hidden});
$("saveIncreaseSpecialBtn").addEventListener("click",()=>{const s=specialById(selectedSpecialId),v=Number($("increaseSpecialAmount").value);if(!s||!Number.isFinite(v)||v<=0||v>reserveTwd){$("specialActionMessage").textContent=v>reserveTwd?"Not enough available reserve.":"Enter a valid amount.";return}reserveTwd-=v;s.allocatedTwd=Number(s.allocatedTwd||0)+v;$("increaseSpecialAmount").value="";$("increaseSpecialForm").hidden=true;persist();renderAll();renderSpecialPanel()});
$("finishSpecialBtn").addEventListener("click",()=>{const s=specialById(selectedSpecialId);if(!s)return;$("finishReturnAmount").value=Math.max(0,Math.floor(specialRemaining(s)));$("finishSpecialForm").hidden=!$("finishSpecialForm").hidden});
$("confirmFinishSpecialBtn").addEventListener("click",()=>{const s=specialById(selectedSpecialId),rem=Math.max(0,specialRemaining(s)),ret=Number($("finishReturnAmount").value);if(!s||!Number.isFinite(ret)||ret<0||ret>rem){$("specialActionMessage").textContent="Return amount must be between NT$0 and the remaining allocation.";return}reserveTwd+=ret;s.returnedTwd=ret;s.retainedUnreturnedTwd=rem-ret;s.status="archived";s.closedAt=todayISO();selectedSpecialId="";persist();renderAll();renderTabs("budget")});

$("specialExpenseForm").addEventListener("submit",e=>{
  e.preventDefault();const s=specialById(selectedSpecialId);if(!s)return;
  const cur=s.type==="travel"?$("specialExpenseCurrency").value:"TWD",fx=s.type==="travel"?Number($("specialExpenseFx").value):1,wid=s.type==="travel"?$("specialExpenseWallet").value:"";
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
$("addSpecialCategoryBtn").addEventListener("click",()=>{const s=specialById(selectedSpecialId),n=$("specialNewCategoryName").value.trim(),v=Number($("specialNewCategoryBudget").value);if(!s||!n||!Number.isFinite(v)||v<0)return;s.categories[n]=Math.round(v);$("specialNewCategoryName").value="";$("specialNewCategoryBudget").value="";renderSpecialCategories(s)});
$("saveSpecialCategoriesBtn").addEventListener("click",()=>{const s=specialById(selectedSpecialId);if(!s)return;const u={};$("specialCategoryFields").querySelectorAll("input[data-category]").forEach(i=>{const v=Number(i.value);if(Number.isFinite(v)&&v>=0)u[i.dataset.category]=Math.round(v)});s.categories=u;persist();$("specialCategoryEditor").hidden=true;$("showSpecialCategoryEditorBtn").textContent="Edit";renderSpecialPanel()});

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

$("exportBackupBtn").addEventListener("click",()=>{const data={version:7,exportedAt:new Date().toISOString(),reserveTwd,templateBudgets,monthBudgets,regularExpenses,specialBudgets,settings};downloadText(`budget-tracker-backup-${todayISO()}.json`,JSON.stringify(data,null,2),"application/json");$("backupMessage").textContent="Backup exported."});
$("exportCsvBtn").addEventListener("click",()=>{
  const header=["Scope","Special_Budget","Date","Category","Original_Amount","Currency","FX_to_TWD","Amount_TWD","Note"],rows=[];
  regularExpenses.filter(e=>!isMigratedV6TripExpense(e)).forEach(e=>rows.push(["Regular","",e.date,e.category,e.amount,"TWD",1,e.amount,e.note||""]));
  specialBudgets.forEach(s=>(s.expenses||[]).forEach(e=>rows.push(["Special",s.name,e.date,e.category,e.originalAmount,e.currency,e.fxRate,e.amountTwd,e.note||""])));
  const csv=[header,...rows].map(r=>r.map(csvEscape).join(",")).join("\n");downloadText(`budget-expenses-${todayISO()}.csv`,csv,"text/csv;charset=utf-8");$("backupMessage").textContent="CSV exported."
});
$("importBackupInput").addEventListener("change",async e=>{
  const file=e.target.files?.[0];if(!file)return;try{const d=JSON.parse(await file.text());if(!d||!Array.isArray(d.regularExpenses)&&!Array.isArray(d.expenses))throw new Error();if(!confirm("Import this backup and replace data on this device?")){e.target.value="";return}
    reserveTwd=Math.max(0,Number(d.reserveTwd??d.cashReserve??reserveTwd)||0);templateBudgets=d.templateBudgets||clone(DEFAULT_BUDGETS);monthBudgets=d.monthBudgets||{};regularExpenses=normalizeRegular(d.regularExpenses||d.expenses||[]);specialBudgets=Array.isArray(d.specialBudgets)?d.specialBudgets:[];settings=d.settings||settings;selectedMonth=currentMonthKey();selectedSpecialId="";persist();renderAll();renderTabs("budget");$("backupMessage").textContent="Backup imported successfully."
  }catch{$("backupMessage").textContent="Could not import this backup file."}finally{e.target.value=""}
});


if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));

$("detailDate").value=todayISO();$("specialStart").value=todayISO();$("specialEnd").value=todayISO();$("specialExpenseDate").value=todayISO();$("specialTransferDate").value=todayISO();$("travelCreatorFields").hidden=false;
initReserve();migrateV6Trips();ensureMonthBudget(currentMonthKey());persist();renderTabs("budget");renderAll();
})();
