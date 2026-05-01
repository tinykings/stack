// Simple Budget app with Gist persistence
const STORAGE_KEY = 'budget_data_v1';
const GIST_ID_KEY = 'budget_gist_id';
const GIST_TOKEN_KEY = 'budget_gist_token';
const AUTOFILL_FREQ_KEY = 'autofill_frequency';
const AUTOFILL_START_DATE_KEY = 'autofill_start_date';

let state = {
  balances: { checking: 0, savings: 0, credit: 0 },
  accounts: [], // [{id, name, amount, isPositive}]
  items: { planning: [] },
  actionHistory: [] // Last 10 actions: [{type, name, section, amount?, date}]
};
let lastAvailableAmount = 0; // New global variable
let isSavingToGist = false; // Flag to prevent auto-refresh during save
let modalLockCount = 0;
let modalScrollY = 0;
let inlineRowState = null;
let pendingInlineRowFocus = null;
let availableToastHideTimer = 0;
let autofillSelection = new Set();
let autofillSelectionInitialized = false;
let hasRenderedAvailableOnce = false;

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

function recordAction(action){
  if (!Array.isArray(state.actionHistory)) state.actionHistory = [];
  state.actionHistory.unshift(action);
  if (state.actionHistory.length > 10) state.actionHistory.length = 10;
}

function clearOnFirstFocus(input){
  let cleared = false;
  input.addEventListener('focus', () => {
    if (!cleared && input.value !== '') {
      input.value = '';
      cleared = true;
    }
  });
}

function clearAmountOnFocus(target){
  if (!target || target.tagName !== 'INPUT') return;
  if (!target.matches('input[data-clear-on-focus]')) return;
  if (target.value === '') return;
  target.value = '';
}

function shouldUseBottomSheet(){
  return window.matchMedia('(max-width: 599px)').matches;
}

function openInlineRow(section, key){
  inlineRowState = { section, key };
  pendingInlineRowFocus = { section, key };
  if (section === 'planning' && key === 'autofill') {
    autofillSelectionInitialized = false;
    autofillSelection = new Set();
  }
  render();
}

function closeInlineRow(){
  inlineRowState = null;
  pendingInlineRowFocus = null;
  autofillSelectionInitialized = false;
  autofillSelection = new Set();
  render();
}

function isInlineRowOpen(section, key){
  return !!inlineRowState && inlineRowState.section === section && inlineRowState.key === key;
}

function ensureAutofillSelection(){
  if (autofillSelectionInitialized) return;

  const { frequency: storedFreq, startDate: storedStartDate } = getAutofillPreferences();
  const eligible = getAutoFillItems();
  const withPerCheck = eligible.map(e => {
    const checks = e.dueDate ? checksUntilDate(e.dueDate, storedFreq, storedStartDate) : 1;
    return { ...e, perCheckGap: e.gap / checks };
  });

  let available = lastAvailableAmount;
  const selected = new Set();
  [...withPerCheck].sort((a, b) => (a.dueDate?.getTime() || 0) - (b.dueDate?.getTime() || 0)).forEach(e => {
    const canAfford = available >= e.perCheckGap - 0.005;
    if (canAfford) {
      selected.add(e.item.id);
      available -= e.perCheckGap;
    }
  });

  autofillSelection = selected;
  autofillSelectionInitialized = true;
}

function getAutofillPreferences(){
  const paySchedule = state.paySchedule && typeof state.paySchedule === 'object' ? state.paySchedule : null;
  const hasFrequency = paySchedule && Object.prototype.hasOwnProperty.call(paySchedule, 'frequency');
  const hasStartDate = paySchedule && Object.prototype.hasOwnProperty.call(paySchedule, 'startDate');
  return {
    frequency: hasFrequency ? (paySchedule.frequency || 'biweekly') : (localStorage.getItem(AUTOFILL_FREQ_KEY) || 'biweekly'),
    startDate: hasStartDate ? (paySchedule.startDate || '') : (localStorage.getItem(AUTOFILL_START_DATE_KEY) || '')
  };
}

function saveAutofillPreferences(frequency, startDate){
  state.paySchedule = {
    ...(state.paySchedule && typeof state.paySchedule === 'object' ? state.paySchedule : {}),
    frequency: frequency || 'biweekly',
    startDate: startDate || ''
  };

  localStorage.setItem(AUTOFILL_FREQ_KEY, state.paySchedule.frequency);
  if (state.paySchedule.startDate) {
    localStorage.setItem(AUTOFILL_START_DATE_KEY, state.paySchedule.startDate);
  } else {
    localStorage.removeItem(AUTOFILL_START_DATE_KEY);
  }
  saveLocal();
}

function createModalShell(){
  lockBodyScroll();
  const overlay = document.createElement('div');
  overlay.className = shouldUseBottomSheet() ? 'modal-overlay sheet-overlay' : 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = shouldUseBottomSheet() ? 'modal sheet-modal' : 'modal';
  return { overlay, modal };
}

function createCenteredModalShell(){
  lockBodyScroll();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay center-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';
  return { overlay, modal };
}

function createSpendingModalShell(){
  lockBodyScroll();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay center-overlay spend-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal spend-modal';
  return { overlay, modal };
}

function lockBodyScroll(){
  if (modalLockCount === 0) {
    modalScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.classList.add('modal-open');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${modalScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }
  modalLockCount += 1;
}

function unlockBodyScroll(){
  if (modalLockCount === 0) return;
  modalLockCount -= 1;
  if (modalLockCount > 0) return;

  document.body.classList.remove('modal-open');
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  window.scrollTo(0, modalScrollY);
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

function normalizeState(input){
  const raw = (input && typeof input === 'object') ? input : {};
  const normalized = { ...raw };

  normalized.balances = {
    checking: 0,
    savings: 0,
    credit: 0,
    ...(raw.balances && typeof raw.balances === 'object' ? raw.balances : {})
  };

  normalized.paySchedule = raw.paySchedule && typeof raw.paySchedule === 'object'
    ? {
        frequency: raw.paySchedule.frequency || 'biweekly',
        startDate: raw.paySchedule.startDate || ''
      }
    : null;

  normalized.items = { planning: [] };
  normalized.actionHistory = Array.isArray(raw.actionHistory) ? raw.actionHistory.slice() : [];
  const normalizeDue = (due) => {
    if (!due) return due;
    if (typeof due === 'string') {
      return /^\d{4}-\d{2}-\d{2}$/.test(due) ? { type: 'date', value: due } : due;
    }
    if (typeof due === 'object') {
      return { ...due };
    }
    return due;
  };

  const normalizeSpend = (spend) => {
    if (!spend || typeof spend !== 'object') return null;
    return {
      ...spend,
      amount: Number(spend.amount) || 0
    };
  };

  const normalizeAccount = (account) => {
    if (!account || typeof account !== 'object') return null;
    return {
      ...account,
      amount: Number(account.amount) || 0,
      isPositive: account.isPositive !== undefined ? !!account.isPositive : account.due !== undefined ? !!account.due : true,
      pinned: !!account.pinned
    };
  };

  const normalizePlanningItem = (item, section='planning') => {
    if (!item || typeof item !== 'object') return null;
    const { due, ...rest } = item;
    const amount = Number(item.amount) || 0;
    const spent = Array.isArray(item.spent) ? item.spent.map(normalizeSpend).filter(Boolean) : [];
    let schedule;

    if (item.schedule && typeof item.schedule === 'object') {
      schedule = {
        recurring: !!item.schedule.recurring,
        date: item.schedule.recurring ? null : (item.schedule.date || null),
        dayOfMonth: item.schedule.recurring ? Math.min(31, Math.max(1, Number(item.schedule.dayOfMonth) || 1)) : null
      };
    } else if (section === 'budget') {
      schedule = { recurring: true, date: null, dayOfMonth: 1 };
    } else if (section === 'bills') {
      schedule = { recurring: true, date: null, dayOfMonth: Math.min(31, Math.max(1, Number(item.due?.value) || 1)) };
    } else if (section === 'goals') {
      const dueValue = item.due?.value || (typeof item.due === 'string' ? item.due : null);
      schedule = { recurring: false, date: dueValue || null, dayOfMonth: null };
    } else {
      const legacyDue = normalizeDue(item.due);
      if (legacyDue?.type === 'day') {
        schedule = { recurring: true, date: null, dayOfMonth: Math.min(31, Math.max(1, Number(legacyDue.value) || 1)) };
      } else if (legacyDue?.type === 'date') {
        schedule = { recurring: false, date: legacyDue.value || null, dayOfMonth: null };
      } else {
        schedule = { recurring: true, date: null, dayOfMonth: 1 };
      }
    }

    return {
      ...rest,
      amount,
      neededAmount: item.neededAmount !== undefined ? Number(item.neededAmount) || 0 : amount,
      spent,
      enableSpending: item.enableSpending !== undefined ? !!item.enableSpending : false,
      pinned: !!item.pinned,
      schedule
    };
  };

  const accountsSource = Array.isArray(raw.accounts)
    ? raw.accounts
    : Array.isArray(normalized.items.accounts)
      ? normalized.items.accounts
      : [];

  normalized.accounts = accountsSource.map(normalizeAccount).filter(Boolean);

  const planningSource = [];
  const items = raw.items && typeof raw.items === 'object' ? raw.items : {};
  if (Array.isArray(items.planning)) {
    planningSource.push(...items.planning.map(item => normalizePlanningItem(item, 'planning')).filter(Boolean));
  } else {
    ['budget', 'bills', 'goals'].forEach(section => {
      const source = Array.isArray(items[section]) ? items[section] : [];
      planningSource.push(...source.map(item => normalizePlanningItem(item, section)).filter(Boolean));
    });
  }
  normalized.items.planning = planningSource;

  return normalized;
}

// Load/save local
function loadLocal(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(raw){
    try{ state = normalizeState(JSON.parse(raw)); }
    catch(e){ console.warn('Invalid local data', e); }
  }
  // Sync paySchedule from state to localStorage
  if (state.paySchedule) {
    if (state.paySchedule.frequency) {
      localStorage.setItem(AUTOFILL_FREQ_KEY, state.paySchedule.frequency);
    } else {
      localStorage.removeItem(AUTOFILL_FREQ_KEY);
    }
    if (state.paySchedule.startDate) {
      localStorage.setItem(AUTOFILL_START_DATE_KEY, state.paySchedule.startDate);
    } else {
      localStorage.removeItem(AUTOFILL_START_DATE_KEY);
    }
  }
  if (!Array.isArray(state.actionHistory)) {
    state.actionHistory = [];
  }
  const gid = localStorage.getItem(GIST_ID_KEY);
  const tok = localStorage.getItem(GIST_TOKEN_KEY);
  const gidEl = $('gistId');
  const tokEl = $('gistToken');
  if(gid && gidEl) gidEl.value = gid;
  if(tok && tokEl) tokEl.value = tok;
  // Initialize lastAvailableAmount after loading local data
  const availableEl = $('available');
  if (availableEl && availableEl.textContent) {
    lastAvailableAmount = parseFloat(availableEl.textContent.replace(/[^0-9.-]+/g,"")) || 0;
  }
}
function saveLocal(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Render

function formatCurrency(value){
  return '$' + Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrencyWhole(value){
  return '$' + Math.round(Number(value || 0)).toLocaleString('en-US');
}

function getVisibleSections(){
  return ['accounts', 'planning'];
}

function sortSectionItems(section, items){
  const copy = (items || []).slice();
  copy.sort((a, b) => {
    if (section === 'planning' && !!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if(section === 'accounts') return (a.name || '').localeCompare(b.name || '');
    if(section === 'planning'){
      return getPlanningSortTime(a) - getPlanningSortTime(b);
    }
    return 0;
  });
  return copy;
}

function getSectionItems(section){
  return section === 'accounts' ? sortSectionItems(section, state.accounts || []) : sortSectionItems(section, state.items.planning || []);
}

function getNextScheduleDate(item){
  if (!item || !item.schedule) return null;
  if (item.schedule.recurring) {
    return getNextBillDueDate(Number(item.schedule.dayOfMonth) || 1);
  }
  if (item.schedule.date) {
    const [y, m, d] = item.schedule.date.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return null;
}

function getPlanningSortTime(item){
  const nextDate = getNextScheduleDate(item);
  if (!nextDate) return Number.MAX_SAFE_INTEGER;
  nextDate.setHours(0, 0, 0, 0);
  return nextDate.getTime();
}

function ordinal(n){
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getDueDisplay(item){
  const schedule = item?.schedule;
  if(!schedule) return '-';
  if (schedule.recurring) {
    return `${ordinal(Number(schedule.dayOfMonth) || 1)} monthly`;
  }
  if (schedule.date) {
    try { return new Date(schedule.date).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
    catch(err){ return schedule.date; }
  }
  return '-';
}

function renderAccountEditor(item, isDraft=false){
  return `
    <form class="inline-editor inline-editor--account" data-inline-submit="account" data-section="accounts" data-item-id="${item?.id || ''}" data-draft="${isDraft ? '1' : '0'}">
      <label>Name<br><input name="name" type="text" placeholder="Name" value="${escapeHtml(item?.name || '')}"></label>
      <label>Amount<br><input name="amount" type="number" data-clear-on-focus="1" step="0.01" inputmode="decimal" placeholder="0.00" value="${isDraft ? '' : Number(item?.amount || 0).toFixed(2)}"></label>
      <label class="toggle-label"><input name="isPositive" type="checkbox" ${isDraft || item?.isPositive ? 'checked' : ''}> Asset (unchecked=debt)</label>
      <div class="actions">
        ${isDraft ? '' : `<button type="button" class="delBtn account-delete-btn" data-inline-action="delete-account" aria-label="Delete account" title="Delete account">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm1 11h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2z"></path>
          </svg>
        </button>`}
        <button type="button" data-inline-action="cancel">Cancel</button>
        <button type="submit">${isDraft ? 'Add' : 'Save'}</button>
      </div>
    </form>
  `;
}

function renderPlanningEditor(item, isDraft=false){
  const isPinned = !isDraft && !!item?.pinned;
  const currentAmountValue = isDraft ? '' : (() => {
    const totalSpent = (item.spent || []).reduce((a, b) => a + Number(b.amount || 0), 0);
    return (Number(item.amount) - totalSpent).toFixed(2);
  })();
  const recurring = isDraft || !item ? true : !!item.schedule?.recurring;
  const dayValue = isDraft || !item ? 1 : (item.schedule?.recurring ? (item.schedule.dayOfMonth || 1) : 1);
  const dateValue = isDraft || !item || item.schedule?.recurring ? '' : (item.schedule?.date || '');
  const neededValue = isDraft ? '' : Number(item?.neededAmount !== undefined ? item.neededAmount : item?.amount || 0).toFixed(2);
  const spendingEnabled = isDraft ? false : !!item?.enableSpending;
  const spendAvailable = Number(currentAmountValue) > 0;
  const spendingToggleId = `enableSpending_${item?.id || '__new__'}`;
  const history = !isDraft && item?.spent && item.spent.length > 0 ? (() => {
    let html = '<h4>Spend History</h4><ul class="spend-history-list">';
    for (let index = item.spent.length - 1; index >= 0; index--) {
      const spend = item.spent[index];
      html += `
        <li class="spend-history-item">
          <span class="spend-info">${escapeHtml(spend.name)} - $${Number(spend.amount).toFixed(2)} on ${new Date(spend.date).toLocaleDateString()}</span>
          <button type="button" class="delete-spend-btn" data-index="${index}" title="Delete">✕</button>
        </li>`;
    }
    html += '</ul>';
    return html;
  })() : '';
  const bottomActions = isDraft ? `
      <div class="actions actions--bottom">
        <button type="button" data-inline-action="cancel">Cancel</button>
        <button type="submit">Add</button>
      </div>` : `
      <div class="actions actions--bottom">
        <button type="button" class="delBtn planning-delete-btn" data-inline-action="delete-planning" aria-label="Delete item" title="Delete item">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm1 11h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2z"></path>
          </svg>
        </button>
        <button type="button" class="pin-text-btn" data-inline-action="pin">${isPinned ? 'Unpin' : 'Pin'}</button>
        <button type="button" data-inline-action="cancel">Cancel</button>
        <button type="submit">Save</button>
      </div>`;

  return `
    <form class="inline-editor inline-editor--planning" data-inline-submit="planning" data-section="planning" data-item-id="${item?.id || ''}" data-draft="${isDraft ? '1' : '0'}">
      <label>Name<br><input name="name" type="text" placeholder="Name" value="${escapeHtml(item?.name || '')}"></label>
      <label>Current Amount<br><input name="amount" type="number" data-clear-on-focus="1" step="0.01" inputmode="decimal" placeholder="0.00" value="${currentAmountValue}"></label>
      <div class="needed-spending-row">
        <label>Needed Amount<br><input name="neededAmount" type="number" data-clear-on-focus="1" step="0.01" inputmode="decimal" placeholder="0.00" value="${neededValue}"></label>
        <label class="toggle-label spending-toggle" for="${spendingToggleId}">
          <input id="${spendingToggleId}" name="enableSpending" type="checkbox" class="spending-toggle-input" ${spendingEnabled ? 'checked' : ''}>
          <span>Spending</span>
        </label>
      </div>
      <div class="spending-action-row" data-spend-available="${spendAvailable ? '1' : '0'}" data-spending-enabled="${spendingEnabled ? '1' : '0'}">
        <button type="button" class="spendBtn planning-spend-btn" data-inline-action="spend" ${spendAvailable ? '' : 'disabled aria-hidden="true" tabindex="-1"' }>Spend</button>
      </div>
      <div class="spend-inline-panel" hidden>
        <label>Spend Name<br><input name="spendName" type="text" placeholder="e.g. Groceries"></label>
        <label>Spend Amount<br><input name="spendAmount" type="number" data-clear-on-focus="1" step="0.01" inputmode="decimal" placeholder="0.00"></label>
        <div class="actions actions--spend">
          <button type="button" data-inline-action="spend-cancel">Cancel</button>
          <button type="button" data-inline-action="spend-submit">Add Spend</button>
        </div>
      </div>
      <label class="toggle-label"><input name="recurring" type="checkbox" ${recurring ? 'checked' : ''}>Recurring monthly</label>
      <label class="inline-toggle-target" data-toggle-wrap="day" style="${recurring ? '' : 'display:none;'}">Day of month<br><input name="day" type="number" min="1" max="31" inputmode="numeric" placeholder="1-31" value="${dayValue}"></label>
      <label class="inline-toggle-target" data-toggle-wrap="date" style="${recurring ? 'display:none;' : ''}">Target date<br><input name="date" type="date" value="${dateValue}"></label>
      ${history}
      ${bottomActions}
    </form>
  `;
}

function renderItemSummary(section, item){
  const open = isInlineRowOpen(section, item.id);

  if (section === 'accounts') {
    const amountClass = item.isPositive ? 'asset' : 'liability';
    const accountType = item.isPositive ? 'Asset' : 'Debt';
    return `
      <div class="item inline-row ${open ? 'is-open' : ''}" data-inline-section="accounts" data-inline-key="${item.id}">
        <button type="button" class="item-content item-clickable inline-row-toggle" data-inline-toggle="1" aria-expanded="${open ? 'true' : 'false'}">
          <div class="item-info">
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-amount ${amountClass}">${formatCurrency(item.amount)}</div>
          </div>
          <div class="item-meta-row"><span class="meta">${accountType}</span></div>
        </button>
        ${open ? renderAccountEditor(item) : ''}
      </div>
    `;
  }

  item.spent = item.spent || [];
  const totalSpent = item.spent.reduce((a, b) => a + Number(b.amount || 0), 0);
  const remaining = Number(item.amount) - totalSpent;
  const neededAmount = item.neededAmount !== undefined ? item.neededAmount : item.amount;
  const remainingPercent = Number(neededAmount) > 0 ? Math.max(0, Math.min(100, (remaining / Number(neededAmount)) * 100)) : 0;
  let progressClass = 'good';
  if (remainingPercent < 25) progressClass = 'danger';
  else if (remainingPercent < 50) progressClass = 'warning';
  const amountClass = remaining > 0 ? 'positive-amount' : remaining < 0 ? 'liability' : '';
  const mostRecent = item.spent.length > 0 ? item.spent[item.spent.length - 1] : null;
  const metaBits = [getDueDisplay(item), formatCurrency(neededAmount)];
  if (mostRecent) metaBits.push(`${mostRecent.name} (-${Number(mostRecent.amount).toFixed(2)})`);

  return `
    <div class="item inline-row ${open ? 'is-open' : ''} ${item.pinned ? 'is-pinned' : ''}" data-inline-section="planning" data-inline-key="${item.id}">
      <button type="button" class="item-content item-clickable inline-row-toggle ${item.pinned ? 'is-pinned' : ''}" data-inline-toggle="1" aria-expanded="${open ? 'true' : 'false'}">
        <div class="item-info">
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-amount ${amountClass}">${formatCurrency(Math.abs(remaining))}</div>
        </div>
        <div class="item-meta-row"><span class="meta">${escapeHtml(metaBits.join(' • '))}</span></div>
        ${Number(neededAmount) > 0 ? `<div class="item-progress"><div class="item-progress-bar ${progressClass}" style="width: ${remainingPercent}%"></div></div>` : ''}
      </button>
      ${open ? renderPlanningEditor(item) : ''}
    </div>
  `;
}

function renderAddRow(section){
  const open = isInlineRowOpen(section, '__new__');
  const title = section === 'accounts' ? 'Add Account' : 'Add Item';
  return `
    <div class="item inline-row inline-row--new ${open ? 'is-open' : ''}" data-inline-section="${section}" data-inline-key="__new__">
      <button type="button" class="item-content item-clickable inline-row-toggle" data-inline-toggle="1" aria-expanded="${open ? 'true' : 'false'}">
        <div class="item-info">
          <div class="item-name">${title}</div>
        </div>
      </button>
      ${open ? (section === 'accounts' ? renderAccountEditor({}, true) : renderPlanningEditor({}, true)) : ''}
    </div>
  `;
}

function renderLogRow(){
  const open = isInlineRowOpen('planning', 'log');
  const history = state.actionHistory || [];
  const latest = history.length ? formatActionText(history[0]) : 'No changes yet';
  let body = '';
  if (open) {
    const listHtml = history.length ? `<ul class="history-list">${history.map(action => `<li>${escapeHtml(formatActionText(action))}</li>`).join('')}</ul>` : '<div class="planning-empty">No changes yet.</div>';
    body = `
      <div class="inline-body-inline">
        ${listHtml}
        <div class="actions"><button type="button" data-inline-action="close">Close</button></div>
      </div>
    `;
  }
  return `
    <div class="item inline-row ${open ? 'is-open' : ''}" data-inline-section="planning" data-inline-key="log">
      <button type="button" class="item-content item-clickable inline-row-toggle" data-inline-toggle="1" aria-expanded="${open ? 'true' : 'false'}">
        <div class="item-info">
          <div class="item-name">Log</div>
        </div>
      </button>
      ${body}
    </div>
  `;
}

function renderAutofillRow(){
  const open = isInlineRowOpen('planning', 'autofill');
  const { frequency: storedFreq, startDate: storedStartDate } = getAutofillPreferences();
  const body = open ? (() => {
    if (!storedStartDate) {
      return '<div class="autofill-hint">Set autofill settings in Settings to use Auto Fill.</div><div class="actions"><button type="button" data-inline-action="close">Close</button></div>';
    }
    ensureAutofillSelection();
    const eligible = getAutoFillItems();
    if (eligible.length === 0) {
      return '<div class="planning-empty">All items are fully funded.</div>';
    }

    const withPerCheck = eligible.map(e => {
      const checks = e.dueDate ? checksUntilDate(e.dueDate, storedFreq, storedStartDate) : 1;
      const perCheckGap = e.gap / checks;
      return { ...e, perCheckGap };
    });

    let available = lastAvailableAmount;
    const affordMap = new Map();
    [...withPerCheck].sort((a, b) => (a.dueDate?.getTime() || 0) - (b.dueDate?.getTime() || 0)).forEach(e => {
      const canAfford = available >= e.perCheckGap - 0.005;
      if (canAfford) available -= e.perCheckGap;
      affordMap.set(e.item.id, canAfford);
    });

    let html = '<form class="autofill-inline-form" data-inline-submit="autofill">';
    html += '<div class="autofill-header">Items to Fund</div><div class="autofill-list">';
    withPerCheck.sort((a, b) => (a.dueDate?.getTime() || 0) - (b.dueDate?.getTime() || 0)).forEach(({ item, perCheckGap, dueDate }) => {
      const checks = dueDate ? checksUntilDate(dueDate, storedFreq, storedStartDate) : 1;
      const dueFmt = dueDate ? dueDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '-';
      const meta = `${dueFmt} · ${checks} check${checks !== 1 ? 's' : ''}`;
      const affordable = affordMap.get(item.id) !== false;
      const checked = autofillSelection.has(item.id);
      html += `
        <label class="autofill-item">
          <input type="checkbox" class="autofill-cb" data-id="${item.id}" data-gap="${perCheckGap.toFixed(2)}" ${checked ? 'checked' : ''} ${affordable ? '' : 'disabled'}>
          <span class="autofill-rec-name">${escapeHtml(item.name)}</span>
          <span class="autofill-rec-meta">${escapeHtml(meta)}</span>
          <span class="${affordable ? 'autofill-item-amount' : 'autofill-item-amount autofill-item-amount--unaffordable'}">+$${perCheckGap.toFixed(2)}</span>
        </label>`;
    });
    html += '</div>';

    let total = 0;
    withPerCheck.forEach(({ item, perCheckGap }) => {
      if (autofillSelection.has(item.id)) total += perCheckGap;
    });
    html += `
      <div class="autofill-total">
        <span>Total to allocate</span>
        <span class="autofill-total-amount">$${total.toFixed(2)}</span>
      </div>
      <div class="autofill-remaining">
        <span>Available after</span>
        <span id="_af_remaining">$${(lastAvailableAmount - total).toFixed(2)}</span>
      </div>
      <div class="actions">
        <button type="button" data-inline-action="close">Cancel</button>
        <button id="_af_fill" type="submit">Fill Items</button>
      </div>
    </form>`;
    return html;
  })() : '';

  return `
    <div class="item inline-row ${open ? 'is-open' : ''}" data-inline-section="planning" data-inline-key="autofill">
      <button type="button" class="item-content item-clickable inline-row-toggle" data-inline-toggle="1" aria-expanded="${open ? 'true' : 'false'}">
        <div class="item-info">
          <div class="item-name">Auto Fill</div>
        </div>
      </button>
      ${body}
    </div>
  `;
}

function renderSettingsRow(){
  const open = isInlineRowOpen('planning', 'settings');
  const { frequency, startDate } = getAutofillPreferences();
  const body = open ? `
    <div class="inline-body-inline">
      <div class="gist-controls inline-gist-controls">
        <input id="gistId" placeholder="Gist ID" value="${escapeHtml(localStorage.getItem(GIST_ID_KEY) || '')}">
        <input id="gistToken" placeholder="GitHub token (Gist scope)" type="password" value="${escapeHtml(localStorage.getItem(GIST_TOKEN_KEY) || '')}">
        <div class="gist-buttons">
          <button type="button" data-settings-action="save">Save to Gist</button>
          <button type="button" data-settings-action="load">Load from Gist</button>
        </div>
        <div class="gist-buttons">
          <button type="button" data-settings-action="export">Export Data</button>
          <button type="button" data-settings-action="import">Import Data</button>
          <input type="file" id="import-file" accept=".json" style="display:none">
        </div>
      </div>
      <div class="settings-section settings-autofill-section">
        <h4>Autofill Settings</h4>
        <div class="settings-autofill-grid">
          <label class="settings-autofill-field">Pay Frequency
            <select id="settings-autofill-frequency">
              <option value="weekly" ${frequency === 'weekly' ? 'selected' : ''}>Every Week</option>
              <option value="biweekly" ${frequency === 'biweekly' ? 'selected' : ''}>Every Two Weeks</option>
              <option value="monthly" ${frequency === 'monthly' ? 'selected' : ''}>Every Month</option>
            </select>
          </label>
          <label class="settings-autofill-field">Start Date
            <input id="settings-autofill-start-date" type="date" value="${escapeHtml(startDate)}">
          </label>
        </div>
        <small>Auto Fill uses these settings to estimate how much to allocate each pay period.</small>
      </div>
      <div id="status" class="status"></div>
      <div class="actions settings-actions">
        <button type="button" data-inline-action="cancel">Cancel</button>
        <button type="button" data-settings-action="save-autofill">Save</button>
      </div>
    </div>
  ` : '';

  const summary = `
    <button type="button" class="item-content item-clickable inline-row-toggle" data-inline-toggle="1" aria-expanded="${open ? 'true' : 'false'}">
      <div class="item-info">
        <div class="item-name">Settings</div>
      </div>
    </button>
  `;

  return `
    <div class="item inline-row ${open ? 'is-open' : ''}" data-inline-section="planning" data-inline-key="settings">
      ${summary}
      ${body}
    </div>
  `;
}

function saveAutofillSettingsFromDom(){
  const freqEl = $('settings-autofill-frequency');
  const startDateEl = $('settings-autofill-start-date');
  const frequency = freqEl ? freqEl.value : 'biweekly';
  const startDate = startDateEl ? startDateEl.value : '';
  saveAutofillPreferences(frequency, startDate);
  closeInlineRow();
  autosaveToGist();
}

function getItemMarkup(section, item){
  return renderItemSummary(section, item);
}

function getSectionTotal(section){
  if(section === 'accounts'){
    return (state.accounts || []).reduce((a, acc) => a + (acc.isPositive ? Number(acc.amount || 0) : -Number(acc.amount || 0)), 0);
  }
  return (state.items.planning || []).reduce((a, item) => {
    const remaining = Number(item.amount || 0) - (item.spent || []).reduce((sum, spend) => sum + Number(spend.amount || 0), 0);
    return a + (remaining > 0 ? remaining : 0);
  }, 0);
}

function renderAccountCards(){
  const accountsEl = $('account-cards');
  if (!accountsEl) return;

  const accounts = getSectionItems('accounts');

  accountsEl.innerHTML = `${accounts.map(account => renderItemSummary('accounts', account)).join('')}${renderAddRow('accounts')}`;
}

function syncLogoHints(){
  const accounts = getSectionItems('accounts');
  const planning = getSectionItems('planning');
  const emptyAccountsHint = $('empty-accounts-hint');
  const emptyPlanningHint = $('empty-planning-hint');
  if (emptyAccountsHint) emptyAccountsHint.hidden = accounts.length !== 0;
  if (emptyPlanningHint) emptyPlanningHint.hidden = !(accounts.length > 0 && planning.length === 0);
}

function renderSettingsAccounts(){
  const listEl = $('settings-accounts-list');
  if (!listEl) return;

  const accounts = getSectionItems('accounts');
  if (accounts.length === 0) {
    listEl.innerHTML = '<div class="settings-account-empty">No accounts yet.</div>';
    return;
  }

  listEl.innerHTML = accounts.map(account => `
    <div class="settings-account-row">
      <button type="button" class="settings-account-open" data-account-id="${account.id}">
        <span class="settings-account-name">${escapeHtml(account.name)}</span>
        <span class="settings-account-value ${account.isPositive ? 'asset' : 'liability'}">${formatCurrency(account.amount)}</span>
      </button>
      <button type="button" class="settings-account-remove" data-account-remove="${account.id}">Remove</button>
    </div>
  `).join('');
}

function renderPlanningList(totals){
  const listEl = $('planning-list');
  if (!listEl) return;
  const hasAccounts = (state.accounts || []).length > 0;
  const items = getSectionItems('planning');
  if (!hasAccounts && items.length === 0) {
    listEl.innerHTML = '';
    return;
  }

  if (hasAccounts && items.length === 0) {
    listEl.innerHTML = `${renderAddRow('planning')}${renderSettingsRow()}`;
    return;
  }

  const itemRows = items.length ? items.map(item => getItemMarkup('planning', item)).join('') : '<div class="planning-empty">No planning items yet.</div>';
  listEl.innerHTML = `${itemRows}${renderAddRow('planning')}${renderLogRow()}${renderAutofillRow()}${renderSettingsRow()}`;
}

function computeTotals(){
  const totalPlanning = (state.items.planning || []).reduce((a,b)=>{
    const totalSpent = (b.spent||[]).reduce((x,y)=>x+Number(y.amount||0),0);
    const remaining = Number(b.amount||0) - totalSpent;
    return a + (remaining > 0 ? remaining : 0);
  }, 0);
  
  // calculate accounts total
  const totalAccounts = (state.accounts || []).reduce((a, acc) => {
    const val = Number(acc.amount || 0);
    if(acc.isPositive) return a + val; // add positive accounts
    else return a - val; // subtract negative accounts (liabilities)
  }, 0);

  const available = totalAccounts - totalPlanning;
  const previousAvailable = lastAvailableAmount;
  const shouldAnimateAvailable = hasRenderedAvailableOnce && Math.abs(previousAvailable - available) > 0.005;
  
  const availableEl = $('available');
  if (availableEl) {
    availableEl.textContent = formatCurrencyWhole(available);
    availableEl.style.color = available < 0 ? 'var(--pink)' : '';
  }
  lastAvailableAmount = available; // Update lastAvailableAmount after setting new value
  if (shouldAnimateAvailable) showAvailableToast(available);
  hasRenderedAvailableOnce = true;
  return { accounts: totalAccounts, planning: totalPlanning, available };
}

function formatActionText(action){
  const ts = formatActionDate(action.date);
  const prefix = ts ? `${ts}: ` : '';
  if (action.type === 'spend') {
    return `${prefix}spend ${action.name} -$${action.amount}`;
  }
  if (action.type === 'zero') {
    return `${prefix}zero ${action.name}`;
  }
  if (action.type === 'autofill') {
    return `${prefix}autofill ${action.name} +$${action.amount}`;
  }
  return `${prefix}${action.type} ${action.name}`;
}

function renderFooterAction(){
  const el = $('footer-last-action');
  if (!el) return;
  const history = state.actionHistory || [];
  if (history.length === 0) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  el.textContent = formatActionText(history[0]);
}

function triggerAvailableFlip(){
  const panels = [q('.available-amount')].filter(Boolean);
  panels.forEach((panel) => {
    panel.classList.remove('is-flipping');
    void panel.offsetWidth;
    panel.classList.add('is-flipping');
  });
}

function updateAvailableToastValue(value){
  const toastValue = $('available-toast-value');
  if (!toastValue) return;
  toastValue.textContent = formatCurrencyWhole(value);
  toastValue.style.color = value < 0 ? 'var(--pink)' : '';
}

function showAvailableToast(value){
  const toast = $('available-toast');
  const toastCard = q('.available-toast-card');
  if (!toast || !toastCard) return;

  updateAvailableToastValue(value);
  document.body.classList.add('available-toast-active');
  toast.classList.add('is-visible');
  toast.setAttribute('aria-hidden', 'false');
  toastCard.classList.remove('is-flipping');
  void toastCard.offsetWidth;
  toastCard.classList.add('is-flipping');

  if (availableToastHideTimer) window.clearTimeout(availableToastHideTimer);
  availableToastHideTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
    toast.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('available-toast-active');
    availableToastHideTimer = 0;
  }, 1000);
}

function scrollElementToCenter(element){
  if (!element) return;

  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const maxScrollY = Math.max(
    0,
    (document.documentElement.scrollHeight || document.body.scrollHeight || 0) - viewportHeight
  );
  const targetTop = Math.min(
    maxScrollY,
    Math.max(0, (window.scrollY || window.pageYOffset || 0) + rect.top - ((viewportHeight - rect.height) / 2))
  );

  window.scrollTo({ top: targetTop, behavior: 'smooth' });
}

function centerOpenInlineRow(){
  if (!pendingInlineRowFocus) return;
  const { section, key } = pendingInlineRowFocus;
  const row = document.querySelector(`.inline-row[data-inline-section="${section}"][data-inline-key="${key}"]`);
  if (!row) return;

  pendingInlineRowFocus = null;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollElementToCenter(row);
    });
  });
}

function showHistoryModal(){
  openInlineRow('planning', 'log');
}

function render(){ 
  const totals = computeTotals();
  renderAccountCards();
  renderPlanningList(totals);
  syncLogoHints();
  centerOpenInlineRow();
}

function escapeHtml(text){ return (text+'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"})[c]); }

function getSectionLabel(section){
  const labels = { accounts: 'account', planning: 'item' };
  return labels[section] || section;
}

// Actions
function addItem({name,amount,neededAmount,schedule,due,section,enableSpending}){
  if(section === 'accounts'){
    // accounts have different structure: name, amount, isPositive
    state.accounts = state.accounts || [];
    const id = uid();
    state.accounts.push({id, name, amount: parseFloat(amount)||0, isPositive: due === true, pinned: false}); // due used as isPositive flag
    recordAction({ type: 'add', name, section: 'accounts', date: new Date().toISOString() });
    saveLocal(); render();
    autosaveToGist();
    return id;
  } else {
    state.items = state.items || {};
    state.items.planning = state.items.planning || [];
    const finalNeededAmount = neededAmount !== undefined ? parseFloat(neededAmount) : parseFloat(amount);
    const spendingEnabled = enableSpending !== undefined ? enableSpending : false;
    const id = uid();
    state.items.planning.push({id,name,amount: parseFloat(amount)||0,neededAmount: finalNeededAmount||0,schedule,spent:[],enableSpending: spendingEnabled,pinned:false});
    recordAction({ type: 'add', name, section: 'planning', date: new Date().toISOString() });
    saveLocal(); render();
    autosaveToGist();
    return id;
  }
}

function updateItem(section, id, {name, amount, due, schedule, neededAmount, enableSpending}){
  if(section === 'accounts'){
    const item = state.accounts.find(a=>a.id===id);
    if(item){
      item.name = name;
      item.amount = amount;
      item.isPositive = due;
      recordAction({ type: 'edit', name: item.name, section: 'accounts', date: new Date().toISOString() });
    }
  } else {
    const item = state.items.planning.find(i=>i.id===id);
    if(item){
      item.name = name;
      item.amount = amount;
      item.schedule = schedule;
      if (neededAmount !== undefined) item.neededAmount = neededAmount;
      if (enableSpending !== undefined) item.enableSpending = enableSpending;
      recordAction({ type: 'edit', name: item.name, section: 'planning', date: new Date().toISOString() });
    }
  }
  saveLocal(); render();
  autosaveToGist();
}

function togglePinnedItem(section, id){
  if (section !== 'planning') return;
  const collection = section === 'accounts' ? state.accounts : state.items.planning;
  const item = collection.find(entry => entry.id === id);
  if (!item) return;

  item.pinned = !item.pinned;
  inlineRowState = null;
  pendingInlineRowFocus = { section, key: id };
  recordAction({
    type: item.pinned ? 'pin' : 'unpin',
    name: item.name,
    section,
    date: new Date().toISOString()
  });
  saveLocal();
  render();
  autosaveToGist();
}

async function removeItem(section,id){
  if(section === 'accounts'){
    state.accounts = state.accounts.filter(a=>a.id!==id);
  } else {
    state.items.planning = state.items.planning.filter(i=>i.id!==id);
  }
  saveLocal(); render();
  await autosaveToGist();
}

function addSpending(section, itemId, spendName, spendAmount, chargeAccountId=''){
  const collection = section === 'accounts' ? state.accounts : state.items.planning;
  const item = collection.find(i=>i.id===itemId);
  if(!item) return;
  item.spent = item.spent || [];
  const now = new Date().toISOString();
  const account = chargeAccountId ? (state.accounts || []).find(a=>a.id===chargeAccountId) : null;
  item.spent.push({
    name: spendName,
    amount: spendAmount,
    date: now,
    accountId: chargeAccountId || undefined,
    accountIsPositive: account ? !!account.isPositive : undefined
  });
  // record meta for UI
  state._lastUpdated = now;
  state._lastSpend = { section, itemId, name: spendName, amount: spendAmount, date: now, itemName: item.name, accountId: chargeAccountId || undefined };
  recordAction({ type: 'spend', name: item.name, section, amount: spendAmount, date: now });
  if(account){
    if(account.isPositive){
      account.amount = Number(account.amount||0) - spendAmount;
    } else {
      account.amount = Number(account.amount||0) + spendAmount;
    }
  }
  saveLocal();
}

function deleteSpendEntry(section, itemId, index){
  const item = state.items.planning.find(i=>i.id===itemId);
  if(!item || !Array.isArray(item.spent) || !item.spent[index]) return;

  const [spend] = item.spent.splice(index, 1);
  const spendAmount = Number(spend.amount) || 0;
  const chargeAccount = spend.accountId ? (state.accounts || []).find(a=>a.id===spend.accountId) : null;
  const accountIsPositive = spend.accountIsPositive !== undefined ? !!spend.accountIsPositive : chargeAccount ? !!chargeAccount.isPositive : null;

  if (chargeAccount && accountIsPositive !== null) {
    chargeAccount.amount = Number(chargeAccount.amount || 0) + (accountIsPositive ? spendAmount : -spendAmount);
  }

  saveLocal();
  render();
  autosaveToGist();
}

function updateAutofillTotalsFromDom(form){
  if (!form) return;
  const checked = Array.from(form.querySelectorAll('.autofill-cb:checked'));
  autofillSelection = new Set(checked.map(cb => cb.dataset.id));
  let total = 0;
  checked.forEach(cb => {
    total += parseFloat(cb.dataset.gap) || 0;
  });

  const totalEl = form.querySelector('.autofill-total-amount');
  if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
  const remEl = form.querySelector('#_af_remaining');
  if (remEl) remEl.textContent = `$${(lastAvailableAmount - total).toFixed(2)}`;
  const fillBtn = form.querySelector('#_af_fill');
  if (fillBtn) fillBtn.disabled = checked.length === 0;
}

function syncPlanningInlineSchedule(form){
  const recurring = form.querySelector('[name="recurring"]');
  const dayWrap = form.querySelector('[data-toggle-wrap="day"]');
  const dateWrap = form.querySelector('[data-toggle-wrap="date"]');
  if (!recurring || !dayWrap || !dateWrap) return;
  const isRecurring = recurring.checked;
  dayWrap.style.display = isRecurring ? '' : 'none';
  dateWrap.style.display = isRecurring ? 'none' : '';
}

function handleInlineSubmit(form){
  const section = form.dataset.section;
  const itemId = form.dataset.itemId || '';
  const isDraft = form.dataset.draft === '1';

  if (form.dataset.inlineSubmit === 'autofill') {
    const checked = Array.from(form.querySelectorAll('.autofill-cb:checked'));
    checked.forEach(cb => {
      const id = cb.dataset.id;
      const gap = parseFloat(cb.dataset.gap) || 0;
      if (gap <= 0) return;
      const item = (state.items.planning || []).find(i => i.id === id);
      if (item) {
        item.amount = (Number(item.amount) || 0) + gap;
        recordAction({ type: 'autofill', name: item.name, amount: gap.toFixed(2), date: new Date().toISOString() });
      }
    });

    saveLocal();
    closeInlineRow();
    autosaveToGist();
    return;
  }

  const name = form.querySelector('[name="name"]').value.trim();
  if (!name) {
    alert('Enter a name');
    return;
  }

  const amountValue = form.querySelector('[name="amount"]').value.trim();
  const parsedAmount = amountValue === '' ? 0 : parseFloat(amountValue);
  const newAmount = Number.isNaN(parsedAmount) ? 0 : parsedAmount;

  if (section === 'accounts') {
    const isPositive = form.querySelector('[name="isPositive"]').checked;
    if (isDraft) {
      closeInlineRow();
      const newId = addItem({ name, amount: newAmount, due: isPositive, section: 'accounts' });
      pendingInlineRowFocus = { section: 'accounts', key: newId };
      render();
      return;
    }

    const item = state.accounts.find(a => a.id === itemId);
    if (!item) return;
    const oldAmount = Number(item.amount) || 0;
    item.name = name;
    item.amount = newAmount;
    item.isPositive = isPositive;
    recordAction({ type: Math.abs(newAmount - oldAmount) > 0.001 ? 'edit amount' : 'edit', name: item.name, section: 'accounts', date: new Date().toISOString() });
    saveLocal();
    closeInlineRow();
    autosaveToGist();
    return;
  }

  const neededAmountValue = form.querySelector('[name="neededAmount"]').value.trim();
  const parsedNeededAmount = neededAmountValue === '' ? newAmount : parseFloat(neededAmountValue);
  const neededAmount = Number.isNaN(parsedNeededAmount) ? newAmount : parsedNeededAmount;
  const enableSpending = form.querySelector('[name="enableSpending"]').checked;
  const recurring = form.querySelector('[name="recurring"]').checked;
  let schedule;
  if (recurring) {
    const day = parseInt(form.querySelector('[name="day"]').value, 10);
    if (isNaN(day) || day < 1 || day > 31) {
      alert('Enter valid day 1-31');
      return;
    }
    schedule = { recurring: true, date: null, dayOfMonth: day };
  } else {
    const date = form.querySelector('[name="date"]').value;
    if (!date) {
      alert('Enter a target date');
      return;
    }
    schedule = { recurring: false, date, dayOfMonth: null };
  }

  if (isDraft) {
    closeInlineRow();
    const newId = addItem({ name, amount: newAmount, neededAmount, schedule, due: undefined, section, enableSpending });
    pendingInlineRowFocus = { section, key: newId };
    render();
    return;
  }

  const item = state.items.planning.find(i => i.id === itemId);
  if (!item) return;
  const oldRemaining = Number(item.amount) - (item.spent || []).reduce((a, b) => a + Number(b.amount || 0), 0);
  const amountChanged = Math.abs(newAmount - oldRemaining) > 0.001;
  item.name = name;
  item.schedule = schedule;
  item.neededAmount = neededAmount;
  item.enableSpending = enableSpending;
  if (amountChanged) {
    item.amount = newAmount;
    item.spent = [];
    recordAction({ type: 'edit amount', name: item.name, section, date: new Date().toISOString() });
  } else {
    recordAction({ type: 'edit', name: item.name, section, date: new Date().toISOString() });
  }
  saveLocal();
  closeInlineRow();
  autosaveToGist();
}

function handleInlineClick(e){
  const row = e.target.closest('.inline-row');
  if (!row) return;

  const toggle = e.target.closest('.inline-row-toggle');
  if (toggle) {
    const section = row.dataset.inlineSection;
    const key = row.dataset.inlineKey;
    if (isInlineRowOpen(section, key)) {
      closeInlineRow();
    } else {
      openInlineRow(section, key);
    }
    return;
  }

  const spendDeleteBtn = e.target.closest('.delete-spend-btn');
  const section = row.dataset.inlineSection;
  const key = row.dataset.inlineKey;
  const itemId = key === '__new__' ? null : key;
  if (spendDeleteBtn && section === 'planning' && itemId) {
    const index = parseInt(spendDeleteBtn.dataset.index, 10);
    if (Number.isInteger(index)) {
      deleteSpendEntry(section, itemId, index);
    }
    return;
  }

  const actionBtn = e.target.closest('[data-inline-action]');
  if (!actionBtn) return;

  const action = actionBtn.dataset.inlineAction;

  if (action === 'cancel' || action === 'close') {
    closeInlineRow();
    return;
  }

  if (action === 'spend' && section === 'planning' && itemId) {
    const spendingToggle = row.querySelector('[name="enableSpending"]');
    const spendingEnabled = spendingToggle ? spendingToggle.checked : !!(state.items.planning || []).find(i => i.id === itemId)?.enableSpending;
    if (!spendingEnabled) return;
    const spendPanel = row.querySelector('.spend-inline-panel');
    if (!spendPanel) return;

    const shouldOpen = spendPanel.hidden;
    spendPanel.hidden = !shouldOpen;
    row.dataset.spendOpen = shouldOpen ? '1' : '0';
    actionBtn.textContent = shouldOpen ? 'Hide' : 'Spend';

    if (shouldOpen) {
      const spendName = spendPanel.querySelector('[name="spendName"]');
      if (spendName) setTimeout(() => spendName.focus(), 0);
    } else {
      const spendName = spendPanel.querySelector('[name="spendName"]');
      const spendAmount = spendPanel.querySelector('[name="spendAmount"]');
      if (spendName) spendName.value = '';
      if (spendAmount) spendAmount.value = '';
    }
    return;
  }

  if (action === 'pin' && itemId && itemId !== '__new__') {
    togglePinnedItem(section, itemId);
    return;
  }

  if (action === 'spend-cancel' && section === 'planning' && itemId) {
    const spendPanel = row.querySelector('.spend-inline-panel');
    if (spendPanel) {
      spendPanel.hidden = true;
      row.dataset.spendOpen = '0';
      const spendName = spendPanel.querySelector('[name="spendName"]');
      const spendAmount = spendPanel.querySelector('[name="spendAmount"]');
      if (spendName) spendName.value = '';
      if (spendAmount) spendAmount.value = '';
    }
    const spendBtn = row.querySelector('[data-inline-action="spend"]');
    if (spendBtn) spendBtn.textContent = 'Spend';
    return;
  }

  if (action === 'spend-submit' && section === 'planning' && itemId) {
    const spendNameInput = row.querySelector('[name="spendName"]');
    const spendAmountInput = row.querySelector('[name="spendAmount"]');
    const spendName = spendNameInput ? spendNameInput.value.trim() : '';
    const spendAmtValue = spendAmountInput ? spendAmountInput.value.trim() : '';
    const spendAmount = spendAmtValue === '' ? 0 : parseFloat(spendAmtValue);

    if (!spendName) { alert('Enter a name for the spend'); return; }
    if (spendAmount <= 0) { alert('Enter a valid amount greater than 0'); return; }

    addSpending(section, itemId, spendName, spendAmount);
    saveLocal();
    render();
    autosaveToGist();
    return;
  }

  if (action === 'delete-account' && section === 'accounts' && itemId) {
    const account = (state.accounts || []).find(a => a.id === itemId);
    if (!account) return;
    if (confirm(`Remove account "${account.name}"?`)) {
      closeInlineRow();
      removeItem('accounts', itemId);
    }
    return;
  }

  if (action === 'delete-planning' && section === 'planning' && itemId) {
    const item = (state.items.planning || []).find(i => i.id === itemId);
    if (!item) return;
    if (confirm('Remove item?')) {
      closeInlineRow();
      removeItem('planning', itemId);
    }
    return;
  }

  if (action === 'save') {
    const form = row.querySelector('form[data-inline-submit]');
    if (form) form.requestSubmit();
    return;
  }

  if (action === 'import') {
    const input = row.querySelector('#import-file');
    if (input) input.click();
    return;
  }

  if (action === 'export') {
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
      alert('Export failed: ' + err.message);
    }
    return;
  }

  if (action === 'save-gist') {
    saveToGist(false);
    return;
  }

  if (action === 'load-gist') {
    loadFromGist();
    return;
  }
}

// UI wiring
function setupUI(){
  loadLocal(); render();

  document.addEventListener('focusin', (e) => clearAmountOnFocus(e.target));

  const planningList = $('planning-list');
  if (planningList) {
    planningList.addEventListener('click', handleInlineClick);
    planningList.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const spendPanel = e.target.closest('.spend-inline-panel');
      if (!spendPanel) return;
      e.preventDefault();
      const row = e.target.closest('.inline-row');
      const submitBtn = row ? row.querySelector('[data-inline-action="spend-submit"]') : null;
      if (submitBtn) submitBtn.click();
    });
    planningList.addEventListener('submit', (e) => {
      const form = e.target.closest('form[data-inline-submit]');
      if (!form) return;
      e.preventDefault();
      handleInlineSubmit(form);
    });
    planningList.addEventListener('change', (e) => {
      const autofillForm = e.target.closest('form[data-inline-submit="autofill"]');
      if (autofillForm && e.target.classList.contains('autofill-cb')) {
        updateAutofillTotalsFromDom(autofillForm);
        return;
      }

      const planningForm = e.target.closest('form[data-inline-submit="planning"]');
      if (planningForm && e.target.name === 'recurring') {
        syncPlanningInlineSchedule(planningForm);
      }

      if (planningForm && e.target.name === 'enableSpending') {
        const spendingActionRow = planningForm.querySelector('.spending-action-row');
        if (spendingActionRow) spendingActionRow.dataset.spendingEnabled = e.target.checked ? '1' : '0';
      }

      if (e.target.id === 'import-file') {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const importedData = JSON.parse(event.target.result);
            if (typeof importedData !== 'object') {
              throw new Error('Invalid backup file format');
            }

            if (confirm('This will replace all your current data with the imported backup. Are you sure?')) {
              state = normalizeState(importedData);
              saveLocal();
              render();
              alert('Data imported successfully!');
            }
          } catch (err) {
            alert('Import failed: ' + err.message);
          }

          e.target.value = '';
        };

        reader.onerror = () => {
          alert('Failed to read file');
          e.target.value = '';
        };

        reader.readAsText(file);
      }
    });
  }

  const accountsEl = $('account-cards');
  if (accountsEl) {
    accountsEl.addEventListener('click', handleInlineClick);
    accountsEl.addEventListener('submit', (e) => {
      const form = e.target.closest('form[data-inline-submit]');
      if (!form) return;
      e.preventDefault();
      handleInlineSubmit(form);
    });
  }

  document.addEventListener('click', (e) => {
    const settingsBtn = e.target.closest('[data-settings-action]');
    if (!settingsBtn) return;
    const action = settingsBtn.dataset.settingsAction;
    if (action === 'save') saveToGist(false);
    if (action === 'load') loadFromGist();
    if (action === 'save-autofill') saveAutofillSettingsFromDom();
    if (action === 'export') {
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
        alert('Export failed: ' + err.message);
      }
    }
    if (action === 'import') {
      const input = $('import-file');
      if (input) input.click();
    }
  });
}

// Gist API
async function saveToGist(createNew=false, silent=false){
  const tokenEl = $('gistToken'); const gidEl = $('gistId');
  const token = tokenEl ? tokenEl.value.trim() : (localStorage.getItem(GIST_TOKEN_KEY) || '');
  const gistId = gidEl ? gidEl.value.trim() : (localStorage.getItem(GIST_ID_KEY) || '');
  if(!token){ if(!silent) setStatus('Missing GitHub token', true); return; }
  if(!gistId && !createNew){ if(!silent) setStatus('Missing Gist ID', true); return; }
  const payload = {"budget-data.json": {content: JSON.stringify(state, null, 2)}};
  const headers = { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' };
  if(!silent) setStatus('Saving to gist...');
  try{
    let res;
    if(createNew || !gistId){
      res = await fetch('https://api.github.com/gists', {
        method: 'POST', headers: {...headers, 'Content-Type':'application/json'},
        body: JSON.stringify({files: payload, public: false, description: 'Budget data'})
      });
    } else {
      res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH', headers: {...headers, 'Content-Type':'application/json'},
        body: JSON.stringify({files: payload})
      });
    }
    const data = await res.json();
    if(res.ok){
      const id = data.id;
      if(gidEl) gidEl.value = id; localStorage.setItem(GIST_ID_KEY, id); localStorage.setItem(GIST_TOKEN_KEY, token);
      if(!silent) setStatus('Saved to gist: ' + id);
    } else {
      if(!silent) setStatus('Gist save failed: ' + (data.message||res.statusText), true);
      console.error('Gist error', data);
    }
  }catch(err){ if(!silent) setStatus('Network error saving gist', true); console.error(err); }
}

async function autosaveToGist(){
  const token = ($('gistToken') && $('gistToken').value.trim()) || localStorage.getItem(GIST_TOKEN_KEY);
  const gid = ($('gistId') && $('gistId').value.trim()) || localStorage.getItem(GIST_ID_KEY);
  if(!token || !gid) return; // silently skip
  // Set flag to prevent auto-refresh during save
  isSavingToGist = true;
  try {
    await saveToGist(false, true);
  } finally {
    isSavingToGist = false;
  }
}

async function loadFromGist(silent = false){
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

  if(!silent) setStatus('Loading from gist...');
  try{
    const headers = token ? { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' } : { 'Accept': 'application/vnd.github+json' };
    // Add timestamp and cache: 'no-store' to bypass browser/GitHub caching
    const res = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`, { 
      headers,
      cache: 'no-store'
    });
    const data = await res.json();
    if(res.ok){
      // find file named budget-data.json
      const file = data.files['budget-data.json'] || Object.values(data.files)[0];
      if(!file){ setStatus('No files found in gist', true); return; }
      const content = file.content;
      try{
   const parsed = JSON.parse(content);
   // Normalize loaded data before rendering
   state = normalizeState(parsed);
  // Sync paySchedule from state to localStorage
  if (state.paySchedule) {
    if (state.paySchedule.frequency) {
      localStorage.setItem(AUTOFILL_FREQ_KEY, state.paySchedule.frequency);
    }
    if (state.paySchedule.startDate) {
      localStorage.setItem(AUTOFILL_START_DATE_KEY, state.paySchedule.startDate);
    }
  }
  saveLocal(); render();
        localStorage.setItem(GIST_ID_KEY, gistId); if(token) localStorage.setItem(GIST_TOKEN_KEY, token);
        setStatus('Loaded data from gist');
      }catch(e){ setStatus('Invalid JSON in gist file', true); }
    } else {
      setStatus('Gist load failed: ' + (data.message||res.statusText), true);
    }
  }catch(err){ setStatus('Network error loading gist', true); console.error(err); }
}

function setStatus(msg, isError=false){
  const s = $('status');
  if (!s) return;
  s.textContent = msg;
  s.style.color = isError ? '#ffb4b4' : '#cfe9ff';
}

// Show a modal/form for adding spending to an item
function showSpendingForm(section, itemId){
  const collection = section === 'accounts' ? state.accounts : state.items.planning;
  const item = collection.find(i=>i.id===itemId);
  if(!item) return;

  // Create modal overlay
  const { overlay, modal } = createSpendingModalShell();

  modal.innerHTML = `
    <h3>Add spending to "${escapeHtml(item.name)}"</h3>
    <label>Name<br><input id="_spend_name" type="text" placeholder="e.g. Groceries"></label>
    <label>Amount<br><input id="_spend_amt" type="number" data-clear-on-focus="1" step="0.01" inputmode="decimal" placeholder="0.00"></label>
    <div class="actions">
      <button id="_spend_cancel">Cancel</button>
      <button id="_spend_ok">Add Spend</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // focus first field
  setTimeout(()=> document.getElementById('_spend_name').focus(), 20);

  function cleanup(){ unlockBodyScroll(); overlay.remove(); }

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('_spend_ok').click(); }
  });

  clearOnFirstFocus(document.getElementById('_spend_amt'));

  document.getElementById('_spend_cancel').addEventListener('click', ()=> cleanup());
  document.getElementById('_spend_ok').addEventListener('click', ()=>{
    const spendName = document.getElementById('_spend_name').value.trim();
    const spendAmtValue = document.getElementById('_spend_amt').value.trim();
    const spendAmount = spendAmtValue === '' ? 0 : parseFloat(spendAmtValue);
    
    if(!spendName){ alert('Enter a name for the spend'); return; }
    if(spendAmount <= 0){ alert('Enter a valid amount greater than 0'); return; }

    // record spent on the item
    addSpending(section, itemId, spendName, spendAmount);

    render();
    autosaveToGist();
    cleanup();
  });

  // close modal on overlay click (but not when clicking inside modal)
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) cleanup(); });
}

function updateItemAmountAndResetSpent(section, id, newAmount){
  if(section === 'accounts'){
    const item = state.accounts.find(a=>a.id===id);
    if(item){
      item.amount = newAmount;
      recordAction({ type: 'edit amount', name: item.name, section: 'accounts', date: new Date().toISOString() });
    }
  } else {
    const item = state.items.planning.find(i=>i.id===id);
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
  const { overlay, modal } = createModalShell();

  const title = `Edit Amount for ${getSectionLabel(section)}`;

  modal.innerHTML = `
    <h3>${title}</h3>
    <label>Current Amount<br><input id="_edit_amount" type="number" data-clear-on-focus="1" step="0.01" inputmode="decimal" placeholder="0.00" value="${Number(currentAmount).toFixed(2)}"></label>
    <div class="actions">
      <button id="_edit_amount_cancel">Cancel</button>
      <button id="_edit_amount_ok">Save</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  setTimeout(() => document.getElementById('_edit_amount').focus(), 20);

  function cleanup() {
    unlockBodyScroll();
    overlay.remove();
  }

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('_edit_amount_ok').click(); }
  });

  clearOnFirstFocus(document.getElementById('_edit_amount'));

  document.getElementById('_edit_amount_cancel').addEventListener('click', () => cleanup());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });

  document.getElementById('_edit_amount_ok').addEventListener('click', () => {
    const amountValue = document.getElementById('_edit_amount').value.trim();
    const newAmount = amountValue === '' ? 0 : parseFloat(amountValue);

    if (newAmount < 0) {
      alert('Amount cannot be negative');
      return;
    }

    if (section === 'planning') {
      if (confirm('This will clear the transaction history for the item and start with the new amount. Are you sure?')) {
        updateItemAmountAndResetSpent(section, itemId, newAmount);
        cleanup();
      }
    } else {
      updateItemAmountAndResetSpent(section, itemId, newAmount);
      cleanup();
    }
  });
}
function showItemForm(section, itemId = null) {
  openInlineRow(section, itemId || '__new__');
}

// ============ PAYCHECK AUTOFILL ============


function getNextBillDueDate(dayOfMonth) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);
  if (thisMonth >= today) return thisMonth;
  return new Date(today.getFullYear(), today.getMonth() + 1, dayOfMonth);
}

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

  (state.items.planning || []).forEach(item => {
    const remaining = getItemRemaining(item);
    const needed = Number(item.neededAmount || item.amount || 0);
    const gap = needed - remaining;
    if (gap <= 0.005) return;
    const dueDate = getNextScheduleDate(item);
    eligible.push({ item, section: 'planning', gap, dueDate });
  });

  return eligible;
}


function showAutofillModal() {
  openInlineRow('planning', 'autofill');
}

// Auto-refresh when app becomes visible (e.g., returning from background)
function setupAutoRefresh() {
  let lastRefreshTime = Date.now();
  const MIN_REFRESH_INTERVAL = 5000; // Don't refresh more than once per 5 seconds

  async function autoRefreshFromGist() {
    // Don't refresh while a save is in progress
    if (isSavingToGist) return;
    
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
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      autoRefreshFromGist();
    }
  });
}

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// Init
  setupUI();
  setupAutoRefresh();
  if (localStorage.getItem(GIST_ID_KEY) && localStorage.getItem(GIST_TOKEN_KEY)) {
    loadFromGist(true);
  }
