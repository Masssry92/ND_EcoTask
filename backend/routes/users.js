// EcoTask — routes/users.js
// CRUD utilisateurs : lecture paginée (admin), modification, suppression
// Green IT : pagination 20/page, SELECT ciblé, pas de SELECT *

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('./auth');

const PAGE_SIZE  = 20;
const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SALT_ROUNDS = 12;

/* ─── GET /api/users ──────────────────────────────────────────── */
// Liste paginée — admin uniquement
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const db     = getDB();
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { total } = db.prepare('SELECT COUNT(*) AS total FROM users').get();

  const users = db.prepare(`
    SELECT id, email, name, role, created_at
    FROM users
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(PAGE_SIZE, offset);

  res.json({
    data: users,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    },
  });
});

/* ─── GET /api/users/:id ──────────────────────────────────────── */
// L'utilisateur peut consulter son propre profil ; l'admin peut tous les voir
router.get('/:id', requireAuth, (req, res) => {
  const targetId = parseInt(req.params.id);
  if (req.user.id !== targetId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  const db   = getDB();
  const user = db.prepare(
    'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = ?'
  ).get(targetId);

  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ data: user });
});

/* ─── PATCH /api/users/:id ────────────────────────────────────── */
// Mise à jour : l'utilisateur modifie son propre profil
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id);
    if (req.user.id !== targetId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const db = getDB();
    const { name, email, password } = req.body;

    const updates = [];
    const values  = [];

    if (name !== undefined) {
      if (name.trim().length < 2) return res.status(400).json({ error: 'Nom trop court' });
      updates.push('name = ?');
      values.push(name.trim());
    }

    if (email !== undefined) {
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email invalide' });
      const existing = db.prepare(
        'SELECT id FROM users WHERE email = ? AND id != ?'
      ).get(email.toLowerCase().trim(), targetId);
      if (existing) return res.status(409).json({ error: 'Email déjà utilisé' });
      updates.push('email = ?');
      values.push(email.toLowerCase().trim());
    }

    if (password !== undefined) {
      if (password.length < 8) return res.status(400).json({ error: 'Mot de passe trop court' });
      updates.push('password = ?');
      values.push(await bcrypt.hash(password, SALT_ROUNDS));
    }

    if (!updates.length) return res.status(400).json({ error: 'Aucun champ à modifier' });

    values.push(targetId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare(
      'SELECT id, email, name, role, updated_at FROM users WHERE id = ?'
    ).get(targetId);

    res.json({ data: updated });
  } catch (e) {
    next(e);
  }
});

/* ─── DELETE /api/users/:id ───────────────────────────────────── */
// Suppression avec confirmation explicite (champ "confirm": true dans le body)
router.delete('/:id', requireAuth, (req, res) => {
  const targetId = parseInt(req.params.id);

  // Un user peut supprimer son propre compte ; un admin peut supprimer n'importe qui
  if (req.user.id !== targetId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  // Confirmation explicite requise (pas de suppression accidentelle)
  if (req.body.confirm !== true) {
    return res.status(400).json({ error: 'Confirmation requise : { "confirm": true }' });
  }

  const db   = getDB();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  // Les tâches sont supprimées en cascade (ON DELETE CASCADE dans le schéma)
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

  res.json({ message: 'Compte supprimé' });
});

module.exports = router;
