// ─── API ───────────────────────────────────────────────────────────────────────
const api = {
  async req(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || 'Request failed');
    return json.data ?? json;
  },
  get: (path) => api.req('GET', path),
  post: (path, body) => api.req('POST', path, body),
  put: (path, body) => api.req('PUT', path, body),
  delete: (path) => api.req('DELETE', path),
};

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  hooks: [],
  scripts: [],
  logs: [],
  currentPage: 'dashboard',
  autoRefreshInterval: null,
  isAutoRefresh: false,
  filterStatus: '',
  searchQuery: '',
  currentHookFilter: null,
};

let pollTimeout = null;

// ─── Toast ───────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function navigateTo(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.getElementById(`nav-${page}`)?.classList.add('active');
  loadPage(page);
}

async function loadPage(page) {
  try {
    if (page === 'dashboard') await loadDashboard();
    if (page === 'hooks') await loadHooks();
    if (page === 'scripts') await loadScripts();
    if (page === 'logs') await loadLogs();
    if (page === 'settings') await loadSettings();
  } catch (e) { toast(e.message, 'error'); }
}

// ─── Auth ────────────────────────────────────────────────────────────────────
async function checkAuth() {
  try {
    await api.get('/api/auth/me');
    showApp();
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  navigateTo('dashboard');
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  const pw = document.getElementById('login-password').value;
  btn.disabled = true;
  errEl.classList.add('hidden');
  try {
    await api.post('/api/auth/login', { password: pw });
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally { btn.disabled = false; }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout', {});
  showLogin();
});

// ─── Dashboard ───────────────────────────────────────────────────────────────
async function loadDashboard() {
  const [hooks, scripts, logs] = await Promise.all([
    api.get('/api/hooks'), api.get('/api/scripts'), api.get('/api/logs?limit=10')
  ]);
  state.hooks = hooks || [];
  state.scripts = scripts || [];
  state.logs = logs || [];
  document.getElementById('stat-hooks').textContent = state.hooks.length;
  document.getElementById('stat-scripts').textContent = state.scripts.length;
  const success = state.logs.filter(l => l.status === 'success').length;
  const failed = state.logs.filter(l => l.status === 'failed' || l.status === 'timeout' || l.status === 'interrupted').length;
  document.getElementById('stat-success').textContent = success;
  document.getElementById('stat-failed').textContent = failed;
  document.getElementById('dashboard-logs').innerHTML = renderLogsTable(state.logs.slice(0, 8));
  checkRunningAndAutoRefresh();
}

// ─── Hooks ───────────────────────────────────────────────────────────────────
async function loadHooks() {
  const [hooks, scripts] = await Promise.all([
    api.get('/api/hooks'), api.get('/api/scripts')
  ]);
  state.hooks = hooks || [];
  state.scripts = scripts || [];
  renderHooks();
}

function renderHooks() {
  const el = document.getElementById('hooks-list');
  if (!state.hooks.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <h3>No hooks yet</h3><p>Create your first webhook endpoint</p>
      <button class="btn btn-primary" onclick="openHookModal()">Create Hook</button>
    </div>`; return;
  }
  el.innerHTML = state.hooks.map(h => {
    const webhookUrl = `${window.location.origin}/webhook/${escHtml(h.secret_token)}`;
    return `
    <div class="hook-card" id="hook-card-${h.id}">
      <div class="card-header-row">
        <div class="card-title">
          <span class="badge-id" title="Click to copy ID" onclick="copyText('${h.id}', 'Hook ID #${h.id} copied!')">#${h.id}</span>
          ${escHtml(h.name)}
        </div>
        <span class="badge ${h.enabled ? 'badge-success' : 'badge-muted'}">${h.enabled ? '● Active' : '○ Disabled'}</span>
      </div>
      <div class="card-desc">${escHtml(h.description || 'No description')}</div>
      <div class="card-meta">
        <span class="badge badge-accent">/${escHtml(h.slug)}</span>
        ${h.script_name ? `<span class="badge badge-muted">📄 ${escHtml(h.script_name)}</span>` : `<span class="badge badge-warning">⚠ No script</span>`}
      </div>
      <div class="token-box">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${webhookUrl}">/webhook/${escHtml(h.secret_token)}</span>
        <div class="token-actions">
          <button class="copy-btn" title="Copy full Webhook URL" onclick="copyHookUrl('${escHtml(h.secret_token)}')">
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M12.232 4.232a2.5 2.5 0 013.536 3.536l-1.225 1.224a.75.75 0 001.061 1.06l1.224-1.224a4 4 0 00-5.656-5.656l-3 3a4 4 0 00.225 5.865.75.75 0 00.977-1.138 2.5 2.5 0 01-.142-3.667l3-3z"/><path d="M11.603 7.963a.75.75 0 00-.977 1.138 2.5 2.5 0 01.142 3.667l-3 3a2.5 2.5 0 01-3.536-3.536l1.225-1.224a.75.75 0 00-1.061-1.06l-1.224 1.224a4 4 0 105.656 5.656l3-3a4 4 0 00-.225-5.865z"/></svg>
          </button>
          <button class="copy-btn" title="Copy cURL command" onclick="copyCurlCmd('${escHtml(h.secret_token)}')">
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 3.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 12 5.293 9.707a1 1 0 010-1.414zM11 13a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>
          </button>
          <button class="copy-btn" title="Copy Secret Token" onclick="copyText('${escHtml(h.secret_token)}', 'Secret Token copied!')">
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg>
          </button>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" onclick="triggerHookNow(${h.id}, '${escHtml(h.name)}')">⚡ Trigger</button>
        <button class="btn btn-ghost btn-sm" onclick="openHookModal(${h.id})">Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="regenToken(${h.id})">Regen</button>
        <button class="btn btn-ghost btn-sm" onclick="viewHookLogs(${h.id}, '${escHtml(h.name)}')">Logs</button>
        <button class="btn btn-danger btn-sm btn-icon-only" onclick="deleteHook(${h.id})" title="Delete">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

function openHookModal(id) {
  const hook = id ? state.hooks.find(h => h.id === id) : null;
  const scriptOptions = state.scripts.map(s => `<option value="${s.id}" ${hook?.script_id == s.id ? 'selected' : ''}>${escHtml(s.name)}</option>`).join('');
  openModal(hook ? 'Edit Hook' : 'New Hook', `
    <form id="hook-form">
      <div class="form-group">
        <label for="hk-name">Name *</label>
        <input id="hk-name" type="text" placeholder="e.g. Deploy Production" value="${escHtml(hook?.name || '')}" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="hk-slug">Slug</label>
          <input id="hk-slug" type="text" placeholder="auto-generated" value="${escHtml(hook?.slug || '')}" />
          <div class="hint">Lowercase letters, numbers, dashes only</div>
        </div>
        <div class="form-group">
          <label for="hk-script">Linked Script</label>
          <select id="hk-script"><option value="">— None —</option>${scriptOptions}</select>
        </div>
      </div>
      <div class="form-group">
        <label for="hk-desc">Description</label>
        <input id="hk-desc" type="text" placeholder="What does this hook do?" value="${escHtml(hook?.description || '')}" />
      </div>
      ${hook ? `<div class="form-group" style="display:flex;align-items:center;gap:10px">
        <label class="toggle"><input type="checkbox" id="hk-enabled" ${hook.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label>
        <label for="hk-enabled" style="margin:0">Enabled</label>
      </div>` : ''}
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">${hook ? 'Save Changes' : 'Create Hook'}</button>
      </div>
    </form>
  `);
  document.getElementById('hook-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const scriptVal = document.getElementById('hk-script').value;
    const payload = {
      name: document.getElementById('hk-name').value,
      slug: document.getElementById('hk-slug').value || undefined,
      script_id: scriptVal ? parseInt(scriptVal) : null,
      description: document.getElementById('hk-desc').value,
      enabled: hook ? document.getElementById('hk-enabled').checked : true,
    };
    try {
      if (hook) await api.put(`/api/hooks/${hook.id}`, payload);
      else await api.post('/api/hooks', payload);
      closeModal(); toast(hook ? 'Hook updated' : 'Hook created', 'success');
      await loadHooks();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function deleteHook(id) {
  if (!confirm('Delete this hook? All its logs will also be deleted.')) return;
  try { await api.delete(`/api/hooks/${id}`); toast('Hook deleted', 'success'); await loadHooks(); }
  catch (e) { toast(e.message, 'error'); }
}

async function regenToken(id) {
  if (!confirm('Regenerate the secret token? The old token will stop working.')) return;
  try {
    const res = await api.post(`/api/hooks/${id}/regen-token`, {});
    toast('Token regenerated', 'success'); await loadHooks();
  } catch (e) { toast(e.message, 'error'); }
}

async function triggerHookNow(id, name) {
  if (!confirm(`Trigger webhook for "${name}" now?`)) return;
  try {
    await api.post(`/api/hooks/${id}/trigger`, {});
    toast(`Hook "${name}" triggered!`, 'success');
    state.currentHookFilter = null;
    navigateTo('logs');
    checkRunningAndAutoRefresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function viewHookLogs(hookId, hookName) {
  state.currentHookFilter = hookId;
  navigateTo('logs');
  setTimeout(() => loadLogs(hookId), 100);
}

document.getElementById('new-hook-btn').addEventListener('click', () => openHookModal());

// ─── Scripts ─────────────────────────────────────────────────────────────────
async function loadScripts() {
  const scripts = await api.get('/api/scripts');
  state.scripts = scripts || [];
  renderScripts();
}

function renderScripts() {
  const el = document.getElementById('scripts-list');
  if (!state.scripts.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <h3>No scripts yet</h3><p>Create a shell script to link to a hook</p>
      <button class="btn btn-primary" onclick="openScriptModal()">Create Script</button>
    </div>`; return;
  }
  el.innerHTML = state.scripts.map(s => `
    <div class="script-card">
      <div class="card-header-row">
        <div class="card-title">
          <span class="badge-id" title="Click to copy ID" onclick="copyText('${s.id}', 'Script ID #${s.id} copied!')">#${s.id}</span>
          📄 ${escHtml(s.name)}
        </div>
      </div>
      <div class="card-desc">${escHtml(s.description || 'No description')}</div>
      <div class="card-meta">
        <span class="badge badge-muted">⏱ ${s.timeout_seconds}s timeout</span>
        <span class="badge badge-muted">📁 ${escHtml(s.working_dir)}</span>
      </div>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" onclick="runScriptNow(${s.id}, '${escHtml(s.name)}')">▶ Run</button>
        <button class="btn btn-ghost btn-sm" onclick="copyScriptContent(${s.id})">📋 Copy</button>
        <button class="btn btn-ghost btn-sm" onclick="openScriptModal(${s.id})">Edit</button>
        <button class="btn btn-danger btn-sm btn-icon-only" onclick="deleteScript(${s.id})" title="Delete">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        </button>
      </div>
    </div>`).join('');
}

function openScriptModal(id) {
  const s = id ? state.scripts.find(x => x.id === id) : null;
  openModal(s ? 'Edit Script' : 'New Script', `
    <form id="script-form">
      <div class="form-group">
        <label for="sc-name">Name *</label>
        <input id="sc-name" type="text" placeholder="e.g. Deploy App" value="${escHtml(s?.name || '')}" required />
      </div>
      <div class="form-group">
        <label for="sc-desc">Description</label>
        <input id="sc-desc" type="text" placeholder="What does this script do?" value="${escHtml(s?.description || '')}" />
      </div>
      <div class="form-group">
        <label for="sc-content">Shell Script *</label>
        <textarea id="sc-content" placeholder="#!/bin/bash&#10;echo 'Hello from hook!'">${escHtml(s?.content || '')}</textarea>
        <div class="hint">bash is used. set -euo pipefail is automatically prepended.</div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="sc-timeout">Timeout (seconds)</label>
          <input id="sc-timeout" type="number" min="1" max="3600" value="${s?.timeout_seconds || 30}" />
        </div>
        <div class="form-group">
          <label for="sc-workdir">Working Directory</label>
          <input id="sc-workdir" type="text" placeholder="/tmp" value="${escHtml(s?.working_dir || '/tmp')}" />
        </div>
      </div>
      <div class="form-group">
        <label for="sc-env">Environment Variables (JSON)</label>
        <input id="sc-env" type="text" placeholder='{"MY_VAR": "value"}' value="${escHtml(s?.env_vars || '{}')}" />
        <div class="hint">Keys must be alphanumeric + underscore only.</div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">${s ? 'Save Changes' : 'Create Script'}</button>
      </div>
    </form>
  `);
  document.getElementById('script-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('sc-name').value,
      description: document.getElementById('sc-desc').value,
      content: document.getElementById('sc-content').value,
      timeout_seconds: parseInt(document.getElementById('sc-timeout').value) || 30,
      working_dir: document.getElementById('sc-workdir').value || '/tmp',
      env_vars: document.getElementById('sc-env').value || '{}',
    };
    try {
      if (s) await api.put(`/api/scripts/${s.id}`, payload);
      else await api.post('/api/scripts', payload);
      closeModal(); toast(s ? 'Script updated' : 'Script created', 'success');
      await loadScripts();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function runScriptNow(id, name) {
  if (!confirm(`Run script "${name}" directly now?`)) return;
  try {
    await api.post(`/api/scripts/${id}/run`, {});
    toast(`Script "${name}" execution started!`, 'success');
    state.currentHookFilter = null;
    navigateTo('logs');
    checkRunningAndAutoRefresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteScript(id) {
  if (!confirm('Delete this script?')) return;
  try { await api.delete(`/api/scripts/${id}`); toast('Script deleted', 'success'); await loadScripts(); }
  catch (e) { toast(e.message, 'error'); }
}

document.getElementById('new-script-btn').addEventListener('click', () => openScriptModal());

// ─── Logs ────────────────────────────────────────────────────────────────────
async function loadLogs(hookId) {
  if (hookId !== undefined) {
    state.currentHookFilter = hookId;
  }
  const params = new URLSearchParams();
  params.set('limit', '100');
  if (state.currentHookFilter) params.set('hook_id', state.currentHookFilter);
  if (state.filterStatus) params.set('status', state.filterStatus);
  if (state.searchQuery) params.set('search', state.searchQuery);

  const logs = await api.get(`/api/logs?${params.toString()}`);
  state.logs = logs || [];
  document.getElementById('logs-list').innerHTML = renderLogsTable(state.logs);
  checkRunningAndAutoRefresh();
}

function renderLogsTable(logs) {
  if (!logs || !logs.length) return '<div class="loading-state">No execution logs found.</div>';
  return `<table class="logs-table">
    <thead><tr>
      <th>ID</th><th>Status</th><th>Hook</th><th>Script</th>
      <th>Duration</th><th>Exit</th><th>Triggered</th><th>IP</th><th></th>
    </tr></thead>
    <tbody>
      ${logs.map(l => `
        <tr id="log-row-${l.id}">
          <td><span class="badge-id" title="Copy Log ID" onclick="copyText('${l.id}', 'Log ID #${l.id} copied!')">#${l.id}</span></td>
          <td><span class="log-status log-${l.status}">${l.status}</span></td>
          <td>${escHtml(l.hook_name || '—')}</td>
          <td>${escHtml(l.script_name || '—')}</td>
          <td class="log-code">${l.duration_ms ? l.duration_ms + 'ms' : (l.status === 'running' ? 'running...' : '—')}</td>
          <td class="log-code">${l.exit_code !== null && l.exit_code !== undefined ? l.exit_code : '—'}</td>
          <td class="log-code">${formatDate(l.created_at)}</td>
          <td class="log-code" style="color:var(--text-muted)">${escHtml(l.trigger_ip || '—')}</td>
          <td>
            <div class="log-actions-cell">
              <button class="log-expand-btn" title="View output" onclick="toggleLogOutput(${l.id})">
                <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
              </button>
              <button class="copy-btn" title="Delete log" onclick="deleteLogItem(${l.id})" style="color:var(--danger)">
                <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
              </button>
            </div>
          </td>
        </tr>
        <tr id="log-out-${l.id}" class="log-output-row" style="display:none">
          <td colspan="9">
            ${l.payload ? `
              <div class="log-output-box">
                <div class="log-output-header">
                  <span>Payload / Request Body</span>
                  <button class="copy-btn" title="Copy payload" onclick="copyLogPayload(${l.id})">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg>
                  </button>
                </div>
                <div class="log-output-content">${escHtml(l.payload)}</div>
              </div>` : ''}
            ${l.stdout ? `
              <div class="log-output-box">
                <div class="log-output-header">
                  <span>Standard Output (stdout)</span>
                  <button class="copy-btn" title="Copy stdout" onclick="copyLogStdout(${l.id})">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg>
                  </button>
                </div>
                <div class="log-output-content">${escHtml(l.stdout)}</div>
              </div>` : ''}
            ${l.stderr ? `
              <div class="log-output-box box-error">
                <div class="log-output-header" style="color:var(--danger)">
                  <span>Error Output (stderr)</span>
                  <button class="copy-btn" title="Copy stderr" onclick="copyLogStderr(${l.id})">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg>
                  </button>
                </div>
                <div class="log-output-content">${escHtml(l.stderr)}</div>
              </div>` : ''}
            ${!l.stdout && !l.stderr && !l.payload ? `<div class="log-output-box"><div class="log-output-content" style="color:var(--text-muted)">${l.status === 'running' ? 'Execution is currently in progress...' : 'No output produced.'}</div></div>` : ''}
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

function toggleLogOutput(id) {
  const row = document.getElementById(`log-out-${id}`);
  if (row) row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}

async function deleteLogItem(id) {
  if (!confirm(`Delete log #${id}?`)) return;
  try {
    await api.delete(`/api/logs/${id}`);
    toast('Log deleted', 'success');
    await loadLogs();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function clearAllLogs() {
  if (!confirm('Are you sure you want to delete ALL execution logs? This cannot be undone.')) return;
  try {
    await api.delete('/api/logs');
    toast('All execution logs cleared', 'success');
    await loadLogs();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function checkRunningAndAutoRefresh() {
  const hasRunning = state.logs.some(l => l.status === 'running');
  if (hasRunning) {
    if (pollTimeout) clearTimeout(pollTimeout);
    pollTimeout = setTimeout(() => {
      if (state.currentPage === 'logs') loadLogs();
      else if (state.currentPage === 'dashboard') loadDashboard();
    }, 2000);
  }
}

function toggleAutoRefresh() {
  state.isAutoRefresh = !state.isAutoRefresh;
  const ind = document.getElementById('auto-refresh-indicator');
  const txt = document.getElementById('auto-refresh-text');
  if (state.isAutoRefresh) {
    ind.classList.add('active');
    txt.textContent = 'Auto-Refresh: ON';
    state.autoRefreshInterval = setInterval(() => {
      if (state.currentPage === 'logs') loadLogs();
      else if (state.currentPage === 'dashboard') loadDashboard();
    }, 3000);
    toast('Auto-refresh enabled', 'info');
  } else {
    ind.classList.remove('active');
    txt.textContent = 'Auto-Refresh: OFF';
    clearInterval(state.autoRefreshInterval);
    state.autoRefreshInterval = null;
    toast('Auto-refresh disabled', 'info');
  }
}

document.getElementById('refresh-logs-btn').addEventListener('click', () => loadLogs());
document.getElementById('auto-refresh-btn').addEventListener('click', toggleAutoRefresh);
document.getElementById('clear-logs-btn').addEventListener('click', clearAllLogs);

document.getElementById('logs-filter-status').addEventListener('change', (e) => {
  state.filterStatus = e.target.value;
  loadLogs();
});

let searchDebounce = null;
document.getElementById('logs-search').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.searchQuery = e.target.value.trim();
    loadLogs();
  }, 300);
});

// ─── Settings ────────────────────────────────────────────────────────────────
async function loadSettings() {
  const cfg = await api.get('/api/config');
  const form = document.getElementById('settings-form');
  form.innerHTML = `
    <form id="config-form">
      ${Object.entries(cfg).map(([k, v]) => `
        <div class="form-group">
          <label for="cfg-${k}">${escHtml(k.replace(/_/g, ' '))}</label>
          <input id="cfg-${k}" type="text" value="${escHtml(v)}" data-key="${k}" />
        </div>`).join('')}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Save Settings</button>
      </div>
    </form>
  `;
  document.getElementById('config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const updates = {};
    form.querySelectorAll('input[data-key]').forEach(inp => { updates[inp.dataset.key] = inp.value; });
    try { await api.put('/api/config', updates); toast('Settings saved', 'success'); }
    catch (err) { toast(err.message, 'error'); }
  });
}

// ─── Modal ───────────────────────────────────────────────────────────────────
function openModal(title, body) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

// ─── Nav click handlers ───────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', (e) => { e.preventDefault(); navigateTo(el.dataset.page); });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function copyText(text, label = 'Copied!') {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => toast(label, 'success')).catch(() => toast('Copy failed', 'error'));
}
function copyHookUrl(token) {
  const url = `${window.location.origin}/webhook/${token}`;
  copyText(url, 'Webhook URL copied!');
}
function copyCurlCmd(token) {
  const url = `${window.location.origin}/webhook/${token}`;
  copyText(`curl -X POST ${url}`, 'cURL command copied!');
}
function copyScriptContent(id) {
  const s = state.scripts.find(x => x.id === id);
  if (s) copyText(s.content, 'Script code copied!');
}
function copyLogPayload(id) {
  const l = state.logs.find(x => x.id === id);
  if (l) copyText(l.payload, 'Payload copied!');
}
function copyLogStdout(id) {
  const l = state.logs.find(x => x.id === id);
  if (l) copyText(l.stdout, 'Stdout copied!');
}
function copyLogStderr(id) {
  const l = state.logs.find(x => x.id === id);
  if (l) copyText(l.stderr, 'Stderr copied!');
}
function formatDate(dateStr) {
  if (!dateStr) return '—';
  try { return new Date(dateStr).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); }
  catch { return dateStr; }
}

// ─── Boot ────────────────────────────────────────────────────────────────────
checkAuth();
