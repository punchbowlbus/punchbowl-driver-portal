const datasets = {
  operations: {
    title:"Active workshop jobs", subtitle:"Operational status and current responsibility",
    metrics:[
      ["Fleet availability","86%","↑ 3.2%","vs last week","good","✓"],
      ["Unavailable buses","5","↓ 2","from yesterday","good","!"],
      ["Open jobs","14","+ 3","created this week","neutral","▤"],
      ["Waiting parts","3","1 critical","over 48 hours","bad","◷"],
      ["Waiting approval","2","Oldest 6h","fleet manager review","neutral","✓"],
      ["Jobs overdue","2","No change","since yesterday","bad","!"],
    ],
    actions:[
      ["critical","M09104 · Out of Service","Brake system repair is 2 days overdue","2d overdue"],
      ["warning","M08908 · Waiting Parts","Door actuator pending for more than 48 hours","53h"],
      ["warning","M09679 · Waiting Approval","Mechanic completed — Fleet Manager sign-off required","6h"],
      ["info","M08910 · Safe while waiting","Bus remains available; replacement mirror is on order","1d"],
    ],
    stages:[["In Progress",6,"#175cd3"],["Waiting Parts",3,"#f79009"],["Waiting Approval",2,"#7f56d9"],["Assigned",3,"#98a2b3"]],
    summaryTitle:"Workshop flow", summaryText:"Current jobs by operational stage", summaryFoot:["14 active jobs","5 buses unavailable"],
    headers:["Vehicle","Job / Work Type","Current Stage","Assigned To","Time in Stage","Safety","Due","Actions"],
    rows:[
      {depot:"Hannans",mechanic:"William Louis",status:"In Progress",cells:[["M09104","BV11QZ"],["WJ-2026-990421","Brake System Repair"],badge("In Progress","info"),["William Louis","Started 08:12"],"4h 18m",badge("Not Safe","bad"),["28 Sep 2026","2 days overdue"],actions()],details:{"Reported fault":"Low brake pressure warning and air leak","Work status":"Diagnosis completed. Brake chamber replacement underway.","Operational impact":"Vehicle unavailable","Next action":"Complete repair and roller brake test"}},
      {depot:"Hannans",mechanic:"Ryan Scott",status:"Waiting Parts",cells:[["M08908","MO8908"],["WJ-2026-988540","Body Repair"],badge("Waiting Parts","warn"),["Ryan Scott","Paused 28 Sep"],"53h 06m",badge("Not Safe","bad"),["29 Sep 2026","Overdue"],actions()],details:{"Reported fault":"Rear door actuator failure","Waiting for":"Replacement actuator","Operational impact":"Vehicle unavailable","Supplier status":"Expected 01 Oct 2026"}},
      {depot:"Central",mechanic:"Kyl Emery",status:"Waiting Approval",cells:[["M09679","MO9679"],["WJ-2026-982173","90 Day Safety Check"],badge("Waiting Approval","neutral"),["Kyl Emery","Completed 07:26"],"6h 04m",badge("Safe","good"),["30 Sep 2026","Due today"],actions()],details:{"Inspection result":"All mandatory checks completed","Mechanic declaration":"Signed","Operational impact":"Held pending Fleet Manager approval","Next action":"Review and close Job Card"}},
      {depot:"Hannans",mechanic:"Peter Noah",status:"Waiting Parts",cells:[["M08910","MO8910"],["WJ-2026-979442","Mirror Replacement"],badge("Waiting Parts","warn"),["Peter Noah","Paused yesterday"],"26h 45m",badge("Safe","good"),["04 Oct 2026","On schedule"],actions()],details:{"Reported fault":"Damaged nearside saloon mirror","Waiting for":"Replacement mirror","Operational impact":"Safe to operate while waiting","Next action":"Book return visit when part arrives"}},
      {depot:"Goulburn",mechanic:"Ryan Scott",status:"Assigned",cells:[["M00538","MO0538"],["WJ-2026-974006","Scheduled Service"],badge("Assigned","neutral"),["Ryan Scott","Not started"],"1h 12m",badge("Available","good"),["02 Oct 2026","Planned"],actions()],details:{"Service type":"Medium service","Current odometer":"1,228,640 km","Operational impact":"Future booking — vehicle available","Next action":"Start work when vehicle enters workshop"}},
    ]
  },
  downtime: {
    title:"Vehicle downtime",subtitle:"Time unavailable separated from workshop and external delays",
    metrics:[
      ["Unavailable now","5","↓ 2","from yesterday","good","!"],["Average downtime","1.8d","↓ 0.4d","vs last month","good","◷"],["Repair time","64h","This week","active labour time","neutral","⌁"],["Waiting parts","91h","42%","of total delay","bad","◷"],["Approval delay","11h","↓ 18%","vs last month","good","✓"],["Returned to service","9","This week","completed vehicles","good","↗"]
    ],
    actions:[["critical","M09104 · Extended downtime","Unavailable for 3.2 days — brake repair overdue","3.2d"],["warning","M08908 · Parts delay","53 hours waiting for a door actuator","53h"],["info","M09679 · Approval delay","Safe vehicle awaiting Fleet Manager closure","6h"]],
    stages:[["Active repair",64,"#175cd3"],["Waiting parts",91,"#f79009"],["Waiting approval",11,"#7f56d9"],["External delay",18,"#98a2b3"]],
    summaryTitle:"Downtime composition",summaryText:"Recorded unavailable hours by delay type",summaryFoot:["184 total hours","91 hours parts delay"],
    headers:["Vehicle","Primary Reason","Unavailable Since","Repair Time","Parts Delay","Approval Delay","Total Downtime","Actions"],
    rows:[
      {depot:"Hannans",mechanic:"William Louis",status:"Overdue",cells:[["M09104","Hannans"],["Brake System Repair","Not safe to operate"],["27 Sep 2026","06:45"],"19h 30m","31h 15m","—",["3d 6h","Over target"],actions()],details:{"Current stage":"In Progress","Downtime target":"2 days","Current downtime":"3 days 6 hours","Primary delay":"Parts availability and repair complexity"}},
      {depot:"Hannans",mechanic:"Ryan Scott",status:"Waiting Parts",cells:[["M08908","Hannans"],["Rear Door Actuator","Not safe to operate"],["28 Sep 2026","07:10"],"5h 40m","53h 06m","—",["2d 10h","Parts delay"],actions()],details:{"Current stage":"Waiting Parts","Downtime target":"1 day","Current downtime":"2 days 10 hours","Primary delay":"Replacement actuator delivery"}},
      {depot:"Central",mechanic:"Kyl Emery",status:"Waiting Approval",cells:[["M09679","Central"],["90 Day Safety Check","Workshop hold"],["29 Sep 2026","10:20"],"7h 25m","—","6h 04m",["1d 3h","Awaiting approval"],actions()],details:{"Current stage":"Waiting Approval","Mechanic completed":"30 Sep 2026 07:26","Approval delay":"6 hours 4 minutes","Safety status":"Safe to return"}},
    ]
  },
  compliance: {
    title:"Maintenance compliance",subtitle:"Statutory and company maintenance programs by vehicle",
    metrics:[
      ["Overall compliance","92.4%","↑ 1.8%","vs last month","good","✓"],["Overdue items","4","2 critical","action required","bad","!"],["Due in 30 days","11","Plan now","across all programs","neutral","◷"],["90 day safety","97.3%","1 overdue","37 vehicles","good","✓"],["Registration","100%","0 expired","2 due in 90 days","good","✓"],["Missing records","3","↓ 4","data completion","good","?"]
    ],
    actions:[["critical","M08910 · Annual A/C overdue","24 days overdue — service record requires action","24d"],["warning","M09679 · 90 Day Safety","Fleet Manager approval required today","Today"],["warning","M00018 · A/C tracking not set","Add the last completed A/C service date","Missing"],["info","M00164 · Fire suppression","Installation status recorded as not fitted","N/A"]],
    stages:[["Compliant",68,"#12b76a"],["Due in 30 days",11,"#f79009"],["Overdue",4,"#f04438"],["Not set",3,"#98a2b3"]],
    summaryTitle:"Compliance position",summaryText:"All tracked maintenance requirements",summaryFoot:["86 tracked items","92.4% compliant"],
    headers:["Vehicle","Program","Last Completed","Next Due","Remaining","Compliance","Depot","Actions"],
    rows:[
      {depot:"Hannans",mechanic:"",status:"Overdue",cells:[["M08910","MO8910"],["Annual A/C Service","12 month cycle"],"31 Aug 2025",["31 Aug 2026","24 days overdue"],"-24 days",badge("Overdue","bad"),"Hannans",actions()],details:{"Program":"Annual Air Conditioning Service","Last completed":"31 August 2025","Next due":"31 August 2026","Compliance":"24 days overdue"}},
      {depot:"Central",mechanic:"Kyl Emery",status:"Waiting Approval",cells:[["M09679","MO9679"],["90 Day Safety Check","TfNSW inspection"],"22 Jul 2026",["20 Oct 2026","Due in 20 days"],"20 days",badge("Awaiting Approval","warn"),"Central",actions()],details:{"Program":"90 Day Safety Check","Inspection completed":"30 September 2026","Mechanic":"Kyl Emery","Compliance":"Awaiting Fleet Manager sign-off"}},
      {depot:"Hannans",mechanic:"",status:"Compliant",cells:[["M00007","MO007"],["Intercooler / Radiator Wash","6 month cycle"],"28 Aug 2026",["28 Feb 2027","Due in 151 days"],"151 days",badge("Compliant","good"),"Hannans",actions()],details:{"Program":"Intercooler / Radiator Wash","Last completed":"28 August 2026","Next due":"28 February 2027","Compliance":"On track"}},
      {depot:"Hannans",mechanic:"",status:"Compliant",cells:[["M00014","MO014"],["Air Conditioning","Equipment applicability"],"—","—","Not applicable",badge("Not Fitted","neutral"),"Hannans",actions()],details:{"Program":"Annual Air Conditioning Service","Equipment status":"Not fitted","Compliance":"No annual service required","Data source":"Fleet Register"}},
      {depot:"Hannans",mechanic:"",status:"Compliant",cells:[["M00164","MO164"],["Fire Suppression","Equipment applicability"],"—","—","Not applicable",badge("Not Fitted","neutral"),"Hannans",actions()],details:{"Program":"Fire Suppression Check","Equipment status":"Not fitted","Compliance":"No annual check required","Data source":"Fleet Register"}},
    ]
  }
};

datasets.defects={...datasets.operations,title:"Defects and reliability",subtitle:"Prototype section — reliability measures will be connected in the next stage"};
datasets.performance={...datasets.downtime,title:"Workshop performance",subtitle:"Prototype section — productivity will separate active work from external delays"};

const $=(id)=>document.getElementById(id);
let activeReport="operations";

function badge(text,tone="neutral"){return {type:"badge",text,tone};}
function actions(){return {type:"actions"};}
function esc(value){return String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}

function renderCell(value){
  if(value?.type==="badge") return `<span class="wi-badge ${esc(value.tone)}">${esc(value.text)}</span>`;
  if(value?.type==="actions") return `<div class="wi-row-actions"><button class="wi-row-action" type="button" title="View details">◉</button><button class="wi-row-action" type="button" title="More actions">•••</button></div>`;
  if(Array.isArray(value)) return `<span class="wi-cell-primary">${esc(value[0])}</span>${value[1]?`<span class="wi-cell-secondary">${esc(value[1])}</span>`:""}`;
  return esc(value);
}

function filteredRows(data){
  const search=$('wiSearch').value.trim().toLowerCase();
  const depot=$('wiDepot').value;
  const mechanic=$('wiMechanic').value;
  const status=$('wiStatus').value;
  return data.rows.filter(row=>{
    const haystack=[row.depot,row.mechanic,row.status,...row.cells.flatMap(cell=>Array.isArray(cell)?cell:cell?.text||cell)].join(" ").toLowerCase();
    return (!search||haystack.includes(search))&&(!depot||row.depot===depot)&&(!mechanic||row.mechanic===mechanic)&&(!status||row.status===status);
  });
}

function renderMetrics(data){
  $('wiMetrics').innerHTML=data.metrics.map(([label,value,trend,detail,tone,icon])=>`<article class="wi-metric"><div class="wi-metric-top"><span class="wi-metric-label">${esc(label)}</span><span class="wi-metric-icon">${esc(icon)}</span></div><strong>${esc(value)}</strong><div class="wi-metric-foot"><span class="wi-trend ${esc(tone)}">${esc(trend)}</span><span>${esc(detail)}</span></div></article>`).join('');
}

function renderActions(data){
  $('wiActionCount').textContent=data.actions.length;
  $('wiActionList').innerHTML=data.actions.map(([tone,title,detail,time],index)=>`<div class="wi-action-item" data-action-index="${index}"><i class="wi-action-tone ${tone}"></i><div><strong>${esc(title)}</strong><span>${esc(detail)}</span></div><time>${esc(time)}</time></div>`).join('');
}

function renderSummary(data){
  $('wiSummaryTitle').textContent=data.summaryTitle;
  $('wiSummaryText').textContent=data.summaryText;
  const max=Math.max(...data.stages.map(item=>item[1]),1);
  $('wiStageChart').innerHTML=data.stages.map(([label,value,color])=>`<div class="wi-stage-row"><span>${esc(label)}</span><div class="wi-stage-track"><div class="wi-stage-fill" style="width:${Math.max(5,(value/max)*100)}%;background:${color}"></div></div><b>${esc(value)}</b></div>`).join('');
  $('wiSummaryFoot').innerHTML=`<span><strong>${esc(data.summaryFoot[0])}</strong></span><span>${esc(data.summaryFoot[1])}</span>`;
}

function renderTable(data){
  const rows=filteredRows(data);
  $('wiTableTitle').textContent=data.title;
  $('wiTableSubtitle').textContent=data.subtitle;
  $('wiResultCount').textContent=`${rows.length} record${rows.length===1?'':'s'}`;
  $('wiTableHeaders').innerHTML=`<tr>${data.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr>`;
  $('wiTableBody').innerHTML=rows.length?rows.map((row,index)=>`<tr data-row-index="${data.rows.indexOf(row)}">${row.cells.map(cell=>`<td>${renderCell(cell)}</td>`).join('')}</tr>`).join(''):`<tr><td class="wi-empty" colspan="${data.headers.length}">No report records match the selected filters.</td></tr>`;
}

function render(){
  const data=datasets[activeReport];
  renderMetrics(data);renderActions(data);renderSummary(data);renderTable(data);
}

function openDrawer(row){
  $('wiDrawerTitle').textContent=Array.isArray(row.cells[0])?row.cells[0][0]:'Record details';
  $('wiDrawerBody').innerHTML=`<div class="wi-detail-grid">${Object.entries(row.details||{}).map(([label,value],index)=>`<div class="wi-detail ${index>2?'full':''}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>`;
  $('wiDrawer').classList.add('open');$('wiDrawer').setAttribute('aria-hidden','false');
}
function closeDrawer(){$('wiDrawer').classList.remove('open');$('wiDrawer').setAttribute('aria-hidden','true');}
function toast(message){const el=$('wiToast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2600);}

document.querySelectorAll('[data-report]').forEach(button=>button.addEventListener('click',()=>{
  activeReport=button.dataset.report;
  document.querySelectorAll('[data-report]').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-selected',String(item===button));});
  render();
}));
['wiSearch','wiDepot','wiMechanic','wiStatus','wiPeriod'].forEach(id=>$(id).addEventListener(id==='wiSearch'?'input':'change',()=>renderTable(datasets[activeReport])));
$('wiClear').addEventListener('click',()=>{['wiSearch','wiDepot','wiMechanic','wiStatus'].forEach(id=>$(id).value='');$('wiPeriod').value='week';render();});
$('wiRefresh').addEventListener('click',()=>{render();toast('Prototype report refreshed');});
$('wiPrint').addEventListener('click',()=>window.print());
$('wiExport').addEventListener('click',()=>toast('Export preview ready — live export will use the selected filters'));
$('wiTableBody').addEventListener('click',event=>{const rowEl=event.target.closest('tr[data-row-index]');if(rowEl)openDrawer(datasets[activeReport].rows[Number(rowEl.dataset.rowIndex)]);});
$('wiActionList').addEventListener('click',event=>{const item=event.target.closest('[data-action-index]');if(item)toast('This alert will open the linked vehicle or Job Card in the connected version');});
document.querySelectorAll('[data-close-drawer]').forEach(button=>button.addEventListener('click',closeDrawer));
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeDrawer();});

render();
