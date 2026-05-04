// EcoTask — db.js
// Mini "BDD" sur fichier JSON, accès 100% synchrone (zéro dépendance externe).
// Suffisant pour les routes auth / tasks / users du projet.

const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'ecotask_db.json');

/* ─── Lecture / écriture sûres ────────────────────────────────── */
function readAll() {
  try {
    const raw  = fs.readFileSync(DB_FILE, 'utf8');
    const data = JSON.parse(raw || '{}');
    if (!Array.isArray(data.users)) data.users = [];
    if (!Array.isArray(data.tasks)) data.tasks = [];
    return data;
  } catch {
    return { users: [], tasks: [] };
  }
}

function writeAll(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function initDB() {
  if (!fs.existsSync(DB_FILE)) writeAll({ users: [], tasks: [] });
  else writeAll(readAll()); // s'assure que les clés existent
  console.log('✅ Base de données EcoTask prête (JSON sync)');
}

/* ─── Adapter "SQL → JSON" minimal ────────────────────────────── */
// On ne supporte que les requêtes utilisées par les routes du projet.
function getDB() {
  return { prepare: (sql) => makeStatement(sql) };
}

function makeStatement(sql) {
  const s = sql.replace(/\s+/g, ' ').trim();
  return {
    get: (...params) => runGet(s, params),
    all: (...params) => runAll(s, params),
    run: (...params) => runRun(s, params),
  };
}

/* ── lectures unitaires ─────────────────────────────────────── */
function runGet(sql, params) {
  const data = readAll();

  // ── USERS ──
  if (/FROM users WHERE email = \? AND id != \?/.test(sql)) {
    const email = normEmail(params[0]);
    return data.users.find(u => u.email === email && u.id !== params[1]);
  }
  if (/FROM users WHERE email = \?/.test(sql)) {
    const email = normEmail(params[0]);
    return data.users.find(u => u.email === email);
  }
  if (/FROM users WHERE id = \?/.test(sql)) {
    return data.users.find(u => u.id === Number(params[0]) || u.id === params[0]);
  }
  if (/COUNT\(\*\) AS total FROM users/.test(sql)) {
    return { total: data.users.length };
  }

  // ── TASKS ──
  if (/FROM tasks WHERE id = \? AND user_id = \?/.test(sql)) {
    return data.tasks.find(t =>
      (t.id === Number(params[0]) || t.id === params[0]) && t.user_id === params[1]
    );
  }
  if (/SELECT description, category FROM tasks WHERE id = \?/.test(sql)) {
    return data.tasks.find(t => t.id === Number(params[0]) || t.id === params[0]);
  }
  if (/FROM tasks WHERE id = \?/.test(sql) && !/COUNT/.test(sql)) {
    return data.tasks.find(t => t.id === Number(params[0]) || t.id === params[0]);
  }
  if (/COUNT\(\*\) AS total FROM tasks t WHERE/.test(sql)) {
    return { total: filterTasks(data.tasks, sql, params).length };
  }
  if (/SUM\(CASE WHEN status = 'done'/.test(sql)) {
    const userId = params[0];
    const userTasks = data.tasks.filter(t => t.user_id === userId);
    const total = userTasks.length;
    const done  = userTasks.filter(t => t.status === 'done').length;
    const todo  = userTasks.filter(t => t.status === 'todo').length;
    const avg   = total
      ? userTasks.reduce((s, t) => s + (Number(t.eco_score) || 0), 0) / total
      : 0;
    return { total, done, todo, avg_eco_score: avg };
  }

  return null;
}

/* ── lectures multiples ─────────────────────────────────────── */
function runAll(sql, params) {
  const data = readAll();

  if (/FROM tasks t WHERE/.test(sql)) {
    let list = filterTasks(data.tasks, sql, params);
    const order = { high: 1, medium: 2, low: 3 };
    list.sort((a, b) => {
      const p = (order[a.priority] || 4) - (order[b.priority] || 4);
      if (p) return p;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
    const offset = Number(params[params.length - 1]) || 0;
    const limit  = Number(params[params.length - 2]) || list.length;
    return list.slice(offset, offset + limit);
  }

  if (/FROM users/.test(sql)) {
    const offset = Number(params[params.length - 1]) || 0;
    const limit  = Number(params[params.length - 2]) || data.users.length;
    return [...data.users]
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(offset, offset + limit)
      .map(({ password, ...rest }) => rest);
  }

  return [];
}

function filterTasks(tasks, sql, params) {
  let i = 1; // params[0] = user_id
  let list = tasks.filter(t => t.user_id === params[0]);
  if (/t\.status = \?/.test(sql))   { const v = params[i++]; list = list.filter(t => t.status   === v); }
  if (/t\.priority = \?/.test(sql)) { const v = params[i++]; list = list.filter(t => t.priority === v); }
  if (/t\.category = \?/.test(sql)) { const v = params[i++]; list = list.filter(t => t.category === v); }
  return list;
}

/* ── écritures ──────────────────────────────────────────────── */
function runRun(sql, params) {
  const data = readAll();

  // INSERT user
  if (/INSERT INTO users/.test(sql)) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    data.users.push({
      id,
      email:      normEmail(params[0]),
      password:   params[1],
      name:       String(params[2] || '').trim(),
      role:       'user',
      created_at: new Date().toISOString(),
    });
    writeAll(data);
    return { lastInsertRowid: id, changes: 1 };
  }

  // INSERT task
  if (/INSERT INTO tasks/.test(sql)) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    data.tasks.push({
      id,
      user_id:     params[0],
      title:       params[1],
      description: params[2],
      status:      params[3] || 'todo',
      priority:    params[4] || 'medium',
      category:    params[5] || 'general',
      due_date:    params[6] || null,
      eco_score:   Number(params[7]) || 50,
      created_at:  new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    });
    writeAll(data);
    return { lastInsertRowid: id, changes: 1 };
  }

  // UPDATE users
  if (/UPDATE users SET/.test(sql)) {
    const id = params[params.length - 1];
    const u = data.users.find(x => x.id === id || x.id === Number(id));
    if (!u) return { changes: 0 };
    applySetClause(u, sql, params);
    if (u.email) u.email = normEmail(u.email);
    u.updated_at = new Date().toISOString();
    writeAll(data);
    return { changes: 1 };
  }

  // UPDATE tasks
  if (/UPDATE tasks SET/.test(sql)) {
    const id = params[params.length - 1];
    const t = data.tasks.find(x => x.id === Number(id) || x.id === id);
    if (!t) return { changes: 0 };
    applySetClause(t, sql, params);
    t.updated_at = new Date().toISOString();
    writeAll(data);
    return { changes: 1 };
  }

  // DELETE user (+ cascade tasks)
  if (/DELETE FROM users WHERE id = \?/.test(sql)) {
    const id = params[0];
    const before = data.users.length;
    data.users = data.users.filter(u => u.id !== id && u.id !== Number(id));
    data.tasks = data.tasks.filter(t => t.user_id !== id && t.user_id !== Number(id));
    writeAll(data);
    return { changes: before - data.users.length };
  }

  // DELETE task
  if (/DELETE FROM tasks WHERE id = \?/.test(sql)) {
    const id = params[0];
    const before = data.tasks.length;
    data.tasks = data.tasks.filter(t => t.id !== Number(id) && t.id !== id);
    writeAll(data);
    return { changes: before - data.tasks.length };
  }

  return { changes: 0 };
}

/* ─── Helpers ─────────────────────────────────────────────────── */
function normEmail(v) {
  return String(v || '').toLowerCase().trim();
}

function applySetClause(target, sql, params) {
  const m = sql.match(/SET\s+(.*?)\s+WHERE/i);
  if (!m) return;
  const fields = m[1].split(',').map(s => s.trim().split('=')[0].trim());
  fields.forEach((f, idx) => { target[f] = params[idx]; });
}

/* ─── Dashboard agrégé (lecture directe JSON, pas de SQL adapter) ── */
function getDashboardData(userId) {
  const data  = readAll();
  // Comparaison robuste : coerce les deux côtés en string (évite number vs string)
  const tasks = data.tasks.filter(t => String(t.user_id) === String(userId));

  const total      = tasks.length;
  const done       = tasks.filter(t => t.status === 'done').length;
  const todo       = tasks.filter(t => t.status === 'todo').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const totalEco   = tasks.reduce((s, t) => s + (Number(t.eco_score) || 0), 0);
  const avgEco     = total ? Math.round(totalEco / total) : 0;

  // Répartition par catégorie
  const catMap = {};
  for (const t of tasks) {
    const cat = t.category || 'general';
    if (!catMap[cat]) catMap[cat] = { count: 0, totalScore: 0 };
    catMap[cat].count++;
    catMap[cat].totalScore += Number(t.eco_score) || 0;
  }
  const byCategory = Object.entries(catMap)
    .map(([cat, v]) => ({
      category: cat,
      count:    v.count,
      avgScore: Math.round(v.totalScore / v.count),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Activité des 7 derniers jours
  const weeklyActivity = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr  = d.toISOString().slice(0, 10);
    const dayTasks = tasks.filter(t => (t.created_at || '').slice(0, 10) === dateStr);
    weeklyActivity.push({
      date:     dateStr,
      count:    dayTasks.length,
      avgScore: dayTasks.length
        ? Math.round(dayTasks.reduce((s, t) => s + (Number(t.eco_score) || 0), 0) / dayTasks.length)
        : null,
    });
  }

  // Activité du mois en cours (chaque jour 1 → aujourd'hui)
  const now2       = new Date();
  const y          = now2.getFullYear();
  const m          = now2.getMonth();
  const todayDay   = now2.getDate();
  const monthlyActivity = [];
  for (let day = 1; day <= todayDay; day++) {
    const dateStr  = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayTasks = tasks.filter(t => (t.created_at || '').slice(0, 10) === dateStr);
    monthlyActivity.push({
      day,
      date:     dateStr,
      count:    dayTasks.length,
      avgScore: dayTasks.length
        ? Math.round(dayTasks.reduce((s, t) => s + (Number(t.eco_score) || 0), 0) / dayTasks.length)
        : 0,
    });
  }

  const suggestions = generateSuggestions(tasks, byCategory, avgEco);
  return { total, done, todo, inProgress, totalEco, avgEco, byCategory, weeklyActivity, monthlyActivity, suggestions };
}

function generateSuggestions(tasks, byCategory, avgEco) {
  if (tasks.length === 0) {
    return [{ icon: '🌱', text: 'Créez votre première tâche éco-responsable pour démarrer votre impact !' }];
  }

  const suggestions = [];

  if (avgEco >= 75) {
    suggestions.push({ icon: '🏆', text: 'Excellent score éco ! Partagez vos bonnes pratiques autour de vous.' });
  } else if (avgEco < 50) {
    suggestions.push({ icon: '♻️', text: 'Ajoutez des tâches Recyclage ou Énergie pour booster votre score éco.' });
  }

  if (!byCategory.some(c => c.category === 'transport')) {
    suggestions.push({ icon: '🚲', text: 'Enregistrez vos trajets éco (vélo, marche) dans la catégorie Transport.' });
  }

  if (!byCategory.some(c => c.category === 'alimentation') && tasks.length >= 3) {
    suggestions.push({ icon: '🥗', text: 'Notez vos actions alimentaires (bio, local, végétarien) pour améliorer votre impact.' });
  }

  const todoRatio = tasks.filter(t => t.status === 'todo').length / tasks.length;
  if (todoRatio > 0.6 && tasks.length > 3) {
    suggestions.push({ icon: '✅', text: 'Beaucoup de tâches en attente — terminez-en quelques-unes pour progresser !' });
  }

  if (tasks.length > 0 && tasks.every(t => t.category === 'general')) {
    suggestions.push({ icon: '🏷️', text: 'Utilisez les catégories (Transport, Énergie…) pour un meilleur suivi de votre impact.' });
  }

  return suggestions.slice(0, 3);
}

module.exports = { initDB, getDB, getDashboardData };
