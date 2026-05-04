// EcoTask — server.js
// Stack : Node.js + Express (minimal), SQLite via better-sqlite3
// Green IT : zéro middleware inutile, réponses compressées, headers sobres

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { initDB } = require('./db');

const authRoutes  = require('./routes/auth');
const tasksRoutes = require('./routes/tasks');
const usersRoutes = require('./routes/users');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ─── Middlewares ─────────────────────────────────────────────── */
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '50kb' })); // limite volontairement basse

// Headers sécurité + Green IT (pas de X-Powered-By inutile)
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Servir le front-end statique
app.use(express.static(path.join(__dirname, '../frontend'), {
  maxAge: '1d',        // cache navigateur 1 jour pour les assets
  etag:   true,
}));

/* ─── Routes API ──────────────────────────────────────────────── */
app.use('/api/auth',  authRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/users', usersRoutes);

/* ─── Health check ────────────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

/* ─── SPA fallback ────────────────────────────────────────────── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

/* ─── Gestion des erreurs ─────────────────────────────────────── */
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error(`[${status}] ${req.method} ${req.path} — ${err.message}`);
  res.status(status).json({ error: err.message || 'Erreur serveur' });
});

/* ─── Démarrage ───────────────────────────────────────────────── */
initDB();
app.listen(PORT, () => {
  console.log(`✦ EcoTask démarré sur http://localhost:${PORT}`);
});
