// Simple Budget app with Gist persistence
const STORAGE_KEY = 'budget_data_v1';
const GIST_ID_KEY = 'budget_gist_id';
const GIST_TOKEN_KEY = 'budget_gist_token';

let state = {
  balances: { checking: 0, savings: 0, credit: 0 },
  accounts: [], // [{id, name, amount, isPositive}]
  items: { accounts: [], budget: [], bills: [], goals: [] }
};
// Each item now has: id, name, amount, due, spent (array of {name, amount, date})

// Helpers
const $ = id => document.getElementById(id);
const q = (sel, root=document) => root.querySelector(sel);

function uid(){return Math.random().toString(36).slice(2,9)}

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
  if (state.accounts && state.accounts._lastAction === undefined) {
    state.accounts._lastAction = null;
  }
  const gid = localStorage.getItem(GIST_ID_KEY);
  const tok = localStorage.getItem(GIST_TOKEN_KEY);
  if(gid) $('gistId').value = gid;
  if(tok) $('gistToken').value = tok;
}
function saveLocal(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Render
function renderBalances(){
  // Accounts rendering is now handled in renderLists
}

// Replace your renderLists() function with this updated version:

function renderLists(){
  ['accounts','budget','bills','goals'].forEach(section=>{
    const container = document.querySelector(`.list-items[data-section="${section}"]`);
    container.innerHTML = '';

    const lastActionDiv = document.querySelector(`.last-action[data-section="${section}"]`);
    if (lastActionDiv) {
      lastActionDiv.remove();
    }

    const sectionData = section === 'accounts' ? state.accounts : state.items;
    const lastAction = sectionData[section + '_lastAction'];
    if (lastAction) {
      const newLastActionDiv = document.createElement('div');
      newLastActionDiv.className = 'last-action';
      newLastActionDiv.dataset.section = section;
      if (lastAction.type === 'spend') {
        newLastActionDiv.textContent = `Last action: ${lastAction.type} on ${lastAction.name} for $${lastAction.amount} at ${new Date(lastAction.date).toLocaleTimeString()}`;
      } else {
        newLastActionDiv.textContent = `Last action: ${lastAction.type} on ${lastAction.name} at ${new Date(lastAction.date).toLocaleTimeString()}`;
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
          <div class="item-info">
            <div class="item-name editable-item-name" data-id="${acc.id}" data-section="accounts">${escapeHtml(acc.name)}</div>
            <div class="item-amount ${amountClass}" data-editable-amount data-id="${acc.id}" data-section="accounts">$${Number(acc.amount).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
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
      let metaHTML = '';
      if(item.spent.length > 0){
        const mostRecent = item.spent[item.spent.length - 1];
        metaHTML = `
          <div class="item-meta-row" data-id="${item.id}" data-section="${section}">
            <span class="meta">${escapeHtml(dueDisplay)} • ${escapeHtml(mostRecent.name)} (-${Number(mostRecent.amount).toFixed(2)})</span>
          </div>
        `;
      } else {
        metaHTML = `
          <div class="item-meta-row" data-id="${item.id}" data-section="${section}">
            <span class="meta">${escapeHtml(dueDisplay)}</span>
          </div>
        `;
      }

      div.innerHTML = `
        <div class="item-info">
          <div class="item-name editable-item-name" data-id="${item.id}" data-section="${section}">${escapeHtml(item.name)}</div>
          <div class="item-amount ${amountClass}" data-editable-amount data-id="${item.id}" data-section="${section}">${remaining.toFixed(2)}</div>
          ${metaHTML}
        </div>
        <div class="item-actions">
          <button class="addSpendBtn" data-id="${item.id}" data-section="${section}">Spend</button>
        </div>
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
  $('available').textContent = '$' + available.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function render(){ renderBalances(); renderLists(); computeTotals(); }

function escapeHtml(text){ return (text+'').replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"})[c]); }

// Actions
function addItem({name,amount,neededAmount,due,section}){
  if(section === 'accounts'){
    // accounts have different structure: name, amount, isPositive
    state.accounts = state.accounts || [];
    state.accounts.push({id:uid(), name, amount: parseFloat(amount)||0, isPositive: due === true}); // due used as isPositive flag
    state.accounts._lastAction = {
      type: 'add',
      name,
      date: new Date().toISOString()
    };
  } else {
    state.items = state.items || {};
    state.items[section] = state.items[section] || [];
    const finalNeededAmount = neededAmount !== undefined ? parseFloat(neededAmount) : parseFloat(amount);
    state.items[section].push({id:uid(),name,amount: parseFloat(amount)||0,neededAmount: finalNeededAmount||0,due,spent:[]});
    state.items[section + '_lastAction'] = {
      type: 'add',
      name,
      date: new Date().toISOString()
    };
  }
  saveLocal(); render();
  autosaveToGist();
}

function updateItem(section, id, {name, amount, due}){
  if(section === 'accounts'){
    const item = state.accounts.find(a=>a.id===id);
    if(item){
      item.name = name;
      item.amount = amount;
      item.isPositive = due;
      state.accounts._lastAction = {
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

function removeItem(section,id){
  if(section === 'accounts'){
    state.accounts = state.accounts.filter(a=>a.id!==id);
  } else {
    state.items[section] = state.items[section].filter(i=>i.id!==id);
  }
  saveLocal(); render();
  autosaveToGist();
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

function updateLastRefreshTime() {
  const now = new Date();
  const options = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' };
  const formattedDateTime = now.toLocaleDateString(undefined, options);
  const lastRefreshTimeEl = $('last-refresh-time');
  if (lastRefreshTimeEl) {
    lastRefreshTimeEl.textContent = `-${formattedDateTime}-`;
  }
}

// UI wiring
function setupUI(){
  loadLocal(); render();



  // per-section add buttons (now includes accounts)
  document.querySelectorAll('.addItemSectionBtn').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const sec = btn.dataset.section; 
      showItemForm(sec);
    });
  });

  document.querySelectorAll('.list-items').forEach(container=>{
    container.addEventListener('click', e=>{
      const target = e.target.closest('.editable-item-name, .addSpendBtn');
      if(target){
        const id = target.dataset.id;
        const section = target.dataset.section;
        if(target.classList.contains('addSpendBtn')){
          showSpendingForm(section, id);
        } else if(target.classList.contains('editable-item-name')){
          showItemForm(section, id);
        }
      } else {
        const editableAmountTarget = e.target.closest('[data-editable-amount]');
        if (editableAmountTarget) {
          const id = editableAmountTarget.dataset.id;
          const section = editableAmountTarget.dataset.section;
          let currentAmount;
          if (section === 'accounts') {
            const account = state.accounts.find(a => a.id === id);
            currentAmount = account ? account.amount : 0;
          } else {
            const item = state.items[section].find(i => i.id === id);
            currentAmount = item ? item.amount : 0;
          }
          showEditAmountForm(section, id, currentAmount);
        }
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

  const refreshBtnFooter = $('refresh-btn-footer');
  if (refreshBtnFooter) {
    refreshBtnFooter.addEventListener('click', e => {
      e.preventDefault();
      location.reload();
      updateLastRefreshTime(); // Update time on refresh button click
    });
  }
  updateLastRefreshTime(); // Initial call on page load
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

function autosaveToGist(){
  const token = ($('gistToken') && $('gistToken').value.trim()) || localStorage.getItem(GIST_TOKEN_KEY);
  const gid = ($('gistId') && $('gistId').value.trim()) || localStorage.getItem(GIST_ID_KEY);
  if(!token || !gid) return; // silently skip
  // fire-and-forget, silent
  saveToGist(false, true);
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
    const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers });
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
    <label>Amount<br><input id="_spend_amt" type="number" step="0.01" placeholder="0.00"></label>
    <label>Charge to account<br><select id="_spend_account">${accountOptions}</select></label>
    <div class="actions"><button id="_spend_cancel">Cancel</button><button id="_spend_ok">Add</button></div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // focus first field
  setTimeout(()=> document.getElementById('_spend_name').focus(), 20);

  function cleanup(){ overlay.remove(); }

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
    const spendAmount = parseFloat(document.getElementById('_spend_amt').value);
    const chargeAccountId = document.getElementById('_spend_account').value.trim();
    
    if(!spendName){ alert('Enter a name for the spend'); return; }
    if(isNaN(spendAmount) || spendAmount <= 0){ alert('Enter a valid amount'); return; }

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
      state.accounts._lastAction = {
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
    <label>Current Amount<br><input id="_edit_amount" type="number" step="0.01" placeholder="0.00" value="${Number(currentAmount).toFixed(2)}"></label>
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

  document.getElementById('_edit_amount_cancel').addEventListener('click', () => cleanup());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });

  document.getElementById('_edit_amount_ok').addEventListener('click', () => {
    const newAmount = parseFloat(document.getElementById('_edit_amount').value);

    if (isNaN(newAmount) || newAmount < 0) {
      alert('Enter a valid positive amount');
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
    dueControlHtml = `<label>Day of month<br><input id="_item_due" type="number" min="1" max="31" placeholder="1-31" value="${value}"></label>`;
  } else if (section === 'goals') {
    const value = isEdit && item && item.due ? item.due.value : '';
    dueControlHtml = `<label>Date<br><input id="_item_due" type="date" value="${value}"></label>`;
  }

  let historyHtml = '';
  if (isEdit && ['budget', 'bills', 'goals'].includes(section) && item.spent && item.spent.length > 0) {
    historyHtml = '<h4>Spend History</h4><ul>';
    item.spent.forEach(spend => {
      historyHtml += `<li>${escapeHtml(spend.name)} - $${Number(spend.amount).toFixed(2)} on ${new Date(spend.date).toLocaleDateString()}</li>`;
    });
    historyHtml += '</ul>';
  }

  modal.innerHTML = `
    <h3>${title}</h3>
    <label>Name<br><input id="_item_name" type="text" placeholder="Name" value="${isEdit && item ? escapeHtml(item.name) : ''}"></label>
    ${!isEdit ? `<label>Current Amount<br><input id="_item_amount" type="number" step="0.01" placeholder="0.00" value=""></label>` : ''}
    ${section !== 'accounts' ? `<label>Needed Amount<br><input id="_item_needed_amount" type="number" step="0.01" placeholder="0.00" value="${isEdit && item && item.neededAmount ? Number(item.neededAmount).toFixed(2) : ''}"></label>` : ''}
    ${dueControlHtml}
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

  document.getElementById('_item_cancel').addEventListener('click', () => cleanup());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });

  if (isEdit) {
    document.getElementById('_item_delete').addEventListener('click', () => {
      if (confirm('Remove item?')) {
        removeItem(section, itemId);
        cleanup();
      }
    });
  }

  document.getElementById('_item_ok').addEventListener('click', () => {
    const name = document.getElementById('_item_name').value.trim();
    const amount = !isEdit ? parseFloat(document.getElementById('_item_amount').value) : item.amount;
    const neededAmount = section !== 'accounts' ? parseFloat(document.getElementById('_item_needed_amount').value) : undefined;

    if (!name || (!isEdit && isNaN(amount)) || (section !== 'accounts' && isNaN(neededAmount))) {
      alert('Enter name and valid amounts');
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
      updateItem(section, itemId, { name, amount, due });
    } else {
      addItem({ name, amount, neededAmount, due, section });
    }

    cleanup();
  });
}

// Init
  setupUI();
  if (localStorage.getItem(GIST_ID_KEY) && localStorage.getItem(GIST_TOKEN_KEY)) {
    loadFromGist(true);
  }