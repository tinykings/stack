// Simple Budget app with Gist persistence
const STORAGE_KEY = 'budget_data_v1';
const GIST_ID_KEY = 'budget_gist_id';
const GIST_TOKEN_KEY = 'budget_gist_token';
const GIST_BASE_REVISION_KEY = 'budget_gist_base_revision';
const CLIENT_ID_KEY = 'budget_client_id';
const AUTOFILL_FREQ_KEY = 'autofill_frequency';
const AUTOFILL_START_DATE_KEY = 'autofill_start_date';

let state = {
  balances: { checking: 0, savings: 0, credit: 0 },
  accounts: [], // [{id, name, amount, isPositive}]
  items: { accounts: [], budget: [], bills: [], goals: [] },
  actionHistory: [] // Last 10 actions: [{type, name, section, amount?, date}]
};
let lastAvailableAmount = 0; // New global variable
let isSavingToGist = false; // Flag to prevent auto-refresh during save
let isLoadingFromGist = false; // Flag to prevent save during load

// Each item now has: id, name, amount, due, spent (array of {name, amount, date})

// Helpers
const $ = id => document.getElementById(id);
const q = (sel, root=document) => root.querySelector(sel);

function uid(){
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2,9);
}

function getClientId(){
  let clientId = localStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) {
    clientId = uid();
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  return clientId;
}

function ensureSyncMetadata(){
  if (!state._sync || typeof state._sync !== 'object') state._sync = {};
  if (!state._sync.clientId) state._sync.clientId = getClientId();
  return state._sync;
}

function setBaseRevision(revision){
  if (revision) localStorage.setItem(GIST_BASE_REVISION_KEY, revision);
  else localStorage.removeItem(GIST_BASE_REVISION_KEY);
}

function getBaseRevision(){
  return localStorage.getItem(GIST_BASE_REVISION_KEY) || '';
}

function prepareStateForGistSave(){
  const sync = ensureSyncMetadata();
  sync.revision = uid();
  sync.savedAt = new Date().toISOString();
  sync.clientId = getClientId();
  state._lastModified = Date.now();
  return sync.revision;
}

function getRemoteRevision(gistData, parsedState){
  return (gistData && gistData.history && gistData.history[0] && gistData.history[0].version)
    || (parsedState && parsedState._sync && parsedState._sync.revision)
    || (parsedState && parsedState._lastModified ? String(parsedState._lastModified) : '');
}

function recordAction(action){
  if (!Array.isArray(state.actionHistory)) state.actionHistory = [];
  state.actionHistory.unshift(action);
  if (state.actionHistory.length > 10) state.actionHistory.length = 10;
}

function formatActionDate(dateString){
  const date = new Date(dateString);
  if(Number.isNaN(date.getTime())) return '';
  try{
    const datePart = date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
    const timePart = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `${datePart} ${timePart}`.trim();
  }catch(err){
    return date.toLocaleString();
  }
}

// Load/save local
function loadLocal(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(raw){
    try{ state = JSON.parse(raw); } 
    catch(e){ console.warn('Invalid local data', e); }
  }
  normalizeStateShape();
  // Sync paySchedule from state to localStorage
  if (state.paySchedule) {
    if (state.paySchedule.frequency) {
      localStorage.setItem(AUTOFILL_FREQ_KEY, state.paySchedule.frequency);
    }
    if (state.paySchedule.startDate) {
      localStorage.setItem(AUTOFILL_START_DATE_KEY, state.paySchedule.startDate);
    }
  }
  if (!Array.isArray(state.actionHistory)) {
    state.actionHistory = [];
  }
  // Clean up legacy per-section lastAction fields
  delete state.accounts_lastAction;
  if (state.items) {
    Object.keys(state.items).forEach(k => {
      if (k.endsWith('_lastAction')) delete state.items[k];
    });
  }
  if (state.items) {
    Object.keys(state.items).forEach(section=>{
      if (Array.isArray(state.items[section])) { // Check if it's an array of items
        (state.items[section]||[]).forEach(it=>{
          if(it && it.neededAmount === undefined && section !== 'accounts'){
            it.neededAmount = it.amount;
          }
          if(it && it.due && typeof it.due === 'string'){
            // ISO date? YYYY-MM-DD
            if(/^\d{4}-\d{2}-\d{2}$/.test(it.due)){
              it.due = { type: 'date', value: it.due };
            } else {
              // leave simple strings as-is (backward compatible)
              // e.g., '-' or empty
            }
          }
        });
      }
    });
  }
  const gid = localStorage.getItem(GIST_ID_KEY);
  const tok = localStorage.getItem(GIST_TOKEN_KEY);
  if(gid) $('gistId').value = gid;
  if(tok) $('gistToken').value = tok;
  // Initialize lastAvailableAmount after loading local data
  const availableEl = $('available');
  if (availableEl && availableEl.textContent) {
    lastAvailableAmount = parseFloat(availableEl.textContent.replace(/[^0-9.-]+/g,"")) || 0;
  }
  migrateToUnifiedItems();
}
function saveLocal(){
  state._lastModified = Date.now();
  persistLocal();
}
function persistLocal(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Render

function renderLists(){
  // --- Accounts ---
  const accountsContainer = document.querySelector('.list-items[data-section="accounts"]');
  accountsContainer.innerHTML = '';
  const accounts = (state.accounts || []).slice();
  accounts.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  accounts.forEach(acc=>{
    const div = document.createElement('div');
    div.className = 'item';
    const amountClass = acc.isPositive ? 'asset' : 'liability';
    div.innerHTML = `
      <div class="item-content item-clickable" data-id="${acc.id}" data-section="accounts" role="button" tabindex="0">
        <div class="item-info">
          <div class="item-name">${escapeHtml(acc.name)}</div>
          <div class="item-amount ${amountClass}">$${Number(acc.amount).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
        </div>
      </div>
    `;
    accountsContainer.appendChild(div);
  });

  // --- Expenses (unified) ---
  const expensesContainer = document.querySelector('.list-items[data-section="expenses"]');
  expensesContainer.innerHTML = '';
  const items = (state.items.budget || []).slice();

  items.sort((a, b) => getNextDueTime(a) - getNextDueTime(b));

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'item';
    item.spent = item.spent || [];
    const totalSpent = item.spent.reduce((a,b)=>a+Number(b.amount||0),0);
    const remaining = Number(item.amount) - totalSpent;
    let amountClass = '';
    if (remaining > 0) amountClass = 'positive-amount';
    else if (remaining < 0) amountClass = 'liability';

    // Due display
    let dueDisplay = '-';
    if (item.due && item.due.date) {
      try {
        const d = new Date(item.due.date + 'T00:00:00');
        dueDisplay = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        if (item.due.recurring) dueDisplay += ' ♻';
      } catch(e) { dueDisplay = item.due.date; }
    }

    // Needed display
    const neededAmount = item.neededAmount !== undefined ? item.neededAmount : item.amount;
    const neededDisplay = `$${Number(neededAmount).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    let metaHTML = '';
    if (item.spent.length > 0) {
      const mostRecent = item.spent[item.spent.length - 1];
      metaHTML = `
        <div class="item-meta-row" data-id="${item.id}" data-section="budget">
          <span class="meta">${escapeHtml(dueDisplay)} • ${neededDisplay} • ${escapeHtml(mostRecent.name)} (-${Number(mostRecent.amount).toFixed(2)})</span>
        </div>
      `;
    } else {
      metaHTML = `
        <div class="item-meta-row" data-id="${item.id}" data-section="budget">
          <span class="meta">${escapeHtml(dueDisplay)} • ${neededDisplay}</span>
        </div>
      `;
    }

    // Progress bar
    const totalBudget = Number(neededAmount) || 0;
    const remainingPercent = totalBudget > 0 ? Math.max(0, Math.min(100, (remaining / totalBudget) * 100)) : 0;
    let progressClass = 'good';
    if (remainingPercent < 25) progressClass = 'danger';
    else if (remainingPercent < 50) progressClass = 'warning';
    const progressLabel = remainingPercent >= 50 ? 'Good progress' : remainingPercent >= 25 ? 'Some progress left' : 'Low progress';
    const progressHTML = totalBudget > 0 ? `
      <div class="item-progress" data-target-width="${remainingPercent}" role="progressbar" aria-valuenow="${Math.round(remainingPercent)}" aria-valuemin="0" aria-valuemax="100" aria-label="${progressLabel}">
        <div class="item-progress-bar ${progressClass}"></div>
      </div>
    ` : '';

    div.innerHTML = `
      <div class="item-content item-clickable" data-id="${item.id}" data-section="budget" role="button" tabindex="0">
        <div class="item-info">
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-amount ${amountClass}">$${Math.abs(remaining).toFixed(2)}</div>
        </div>
        ${metaHTML}
        ${progressHTML}
      </div>
    `;

    expensesContainer.appendChild(div);
  });

  // Stagger items top-to-bottom with a subtle lift, sync progress bars
  requestAnimationFrame(() => {
    const items = document.querySelectorAll('.item');
    items.forEach((el, i) => {
      const delay = i * 0.06;
      el.style.animation = `itemStagger 0.5s cubic-bezier(0.16, 1, 0.3, 1) both`;
      el.style.animationDelay = delay + 's';
      const bar = el.querySelector('.item-progress-bar');
      if (bar) bar.style.transitionDelay = delay + 's';
    });
    void expensesContainer.offsetHeight;
    expensesContainer.querySelectorAll('.item-progress').forEach(el => {
      const w = parseFloat(el.dataset.targetWidth);
      if (!isNaN(w)) {
        const bar = el.querySelector('.item-progress-bar');
        if (bar) bar.style.width = w + '%';
      }
    });
  });
}

function computeTotals(){
  const totalExpenses = (state.items.budget || []).reduce((a,b)=>{
    const totalSpent = (b.spent||[]).reduce((x,y)=>x+Number(y.amount||0),0);
    const remaining = Number(b.amount||0) - totalSpent;
    return a + (remaining > 0 ? remaining : 0);
  }, 0);

  const totalAccounts = (state.accounts || []).reduce((a, acc) => {
    const val = Number(acc.amount || 0);
    if(acc.isPositive) return a + val;
    else return a - val;
  }, 0);

  $('total-expenses').textContent = '$' + totalExpenses.toFixed(2);
  $('total-accounts').textContent = '$' + totalAccounts.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

  const available = totalAccounts - totalExpenses;
  
  const availableEl = $('available');
  const currentAvailableAmount = parseFloat(availableEl.textContent.replace(/[^0-9.-]+/g,"")) || 0;

  if (available !== currentAvailableAmount) {
    const direction = available > currentAvailableAmount ? 'up' : 'down';
    animateNumberChange(availableEl, currentAvailableAmount, available, 1000, direction);
  } else {
    availableEl.textContent = '$' + available.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  }
  lastAvailableAmount = available; // Update lastAvailableAmount after setting new value
}

function animateNumberChange(element, startValue, endValue, duration, direction) {
  let startTime;
  const easing = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  const rootStyle = getComputedStyle(document.documentElement);

  if (direction === 'up') {
    element.style.color = rootStyle.getPropertyValue('--green-text').trim() || '#7bc48e';
  } else if (direction === 'down') {
    element.style.color = rootStyle.getPropertyValue('--red-text').trim() || '#d47272';
  }

  function animate(currentTime) {
    if (!startTime) startTime = currentTime;
    const progress = Math.min((currentTime - startTime) / duration, 1);
    const easedProgress = easing(progress);

    const currentValue = startValue + (endValue - startValue) * easedProgress;
    element.textContent = '$' + currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      element.style.color = rootStyle.getPropertyValue('--amber').trim() || '#c8a44e';
    }
  }
  requestAnimationFrame(animate);
}

function formatActionText(action){
  const ts = formatActionDate(action.date);
  const prefix = ts ? `${ts}: ` : '';
  if (action.type === 'spend') {
    return `${prefix}spend ${action.name} -$${action.amount}`;
  }
  if (action.type === 'autofill') {
    return `${prefix}autofill ${action.name} +$${action.amount}`;
  }
  return `${prefix}${action.type} ${action.name}`;
}

function renderHistory(){
  const container = document.querySelector('.list-items[data-section="history"]');
  if (!container) return;
  container.innerHTML = '';
  const history = state.actionHistory || [];
  history.forEach(action => {
    const div = document.createElement('div');
    div.className = 'item item-readonly';
    div.innerHTML = `
      <div class="item-content">
        <div class="item-info">
          <div class="item-name" style="font-family:var(--mono);font-size:12px;color:var(--text-secondary);letter-spacing:-0.01em">${escapeHtml(formatActionText(action))}</div>
        </div>
      </div>
    `;
    container.appendChild(div);
  });
}

function closeOverlay(overlay) {
  overlay.classList.add('closing');
  setTimeout(() => overlay.remove(), 150);
}

function render(){ 
  renderLists(); 
  computeTotals(); 
  renderHistory(); 
  const landing = document.getElementById('landing');
  if (landing) {
    const hasData = (state.accounts && state.accounts.length > 0)
      || (state.items && state.items.budget && state.items.budget.length > 0);
    landing.classList.toggle('hidden', hasData);
  }
}

function escapeHtml(text){ return (text+'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"})[c]); }

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocalDate(dateStr) {
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(dateStr);
}

function getDueDayOfMonth(dateStr) {
  const parsed = parseLocalDate(dateStr);
  return Number.isNaN(parsed.getTime()) ? NaN : parsed.getDate();
}

function normalizeStateShape() {
  if (!state || typeof state !== 'object') state = {};
  if (!state.balances || typeof state.balances !== 'object') {
    state.balances = { checking: 0, savings: 0, credit: 0 };
  }
  if (!Array.isArray(state.accounts)) state.accounts = [];
  if (!state.items || typeof state.items !== 'object') state.items = {};
  ['accounts', 'budget', 'bills', 'goals'].forEach(section => {
    if (!Array.isArray(state.items[section])) state.items[section] = [];
  });
  if (!Array.isArray(state.actionHistory)) state.actionHistory = [];
}

function migrateToUnifiedItems(persist = true) {
  normalizeStateShape();
  let changed = false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Migrate budget items: recurrence → date + recurring
  (state.items.budget || []).forEach(item => {
    if (item.due && item.due.type === 'recurrence') {
      if (item.due.value === 'every-month') {
        item.due = { date: formatDate(new Date(today.getFullYear(), today.getMonth(), 1)), recurring: true };
      } else {
        item.due = { date: formatDate(today), recurring: false };
      }
      changed = true;
    }
  });

  // Migrate bills → budget
  if (state.items.bills && state.items.bills.length > 0) {
    state.items.bills.forEach(item => {
      if (item.due && item.due.type === 'day') {
        const day = Number(item.due.value);
        let nextDate = new Date(today.getFullYear(), today.getMonth(), day);
        if (nextDate < today || nextDate.getDate() !== day) {
          nextDate = new Date(today.getFullYear(), today.getMonth() + 1, day);
        }
        item.due = { date: formatDate(nextDate), recurring: true };
      } else {
        item.due = { date: formatDate(today), recurring: false };
      }
      item.enableSpending = true;
      state.items.budget.push(item);
    });
    state.items.bills = [];
    changed = true;
  }

  // Migrate goals → budget
  if (state.items.goals && state.items.goals.length > 0) {
    state.items.goals.forEach(item => {
      if (item.due && (item.due.type === 'date' || typeof item.due === 'object')) {
        const dateVal = item.due.value || (typeof item.due === 'object' ? '' : item.due);
        item.due = { date: dateVal, recurring: false };
      } else {
        item.due = { date: formatDate(today), recurring: false };
      }
      item.enableSpending = true;
      state.items.budget.push(item);
    });
    state.items.goals = [];
    changed = true;
  }

  // Clean up legacy fields
  delete state.disabledSections;

  if (changed && persist) saveLocal();
  return changed;
}

function getNextDueTime(item) {
  if (!item.due || !item.due.date) return Infinity;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (item.due.recurring) {
    const dayOfMonth = getDueDayOfMonth(item.due.date);
    if (Number.isNaN(dayOfMonth)) return Infinity;
    let next = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);
    if (next < today || next.getDate() !== dayOfMonth) {
      next = new Date(today.getFullYear(), today.getMonth() + 1, dayOfMonth);
    }
    return next.getTime();
  }

  const d = new Date(item.due.date + 'T00:00:00');
  if (isNaN(d.getTime())) return Infinity;
  if (d < today) return Infinity;
  return d.getTime();
}

function getSectionLabel(section){
  const labels = { accounts: 'account', budget: 'expense' };
  return labels[section] || section;
}

// Inline error helpers
function showInlineError(inputEl, message) {
  const existing = inputEl.parentElement.querySelector('.inline-error');
  if (existing) existing.remove();
  const rootStyle = getComputedStyle(document.documentElement);
  inputEl.style.borderColor = rootStyle.getPropertyValue('--red-text').trim() || '#d47272';
  const err = document.createElement('span');
  err.className = 'inline-error';
  err.setAttribute('role', 'alert');
  err.textContent = message;
  Object.assign(err.style, { color: rootStyle.getPropertyValue('--red-text').trim() || '#d47272', fontSize: '12px', fontFamily: 'var(--mono)', marginTop: '4px', display: 'block' });
  inputEl.parentElement.appendChild(err);
  inputEl.addEventListener('input', function clearErr(){
    const e = inputEl.parentElement.querySelector('.inline-error');
    if (e) e.remove();
    inputEl.style.borderColor = '';
  }, { once: true });
}

function clearInlineErrors(modalEl) {
  modalEl.querySelectorAll('.inline-error').forEach(e => e.remove());
  modalEl.querySelectorAll('input, select').forEach(el => el.style.borderColor = '');
}

// Custom confirm dialog
function showConfirmDialog(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.alignItems = 'center';
    const modal = document.createElement('div');
    modal.className = 'modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.style.maxWidth = '380px';
    const rootStyle = getComputedStyle(document.documentElement);
    modal.innerHTML = `
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:${rootStyle.getPropertyValue('--text').trim() || '#d4d0c8'}">${escapeHtml(message)}</p>
      <div class="actions">
        <button id="_confirm_no" class="confirm-cancel">Cancel</button>
        <button id="_confirm_yes" class="confirm-ok">OK</button>
      </div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const cleanup = () => overlay.remove();
    const no = () => { cleanup(); resolve(false); };
    const yes = () => { cleanup(); resolve(true); };

    modal.querySelector('#_confirm_no').addEventListener('click', no);
    modal.querySelector('#_confirm_yes').addEventListener('click', yes);
    overlay.addEventListener('click', e => { if (e.target === overlay) no(); });
    modal.addEventListener('keydown', e => { if (e.key === 'Escape') no(); if (e.key === 'Enter') yes(); });
    trapFocus(modal);
    setTimeout(() => modal.querySelector('#_confirm_yes').focus(), 20);
  });
}

// Three-way sync choice dialog
function showSyncChoiceDialog() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.alignItems = 'center';
    const modal = document.createElement('div');
    modal.className = 'modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.style.maxWidth = '380px';
    modal.innerHTML = `
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:var(--text)">You have local data. What would you like to do?</p>
      <div class="actions" style="flex-direction:column">
        <button id="_sync_save" style="background:var(--amber);border-color:var(--amber);color:var(--bg)">Replace data on Gist</button>
        <button id="_sync_load" style="background:var(--surface);border-color:var(--border);color:var(--text)">Load from Gist</button>
        <button id="_sync_cancel" style="background:transparent;border-color:var(--border);color:var(--text-dim)">Cancel</button>
      </div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const cleanup = () => overlay.remove();
    const resolveAndCleanup = (val) => { cleanup(); resolve(val); };
    modal.querySelector('#_sync_save').addEventListener('click', () => resolveAndCleanup('save'));
    modal.querySelector('#_sync_load').addEventListener('click', () => resolveAndCleanup('load'));
    modal.querySelector('#_sync_cancel').addEventListener('click', () => resolveAndCleanup(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) resolveAndCleanup(null); });
    modal.addEventListener('keydown', e => { if (e.key === 'Escape') resolveAndCleanup(null); });
    trapFocus(modal);
    setTimeout(() => modal.querySelector('#_sync_save').focus(), 20);
  });
}

// Undo mechanism
let undoSnapshot = null;
let undoDescription = '';
let undoTimeout = null;

function takeUndoSnapshot(description) {
  undoSnapshot = JSON.stringify(state);
  undoDescription = description;
  if (undoTimeout) clearTimeout(undoTimeout);
}

function showUndoToast() {
  const existing = document.getElementById('undo-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'undo-toast';
  const rootStyle = getComputedStyle(document.documentElement);
  const undoBg = rootStyle.getPropertyValue('--card').trim() || '#1a1a1a';
  const undoBorder = rootStyle.getPropertyValue('--border').trim() || '#383838';
  const undoText = rootStyle.getPropertyValue('--text').trim() || '#d4d0c8';
  const undoBtnBg = rootStyle.getPropertyValue('--amber').trim() || '#c8a44e';
  const undoBtnColor = rootStyle.getPropertyValue('--bg').trim() || '#141414';
  Object.assign(toast.style, {
    position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
    zIndex: '10000', background: undoBg, border: `1px solid ${undoBorder}`,
    borderRadius: '6px', padding: '12px 16px', display: 'flex',
    alignItems: 'center', gap: '16px', fontSize: '14px', color: undoText,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    animation: 'slideUp 0.2s cubic-bezier(0.16,1,0.3,1)'
  });
  toast.innerHTML = `<span>${escapeHtml(undoDescription)}</span><button id="_undo_btn" style="background:${undoBtnBg};color:${undoBtnColor};border:none;border-radius:4px;padding:8px 16px;font-weight:600;cursor:pointer;white-space:nowrap">Undo</button><div class="undo-timer"></div>`;
  document.body.appendChild(toast);

  document.getElementById('_undo_btn').addEventListener('click', () => {
    if (undoSnapshot) {
      state = JSON.parse(undoSnapshot);
      undoSnapshot = null;
      if (undoTimeout) clearTimeout(undoTimeout);
      saveLocal(); render(); autosaveToGist();
    }
    toast.remove();
  });
}

function scheduleUndoClear() {
  if (undoTimeout) clearTimeout(undoTimeout);
  undoTimeout = setTimeout(() => {
    undoSnapshot = null;
    const toast = document.getElementById('undo-toast');
    if (toast) toast.remove();
  }, 6000);
}

// Actions
function addItem({name,amount,neededAmount,due,section,enableSpending}){
  if(section === 'accounts'){
    // accounts have different structure: name, amount, isPositive
    state.accounts = state.accounts || [];
    state.accounts.push({id:uid(), name, amount: parseFloat(amount)||0, isPositive: due === true}); // due used as isPositive flag
    recordAction({ type: 'add', name, section: 'accounts', date: new Date().toISOString() });
  } else {
    state.items = state.items || {};
    state.items[section] = state.items[section] || [];
    const finalNeededAmount = neededAmount !== undefined ? parseFloat(neededAmount) : parseFloat(amount);
    const spendingEnabled = enableSpending !== undefined ? enableSpending : true;
    state.items[section].push({id:uid(),name,amount: parseFloat(amount)||0,neededAmount: finalNeededAmount||0,due,spent:[],enableSpending: spendingEnabled});
    recordAction({ type: 'add', name, section, date: new Date().toISOString() });
  }
  saveLocal(); render();
  autosaveToGist();
}

function updateItem(section, id, {name, amount, due, neededAmount, enableSpending}){
  if(section === 'accounts'){
    const item = state.accounts.find(a=>a.id===id);
    if(item){
      item.name = name;
      item.amount = amount;
      item.isPositive = due;
      recordAction({ type: 'edit', name: item.name, section: 'accounts', date: new Date().toISOString() });
    }
  } else {
    const item = state.items[section].find(i=>i.id===id);
    if(item){
      item.name = name;
      item.amount = amount;
      item.due = due;
      if (neededAmount !== undefined) item.neededAmount = neededAmount;
      if (enableSpending !== undefined) item.enableSpending = enableSpending;
      recordAction({ type: 'edit', name: item.name, section, date: new Date().toISOString() });
    }
  }
  saveLocal(); render();
  autosaveToGist();
}

async function removeItem(section,id){
  if(section === 'accounts'){
    state.accounts = state.accounts.filter(a=>a.id!==id);
  } else {
    state.items[section] = state.items[section].filter(i=>i.id!==id);
  }
  saveLocal(); render();
  await autosaveToGist();
}

function addSpending(section, itemId, spendName, spendAmount){
  const item = state.items[section].find(i=>i.id===itemId);
  if(!item) return;
  item.spent = item.spent || [];
  const now = new Date().toISOString();
  item.spent.push({name: spendName, amount: spendAmount, date: now});
  // record meta for UI
  state._lastUpdated = now;
  state._lastSpend = { section, itemId, name: spendName, amount: spendAmount, date: now, itemName: item.name };
  recordAction({ type: 'spend', name: item.name, section, amount: spendAmount, date: now });
  saveLocal();
}

// UI wiring
function setupUI(){
  loadLocal(); render();

  // Landing page onboarding
  const landingTitle = document.querySelector('.landing-title');
  if (landingTitle) {
    const startOnboarding = () => {
      document.body.classList.add('onboarding');
      document.getElementById('landing').classList.add('hidden');
      showItemForm('accounts', null, () => {
        showItemForm('budget', null, () => {
          document.body.classList.remove('onboarding');
          render();
        }, 'Next');
      }, 'Next', () => {
        document.body.classList.remove('onboarding');
        if (!state.accounts || state.accounts.length === 0) {
          document.getElementById('landing').classList.remove('hidden');
        }
      });
    };
    landingTitle.addEventListener('click', startOnboarding);
    landingTitle.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startOnboarding();
      }
    });
  }

  // per-section add buttons (now includes accounts)
  document.querySelectorAll('.addItemSectionBtn').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const sec = btn.dataset.section; 
      showItemForm(sec);
    });
  });

  document.querySelectorAll('.list-items').forEach(container=>{
    container.addEventListener('click', e=>{
      // Handle inline actions
      const actionBtn = e.target.closest('.icon-action-btn');
      if(actionBtn){
        const id = actionBtn.dataset.id;
        const section = actionBtn.dataset.section;
        const action = actionBtn.dataset.action;
        
        if(action === 'spend'){
          showSpendingForm(section, id);
        } else if(action === 'edit'){
          showItemForm(section, id);
        }
        return;
      }

      // Handle item click (optional, maybe show details or edit if no specific button clicked)
      const itemClickable = e.target.closest('.item-clickable');
      if(itemClickable){
        const id = itemClickable.dataset.id;
        const section = itemClickable.dataset.section;
        // For now, clicking the body also opens edit/details, or we could do nothing
        showItemForm(section, id); 
      }
    });
    container.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        const item = e.target.closest('.item-clickable');
        if (item) {
          e.preventDefault();
          showItemForm(item.dataset.section, item.dataset.id);
        }
      }
    });
  });

  const gistModal = $('gist-modal');
  const syncBtn = $('sync-btn');
  const landingSettingsBtn = $('landing-settings-btn');
  const gistModalClose = $('gist-modal-close');

  const openGistModal = () => { gistModal.style.display = 'flex'; };

  if (syncBtn) {
    syncBtn.addEventListener('click', openGistModal);
  }

  if (landingSettingsBtn) {
    landingSettingsBtn.addEventListener('click', openGistModal);
  }

  const gistRefreshBtn = $('gist-refresh-btn');
  if (gistRefreshBtn) {
    gistRefreshBtn.addEventListener('click', async () => {
      const token = localStorage.getItem(GIST_TOKEN_KEY);
      const gistId = localStorage.getItem(GIST_ID_KEY);
      if (!token || !gistId) {
        openGistModal();
        setStatus('Enter Gist ID and token', true);
        return;
      }
      await loadFromGist(false, true);
    });
  }

  const gistSaveBtn = $('gist-save-btn');
  const gistLoadBtn = $('gist-load-btn');
  if (gistLoadBtn) {
    gistLoadBtn.addEventListener('click', async () => {
      await loadFromGist(false, true);
    });
  }

  if (gistSaveBtn) {
    gistSaveBtn.addEventListener('click', async () => {
      const token = ($('gistToken')?.value.trim() || localStorage.getItem(GIST_TOKEN_KEY) || '');
      const gistId = ($('gistId')?.value.trim() || localStorage.getItem(GIST_ID_KEY) || '');
      if (!token || !gistId) { setStatus('Enter Gist ID and token', true); return; }

      const hasLocalData = (state.accounts && state.accounts.length > 0)
        || (state.items && state.items.budget && state.items.budget.length > 0)
        || (state.actionHistory && state.actionHistory.length > 0);

      if (!hasLocalData) {
        await loadFromGist(false, true);
      } else {
        const choice = await showSyncChoiceDialog();
        if (choice === 'save') await saveToGist(false);
        else if (choice === 'load') await loadFromGist(false, true);
      }
    });
  }

  if (gistModalClose) {
    gistModalClose.addEventListener('click', () => {
      gistModal.style.display = 'none';
    });
  }

  if (gistModal) {
    gistModal.addEventListener('click', e => {
      if (e.target === gistModal) {
        gistModal.style.display = 'none';
      }
    });
  }

  const autofillBtn = $('autofill-btn');
  if (autofillBtn) autofillBtn.addEventListener('click', showAutofillModal);

  // Export Data button - downloads state as JSON file
  const exportBtn = $('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      try {
        const data = JSON.stringify(state, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const date = new Date().toISOString().slice(0, 10);
        a.download = `stack-backup-${date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        setStatus('Export failed: ' + err.message, true);
      }
    });
  }

  // Import Data button - triggers file input
  const importBtn = $('import-btn');
  const importFile = $('import-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => {
      importFile.click();
    });

    importFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const importedData = JSON.parse(event.target.result);
          
          // Validate basic structure
          if (!importedData || typeof importedData !== 'object' || Array.isArray(importedData)) {
            throw new Error('Invalid backup file format');
          }

          (async () => {
            const confirmed = await showConfirmDialog('This will replace all your current data with the imported backup. Are you sure?');
            if (!confirmed) return;
            takeUndoSnapshot('Data imported');
            state = importedData;
            normalizeStateShape();
            migrateToUnifiedItems(false);
            saveLocal();
            render();
            setStatus('Data imported successfully!');
            const gistModal = $('gist-modal');
            if (gistModal) gistModal.style.display = 'none';
          })();
        } catch (err) {
          setStatus('Import failed: ' + err.message, true);
        }
        
        importFile.value = '';
      };

      reader.onerror = () => {
        setStatus('Failed to read file', true);
        importFile.value = '';
      };

      reader.readAsText(file);
    });
  }

}

// Gist API
function setGistLoading(loading) {
  ['gist-save-btn', 'gist-load-btn', 'gist-refresh-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = loading;
  });
  document.querySelector('.gist-controls')?.classList.toggle('gist-loading', loading);
}

async function fetchGistState(gistId, token){
  const headers = token ? { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' } : { 'Accept': 'application/vnd.github+json' };
  const res = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`, {
    headers,
    cache: 'no-store'
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || res.statusText || 'Gist request failed');
  }
  const file = data.files['budget-data.json'] || Object.values(data.files)[0];
  if (!file) {
    throw new Error('No files found in gist');
  }
  const parsed = JSON.parse(file.content);
  return { data, parsed, revision: getRemoteRevision(data, parsed) };
}

async function saveToGist(createNew=false, silent=false){
  const tokenEl = $('gistToken'); const gidEl = $('gistId');
  const token = tokenEl ? tokenEl.value.trim() : (localStorage.getItem(GIST_TOKEN_KEY) || '');
  const gistId = gidEl ? gidEl.value.trim() : (localStorage.getItem(GIST_ID_KEY) || '');
  if(!token){ if(!silent) setStatus('Missing GitHub token', true); return; }
  if(!gistId && !createNew){ if(!silent) setStatus('Missing Gist ID', true); return; }
  const headers = { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' };
  if(!silent) setGistLoading(true);
  if(!silent) setStatus('Saving to gist');
  try{
    let res;
    if(createNew || !gistId){
      const newRevision = prepareStateForGistSave();
      const payload = {"budget-data.json": {content: JSON.stringify(state, null, 2)}};
      res = await fetch('https://api.github.com/gists', {
        method: 'POST', headers: {...headers, 'Content-Type':'application/json'},
        body: JSON.stringify({files: payload, public: false, description: 'Budget data'})
      });
      const data = await res.json();
      if(res.ok){
        const id = data.id;
        if(gidEl) gidEl.value = id; localStorage.setItem(GIST_ID_KEY, id); localStorage.setItem(GIST_TOKEN_KEY, token);
        setBaseRevision(getRemoteRevision(data, state) || newRevision);
        persistLocal();
        if(!silent) setStatus('Saved to gist: ' + id);
        return true;
      }
      if(!silent) setStatus('Gist save failed: ' + (data.message||res.statusText), true);
      console.error('Gist error', data);
      return false;
    } else {
      let remote;
      try {
        remote = await fetchGistState(gistId, token);
      } catch (err) {
        if(!silent) setStatus('Gist save failed: ' + err.message, true);
        else setStatus('Autosave failed: could not check latest Gist', true);
        console.error(err);
        return false;
      }

      const baseRevision = getBaseRevision();
      if (!baseRevision || (remote.revision && remote.revision !== baseRevision)) {
        setStatus('Remote data changed. Pull latest before saving.', true);
        return false;
      }

      const newRevision = prepareStateForGistSave();
      const payload = {"budget-data.json": {content: JSON.stringify(state, null, 2)}};
      res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH', headers: {...headers, 'Content-Type':'application/json'},
        body: JSON.stringify({files: payload})
      });
      const data = await res.json();
      if(res.ok){
        const id = data.id;
        if(gidEl) gidEl.value = id; localStorage.setItem(GIST_ID_KEY, id); localStorage.setItem(GIST_TOKEN_KEY, token);
        setBaseRevision(getRemoteRevision(data, state) || newRevision);
        persistLocal();
        if(!silent) setStatus('Saved to gist: ' + id);
        return true;
      }
      if(!silent) setStatus('Gist save failed: ' + (data.message||res.statusText), true);
      console.error('Gist error', data);
      return false;
    }
  }catch(err){ if(!silent) setStatus('Network error saving gist', true); console.error(err); }
  finally { if(!silent) setGistLoading(false); }
  return false;
}

async function autosaveToGist(){
  // Don't save while a load is in progress
  if (isLoadingFromGist) return false;
  const token = ($('gistToken') && $('gistToken').value.trim()) || localStorage.getItem(GIST_TOKEN_KEY);
  const gid = ($('gistId') && $('gistId').value.trim()) || localStorage.getItem(GIST_ID_KEY);
  if(!token || !gid) return false; // silently skip
  // Set flag to prevent auto-refresh during save
  isSavingToGist = true;
  try {
    return await saveToGist(false, true);
  } finally {
    isSavingToGist = false;
  }
}

async function loadFromGist(silent = false, force = false){
  // Don't load while a save is in progress
  if (isSavingToGist) return;

  isLoadingFromGist = true;
  try {
    const tokenEl = $('gistToken');
    const gidEl = $('gistId');

    let token = tokenEl ? tokenEl.value.trim() : '';
    let gistId = gidEl ? gidEl.value.trim() : '';

    // If input fields are empty, try to get from localStorage
    if (!token) token = localStorage.getItem(GIST_TOKEN_KEY) || '';
    if (!gistId) gistId = localStorage.getItem(GIST_ID_KEY) || '';

    // Update input fields if values were found in localStorage and fields were empty
    if (tokenEl && !tokenEl.value.trim() && token) tokenEl.value = token;
    if (gidEl && !gidEl.value.trim() && gistId) gidEl.value = gistId;

    if(!gistId){ if(!silent) setStatus('Missing Gist ID', true); return; }
    if(!token){ if(!silent) setStatus('Missing GitHub token', true); return; }

    if(!silent) setGistLoading(true);
    if(!silent) setStatus('Loading from gist');
    try{
      const remote = await fetchGistState(gistId, token);
      try{
        const parsed = remote.parsed;
        // Don't overwrite if local state was modified more recently (unless forced)
        if (!force && state._lastModified && parsed._lastModified && parsed._lastModified < state._lastModified) {
          return;
        }
        state = parsed;
        normalizeStateShape();
        migrateToUnifiedItems(false);
        const sync = ensureSyncMetadata();
        if (!sync.revision) sync.revision = uid();
        // Sync paySchedule from state to localStorage
        if (state.paySchedule) {
          if (state.paySchedule.frequency) {
            localStorage.setItem(AUTOFILL_FREQ_KEY, state.paySchedule.frequency);
          }
          if (state.paySchedule.startDate) {
            localStorage.setItem(AUTOFILL_START_DATE_KEY, state.paySchedule.startDate);
          }
        }
        setBaseRevision(remote.revision || sync.revision);
        persistLocal(); render();
        localStorage.setItem(GIST_ID_KEY, gistId); if(token) localStorage.setItem(GIST_TOKEN_KEY, token);
        if(!silent) setStatus('Loaded data from gist');
      }catch(e){ setStatus('Invalid JSON in gist file', true); }
    } catch(err) {
      setStatus('Gist load failed: ' + err.message, true);
    }
  }catch(err){ setStatus('Network error loading gist', true); console.error(err); }
  finally {
    isLoadingFromGist = false;
    if(!silent) setGistLoading(false);
  }
}

function trapFocus(modalEl) {
  const focusable = modalEl.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  modalEl.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

function setStatus(msg, isError=false){
  const rootStyle = getComputedStyle(document.documentElement);
  const s = $('status');
  s.textContent = msg;
  s.style.color = isError ? (rootStyle.getPropertyValue('--red-text').trim() || '#d47272') : (rootStyle.getPropertyValue('--text-dim').trim() || '#8a887f');
}

// Show a modal/form for adding spending to an item
function showSpendingForm(section, itemId, onSaved = null){
  const item = state.items[section].find(i=>i.id===itemId);
  if(!item) return;

  // Create modal overlay
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const modal = document.createElement('div'); modal.className = 'modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  
  // Build account selector options
  let accountOptions = '<option value="">-- No account change --</option>';
  (state.accounts || []).forEach(acc=>{
    const label = acc.isPositive ? '✓ Asset' : '✗ Liability';
    accountOptions += `<option value="${acc.id}">${escapeHtml(acc.name)} (${label} $${Number(acc.amount).toFixed(2)})</option>`;
  });
  
  modal.innerHTML = `
    <h3>Add spending to "${escapeHtml(item.name)}"</h3>
    <label>Name<br><input id="_spend_name" type="text" placeholder="e.g. Groceries" maxlength="100"></label>
    <label>Amount<br><input id="_spend_amt" type="number" step="0.01" inputmode="decimal" placeholder="0.00"></label>
    <label>Charge to account<br><select id="_spend_account">${accountOptions}</select></label>
    <div class="actions"><button id="_spend_cancel">Cancel</button><button id="_spend_ok">Add</button></div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // focus first field
  setTimeout(()=> document.getElementById('_spend_name').focus(), 20);

  function cleanup(){ closeOverlay(overlay); }

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('_spend_ok').click(); }
    if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
  });
  trapFocus(modal);

  // Select all on focus for amount field
  document.getElementById('_spend_amt').addEventListener('focus', (e) => e.target.select());

  // session remember: default account selection stored in sessionStorage
  try{
    const pref = sessionStorage.getItem('spend_charge_credit_default');
    if(pref !== null){
      document.getElementById('_spend_account').value = pref;
    }
  }catch(e){ /* ignore */ }

  // when user selects account, remember preference for this browser session
  document.getElementById('_spend_account').addEventListener('change', (e)=>{
    try{ sessionStorage.setItem('spend_charge_credit_default', e.target.value); }catch(err){}
  });

  document.getElementById('_spend_cancel').addEventListener('click', ()=> cleanup());
  document.getElementById('_spend_ok').addEventListener('click', ()=>{
    const okBtn = document.getElementById('_spend_ok');
    if (okBtn.disabled) return;
    okBtn.disabled = true;
    const spendName = document.getElementById('_spend_name').value.trim();
    const spendAmtValue = document.getElementById('_spend_amt').value.trim();
    const spendAmount = spendAmtValue === '' ? 0 : parseFloat(spendAmtValue);
    const chargeAccountId = document.getElementById('_spend_account').value.trim();
    
    clearInlineErrors(modal);
    if(!spendName){ showInlineError(document.getElementById('_spend_name'), 'Enter a name for the spend'); okBtn.disabled = false; return; }
    if(spendAmount <= 0){ showInlineError(document.getElementById('_spend_amt'), 'Enter a valid amount greater than 0'); okBtn.disabled = false; return; }

    // record spent on the item
    addSpending(section, itemId, spendName, spendAmount);

    // If account selected, update the account balance
    if(chargeAccountId){
      const account = (state.accounts || []).find(a=>a.id===chargeAccountId);
      if(account){
        if(account.isPositive){
          // Asset: subtract spending from account (reduces available funds)
          account.amount = Number(account.amount||0) - spendAmount;
        } else {
          // Liability: add spending to account (increases debt)
          account.amount = Number(account.amount||0) + spendAmount;
        }
        saveLocal();
      }
    }

    render();
    autosaveToGist();
    cleanup();
    if (onSaved) onSaved();
  });
}

function updateItemAmountAndResetSpent(section, id, newAmount){
  if(section === 'accounts'){
    const item = state.accounts.find(a=>a.id===id);
    if(item){
      item.amount = newAmount;
      recordAction({ type: 'edit amount', name: item.name, section: 'accounts', date: new Date().toISOString() });
    }
  } else {
    const item = state.items[section].find(i=>i.id===id);
    if(item){
      item.amount = newAmount;
      item.spent = []; // Reset spent history
      recordAction({ type: 'edit amount', name: item.name, section, date: new Date().toISOString() });
    }
  }
  saveLocal(); render();
  autosaveToGist();
}

// Show a modal/form for editing an item's amount
function showEditAmountForm(section, itemId, currentAmount) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');

  const title = `Edit Amount for ${getSectionLabel(section)}`;

  modal.innerHTML = `
    <h3>${title}</h3>
    <label>Current Amount<br><input id="_edit_amount" type="number" step="0.01" inputmode="decimal" placeholder="0.00" value="${Number(currentAmount).toFixed(2)}"></label>
    <div class="actions">
      <button id="_edit_amount_cancel">Cancel</button>
      <button id="_edit_amount_ok">Save</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  setTimeout(() => document.getElementById('_edit_amount').focus(), 20);

  function cleanup() {
    closeOverlay(overlay);
  }

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('_edit_amount_ok').click(); }
    if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
  });
  trapFocus(modal);

  // Select all on focus for amount field
  document.getElementById('_edit_amount').addEventListener('focus', (e) => e.target.select());

  document.getElementById('_edit_amount_cancel').addEventListener('click', () => cleanup());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });

  document.getElementById('_edit_amount_ok').addEventListener('click', () => {
    clearInlineErrors(modal);
    const amountValue = document.getElementById('_edit_amount').value.trim();
    const newAmount = amountValue === '' ? 0 : parseFloat(amountValue);

    if (newAmount < 0) {
      showInlineError(document.getElementById('_edit_amount'), 'Amount cannot be negative');
      return;
    }

    takeUndoSnapshot('Amount changed');
    updateItemAmountAndResetSpent(section, itemId, newAmount);
    cleanup();
    showUndoToast();
    scheduleUndoClear();
  });
}
function showItemForm(section, itemId = null, onSaved = null, okLabel = null, onCancel = null) {
  const isEdit = itemId !== null;
  let item;

  if (isEdit) {
    if (section === 'accounts') {
      item = state.accounts.find(a => a.id === itemId);
    } else {
      item = state.items[section].find(i => i.id === itemId);
    }
    if (!item) return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');

  const title = isEdit ? `Edit ${getSectionLabel(section)}` : `Add ${getSectionLabel(section)}`;

  let dueControlHtml = '';
  if (section === 'accounts') {
    const isChecked = isEdit ? item.isPositive : true;
    dueControlHtml = `<label><input id="_item_due" type="checkbox" ${isChecked ? 'checked' : ''}> Asset (unchecked=debt)</label>`;
  } else {
    const dueDate = isEdit && item && item.due ? item.due.date || '' : '';
    const recurring = isEdit && item && item.due ? !!item.due.recurring : false;
    dueControlHtml = `
      <label>Due Date<br><input id="_item_due" type="date" value="${dueDate}"></label>
      <label class="toggle-label"><input type="checkbox" id="_item_recurring" ${recurring ? 'checked' : ''}> Recurring (same day each month)</label>
    `;
  }

  let historyHtml = '';
  if (isEdit && section !== 'accounts' && item.spent && item.spent.length > 0) {
    historyHtml = '<h4>Spend History</h4><ul class="spend-history-list">';
    for (let index = item.spent.length - 1; index >= 0; index--) {
      const spend = item.spent[index];
      historyHtml += `
        <li class="spend-history-item">
          <span class="spend-info">${escapeHtml(spend.name)} - $${Number(spend.amount).toFixed(2)} on ${new Date(spend.date).toLocaleDateString()}</span>
          <button type="button" class="delete-spend-btn" data-index="${index}" title="Delete">✕</button>
        </li>`;
    }
    historyHtml += '</ul>';
  }

  // Get current amount for editing
  let currentAmountValue = '';
  if (isEdit && item) {
    if (section === 'accounts') {
      currentAmountValue = Number(item.amount).toFixed(2);
    } else {
      const totalSpent = (item.spent || []).reduce((a, b) => a + Number(b.amount || 0), 0);
      const remaining = Number(item.amount) - totalSpent;
      currentAmountValue = remaining.toFixed(2);
    }
  }

  modal.innerHTML = `
    <h3>${title}</h3>
    <label>Name<br><input id="_item_name" type="text" placeholder="Name" maxlength="100" value="${isEdit && item ? escapeHtml(item.name) : ''}"></label>
    <label>Current Amount<br><input id="_item_amount" type="number" step="0.01" inputmode="decimal" placeholder="0.00" value="${currentAmountValue}"></label>
    ${section !== 'accounts' ? `<label>Needed Amount<br><input id="_item_needed_amount" type="number" step="0.01" inputmode="decimal" placeholder="0.00" value="${isEdit && item && item.neededAmount ? Number(item.neededAmount).toFixed(2) : ''}"></label>` : ''}
    ${dueControlHtml}
    ${historyHtml}
    <div class="actions">
      ${isEdit ? '<button id="_item_delete" class="delBtn">Delete</button>' : ''}
      <button id="_item_cancel">Cancel</button>
      ${isEdit && section !== 'accounts' ? '<button id="_item_spend" class="spendBtn">Spend</button>' : ''}
      <button id="_item_ok">${okLabel || (isEdit ? 'Save' : 'Add')}</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  setTimeout(() => document.getElementById('_item_name').focus(), 20);

  function cleanup(canceled) {
    closeOverlay(overlay);
    if (canceled && onCancel) onCancel();
  }

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('_item_ok').click(); }
    if (e.key === 'Escape') { e.preventDefault(); cleanup(true); }
  });
  trapFocus(modal);

  // Clear amount fields on focus for easier editing
  document.getElementById('_item_amount').addEventListener('focus', (e) => e.target.select());
  if (section !== 'accounts') {
    document.getElementById('_item_needed_amount').addEventListener('focus', (e) => e.target.select());
  }

  document.getElementById('_item_cancel').addEventListener('click', () => cleanup(true));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup(true);
  });

  if (isEdit) {
    const delBtn = document.getElementById('_item_delete');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (delBtn.disabled) return;
      delBtn.disabled = true;
      takeUndoSnapshot('Item deleted');
      await removeItem(section, itemId);
      cleanup();
      showUndoToast();
      scheduleUndoClear();
    });

    if (section !== 'accounts') {
      const spendBtn = document.getElementById('_item_spend');
      if (spendBtn) {
        spendBtn.addEventListener('click', async () => {
          overlay.remove(); // instant remove when transitioning to spend modal
          showSpendingForm(section, itemId);
        });
      }
    }

    // Handle delete spend item buttons
    document.querySelectorAll('.delete-spend-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const index = parseInt(btn.dataset.index);
        if (item.spent && item.spent[index]) {
          takeUndoSnapshot('Spend deleted');
          item.spent.splice(index, 1);
          saveLocal();
          render();
          await autosaveToGist();
          cleanup();
          showUndoToast();
          scheduleUndoClear();
        }
      });
    });
  }

  document.getElementById('_item_ok').addEventListener('click', async () => {
    const okBtn = document.getElementById('_item_ok');
    if (okBtn.disabled) return;
    okBtn.disabled = true;
    const name = document.getElementById('_item_name').value.trim();
    // Treat blank as 0 for number inputs
    const amountValue = document.getElementById('_item_amount').value.trim();
    const newAmount = amountValue === '' ? 0 : parseFloat(amountValue);
    const neededAmountValue = section !== 'accounts' ? document.getElementById('_item_needed_amount').value.trim() : '';
    const neededAmount = section !== 'accounts' ? (neededAmountValue === '' ? 0 : parseFloat(neededAmountValue)) : undefined;

    clearInlineErrors(modal);
    if (!name) {
      showInlineError(document.getElementById('_item_name'), 'Enter a name');
      okBtn.disabled = false;
      return;
    }

    let due;
    if (section === 'accounts') {
      due = document.getElementById('_item_due').checked;
    } else {
      const dateVal = document.getElementById('_item_due').value;
      if (!dateVal) {
        showInlineError(document.getElementById('_item_due'), 'Enter a due date');
        okBtn.disabled = false;
        return;
      }
      due = { date: dateVal, recurring: document.getElementById('_item_recurring').checked };
    }

    if (isEdit) {
      // Check if amount changed for non-account items
      if (section !== 'accounts') {
        const oldRemaining = Number(item.amount) - (item.spent || []).reduce((a, b) => a + Number(b.amount || 0), 0);
        if (Math.abs(newAmount - oldRemaining) > 0.001) {
          const hasSpending = item.spent && item.spent.length > 0;
          if (hasSpending) {
            okBtn.disabled = false;
            const confirmed = await showConfirmDialog('Changing the amount will reset all spending history for this item. Continue?');
            okBtn.disabled = true;
            if (!confirmed) {
              okBtn.disabled = false;
              return;
            }
          }
          // Amount changed - update with new amount and reset spent
          updateItemAmountAndResetSpent(section, itemId, newAmount);
        }
        // Update other fields
        updateItem(section, itemId, { name, amount: item.amount, due, neededAmount });
      } else {
        updateItem(section, itemId, { name, amount: newAmount, due });
      }
    } else {
      const finalNeededAmount = neededAmount !== undefined && !isNaN(neededAmount) ? neededAmount : newAmount;
      addItem({ name, amount: newAmount, neededAmount: finalNeededAmount, due, section, enableSpending: section !== 'accounts' ? true : undefined });
    }

    if (onSaved) {
      overlay.remove();
      onSaved();
    } else {
      cleanup();
    }
  });
}

// ============ PAYCHECK AUTOFILL ============


function checksUntilDate(dueDate, freq, startDateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const targetDate = new Date(dueDate);
  targetDate.setHours(0, 0, 0, 0);

  if (targetDate <= today) return 1;

  if (!startDateStr) {
    const freqDays = { weekly: 7, biweekly: 14, monthly: 30.44 }[freq] || 14;
    return Math.max(1, Math.ceil((targetDate - today) / (freqDays * 24 * 60 * 60 * 1000)));
  }

  let startDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) {
    const [y, m, d] = startDateStr.split('-').map(Number);
    startDate = new Date(y, m - 1, d);
  } else {
    startDate = new Date(startDateStr);
  }
  startDate.setHours(0, 0, 0, 0);

  const freqDays = { weekly: 7, biweekly: 14, monthly: 30.44 }[freq] || 14;
  const freqMs = freqDays * 24 * 60 * 60 * 1000;

  // Find next check date (including today if it is a payday)
  let nextCheck = new Date(startDate.getTime());
  while (nextCheck < today) {
    nextCheck = new Date(nextCheck.getTime() + freqMs);
  }

  // Count checks from today until targetDate
  let checkCount = 0;
  let currentCheck = new Date(nextCheck.getTime());
  while (currentCheck <= targetDate) {
    checkCount++;
    currentCheck = new Date(currentCheck.getTime() + freqMs);
  }

  return Math.max(1, checkCount);
}

function getItemRemaining(item) {
  const spent = (item.spent || []).reduce((a, b) => a + Number(b.amount || 0), 0);
  return Number(item.amount || 0) - spent;
}

function getAutoFillItems() {
  const eligible = [];

  (state.items.budget || []).forEach(item => {
    const remaining = getItemRemaining(item);
    const needed = Number(item.neededAmount || item.amount || 0);
    const gap = needed - remaining;
    if (gap <= 0.005) return;

    let dueDate = null;
    if (item.due && item.due.date) {
      if (item.due.recurring) {
        const dayOfMonth = getDueDayOfMonth(item.due.date);
        if (Number.isNaN(dayOfMonth)) return;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let next = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);
        if (next < today || next.getDate() !== dayOfMonth) {
          next = new Date(today.getFullYear(), today.getMonth() + 1, dayOfMonth);
        }
        dueDate = next;
      } else {
        dueDate = new Date(item.due.date + 'T00:00:00');
      }
    }

    eligible.push({ item, section: 'budget', gap, dueDate });
  });

  return eligible;
}


function showAutofillModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');

  const storedFreq = localStorage.getItem(AUTOFILL_FREQ_KEY) || 'biweekly';
  const storedStartDate = localStorage.getItem(AUTOFILL_START_DATE_KEY) || '';

  modal.innerHTML = `
    <h3>Auto Fill</h3>
    <div id="_af_items_container"></div>
    <div class="autofill-freq-row">
      <label class="autofill-freq-label" for="_af_frequency">Pay Frequency</label>
      <select id="_af_frequency">
        <option value="weekly" ${storedFreq === 'weekly' ? 'selected' : ''}>Every Week</option>
        <option value="biweekly" ${storedFreq === 'biweekly' ? 'selected' : ''}>Every Two Weeks</option>
        <option value="monthly" ${storedFreq === 'monthly' ? 'selected' : ''}>Every Month</option>
      </select>
    </div>
    <div class="autofill-freq-row">
      <label class="autofill-freq-label" for="_af_start_date">Start Date</label>
      <input type="date" id="_af_start_date" value="${storedStartDate}">
    </div>
    <div class="actions">
      <button id="_af_cancel">Cancel</button>
      <button id="_af_fill">Fill Items</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function buildItemRow(item, gap, metaStr, checked, affordable = true) {
    const safeGap = gap.toFixed(2);
    const amountClass = affordable ? 'autofill-item-amount' : 'autofill-item-amount autofill-item-amount--unaffordable';
    return `
      <label class="autofill-item">
        <input type="checkbox" class="autofill-cb" data-id="${item.id}" data-gap="${safeGap}" ${checked ? 'checked' : ''}>
        <span class="autofill-rec-name">${escapeHtml(item.name)}</span>
        <span class="autofill-rec-meta">${escapeHtml(metaStr)}</span>
        <span class="${amountClass}">+$${safeGap}</span>
      </label>`;
  }

  function updateFillBtn() {
    const fillBtn = document.getElementById('_af_fill');
    if (!fillBtn) return;
    fillBtn.disabled = modal.querySelectorAll('.autofill-cb:checked').length === 0;
  }

  function updateTotal() {
    let total = 0;
    modal.querySelectorAll('.autofill-cb:checked').forEach(cb => {
      total += parseFloat(cb.dataset.gap) || 0;
    });
    const el = modal.querySelector('.autofill-total-amount');
    if (el) el.textContent = '$' + total.toFixed(2);
    const rem = document.getElementById('_af_remaining');
    if (rem) rem.textContent = '$' + (lastAvailableAmount - total).toFixed(2);
    updateFillBtn();
  }

  function renderItems() {
    const freq = document.getElementById('_af_frequency').value;
    const startDate = document.getElementById('_af_start_date').value;
    localStorage.setItem(AUTOFILL_FREQ_KEY, freq);
    localStorage.setItem(AUTOFILL_START_DATE_KEY, startDate);
    state.paySchedule = state.paySchedule || {};
    state.paySchedule.frequency = freq;
    state.paySchedule.startDate = startDate;
    saveLocal();
    const container = document.getElementById('_af_items_container');
    const eligible = getAutoFillItems();

    if (eligible.length === 0) {
      container.innerHTML = '<p class="autofill-hint">All items are fully funded.</p>';
      updateFillBtn();
      return;
    }

    // Compute per-check amount: items with due dates divide gap by checks until due
    const withPerCheck = eligible.map(e => {
      let perCheckGap;
      if (e.dueDate) {
        const checks = checksUntilDate(e.dueDate, freq, startDate);
        perCheckGap = e.gap / checks;
      } else {
        perCheckGap = e.gap;
      }
      return { ...e, perCheckGap };
    });

    const dueSortKey = e => {
      return e.dueDate ? e.dueDate.getTime() : 0;
    };
    let available = lastAvailableAmount;
    const affordMap = new Map();
    [...withPerCheck].sort((a, b) => dueSortKey(a) - dueSortKey(b)).forEach(e => {
      const canAfford = available >= e.perCheckGap - 0.005;
      if (canAfford) available -= e.perCheckGap;
      affordMap.set(e.item.id, canAfford);
    });

    let html = `<div class="autofill-header">Items to Fund</div><div class="autofill-list">`;
    withPerCheck.forEach(({ item, perCheckGap, dueDate }) => {
      let meta = '';
      if (dueDate) {
        const checks = checksUntilDate(dueDate, freq, startDate);
        const dueFmt = dueDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
        meta = `${dueFmt} · ${checks} check${checks !== 1 ? 's' : ''}`;
      }
      const affordable = affordMap.get(item.id) !== false;
      html += buildItemRow(item, perCheckGap, meta, affordable, affordable);
    });
    html += `</div>`;

    const affordableTotal = withPerCheck.reduce((a, e) => a + (affordMap.get(e.item.id) !== false ? e.perCheckGap : 0), 0);
    const remainingAfter = lastAvailableAmount - affordableTotal;
    html += `
      <div class="autofill-total">
        <span>Total to allocate</span>
        <span class="autofill-total-amount">$${affordableTotal.toFixed(2)}</span>
      </div>
      <div class="autofill-remaining">
        <span>Available after</span>
        <span id="_af_remaining">$${remainingAfter.toFixed(2)}</span>
      </div>`;

    container.innerHTML = html;

    modal.querySelectorAll('.autofill-cb').forEach(cb => {
      cb.addEventListener('change', updateTotal);
    });

    updateFillBtn();
  }

  renderItems();
  document.getElementById('_af_frequency').addEventListener('change', renderItems);
  document.getElementById('_af_start_date').addEventListener('change', renderItems);

  function cleanup() {
    closeOverlay(overlay);
  }
  document.getElementById('_af_cancel').addEventListener('click', cleanup);
  overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(); });

  document.getElementById('_af_fill').addEventListener('click', async (e) => {
    const btn = e.target;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Filling...';

    modal.querySelectorAll('.autofill-cb:checked').forEach(cb => {
      const id = cb.dataset.id;
      const gap = parseFloat(cb.dataset.gap) || 0;
      if (gap <= 0) return;
      const item = (state.items.budget || []).find(i => i.id === id);
      if (item) {
        item.amount = (Number(item.amount) || 0) + gap;
        recordAction({ type: 'autofill', name: item.name, amount: gap.toFixed(2), date: new Date().toISOString() });
      }
    });

    saveLocal();
    render();
    
    if (typeof setStatus === 'function') setStatus('Allocating funds...');
    const saved = await autosaveToGist();
    if (typeof setStatus === 'function' && saved) setStatus('Funds allocated and saved');
    
    cleanup();
  });
}

// Auto-refresh when app becomes visible (e.g., returning from background)
function setupAutoRefresh() {
  let lastRefreshTime = 0;
  const MIN_REFRESH_INTERVAL = 5000; // Don't refresh more than once per 5 seconds

  async function autoRefreshFromGist() {
    // Don't refresh while a save or load is in progress
    if (isSavingToGist || isLoadingFromGist) return;
    
    const now = Date.now();
    if (now - lastRefreshTime < MIN_REFRESH_INTERVAL) return;
    
    const gistId = localStorage.getItem(GIST_ID_KEY);
    const token = localStorage.getItem(GIST_TOKEN_KEY);
    if (!gistId || !token) return;
    
    lastRefreshTime = now;
    await loadFromGist(true);
  }

  // Refresh when page becomes visible (returning from background/tab switch)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      autoRefreshFromGist();
    }
  });

  // Also refresh on window focus (for PWAs that might not trigger visibilitychange)
  window.addEventListener('focus', () => {
    autoRefreshFromGist();
  });

  // For iOS PWAs: pageshow event fires when returning to a cached page
  window.addEventListener('pageshow', () => {
    autoRefreshFromGist();
  });
}

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
}

// Lock body scroll when any modal overlay is visible
function setupBodyScrollLock() {
  let pending = false;
  function check() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const modals = document.querySelectorAll('.modal-overlay');
      let open = false;
      for (const m of modals) {
        if (m.style.display !== 'none') { open = true; break; }
      }
      document.body.classList.toggle('modal-open', open);
    });
  }
  const obs = new MutationObserver(check);
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
}

// Init
(async function init() {
  setupUI();
  setupAutoRefresh();
  setupInstallBanner();
  setupBodyScrollLock();
  if (localStorage.getItem(GIST_ID_KEY) && localStorage.getItem(GIST_TOKEN_KEY)) {
    await loadFromGist(true);
  }
})();

// PWA Install Detection
function isPWA() {
  // Check if running as standalone PWA
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
  // iOS Safari standalone mode
  if (window.navigator.standalone === true) return true;
  // Android TWA
  if (document.referrer.includes('android-app://')) return true;
  return false;
}

function setupInstallBanner() {
  const modal = $('install-modal');
  const modalCloseBtn = $('install-modal-close');
  const installSection = $('install-section');
  const showInstallBtn = $('show-install-btn');
  const gistModal = $('gist-modal');

  if (!modal) return;

  const runningAsPWA = isPWA();

  // Hide install section in settings if already running as PWA
  if (installSection) {
    installSection.style.display = runningAsPWA ? 'none' : 'flex';
  }

  // Show install instructions from settings
  if (showInstallBtn) {
    showInstallBtn.addEventListener('click', () => {
      // Close settings modal first
      if (gistModal) {
        gistModal.style.display = 'none';
      }
      // Show install instructions modal
      modal.style.display = 'flex';
    });
  }

  // Close modal
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  // Close modal on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });

  // Listen for display mode change (user installed the app)
  window.matchMedia('(display-mode: standalone)').addEventListener('change', (e) => {
    if (e.matches) {
      if (installSection) {
        installSection.style.display = 'none';
      }
    }
  });
}
