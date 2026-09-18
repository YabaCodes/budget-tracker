(() => {
  "use strict";

  const GOAL = 300000;
  const DEFAULT_BUDGETS = {
    "Rent":23000, "Sister's rent":7600, "Tithe":8200, "Family support":3500,
    "Utilities":1750, "SIM":799, "Home Wi‑Fi":899, "Apple One":390, "iCloud+":300,
    "Gym":1088, "Transportation":1000, "Food & groceries":8000, "Dating":3000,
    "Miscellaneous":1000
  };
  const QUICK_CATEGORIES = ["Food & groceries","Transportation","Dating","Miscellaneous"];

  const STORAGE = {
    legacyBudgets:"budgetTracker.budgets.v1",
    expenses:"budgetTracker.expenses.v1",
    legacyCash:"budgetTracker.cash.v1",
    templateBudgets:"budgetTracker.templateBudgets.v3",
    monthBudgets:"budgetTracker.monthBudgets.v3",
    accounts:"budgetTracker.accounts.v6",
    transfers:"budgetTracker.transfers.v6",
    trips:"budgetTracker.trips.v6",
    settings:"budgetTracker.settings.v6"
  };

  const $ = id => document.getElementById(id);
  const clone = x => JSON.parse(JSON.stringify(x));
  const money = x => "NT$" + Math.round(Number(x)||0).toLocaleString("en-US");
  const fmt = (x,c) => `${c} ${Number(x||0).toLocaleString("en-US",{maximumFractionDigits:2})}`;

  function todayISO(){
    const d=new Date(), local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
    return local.toISOString().slice(0,10);
  }
  const currentMonthKey=()=>todayISO().slice(0,7);
  const monthKey=d=>String(d||"").slice(0,7);
  function monthLabel(mk){
    const [y,m]=String(mk).split("-").map(Number);
    if(!y||!m)return mk;
    return new Intl.DateTimeFormat("en-US",{month:"short",year:"numeric"}).format(new Date(y,m-1,1));
  }
  function shortMonth(mk){
    const [y,m]=String(mk).split("-").map(Number);
    return (!y||!m)?mk:new Intl.DateTimeFormat("en-US",{month:"short"}).format(new Date(y,m-1,1));
  }
  function loadJSON(k,f){try{const r=localStorage.getItem(k);return r?JSON.parse(r):clone(f)}catch{return clone(f)}}
  function uid(prefix){return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,9)}`}

  const legacyBudgets=loadJSON(STORAGE.legacyBudgets,DEFAULT_BUDGETS);
  let templateBudgets=loadJSON(STORAGE.templateBudgets,legacyBudgets);
  let monthBudgets=loadJSON(STORAGE.monthBudgets,{});
  let expenses=normalizeExpenses(loadJSON(STORAGE.expenses,[]));
  let transfers=loadJSON(STORAGE.transfers,[]);
  let trips=loadJSON(STORAGE.trips,[]);
  let settings=loadJSON(STORAGE.settings,{defaultAccountId:"",defaultTripId:""});
  let accounts=loadJSON(STORAGE.accounts,[]);
  let selectedMonth=currentMonthKey();
  let selectedQuickCategory="Food & groceries";
  let privacyHidden=true;
  let lastAddedExpense=null, undoTimer=null;

  function normalizeExpenses(list){
    if(!Array.isArray(list))return [];
    return list.map((e,i)=>({
      id:e.id||`legacy-${Date.now()}-${i}`,
      amount:Math.max(0,Number(e.amount)||0),
      originalAmount:Math.max(0,Number(e.originalAmount ?? e.amount)||0),
      currency:String(e.currency||"TWD"),
      fxRate:Math.max(0.000001,Number(e.fxRate)||1),
      category:String(e.category||"Miscellaneous"),
      date:/^\d{4}-\d{2}-\d{2}$/.test(String(e.date||""))?e.date:todayISO(),
      note:String(e.note||""),
      accountId:String(e.accountId||""),
      tripId:String(e.tripId||""),
      createdAt:Number(e.createdAt)||Date.now()
    }));
  }

  function migrateV6(){
    if(!accounts.length){
      const legacyCash=Math.max(0,Number(localStorage.getItem(STORAGE.legacyCash)||76000));
      const main={id:uid("acct"),name:"Main cash reserve",currency:"TWD",balance:legacyCash,type:"bank",includeInReserve:true};
      accounts=[main];
      settings.defaultAccountId=main.id;
    }
    if(!settings.defaultAccountId || !accounts.some(a=>a.id===settings.defaultAccountId)){
      settings.defaultAccountId=accounts[0]?.id||"";
    }
    persistAll();
  }

  function persistAll(){
    localStorage.setItem(STORAGE.templateBudgets,JSON.stringify(templateBudgets));
    localStorage.setItem(STORAGE.monthBudgets,JSON.stringify(monthBudgets));
    localStorage.setItem(STORAGE.legacyBudgets,JSON.stringify(templateBudgets));
    localStorage.setItem(STORAGE.expenses,JSON.stringify(expenses));
    localStorage.setItem(STORAGE.accounts,JSON.stringify(accounts));
    localStorage.setItem(STORAGE.transfers,JSON.stringify(transfers));
    localStorage.setItem(STORAGE.trips,JSON.stringify(trips));
    localStorage.setItem(STORAGE.settings,JSON.stringify(settings));
    localStorage.setItem(STORAGE.legacyCash,String(reserveTwd()));
  }

  function reserveTwd(){
    return accounts.filter(a=>a.includeInReserve && a.currency==="TWD")
      .reduce((s,a)=>s+(Number(a.balance)||0),0);
  }
  const accountById=id=>accounts.find(a=>a.id===id);
  const tripById=id=>trips.find(t=>t.id===id);

  function ensureMonthBudget(mk){
    if(!monthBudgets[mk])monthBudgets[mk]=clone(templateBudgets);
    return monthBudgets[mk];
  }
  const expensesForMonth=mk=>expenses.filter(e=>monthKey(e.date)===mk);
  const totalSpentForMonth=mk=>expensesForMonth(mk).reduce((s,e)=>s+(Number(e.amount)||0),0);
  const totalBudgetForMonth=mk=>Object.values(ensureMonthBudget(mk)).reduce((s,v)=>s+(Number(v)||0),0);
  function spentByCategory(mk){
    const out={}; Object.keys(ensureMonthBudget(mk)).forEach(k=>out[k]=0);
    expensesForMonth(mk).forEach(e=>out[e.category]=(out[e.category]||0)+(Number(e.amount)||0));
    return out;
  }
  function availableMonths(){
    const set=new Set([currentMonthKey(),selectedMonth,...Object.keys(monthBudgets)]);
    expenses.forEach(e=>{const mk=monthKey(e.date);if(mk)set.add(mk)});
    return [...set].filter(Boolean).sort().reverse();
  }
  function addMonths(mk,d){
    const [y,m]=mk.split("-").map(Number), dt=new Date(y,m-1+d,1);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
  }
  function trendMonths(n=6){
    const all=availableMonths().sort(), cur=currentMonthKey();
    let end=all.length?all[all.length-1]:cur;if(cur>end)end=cur;
    const r=[];for(let i=n-1;i>=0;i--)r.push(addMonths(end,-i));return r;
  }
  function elapsedMonthRatio(mk){
    if(mk!==currentMonthKey())return 1;
    const n=new Date(), dim=new Date(n.getFullYear(),n.getMonth()+1,0).getDate();
    return n.getDate()/dim;
  }
  function scoreForMonth(mk){
    const b=ensureMonthBudget(mk), s=spentByCategory(mk), tb=totalBudgetForMonth(mk), ts=totalSpentForMonth(mk);
    let overall=40;
    if(tb>0&&ts>tb)overall=Math.max(0,40*(1-Math.min(1,(ts-tb)/tb)));
    const cats=Object.keys(b);
    const catPts=cats.length?40*cats.filter(c=>(s[c]||0)<=Number(b[c]||0)).length/cats.length:40;
    let pace=20;
    if(mk===currentMonthKey()&&tb>0){
      const usage=ts/tb, elapsed=elapsedMonthRatio(mk);
      if(usage>elapsed+.05)pace=Math.max(0,20*(1-Math.min(1,(usage-(elapsed+.05))/.35)));
    } else if(tb>0&&ts>tb) pace=0;
    return Math.round(overall+catPts+pace);
  }
  function statusForCategory(used,budget,mk){
    if(budget<=0)return used>0?"over":"good";
    if(used>budget)return "over";
    const ratio=used/budget;
    if(mk===currentMonthKey()&&(ratio>elapsedMonthRatio(mk)+.08||ratio>=.85))return "watch";
    if(mk!==currentMonthKey()&&ratio>=.9)return "watch";
    return "good";
  }
  const statusLabel=s=>s==="over"?"Over budget":s==="watch"?"Watch":"On track";
  const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

  function renderTabs(active){
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active",b.dataset.tab===active));
    document.querySelectorAll(".tab-panel").forEach(p=>p.hidden=p.id!==`tab-${active}`);
  }
  function renderMonthSelect(){
    const sel=$("monthSelect"), months=availableMonths();sel.innerHTML="";
    months.forEach(mk=>{const o=document.createElement("option");o.value=mk;o.textContent=monthLabel(mk);sel.appendChild(o)});
    if(!months.includes(selectedMonth))selectedMonth=currentMonthKey();sel.value=selectedMonth;
  }
  function renderReserve(){
    const r=reserveTwd(), pct=Math.min(100,r/GOAL*100), remain=Math.max(0,GOAL-r);
    $("cashReserve").textContent=privacyHidden?"NT$••••••":money(r);
    $("goalPercent").textContent=privacyHidden?"•••%":pct.toFixed(1)+"%";
    $("goalRemaining").textContent=privacyHidden?"NT$•••••• remaining":money(remain)+" remaining";
    $("goalBar").style.width=pct+"%";
    $("privacyBtn").textContent=privacyHidden?"👁":"🙈";
  }
  function renderBudgetSummary(){
    const spent=totalSpentForMonth(selectedMonth), budget=totalBudgetForMonth(selectedMonth), usage=budget?spent/budget:0, rem=budget-spent;
    $("monthlySpent").textContent=money(spent);$("monthlyBudget").textContent=money(budget);$("monthlyRemaining").textContent=money(Math.max(0,rem));
    $("monthBudgetBar").style.width=Math.min(100,Math.max(0,usage*100))+"%";
    if(selectedMonth===currentMonthKey()){
      const e=elapsedMonthRatio(selectedMonth);
      $("paceMessage").textContent=usage>e+.05?`Used ${(usage*100).toFixed(0)}% of budget with ${(e*100).toFixed(0)}% of month elapsed — ahead of pace.`:`Used ${(usage*100).toFixed(0)}% of budget with ${(e*100).toFixed(0)}% of month elapsed — pace looks controlled.`;
    }else $("paceMessage").textContent=rem>=0?`${money(rem)} finished unspent.`:`${money(Math.abs(rem))} over budget.`;
  }
  function renderQuickCategories(){
    const wrap=$("quickCategories"), b=ensureMonthBudget(currentMonthKey());
    const names=[...QUICK_CATEGORIES.filter(x=>x in b),...Object.keys(b).filter(x=>!QUICK_CATEGORIES.includes(x))].slice(0,8);
    if(!(selectedQuickCategory in b))selectedQuickCategory=names[0]||"Miscellaneous";
    wrap.innerHTML="";
    names.forEach(name=>{
      const btn=document.createElement("button");btn.type="button";btn.className="chip"+(name===selectedQuickCategory?" active":"");
      btn.textContent=name.replace(" & groceries","");btn.addEventListener("click",()=>{selectedQuickCategory=name;renderQuickCategories();$("quickMessage").textContent=`Selected: ${name}`});
      wrap.appendChild(btn);
    });
  }
  function populateAccountSelects(){
    ["quickAccountSelect","detailAccount","transferFrom","transferTo"].forEach(id=>{
      const s=$(id), prev=s.value||settings.defaultAccountId;s.innerHTML="";
      accounts.forEach(a=>{const o=document.createElement("option");o.value=a.id;o.textContent=`${a.name} · ${a.currency}`;s.appendChild(o)});
      if(accounts.some(a=>a.id===prev))s.value=prev;
    });
    if(!$("quickAccountSelect").value&&accounts[0])$("quickAccountSelect").value=accounts[0].id;
    updateQuickContext();
    updateDetailFx();
  }
  function populateTripSelects(){
    ["quickTripSelect","detailTrip"].forEach(id=>{
      const s=$(id), prev=s.value||settings.defaultTripId;s.innerHTML='<option value="">No trip</option>';
      trips.forEach(t=>{const o=document.createElement("option");o.value=t.id;o.textContent=t.name;s.appendChild(o)});
      if(trips.some(t=>t.id===prev))s.value=prev;
    });
  }
  function populateDetailCategory(){
    const s=$("detailCategory"), b=ensureMonthBudget(currentMonthKey()), prev=s.value;s.innerHTML="";
    Object.keys(b).forEach(n=>{const o=document.createElement("option");o.value=n;o.textContent=n;s.appendChild(o)});
    if(prev in b)s.value=prev;
  }
  function updateQuickContext(){
    const a=accountById($("quickAccountSelect").value);
    $("quickCurrencyLabel").textContent=a?.currency||"TWD";
  }
  function inferredFx(accountId,tripId){
    const a=accountById(accountId);if(!a||a.currency==="TWD")return 1;
    const t=tripById(tripId);
    if(t&&t.localCurrency===a.currency)return Number(t.fxRate)||1;
    return null;
  }
  function updateDetailFx(){
    const a=accountById($("detailAccount").value), t=tripById($("detailTrip").value);
    const rate=inferredFx(a?.id,t?.id);
    if(rate)$("detailFxRate").value=rate;
    $("fxHelp").textContent=a?`1 ${a.currency} = ${$("detailFxRate").value||"?"} TWD`:"";
  }

  function renderCategories(){
    const b=ensureMonthBudget(selectedMonth), s=spentByCategory(selectedMonth), wrap=$("categoryList");
    $("categoryMonthLabel").textContent=monthLabel(selectedMonth);wrap.innerHTML="";
    Object.entries(b).forEach(([n,bv])=>{
      const budget=Number(bv)||0, used=s[n]||0, rem=budget-used, pct=budget?Math.min(100,used/budget*100):(used?100:0), st=statusForCategory(used,budget,selectedMonth);
      const row=document.createElement("div");row.className="category-row";
      row.innerHTML=`<div class="category-top"><div><div class="category-name">${escapeHtml(n)}</div><div class="category-meta">${money(used)} spent · ${money(Math.max(0,rem))} remaining</div><span class="status ${st}">${statusLabel(st)}</span></div><div><strong>${money(budget)}</strong></div></div><div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>`;
      wrap.appendChild(row);
    });
  }
  function renderBudgetEditor(){
    const wrap=$("budgetFields");wrap.innerHTML="";$("budgetEditorTitle").textContent=`Edit ${monthLabel(selectedMonth)} budgets`;
    Object.entries(ensureMonthBudget(selectedMonth)).forEach(([n,v])=>{
      const l=document.createElement("label");l.textContent=n;const i=document.createElement("input");i.type="number";i.min="0";i.step="1";i.value=Math.round(Number(v)||0);i.dataset.category=n;l.appendChild(i);wrap.appendChild(l);
    });
  }

  function renderAccounts(){
    const wrap=$("accountList");wrap.innerHTML="";
    accounts.forEach(a=>{
      const row=document.createElement("div");row.className="account-row";
      row.innerHTML=`<div class="account-top"><div><div class="account-name">${escapeHtml(a.name)} ${a.includeInReserve?'<span class="badge">Reserve</span>':""}</div><div class="account-meta">${escapeHtml(a.type)} · ${escapeHtml(a.currency)}</div></div><div class="account-balance"><strong>${fmt(a.balance,a.currency)}</strong></div></div>`;
      wrap.appendChild(row);
    });
  }
  function renderTransferPreview(){
    const f=accountById($("transferFrom").value), t=accountById($("transferTo").value), fa=Number($("transferFromAmount").value), ta=Number($("transferToAmount").value);
    if(f&&t&&fa>0&&ta>0)$("transferRatePreview").textContent=`Effective rate: 1 ${f.currency} = ${(ta/fa).toFixed(4)} ${t.currency}. This is a transfer, not an expense.`;
    else $("transferRatePreview").textContent="";
  }
  function renderTransfers(){
    const wrap=$("transferList"), rows=[...transfers].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt).slice(0,30);wrap.innerHTML="";
    if(!rows.length){wrap.innerHTML='<div class="empty">No transfers recorded yet.</div>';return}
    rows.forEach(t=>{
      const f=accountById(t.fromAccountId), to=accountById(t.toAccountId), row=document.createElement("div");row.className="expense-row";
      row.innerHTML=`<div class="expense-top"><div><div class="expense-name">${escapeHtml(f?.name||"Unknown")} → ${escapeHtml(to?.name||"Unknown")}</div><div class="expense-meta">${escapeHtml(t.date)}${t.note?" · "+escapeHtml(t.note):""}</div></div><div class="account-balance"><strong>${fmt(t.fromAmount,f?.currency||"")}</strong><div class="expense-meta">→ ${fmt(t.toAmount,to?.currency||"")}</div></div></div>`;
      const del=document.createElement("button");del.type="button";del.className="delete-transfer";del.textContent="Delete & reverse";
      del.addEventListener("click",()=>reverseTransfer(t.id));
      row.appendChild(del);wrap.appendChild(row);
    });
  }

  function tripSpent(id){return expenses.filter(e=>e.tripId===id).reduce((s,e)=>s+Number(e.amount||0),0)}
  function renderTrips(){
    const wrap=$("tripList");wrap.innerHTML="";
    if(!trips.length){wrap.innerHTML='<div class="empty">No trips yet. Add one below.</div>';return}
    trips.slice().sort((a,b)=>b.startDate.localeCompare(a.startDate)).forEach(t=>{
      const spent=tripSpent(t.id), remain=Number(t.budgetTwd||0)-spent, pct=t.budgetTwd?Math.min(100,spent/t.budgetTwd*100):0;
      const cats={};expenses.filter(e=>e.tripId===t.id).forEach(e=>cats[e.category]=(cats[e.category]||0)+Number(e.amount||0));
      const catHtml=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([n,v])=>`<div class="trip-cat">${escapeHtml(n)}<b>${money(v)}</b></div>`).join("");
      const row=document.createElement("div");row.className="trip-row";
      row.innerHTML=`<div class="trip-top"><div><div class="trip-name">${escapeHtml(t.name)}</div><div class="trip-meta">${escapeHtml(t.startDate)} → ${escapeHtml(t.endDate)} · ${escapeHtml(t.localCurrency)} · 1 ${escapeHtml(t.localCurrency)} = ${Number(t.fxRate).toFixed(4)} TWD</div></div><div class="trip-spent"><strong>${money(spent)}</strong><div class="trip-meta">of ${money(t.budgetTwd)}</div></div></div><div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div><div class="trip-meta">${remain>=0?money(remain)+" remaining":money(Math.abs(remain))+" over budget"}</div>${catHtml?`<div class="trip-category-grid">${catHtml}</div>`:""}`;
      const btn=document.createElement("button");btn.type="button";btn.className="secondary";btn.style.marginTop="10px";btn.textContent=settings.defaultTripId===t.id?"Quick entry default":"Use for quick entry";
      btn.addEventListener("click",()=>{settings.defaultTripId=t.id;persistAll();populateTripSelects();$("quickTripSelect").value=t.id;updateQuickContext();renderTrips()});
      row.appendChild(btn);wrap.appendChild(row);
    });
  }

  function renderInsights(){
    const score=scoreForMonth(selectedMonth), b=totalBudgetForMonth(selectedMonth), s=totalSpentForMonth(selectedMonth), usage=b?s/b:0, elapsed=elapsedMonthRatio(selectedMonth);
    $("budgetScore").textContent=score+" / 100";
    $("scoreSummary").textContent=score>=90?"Excellent budget control.":score>=80?"Strong month with a few areas to watch.":score>=70?"Generally on track, but some categories need attention.":"Several areas need adjustment.";
    $("pacePercent").textContent=(usage*100).toFixed(0)+"%";
    $("paceInsight").textContent=selectedMonth===currentMonthKey()?`${(elapsed*100).toFixed(0)}% of the month has passed.`:(usage<=1?"Finished within budget.":"Finished over budget.");
  }
  function renderMonthlyTrend(){
    const months=trendMonths(6), data=months.map(m=>({m,spent:totalSpentForMonth(m),budget:totalBudgetForMonth(m)})), max=Math.max(1,...data.map(d=>Math.max(d.spent,d.budget))), wrap=$("monthlyTrendChart");wrap.innerHTML="";
    data.forEach(d=>{const h=Math.max(2,Math.round(d.spent/max*100)), col=document.createElement("div");col.className="bar-col";col.innerHTML=`<div class="bar-value">${money(d.spent)}</div><div class="bar-track"><div class="bar-fill" style="height:${h}%"></div></div><div class="bar-label">${shortMonth(d.m)}</div>`;wrap.appendChild(col)});
  }
  function renderTrendSelect(){
    const s=$("trendCategory"), prev=s.value||"Food & groceries", b=ensureMonthBudget(selectedMonth);s.innerHTML="";
    Object.keys(b).forEach(n=>{const o=document.createElement("option");o.value=n;o.textContent=n;s.appendChild(o)});if(prev in b)s.value=prev;
  }
  function renderCategoryTrend(){
    const cat=$("trendCategory").value||Object.keys(ensureMonthBudget(selectedMonth))[0], months=trendMonths(6), pts=months.map(m=>({m,spent:spentByCategory(m)[cat]||0,budget:Number(ensureMonthBudget(m)[cat])||0}));
    const maxY=Math.max(1,...pts.map(p=>Math.max(p.spent,p.budget))), W=560,H=190,L=42,R=18,T=18,B=34,CW=W-L-R,CH=H-T-B;
    const x=i=>L+(pts.length<=1?CW/2:i/(pts.length-1)*CW), y=v=>T+CH-(v/maxY*CH);
    const sp=pts.map((p,i)=>`${i?"L":"M"} ${x(i).toFixed(1)} ${y(p.spent).toFixed(1)}`).join(" "), bp=pts.map((p,i)=>`${i?"L":"M"} ${x(i).toFixed(1)} ${y(p.budget).toFixed(1)}`).join(" ");
    let svg=`<svg viewBox="0 0 ${W} ${H}">`;
    [0,.5,1].forEach(f=>{const yy=T+CH-f*CH;svg+=`<line class="chart-grid" x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}"></line><text class="chart-text" x="2" y="${yy+3}">${Math.round(maxY*f)}</text>`});
    svg+=`<path class="chart-budget" d="${bp}"></path><path class="chart-line" d="${sp}"></path>`;
    pts.forEach((p,i)=>svg+=`<circle class="chart-dot" cx="${x(i)}" cy="${y(p.spent)}" r="4"></circle><text class="chart-text" text-anchor="middle" x="${x(i)}" y="${H-8}">${shortMonth(p.m)}</text>`);
    svg+="</svg>";$("categoryTrendChart").innerHTML=svg;
    const vals=pts.map(p=>p.spent), avg=vals.reduce((a,b)=>a+b,0)/vals.length, nz=vals.filter(v=>v>0);let dir="Stable";
    if(nz.length>=2){const c=(nz[nz.length-1]-nz[0])/nz[0];if(c<=-.1)dir="Improving";else if(c>=.1)dir="Rising"}
    $("trendAverage").textContent=money(avg);$("trendBudget").textContent=money(Number(ensureMonthBudget(selectedMonth)[cat])||0);$("trendDirection").textContent=dir;
  }

  function renderHistory(){
    const body=$("historyTableBody");body.innerHTML="";
    availableMonths().forEach(m=>{const b=totalBudgetForMonth(m),s=totalSpentForMonth(m),v=b-s,tr=document.createElement("tr");tr.innerHTML=`<td>${monthLabel(m)}</td><td>${money(b)}</td><td>${money(s)}</td><td class="${v>=0?"positive":"negative"}">${v>=0?"+":"−"}${money(Math.abs(v))}</td><td>${scoreForMonth(m)}</td>`;body.appendChild(tr)});
    const wrap=$("expenseList"), rows=[...expensesForMonth(selectedMonth)].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);$("historyTitle").textContent=`${monthLabel(selectedMonth)} expenses`;wrap.innerHTML="";
    if(!rows.length){wrap.innerHTML=`<div class="empty">No expenses for ${monthLabel(selectedMonth)}.</div>`;return}
    rows.forEach(e=>{
      const a=accountById(e.accountId), t=tripById(e.tripId), row=document.createElement("div");row.className="expense-row";
      let meta=`${escapeHtml(e.date)}`;if(e.note)meta+=` · ${escapeHtml(e.note)}`;if(a)meta+=` · ${escapeHtml(a.name)}`;if(t)meta+=` · ${escapeHtml(t.name)}`;
      const original=e.currency!=="TWD"?`<div class="expense-meta">${fmt(e.originalAmount,e.currency)} → ${money(e.amount)}</div>`:"";
      row.innerHTML=`<div class="expense-top"><div><div class="expense-name">${escapeHtml(e.category)}</div><div class="expense-meta">${meta}</div></div><div class="account-balance"><strong>${money(e.amount)}</strong>${original}</div></div>`;
      const del=document.createElement("button");del.type="button";del.className="delete-expense";del.textContent="Delete";del.addEventListener("click",()=>deleteExpense(e.id));row.appendChild(del);wrap.appendChild(row);
    });
  }

  function renderAll(){
    ensureMonthBudget(currentMonthKey());ensureMonthBudget(selectedMonth);
    renderMonthSelect();renderReserve();renderBudgetSummary();renderQuickCategories();populateAccountSelects();populateTripSelects();populateDetailCategory();renderCategories();renderBudgetEditor();
    renderAccounts();renderTransfers();renderTrips();renderInsights();renderMonthlyTrend();renderTrendSelect();renderCategoryTrend();renderHistory();persistAll();
  }

  function addExpense({originalAmount,category,date,note,accountId,tripId,fxRate}){
    const amt=Number(originalAmount), a=accountById(accountId);
    if(!Number.isFinite(amt)||amt<=0||!a||!category||!date)return null;
    const rate=a.currency==="TWD"?1:Number(fxRate);
    if(!Number.isFinite(rate)||rate<=0)return null;
    const e={id:uid("exp"),originalAmount:amt,currency:a.currency,fxRate:rate,amount:amt*rate,category,date,note:String(note||""),accountId:a.id,tripId:String(tripId||""),createdAt:Date.now()};
    a.balance=Number(a.balance||0)-amt;expenses.push(e);lastAddedExpense=e;selectedMonth=monthKey(date);persistAll();showUndo(e);return e;
  }
  function deleteExpense(id){
    const e=expenses.find(x=>x.id===id);if(!e)return;
    if(!confirm(`Delete this ${e.category} expense?`))return;
    const a=accountById(e.accountId);if(a)a.balance=Number(a.balance||0)+Number(e.originalAmount||0);
    expenses=expenses.filter(x=>x.id!==id);persistAll();renderAll();
  }
  function showUndo(e){
    if(undoTimer)clearTimeout(undoTimer);$("undoText").textContent=`${fmt(e.originalAmount,e.currency)} added to ${e.category}.`;$("undoToast").hidden=false;
    undoTimer=setTimeout(()=>{$("undoToast").hidden=true;lastAddedExpense=null},8000);
  }
  function reverseTransfer(id){
    const t=transfers.find(x=>x.id===id);if(!t)return;
    if(!confirm("Delete this transfer and reverse the wallet balances?"))return;
    const f=accountById(t.fromAccountId),to=accountById(t.toAccountId);
    if(f)f.balance=Number(f.balance||0)+Number(t.fromAmount||0);if(to)to.balance=Number(to.balance||0)-Number(t.toAmount||0);
    transfers=transfers.filter(x=>x.id!==id);persistAll();renderAll();
  }

  function downloadText(name,text,type){
    const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const csvEscape=v=>`"${String(v??"").replace(/"/g,'""')}"`;

  document.querySelectorAll(".tab-btn").forEach(b=>b.addEventListener("click",()=>renderTabs(b.dataset.tab)));
  $("monthSelect").addEventListener("change",()=>{selectedMonth=$("monthSelect").value;$("budgetEditor").hidden=true;renderAll()});
  $("privacyBtn").addEventListener("click",()=>{privacyHidden=!privacyHidden;renderReserve()});

  $("quickAccountSelect").addEventListener("change",()=>{settings.defaultAccountId=$("quickAccountSelect").value;persistAll();updateQuickContext()});
  $("quickTripSelect").addEventListener("change",()=>{settings.defaultTripId=$("quickTripSelect").value;persistAll()});
  $("quickExpenseForm").addEventListener("submit",e=>{
    e.preventDefault();
    const a=accountById($("quickAccountSelect").value), tripId=$("quickTripSelect").value, rate=inferredFx(a?.id,tripId);
    if(!a)return;
    if(a.currency!=="TWD"&&!rate){$("quickMessage").textContent="For a foreign-currency wallet, select a matching trip or use More details to enter an FX rate.";return}
    const exp=addExpense({originalAmount:Number($("quickAmount").value),category:selectedQuickCategory,date:todayISO(),note:"",accountId:a.id,tripId,fxRate:rate||1});
    if(!exp){$("quickMessage").textContent="Enter a valid amount.";return}
    $("quickAmount").value="";$("quickMessage").textContent=`Added ${fmt(exp.originalAmount,exp.currency)} (${money(exp.amount)}) to ${exp.category}.`;renderAll();
  });
  $("moreDetailsBtn").addEventListener("click",()=>{const f=$("detailExpenseForm");f.hidden=!f.hidden;$("moreDetailsBtn").textContent=f.hidden?"More details":"Hide details";if(!f.hidden)$("detailDate").value=todayISO()});
  $("detailAccount").addEventListener("change",updateDetailFx);$("detailTrip").addEventListener("change",updateDetailFx);$("detailFxRate").addEventListener("input",updateDetailFx);
  $("detailExpenseForm").addEventListener("submit",e=>{
    e.preventDefault();
    const exp=addExpense({originalAmount:Number($("detailAmount").value),category:$("detailCategory").value,date:$("detailDate").value,note:$("detailNote").value.trim(),accountId:$("detailAccount").value,tripId:$("detailTrip").value,fxRate:Number($("detailFxRate").value)});
    if(!exp)return;$("detailExpenseForm").reset();$("detailDate").value=todayISO();$("quickMessage").textContent=`Added ${fmt(exp.originalAmount,exp.currency)} (${money(exp.amount)}).`;renderAll();
  });
  $("undoBtn").addEventListener("click",()=>{if(!lastAddedExpense)return;const e=lastAddedExpense,a=accountById(e.accountId);if(a)a.balance=Number(a.balance||0)+Number(e.originalAmount||0);expenses=expenses.filter(x=>x.id!==e.id);lastAddedExpense=null;$("undoToast").hidden=true;if(undoTimer)clearTimeout(undoTimer);persistAll();renderAll()});

  $("editBudgetsBtn").addEventListener("click",()=>{$("budgetEditor").hidden=false;renderBudgetEditor();$("budgetEditor").scrollIntoView({behavior:"smooth",block:"start"})});
  $("closeBudgetsBtn").addEventListener("click",()=>{$("budgetEditor").hidden=true});
  $("stageCategoryBtn").addEventListener("click",()=>{
    const name=$("newCategoryName").value.trim(),budget=Number($("newCategoryBudget").value);
    if(!name||!Number.isFinite(budget)||budget<0){$("budgetSaveMessage").textContent="Enter a category name and valid budget.";return}
    if([...$("budgetFields").querySelectorAll("input[data-category]")].some(i=>i.dataset.category.toLowerCase()===name.toLowerCase())){$("budgetSaveMessage").textContent="That category already exists.";return}
    const l=document.createElement("label");l.textContent=name;const i=document.createElement("input");i.type="number";i.min="0";i.step="1";i.value=Math.round(budget);i.dataset.category=name;l.appendChild(i);$("budgetFields").appendChild(l);$("newCategoryName").value="";$("newCategoryBudget").value="";$("budgetSaveMessage").textContent="Category staged. Tap Save budgets.";
  });
  $("saveBudgetsBtn").addEventListener("click",()=>{
    const updated={};$("budgetFields").querySelectorAll("input[data-category]").forEach(i=>{const v=Number(i.value);if(Number.isFinite(v)&&v>=0)updated[i.dataset.category]=Math.round(v)});
    const scope=document.querySelector('input[name="budgetScope"]:checked')?.value||"month";monthBudgets[selectedMonth]=clone(updated);
    if(scope==="future"){templateBudgets=clone(updated);Object.keys(monthBudgets).forEach(m=>{if(m>selectedMonth)monthBudgets[m]=clone(updated)})}
    persistAll();$("budgetSaveMessage").textContent=scope==="future"?`Saved for ${monthLabel(selectedMonth)} and future months.`:`Saved for ${monthLabel(selectedMonth)} only.`;renderAll();setTimeout(()=>{$("budgetEditor").hidden=true;$("budgetSaveMessage").textContent=""},800);
  });

  $("accountForm").addEventListener("submit",e=>{
    e.preventDefault();
    const name=$("accountName").value.trim(),currency=$("accountCurrency").value,balance=Number($("accountBalance").value),type=$("accountType").value;
    if(!name||!Number.isFinite(balance))return;
    const a={id:uid("acct"),name,currency,balance,type,includeInReserve:currency==="TWD"&&$("accountReserve").checked};
    accounts.push(a);if(!settings.defaultAccountId)settings.defaultAccountId=a.id;persistAll();$("accountForm").reset();$("accountBalance").value="0";$("accountMessage").textContent=`${name} added.`;renderAll();
  });

  ["transferFrom","transferTo","transferFromAmount","transferToAmount"].forEach(id=>$(id).addEventListener("input",renderTransferPreview));
  $("transferForm").addEventListener("submit",e=>{
    e.preventDefault();
    const from=$("transferFrom").value,to=$("transferTo").value,fa=Number($("transferFromAmount").value),ta=Number($("transferToAmount").value);
    if(!from||!to||from===to||fa<=0||ta<=0){$("transferMessage").textContent="Choose two different wallets and valid amounts.";return}
    const f=accountById(from),t=accountById(to);if(!f||!t)return;
    f.balance=Number(f.balance||0)-fa;t.balance=Number(t.balance||0)+ta;
    transfers.push({id:uid("tr"),fromAccountId:from,toAccountId:to,fromAmount:fa,toAmount:ta,date:$("transferDate").value||todayISO(),note:$("transferNote").value.trim(),createdAt:Date.now()});
    persistAll();$("transferForm").reset();$("transferDate").value=todayISO();$("transferMessage").textContent="Transfer recorded. It did not count as an expense.";renderAll();
  });

  $("tripForm").addEventListener("submit",e=>{
    e.preventDefault();
    const name=$("tripName").value.trim(),budget=Number($("tripBudget").value),fx=Number($("tripFxRate").value),start=$("tripStart").value,end=$("tripEnd").value,c=$("tripCurrency").value;
    if(!name||budget<0||!start||!end||end<start||!Number.isFinite(fx)||fx<=0){$("tripMessage").textContent="Check the trip dates, budget and FX rate.";return}
    const t={id:uid("trip"),name,budgetTwd:budget,startDate:start,endDate:end,localCurrency:c,fxRate:fx};
    trips.push(t);settings.defaultTripId=t.id;persistAll();$("tripForm").reset();$("tripMessage").textContent=`${name} added and set as the quick-entry trip.`;renderAll();
  });

  $("trendCategory").addEventListener("change",renderCategoryTrend);
  $("clearSelectedMonthBtn").addEventListener("click",()=>{
    if(!confirm(`Delete ALL expenses for ${monthLabel(selectedMonth)}? Account balances linked to those expenses will be restored.`))return;
    const doomed=expenses.filter(e=>monthKey(e.date)===selectedMonth);doomed.forEach(e=>{const a=accountById(e.accountId);if(a)a.balance=Number(a.balance||0)+Number(e.originalAmount||0)});expenses=expenses.filter(e=>monthKey(e.date)!==selectedMonth);persistAll();renderAll();
  });

  $("exportBackupBtn").addEventListener("click",()=>{
    const data={version:6,exportedAt:new Date().toISOString(),cashReserve:reserveTwd(),templateBudgets,monthBudgets,expenses,accounts,transfers,trips,settings};
    downloadText(`budget-tracker-backup-${todayISO()}.json`,JSON.stringify(data,null,2),"application/json");$("backupMessage").textContent="Backup exported.";
  });
  $("exportCsvBtn").addEventListener("click",()=>{
    const header=["Date","Category","Original_Amount","Currency","FX_to_TWD","Amount_TWD","Wallet","Trip","Note"];
    const rows=[...expenses].sort((a,b)=>a.date.localeCompare(b.date)).map(e=>[e.date,e.category,e.originalAmount,e.currency,e.fxRate,e.amount,accountById(e.accountId)?.name||"",tripById(e.tripId)?.name||"",e.note||""]);
    const csv=[header,...rows].map(r=>r.map(csvEscape).join(",")).join("\n");downloadText(`budget-expenses-${todayISO()}.csv`,csv,"text/csv;charset=utf-8");$("backupMessage").textContent="CSV exported.";
  });
  $("importBackupInput").addEventListener("change",async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      const d=JSON.parse(await file.text());if(!Array.isArray(d.expenses))throw new Error();
      if(!confirm("Import this backup and replace data on this device?")){e.target.value="";return}
      expenses=normalizeExpenses(d.expenses);templateBudgets=d.templateBudgets||clone(DEFAULT_BUDGETS);monthBudgets=d.monthBudgets||{};
      if(Array.isArray(d.accounts)&&d.accounts.length){
        accounts=d.accounts;
      }else if(typeof d.cashReserve!=="undefined"){
        const main={id:uid("acct"),name:"Main cash reserve",currency:"TWD",balance:Math.max(0,Number(d.cashReserve)||0),type:"bank",includeInReserve:true};
        accounts=[main];settings={...(d.settings||settings),defaultAccountId:main.id};
      }
      transfers=Array.isArray(d.transfers)?d.transfers:[];trips=Array.isArray(d.trips)?d.trips:[];settings=d.settings||settings;
      persistAll();selectedMonth=currentMonthKey();renderAll();$("backupMessage").textContent="Backup imported successfully.";
    }catch{$("backupMessage").textContent="Could not import this backup file."}finally{e.target.value=""}
  });

  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
  $("detailDate").value=todayISO();$("transferDate").value=todayISO();
  const now=todayISO();$("tripStart").value=now;$("tripEnd").value=now;
  migrateV6();renderTabs("budget");renderAll();
})();
