// EcoTask — routes/tasks.js
// CRUD complet de l'entité métier « Task »
// Green IT : pagination LIMIT/OFFSET, SELECT ciblé, index BDD, < 5 requêtes / vue

const router = require('express').Router();
const { getDB } = require('../db');
const { requireAuth } = require('./auth');

/* ─── Constantes ──────────────────────────────────────────────── */
const PAGE_SIZE   = 20; // pagination : 20 tâches max par page
const VALID_STATUSES   = ['todo', 'in_progress', 'done'];
const VALID_PRIORITIES = ['low', 'medium', 'high'];

/* ─── Validation ──────────────────────────────────────────────── */
function validateTask({ title, status, priority, category }) {
  if (!title || title.trim().length < 2)              return 'Titre trop court (min 2 caractères)';
  if (!title || title.trim().length > 120)            return 'Titre trop long (max 120 caractères)';
  if (status   && !VALID_STATUSES.includes(status))   return 'Statut invalide';
  if (priority && !VALID_PRIORITIES.includes(priority))return 'Priorité invalide';
  if (category && category.trim().length > 50)        return 'Catégorie trop longue';
  return null;
}

/** Calcule un score éco simple (0-100) basé sur le contenu de la tâche */
function computeEcoScore({ description, category }) {
  let score = 50;
  if (!description || description.length < 20) score += 10; // sobriété du contenu
  if (category && category.toLowerCase().includes('eco')) score += 20;
  if (category && category.toLowerCase().includes('env')) score += 15;
  return Math.min(score, 100);
}

/* ─── GET /api/tasks ──────────────────────────────────────────── */
// Liste paginée des tâches de l'utilisateur connecté
// Query params : ?page=1&status=todo&priority=high&category=dev
router.get('/', requireAuth, (req, res) => {
  const db   = getDB();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Filtres optionnels — validés avant injection dans la requête
  const status   = VALID_STATUSES.includes(req.query.status)     ? req.query.status   : null;
  const priority = VALID_PRIORITIES.includes(req.query.priority)  ? req.query.priority : null;
  const category = req.query.category?.trim().slice(0, 50)        || null;

  // Construction de la clause WHERE dynamique (requêtes paramétrées)
  const conditions = ['t.user_id = ?'];
  const params     = [req.user.id];

  if (status)   { conditions.push('t.status = ?');   params.push(status); }
  if (priority) { conditions.push('t.priority = ?'); params.push(priority); }
  if (category) { conditions.push('t.category = ?'); params.push(category); }

  const where = conditions.join(' AND ');

  // Requête 1 : total pour la pagination
  const { total } = db.prepare(
    `SELECT COUNT(*) AS total FROM tasks t WHERE ${where}`
  ).get(...params);

  // Requête 2 : données paginées — SELECT ciblé, pas de SELECT *
  const tasks = db.prepare(`
    SELECT
      t.id, t.title, t.description, t.status, t.priority,
      t.category, t.due_date, t.eco_score, t.created_at, t.updated_at
    FROM tasks t
    WHERE ${where}
    ORDER BY
      CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, PAGE_SIZE, offset);

  res.json({
    data:       tasks,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    },
  });
});

/* ─── GET /api/tasks/stats/me ─────────────────────────────────── */
// Doit être avant /:id pour ne pas être interceptée par le param générique
router.get('/stats/me', requireAuth, (req, res) => {
  const db = getDB();
  const stats = db.prepare(`
    SELECT
      COUNT(*)                                    AS total,
      SUM(CASE WHEN status = 'done' THEN 1 END)  AS done,
      SUM(CASE WHEN status = 'todo' THEN 1 END)  AS todo,
      AVG(eco_score)                              AS avg_eco_score
    FROM tasks
    WHERE user_id = ?
  `).get(req.user.id);

  res.json({ data: stats });
});

/* ─── GET /api/tasks/:id ──────────────────────────────────────── */
router.get('/:id', requireAuth, (req, res) => {
  const db   = getDB();
  const task = db.prepare(`
    SELECT id, title, description, status, priority,
           category, due_date, eco_score, created_at, updated_at
    FROM tasks
    WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id);

  if (!task) return res.status(404).json({ error: 'Tâche introuvable' });
  res.json({ data: task });
});

/* ─── POST /api/tasks ─────────────────────────────────────────── */
router.post('/', requireAuth, (req, res) => {
  const { title, description, status, priority, category, due_date } = req.body;

  const err = validateTask({ title, status, priority, category });
  if (err) return res.status(400).json({ error: err });

  const db        = getDB();
  const eco_score = computeEcoScore({ description, category });

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO tasks (user_id, title, description, status, priority, category, due_date, eco_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    title.trim(),
    description?.trim() || null,
    status   || 'todo',
    priority || 'medium',
    category?.trim() || 'general',
    due_date || null,
    eco_score,
  );

  const task = db.prepare(
    'SELECT id, title, description, status, priority, category, due_date, eco_score, created_at FROM tasks WHERE id = ?'
  ).get(lastInsertRowid);

  res.status(201).json({ data: task });
});

/* ─── PATCH /api/tasks/:id ────────────────────────────────────── */
// Mise à jour partielle — seuls les champs fournis sont modifiés
router.patch('/:id', requireAuth, (req, res) => {
  const db   = getDB();
  const task = db.prepare(
    'SELECT id, user_id FROM tasks WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!task) return res.status(404).json({ error: 'Tâche introuvable' });

  const allowed  = ['title','description','status','priority','category','due_date'];
  const updates  = [];
  const values   = [];

  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(field === 'title' || field === 'description' || field === 'category'
        ? req.body[field]?.trim()
        : req.body[field]);
    }
  }

  if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

  const err = validateTask({
    title:    req.body.title    ?? 'placeholder', // placeholder pour éviter faux négatif
    status:   req.body.status,
    priority: req.body.priority,
    category: req.body.category,
  });
  if (err && req.body.title !== undefined) return res.status(400).json({ error: err });

  // Recalculer eco_score si description ou category changent
  if (req.body.description !== undefined || req.body.category !== undefined) {
    const current = db.prepare('SELECT description, category FROM tasks WHERE id = ?').get(task.id);
    const eco_score = computeEcoScore({
      description: req.body.description ?? current.description,
      category:    req.body.category    ?? current.category,
    });
    updates.push('eco_score = ?');
    values.push(eco_score);
  }

  values.push(task.id);
  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare(
    'SELECT id, title, description, status, priority, category, due_date, eco_score, updated_at FROM tasks WHERE id = ?'
  ).get(task.id);

  res.json({ data: updated });
});

/* ─── DELETE /api/tasks/:id ───────────────────────────────────── */
router.delete('/:id', requireAuth, (req, res) => {
  const db     = getDB();
  const task   = db.prepare(
    'SELECT id FROM tasks WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!task) return res.status(404).json({ error: 'Tâche introuvable' });

  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  res.json({ message: 'Tâche supprimée' });
});

module.exports = router;
