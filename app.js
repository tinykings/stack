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

function shouldUseBottomSheet(){
  return window.matchMedia('(max-width: 599px)').matches;
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
      isPositive: account.isPositive !== undefined ? !!account.isPositive : account.due !== undefined ? !!account.due : true
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
      enableSpending: item.enableSpending !== undefined ? !!item.enableSpending : true,
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
    }
    if (state.paySchedule.startDate) {
      localStorage.setItem(AUTOFILL_START_DATE_KEY, state.paySchedule.startDate);
    }
  }
  if (!Array.isArray(state.actionHistory)) {
    state.actionHistory = [];
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
}
function saveLocal(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Render

function formatCurrency(value){
  return '$' + Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrencyWhole(value){
  return '$' + Math.trunc(Number(value || 0)).toLocaleString('en-US');
}

function getVisibleSections(){
  return ['accounts', 'planning'];
}

function sortSectionItems(section, items){
  const copy = (items || []).slice();
  copy.sort((a, b) => {
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

function getItemMarkup(section, item){
  if(section === 'accounts'){
    const amountClass = item.isPositive ? 'asset' : 'liability';
    const accountType = item.isPositive ? 'Asset' : 'Debt';
    return `
      <div class="item">
        <div class="item-content item-clickable" data-id="${item.id}" data-section="accounts">
          <div class="item-info">
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-amount ${amountClass}">${formatCurrency(item.amount)}</div>
          </div>
          <div class="item-meta-row"><span class="meta">${accountType}</span></div>
        </div>
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
    <div class="item">
      <div class="item-content item-clickable" data-id="${item.id}" data-section="${section}">
        <div class="item-info">
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-amount ${amountClass}">${formatCurrency(Math.abs(remaining))}</div>
        </div>
        <div class="item-meta-row"><span class="meta">${escapeHtml(metaBits.join(' • '))}</span></div>
        ${Number(neededAmount) > 0 ? `<div class="item-progress"><div class="item-progress-bar ${progressClass}" style="width: ${remainingPercent}%"></div></div>` : ''}
      </div>
    </div>
  `;
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

  accountsEl.innerHTML = accounts.map(account => {
    const amountClass = account.isPositive ? 'asset' : 'liability';
    return `
      <button class="summary-chip summary-chip--accounts account-card" type="button" data-account-id="${account.id}">
        <div class="summary-chip-main">
          <span class="summary-chip-label">${escapeHtml(account.name)}</span>
          <span class="summary-chip-value ${amountClass}">${formatCurrency(account.amount)}</span>
        </div>
      </button>
    `;
  }).join('');
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
  const items = getSectionItems('planning');
  listEl.innerHTML = items.length ? items.map(item => getItemMarkup('planning', item)).join('') : '<div class="planning-empty">No planning items yet.</div>';
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
  
  const availableEl = $('available');
  const currentAvailableAmount = parseFloat(availableEl.textContent.replace(/[^0-9.-]+/g,"")) || 0;

  if (available !== currentAvailableAmount) {
    const direction = available > currentAvailableAmount ? 'up' : 'down';
    animateNumberChange(availableEl, currentAvailableAmount, available, 1000, direction);
  }

  availableEl.textContent = formatCurrency(available);
  lastAvailableAmount = available; // Update lastAvailableAmount after setting new value
  return { accounts: totalAccounts, planning: totalPlanning, available };
}

function animateNumberChange(element, startValue, endValue, duration, direction) {
  let startTime;
  const easing = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // Ease-in-out

  if (direction === 'up') {
    element.style.color = '#7bc48e'; // Green for up
  } else if (direction === 'down') {
    element.style.color = '#d47272'; // Red for down
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
      element.style.color = '';
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

function showHistoryModal(){
  const history = state.actionHistory || [];
  if (history.length === 0) return;

  lockBodyScroll();
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const modal = document.createElement('div'); modal.className = 'modal';

  let listHtml = '<ul class="history-list">';
  history.forEach(action => {
    listHtml += `<li>${escapeHtml(formatActionText(action))}</li>`;
  });
  listHtml += '</ul>';

  modal.innerHTML = `
    <h3>Recent Changes</h3>
    ${listHtml}
    <div class="actions"><button id="_history_close">Close</button></div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const cleanup = () => { unlockBodyScroll(); overlay.remove(); };
  document.getElementById('_history_close').addEventListener('click', cleanup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
}

function render(){ 
  const totals = computeTotals();
  renderAccountCards();
  renderPlanningList(totals);
  renderFooterAction(); 
  renderSettingsAccounts();
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
    state.accounts.push({id:uid(), name, amount: parseFloat(amount)||0, isPositive: due === true}); // due used as isPositive flag
    recordAction({ type: 'add', name, section: 'accounts', date: new Date().toISOString() });
  } else {
    state.items = state.items || {};
    state.items.planning = state.items.planning || [];
    const finalNeededAmount = neededAmount !== undefined ? parseFloat(neededAmount) : parseFloat(amount);
    const spendingEnabled = enableSpending !== undefined ? enableSpending : true;
    state.items.planning.push({id:uid(),name,amount: parseFloat(amount)||0,neededAmount: finalNeededAmount||0,schedule,spent:[],enableSpending: spendingEnabled});
    recordAction({ type: 'add', name, section: 'planning', date: new Date().toISOString() });
  }
  saveLocal(); render();
  autosaveToGist();
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

// UI wiring
function setupUI(){
  loadLocal(); render();

  const footerAction = $('footer-last-action');
  if (footerAction) {
    footerAction.addEventListener('click', showHistoryModal);
  }

  const planningList = $('planning-list');
  if (planningList) {
    planningList.addEventListener('click', e => {
      const itemClickable = e.target.closest('.item-clickable');
      if(itemClickable){
        showItemForm('planning', itemClickable.dataset.id);
      }
    });
  }

  const accountsEl = $('account-cards');
  if (accountsEl) {
    accountsEl.addEventListener('click', e => {
      const card = e.target.closest('[data-account-id]');
      if (!card) return;
      showItemForm('accounts', card.dataset.accountId);
    });
  }

  const addPlanningBtn = $('add-planning-btn');
  if (addPlanningBtn) {
    addPlanningBtn.addEventListener('click', () => showItemForm('planning'));
  }

  const addAccountSettingsBtn = $('add-account-settings-btn');
  if (addAccountSettingsBtn) {
    addAccountSettingsBtn.addEventListener('click', () => showItemForm('accounts'));
  }

  const settingsAccountsList = $('settings-accounts-list');
  if (settingsAccountsList) {
    settingsAccountsList.addEventListener('click', async e => {
      const openBtn = e.target.closest('.settings-account-open');
      if (openBtn) {
        showItemForm('accounts', openBtn.dataset.accountId);
        return;
      }

      const removeBtn = e.target.closest('.settings-account-remove');
      if (removeBtn) {
        const accountId = removeBtn.dataset.accountRemove;
        const account = (state.accounts || []).find(a => a.id === accountId);
        if (!account) return;
        if (confirm(`Remove account "${account.name}"?`)) {
          await removeItem('accounts', accountId);
        }
      }
    });
  }

  // Gist controls (moved to footer). Wire save/load buttons if present.
  const saveBtn = $('saveGist'); if(saveBtn) saveBtn.addEventListener('click', e=>{ e.preventDefault(); saveToGist(false); });
  const loadBtn = $('loadGist'); if(loadBtn) loadBtn.addEventListener('click', e=>{ e.preventDefault(); loadFromGist(); });

  const gistModal = $('gist-modal');
  const syncBtn = $('sync-btn');
  const gistModalClose = $('gist-modal-close');

  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      lockBodyScroll();
      gistModal.style.display = 'flex';
    });
  }

  if (gistModalClose) {
    gistModalClose.addEventListener('click', () => {
      gistModal.style.display = 'none';
      unlockBodyScroll();
    });
  }

  if (gistModal) {
    gistModal.addEventListener('click', e => {
      if (e.target === gistModal) {
        gistModal.style.display = 'none';
        unlockBodyScroll();
      }
    });
  }

  const autofillBtn = $('autofill-btn');
  if (autofillBtn) {
    autofillBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showAutofillModal();
    });
  }

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
        alert('Export failed: ' + err.message);
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
          if (typeof importedData !== 'object') {
            throw new Error('Invalid backup file format');
          }

          if (confirm('This will replace all your current data with the imported backup. Are you sure?')) {
           // Replace state with normalized imported data
            state = normalizeState(importedData);
            saveLocal();
            render();
            alert('Data imported successfully!');
            
            // Close the settings modal
            const gistModal = $('gist-modal');
            if (gistModal) gistModal.style.display = 'none';
          }
        } catch (err) {
          alert('Import failed: ' + err.message);
        }
        
        // Reset file input so same file can be selected again
        importFile.value = '';
      };

      reader.onerror = () => {
        alert('Failed to read file');
        importFile.value = '';
      };

      reader.readAsText(file);
    });
  }

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
  const s = $('status'); s.textContent = msg; s.style.color = isError ? '#ffb4b4' : '#cfe9ff';
}

// Show a modal/form for adding spending to an item
function showSpendingForm(section, itemId){
  const collection = section === 'accounts' ? state.accounts : state.items.planning;
  const item = collection.find(i=>i.id===itemId);
  if(!item) return;

  // Create modal overlay
  const { overlay, modal } = createModalShell();
  
  // Build account selector options
  let accountOptions = '<option value="">-- No account change --</option>';
  (state.accounts || []).forEach(acc=>{
    const label = acc.isPositive ? '✓ Asset' : '✗ Liability';
    accountOptions += `<option value="${acc.id}">${escapeHtml(acc.name)} (${label} $${Number(acc.amount).toFixed(2)})</option>`;
  });
  
  modal.innerHTML = `
    <h3>Add spending to "${escapeHtml(item.name)}"</h3>
    <label>Name<br><input id="_spend_name" type="text" placeholder="e.g. Groceries"></label>
    <label>Amount<br><input id="_spend_amt" type="number" step="0.01" inputmode="decimal" placeholder="0.00"></label>
    <label>Charge to account<br><select id="_spend_account">${accountOptions}</select></label>
    <div class="actions"><button id="_spend_cancel">Cancel</button><button id="_spend_ok">Add</button></div>
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
    const spendName = document.getElementById('_spend_name').value.trim();
    const spendAmtValue = document.getElementById('_spend_amt').value.trim();
    const spendAmount = spendAmtValue === '' ? 0 : parseFloat(spendAmtValue);
    const chargeAccountId = document.getElementById('_spend_account').value.trim();
    
    if(!spendName){ alert('Enter a name for the spend'); return; }
    if(spendAmount <= 0){ alert('Enter a valid amount greater than 0'); return; }

    // record spent on the item
    addSpending(section, itemId, spendName, spendAmount, chargeAccountId);

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
  const isEdit = itemId !== null;
  let item;

  if (isEdit) {
    if (section === 'accounts') {
      item = state.accounts.find(a => a.id === itemId);
    } else {
      item = state.items.planning.find(i => i.id === itemId);
    }
    if (!item) return;
  }

  const { overlay, modal } = createModalShell();

  const title = isEdit ? `Edit ${getSectionLabel(section)}` : `Add ${getSectionLabel(section)}`;

  let scheduleControlHtml = '';
  if (section === 'accounts') {
    const isChecked = isEdit ? item.isPositive : true;
    scheduleControlHtml = `<label><input id="_item_due" type="checkbox" ${isChecked ? 'checked' : ''}> Asset (unchecked=debt)</label>`;
  } else {
    const recurring = isEdit && item ? !!item.schedule?.recurring : true;
    const dayValue = isEdit && item && item.schedule?.recurring ? (item.schedule.dayOfMonth || 1) : 1;
    const dateValue = isEdit && item && !item.schedule?.recurring ? (item.schedule?.date || '') : '';
    scheduleControlHtml = `
      <label class="toggle-label"><input id="_item_recurring" type="checkbox" ${recurring ? 'checked' : ''}>Recurring monthly</label>
      <label id="_item_day_wrap">Day of month<br><input id="_item_day" type="number" min="1" max="31" inputmode="numeric" placeholder="1-31" value="${dayValue}"></label>
      <label id="_item_date_wrap">Target date<br><input id="_item_date" type="date" value="${dateValue}"></label>`;
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
    <label>Name<br><input id="_item_name" type="text" placeholder="Name" value="${isEdit && item ? escapeHtml(item.name) : ''}"></label>
    <label>Current Amount<br><input id="_item_amount" type="number" step="0.01" inputmode="decimal" placeholder="0.00" value="${currentAmountValue}"></label>
    ${section !== 'accounts' ? `<label>Needed Amount<br><input id="_item_needed_amount" type="number" step="0.01" inputmode="decimal" placeholder="0.00" value="${isEdit && item && item.neededAmount !== undefined ? Number(item.neededAmount).toFixed(2) : ''}"></label>` : ''}
    ${scheduleControlHtml}
    ${historyHtml}
    <div class="actions">
      ${isEdit ? '<button id="_item_delete" class="delBtn">Delete</button>' : ''}
      <button id="_item_cancel">Cancel</button>
      ${isEdit && section !== 'accounts' ? '<button id="_item_spend" class="spendBtn">Spend</button>' : ''}
      <button id="_item_ok">${isEdit ? 'Save' : 'Add'}</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  setTimeout(() => document.getElementById('_item_name').focus(), 20);

  function cleanup() {
    unlockBodyScroll();
    overlay.remove();
  }

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('_item_ok').click(); }
  });

  clearOnFirstFocus(document.getElementById('_item_amount'));
  if (section !== 'accounts') {
    clearOnFirstFocus(document.getElementById('_item_needed_amount'));
    clearOnFirstFocus(document.getElementById('_item_day'));

    const recurringToggle = document.getElementById('_item_recurring');
    const dayWrap = document.getElementById('_item_day_wrap');
    const dateWrap = document.getElementById('_item_date_wrap');
    const syncScheduleControls = () => {
      const isRecurring = recurringToggle.checked;
      dayWrap.style.display = isRecurring ? '' : 'none';
      dateWrap.style.display = isRecurring ? 'none' : '';
    };
    recurringToggle.addEventListener('change', syncScheduleControls);
    syncScheduleControls();
  }

  document.getElementById('_item_cancel').addEventListener('click', () => cleanup());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });

  if (isEdit) {
    if (section !== 'accounts') {
      document.getElementById('_item_spend').addEventListener('click', async () => {
        showSpendingForm(section, itemId);
        cleanup();
      });
    }

    document.getElementById('_item_delete').addEventListener('click', async () => {
      if (confirm('Remove item?')) {
        await removeItem(section, itemId);
        cleanup();
      }
    });

    // Handle delete spend item buttons
      document.querySelectorAll('.delete-spend-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const index = parseInt(btn.dataset.index);
          if (confirm('Delete this spend entry?')) {
          // Remove the spend item and reverse the linked account change
          if (item.spent && item.spent[index]) {
            deleteSpendEntry(section, itemId, index);
            cleanup();
          }
          }
        });
      });
  }

  document.getElementById('_item_ok').addEventListener('click', () => {
    const name = document.getElementById('_item_name').value.trim();
    // Treat blank as 0 for number inputs
    const amountValue = document.getElementById('_item_amount').value.trim();
    const newAmount = amountValue === '' ? 0 : parseFloat(amountValue);
    const neededAmountValue = section !== 'accounts' ? document.getElementById('_item_needed_amount').value.trim() : '';
    const neededAmount = section !== 'accounts' ? (neededAmountValue === '' ? 0 : parseFloat(neededAmountValue)) : undefined;

    if (!name) {
      alert('Enter a name');
      return;
    }

    let due;
    let schedule;
    if (section === 'accounts') {
      due = document.getElementById('_item_due').checked;
    } else {
      const recurring = document.getElementById('_item_recurring').checked;
      if (recurring) {
        const day = parseInt(document.getElementById('_item_day').value);
        if (isNaN(day) || day < 1 || day > 31) {
          alert('Enter valid day 1-31');
          return;
        }
        schedule = { recurring: true, date: null, dayOfMonth: day };
      } else {
        const date = document.getElementById('_item_date').value;
        if (!date) {
          alert('Enter a target date');
          return;
        }
        schedule = { recurring: false, date, dayOfMonth: null };
      }
    }

    if (isEdit) {
      if (section !== 'accounts') {
        const oldRemaining = Number(item.amount) - (item.spent || []).reduce((a, b) => a + Number(b.amount || 0), 0);
        const amountChanged = Math.abs(newAmount - oldRemaining) > 0.001;
        item.name = name;
        item.schedule = schedule;
        item.neededAmount = neededAmount;
        if (amountChanged) {
          item.amount = newAmount;
          item.spent = [];
          recordAction({ type: 'edit amount', name: item.name, section, date: new Date().toISOString() });
        } else {
          recordAction({ type: 'edit', name: item.name, section, date: new Date().toISOString() });
        }
        saveLocal(); render(); autosaveToGist();
      } else {
        const oldAmount = Number(item.amount) || 0;
        item.name = name;
        item.amount = newAmount;
        item.isPositive = due;
        recordAction({ type: Math.abs(newAmount - oldAmount) > 0.001 ? 'edit amount' : 'edit', name: item.name, section: 'accounts', date: new Date().toISOString() });
        saveLocal(); render(); autosaveToGist();
      }
    } else {
      const finalNeededAmount = neededAmount !== undefined && !isNaN(neededAmount) ? neededAmount : newAmount;
      addItem({ name, amount: newAmount, neededAmount: finalNeededAmount, schedule, due, section, enableSpending: section !== 'accounts' ? true : undefined });
    }

    cleanup();
  });
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
  const { overlay, modal } = createCenteredModalShell();
  modal.classList.add('autofill-modal');

  const storedFreq = localStorage.getItem(AUTOFILL_FREQ_KEY) || 'biweekly';
  const storedStartDate = localStorage.getItem(AUTOFILL_START_DATE_KEY) || '';

  modal.innerHTML = `
    <h3>Auto Fill</h3>
    <div id="_af_items_container"></div>
    <div class="autofill-freq-row">
      <span class="autofill-freq-label">Pay Frequency</span>
      <select id="_af_frequency">
        <option value="weekly" ${storedFreq === 'weekly' ? 'selected' : ''}>Every Week</option>
        <option value="biweekly" ${storedFreq === 'biweekly' ? 'selected' : ''}>Every Two Weeks</option>
        <option value="monthly" ${storedFreq === 'monthly' ? 'selected' : ''}>Every Month</option>
      </select>
    </div>
    <div class="autofill-freq-row">
      <span class="autofill-freq-label">Start Date</span>
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
    container.classList.add('autofill-scroll');
    const eligible = getAutoFillItems();

    if (eligible.length === 0) {
      container.innerHTML = '<p class="autofill-hint">All items are fully funded.</p>';
      updateFillBtn();
      return;
    }

    const withPerCheck = eligible.map(e => {
      const checks = e.dueDate ? checksUntilDate(e.dueDate, freq, startDate) : 1;
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

    let html = `<div class="autofill-header">Items to Fund</div><div class="autofill-list">`;
    withPerCheck
      .sort((a, b) => (a.dueDate?.getTime() || 0) - (b.dueDate?.getTime() || 0))
      .forEach(({ item, perCheckGap, dueDate }) => {
        const checks = dueDate ? checksUntilDate(dueDate, freq, startDate) : 1;
        const dueFmt = dueDate ? dueDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '-';
        const meta = `${dueFmt} · ${checks} check${checks !== 1 ? 's' : ''}`;
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

  function cleanup() { unlockBodyScroll(); overlay.remove(); }
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
      const item = (state.items.planning || []).find(i => i.id === id);
      if (item) {
        item.amount = (Number(item.amount) || 0) + gap;
        recordAction({ type: 'autofill', name: item.name, amount: gap.toFixed(2), date: new Date().toISOString() });
      }
    });

    saveLocal();
    render();
    
    if (typeof setStatus === 'function') setStatus('Allocating funds...');
    await autosaveToGist();
    if (typeof setStatus === 'function') setStatus('Funds allocated and saved');
    
    cleanup();
  });
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
