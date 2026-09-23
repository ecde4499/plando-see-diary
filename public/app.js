'use strict';

const state = { plans: [], tasks: [], executions: [], selectedPlanId: '', busyCompletion: new Set() };
const $ = (id) => document.getElementById(id);
const qs = (s) => document.querySelector(s);
const qsa = (s) => [...document.querySelectorAll(s)];

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) {
    let body = {};
    try { body = await response.json(); } catch (_) {}
    throw new Error(body.error || `요청 실패 (${response.status})`);
  }
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response.text();
};

function toast(message, error = false) {
  const el = $('toast');
  el.textContent = message;
  el.className = error ? 'show error' : 'show';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = ''; }, 2600);
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function fmtDate(value) {
  if (!value) return '-';
  const d = String(value).slice(0, 10);
  return d;
}

function fmtDateTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value));
}

function seoulIsoFromLocal(value) {
  if (!value) return null;
  return `${value}:00+09:00`;
}

function minutesLabel(v) { return `${Number(v || 0)}분`; }
function planName(id) { return state.plans.find((p) => p.id === id)?.title || '알 수 없는 계획'; }
function taskName(id) { return state.tasks.find((t) => t.id === id)?.title || '알 수 없는 할 일'; }

function setOptions(select, items, placeholder = '선택하세요') {
  select.replaceChildren();
  const ph = el('option', placeholder); ph.value = ''; select.append(ph);
  items.forEach(({ value, label }) => { const o = el('option', label); o.value = value; select.append(o); });
}

async function refreshAll() {
  const [plans, tasks, executions] = await Promise.all([
    api('/api/plans'), api('/api/tasks?sort=priority_due_created'), api('/api/executions')
  ]);
  state.plans = plans; state.tasks = tasks; state.executions = executions;
  if (!state.selectedPlanId || !plans.some((p) => p.id === state.selectedPlanId)) state.selectedPlanId = plans[0]?.id || '';
  renderDashboard(); renderPlanList(); fillPlanSelects(); renderTaskList(); fillTaskSelect(); renderExecutions();
  if (state.selectedPlanId) { $('seePlan').value = state.selectedPlanId; await renderSee(); }
  else { $('summaryGrid').replaceChildren(); $('reflectionList').replaceChildren(); }
}

function renderDashboard() {
  $('dashboardPlans').textContent = state.plans.length;
  $('dashboardOpenTasks').textContent = state.tasks.filter((t) => t.status === '진행 중').length;
  $('dashboardLogs').textContent = state.executions.length;
}

function renderPlanList() {
  const box = $('planList'); box.replaceChildren();
  if (!state.plans.length) { box.append(el('div', '아직 계획이 없습니다.', 'empty')); return; }
  for (const p of state.plans) {
    const item = el('article', null, 'item');
    const head = el('div', null, 'item-head');
    const left = el('div'); left.append(el('h4', p.title), el('div', `${fmtDate(p.start_date)} ~ ${fmtDate(p.end_date)} · ${p.priority} · 예상 ${minutesLabel(p.estimated_minutes)}`, 'meta'));
    head.append(left);
    const actions = el('div', null, 'actions');
    const edit = el('button', '수정', 'button small ghost'); edit.type='button'; edit.addEventListener('click', () => editPlan(p));
    const hist = el('button', '수정 이력', 'button small secondary'); hist.type='button'; hist.addEventListener('click', () => showHistory(p.id));
    actions.append(edit, hist); head.append(actions); item.append(head);
    item.append(el('p', `성공 기준: ${p.success_criteria}`));
    if (p.source_improvement_text) item.append(el('p', `이전 돌아보기에서 가져온 개선점: ${p.source_improvement_text}`, 'success-text'));
    box.append(item);
  }
}

function fillPlanSelects() {
  const items = state.plans.map((p) => ({ value: p.id, label: p.title }));
  const currentTaskPlan = $('taskPlan').value;
  setOptions($('taskPlan'), items, '계획 선택');
  if (items.some((x) => x.value === currentTaskPlan)) $('taskPlan').value = currentTaskPlan;
  const currentSee = state.selectedPlanId;
  setOptions($('seePlan'), items, '돌아볼 계획 선택');
  if (currentSee) $('seePlan').value = currentSee;
}

function resetPlanForm() {
  $('planForm').reset(); $('planId').value=''; $('sourceReflectionId').value=''; $('planPriority').value='보통'; $('planEstimated').value='60'; $('planFormTitle').textContent='계획 만들기'; $('cancelPlanEdit').classList.add('hidden'); $('importedImprovement').classList.add('hidden'); $('importedImprovement').textContent='';
}

function editPlan(p) {
  $('planId').value=p.id; $('planTitle').value=p.title; $('planStart').value=fmtDate(p.start_date); $('planEnd').value=fmtDate(p.end_date); $('planPriority').value=p.priority; $('planEstimated').value=p.estimated_minutes; $('planSuccess').value=p.success_criteria; $('planFormTitle').textContent='계획 수정'; $('cancelPlanEdit').classList.remove('hidden'); switchTab('plan'); window.scrollTo({top:0,behavior:'smooth'});
}

async function showHistory(id) {
  try {
    const rows = await api(`/api/plans/${id}/revisions`); const box=$('historyContent'); box.replaceChildren();
    if (!rows.length) box.append(el('div','아직 수정 이력이 없습니다.','empty'));
    rows.forEach((r) => { const item=el('div',null,'item'); item.append(el('h4',`Revision ${r.revision_no} · ${fmtDateTime(r.captured_at)}`),el('p',r.title),el('div',`${fmtDate(r.start_date)} ~ ${fmtDate(r.end_date)} · ${r.priority} · ${minutesLabel(r.estimated_minutes)}`,'meta'),el('p',`성공 기준: ${r.success_criteria}`)); box.append(item); });
    $('historyDialog').showModal();
  } catch(e){toast(e.message,true)}
}

function taskMatchesCurrentFilters(t) {
  const q=$('taskSearch').value.trim().toLowerCase(); const st=$('filterStatus').value; const pr=$('filterPriority').value; const tg=$('filterTag').value.trim().toLowerCase();
  if (st && t.status!==st) return false; if (pr && t.priority!==pr) return false; if (tg && !(t.tags||[]).some((x)=>String(x).toLowerCase().includes(tg))) return false;
  if (q) { const hay=[t.title,t.content,...(t.tags||[])].join(' ').toLowerCase(); if(!hay.includes(q)) return false; }
  return true;
}

function sortTasks(rows) {
  const mode=$('taskSort').value; const pRank={'높음':1,'보통':2,'낮음':3};
  return [...rows].sort((a,b)=>{
    if(mode==='created_desc') return String(b.created_at).localeCompare(String(a.created_at)) || String(a.id).localeCompare(String(b.id));
    if(mode==='priority_due_created') { const p=pRank[a.priority]-pRank[b.priority]; if(p) return p; }
    const ad=a.due_date?String(a.due_date):'9999-12-31', bd=b.due_date?String(b.due_date):'9999-12-31'; const d=ad.localeCompare(bd); if(d) return d;
    return String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id));
  });
}

function renderTaskList() {
  const box=$('taskList'); box.replaceChildren(); const rows=sortTasks(state.tasks.filter(taskMatchesCurrentFilters));
  if(!rows.length){box.append(el('div','조건에 맞는 할 일이 없습니다.','empty'));return}
  rows.forEach((t)=>{
    const item=el('article',null,'item'); const head=el('div',null,'item-head'); const left=el('div'); left.append(el('h4',t.title),el('div',`${planName(t.plan_id)} · 마감 ${fmtDate(t.due_date)} · ${t.priority} · 예상 ${minutesLabel(t.estimated_minutes)}`,'meta')); head.append(left);
    const badge=el('span',t.status,`status ${t.status==='완료'?'done':'open'}`); head.append(badge); item.append(head);
    if(t.content)item.append(el('p',t.content)); const tags=el('div'); (t.tags||[]).forEach((tag)=>tags.append(el('span',tag,'tag'))); item.append(tags);
    const actions=el('div',null,'actions');
    const edit=el('button','수정','button small ghost'); edit.type='button'; edit.onclick=()=>editTask(t); actions.append(edit);
    if(t.status==='완료'){const reopen=el('button','진행 중으로 되돌리기','button small secondary');reopen.type='button';reopen.onclick=()=>reopenTask(t.id);actions.append(reopen)}else{const done=el('button','완료','button small');done.type='button';done.disabled=state.busyCompletion.has(t.id);done.onclick=()=>completeTask(t.id,done);actions.append(done)}
    const del=el('button','삭제','button small danger'); del.type='button'; del.onclick=()=>deleteTask(t.id,t.title); actions.append(del); item.append(actions); box.append(item);
  });
}

function resetTaskForm(){ $('taskForm').reset();$('taskId').value='';$('taskPriority').value='보통';$('taskEstimated').value='30';$('taskFormTitle').textContent='할 일 만들기';$('cancelTaskEdit').classList.add('hidden') }
function editTask(t){$('taskId').value=t.id;$('taskPlan').value=t.plan_id;$('taskTitle').value=t.title;$('taskContent').value=t.content||'';$('taskDue').value=fmtDate(t.due_date)==='-'?'':fmtDate(t.due_date);$('taskPriority').value=t.priority;$('taskTags').value=(t.tags||[]).join(', ');$('taskEstimated').value=t.estimated_minutes;$('taskFormTitle').textContent='할 일 수정';$('cancelTaskEdit').classList.remove('hidden');switchTab('tasks');window.scrollTo({top:0,behavior:'smooth'})}

async function completeTask(id,button){
  if(state.busyCompletion.has(id))return; state.busyCompletion.add(id); button.disabled=true;
  const key=(crypto.randomUUID ? crypto.randomUUID() : `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`); // 요청 식별자. 중복 완료 자체는 DB의 active task UNIQUE가 보장한다.
  try{const result=await api(`/api/tasks/${id}/complete`,{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify({idempotency_key:key})});toast(`완료 처리됨 · 완료 기록 ${result.completion_event_count}건`);await refreshAll()}catch(e){toast(e.message,true)}finally{state.busyCompletion.delete(id);button.disabled=false}
}
async function reopenTask(id){try{await api(`/api/tasks/${id}/reopen`,{method:'POST',body:'{}'});toast('진행 중으로 되돌렸습니다.');await refreshAll()}catch(e){toast(e.message,true)}}
async function deleteTask(id,title){if(!confirm(`“${title}” 할 일을 삭제할까요?\n삭제된 항목은 집계에서 제외됩니다.`))return;try{await api(`/api/tasks/${id}`,{method:'DELETE'});toast('할 일을 삭제했습니다.');await refreshAll()}catch(e){toast(e.message,true)}}

function fillTaskSelect(){setOptions($('executionTask'),state.tasks.map((t)=>({value:t.id,label:`${t.title} · ${planName(t.plan_id)}`})),'할 일 선택')}
function renderExecutions(){const box=$('executionList');box.replaceChildren();if(!state.executions.length){box.append(el('div','아직 실행 기록이 없습니다.','empty'));return}state.executions.forEach((r)=>{const item=el('article',null,'item');item.append(el('h4',r.task_title||taskName(r.task_id)),el('div',`${fmtDateTime(r.started_at)} → ${fmtDateTime(r.ended_at)} · 실제 ${minutesLabel(r.actual_minutes)}`,'meta'));if(String(r.blocked_reason||'').trim())item.append(el('p',`막힘: ${r.blocked_reason}`,'danger-text'));box.append(item)})}

async function renderSee(){
  if(!state.selectedPlanId)return; try{
    const [summary,refs]=await Promise.all([api(`/api/summary/${state.selectedPlanId}`),api(`/api/reflections/${state.selectedPlanId}`)]); const box=$('summaryGrid');box.replaceChildren();
    const metrics=[['planCount','계획 수',summary.planCount],['completedCount','완료 수',summary.completedCount],['overdueCount','지연 수',summary.overdueCount],['blockedCount','막힘 수',summary.blockedCount],['estimatedMinutes','예상 시간',minutesLabel(summary.estimatedMinutes)],['actualMinutes','실제 시간',minutesLabel(summary.actualMinutes)],['differenceMinutes','차이',`${summary.differenceMinutes>=0?'+':''}${summary.differenceMinutes}분`]];
    metrics.forEach(([kind,label,value])=>{const b=el('button',null,`summary-button ${kind==='differenceMinutes'?'static':''}`);b.type='button';b.append(el('span',label),el('strong',value));if(kind!=='differenceMinutes')b.onclick=()=>showEvidence(kind,label);else b.disabled=true;box.append(b)});
    renderReflections(refs);
  }catch(e){toast(e.message,true)}
}

async function showEvidence(kind,label){try{const rows=await api(`/api/summary/${state.selectedPlanId}/evidence/${kind}`);$('evidenceHint').textContent=`${label}의 실제 근거 ${rows.length}건` ;const box=$('evidenceList');box.replaceChildren();if(!rows.length){box.append(el('div','근거 기록이 없습니다.','empty'));return}rows.forEach((r)=>{const item=el('div',null,'evidence-row');if(kind==='actualMinutes'){item.append(el('strong',r.task_title),el('div',`${fmtDateTime(r.started_at)} ~ ${fmtDateTime(r.ended_at)} · ${minutesLabel(r.actual_minutes)}`,'meta'));if(r.blocked_reason)item.append(el('div',`막힘: ${r.blocked_reason}`))}else{item.append(el('strong',r.title||taskName(r.task_id)),el('div',`상태 ${r.status||'-'} · 마감 ${fmtDate(r.due_date)} · 예상 ${minutesLabel(r.estimated_minutes)}`,'meta'));if(r.blocked_reason)item.append(el('div',`막힘: ${r.blocked_reason}`))}box.append(item)})}catch(e){toast(e.message,true)}}

function renderReflections(rows){const box=$('reflectionList');box.replaceChildren();if(!rows.length){box.append(el('div','저장된 개선점이 없습니다.','empty'));return}rows.forEach((r)=>{const item=el('div',null,'item');item.append(el('p',r.improvement_text),el('div',r.next_plan_id?`다음 계획 연결됨: ${planName(r.next_plan_id)}`:'아직 다음 계획에 연결되지 않음','meta'));if(!r.next_plan_id){const btn=el('button','이 개선점으로 다음 계획 만들기','button small secondary');btn.type='button';btn.onclick=()=>carryReflection(r);item.append(btn)}box.append(item)})}
function carryReflection(r){resetPlanForm();$('sourceReflectionId').value=r.id;$('importedImprovement').textContent=`이전 돌아보기에서 가져온 개선점: ${r.improvement_text}`;$('importedImprovement').classList.remove('hidden');$('planSuccess').value=r.improvement_text;switchTab('plan');window.scrollTo({top:0,behavior:'smooth'})}

function switchTab(name){qsa('.tab').forEach((b)=>b.classList.toggle('active',b.dataset.tab===name));qsa('.view').forEach((v)=>v.classList.toggle('active',v.id===name));if(name==='see')renderSee()}

qsa('.tab').forEach((b)=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
qsa('[data-close]').forEach((b)=>b.addEventListener('click',()=>$(b.dataset.close).close()));
$('newPlanBtn').onclick=resetPlanForm;$('cancelPlanEdit').onclick=resetPlanForm;$('cancelTaskEdit').onclick=resetTaskForm;

$('planForm').addEventListener('submit',async(e)=>{e.preventDefault();const id=$('planId').value;const payload={title:$('planTitle').value,start_date:$('planStart').value,end_date:$('planEnd').value,priority:$('planPriority').value,success_criteria:$('planSuccess').value,estimated_minutes:Number($('planEstimated').value),source_reflection_id:$('sourceReflectionId').value||null};try{await api(id?`/api/plans/${id}`:'/api/plans',{method:id?'PUT':'POST',body:JSON.stringify(payload)});toast(id?'계획을 수정했고 이전 버전을 보존했습니다.':'계획을 만들었습니다.');resetPlanForm();await refreshAll()}catch(err){toast(err.message,true)}});

$('taskForm').addEventListener('submit',async(e)=>{e.preventDefault();const id=$('taskId').value;const payload={plan_id:$('taskPlan').value,title:$('taskTitle').value,content:$('taskContent').value,due_date:$('taskDue').value||null,priority:$('taskPriority').value,tags:$('taskTags').value.split(',').map(x=>x.trim()).filter(Boolean),estimated_minutes:Number($('taskEstimated').value)};try{await api(id?`/api/tasks/${id}`:'/api/tasks',{method:id?'PUT':'POST',body:JSON.stringify(payload)});toast(id?'할 일을 수정했습니다.':'할 일을 만들었습니다.');resetTaskForm();await refreshAll()}catch(err){toast(err.message,true)}});

['taskSearch','filterStatus','filterPriority','filterTag','taskSort'].forEach((id)=>$(id).addEventListener(id==='taskSearch'||id==='filterTag'?'input':'change',renderTaskList));

$('executionForm').addEventListener('submit',async(e)=>{e.preventDefault();const s=$('startedAt').value,en=$('endedAt').value;if(!s||!en)return;const payload={task_id:$('executionTask').value,started_at:seoulIsoFromLocal(s),ended_at:seoulIsoFromLocal(en),actual_minutes:Number($('actualMinutes').value),blocked_reason:$('blockedReason').value};try{await api('/api/executions',{method:'POST',body:JSON.stringify(payload)});toast('실행 기록을 저장했습니다. 예상 시간은 변경되지 않았습니다.');e.target.reset();await refreshAll()}catch(err){toast(err.message,true)}});

$('seePlan').addEventListener('change',async()=>{state.selectedPlanId=$('seePlan').value;$('evidenceList').replaceChildren();$('evidenceHint').textContent='위 집계 숫자를 눌러 주세요.';await renderSee()});
$('reflectionForm').addEventListener('submit',async(e)=>{e.preventDefault();if(!state.selectedPlanId)return toast('계획을 먼저 선택하세요.',true);try{await api('/api/reflections',{method:'POST',body:JSON.stringify({source_plan_id:state.selectedPlanId,improvement_text:$('improvementText').value})});$('improvementText').value='';toast('개선점을 저장했습니다.');await renderSee()}catch(err){toast(err.message,true)}});

$('exportBtn').addEventListener('click',async()=>{try{const r=await fetch('/api/export');if(!r.ok)throw new Error('내보내기에 실패했습니다.');const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`plando-see-export-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);toast('전체 자료를 JSON 파일로 내보냈습니다.')}catch(e){toast(e.message,true)}});

function initDefaultDateTimes(){const now=new Date();const pad=(n)=>String(n).padStart(2,'0');const local=new Date(now.getTime()+9*3600000);const y=local.getUTCFullYear(),m=pad(local.getUTCMonth()+1),d=pad(local.getUTCDate()),h=pad(local.getUTCHours()),mi=pad(local.getUTCMinutes());const start=`${y}-${m}-${d}T${h}:${mi}`;$('startedAt').value=start;$('endedAt').value=start}

initDefaultDateTimes();refreshAll().catch((e)=>toast(`초기 데이터 로드 실패: ${e.message}`,true));
