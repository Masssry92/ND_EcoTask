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
  editingId:   null,
  deletingId:  null,
  dashData:    null,   // données dashboard pour le slider planète
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
  loadDashboard();
  loadTasks(1);
}

/* ─── Dashboard éco ──────────────────────────────────────────────── */
async function loadDashboard() {
  try {
    const res = await api('GET', '/tasks/dashboard/me');
    if (!res) return;
    const d = res.data;

    // Stats bar rapides
    $id('stats-bar').innerHTML = `
      <div class="stat-chip"><strong>${d.total ?? 0}</strong>Total</div>
      <div class="stat-chip"><strong>${d.done ?? 0}</strong>Terminées</div>
      <div class="stat-chip"><strong>${d.todo ?? 0}</strong>À faire</div>
      <div class="stat-chip eco"><strong>${d.avgEco || '—'}</strong>Score éco moy.</div>
    `;

    // Pill nav
    $id('eco-score-val').textContent = d.avgEco ? d.avgEco + '/100' : '—';

    // Anneau éco
    const ring = $id('dash-ring');
    ring.style.setProperty('--eco-pct', d.avgEco || 0);
    animateCounter('dash-score-num', d.avgEco || 0);
    $id('dash-total').textContent = d.total;
    $id('dash-done').textContent  = d.done;

    // Suggestions
    const sEl = $id('suggestions-list');
    sEl.innerHTML = (d.suggestions || []).map(s =>
      `<div class="suggestion"><span class="sug-icon">${s.icon}</span><span>${s.text}</span></div>`
    ).join('') || '<p class="empty-state" style="font-size:.75rem">Ajoutez des tâches.</p>';

    // Graphique catégories
    const cEl = $id('categories-chart');
    if (d.byCategory && d.byCategory.length) {
      const max = Math.max(...d.byCategory.map(c => c.count));
      cEl.innerHTML = d.byCategory.map(c => `
        <div class="cat-bar-row">
          <span class="cat-bar-label">${catLabel(c.category)}</span>
          <div class="cat-bar-track">
            <div class="cat-bar-fill" style="--bar-pct:${Math.round(c.count / max * 100)}%">
              <span class="cat-bar-val">${c.count}</span>
            </div>
          </div>
          <span class="eco-badge ${c.avgScore >= 70 ? 'eco-good' : c.avgScore >= 50 ? 'eco-ok' : 'eco-low'}">${c.avgScore}</span>
        </div>
      `).join('');
    } else {
      cEl.innerHTML = '<p class="empty-state" style="font-size:.75rem">Aucune donnée.</p>';
    }

    // Stocker pour le slider
    state.dashData = d;

    // Slider planète + graphe mensuel
    updateImpactSlider(Number($id('impact-slider').value) || 0);
    renderMonthlyChart(d.monthlyActivity || []);
  } catch (e) { console.warn('[dashboard]', e.message); }
}

/* ─── Slider planète interactif ──────────────────────────────────── */
const IMPACT_PERIODS = [
  { label: '30 jours', days: 30 },
  { label: '6 mois',   days: 180 },
  { label: '1 an',     days: 365 },
  { label: '5 ans',    days: 1825 },
  { label: '10 ans',   days: 3650 },
  { label: '30 ans',   days: 10950 },
];

function updateImpactSlider(idx) {
  const d = state.dashData;
  if (!d) return;

  const planet = $id('impact-planet');
  const status = $id('impact-status');
  const nums   = $id('impact-numbers');

  if (!d.total) {
    planet.textContent = '🌱';
    planet.className   = 'impact-planet';
    status.textContent = 'Créez des tâches pour voir votre impact.';
    status.className   = 'impact-status';
    nums.innerHTML     = '';
    return;
  }

  const weekCount = (d.weeklyActivity || []).reduce((s, w) => s + w.count, 0);
  const dailyRate = Math.max(weekCount ? weekCount / 7 : d.total / 30, 0.05);
  const period    = IMPACT_PERIODS[idx];
  const tasks     = Math.max(1, Math.round(dailyRate * period.days));
  const avg       = d.avgEco || 50;

  // Impact net : score > 50 = bon, < 50 = mauvais (50 = neutre)
  const co2Net  = Math.round(tasks * (avg - 50) * 0.12);
  const co2Abs  = Math.abs(co2Net);
  const trees   = Math.round(co2Abs / 22);
  const good    = co2Net >= 0;

  // Planète — état et animation
  planet.textContent = '🌍';
  const intensity = Math.min(co2Abs / 200, 1); // 0→1 selon intensité
  planet.className = 'impact-planet ' + (good ? 'planet-good' : 'planet-bad') +
    (intensity > 0.7 ? ' planet-intense' : '');

  // Message selon état + période
  if (good) {
    const msgs = ['Impact positif, continuez ! ✨', 'Vous êtes sur la bonne voie 🌱',
                  'La planète vous remercie ! 💚', 'Vous êtes un héros vert ! 🏆'];
    status.textContent = msgs[Math.min(Math.floor(intensity * 4), 3)];
    status.className   = 'impact-status status-good';
  } else {
    const msgs = ['Légèrement négatif 😕', 'Impact négatif, changez vos habitudes 😟',
                  'La planète souffre ! ⚠️', 'Urgence climatique ! 🔥'];
    status.textContent = msgs[Math.min(Math.floor(intensity * 4), 3)];
    status.className   = 'impact-status status-bad';
  }

  // Chiffres
  nums.innerHTML = `
    <div class="impact-period">${period.label}</div>
    <div class="impact-row">≈ <strong>${tasks}</strong> action${tasks > 1 ? 's' : ''} éco</div>
    <div class="impact-row ${good ? 'impact-good' : 'impact-bad'}">
      ${good ? '✅' : '⚠️'} ${good ? '+' : '−'}${co2Abs} kg CO₂ ${good ? 'économisés' : 'émis'}
    </div>
    <div class="impact-row">
      🌳 ${trees} arbre${trees !== 1 ? 's' : ''} ${good ? 'préservé' : 'perdu'}${trees !== 1 ? 's' : ''}
    </div>
  `;
}

/* ─── Graphe mensuel ─────────────────────────────────────────────── */
function renderMonthlyChart(monthlyActivity) {
  const el = $id('monthly-chart');
  const hasData = monthlyActivity.some(d => d.count > 0);

  if (!hasData) {
    el.innerHTML = '<p class="empty-state" style="font-size:.73rem;padding:.5rem 0">Aucune activité ce mois-ci — créez votre première tâche !</p>';
    return;
  }

  const maxCount = Math.max(...monthlyActivity.map(d => d.count), 1);
  const todayDay = new Date().getDate();

  el.innerHTML = `<div class="monthly-bars">` +
    monthlyActivity.map(d => {
      const hPct = d.count ? Math.max(d.count / maxCount * 100, 8) : 0;
      const color = d.avgScore >= 70 ? 'var(--leaf)' :
                    d.avgScore >= 50 ? 'var(--accent)' : 'var(--red)';
      return `
        <div class="monthly-bar-col" title="${d.date} : ${d.count} tâche${d.count > 1 ? 's' : ''}${d.avgScore ? ', score ' + d.avgScore : ''}">
          <div class="monthly-bar-wrap">
            <div class="monthly-bar" style="--h:${hPct}%; --color:${color}"></div>
          </div>
          <div class="monthly-bar-day${d.day === todayDay ? ' today' : ''}">${d.day}</div>
        </div>
      `;
    }).join('') +
  `</div>`;
}

function animateCounter(elId, target) {
  const el = $id(elId);
  const start = performance.now();
  const duration = 900;
  function step(now) {
    const pct  = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - pct, 3);
    el.textContent = Math.round(target * ease);
    if (pct < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function toggleDashboard() {
  const body = $id('dash-body');
  const btn  = $id('dash-toggle');
  const collapsed = body.classList.toggle('collapsed');
  btn.textContent = collapsed ? 'Afficher ▼' : 'Réduire ▲';
}

function catLabel(cat) {
  return { transport: '🚗 Transport', alimentation: '🥗 Alim.', energie: '⚡ Énergie',
           recyclage: '♻️ Recyclage', numerique: '💻 Num.', general: '📋 Général' }[cat] || cat;
}

/* ─── Catégories rapides (modal) ─────────────────────────────────── */
function selectCat(cat) {
  $id('task-category').value = cat;
  syncCatPills();
  updateEcoPreview();
}

function syncCatPills() {
  const val = $id('task-category').value.trim().toLowerCase();
  document.querySelectorAll('.cat-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.cat === val);
  });
}

/* ─── Aperçu score éco en temps réel ────────────────────────────── */
const ECO_CATS_CLI  = { transport: 20, alimentation: 18, energie: 18, recyclage: 22, numerique: 12 };
const POS_KW_CLI    = ['vélo','velo','marche','bio','local','végétarien','vegetarien','solaire',
                        'éolien','eolien','renouvelable','économis','economis','tri','compost',
                        'réutilis','reutilis','répar','repar','optimis','réduire','reduire',
                        'durable','vert','écolog','ecolog'];
const NEG_KW_CLI    = ['voiture','avion','fast-food','jetable','plastique'];

function computeClientEcoScore(title, desc, cat) {
  let score = 40;
  const c = (cat || '').toLowerCase().trim();
  if (ECO_CATS_CLI[c]) score += ECO_CATS_CLI[c];
  const text = `${title} ${desc}`.toLowerCase();
  score += Math.min(POS_KW_CLI.filter(kw => text.includes(kw)).length * 7, 28);
  score -= NEG_KW_CLI.filter(kw => text.includes(kw)).length * 15;
  if (!desc || desc.length < 30) score += 5;
  return Math.max(10, Math.min(score, 100));
}

function updateEcoPreview() {
  const title = $id('task-title').value;
  const desc  = $id('task-desc').value;
  const cat   = $id('task-category').value;
  const prev  = $id('eco-preview');
  if (!title.trim()) { prev.hidden = true; return; }
  const score = computeClientEcoScore(title, desc, cat);
  const cls   = score >= 70 ? 'score-good' : score >= 50 ? 'score-ok' : 'score-low';
  $id('eco-preview-val').textContent = score + '/100';
  $id('eco-preview-val').className   = cls;
  prev.hidden = false;
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
  document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
  $id('eco-preview').hidden  = true;

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
      syncCatPills();
      updateEcoPreview();
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
    loadDashboard();
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
    loadDashboard();
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
      loadDashboard();
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
