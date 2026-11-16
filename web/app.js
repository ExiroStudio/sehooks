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
let modalActiveTab = 'main'; // 'main' or integer index
let modalMainContent = '';

// ─── YAML Formatter & Validator ──────────────────────────────────────────────
function formatYaml(yamlStr) {
  if (!yamlStr || !yamlStr.trim()) {
    return { ok: true, formatted: yamlStr, warning: null };
  }

  const lines = yamlStr.split('\n');
  const cleaned = lines.map(l => l.replace(/\t/g, '  ').replace(/\s+$/, ''));

  // Detect 4-space indent pattern
  const indents = [];
  cleaned.forEach(l => {
    const s = l.trim();
    if (!s || s.startsWith('#')) return;
    const leading = l.length - l.trimStart().length;
    if (leading > 0) indents.push(leading);
  });
  const isAllMultiplesOf4 = indents.length > 0 && indents.every(i => i % 4 === 0);

  const formattedLines = [];
  let inBlockScalar = false;
  let blockScalarIndent = 0;
  let syntaxWarning = null;

  for (let i = 0; i < cleaned.length; i++) {
    let line = cleaned[i];
    const stripped = line.trim();

    if (!stripped) {
      if (formattedLines.length && formattedLines[formattedLines.length - 1] !== '') {
        formattedLines.push('');
      }
      continue;
    }

    let leadingSpaces = line.length - line.trimStart().length;

    if (inBlockScalar) {
      if (leadingSpaces > blockScalarIndent) {
        formattedLines.push(line);
        continue;
      } else {
        inBlockScalar = false;
      }
    }

    if (/(\||>)[-+]?$/.test(stripped)) {
      inBlockScalar = true;
      blockScalarIndent = leadingSpaces;
    }

    if (isAllMultiplesOf4) {
      leadingSpaces = Math.floor(leadingSpaces / 4) * 2;
      line = ' '.repeat(leadingSpaces) + stripped;
    }

    // Format key: value (if missing space after colon and not a URL like :// or quote)
    const kvMatch = line.match(/^(\s*(?:-\s*)?[a-zA-Z0-9_\.\-]+):([^\s\n#].*)$/);
    if (kvMatch && !kvMatch[2].startsWith('//')) {
      line = `${kvMatch[1]}: ${kvMatch[2]}`;
    }

    // Format list item: -val -> - val
    const listMatch = line.match(/^(\s*)-([^\s\-\n].*)$/);
    if (listMatch) {
      line = `${listMatch[1]}- ${listMatch[2]}`;
    }

    const singleQuotes = (stripped.match(/'/g) || []).length;
    const doubleQuotes = (stripped.match(/"/g) || []).length;
    if ((singleQuotes % 2 !== 0 && !stripped.startsWith('#')) || (doubleQuotes % 2 !== 0 && !stripped.startsWith('#'))) {
      syntaxWarning = `Unbalanced quotes on line ${i + 1}`;
    }

    formattedLines.push(line);
  }

  const result = formattedLines.join('\n').trim() + '\n';
  return { ok: true, formatted: result, warning: syntaxWarning };
}

function validateYamlQuick(content) {
  if (!content || !content.trim()) return { valid: true };
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('\t')) {
      return { valid: false, error: `Tab character on line ${i + 1}` };
    }
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#')) continue;
    const sq = (stripped.match(/'/g) || []).length;
    const dq = (stripped.match(/"/g) || []).length;
    if (sq % 2 !== 0 || dq % 2 !== 0) {
      return { valid: false, error: `Unbalanced quotes on line ${i + 1}` };
    }
  }
  return { valid: true };
}

// ─── Additional Files & Independent Editor Logic ─────────────────────────────
function renderModalFiles() {
  const container = document.getElementById('files-list-container');
  if (!container) return;
  if (!modalScriptFiles.length) {
    container.innerHTML = `<div style="font-size:12px;color:var(--text-muted);font-style:italic;padding:4px 0">No additional files added yet.</div>`;
    return;
  }
  container.innerHTML = modalScriptFiles.map((f, i) => `
    <div class="file-row-item ${modalActiveTab === i ? 'active' : ''}">
      <div class="file-row-path" style="cursor:pointer" onclick="switchEditorTab(${i})" title="Open in editor">
        <span>📄</span>
        <strong>${escHtml(f.path)}</strong>
        <span class="file-row-meta">(${f.content.length} chars)</span>
      </div>
      <div class="file-row-actions">
        <button type="button" class="btn btn-ghost btn-sm" onclick="switchEditorTab(${i})" title="Open in spacious editor">Edit</button>
        <button type="button" class="btn btn-danger btn-sm" onclick="removeModalFile(${i})" title="Remove">Remove</button>
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
  if (form) form.classList.remove('hidden');
  if (pathInput) pathInput.focus();
}

function hideAddFileForm() {
  const form = document.getElementById('add-file-form');
  if (form) form.classList.add('hidden');
  modalEditingFileIndex = -1;
}

function saveModalFile() {
  const pathInput = document.getElementById('new-file-path');
  const contentInput = document.getElementById('new-file-content');
  const path = (pathInput?.value || '').trim();
  const content = contentInput?.value || '';

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
    switchEditorTab(modalEditingFileIndex);
  } else {
    const existingIdx = modalScriptFiles.findIndex(f => f.path === path);
    if (existingIdx !== -1) {
      modalScriptFiles[existingIdx] = { path, content };
      toast(`File "${path}" updated with new content`, 'success');
      switchEditorTab(existingIdx);
    } else {
      modalScriptFiles.push({ path, content });
      toast(`File "${path}" added`, 'success');
      switchEditorTab(modalScriptFiles.length - 1);
    }
  }
  hideAddFileForm();
  renderModalFiles();
  renderEditorTabs();
}

function editModalFile(index) {
  switchEditorTab(index);
}

function removeModalFile(index) {
  if (index >= 0 && index < modalScriptFiles.length) {
    const removed = modalScriptFiles.splice(index, 1);
    toast(`Removed ${removed[0]?.path}`, 'info');
    if (modalActiveTab === index) {
      modalActiveTab = 'main';
    } else if (typeof modalActiveTab === 'number' && modalActiveTab > index) {
      modalActiveTab--;
    }
    renderModalFiles();
    renderEditorTabs();
    switchEditorTab(modalActiveTab);
  }
}

function setEditorViewMode(mode) {
  const form = document.getElementById('script-form');
  if (!form) return;
  form.classList.remove('view-mode-split', 'view-mode-editor', 'view-mode-settings');
  form.classList.add(`view-mode-${mode}`);

  document.querySelectorAll('.btn-view-mode').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`btn-mode-${mode}`);
  if (activeBtn) activeBtn.classList.add('active');

  const expandBtn = document.getElementById('btn-editor-expand');
  if (expandBtn) {
    expandBtn.title = mode === 'editor' ? 'Restore Split View' : 'Maximize Editor';
  }
}

function toggleEditorMaximize() {
  const form = document.getElementById('script-form');
  if (!form) return;
  if (form.classList.contains('view-mode-editor')) {
    setEditorViewMode('split');
  } else {
    setEditorViewMode('editor');
  }
}

function syncCurrentEditorToState() {
  const textarea = document.getElementById('sc-content');
  if (!textarea) return;
  if (modalActiveTab === 'main') {
    modalMainContent = textarea.value;
  } else if (typeof modalActiveTab === 'number' && modalScriptFiles[modalActiveTab]) {
    modalScriptFiles[modalActiveTab].content = textarea.value;
  }
}

function switchEditorTab(target) {
  syncCurrentEditorToState();
  modalActiveTab = target;
  const textarea = document.getElementById('sc-content');
  if (textarea) {
    if (target === 'main') {
      textarea.value = modalMainContent;
      const isCompose = document.getElementById('sc-type')?.value === 'docker_compose';
      textarea.placeholder = isCompose
        ? 'services:\n  app:\n    image: nginx:alpine'
        : '#!/bin/bash\necho "Hello from hook!"';
    } else if (typeof target === 'number' && modalScriptFiles[target]) {
      textarea.value = modalScriptFiles[target].content;
      textarea.placeholder = `# Content of ${modalScriptFiles[target].path}...`;
    }
  }
  renderEditorTabs();
  renderModalFiles();
  updateEditorLineNumbers();
  updateEditorStatus();
}

function closeEditorTab(index) {
  if (index >= 0 && index < modalScriptFiles.length) {
    const filename = modalScriptFiles[index].path;
    if (!confirm(`Remove "${filename}" from additional files?`)) return;
    modalScriptFiles.splice(index, 1);
    toast(`Removed ${filename}`, 'info');
    if (modalActiveTab === index) {
      modalActiveTab = 'main';
    } else if (typeof modalActiveTab === 'number' && modalActiveTab > index) {
      modalActiveTab--;
    }
    renderModalFiles();
    renderEditorTabs();
    switchEditorTab(modalActiveTab);
  }
}

function renderEditorTabs() {
  const container = document.getElementById('editor-tabs-container');
  if (!container) return;

  const scriptType = document.getElementById('sc-type')?.value || 'bash';
  const isCompose = scriptType === 'docker_compose';
  const mainTabName = isCompose ? '🐳 docker-compose.yml' : '🐧 Shell Script';

  let html = `
    <button type="button" class="editor-tab ${modalActiveTab === 'main' ? 'active' : ''}" onclick="switchEditorTab('main')">
      ${mainTabName}
    </button>
  `;

  modalScriptFiles.forEach((f, i) => {
    const isYaml = f.path.endsWith('.yml') || f.path.endsWith('.yaml');
    const icon = isYaml ? '🐳' : '📄';
    html += `
      <button type="button" class="editor-tab ${modalActiveTab === i ? 'active' : ''}" onclick="switchEditorTab(${i})" title="${escHtml(f.path)}">
        <span>${icon} ${escHtml(f.path)}</span>
        <span class="editor-tab-close" onclick="event.stopPropagation(); closeEditorTab(${i})" title="Remove file">✕</span>
      </button>
    `;
  });

  html += `
    <button type="button" class="editor-tab-add" onclick="showAddFileForm()" title="Add / Paste Additional File">
      + File
    </button>
  `;

  container.innerHTML = html;
}

function updateEditorLineNumbers() {
  const textarea = document.getElementById('sc-content');
  const gutter = document.getElementById('editor-gutter');
  if (!textarea || !gutter) return;

  const lineCount = (textarea.value.match(/\n/g) || []).length + 1;
  let nums = '';
  for (let i = 1; i <= lineCount; i++) {
    nums += i + '\n';
  }
  gutter.innerText = nums;
  gutter.scrollTop = textarea.scrollTop;
}

function isCurrentTabYaml() {
  if (modalActiveTab === 'main') {
    return document.getElementById('sc-type')?.value === 'docker_compose';
  }
  if (typeof modalActiveTab === 'number' && modalScriptFiles[modalActiveTab]) {
    const p = modalScriptFiles[modalActiveTab].path.toLowerCase();
    return p.endsWith('.yml') || p.endsWith('.yaml');
  }
  return false;
}

function updateEditorStatus() {
  const textarea = document.getElementById('sc-content');
  if (!textarea) return;

  const text = textarea.value;
  const lineCount = (text.match(/\n/g) || []).length + 1;
  const charCount = text.length;

  const selStart = textarea.selectionStart || 0;
  const textBefore = text.substring(0, selStart);
  const currentLine = (textBefore.match(/\n/g) || []).length + 1;
  const lastNl = textBefore.lastIndexOf('\n');
  const currentCol = selStart - (lastNl === -1 ? 0 : lastNl + 1) + 1;

  const posEl = document.getElementById('editor-pos-info');
  if (posEl) posEl.innerText = `Ln ${currentLine}, Col ${currentCol}`;

  const statEl = document.getElementById('editor-stat-info');
  if (statEl) statEl.innerText = `${lineCount} line${lineCount !== 1 ? 's' : ''} • ${charCount} chars`;

  const isYaml = isCurrentTabYaml();
  const langBadge = document.getElementById('editor-lang-badge');
  const yamlBtn = document.getElementById('btn-format-yaml');
  const yamlStatus = document.getElementById('editor-yaml-status');
  const templateBtn = document.getElementById('btn-compose-template');

  if (templateBtn) {
    templateBtn.style.display = (modalActiveTab === 'main' && document.getElementById('sc-type')?.value === 'docker_compose') ? 'inline-flex' : 'none';
  }

  if (isYaml) {
    if (langBadge) {
      langBadge.innerText = 'YAML (2 spaces)';
      langBadge.className = 'badge badge-compose';
    }
    if (yamlBtn) yamlBtn.style.display = 'inline-flex';

    const validation = validateYamlQuick(text);
    if (yamlStatus) {
      yamlStatus.classList.remove('hidden');
      if (validation.valid) {
        yamlStatus.innerText = '✓ Valid YAML';
        yamlStatus.className = 'yaml-status-ok';
      } else {
        yamlStatus.innerText = `⚠️ ${validation.error}`;
        yamlStatus.className = 'yaml-status-err';
      }
    }
  } else {
    const isBash = modalActiveTab === 'main';
    if (langBadge) {
      langBadge.innerText = isBash ? 'Bash' : 'Plain Text';
      langBadge.className = 'badge badge-muted';
    }
    if (yamlBtn) yamlBtn.style.display = 'none';
    if (yamlStatus) yamlStatus.classList.add('hidden');
  }
}

function formatActiveEditorYaml() {
  const textarea = document.getElementById('sc-content');
  if (!textarea) return;

  const res = formatYaml(textarea.value);
  textarea.value = res.formatted;
  syncCurrentEditorToState();
  updateEditorLineNumbers();
  updateEditorStatus();

  if (res.warning) {
    toast(`Formatted with notice: ${res.warning}`, 'warning');
  } else {
    toast('✓ YAML auto-formatted (standard 2 spaces)', 'success');
  }
}

function copyActiveEditorContent(btn) {
  const textarea = document.getElementById('sc-content');
  if (!textarea) return;
  copyText(textarea.value, 'Code copied to clipboard!', btn);
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

  const composeGroup = document.getElementById('sc-compose-cmd-group');
  const workdirHint = document.getElementById('sc-workdir-hint');
  const workdirInput = document.getElementById('sc-workdir');

  if (type === 'docker_compose') {
    if (composeGroup) composeGroup.style.display = 'block';
    if (workdirHint) workdirHint.innerHTML = '⚠️ <strong>Docker Compose:</strong> Gunakan path direktori host (misal <code>/var/www/my-app</code>) yang di-mount ke container SEHooks agar file bind mount (seperti nginx.conf) dapat dibaca.';
    if (workdirInput && (workdirInput.value === '/tmp' || !workdirInput.value)) {
      workdirInput.placeholder = '/var/www/my-app';
    }
  } else {
    if (composeGroup) composeGroup.style.display = 'none';
    if (workdirHint) workdirHint.innerHTML = 'Directory where script executes. Defaults to <code>/tmp</code>.';
    if (workdirInput) workdirInput.placeholder = '/tmp';
  }

  renderEditorTabs();
  updateEditorStatus();
}

function setComposeCmd(cmd) {
  const input = document.getElementById('sc-compose-cmd');
  if (input) input.value = cmd;
}

function insertSampleCompose() {
  const sample = `services:
  web:
    image: nginx:alpine
    ports:
      - "\${PORT:-80}:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    restart: unless-stopped`;
  if (modalMainContent.trim() && !confirm('Replace current content with sample docker-compose.yml?')) {
    return;
  }
  modalMainContent = sample;
  if (modalActiveTab === 'main') {
    const textarea = document.getElementById('sc-content');
    if (textarea) textarea.value = sample;
  }

  const sampleNginx = `events { worker_connections 1024; }
http {
  server {
    listen 80;
    location / {
      return 200 "Hello from Docker Compose via SEHooks!\\n";
    }
  }
}`;
  const existingNginx = modalScriptFiles.find(f => f.path === 'nginx.conf');
  if (existingNginx) {
    existingNginx.content = sampleNginx;
    toast('Updated sample nginx.conf in Additional Files', 'info');
  } else {
    modalScriptFiles.push({ path: 'nginx.conf', content: sampleNginx });
    toast('Added sample nginx.conf to Additional Files', 'info');
  }

  renderModalFiles();
  renderEditorTabs();
  if (typeof modalActiveTab === 'number' && modalScriptFiles[modalActiveTab]?.path === 'nginx.conf') {
    const textarea = document.getElementById('sc-content');
    if (textarea) textarea.value = sampleNginx;
  }
  updateEditorLineNumbers();
  updateEditorStatus();
}

function openScriptModal(id) {
  const s = id ? state.scripts.find(x => x.id === id) : null;
  const currentType = s?.script_type || 'bash';
  const isCompose = currentType === 'docker_compose';
  modalScriptFiles = (s?.files || []).map(f => ({ path: f.path, content: f.content }));
  modalActiveTab = 'main';
  modalMainContent = s?.content || '';

  const envOptions = state.environments.map(e => `<option value="${e.id}" ${s?.env_id == e.id ? 'selected' : ''}>${escHtml(e.name)} (${e.variables?.length || 0} vars)</option>`).join('');

  // Setup header view modes
  const headerActions = document.getElementById('modal-header-actions');
  if (headerActions) {
    headerActions.classList.remove('hidden');
    headerActions.innerHTML = `
      <div class="modal-view-modes">
        <button type="button" class="btn-view-mode active" id="btn-mode-split" onclick="setEditorViewMode('split')" title="Side-by-side view">◫ Split</button>
        <button type="button" class="btn-view-mode" id="btn-mode-editor" onclick="setEditorViewMode('editor')" title="Spacious Editor Only">⛶ Editor</button>
        <button type="button" class="btn-view-mode" id="btn-mode-settings" onclick="setEditorViewMode('settings')" title="Settings Only">⚙️ Settings</button>
      </div>
    `;
  }

  openModal(s ? 'Edit Script' : 'New Script', `
    <form id="script-form" class="script-editor-layout view-mode-split">
      <!-- Left Column: Settings Popup Form -->
      <div class="script-settings-pane" id="script-settings-pane">
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
            <button type="button" id="btn-type-bash" class="segment-btn ${!isCompose ? 'active' : ''}" onclick="setScriptType('bash')">
              🐧 Bash Script
            </button>
            <button type="button" id="btn-type-compose" class="segment-btn ${isCompose ? 'active' : ''}" onclick="setScriptType('docker_compose')">
              🐳 Docker Compose
            </button>
          </div>
          <input type="hidden" id="sc-type" value="${currentType}" />
        </div>

        <div id="sc-compose-cmd-group" class="form-group" style="${isCompose ? '' : 'display:none'}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <label for="sc-compose-cmd" style="margin:0">Compose Command *</label>
            <div class="quick-presets">
              <button type="button" class="btn-preset" onclick="setComposeCmd('docker compose up -d --build --remove-orphans')">Build & Up</button>
              <button type="button" class="btn-preset" onclick="setComposeCmd('docker compose pull && docker compose up -d --remove-orphans')">Pull & Up</button>
              <button type="button" class="btn-preset" onclick="setComposeCmd('docker compose restart')">Restart</button>
              <button type="button" class="btn-preset" onclick="setComposeCmd('docker compose down')">Down</button>
            </div>
          </div>
          <textarea id="sc-compose-cmd" style="min-height:54px;font-family:var(--mono);font-size:12px" placeholder="docker compose up -d --build --remove-orphans">${escHtml(s?.compose_cmd || 'docker compose up -d --build --remove-orphans')}</textarea>
          <div class="hint">Custom compose commands to execute. Multi-line bash commands are supported.</div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="sc-timeout">Timeout (seconds)</label>
            <input id="sc-timeout" type="number" min="1" max="3600" value="${s?.timeout_seconds || 30}" />
          </div>
          <div class="form-group">
            <label for="sc-workdir">Working Directory</label>
            <input id="sc-workdir" type="text" placeholder="${isCompose ? '/var/www/my-app' : '/tmp'}" value="${escHtml(s?.working_dir || (isCompose ? '' : '/tmp'))}" />
            <div id="sc-workdir-hint" class="hint" style="font-size:11px">${isCompose ? '⚠️ <strong>Docker Compose:</strong> Gunakan path direktori host (misal <code>/var/www/my-app</code>) yang di-mount bersama SEHooks.' : 'Directory where script executes. Defaults to <code>/tmp</code>.'}</div>
          </div>
        </div>

        <div class="form-group additional-files-box">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div>
              <label style="margin:0;font-weight:600">📎 Additional Files</label>
              <div style="font-size:11px;color:var(--text-secondary)">Extra config files deployed to working directory (e.g. <code>nginx.conf</code>, <code>Dockerfile</code>)</div>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" onclick="showAddFileForm()">+ Add File</button>
          </div>

          <div id="add-file-form" class="hidden add-file-form-box">
            <div style="display:flex;gap:8px;margin-bottom:8px;">
              <input type="text" id="new-file-path" placeholder="Relative path (e.g. nginx.conf or conf.d/default.conf)" style="font-family:var(--mono);font-size:12px;flex:1;" />
              <button type="button" class="btn btn-primary btn-sm" onclick="saveModalFile()">Save</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick="hideAddFileForm()">Cancel</button>
            </div>
            <textarea id="new-file-content" class="raw-env-textarea" style="min-height:90px;font-size:12px" placeholder="# Enter or paste file content here..."></textarea>
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
            <button type="button" class="btn btn-ghost btn-sm" onclick="promptImportEnvToScriptJson()">📥 Import .env</button>
          </div>
          <input id="sc-env" type="text" placeholder='{"MY_VAR": "value"}' value="${escHtml(s?.env_vars || '{}')}" />
          <div class="hint">Overrides profile variables.</div>
        </div>
        <div class="form-actions settings-pane-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${s ? 'Save Changes' : 'Create Script'}</button>
        </div>
      </div>

      <!-- Right Column: Independent Editor Beside Popup -->
      <div class="script-editor-pane" id="script-editor-pane">
        <!-- Editor Header / Tab Bar -->
        <div class="editor-header">
          <div class="editor-tabs" id="editor-tabs-container"></div>
          <div class="editor-actions">
            <button type="button" id="btn-format-yaml" class="btn btn-ghost btn-sm btn-action-yaml" onclick="formatActiveEditorYaml()" title="Autoformat YAML (2 spaces indentation & syntax check)">
              ⚡ <span>Format YAML</span>
            </button>
            <button type="button" id="btn-compose-template" class="btn btn-ghost btn-sm" onclick="insertSampleCompose()" title="Insert Docker Compose template">
              📄 <span>Template</span>
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="copyActiveEditorContent(this)" title="Copy editor content to clipboard">
              📋 <span>Copy</span>
            </button>
            <button type="button" id="btn-editor-expand" class="btn btn-ghost btn-sm btn-icon-only" onclick="toggleEditorMaximize()" title="Expand / Restore Editor">
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l3.293 3.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 110-2h4a1 1 0 011 1v4a1 1 0 11-2 0V6.414l-3.293 3.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 9a1 1 0 012 0v1.586l3.293-3.293a1 1 0 011.414 1.414L6.414 15H8a1 1 0 110 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 110-2h1.586l-3.293-3.293a1 1 0 011.414-1.414L15 13.586V12a1 1 0 011-1z" clip-rule="evenodd"/></svg>
            </button>
          </div>
        </div>

        <!-- Editor Workspace with Line Numbers & Enhanced Textarea -->
        <div class="editor-workspace">
          <div class="editor-gutter" id="editor-gutter">1</div>
          <textarea id="sc-content" class="editor-code-textarea" spellcheck="false" placeholder="${isCompose ? 'services:\n  app:\n    image: nginx:alpine' : '#!/bin/bash\necho \'Hello from hook!\''}">${escHtml(modalMainContent)}</textarea>
        </div>

        <!-- Editor Footer / Status Bar -->
        <div class="editor-footer">
          <div class="editor-footer-left">
            <span id="editor-pos-info">Ln 1, Col 1</span>
            <span class="footer-dot">•</span>
            <span id="editor-stat-info">0 lines</span>
          </div>
          <div class="editor-footer-right">
            <span id="editor-lang-badge" class="badge badge-muted">YAML</span>
            <span id="editor-yaml-status" class="yaml-status-ok hidden">✓ Valid YAML</span>
          </div>
        </div>
      </div>
    </form>
  `, 'modal-script-editor');

  renderModalFiles();
  renderEditorTabs();

  const textarea = document.getElementById('sc-content');
  if (textarea) {
    textarea.addEventListener('input', () => {
      syncCurrentEditorToState();
      updateEditorLineNumbers();
      updateEditorStatus();

      // Heuristic auto-detect docker compose when typing in main tab
      if (modalActiveTab === 'main') {
        const val = textarea.value.trim();
        if ((val.startsWith('services:') || val.startsWith('version:')) && document.getElementById('sc-type')?.value !== 'docker_compose') {
          setScriptType('docker_compose');
        }
      }
    });

    textarea.addEventListener('scroll', () => {
      const gutter = document.getElementById('editor-gutter');
      if (gutter) gutter.scrollTop = textarea.scrollTop;
    });

    textarea.addEventListener('keyup', updateEditorStatus);
    textarea.addEventListener('click', updateEditorStatus);
    textarea.addEventListener('select', updateEditorStatus);

    textarea.addEventListener('keydown', (e) => {
      // Tab / Shift+Tab handling
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;

        if (start === end) {
          if (!e.shiftKey) {
            textarea.value = val.substring(0, start) + '  ' + val.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 2;
          }
        } else {
          const startLine = val.lastIndexOf('\n', start - 1) + 1;
          const endLine = val.indexOf('\n', end);
          const blockEnd = endLine === -1 ? val.length : endLine;
          const selectedText = val.substring(startLine, blockEnd);
          const lines = selectedText.split('\n');

          if (!e.shiftKey) {
            const indented = lines.map(l => '  ' + l).join('\n');
            textarea.value = val.substring(0, startLine) + indented + val.substring(blockEnd);
            textarea.selectionStart = start + 2;
            textarea.selectionEnd = end + (lines.length * 2);
          } else {
            let removedCount = 0;
            const dedented = lines.map(l => {
              if (l.startsWith('  ')) { removedCount += 2; return l.substring(2); }
              if (l.startsWith(' ')) { removedCount += 1; return l.substring(1); }
              return l;
            }).join('\n');
            textarea.value = val.substring(0, startLine) + dedented + val.substring(blockEnd);
            textarea.selectionStart = Math.max(startLine, start - 2);
            textarea.selectionEnd = Math.max(startLine, end - removedCount);
          }
        }
        syncCurrentEditorToState();
        updateEditorLineNumbers();
        updateEditorStatus();
        return;
      }

      // Enter auto-indent
      if (e.key === 'Enter') {
        const start = textarea.selectionStart;
        const val = textarea.value;
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const currentLine = val.substring(lineStart, start);
        const leadingMatch = currentLine.match(/^[ ]+/);
        const indent = leadingMatch ? leadingMatch[0] : '';

        e.preventDefault();
        const insertText = '\n' + indent;
        textarea.value = val.substring(0, start) + insertText + val.substring(start);
        textarea.selectionStart = textarea.selectionEnd = start + insertText.length;
        syncCurrentEditorToState();
        updateEditorLineNumbers();
        updateEditorStatus();
        return;
      }

      // Ctrl+S / Cmd+S save shortcut
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const form = document.getElementById('script-form');
        if (form) form.requestSubmit();
      }
    });

    updateEditorLineNumbers();
    updateEditorStatus();
  }

  document.getElementById('script-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    syncCurrentEditorToState();

    const envProfileVal = document.getElementById('sc-env-profile').value;
    let scriptType = document.getElementById('sc-type').value;
    const contentVal = (modalMainContent || '').trim();
    if (scriptType !== 'docker_compose' && (contentVal.startsWith('services:') || contentVal.startsWith('version:'))) {
      scriptType = 'docker_compose';
    }

    const payload = {
      name: document.getElementById('sc-name').value,
      description: document.getElementById('sc-desc').value,
      script_type: scriptType,
      content: modalMainContent,
      compose_cmd: document.getElementById('sc-compose-cmd')?.value || '',
      timeout_seconds: parseInt(document.getElementById('sc-timeout').value) || 30,
      working_dir: document.getElementById('sc-workdir').value || (scriptType === 'docker_compose' ? '/var/www/my-app' : '/tmp'),
      env_vars: document.getElementById('sc-env').value || '{}',
      env_id: envProfileVal ? parseInt(envProfileVal) : null,
      files: modalScriptFiles,
    };
    try {
      if (s) await api.put(`/api/scripts/${s.id}`, payload);
      else await api.post('/api/scripts', payload);
      closeModal();
      toast(s ? 'Script updated' : 'Script created', 'success');
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
function openModal(title, body, modalClass = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  const modalEl = document.getElementById('modal');
  modalEl.className = 'modal' + (modalClass ? ' ' + modalClass : '');
  const headerActions = document.getElementById('modal-header-actions');
  if (headerActions && !modalClass.includes('modal-script-editor')) {
    headerActions.classList.add('hidden');
    headerActions.innerHTML = '';
  }
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  const modalEl = document.getElementById('modal');
  modalEl.className = 'modal';
  const headerActions = document.getElementById('modal-header-actions');
  if (headerActions) {
    headerActions.classList.add('hidden');
    headerActions.innerHTML = '';
  }
}
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
