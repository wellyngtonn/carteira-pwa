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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transacoes (
      id SERIAL PRIMARY KEY,
      descricao VARCHAR(255) NOT NULL,
      valor DECIMAL(10,2) NOT NULL,
      tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('receita','despesa')),
      categoria VARCHAR(100),
      data DATE NOT NULL DEFAULT CURRENT_DATE,
      criado_em TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('✅ Banco de dados inicializado');
}

app.get('/api/transacoes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transacoes ORDER BY data DESC, criado_em DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/transacoes', async (req, res) => {
  const { descricao, valor, tipo, categoria, data } = req.body;
  if (!descricao || !valor || !tipo) {
    return res.status(400).json({ erro: 'descricao, valor e tipo sao obrigatorios' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO transacoes (descricao,valor,tipo,categoria,data) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [descricao, valor, tipo, categoria || null, data || new Date().toISOString().split('T')[0]]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.put('/api/transacoes/:id', async (req, res) => {
  const { id } = req.params;
  const { descricao, valor, tipo, categoria, data } = req.body;
  try {
    const result = await pool.query(
      'UPDATE transacoes SET descricao=$1,valor=$2,tipo=$3,categoria=$4,data=$5 WHERE id=$6 RETURNING *',
      [descricao, valor, tipo, categoria || null, data, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Nao encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.delete('/api/transacoes/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM transacoes WHERE id=$1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Nao encontrado' });
    res.json({ mensagem: 'Removido com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/resumo', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0) AS total_receitas,
        COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) AS total_despesas,
        COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END),0) AS saldo
      FROM transacoes
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log('🚀 Servidor rodando na porta ' + PORT);
    });
  })
  .catch(err => {
    console.error('❌ Erro ao conectar no PostgreSQL:', err.message);
    process.exit(1);
  });