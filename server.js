require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();

// ── Conexão PostgreSQL ─────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'carteira',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

pool.connect()
  .then(c => { console.log('✅ PostgreSQL conectado'); c.release(); })
  .catch(e => { console.error('❌ Erro ao conectar no PostgreSQL:', e.message); process.exit(1); });

// ── Inicializar tabelas ────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id          TEXT PRIMARY KEY,
      description TEXT    NOT NULL,
      amount      NUMERIC NOT NULL CHECK (amount > 0),
      type        TEXT    NOT NULL CHECK (type IN ('income','expense')),
      category    TEXT    NOT NULL DEFAULT 'Geral',
      date        DATE    NOT NULL,
      recur       TEXT    DEFAULT NULL,
      recur_id    TEXT    DEFAULT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS piggybanks (
      id      TEXT PRIMARY KEY,
      name    TEXT    NOT NULL,
      goal    NUMERIC NOT NULL,
      emoji   TEXT    NOT NULL DEFAULT '🐷',
      saved   NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id       TEXT PRIMARY KEY,
      category TEXT    NOT NULL UNIQUE,
      lim      NUMERIC NOT NULL CHECK (lim > 0),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS recurrents (
      id      TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      amount  NUMERIC NOT NULL,
      freq    TEXT NOT NULL CHECK (freq IN ('monthly','quarterly','yearly')),
      category TEXT NOT NULL DEFAULT 'Geral',
      day     INT  NOT NULL DEFAULT 1 CHECK (day BETWEEN 1 AND 28),
      active  BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT INTO settings (key, value) VALUES
      ('theme','light'),('font','Inter'),('fontSize','15'),('zoom','100')
    ON CONFLICT (key) DO NOTHING;
  `);
  console.log('✅ Tabelas verificadas/criadas');
}

app.use(express.json());
app.use(express.static('.'));

// ── Helpers ────────────────────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

// ── TRANSACTIONS ───────────────────────────────────────────────────────────

// GET /api/transactions
app.get('/api/transactions', async (req, res) => {
  try {
    const { type, category, search, from, to, month, limit = 200, offset = 0 } = req.query;
    let sql = `SELECT * FROM transactions WHERE 1=1`;
    const params = [];
    let i = 1;

    if (type)     { sql += ` AND type = $${i++}`;          params.push(type); }
    if (category) { sql += ` AND category = $${i++}`;      params.push(category); }
    if (search)   { sql += ` AND description ILIKE $${i++}`; params.push(`%${search}%`); }
    if (from)     { sql += ` AND date >= $${i++}`;         params.push(from); }
    if (to)       { sql += ` AND date <= $${i++}`;         params.push(to); }
    if (month)    { sql += ` AND TO_CHAR(date,'YYYY-MM') = $${i++}`; params.push(month); }

    sql += ` ORDER BY date DESC, created_at DESC LIMIT $${i++} OFFSET $${i++}`;
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/summary
app.get('/api/summary', async (req, res) => {
  try {
    const { month } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (month) { where += ` AND TO_CHAR(date,'YYYY-MM') = $1`; params.push(month); }

    const { rows } = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense
      FROM transactions ${where}
    `, params);

    const { income, expense } = rows[0];
    res.json({ income: +income, expense: +expense, balance: income - expense });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/summary/by-category
app.get('/api/summary/by-category', async (req, res) => {
  try {
    const { month } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (month) { where += ` AND TO_CHAR(date,'YYYY-MM') = $1`; params.push(month); }

    const { rows } = await pool.query(`
      SELECT category, type, SUM(amount)::numeric AS total, COUNT(*) AS count
      FROM transactions ${where}
      GROUP BY category, type ORDER BY total DESC
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/summary/monthly - últimos N meses
app.get('/api/summary/monthly', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 6;
    const { rows } = await pool.query(`
      SELECT
        TO_CHAR(date,'YYYY-MM') AS month,
        COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0)::numeric AS income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0)::numeric AS expense
      FROM transactions
      WHERE date >= NOW() - INTERVAL '${months} months'
      GROUP BY TO_CHAR(date,'YYYY-MM')
      ORDER BY month ASC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/transactions
app.post('/api/transactions', async (req, res) => {
  try {
    const { description, amount, type, category = 'Geral', date, recur = null, recurId = null } = req.body;
    // DEPOIS — date é opcional, usa hoje se não informado
if (!description || !amount || !type)
  return res.status(400).json({ error: 'Campos obrigatórios: description, amount, type.' });
const txDate = date || new Date().toISOString().slice(0, 10);
    if (!['income','expense'].includes(type))
      return res.status(400).json({ error: 'type deve ser income ou expense.' });
    if (isNaN(amount) || +amount <= 0)
      return res.status(400).json({ error: 'amount deve ser um número positivo.' });

    const id = uid();
    await pool.query(
      `INSERT INTO transactions (id,description,amount,type,category,date,recur,recur_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, description, +amount, type, category, txDate, recur, recurId]
    );
    res.status(201).json({ id, description, amount: +amount, type, category, date, recur });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/transactions/:id
app.put('/api/transactions/:id', async (req, res) => {
  try {
    const { description, amount, type, category, date, recur } = req.body;
    const { rows } = await pool.query('SELECT * FROM transactions WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado.' });
    const tx = rows[0];
    await pool.query(
      `UPDATE transactions SET description=$1,amount=$2,type=$3,category=$4,date=$5,recur=$6 WHERE id=$7`,
      [description??tx.description, amount??tx.amount, type??tx.type, category??tx.category, date??tx.date, recur??tx.recur, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/transactions/:id
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM transactions WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Não encontrado.' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/transactions (todos)
app.delete('/api/transactions', async (req, res) => {
  try { await pool.query('DELETE FROM transactions'); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PIGGYBANKS ─────────────────────────────────────────────────────────────

app.get('/api/piggybanks', async (_, res) => {
  try { const { rows } = await pool.query('SELECT * FROM piggybanks ORDER BY created_at'); res.json(rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/piggybanks', async (req, res) => {
  try {
    const { name, goal, emoji = '🐷' } = req.body;
    if (!name || !goal) return res.status(400).json({ error: 'name e goal são obrigatórios.' });
    const id = uid();
    await pool.query('INSERT INTO piggybanks (id,name,goal,emoji) VALUES ($1,$2,$3,$4)', [id, name, +goal, emoji]);
    res.status(201).json({ id, name, goal: +goal, emoji, saved: 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/piggybanks/:id', async (req, res) => {
  try {
    const { name, goal, emoji, savedDelta } = req.body;
    const { rows } = await pool.query('SELECT * FROM piggybanks WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado.' });
    const p = rows[0];
    const newSaved = savedDelta !== undefined ? Math.max(0, +p.saved + +savedDelta) : +p.saved;
    await pool.query(
      'UPDATE piggybanks SET name=$1,goal=$2,emoji=$3,saved=$4 WHERE id=$5',
      [name??p.name, goal??p.goal, emoji??p.emoji, newSaved, req.params.id]
    );
    res.json({ ok: true, saved: newSaved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/piggybanks/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM piggybanks WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Não encontrado.' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── BUDGETS ────────────────────────────────────────────────────────────────

app.get('/api/budgets', async (_, res) => {
  try { const { rows } = await pool.query('SELECT * FROM budgets ORDER BY category'); res.json(rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/budgets', async (req, res) => {
  try {
    const { category, limit: lim } = req.body;
    if (!category || !lim) return res.status(400).json({ error: 'category e limit são obrigatórios.' });
    const id = uid();
    await pool.query(
      'INSERT INTO budgets (id,category,lim) VALUES ($1,$2,$3) ON CONFLICT (category) DO UPDATE SET lim=$3',
      [id, category, +lim]
    );
    res.status(201).json({ id, category, lim: +lim });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/budgets/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM budgets WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Não encontrado.' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RECURRENTS ─────────────────────────────────────────────────────────────

app.get('/api/recurrents', async (_, res) => {
  try { const { rows } = await pool.query('SELECT * FROM recurrents ORDER BY created_at'); res.json(rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/recurrents', async (req, res) => {
  try {
    const { description, amount, freq, category = 'Geral', day = 1 } = req.body;
    const id = uid();
    await pool.query(
      'INSERT INTO recurrents (id,description,amount,freq,category,day) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, description, +amount, freq, category, +day]
    );
    res.status(201).json({ id, description, amount: +amount, freq, category, day: +day });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/recurrents/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM recurrents WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Não encontrado.' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SETTINGS ───────────────────────────────────────────────────────────────

app.get('/api/settings', async (_, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM settings');
    const obj = {};
    rows.forEach(r => obj[r.key] = r.value);
    res.json(obj);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/settings', async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    for (const [key, value] of entries) {
      await pool.query(
        'INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2',
        [key, String(value)]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── START ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}/carteira-pwa.html`);
  });
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'carteira',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
      }
);
