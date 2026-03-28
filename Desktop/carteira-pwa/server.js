require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'carteira',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
      }
);

async function initDB() {
  await pool.query(`CREATE TABLE IF NOT EXISTS transacoes (
    id SERIAL PRIMARY KEY,
    descricao VARCHAR(255) NOT NULL,
    valor DECIMAL(10,2) NOT NULL,
    tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('receita','despesa')),
    categoria VARCHAR(100),
    data DATE NOT NULL DEFAULT CURRENT_DATE,
    criado_em TIMESTAMP DEFAULT NOW()
  )`);
  console.log('DB inicializado');
}

app.get('/api/transacoes', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM transacoes ORDER BY data DESC'); res.json(r.rows); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/transacoes', async (req, res) => {
  const { descricao, valor, tipo, categoria, data } = req.body;
  try {
    const r = await pool.query('INSERT INTO transacoes (descricao,valor,tipo,categoria,data) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [descricao, valor, tipo, categoria || null, data || new Date().toISOString().split('T')[0]]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.put('/api/transacoes/:id', async (req, res) => {
  const { descricao, valor, tipo, categoria, data } = req.body;
  try {
    const r = await pool.query('UPDATE transacoes SET descricao=$1,valor=$2,tipo=$3,categoria=$4,data=$5 WHERE id=$6 RETURNING *',
      [descricao, valor, tipo, categoria || null, data, req.params.id]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/transacoes/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM transacoes WHERE id=$1 RETURNING *', [req.params.id]);
    res.json({ mensagem: 'Removido' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/resumo', async (req, res) => {
  try {
    const r = await pool.query(`SELECT COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0) AS total_receitas, COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) AS total_despesas, COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END),0) AS saldo FROM transacoes`);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

initDB().then(() => { app.listen(PORT, () => console.log('Servidor na porta ' + PORT)); })
  .catch(err => { console.error('Erro PostgreSQL:', err.message); process.exit(1); });
