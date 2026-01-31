// Simple Budget app with Gist persistence
const STORAGE_KEY = 'budget_data_v1';
const GIST_ID_KEY = 'budget_gist_id';
const GIST_TOKEN_KEY = 'budget_gist_token';

let state = {
  balances: { checking: 0, savings: 0, credit: 0 },
  accounts: [], // [{id, name, amount, isPositive}]
  accounts_lastAction: null, // Last action for accounts section
  items: { accounts: [], budget: [], bills: [], goals: [] }
};
let lastAvailableAmount = 0; // New global variable
let isSavingToGist = false; // Flag to prevent auto-refresh during save

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
  if (state.items) {
    Object.keys(state.items).forEach(section=>{
      if (state.items[section + '_lastAction'] === undefined) {
        state.items[section + '_lastAction'] = null;
      }
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
  if (state.accounts_lastAction === undefined) {
    state.accounts_lastAction = null;
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

function renderLists(){
  ['accounts','budget','bills','goals'].forEach(section=>{
    const container = document.querySelector(`.list-items[data-section="${section}"]`);
    container.innerHTML = '';

    const lastActionDiv = document.querySelector(`.last-action[data-section="${section}"]`);
    if (lastActionDiv) {
      lastActionDiv.remove();
    }

    const lastAction = section === 'accounts' 
      ? state.accounts_lastAction 
      : state.items[section + '_lastAction'];
    if (lastAction) {
      const newLastActionDiv = document.createElement('div');
      newLastActionDiv.className = 'last-action';
      newLastActionDiv.dataset.section = section;
      const formattedActionDate = formatActionDate(lastAction.date);
      const dateSuffix = formattedActionDate ? ` at ${formattedActionDate}` : '';
      if (lastAction.type === 'spend') {
        newLastActionDiv.textContent = `${lastAction.type} - ${lastAction.name} - $${lastAction.amount}${dateSuffix}`;
      } else {
        newLastActionDiv.textContent = `${lastAction.type} - ${lastAction.name}${dateSuffix}`;
      }
      container.before(newLastActionDiv);
    }

    // handle accounts differently (simpler structure)
    if(section === 'accounts'){
      const accounts = (state.accounts || []).slice();
      accounts.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
      
      accounts.forEach(acc=>{
        const div = document.createElement('div');
        div.className = 'item';
        
        const amountClass = acc.isPositive ? 'asset' : 'liability';
        
        div.innerHTML = `
          <div class="item-content item-clickable" data-id="${acc.id}" data-section="accounts">
            <div class="item-info">
              <div class="item-name">${escapeHtml(acc.name)}</div>
              <div class="item-amount ${amountClass}">$${Number(acc.amount).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            </div>
          </div>
        `;
        
        container.appendChild(div);
      });
      return;
    }

    // take a shallow copy and sort for display only
    const items = (state.items[section] || []).slice();
    const ordinal = (n)=>{
      const s = ["th","st","nd","rd"], v = n%100;
      return n + (s[(v-20)%10] || s[v] || s[0]);
    };

    items.sort((a,b)=>{
      // budget: alphabetical by name
      if(section === 'budget'){
        const na = (a.name||'').toLowerCase(); const nb = (b.name||'').toLowerCase();
        return na.localeCompare(nb);
      }
      // bills: by day-of-month, starting from today
      if (section === 'bills') {
        const today = new Date().getDate();
        const getSortableDay = (item) => {
          if (item.due && item.due.type === 'day') {
            const day = Number(item.due.value);
            // If the day has passed this month, treat it as "next month" for sorting purposes
            return day < today ? day + 31 : day;
          }
          // Place items without a valid due day at the end
          return 999;
        };
        const da = getSortableDay(a);
        const db = getSortableDay(b);
        return da - db;
      }
      // goals: by date
      if(section === 'goals'){
        const pa = (a.due && a.due.type==='date' && a.due.value) ? new Date(a.due.value).getTime() : 9e15;
        const pb = (b.due && b.due.type==='date' && b.due.value) ? new Date(b.due.value).getTime() : 9e15;
        return pa - pb;
      }
      return 0;
    });

    items.forEach(item=>{
      const div = document.createElement('div');
      div.className = 'item';
      item.spent = item.spent || [];
      const totalSpent = item.spent.reduce((a,b)=>a+Number(b.amount||0),0);
      const remaining = Number(item.amount) - totalSpent;
      let amountClass = '';
      if (remaining > 0) {
        amountClass = 'positive-amount';
      } else if (remaining < 0) {
        amountClass = 'liability';
      }

      // Build due/schedule display
      let dueDisplay = '-';
      const d = item.due;
      if(d){
        if(typeof d === 'object'){
          if(d.type === 'recurrence'){
            dueDisplay = d.value === 'every-check' ? 'Every check' : 'Every month';
          } else if(d.type === 'day'){
            const day = Number(d.value) || 0;
            dueDisplay = ordinal(day);
          } else if(d.type === 'date'){
            try{ dueDisplay = new Date(d.value).toLocaleDateString(); }catch(e){ dueDisplay = d.value; }
          }
        } else if(typeof d === 'string'){
          // legacy string (maybe ISO date)
          if(/^\d{4}-\d{2}-\d{2}$/.test(d)) dueDisplay = new Date(d).toLocaleDateString(); else dueDisplay = d;
        }
      }

      // Build metadata (last spend info)
      const neededAmount = item.neededAmount !== undefined ? item.neededAmount : item.amount;
      const neededDisplay = `$${Number(neededAmount).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      
      let metaHTML = '';
      if(item.spent.length > 0){
        const mostRecent = item.spent[item.spent.length - 1];
        metaHTML = `
          <div class="item-meta-row" data-id="${item.id}" data-section="${section}">
            <span class="meta">${escapeHtml(dueDisplay)} • ${neededDisplay} • ${escapeHtml(mostRecent.name)} (-${Number(mostRecent.amount).toFixed(2)})</span>
          </div>
        `;
      } else {
        metaHTML = `
          <div class="item-meta-row" data-id="${item.id}" data-section="${section}">
            <span class="meta">${escapeHtml(dueDisplay)} • ${neededDisplay}</span>
          </div>
        `;
      }

      // Calculate progress percentage - shows remaining funds (full = all money available)
      const totalBudget = Number(neededAmount) || 0;
      const remainingPercent = totalBudget > 0 ? Math.max(0, Math.min(100, (remaining / totalBudget) * 100)) : 0;
      let progressClass = 'good';
      if (remainingPercent < 25) progressClass = 'danger';
      else if (remainingPercent < 50) progressClass = 'warning';
      
      const progressHTML = totalBudget > 0 ? `
        <div class="item-progress">
          <div class="item-progress-bar ${progressClass}" style="width: ${remainingPercent}%"></div>
        </div>
      ` : '';

      // Only show Spend button if enableSpending is not explicitly false
      const showSpendButton = item.enableSpending !== false;
      const actionsHTML = showSpendButton ? `
        <div class="item-actions-inline">
          <button class="icon-action-btn spend" data-action="spend" data-id="${item.id}" data-section="${section}" aria-label="Spend">➖</button>
        </div>
      ` : '';

      div.innerHTML = `
        <div class="item-content item-clickable" data-id="${item.id}" data-section="${section}">
          <div class="item-info">
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-amount ${amountClass}">$${Math.abs(remaining).toFixed(2)}</div>
          </div>
          ${metaHTML}
          ${progressHTML}
        </div>
        ${actionsHTML}
      `;

      container.appendChild(div);
    });
  });
}

function computeTotals(){
  const sum = s => state.items[s].reduce((a,b)=>{
    const totalSpent = (b.spent||[]).reduce((x,y)=>x+Number(y.amount||0),0);
    const remaining = Number(b.amount||0) - totalSpent;
    // Only add positive remaining amounts to the total. Negative amounts are for tracking only.
    return a + (remaining > 0 ? remaining : 0);
  }, 0);
  const totalBudget = sum('budget');
  const totalBills = sum('bills');
  const totalGoals = sum('goals');
  
  // calculate accounts total
  const totalAccounts = (state.accounts || []).reduce((a, acc) => {
    const val = Number(acc.amount || 0);
    if(acc.isPositive) return a + val; // add positive accounts
    else return a - val; // subtract negative accounts (liabilities)
  }, 0);
  
  $('total-budget').textContent = '$' + totalBudget.toFixed(2);
  $('total-bills').textContent = '$' + totalBills.toFixed(2);
  $('total-goals').textContent = '$' + totalGoals.toFixed(2);
  $('total-accounts').textContent = '$' + totalAccounts.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  
  // Available = sum of assets - sum of liabilities - budget - bills - goals
  const available = totalAccounts - totalBudget - totalBills - totalGoals;
  
  const availableEl = $('available');
  const currentAvailableAmount = parseFloat(availableEl.textContent.replace(/[^0-9.-]+/g,"")) || 0;

  if (available !== currentAvailableAmount) {
    const direction = available > currentAvailableAmount ? 'up' : 'down';
    animateNumberChange(availableEl, currentAvailableAmount, available, 1000, direction);
  }

  availableEl.textContent = '$' + available.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  lastAvailableAmount = available; // Update lastAvailableAmount after setting new value
}

function animateNumberChange(element, startValue, endValue, duration, direction) {
  let startTime;
  const easing = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // Ease-in-out

  const originalColor = element.style.color; // Store original color

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
      element.style.color = '#c8a44e'; // Restore to amber after animation
    }
  }
  requestAnimationFrame(animate);
}

function render(){ renderLists(); computeTotals(); }

function escapeHtml(text){ return (text+'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"})[c]); }

// Actions
function addItem({name,amount,neededAmount,due,section,enableSpending}){
  if(section === 'accounts'){
    // accounts have different structure: name, amount, isPositive
    state.accounts = state.accounts || [];
    state.accounts.push({id:uid(), name, amount: parseFloat(amount)||0, isPositive: due === true}); // due used as isPositive flag
    state.accounts_lastAction = {
      type: 'add',
      name,
      date: new Date().toISOString()
    };
  } else {
    state.items = state.items || {};
    state.items[section] = state.items[section] || [];
    const finalNeededAmount = neededAmount !== undefined ? parseFloat(neededAmount) : parseFloat(amount);
    const spendingEnabled = enableSpending !== undefined ? enableSpending : false;
    state.items[section].push({id:uid(),name,amount: parseFloat(amount)||0,neededAmount: finalNeededAmount||0,due,spent:[],enableSpending: spendingEnabled});
    state.items[section + '_lastAction'] = {
      type: 'add',
      name,
      date: new Date().toISOString()
    };
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
      state.accounts_lastAction = {
        type: 'edit',
        name: item.name,
        date: new Date().toISOString()
      };
    }
  } else {
    const item = state.items[section].find(i=>i.id===id);
    if(item){
      item.name = name;
      item.amount = amount;
      item.due = due;
      if (neededAmount !== undefined) item.neededAmount = neededAmount;
      if (enableSpending !== undefined) item.enableSpending = enableSpending;
      state.items[section + '_lastAction'] = {
        type: 'edit',
        name: item.name,
        date: new Date().toISOString()
      };
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
  state.items[section + '_lastAction'] = {
    type: 'spend',
    name: item.name,
    amount: spendAmount,
    date: now
  };
  saveLocal();
}

// Quick Transfer Logic
function showTransferForm() {
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const modal = document.createElement('div'); modal.className = 'modal';

  function getOptionsHtml() {
    let html = '<option value="">-- Select --</option>';
    // Accounts
    if (state.accounts && state.accounts.length > 0) {
      html += '<optgroup label="Accounts">';
      state.accounts.forEach(acc => {
        html += `<option value="acc:${acc.id}">${escapeHtml(acc.name)} ($${Number(acc.amount).toFixed(2)})</option>`;
      });
      html += '</optgroup>';
    }
    // Items
    ['budget', 'bills', 'goals'].forEach(sec => {
      const items = state.items[sec];
      if (items && items.length > 0) {
        html += `<optgroup label="${sec.charAt(0).toUpperCase() + sec.slice(1)}">`;
        items.forEach(item => {
          const totalSpent = (item.spent || []).reduce((a, b) => a + Number(b.amount || 0), 0);
          const remaining = Number(item.amount) - totalSpent;
          html += `<option value="${sec}:${item.id}">${escapeHtml(item.name)} (Rem: $${remaining.toFixed(2)})</option>`;
        });
        html += '</optgroup>';
      }
    });
    return html;
  }

  modal.innerHTML = `
    <h3>Transfer Funds</h3>
    <label>From<br><select id="_transfer_from">${getOptionsHtml()}</select></label>
    <label>To<br><select id="_transfer_to">${getOptionsHtml()}</select></label>
    <label>Amount<br><input id="_transfer_amt" type="number" step="0.01" inputmode="decimal" placeholder="0.00"></label>
    <div class="actions">
      <button id="_transfer_cancel">Cancel</button>
      <button id="_transfer_ok">Transfer</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  setTimeout(() => document.getElementById('_transfer_amt').focus(), 20);

  function cleanup() { overlay.remove(); }
  document.getElementById('_transfer_cancel').addEventListener('click', cleanup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

  document.getElementById('_transfer_ok').addEventListener('click', () => {
    const fromVal = document.getElementById('_transfer_from').value;
    const toVal = document.getElementById('_transfer_to').value;
    const amt = parseFloat(document.getElementById('_transfer_amt').value);

    if (!fromVal || !toVal || isNaN(amt) || amt <= 0) {
      alert('Please select both items and enter a valid amount.');
      return;
    }
    if (fromVal === toVal) {
      alert('Cannot transfer to the same item.');
      return;
    }

    const [fromSec, fromId] = fromVal.split(':');
    const [toSec, toId] = toVal.split(':');

    let fromItem, toItem;

    if (fromSec === 'acc') fromItem = state.accounts.find(a => a.id === fromId);
    else fromItem = state.items[fromSec].find(i => i.id === fromId);

    if (toSec === 'acc') toItem = state.accounts.find(a => a.id === toId);
    else toItem = state.items[toSec].find(i => i.id === toId);

    if (!fromItem || !toItem) {
      alert('Error finding items.');
      return;
    }

    // Process "From"
    if (fromSec === 'acc') {
      if (fromItem.isPositive) fromItem.amount -= amt;
      else fromItem.amount += amt; // Increase debt
    } else {
      fromItem.amount -= amt;
    }

    // Process "To"
    if (toSec === 'acc') {
      if (toItem.isPositive) toItem.amount += amt;
      else toItem.amount -= amt; // Decrease debt
    } else {
      toItem.amount += amt;
    }

    saveLocal();
    render();
    autosaveToGist();
    cleanup();
  });
}

// UI wiring
function setupUI(){
  loadLocal(); render();

  const transferBtn = $('transfer-btn');
  if (transferBtn) {
    transferBtn.addEventListener('click', showTransferForm);
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
  });

  // Gist controls (moved to footer). Wire save/load buttons if present.
  const saveBtn = $('saveGist'); if(saveBtn) saveBtn.addEventListener('click', e=>{ e.preventDefault(); saveToGist(false); });
  const loadBtn = $('loadGist'); if(loadBtn) loadBtn.addEventListener('click', e=>{ e.preventDefault(); loadFromGist(); });

  const gistModal = $('gist-modal');
  const syncBtn = $('sync-btn');
  const gistModalClose = $('gist-modal-close');

  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      gistModal.style.display = 'flex';
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

  // Update App button - clears cache and force reloads
  const updateAppBtn = $('update-app-btn');
  if (updateAppBtn) {
    updateAppBtn.addEventListener('click', async () => {
      updateAppBtn.textContent = 'Updating...';
      updateAppBtn.disabled = true;
      
      try {
        // Clear all caches
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
        }
        
        // Unregister service workers
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(reg => reg.unregister()));
        }
        
        // Force reload bypassing cache
        window.location.reload(true);
      } catch (err) {
        console.error('Update failed:', err);
        // Fallback: just do a hard reload
        window.location.reload(true);
      }
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
            // Merge imported data into state
            Object.assign(state, importedData);
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
  // remove legacy transactions from loaded data
  state = parsed;
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
  const item = state.items[section].find(i=>i.id===itemId);
  if(!item) return;

  // Create modal overlay
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const modal = document.createElement('div'); modal.className = 'modal';
  
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

  function cleanup(){ overlay.remove(); }

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
    const spendName = document.getElementById('_spend_name').value.trim();
    const spendAmtValue = document.getElementById('_spend_amt').value.trim();
    const spendAmount = spendAmtValue === '' ? 0 : parseFloat(spendAmtValue);
    const chargeAccountId = document.getElementById('_spend_account').value.trim();
    
    if(!spendName){ alert('Enter a name for the spend'); return; }
    if(spendAmount <= 0){ alert('Enter a valid amount greater than 0'); return; }

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
  });

  // close modal on overlay click (but not when clicking inside modal)
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) cleanup(); });
}

function updateItemAmountAndResetSpent(section, id, newAmount){
  if(section === 'accounts'){
    const item = state.accounts.find(a=>a.id===id);
    if(item){
      item.amount = newAmount;
      state.accounts_lastAction = {
        type: 'edit amount',
        name: item.name,
        date: new Date().toISOString()
      };
    }
  } else {
    const item = state.items[section].find(i=>i.id===id);
    if(item){
      item.amount = newAmount;
      item.spent = []; // Reset spent history
      state.items[section + '_lastAction'] = {
        type: 'edit amount',
        name: item.name,
        date: new Date().toISOString()
      };
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
  modal.className = 'modal';

  const title = `Edit Amount for ${section.slice(0, -1)}`;

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
    overlay.remove();
  }

  // Select all on focus for amount field
  document.getElementById('_edit_amount').addEventListener('focus', (e) => e.target.select());

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

    if (['budget', 'bills', 'goals'].includes(section)) {
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
      item = state.items[section].find(i => i.id === itemId);
    }
    if (!item) return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const title = isEdit ? `Edit ${section.slice(0, -1)}` : `Add ${section.slice(0, -1)}`;

  let dueControlHtml = '';
  if (section === 'accounts') {
    const isChecked = isEdit ? item.isPositive : true;
    dueControlHtml = `<label><input id="_item_due" type="checkbox" ${isChecked ? 'checked' : ''}> Asset (unchecked=debt)</label>`;
  } else if (section === 'budget') {
    const selected = isEdit && item && item.due ? item.due.value : 'every-month';
    dueControlHtml = `
      <label>Recurrence<br>
        <select id="_item_due">
          <option value="every-month" ${selected === 'every-month' ? 'selected' : ''}>Every month</option>
          <option value="every-check" ${selected === 'every-check' ? 'selected' : ''}>Every check</option>
        </select>
      </label>`;
  } else if (section === 'bills') {
    const value = isEdit && item && item.due ? item.due.value : '';
    dueControlHtml = `<label>Day of month<br><input id="_item_due" type="number" min="1" max="31" inputmode="numeric" placeholder="1-31" value="${value}"></label>`;
  } else if (section === 'goals') {
    const value = isEdit && item && item.due ? item.due.value : '';
    dueControlHtml = `<label>Date<br><input id="_item_due" type="date" value="${value}"></label>`;
  }

  let historyHtml = '';
  if (isEdit && ['budget', 'bills', 'goals'].includes(section) && item.spent && item.spent.length > 0) {
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

  // Enable Spending toggle (only for budget, bills, goals - not accounts)
  // Default to unchecked for new items, preserve existing value for edits
  const enableSpendingChecked = isEdit && item ? (item.enableSpending !== false) : false;
  const enableSpendingHtml = section !== 'accounts' ? `
    <label class="toggle-label">
      <input id="_item_enable_spending" type="checkbox" ${enableSpendingChecked ? 'checked' : ''}>
      Enable Spending
    </label>
  ` : '';

  modal.innerHTML = `
    <h3>${title}</h3>
    <label>Name<br><input id="_item_name" type="text" placeholder="Name" value="${isEdit && item ? escapeHtml(item.name) : ''}"></label>
    <label>Current Amount<br><input id="_item_amount" type="number" step="0.01" inputmode="decimal" placeholder="0.00" value="${currentAmountValue}"></label>
    ${section !== 'accounts' ? `<label>Needed Amount<br><input id="_item_needed_amount" type="number" step="0.01" inputmode="decimal" placeholder="0.00" value="${isEdit && item && item.neededAmount ? Number(item.neededAmount).toFixed(2) : ''}"></label>` : ''}
    ${dueControlHtml}
    ${enableSpendingHtml}
    ${historyHtml}
    <div class="actions">
      ${isEdit ? '<button id="_item_delete" class="delBtn">Delete</button>' : ''}
      <button id="_item_cancel">Cancel</button>
      <button id="_item_ok">${isEdit ? 'Save' : 'Add'}</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  setTimeout(() => document.getElementById('_item_name').focus(), 20);

  function cleanup() {
    overlay.remove();
  }

  // Clear amount fields on focus for easier editing
  document.getElementById('_item_amount').addEventListener('focus', (e) => e.target.select());
  if (section !== 'accounts') {
    document.getElementById('_item_needed_amount').addEventListener('focus', (e) => e.target.select());
  }

  document.getElementById('_item_cancel').addEventListener('click', () => cleanup());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });

  if (isEdit) {
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
          // Remove the spend item from the item's spent array
          if (item.spent && item.spent[index]) {
            item.spent.splice(index, 1);
            saveLocal();
            render(); // Update main UI
            // Wait for gist save to complete
            await autosaveToGist();
            // Close the form
            cleanup();
            window.location.reload();
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
    const enableSpending = section !== 'accounts' ? document.getElementById('_item_enable_spending').checked : undefined;

    if (!name) {
      alert('Enter a name');
      return;
    }

    let due;
    if (section === 'accounts') {
      due = document.getElementById('_item_due').checked;
    } else if (section === 'budget') {
      due = { type: 'recurrence', value: document.getElementById('_item_due').value };
    } else if (section === 'bills') {
      const day = parseInt(document.getElementById('_item_due').value);
      if (isNaN(day) || day < 1 || day > 31) {
        alert('Enter valid day 1-31');
        return;
      }
      due = { type: 'day', value: day };
    } else if (section === 'goals') {
      due = { type: 'date', value: document.getElementById('_item_due').value };
    }

    if (isEdit) {
      // Check if amount changed for non-account items
      if (section !== 'accounts') {
        const oldRemaining = Number(item.amount) - (item.spent || []).reduce((a, b) => a + Number(b.amount || 0), 0);
        if (Math.abs(newAmount - oldRemaining) > 0.001) {
          // Amount changed - update with new amount and reset spent
          updateItemAmountAndResetSpent(section, itemId, newAmount);
        }
        // Update other fields
        updateItem(section, itemId, { name, amount: item.amount, due, neededAmount, enableSpending });
      } else {
        updateItem(section, itemId, { name, amount: newAmount, due });
      }
    } else {
      const finalNeededAmount = neededAmount !== undefined && !isNaN(neededAmount) ? neededAmount : newAmount;
      addItem({ name, amount: newAmount, neededAmount: finalNeededAmount, due, section, enableSpending });
    }

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

// Init
  setupUI();
  setupAutoRefresh();
  setupInstallBanner();
  if (localStorage.getItem(GIST_ID_KEY) && localStorage.getItem(GIST_TOKEN_KEY)) {
    loadFromGist(true);
  }

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