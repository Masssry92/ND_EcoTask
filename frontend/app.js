// EcoTask — app.js
// Green IT : zéro framework, JS vanilla minimal, fetch natif,
//            pas de rechargement complet, pagination côté serveur

'use strict';

/* ─── Config ────────────────────────────────────────────────────── */
const API = '/api';

/* ─── État global (minimal) ─────────────────────────────────────── */
const state = {
  token:       null,
  user:        null,
  currentPage: 1,
  editingId:   null,   // null = création, number = édition
  deletingId:  null,
};

/* ─── Utils ─────────────────────────────────────────────────────── */
function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function $id(id) { return document.getElementById(id); }

function showError(elId, msg) {
  const el = $id(elId);
  el.textContent = msg;
  el.hidden = false;
}

function hideError(elId) { $id(elId).hidden = true; }

/** Appel API avec gestion JWT centralisée — vrai fetch vers /api */
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('Connexion au serveur impossible');
  }

  // Le backend renvoie toujours du JSON, mais on protège quand même.
  let data = null;
  const txt = await res.text();
  if (txt) {
    try { data = JSON.parse(txt); } catch (e) { /* réponse non JSON */ }
  }

  // Token expiré ou invalide → on déloggue proprement
  if (res.status === 401) {
    clearSession();
    showScreen('auth');
    throw new Error(data?.error || 'Session expirée, reconnectez-vous');
  }

  if (!res.ok) {
    throw new Error(data?.error || `Erreur ${res.status}`);
  }

  return data;
}

/* ─── Persistance du token (localStorage minimal) ──────────────── */
function saveSession(token, user) {
  state.token = token;
  state.user  = user;
  localStorage.setItem('eco_token', token);
  localStorage.setItem('eco_user',  JSON.stringify(user));
}

function loadSession() {
  const token = localStorage.getItem('eco_token');
  let user = null;
  try { user = JSON.parse(localStorage.getItem('eco_user') || 'null'); } catch (e) { /* données corrompues */ }
  if (token && token !== 'undefined' && user) { state.token = token; state.user = user; return true; }
  return false;
}

function clearSession() {
  state.token = null;
  state.user  = null;
  localStorage.removeItem('eco_token');
  localStorage.removeItem('eco_user');
}

/* ─── Routing SPA (screens) ─────────────────────────────────────── */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $id(`screen-${name}`).classList.add('active');
}

/* ─── Thème sombre ──────────────────────────────────────────────── */
function toggleDark() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? '' : 'dark');
  localStorage.setItem('eco_dark', isDark ? '' : '1');
}

function initTheme() {
  if (localStorage.getItem('eco_dark') === '1') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

/* ─── Auth — tabs ─────────────────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.id === `tab-${name}`);
    t.setAttribute('aria-selected', t.id === `tab-${name}`);
  });
  document.querySelectorAll('.auth-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${name}`);
  });
}

/* ─── Auth — inscription ─────────────────────────────────────────── */
async function handleRegister() {
  hideError('reg-error');
  const name     = $id('reg-name').value.trim();
  const email    = $id('reg-email').value.trim();
  const password = $id('reg-password').value;

  try {
    const data = await api('POST', '/auth/register', { name, email, password });
    if (!data) return;
    saveSession(data.token, data.user);
    enterApp();
  } catch (e) {
    showError('reg-error', e.message);
  }
}

/* ─── Auth — connexion ───────────────────────────────────────────── */
async function handleLogin() {
  hideError('login-error');
  const email    = $id('login-email').value.trim();
  const password = $id('login-password').value;

  try {
    const data = await api('POST', '/auth/login', { email, password });
    if (!data) return;
    saveSession(data.token, data.user);
    enterApp();
  } catch (e) {
    showError('login-error', e.message);
  }
}

/* ─── Auth — déconnexion ─────────────────────────────────────────── */
function handleLogout() {
  clearSession();
  showScreen('auth');
}

/* ─── Entrée dans l'app ──────────────────────────────────────────── */
function enterApp() {
  $id('nav-greeting').textContent = `Bonjour, ${state.user.name} 👋`;
  showScreen('app');
  loadStats();
  loadTasks(1);
}

/* ─── Stats éco ──────────────────────────────────────────────────── */
async function loadStats() {
  try {
    const data = await api('GET', '/tasks/stats/me');
    if (!data) return;
    const { total, done, todo, avg_eco_score } = data.data;

    $id('stats-bar').innerHTML = `
      <div class="stat-chip">
        <strong>${total ?? 0}</strong>
        Total
      </div>
      <div class="stat-chip">
        <strong>${done ?? 0}</strong>
        Terminées
      </div>
      <div class="stat-chip">
        <strong>${todo ?? 0}</strong>
        À faire
      </div>
      <div class="stat-chip eco">
        <strong>${avg_eco_score ? Math.round(avg_eco_score) : '—'}</strong>
        Score éco moy.
      </div>
    `;

    // Pill dans la nav
    $id('eco-score-val').textContent = avg_eco_score
      ? Math.round(avg_eco_score) + '/100'
      : '—';
  } catch (e) { /* silencieux — non bloquant */ }
}

/* ─── Chargement des tâches ──────────────────────────────────────── */
async function loadTasks(page = 1) {
  state.currentPage = page;

  const status   = $id('filter-status').value;
  const priority = $id('filter-priority').value;
  const category = $id('filter-category').value.trim();

  const qs = new URLSearchParams({ page });
  if (status)   qs.set('status',   status);
  if (priority) qs.set('priority', priority);
  if (category) qs.set('category', category);

  try {
    const data = await api('GET', `/tasks?${qs}`);
    if (!data) return;

    renderTasks(data.data);
    renderPagination(data.pagination);
  } catch (e) {
    $id('tasks-list').innerHTML =
      `<p class="empty-state">Erreur : ${e.message}</p>`;
  }
}

/* ─── Rendu des tâches ───────────────────────────────────────────── */
function renderTasks(tasks) {
  const list = $id('tasks-list');

  if (!tasks.length) {
    list.innerHTML = '<p class="empty-state">Aucune tâche pour ces filtres. Créez-en une !</p>';
    return;
  }

  list.innerHTML = tasks.map(task => {
    const isDone    = task.status === 'done';
    const today     = new Date().toISOString().slice(0, 10);
    const overdue   = task.due_date && task.due_date < today && !isDone;

    return `
      <article class="task-card${isDone ? ' done' : ''}" data-id="${task.id}">
        <div class="task-check" role="checkbox"
             aria-checked="${isDone}"
             aria-label="${isDone ? 'Marquer à faire' : 'Marquer terminée'}"
             onclick="toggleStatus(${task.id}, '${task.status}')"
             tabindex="0"
             onkeydown="if(event.key==='Enter'||event.key===' ')toggleStatus(${task.id},'${task.status}')">
          ${isDone ? '✓' : ''}
        </div>

        <div class="task-meta">
          <div class="task-title" title="${escHtml(task.title)}">${escHtml(task.title)}</div>
          <div class="task-tags">
            <span class="tag tag-status-${task.status}">${labelStatus(task.status)}</span>
            <span class="tag tag-priority-${task.priority}">${labelPriority(task.priority)}</span>
            ${task.category !== 'general'
              ? `<span class="tag tag-category">${escHtml(task.category)}</span>`
              : ''}
            ${task.eco_score >= 70
              ? `<span class="tag tag-eco">🌿 éco +${task.eco_score}</span>`
              : ''}
          </div>
          ${task.due_date
            ? `<div class="task-due${overdue ? ' overdue' : ''}">
                 ${overdue ? '⚠ ' : ''}Échéance : ${task.due_date}
               </div>`
            : ''}
        </div>

        <div class="task-actions">
          <button class="task-btn" title="Modifier"
                  onclick="openModal('edit', ${task.id})"
                  aria-label="Modifier la tâche">✎</button>
          <button class="task-btn delete" title="Supprimer"
                  onclick="openConfirm(${task.id})"
                  aria-label="Supprimer la tâche">✕</button>
        </div>
      </article>
    `;
  }).join('');
}

/* ─── Rendu pagination ───────────────────────────────────────────── */
function renderPagination({ page, totalPages }) {
  const el = $id('pagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  let html = `
    <button class="page-btn" ${page <= 1 ? 'disabled' : ''}
            onclick="loadTasks(${page - 1})">←</button>
  `;

  for (let i = 1; i <= totalPages; i++) {
    html += `
      <button class="page-btn${i === page ? ' active' : ''}"
              onclick="loadTasks(${i})"
              aria-label="Page ${i}"
              aria-current="${i === page ? 'page' : 'false'}">${i}</button>
    `;
  }

  html += `
    <button class="page-btn" ${page >= totalPages ? 'disabled' : ''}
            onclick="loadTasks(${page + 1})">→</button>
  `;

  el.innerHTML = html;
}

/* ─── Modale création / édition ──────────────────────────────────── */
async function openModal(mode, taskId = null) {
  state.editingId = taskId;

  $id('modal-title').textContent  = mode === 'edit' ? 'Modifier la tâche' : 'Nouvelle tâche';
  $id('modal-submit').textContent = mode === 'edit' ? 'Enregistrer' : 'Créer la tâche';
  hideError('task-error');

  // Reset fields
  ['task-title','task-desc','task-category'].forEach(id => $id(id).value = '');
  $id('task-status').value   = 'todo';
  $id('task-priority').value = 'medium';
  $id('task-due').value      = '';

  if (mode === 'edit' && taskId) {
    try {
      const data = await api('GET', `/tasks/${taskId}`);
      if (!data) return;
      const t = data.data;
      $id('task-title').value    = t.title;
      $id('task-desc').value     = t.description || '';
      $id('task-status').value   = t.status;
      $id('task-priority').value = t.priority;
      $id('task-category').value = t.category !== 'general' ? t.category : '';
      $id('task-due').value      = t.due_date || '';
    } catch (e) {
      showError('task-error', e.message);
    }
  }

  $id('modal-overlay').hidden = false;
  $id('task-title').focus();
}

function closeModal() {
  $id('modal-overlay').hidden = true;
  state.editingId = null;
}

/* ─── Soumission tâche ───────────────────────────────────────────── */
async function submitTask() {
  hideError('task-error');

  const body = {
    title:       $id('task-title').value.trim(),
    description: $id('task-desc').value.trim() || undefined,
    status:      $id('task-status').value,
    priority:    $id('task-priority').value,
    category:    $id('task-category').value.trim() || undefined,
    due_date:    $id('task-due').value || undefined,
  };

  try {
    if (state.editingId) {
      await api('PATCH', `/tasks/${state.editingId}`, body);
    } else {
      await api('POST', '/tasks', body);
    }
    closeModal();
    loadTasks(state.currentPage);
    loadStats();
  } catch (e) {
    showError('task-error', e.message);
  }
}

/* ─── Toggle statut rapide ───────────────────────────────────────── */
async function toggleStatus(taskId, currentStatus) {
  const next = currentStatus === 'done' ? 'todo' : 'done';
  try {
    await api('PATCH', `/tasks/${taskId}`, { status: next });
    loadTasks(state.currentPage);
    loadStats();
  } catch (e) { /* silencieux */ }
}

/* ─── Confirmation suppression ───────────────────────────────────── */
function openConfirm(taskId) {
  state.deletingId = taskId;
  $id('confirm-overlay').hidden = false;

  $id('confirm-ok').onclick = async () => {
    try {
      await api('DELETE', `/tasks/${state.deletingId}`);
      closeConfirm();
      loadTasks(state.currentPage);
      loadStats();
    } catch (e) { /* silencieux */ }
  };
}

function closeConfirm() {
  $id('confirm-overlay').hidden = true;
  state.deletingId = null;
}

/* ─── Fermeture modale sur Échap ─────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeConfirm();
  }
});

/* ─── Helpers d'affichage ────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function labelStatus(s) {
  return { todo: 'À faire', in_progress: 'En cours', done: 'Terminé' }[s] || s;
}

function labelPriority(p) {
  return { low: 'Basse', medium: 'Moyenne', high: 'Haute' }[p] || p;
}

/* ─── Init ───────────────────────────────────────────────────────── */
(function init() {
  initTheme();

  // Entrée clavier sur les champs auth
  ['login-email','login-password'].forEach(id => {
    $id(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleLogin();
    });
  });
  ['reg-name','reg-email','reg-password'].forEach(id => {
    $id(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleRegister();
    });
  });

  // Restaurer la session si token présent
  if (loadSession()) {
    enterApp();
  } else {
    showScreen('auth');
  }
})();
