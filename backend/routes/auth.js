// EcoTask — routes/auth.js
// Authentification : inscription, connexion, déconnexion
// Sécurité : bcrypt (argon2 possible), JWT signé, validation serveur

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { getDB } = require('../db');

const JWT_SECRET  = process.env.JWT_SECRET  || 'ecotask-dev-secret-change-in-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const SALT_ROUNDS = 12; // coût bcrypt recommandé

/* ─── Validation helpers ──────────────────────────────────────── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegister({ email, password, name }) {
  if (!name    || name.trim().length < 2)              return 'Nom trop court (min 2 caractères)';
  if (!email   || !EMAIL_RE.test(email))               return 'Email invalide';
  if (!password|| password.length < 8)                 return 'Mot de passe trop court (min 8 caractères)';
  return null;
}

function validateLogin({ email, password }) {
  if (!email   || !EMAIL_RE.test(email))  return 'Email invalide';
  if (!password || !password.length)      return 'Mot de passe requis';
  return null;
}

/* ─── POST /api/auth/register ─────────────────────────────────── */
router.post('/register', async (req, res, next) => {
  try {
    const error = validateRegister(req.body);
    if (error) return res.status(400).json({ error });

    const { email, password, name } = req.body;
    const database = getDB(); // On utilise 'database' au lieu de 'db'

    const existing = database.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(400).json({ error: 'Cet email est déjà utilisé' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = database.prepare('INSERT INTO users (email, password, name) VALUES (?, ?, ?)').run(email, hash, name);

    const newUser = database.prepare(
      'SELECT id, email, name, role FROM users WHERE id = ?'
    ).get(result.lastInsertRowid);

    const token = jwt.sign(
      { id: newUser.id, role: newUser.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.status(201).json({ token, user: newUser });
  } catch (e) {
    next(e);
  }
});

/* ─── POST /api/auth/login ────────────────────────────────────── */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const err = validateLogin({ email, password });
    if (err) return res.status(400).json({ error: err });

    const db = getDB();

    // Récupérer uniquement les colonnes nécessaires (pas SELECT *)
    const user = db.prepare(
      'SELECT id, email, name, role, password FROM users WHERE email = ?'
    ).get(email.toLowerCase().trim());

    if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)  return res.status(401).json({ error: 'Identifiants incorrects' });

    const token = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    // Ne jamais renvoyer le hash
    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (e) {
    next(e);
  }
});

/* ─── GET /api/auth/me ────────────────────────────────────────── */
router.get('/me', requireAuth, (req, res) => {
  const db   = getDB();
  const user = db.prepare(
    'SELECT id, email, name, role, created_at FROM users WHERE id = ?'
  ).get(req.user.id);

  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ user });
});

/* ─── Middleware d'authentification (exporté) ─────────────────── */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  next();
}

module.exports = router;
module.exports.requireAuth  = requireAuth;
module.exports.requireAdmin = requireAdmin;
