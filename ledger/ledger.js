import { STYLE, MARKUP } from './template.js';
import { readLedger, saveLedger, calculateTrip, importExpenses, csvCell, CATEGORIES as CATS, STATUSES } from './data.js';
import { uid as makeId } from '../store.js';

// Keep the uploaded ledger's layout separate from the calendar's styles, while
// using the same Store instance for atomic offline saves and authenticated sync.
export function mountLedger(host, { hub, openSettings }) {
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>'+STYLE+'</style>'+MARKUP;
  const document = {
    querySelector: selector => root.querySelector(selector),
    querySelectorAll: selector => root.querySelectorAll(selector),
    createElement: tag => host.ownerDocument.createElement(tag),
  };
  root.addEventListener('keydown', event => event.stopPropagation());

var $ = function(s,r){ return (r||document).querySelector(s); };
var uid = () => makeId('sl');
var now = function(){ return new Date().toISOString(); };
var esc = function(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
function money(n){
  n = Number(n)||0;
  return (n<0?'-':'')+'$'+Math.abs(n).toLocaleString('en-CA',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function money0(n){ n=Number(n)||0; return '$'+Math.round(Math.abs(n)).toLocaleString('en-CA'); }
function today(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function toast(msg){ var t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(function(){t.classList.remove('show');},2200); }


var PALETTE = ['#2e7dd1','#d1552e','#1c7a54','#7b4fc0','#c0392f','#0d8a9c','#a9700a','#5b6b7a'];

/* ============ state ============ */
var S = readLedger(hub), baseline = structuredClone(S);
function save(){
  try { S = saveLedger(hub, baseline, S); baseline = structuredClone(S); updateStatus(); return true; }
  catch(error) { S = readLedger(hub); baseline = structuredClone(S); toast(error.message); return false; }
}

function kid(id){ for(var i=0;i<S.kids.length;i++) if(S.kids[i].id===id) return S.kids[i].deleted ? null : S.kids[i]; return null; }
function team(id){ for(var i=0;i<S.teams.length;i++) if(S.teams[i].id===id) return S.teams[i].deleted ? null : S.teams[i]; return null; }
function teamLabel(t){
  if(!t) return 'Unassigned';
  var k = kid(t.kidId);
  var nm = t.name || t.sport || 'Team';
  return (k?k.name+' · ':'')+nm;
}
function teamColor(t){ var k = t && kid(t.kidId); return k?k.color:'#7a8b9a'; }
function live(){ return S.expenses.filter(function(e){ return !e.deleted; }); }
function kidsLive(){ return S.kids.filter(function(k){ return !k.deleted; }); }
function teamsLive(){ return S.teams.filter(function(t){ return !t.deleted; }); }
function stamp(o){ o.updatedAt = now(); return o; }

/* spent = Paid + Due. Reimbursed money comes back, so it is tracked but not counted as spend. */
function spentFor(pred){
  var s=0; live().forEach(function(e){ if(pred(e) && e.status!=='Reimbursed') s+=Number(e.amount)||0; }); return s;
}
function reimbursedFor(pred){
  var s=0; live().forEach(function(e){ if(pred(e) && e.status==='Reimbursed') s+=Number(e.amount)||0; }); return s;
}

/* ============ tabs ============ */
var TAB='overview';
document.querySelectorAll('nav.tabs button').forEach(function(b){
  b.addEventListener('click',function(){
    TAB=b.dataset.tab;
    document.querySelectorAll('nav.tabs button').forEach(function(x){ x.setAttribute('aria-selected', String(x===b)); x.tabIndex=x===b?0:-1; });
    ['overview','expenses','teams','travel','settings'].forEach(function(t){ $('#tab-'+t).hidden = (t!==TAB); });
    render();
    host.scrollIntoView({block:'start'});
  });
});

function render(){
  $('#seasonLabel').textContent = (S.season ? 'Season '+S.season : 'Kids sports budget') + ' · CAD';
  if(TAB==='overview') renderOverview();
  if(TAB==='expenses') renderExpenses();
  if(TAB==='teams') renderTeams();
  if(TAB==='travel') renderTravel();
  if(TAB==='settings') renderSettings();
  labelControls();
}

/* ============ overview ============ */
function renderOverview(){
  var total = spentFor(function(){return true;});
  var back  = reimbursedFor(function(){return true;});
  var budget= teamsLive().reduce(function(a,t){ return a+(Number(t.budget)||0); },0);
  var due   = spentFor(function(e){ return e.status==='Due'; });

  var h = '';
  h += '<div class="season">';
  h +=   '<div class="seasonhead">';
  h +=     '<div class="bignum"><span class="cur">$</span>'+Math.round(total).toLocaleString('en-CA')+'</div>';
  h +=     '<div class="seasonmeta">season total (paid + due)'+(budget>0?' of <b>'+money0(budget)+'</b> budgeted':'')+
             (due>0?'<br>'+money0(due)+' of that is still owing':'')+
             (back>0?'<br>'+money0(back)+' reimbursed back to you':'')+'</div>';
  h +=   '</div>';

  if(!teamsLive().length){
    h += '<div class="empty"><b>No teams yet</b>Add a team on the Teams tab and every expense can be filed against it.</div>';
  }
  teamsLive().sort(function(a,b){
    return spentFor(function(e){return e.teamId===b.id;}) - spentFor(function(e){return e.teamId===a.id;});
  }).forEach(function(t){
    var sp = spentFor(function(e){ return e.teamId===t.id; });
    var bg = Number(t.budget)||0;
    var pct = Math.max(0, bg>0 ? Math.min(100, sp/bg*100) : (total>0 ? sp/total*100 : 0));
    var over = bg>0 && sp>bg;
    var c = teamColor(t);
    h += '<div class="standing">';
    h +=   '<div class="strow"><span class="chip" style="background:'+c+'"></span>';
    h +=     '<span class="stname">'+esc(teamLabel(t))+'</span>';
    h +=     '<span class="stsub">'+esc(t.sport||'')+'</span>';
    h +=     '<span class="stamt">'+money0(sp)+(bg>0?' <em>/ '+money0(bg)+'</em>':'')+'</span></div>';
    h +=   '<div class="bar'+(over?' overbudget':'')+'"><i style="width:'+pct.toFixed(1)+'%;background:'+c+'"></i></div>';
    if(bg>0){
      h += '<div class="stfoot"><span>'+Math.round(bg>0?sp/bg*100:0)+'% of budget</span>'+
           (over?'<span class="over">'+money0(sp-bg)+' over</span>':'<span class="left">'+money0(bg-sp)+' left</span>')+'</div>';
    }
    h += '</div>';
  });
  h += '</div>';

  // category breakdown
  var rows = CATS.map(function(c){ return {lbl:c, val:spentFor(function(e){return e.category===c;})}; })
                 .filter(function(r){ return r.val>0; })
                 .sort(function(a,b){ return b.val-a.val; });
  if(rows.length){
    var max = rows[0].val;
    h += '<div class="panel"><h2>Where the money goes</h2><div class="body"><div class="breakdown">';
    rows.forEach(function(r){
      h += '<div class="brow"><span class="lbl">'+esc(r.lbl)+'</span>'+
           '<span class="track"><i style="width:'+(r.val/max*100).toFixed(1)+'%"></i></span>'+
           '<span class="val">'+money0(r.val)+'</span>'+
           '<span class="pct">'+Math.round(total>0?r.val/total*100:0)+'%</span></div>';
    });
    h += '</div></div></div>';
  }

  // who paid
  var payers = S.payers.filter(function(p){ return spentFor(function(e){return e.paidBy===p;})>0; });
  if(payers.length>1){
    h += '<div class="panel"><h2>By payer (paid + due)</h2><div class="body"><div class="breakdown">';
    payers.forEach(function(p){
      var v = spentFor(function(e){return e.paidBy===p;});
      h += '<div class="brow"><span class="lbl">'+esc(p)+'</span>'+
           '<span class="track"><i style="width:'+(total>0?v/total*100:0).toFixed(1)+'%"></i></span>'+
           '<span class="val">'+money0(v)+'</span><span class="pct">'+Math.round(total>0?v/total*100:0)+'%</span></div>';
    });
    h += '</div></div></div>';
  }

  // recent
  var recent = live().slice().sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); }).slice(0,6);
  if(recent.length){
    h += '<div class="panel"><h2>Latest entries</h2><div class="body"><div class="breakdown">';
    recent.forEach(function(e){
      var t = team(e.teamId);
      h += '<div class="brow"><span class="lbl" style="min-width:78px;color:var(--ink3);font-size:12.5px">'+esc(e.date||'')+'</span>'+
           '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+
             '<span class="chip" style="display:inline-block;background:'+teamColor(t)+';margin-right:7px"></span>'+
             esc(e.desc || e.category || 'Expense')+
             ' <span style="color:var(--ink3);font-size:12.5px">'+esc(t?teamLabel(t):'')+'</span></span>'+
           '<span class="val">'+money(e.amount)+'</span></div>';
    });
    h += '</div></div></div>';
  }

  if(!live().length){
    h += '<div class="panel"><div class="empty"><b>Nothing logged yet</b>Open Expenses and add your first registration fee, or use Travel to work out a road-trip cost.</div></div>';
  }
  $('#tab-overview').innerHTML = h;
}

/* ============ expenses grid ============ */
var F = {kid:'',team:'',cat:'',status:'',q:'',month:''};
var SORT = {by:'date', dir:-1};

function filtered(){
  return live().filter(function(e){
    var t = team(e.teamId);
    if(F.kid && (!t || t.kidId!==F.kid)) return false;
    if(F.team && e.teamId!==F.team) return false;
    if(F.cat && e.category!==F.cat) return false;
    if(F.status && e.status!==F.status) return false;
    if(F.month && (e.date||'').slice(0,7)!==F.month) return false;
    if(F.q){
      var hay = ((e.desc||'')+' '+(e.notes||'')+' '+(e.category||'')+' '+(t?teamLabel(t):'')+' '+(e.paidBy||'')).toLowerCase();
      if(hay.indexOf(F.q.toLowerCase())<0) return false;
    }
    return true;
  }).sort(function(a,b){
    var x,y;
    if(SORT.by==='amount'){ x=Number(a.amount)||0; y=Number(b.amount)||0; }
    else if(SORT.by==='team'){ x=teamLabel(team(a.teamId)); y=teamLabel(team(b.teamId)); }
    else { x=String(a[SORT.by]==null?'':a[SORT.by]); y=String(b[SORT.by]==null?'':b[SORT.by]); }
    return (x<y?-1:x>y?1:0)*SORT.dir;
  });
}

function opts(list,sel,blank){
  var h = blank!=null ? '<option value="">'+esc(blank)+'</option>' : '';
  list.forEach(function(o){
    var v = typeof o==='string'?o:o.v, l = typeof o==='string'?o:o.l;
    h += '<option value="'+esc(v)+'"'+(String(sel)===String(v)?' selected':'')+'>'+esc(l)+'</option>';
  });
  return h;
}

function renderExpenses(){
  var list = filtered();
  var sum = list.reduce(function(a,e){ return a + (e.status==='Reimbursed'?0:(Number(e.amount)||0)); },0);
  var months = {}; live().forEach(function(e){ if(e.date) months[e.date.slice(0,7)]=1; });
  var monthList = Object.keys(months).sort().reverse();
  var teamOpts = teamsLive().map(function(t){ return {v:t.id,l:teamLabel(t)}; });

  var h = '<div class="panel">';
  h += '<div class="filters">';
  h +=   '<button class="btn" id="addRow">+ Add expense</button>';
  h +=   '<select id="fKid">'+opts(kidsLive().map(function(k){return {v:k.id,l:k.name};}),F.kid,'All kids')+'</select>';
  h +=   '<select id="fTeam">'+opts(teamOpts,F.team,'All teams')+'</select>';
  h +=   '<select id="fCat">'+opts(CATS,F.cat,'All categories')+'</select>';
  h +=   '<select id="fStatus">'+opts(STATUSES,F.status,'Any status')+'</select>';
  h +=   '<select id="fMonth">'+opts(monthList,F.month,'All months')+'</select>';
  h +=   '<input type="search" id="fQ" placeholder="Search hotels, notes, anyone…" value="'+esc(F.q)+'">';
  h +=   '<button class="btn ghost" id="csvOut">Export CSV</button>';
  h += '</div>';

  if(!list.length){
    h += '<div class="empty"><b>'+(live().length?'Nothing matches those filters':'No expenses yet')+'</b>'+
         (live().length?'Clear a filter to see the rest.':'Add your first one — registration, a hotel night, a tank of gas.')+'</div>';
  } else {
    var arrow = function(k){ return SORT.by===k ? '<span class="arr">'+(SORT.dir>0?'▲':'▼')+'</span>' : ''; };
    h += '<div class="gridscroll"><table class="grid"><thead><tr>'+
         '<th data-sort="date">Date '+arrow('date')+'</th>'+
         '<th data-sort="team">Kid / team '+arrow('team')+'</th>'+
         '<th data-sort="category">Category '+arrow('category')+'</th>'+
         '<th data-sort="desc">Details '+arrow('desc')+'</th>'+
         '<th class="r" data-sort="amount">Amount '+arrow('amount')+'</th>'+
         '<th data-sort="paidBy">Paid by '+arrow('paidBy')+'</th>'+
         '<th data-sort="status">Status '+arrow('status')+'</th>'+
         '<th>Notes</th><th></th></tr></thead><tbody>';
    list.forEach(function(e){
      h += '<tr data-id="'+e.id+'">'+
        '<td class="date"><input class="cell" type="date" data-f="date" value="'+esc(e.date||'')+'"></td>'+
        '<td><select class="cell" data-f="teamId">'+opts(teamOpts,e.teamId,'—')+'</select></td>'+
        '<td><select class="cell" data-f="category">'+opts(CATS,e.category)+'</select></td>'+
        '<td><input class="cell" data-f="desc" value="'+esc(e.desc||'')+'" placeholder="Holiday Inn, Kingston"></td>'+
        '<td class="money"><input class="cell r" data-f="amount" inputmode="decimal" value="'+(e.amount!=null&&e.amount!==''?Number(e.amount).toFixed(2):'')+'"></td>'+
        '<td><select class="cell" data-f="paidBy">'+opts(S.payers,e.paidBy,'—')+'</select></td>'+
        '<td class="st"><select class="cell" data-f="status">'+opts(STATUSES,e.status)+'</select></td>'+
        '<td class="note-cell"><input class="cell" data-f="notes" value="'+esc(e.notes||'')+'" placeholder="Notes"></td>'+
        '<td class="del"><button class="x" data-del="'+e.id+'" aria-label="Delete row">×</button></td></tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="4">'+list.length+' '+(list.length===1?'entry':'entries')+'</td>'+
         '<td class="money" style="text-align:right">'+money(sum)+'</td><td colspan="4"></td></tr></tfoot></table></div>';

    // mobile cards
    h += '<div class="cards">';
    list.forEach(function(e){
      var t=team(e.teamId);
      h += '<div class="card" data-id="'+e.id+'">'+
        '<div class="r1"><span class="chip" style="background:'+teamColor(t)+'"></span>'+
          '<span class="who">'+esc(t?teamLabel(t):'Unassigned')+'</span>'+
          '<span class="amt">'+money(e.amount)+'</span>'+
          '<button class="x" data-del="'+e.id+'" aria-label="Delete">×</button></div>'+
        '<div class="r2">'+
          '<input type="date" data-f="date" value="'+esc(e.date||'')+'">'+
          '<input data-f="amount" inputmode="decimal" placeholder="0.00" value="'+(e.amount!=null&&e.amount!==''?Number(e.amount).toFixed(2):'')+'">'+
          '<select data-f="teamId">'+opts(teamOpts,e.teamId,'—')+'</select>'+
          '<select data-f="category">'+opts(CATS,e.category)+'</select>'+
          '<input class="full" data-f="desc" placeholder="Details" value="'+esc(e.desc||'')+'">'+
          '<select data-f="paidBy">'+opts(S.payers,e.paidBy,'—')+'</select>'+
          '<select data-f="status">'+opts(STATUSES,e.status)+'</select>'+
          '<input class="full" data-f="notes" placeholder="Notes" value="'+esc(e.notes||'')+'">'+
        '</div></div>';
    });
    h += '<div class="card" style="display:flex;justify-content:space-between;font-weight:700">'+
         '<span>'+list.length+' shown</span><span>'+money(sum)+'</span></div>';
    h += '</div>';
  }
  h += '</div>';
  $('#tab-expenses').innerHTML = h;

  labelControls();
  // wire filters
  var bind = function(sel,key){ var el=$(sel); if(el) el.addEventListener('change',function(){ F[key]=el.value; renderExpenses(); }); };
  bind('#fKid','kid'); bind('#fTeam','team'); bind('#fCat','cat'); bind('#fStatus','status'); bind('#fMonth','month');
  var q=$('#fQ'); if(q) q.addEventListener('input',function(){ F.q=q.value; var p=q.selectionStart; renderExpenses(); var n=$('#fQ'); n.focus(); n.setSelectionRange(p,p); });

  $('#addRow').addEventListener('click',function(){
    var t = F.team || (teamsLive()[0]&&teamsLive()[0].id) || '';
    S.expenses.unshift({id:uid(),date:today(),teamId:t,category:F.cat||'Other',desc:'',amount:'',paidBy:S.payers[0]||'',status:'Paid',notes:'',updatedAt:now()});
    F.status=''; F.month=''; F.q=''; save(); renderExpenses();
    var first = document.querySelector(window.matchMedia('(max-width:760px)').matches ? '.cards .card input[data-f="desc"]' : '.grid tbody input[data-f="desc"]');
    if(first) first.focus();
  });
  var csv=$('#csvOut'); if(csv) csv.addEventListener('click',exportCsv);

  document.querySelectorAll('#tab-expenses th[data-sort]').forEach(function(th){
    th.addEventListener('click',function(){
      var k=th.dataset.sort;
      if(SORT.by===k) SORT.dir*=-1; else { SORT.by=k; SORT.dir = (k==='amount'||k==='date')?-1:1; }
      renderExpenses();
    });
  });

}

/* delegated once — re-attaching inside render would stack duplicate handlers */
$('#tab-expenses').addEventListener('change',onCellChange);
$('#tab-expenses').addEventListener('click',function(ev){
  var b = ev.target.closest('[data-del]'); if(!b) return;
  var id=b.dataset.del, e=S.expenses.filter(function(x){return x.id===id;})[0];
  if(!e) return;
  if(!confirm('Delete this entry'+(e.desc?' — '+e.desc:'')+'?')) return;
  e.deleted=true; e.updatedAt=now(); save(); renderExpenses(); toast('Entry deleted');
});

function onCellChange(ev){
  var el = ev.target, f = el.dataset && el.dataset.f;
  if(!f) return;
  var host = el.closest('[data-id]'); if(!host) return;
  var e = S.expenses.filter(function(x){return x.id===host.dataset.id;})[0]; if(!e) return;
  var v = el.value;
  if(f==='amount'){
    v = String(v).replace(/[^0-9.\-]/g,'');
    v = v===''?'':Number(v);
    if(v!=='' && (!Number.isFinite(v) || Math.abs(v)>1e9)) { toast('Enter a valid amount'); renderExpenses(); return; }
    if(v!=='') v=Math.round(v*100)/100;
  }
  e[f]=v; e.updatedAt=now(); save();
  if(f==='amount'||f==='teamId'||f==='status') renderExpenses();
}

/* ============ teams ============ */
function renderTeams(){
  var h='';
  h += '<div class="panel"><h2>Kids</h2><div class="body">';
  kidsLive().forEach(function(k){
    h += '<div class="itemrow" data-kid="'+k.id+'">'+
      '<input type="color" class="swatch" data-k="color" value="'+esc(k.color)+'">'+
      '<input class="grow" data-k="name" value="'+esc(k.name)+'" placeholder="Name">'+
      '<button class="x" data-delkid="'+k.id+'" aria-label="Remove">×</button></div>';
  });
  h += '<div style="margin-top:11px"><button class="btn ghost" id="addKid">+ Add a kid</button></div>';
  h += '</div></div>';

  h += '<div class="panel"><h2>Teams and budgets</h2><div class="body">';
  if(!teamsLive().length) h += '<div class="empty"><b>No teams yet</b>Each team gets its own budget line.</div>';
  teamsLive().forEach(function(t){
    var sp = spentFor(function(e){return e.teamId===t.id;});
    h += '<div class="itemrow" data-team="'+t.id+'">'+
      '<select data-t="kidId" style="min-width:96px">'+opts(kidsLive().map(function(k){return {v:k.id,l:k.name};}),t.kidId,'—')+'</select>'+
      '<input class="grow" data-t="name" value="'+esc(t.name||'')+'" placeholder="Team name">'+
      '<input data-t="sport" value="'+esc(t.sport||'')+'" placeholder="Sport" style="width:110px">'+
      '<input data-t="budget" inputmode="decimal" value="'+(t.budget?Number(t.budget).toFixed(0):'')+'" placeholder="Budget" style="width:92px">'+
      '<span style="font-size:12.5px;color:var(--ink3);white-space:nowrap">'+money0(sp)+' spent</span>'+
      '<button class="x" data-delteam="'+t.id+'" aria-label="Remove">×</button></div>';
  });
  h += '<div style="margin-top:11px"><button class="btn ghost" id="addTeam">+ Add a team</button></div>';
  h += '<p class="hint">Leave a budget blank if you are only tracking what the season actually costs.</p>';
  h += '</div></div>';

  h += '<div class="panel"><h2>Who pays</h2><div class="body">';
  S.payers.forEach(function(p,i){
    h += '<div class="itemrow"><input class="grow" data-payer="'+i+'" value="'+esc(p)+'">'+
         '<button class="x" data-delpayer="'+i+'" aria-label="Remove">×</button></div>';
  });
  h += '<div style="margin-top:11px"><button class="btn ghost" id="addPayer">+ Add a payer</button></div></div></div>';

  $('#tab-teams').innerHTML = h;
}

(function wireTeams(){
  $('#tab-teams').addEventListener('change',function(ev){
    var el=ev.target;
    var kr = el.closest('[data-kid]');
    if(kr && el.dataset.k){ var k=kid(kr.dataset.kid); if(k){ k[el.dataset.k]=el.value; stamp(k); save(); render(); } return; }
    var tr = el.closest('[data-team]');
    if(tr && el.dataset.t){
      var t=team(tr.dataset.team); if(!t) return;
      t[el.dataset.t] = el.dataset.t==='budget' ? (Number(String(el.value).replace(/[^0-9.]/g,''))||0) : el.value;
      stamp(t); save(); renderTeams(); return;
    }
    if(el.dataset.payer!=null){ S.payers[Number(el.dataset.payer)]=el.value; save(); return; }
  });
  $('#tab-teams').addEventListener('click',function(ev){
    var b=ev.target.closest('button'); if(!b) return;
    if(b.id==='addKid'){ S.kids.push(stamp({id:uid(),name:'',color:PALETTE[kidsLive().length%PALETTE.length]})); save(); renderTeams(); }
    if(b.id==='addTeam'){ S.teams.push(stamp({id:uid(),kidId:(kidsLive()[0]||{}).id||'',name:'',sport:'',budget:0})); save(); renderTeams(); }
    if(b.id==='addPayer'){ S.payers.push(''); save(); renderTeams(); }
    if(b.dataset.delkid){
      if(!confirm('Remove this kid? Their teams stay, but lose the colour link.')) return;
      var dk = kid(b.dataset.delkid); if(dk){ dk.deleted=true; stamp(dk); } save(); renderTeams();
    }
    if(b.dataset.delteam){
      var n = live().filter(function(e){return e.teamId===b.dataset.delteam;}).length;
      if(!confirm(n? 'Remove this team? '+n+' entries stay but become unassigned.' : 'Remove this team?')) return;
      var dt = team(b.dataset.delteam); if(dt){ dt.deleted=true; stamp(dt); } save(); renderTeams();
    }
    if(b.dataset.delpayer){ S.payers.splice(Number(b.dataset.delpayer),1); save(); renderTeams(); }
  });
})();

/* ============ travel ============ */
function renderTravel(){
  var st = S.settings;
  var h = '<div class="panel"><h2>Road trip cost</h2><div class="body">';
  h += '<div class="two">'+
    '<label class="field"><span>One-way distance (km)</span><input id="tvKm" inputmode="decimal" placeholder="240"></label>'+
    '<label class="field"><span>Trips (a weekend away is 1)</span><input id="tvTrips" inputmode="numeric" value="1"></label>'+
    '</div><div class="two">'+
    '<label class="field"><span>Fuel price ($/L)</span><input id="tvPrice" inputmode="decimal" value="'+esc(st.fuelPrice)+'"></label>'+
    '<label class="field"><span>Consumption (L/100km)</span><input id="tvCons" inputmode="decimal" value="'+esc(st.lPer100)+'"></label>'+
    '</div><div class="two">'+
    '<label class="field"><span>Hotel nights</span><input id="tvNights" inputmode="numeric" placeholder="2"></label>'+
    '<label class="field"><span>Rate per night ($)</span><input id="tvRate" inputmode="decimal" placeholder="189"></label>'+
    '</div>'+
    '<label class="field"><span>Food per trip ($)</span><input id="tvExtra" inputmode="decimal" placeholder="120"></label>';
  h += '<div class="result" id="tvOut"><div class="big">$0</div><div class="sub">Fill in the trip above.</div></div>';
  h += '<div class="two">'+
    '<label class="field"><span>Log it against</span><select id="tvTeam">'+opts(teamsLive().map(function(t){return {v:t.id,l:teamLabel(t)};}),'','—')+'</select></label>'+
    '<label class="field"><span>Trip date</span><input type="date" id="tvDate" value="'+today()+'"></label></div>';
  h += '<label class="field"><span>Name it</span><input id="tvName" placeholder="Kingston tournament"></label>';
  h += '<button class="btn" id="tvAdd">Add to expenses</button>';
  h += '<p class="hint">Estimates in CAD; enter your own rates and include taxes. Gas, hotel and food are added as separate entries with status Due. Change them to Paid after paying.</p>';
  h += '</div></div>';
  $('#tab-travel').innerHTML = h;

  function calc(){
    return calculateTrip({km:$('#tvKm').value,trips:$('#tvTrips').value,price:$('#tvPrice').value,consumption:$('#tvCons').value,nights:$('#tvNights').value,rate:$('#tvRate').value,extra:$('#tvExtra').value});
  }
  function paint(){
    var r; try { r=calc(); } catch(error) { $('#tvOut').textContent=error.message; $('#tvAdd').disabled=true; return; }
    $('#tvAdd').disabled=false;
    $('#tvOut').innerHTML = '<div class="big">'+money(r.total)+'</div><div class="sub">'+
      money(r.gas)+' gas over '+Math.round(r.km)+' km · '+money(r.hotel)+' hotel · '+money(r.extra)+' food</div>';
  }
  ['tvKm','tvTrips','tvPrice','tvCons','tvNights','tvRate','tvExtra'].forEach(function(id){
    $('#'+id).addEventListener('input',paint);
  });
  paint();

  $('#tvAdd').addEventListener('click',function(){
    var r; try { r=calc(); } catch(error) { toast(error.message); return; }
    if(r.total<=0){ toast('Nothing to add yet'); return; }
    S.settings.fuelPrice=Number($('#tvPrice').value)||st.fuelPrice;
    S.settings.lPer100=Number($('#tvCons').value)||st.lPer100;
    var t=$('#tvTeam').value, d=$('#tvDate').value||today(), nm=$('#tvName').value||'Road trip';
    var add=function(cat,amt){
      if(amt<=0) return;
      S.expenses.unshift({id:uid(),date:d,teamId:t,category:cat,desc:nm,amount:Math.round(amt*100)/100,paidBy:S.payers[0]||'',status:'Due',notes:'',updatedAt:now()});
    };
    add('Gas',r.gas); add('Hotel',r.hotel); add('Food',r.extra);
    if(!save()) return;
    toast('Trip added to expenses');
    document.querySelector('nav.tabs button[data-tab="expenses"]').click();
  });
}

/* ============ settings ============ */
function renderSettings(){
  $('#tab-settings').innerHTML = '<div class="panel"><h2>Season</h2><div class="body"><label class="field"><span>Season label</span><input id="setSeason" maxlength="40" value="'+esc(S.season||'')+'"></label><p class="hint">This labels the current books. Export them before starting a new season.</p><button class="btn" id="setSave">Save season label</button></div></div>'+
    '<div class="panel"><h2>Your budget data</h2><div class="body"><p class="hint">'+live().length+' entries, '+teamsLive().length+' teams. Budget edits use the same login, offline queue and shared sync as the calendar.</p><div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:12px"><button class="btn ghost" id="csvOut2">Export CSV</button><label class="btn ghost" style="cursor:pointer">Import CSV<input type="file" id="csvIn" accept=".csv,text/csv" hidden></label></div><p class="hint">Export respects the Expenses filters. Import adds rows; importing the same file twice creates duplicates. Columns: date, kid, team, category, details, amount, paid by, status, notes.</p></div></div>'+
    '<div class="panel"><h2>Family sharing</h2><div class="body"><p class="hint">Your existing Family Hub connection handles sharing. A full Family Hub backup also includes the budget, teams and settings.</p><button class="btn ghost" id="openSync">Family Hub settings</button></div></div>';
  $('#setSave').addEventListener('click',function(){ S.season=$('#setSeason').value.trim(); if(save()){render();toast('Season label saved');} });
  $('#csvOut2').addEventListener('click',exportCsv);
  $('#csvIn').addEventListener('change',importCsv);
  $('#openSync').addEventListener('click',openSettings);
}

/* ============ csv ============ */
function exportCsv(){
  var rows=[['date','kid','team','category','details','amount','paid by','status','notes']];
  filtered().forEach(function(e){
    var t=team(e.teamId), k=t&&kid(t.kidId);
    rows.push([e.date||'',k?k.name:'',t?(t.name||t.sport||''):'',e.category||'',e.desc||'',e.amount||0,e.paidBy||'',e.status||'',e.notes||'']);
  });
  var csv=rows.map(function(r){ return r.map(csvCell).join(','); }).join('\n');
  var blob=new Blob([csv],{type:'text/csv'}), a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='season-ledger-'+today()+'.csv'; a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); },1000);
  toast('CSV exported');
}
function importCsv(ev){
  const file=ev.target.files?.[0]; if(!file) return;
  ev.target.value='';
  if(file.size>2*1024*1024) return toast('Choose a CSV smaller than 2 MB.');
  file.text().then(text => {
    if(!host.isConnected || !hub.isUnlocked) return;
    try {
      const imported=importExpenses(S,text,uid,today());
      if(!window.confirm('Add '+imported.count+' expense rows to the family budget?')) return;
      S=imported.state;
      if(save()){render();toast(imported.count+' rows imported');}
    } catch(error) { toast(error.message); }
  }).catch(() => toast('Could not read that CSV.'));
}

function updateStatus(){
  const dot=$('#syncDot'), text=$('#syncTxt');
  const pending=hub.pending.some(op => op.type.startsWith('ledger'));
  let state='', label='Saved on this device';
  if(hub.storageError){state='err';label='Storage full — changes not saved';}
  else if(!hub.isUnlocked){state='err';label='Locked';}
  else if(hub.status==='syncing'){state='busy';label='Syncing…';}
  else if(hub.isShared && (hub.status==='error'||hub.status==='auth')){state='err';label='Sync needs attention';}
  else if(hub.isShared && (hub.status==='offline'||pending)){state=pending?'busy':'err';label=pending?'Saved here · sync pending':'Offline · saved here';}
  else if(hub.isShared && hub.lastSync){state='ok';label='Synced with family';}
  else if(hub.isShared){state='busy';label='Connecting…';}
  dot.className='dot '+state; text.textContent=label;
}
function labelControls(){
  const names={date:'Date',teamId:'Team',category:'Category',desc:'Details',amount:'Amount in CAD',paidBy:'Paid by',status:'Payment status',notes:'Notes',fKid:'Filter by kid',fTeam:'Filter by team',fCat:'Filter by category',fStatus:'Filter by payment status',fMonth:'Filter by month',fQ:'Search expenses'};
  root.querySelectorAll('input,select,textarea').forEach(el=>{
    if(el.closest('label') || el.getAttribute('aria-label')) return;
    el.setAttribute('aria-label', names[el.dataset.f] || names[el.id] || el.placeholder || el.dataset.k || el.dataset.t || (el.dataset.payer!=null?'Payer name':'Budget field'));
  });
}
let refreshPending=false, blurTimer;
function refresh(){
  updateStatus();
  if(!hub.isUnlocked) return;
  if(root.activeElement && /INPUT|TEXTAREA|SELECT/.test(root.activeElement.tagName)){refreshPending=true;return;}
  S=readLedger(hub);baseline=structuredClone(S);refreshPending=false;
  if(TAB!=='travel') render();
}
root.addEventListener('focusout',()=>{clearTimeout(blurTimer);blurTimer=setTimeout(()=>{if(refreshPending)refresh();},0);});
root.querySelector('nav.tabs').addEventListener('keydown',event=>{
  const tabs=[...root.querySelectorAll('[role="tab"]')], current=tabs.indexOf(root.activeElement);
  if(current<0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(current+(event.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;
  tabs[next].click();tabs[next].focus();
});
$('#syncBtn').addEventListener('click',()=>{hub.sync(true);updateStatus();});
const observer=new MutationObserver(()=>applyTheme());
function applyTheme(){host.dataset.theme=['dark','aurora'].includes(host.ownerDocument.documentElement.dataset.theme)?'dark':'light';}
observer.observe(host.ownerDocument.documentElement,{attributes:true,attributeFilter:['data-theme']});
const unsubscribe=hub.on(kind=>{if(kind==='status'||kind==='storage')updateStatus();});
applyTheme();render();updateStatus();
return {refresh,destroy(){observer.disconnect();unsubscribe();clearTimeout(blurTimer);clearTimeout($('#toast')._t);}};
}
