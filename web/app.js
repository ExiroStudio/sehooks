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
  environments: [],
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
    if (page === 'envs') await loadEnvironments();
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
  const [hooks, scripts, envs, logs] = await Promise.all([
    api.get('/api/hooks'), api.get('/api/scripts'), api.get('/api/environments'), api.get('/api/logs?limit=10')
  ]);
  state.hooks = hooks || [];
  state.scripts = scripts || [];
  state.environments = envs || [];
  state.logs = logs || [];
  document.getElementById('stat-hooks').textContent = state.hooks.length;
  document.getElementById('stat-scripts').textContent = state.scripts.length;
  const envStat = document.getElementById('stat-envs');
  if (envStat) envStat.textContent = state.environments.length;
  const success = state.logs.filter(l => l.status === 'success').length;
  const failed = state.logs.filter(l => l.status === 'failed' || l.status === 'timeout' || l.status === 'interrupted').length;
  document.getElementById('stat-success').textContent = success;
  document.getElementById('stat-failed').textContent = failed;
  document.getElementById('dashboard-logs').innerHTML = renderLogsTable(state.logs.slice(0, 8));
  checkRunningAndAutoRefresh();
}

// ─── Hooks ───────────────────────────────────────────────────────────────────
async function loadHooks() {
  const [hooks, scripts, envs] = await Promise.all([
    api.get('/api/hooks'), api.get('/api/scripts'), api.get('/api/environments')
  ]);
  state.hooks = hooks || [];
  state.scripts = scripts || [];
  state.environments = envs || [];
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
          <span class="badge-id" title="Click to copy ID" onclick="copyText('${h.id}', 'Hook ID #${h.id} copied!', this)">#${h.id}</span>
          ${escHtml(h.name)}
        </div>
        <span class="badge ${h.enabled ? 'badge-success' : 'badge-muted'}">${h.enabled ? '● Active' : '○ Disabled'}</span>
      </div>
      <div class="card-desc">${escHtml(h.description || 'No description')}</div>
      <div class="card-meta">
        <span class="badge badge-accent">/${escHtml(h.slug)}</span>
        ${h.script_name ? `<span class="badge badge-muted">📄 ${escHtml(h.script_name)}</span>` : `<span class="badge badge-warning">⚠ No script</span>`}
        ${h.env_name ? `<span class="badge badge-success">🔐 ${escHtml(h.env_name)}</span>` : ''}
      </div>
      <div class="token-box" title="Click to copy Webhook URL" onclick="copyHookUrl('${escHtml(h.secret_token)}', this)">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">/webhook/${escHtml(h.secret_token)}</span>
        <div class="token-actions" onclick="event.stopPropagation()">
          <button class="copy-btn" title="Copy full Webhook URL" onclick="copyHookUrl('${escHtml(h.secret_token)}', this)">
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M12.232 4.232a2.5 2.5 0 013.536 3.536l-1.225 1.224a.75.75 0 001.061 1.06l1.224-1.224a4 4 0 00-5.656-5.656l-3 3a4 4 0 00.225 5.865.75.75 0 00.977-1.138 2.5 2.5 0 01-.142-3.667l3-3z"/><path d="M11.603 7.963a.75.75 0 00-.977 1.138 2.5 2.5 0 01.142 3.667l-3 3a2.5 2.5 0 01-3.536-3.536l1.225-1.224a.75.75 0 00-1.061-1.06l-1.224 1.224a4 4 0 105.656 5.656l3-3a4 4 0 00-.225-5.865z"/></svg>
          </button>
          <button class="copy-btn" title="Copy cURL command" onclick="copyCurlCmd('${escHtml(h.secret_token)}', this)">
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 3.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 12 5.293 9.707a1 1 0 010-1.414zM11 13a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>
          </button>
          <button class="copy-btn" title="Copy Secret Token" onclick="copyText('${escHtml(h.secret_token)}', 'Secret Token copied!', this)">
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
  const envOptions = state.environments.map(e => `<option value="${e.id}" ${hook?.env_id == e.id ? 'selected' : ''}>${escHtml(e.name)} (${e.variables?.length || 0} vars)</option>`).join('');
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
        <label for="hk-env">Environment Profile (Optional)</label>
        <select id="hk-env"><option value="">— None (Inherit from script) —</option>${envOptions}</select>
        <div class="hint">Overrides the script's default environment profile if set.</div>
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
    const envVal = document.getElementById('hk-env').value;
    const payload = {
      name: document.getElementById('hk-name').value,
      slug: document.getElementById('hk-slug').value || undefined,
      script_id: scriptVal ? parseInt(scriptVal) : null,
      env_id: envVal ? parseInt(envVal) : null,
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
  const [scripts, envs] = await Promise.all([
    api.get('/api/scripts'), api.get('/api/environments')
  ]);
  state.scripts = scripts || [];
  state.environments = envs || [];
  renderScripts();
}

function renderScripts() {
  const el = document.getElementById('scripts-list');
  if (!state.scripts.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <h3>No scripts yet</h3><p>Create a shell script or Docker Compose project to link to a hook</p>
      <button class="btn btn-primary" onclick="openScriptModal()">Create Script</button>
    </div>`; return;
  }
  el.innerHTML = state.scripts.map(s => {
    const isCompose = s.script_type === 'docker_compose';
    const filesCount = s.files ? s.files.length : 0;
    return `
    <div class="script-card">
      <div class="card-header-row">
        <div class="card-title">
          <span class="badge-id" title="Click to copy ID" onclick="copyText('${s.id}', 'Script ID #${s.id} copied!', this)">#${s.id}</span>
          ${isCompose ? '🐳' : '📄'} ${escHtml(s.name)}
        </div>
      </div>
      <div class="card-desc">${escHtml(s.description || 'No description')}</div>
      <div class="card-meta">
        ${isCompose ? `<span class="badge badge-compose">🐳 Compose</span>` : `<span class="badge badge-muted">🐧 Bash</span>`}
        ${filesCount > 0 ? `<span class="badge badge-muted" title="${s.files.map(f => escHtml(f.path)).join(', ')}">📎 ${filesCount} file${filesCount > 1 ? 's' : ''}</span>` : ''}
        <span class="badge badge-muted">⏱ ${s.timeout_seconds}s timeout</span>
        <span class="badge badge-muted">📁 ${escHtml(s.working_dir)}</span>
        ${s.env_name ? `<span class="badge badge-success">🔐 ${escHtml(s.env_name)}</span>` : ''}
      </div>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" onclick="runScriptNow(${s.id}, '${escHtml(s.name)}')">▶ Run</button>
        <button class="btn btn-ghost btn-sm" onclick="copyScriptContent(${s.id}, this)">📋 Copy</button>
        <button class="btn btn-ghost btn-sm" onclick="openScriptModal(${s.id})">Edit</button>
        <button class="btn btn-danger btn-sm btn-icon-only" onclick="deleteScript(${s.id})" title="Delete">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

let modalScriptFiles = [];
let modalEditingFileIndex = -1;

function renderModalFiles() {
  const container = document.getElementById('files-list-container');
  if (!container) return;
  if (!modalScriptFiles.length) {
    container.innerHTML = `<div style="font-size:12px;color:var(--text-muted);font-style:italic;padding:4px 0">No additional files added yet.</div>`;
    return;
  }
  container.innerHTML = modalScriptFiles.map((f, i) => `
    <div class="file-row-item">
      <div class="file-row-path">
        <span>📄</span>
        <strong>${escHtml(f.path)}</strong>
        <span class="file-row-meta">(${f.content.length} chars)</span>
      </div>
      <div class="file-row-actions">
        <button type="button" class="btn btn-ghost btn-sm" onclick="editModalFile(${i})">Edit</button>
        <button type="button" class="btn btn-danger btn-sm" onclick="removeModalFile(${i})">Remove</button>
      </div>
    </div>
  `).join('');
}

function showAddFileForm(index = -1) {
  modalEditingFileIndex = index;
  const form = document.getElementById('add-file-form');
  const pathInput = document.getElementById('new-file-path');
  const contentInput = document.getElementById('new-file-content');
  if (index >= 0 && modalScriptFiles[index]) {
    pathInput.value = modalScriptFiles[index].path;
    contentInput.value = modalScriptFiles[index].content;
  } else {
    pathInput.value = '';
    contentInput.value = '';
  }
  form.classList.remove('hidden');
  pathInput.focus();
}

function hideAddFileForm() {
  const form = document.getElementById('add-file-form');
  if (form) form.classList.add('hidden');
  modalEditingFileIndex = -1;
}

function saveModalFile() {
  const pathInput = document.getElementById('new-file-path');
  const contentInput = document.getElementById('new-file-content');
  const path = (pathInput.value || '').trim();
  const content = contentInput.value || '';

  if (!path) {
    toast('File path / filename is required', 'error');
    return;
  }
  if (path.startsWith('/') || path.startsWith('\\') || path.includes('..')) {
    toast('File path must be relative without ".." traversal', 'error');
    return;
  }

  if (modalEditingFileIndex >= 0 && modalEditingFileIndex < modalScriptFiles.length) {
    modalScriptFiles[modalEditingFileIndex] = { path, content };
    toast(`File "${path}" updated`, 'success');
  } else {
    if (modalScriptFiles.some(f => f.path === path)) {
      toast(`File "${path}" already exists in this script`, 'error');
      return;
    }
    modalScriptFiles.push({ path, content });
    toast(`File "${path}" added`, 'success');
  }
  hideAddFileForm();
  renderModalFiles();
}

function editModalFile(index) {
  showAddFileForm(index);
}

function removeModalFile(index) {
  if (index >= 0 && index < modalScriptFiles.length) {
    const removed = modalScriptFiles.splice(index, 1);
    toast(`Removed ${removed[0]?.path}`, 'info');
    renderModalFiles();
  }
}

function setScriptType(type) {
  const typeInput = document.getElementById('sc-type');
  if (typeInput) typeInput.value = type;

  const btnBash = document.getElementById('btn-type-bash');
  const btnCompose = document.getElementById('btn-type-compose');
  if (btnBash && btnCompose) {
    if (type === 'docker_compose') {
      btnCompose.classList.add('active');
      btnBash.classList.remove('active');
    } else {
      btnBash.classList.add('active');
      btnCompose.classList.remove('active');
    }
  }

  const label = document.getElementById('sc-content-label');
  const hint = document.getElementById('sc-content-hint');
  const helperBtn = document.getElementById('sc-compose-helper-btn');
  const composeGroup = document.getElementById('sc-compose-cmd-group');

  if (type === 'docker_compose') {
    if (label) label.innerText = 'docker-compose.yml *';
    if (hint) hint.innerHTML = 'Docker Compose YAML format. Environment variables from your profile are automatically injected into working_dir/.env.';
    if (helperBtn) helperBtn.style.display = 'block';
    if (composeGroup) composeGroup.style.display = 'block';
  } else {
    if (label) label.innerText = 'Shell Script *';
    if (hint) hint.innerHTML = 'bash is used. <code>seh_import_env [path]</code> helper is automatically available to import $SEH_ENV_FILE into .env.';
    if (helperBtn) helperBtn.style.display = 'none';
    if (composeGroup) composeGroup.style.display = 'none';
  }
}

function setComposeCmd(cmd) {
  const input = document.getElementById('sc-compose-cmd');
  if (input) input.value = cmd;
}

function insertSampleCompose() {
  const content = document.getElementById('sc-content');
  if (!content) return;
  const sample = `services:
  web:
    image: nginx:alpine
    ports:
      - "\${PORT:-80}:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    restart: unless-stopped`;
  if (content.value.trim() && !confirm('Replace current content with sample docker-compose.yml?')) {
    return;
  }
  content.value = sample;
  if (!modalScriptFiles.some(f => f.path === 'nginx.conf')) {
    modalScriptFiles.push({
      path: 'nginx.conf',
      content: `events { worker_connections 1024; }
http {
  server {
    listen 80;
    location / {
      return 200 "Hello from Docker Compose via SEHooks!\\n";
    }
  }
}`
    });
    renderModalFiles();
    toast('Added sample nginx.conf to Additional Files', 'info');
  }
}

function openScriptModal(id) {
  const s = id ? state.scripts.find(x => x.id === id) : null;
  const currentType = s?.script_type || 'bash';
  modalScriptFiles = (s?.files || []).map(f => ({ path: f.path, content: f.content }));

  const envOptions = state.environments.map(e => `<option value="${e.id}" ${s?.env_id == e.id ? 'selected' : ''}>${escHtml(e.name)} (${e.variables?.length || 0} vars)</option>`).join('');

  openModal(s ? 'Edit Script' : 'New Script', `
    <form id="script-form">
      <div class="form-group">
        <label for="sc-name">Name *</label>
        <input id="sc-name" type="text" placeholder="e.g. Deploy Web App" value="${escHtml(s?.name || '')}" required />
      </div>
      <div class="form-group">
        <label for="sc-desc">Description</label>
        <input id="sc-desc" type="text" placeholder="What does this script do?" value="${escHtml(s?.description || '')}" />
      </div>

      <div class="form-group">
        <label>Execution Method *</label>
        <div class="segmented-control">
          <button type="button" id="btn-type-bash" class="segment-btn ${currentType === 'bash' ? 'active' : ''}" onclick="setScriptType('bash')">
            🐧 Bash Script
          </button>
          <button type="button" id="btn-type-compose" class="segment-btn ${currentType === 'docker_compose' ? 'active' : ''}" onclick="setScriptType('docker_compose')">
            🐳 Docker Compose
          </button>
        </div>
        <input type="hidden" id="sc-type" value="${currentType}" />
      </div>

      <div class="form-group">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <label id="sc-content-label" for="sc-content" style="margin:0">${currentType === 'docker_compose' ? 'docker-compose.yml *' : 'Shell Script *'}</label>
          <div id="sc-compose-helper-btn" style="${currentType === 'docker_compose' ? '' : 'display:none'}">
            <button type="button" class="btn btn-ghost btn-sm" onclick="insertSampleCompose()">📄 Insert Template</button>
          </div>
        </div>
        <textarea id="sc-content" class="raw-env-textarea" placeholder="${currentType === 'docker_compose' ? 'services:\n  app:\n    image: nginx:alpine' : '#!/bin/bash\necho \'Hello from hook!\''}">${escHtml(s?.content || '')}</textarea>
        <div id="sc-content-hint" class="hint">${currentType === 'docker_compose' ? 'Docker Compose YAML format. Environment variables from your profile are automatically injected into working_dir/.env.' : 'bash is used. <code>seh_import_env [path]</code> helper is automatically available to import $SEH_ENV_FILE into .env.'}</div>
      </div>

      <div id="sc-compose-cmd-group" class="form-group" style="${currentType === 'docker_compose' ? '' : 'display:none'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <label for="sc-compose-cmd" style="margin:0">Compose Command *</label>
          <div class="quick-presets">
            <button type="button" class="btn-preset" onclick="setComposeCmd('docker compose up -d --build --remove-orphans')">Build & Up</button>
            <button type="button" class="btn-preset" onclick="setComposeCmd('docker compose pull && docker compose up -d --remove-orphans')">Pull & Up</button>
            <button type="button" class="btn-preset" onclick="setComposeCmd('docker compose restart')">Restart</button>
            <button type="button" class="btn-preset" onclick="setComposeCmd('docker compose down')">Down</button>
          </div>
        </div>
        <textarea id="sc-compose-cmd" style="min-height:54px;font-family:var(--mono);font-size:12.5px" placeholder="docker compose up -d --build --remove-orphans">${escHtml(s?.compose_cmd || 'docker compose up -d --build --remove-orphans')}</textarea>
        <div class="hint">Custom compose commands to execute. Multi-line bash commands are supported.</div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="sc-timeout">Timeout (seconds)</label>
          <input id="sc-timeout" type="number" min="1" max="3600" value="${s?.timeout_seconds || 30}" />
        </div>
        <div class="form-group">
          <label for="sc-workdir">Working Directory</label>
          <input id="sc-workdir" type="text" placeholder="/tmp" value="${escHtml(s?.working_dir || '/tmp')}" />
          <div class="hint" style="font-size:11px">Files and compose projects will be placed here.</div>
        </div>
      </div>

      <div class="form-group" style="border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; background: rgba(255,255,255,0.015);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div>
            <label style="margin:0;font-weight:600">📎 Additional Files</label>
            <div style="font-size:11.5px;color:var(--text-secondary)">Extra config files deployed to working directory (e.g. <code>nginx.conf</code>, <code>Dockerfile</code>, <code>conf.d/app.conf</code>)</div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" onclick="showAddFileForm()">+ Add File</button>
        </div>

        <div id="add-file-form" class="hidden" style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin-bottom:12px;">
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <input type="text" id="new-file-path" placeholder="Relative path (e.g. nginx.conf or conf.d/default.conf)" style="font-family:var(--mono);font-size:12px;flex:1;" />
            <button type="button" class="btn btn-primary btn-sm" onclick="saveModalFile()">Done</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="hideAddFileForm()">Cancel</button>
          </div>
          <textarea id="new-file-content" class="raw-env-textarea" style="min-height:120px;font-size:12px" placeholder="# Enter file content here..."></textarea>
        </div>

        <div id="files-list-container"></div>
      </div>

      <div class="form-group">
        <label for="sc-env-profile">Environment Profile (Optional)</label>
        <select id="sc-env-profile"><option value="">— None —</option>${envOptions}</select>
        <div class="hint">Select an environment profile to inject variables into execution & $SEH_ENV_FILE / .env.</div>
      </div>
      <div class="form-group">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <label for="sc-env" style="margin:0">Script-Specific Env Vars (JSON)</label>
          <button type="button" class="btn btn-ghost btn-sm" onclick="promptImportEnvToScriptJson()">📥 Import .env to JSON</button>
        </div>
        <input id="sc-env" type="text" placeholder='{"MY_VAR": "value"}' value="${escHtml(s?.env_vars || '{}')}" />
        <div class="hint">Keys must be alphanumeric + underscore only. Overrides profile variables.</div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">${s ? 'Save Changes' : 'Create Script'}</button>
      </div>
    </form>
  `);

  renderModalFiles();

  const contentEl = document.getElementById('sc-content');
  if (contentEl) {
    contentEl.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if ((val.startsWith('services:') || val.startsWith('version:')) && document.getElementById('sc-type').value !== 'docker_compose') {
        setScriptType('docker_compose');
      }
    });
  }

  document.getElementById('script-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const envProfileVal = document.getElementById('sc-env-profile').value;
    let scriptType = document.getElementById('sc-type').value;
    const contentVal = (document.getElementById('sc-content').value || '').trim();
    if (scriptType !== 'docker_compose' && (contentVal.startsWith('services:') || contentVal.startsWith('version:'))) {
      scriptType = 'docker_compose';
    }

    const payload = {
      name: document.getElementById('sc-name').value,
      description: document.getElementById('sc-desc').value,
      script_type: scriptType,
      content: document.getElementById('sc-content').value,
      compose_cmd: document.getElementById('sc-compose-cmd')?.value || '',
      timeout_seconds: parseInt(document.getElementById('sc-timeout').value) || 30,
      working_dir: document.getElementById('sc-workdir').value || '/tmp',
      env_vars: document.getElementById('sc-env').value || '{}',
      env_id: envProfileVal ? parseInt(envProfileVal) : null,
      files: modalScriptFiles,
    };
    try {
      if (s) await api.put(`/api/scripts/${s.id}`, payload);
      else await api.post('/api/scripts', payload);
      closeModal(); toast(s ? 'Script updated' : 'Script created', 'success');
      await loadScripts();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function promptImportEnvToScriptJson() {
  const raw = prompt('Paste your .env content to convert to JSON:');
  if (!raw) return;
  const items = parseDotEnv(raw);
  const obj = {};
  items.forEach(it => { obj[it.key] = it.value; });
  document.getElementById('sc-env').value = JSON.stringify(obj);
  toast(`Parsed ${items.length} variables into JSON`, 'success');
}

// ─── Environments ────────────────────────────────────────────────────────────
async function loadEnvironments() {
  const envs = await api.get('/api/environments');
  state.environments = envs || [];
  renderEnvironments();
}

function renderEnvironments() {
  const el = document.getElementById('envs-list');
  if (!el) return;
  if (!state.environments.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <h3>No environments yet</h3><p>Create an environment profile to store variables & secrets</p>
      <button class="btn btn-primary" onclick="openEnvModal()">Create Environment</button>
    </div>`; return;
  }
  el.innerHTML = state.environments.map(e => {
    const vars = e.variables || [];
    const secretCount = vars.filter(v => v.is_secret).length;
    const pills = vars.slice(0, 8).map(v => `
      <span class="var-pill ${v.is_secret ? 'is-secret' : ''}" title="${v.is_secret ? 'Secret variable (encrypted)' : 'Standard variable'}">
        ${v.is_secret ? '🔒 ' : ''}${escHtml(v.key)}
      </span>
    `).join('');
    const morePills = vars.length > 8 ? `<span class="var-pill">+${vars.length - 8} more</span>` : '';

    return `
    <div class="env-card" id="env-card-${e.id}">
      <div class="card-header-row">
        <div class="card-title">
          <span class="badge-id" title="Click to copy ID" onclick="copyText('${e.id}', 'Env ID #${e.id} copied!', this)">#${e.id}</span>
          🔐 ${escHtml(e.name)}
        </div>
        <span class="badge badge-accent">${vars.length} vars${secretCount ? ` (${secretCount} secret)` : ''}</span>
      </div>
      <div class="card-desc">${escHtml(e.description || 'No description')}</div>
      <div class="var-pills">
        ${pills || '<span style="color:var(--text-muted);font-size:12px">No variables defined</span>'}
        ${morePills}
      </div>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" onclick="openEnvModal(${e.id})">Edit Variables</button>
        <button class="btn btn-ghost btn-sm" onclick="exportEnvModal(${e.id})">📋 View .env</button>
        <button class="btn btn-danger btn-sm btn-icon-only" onclick="deleteEnv(${e.id})" title="Delete">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

function openEnvModal(id) {
  const env = id ? state.environments.find(x => x.id === id) : null;
  const initialVars = env?.variables && env.variables.length ? env.variables : [{ key: '', value: '', is_secret: false }];

  openModal(env ? 'Edit Environment' : 'New Environment', `
    <form id="env-form">
      <div class="form-group">
        <label for="env-name">Environment Name *</label>
        <input id="env-name" type="text" placeholder="e.g. Backend Production" value="${escHtml(env?.name || '')}" required />
      </div>
      <div class="form-group">
        <label for="env-desc">Description</label>
        <input id="env-desc" type="text" placeholder="What is this environment used for?" value="${escHtml(env?.description || '')}" />
      </div>

      <div class="section-header" style="margin-top:20px;margin-bottom:8px">
        <label style="margin:0;font-size:13px;font-weight:600">Environment Variables</label>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn btn-ghost btn-sm" onclick="showImportEnvTextarea()">📥 Import .env</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="addEnvRow()">+ Add Variable</button>
        </div>
      </div>

      <!-- Import .env textarea toggle (initially hidden) -->
      <div id="env-import-box" class="hidden" style="margin-bottom:14px;background:var(--bg-elevated);padding:12px;border-radius:var(--radius-sm);border:1px solid var(--border)">
        <label style="margin-bottom:4px;font-size:12px">Paste .env file contents:</label>
        <textarea id="env-import-text" class="raw-env-textarea" placeholder="PORT=8080&#10;DATABASE_URL=postgres://user:pass@localhost:5432/db&#10;JWT_SECRET=supersecret"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
          <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('env-import-box').classList.add('hidden')">Cancel</button>
          <button type="button" class="btn btn-primary btn-sm" onclick="applyImportEnvText()">Parse & Add</button>
        </div>
      </div>

      <table class="kv-table">
        <thead>
          <tr>
            <th style="width:35%">Key</th>
            <th style="width:45%">Value</th>
            <th style="width:15%">Secret?</th>
            <th style="width:5%"></th>
          </tr>
        </thead>
        <tbody id="env-table-body">
          ${initialVars.map((v, idx) => renderEnvRowHtml(v.key, v.value, v.is_secret, idx)).join('')}
        </tbody>
      </table>

      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">${env ? 'Save Changes' : 'Create Environment'}</button>
      </div>
    </form>
  `);

  document.getElementById('env-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rows = document.querySelectorAll('#env-table-body tr.kv-row');
    const variables = [];
    for (const row of rows) {
      const key = row.querySelector('.kv-key').value.trim();
      const value = row.querySelector('.kv-val').value;
      const is_secret = row.querySelector('.kv-secret').checked;
      if (key) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
          toast(`Invalid variable key: "${key}". Must use letters, numbers, and underscore only.`, 'error');
          return;
        }
        variables.push({ key, value, is_secret });
      }
    }

    const payload = {
      name: document.getElementById('env-name').value.trim(),
      description: document.getElementById('env-desc').value.trim(),
      variables,
    };

    try {
      if (env) await api.put(`/api/environments/${env.id}`, payload);
      else await api.post('/api/environments', payload);
      closeModal();
      toast(env ? 'Environment updated' : 'Environment created', 'success');
      await loadEnvironments();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function renderEnvRowHtml(key = '', val = '', isSecret = false, idx = 0) {
  return `
    <tr class="kv-row" id="kv-row-${idx}">
      <td>
        <input type="text" class="kv-key" placeholder="e.g. PORT" value="${escHtml(key)}" required />
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:4px">
          <input type="${isSecret ? 'password' : 'text'}" class="kv-val" placeholder="value" value="${escHtml(val)}" />
          <button type="button" class="secret-toggle-btn" title="Toggle visibility" onclick="togglePasswordVisibility(this)">
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>
          </button>
        </div>
      </td>
      <td style="text-align:center">
        <label class="secret-check-label">
          <input type="checkbox" class="kv-secret" ${isSecret ? 'checked' : ''} onchange="onSecretCheckboxChange(this)" />
          <span>Lock</span>
        </label>
      </td>
      <td>
        <button type="button" class="copy-btn" title="Delete variable" onclick="this.closest('tr').remove()" style="color:var(--danger)">
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        </button>
      </td>
    </tr>
  `;
}

function addEnvRow(key = '', val = '', isSecret = false) {
  const tbody = document.getElementById('env-table-body');
  if (!tbody) return;
  const idx = Date.now() + Math.floor(Math.random() * 1000);
  const temp = document.createElement('tbody');
  temp.innerHTML = renderEnvRowHtml(key, val, isSecret, idx);
  tbody.appendChild(temp.firstElementChild);
}

function togglePasswordVisibility(btn) {
  const input = btn.previousElementSibling;
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function onSecretCheckboxChange(chk) {
  const valInput = chk.closest('tr').querySelector('.kv-val');
  if (valInput) {
    valInput.type = chk.checked ? 'password' : 'text';
  }
}

function showImportEnvTextarea() {
  const box = document.getElementById('env-import-box');
  if (box) box.classList.toggle('hidden');
}

function applyImportEnvText() {
  const text = document.getElementById('env-import-text').value;
  if (!text.trim()) return;
  const items = parseDotEnv(text);
  if (!items.length) {
    toast('No valid variables found in pasted content', 'error');
    return;
  }
  for (const item of items) {
    addEnvRow(item.key, item.value, item.is_secret);
  }
  document.getElementById('env-import-text').value = '';
  document.getElementById('env-import-box').classList.add('hidden');
  toast(`Imported ${items.length} variables into form`, 'success');
}

function exportEnvModal(id) {
  const env = state.environments.find(x => x.id === id);
  if (!env) return;
  const content = formatDotEnv(env.variables || []);
  openModal(`Export: ${env.name} (.env)`, `
    <div>
      <p style="color:var(--text-secondary);margin-bottom:12px;font-size:13px">
        Standard <code>.env</code> file format. You can copy this or let SEHooks auto-import via <code>seh_import_env</code> during deployment.
      </p>
      <textarea id="export-env-text" class="raw-env-textarea" readonly style="width:100%">${escHtml(content)}</textarea>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Close</button>
        <button type="button" class="btn btn-primary" onclick="copyText(document.getElementById('export-env-text').value, 'Environment file copied to clipboard!', this)">📋 Copy .env Content</button>
      </div>
    </div>
  `);
}

async function deleteEnv(id) {
  if (!confirm('Delete this environment? Any scripts using it will no longer receive these variables.')) return;
  try {
    await api.delete(`/api/environments/${id}`);
    toast('Environment deleted', 'success');
    await loadEnvironments();
  } catch (err) { toast(err.message, 'error'); }
}

document.getElementById('new-env-btn')?.addEventListener('click', () => openEnvModal());

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
async function copyText(text, label = 'Copied!', btn = null) {
  if (!text) return;
  let ok = false;

  // 1. Try modern clipboard API if in secure context
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (_) {
      ok = false;
    }
  }

  // 2. Fallback to hidden textarea with execCommand (supports HTTP remote VPS & all browsers)
  if (!ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (_) {
      ok = false;
    }
  }

  if (ok) {
    toast(label, 'success');
    if (btn && btn.nodeType === Node.ELEMENT_NODE) {
      btn.classList.add('copied');
      const originalSvg = btn.innerHTML;
      btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>`;
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = originalSvg;
      }, 1500);
    }
  } else {
    toast('Gagal menyalin ke clipboard (Copy failed)', 'error');
  }
}

function copyHookUrl(token, btn = null) {
  const url = `${window.location.origin}/webhook/${token}`;
  copyText(url, 'Webhook URL copied!', btn);
}
function copyCurlCmd(token, btn = null) {
  const url = `${window.location.origin}/webhook/${token}`;
  copyText(`curl -X POST ${url}`, 'cURL command copied!', btn);
}
function copyScriptContent(id, btn = null) {
  const s = state.scripts.find(x => x.id === id);
  if (s) copyText(s.content, 'Script code copied!', btn);
}
function copyLogPayload(id, btn = null) {
  const l = state.logs.find(x => x.id === id);
  if (l) copyText(l.payload, 'Payload copied!', btn);
}
function copyLogStdout(id, btn = null) {
  const l = state.logs.find(x => x.id === id);
  if (l) copyText(l.stdout, 'Stdout copied!', btn);
}
function copyLogStderr(id, btn = null) {
  const l = state.logs.find(x => x.id === id);
  if (l) copyText(l.stderr, 'Stderr copied!', btn);
}

function parseDotEnv(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const items = [];
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.substring(7).trim();
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.substring(0, eqIdx).trim();
    let val = line.substring(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    val = val.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const isSecret = /SECRET|KEY|PASS|TOKEN|CREDENTIAL|PRIVATE|AUTH|DATABASE_URL/i.test(key);
    items.push({ key, value: val, is_secret: isSecret });
  }
  return items;
}

function formatDotEnv(items) {
  if (!items || !items.length) return '';
  return items.map(item => {
    const escaped = (item.value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return `${item.key}="${escaped}"`;
  }).join('\n');
}
function formatDate(dateStr) {
  if (!dateStr) return '—';
  try { return new Date(dateStr).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); }
  catch { return dateStr; }
}

// ─── Boot ────────────────────────────────────────────────────────────────────
checkAuth();
