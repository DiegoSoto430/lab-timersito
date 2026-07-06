// ============================================================
// server.js — Lab Timer v3 (Railway + Supabase/PostgreSQL)
// ============================================================
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const os      = require('os');
const { Pool } = require('pg');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Conexión a Supabase via PostgreSQL ───────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── Helpers de fecha (zona horaria Hermosillo, UTC-7 fijo) ───
function horaHermosillo() {
  // Hermosillo no tiene horario de verano: siempre UTC-7
  const ahora = new Date();
  return new Date(ahora.getTime() - 7 * 60 * 60 * 1000);
}

function nowStr() {
  const d = horaHermosillo();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth()+1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function todayStr() {
  const d = horaHermosillo();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth()+1)}/${d.getUTCFullYear()}`;
}

function parseTS(ts) {
  if (!ts) return null;
  const [datePart, timePart] = ts.trim().split(' ');
  if (!datePart || !timePart) return null;
  const [dd, mm, yyyy] = datePart.split('/');
  return new Date(`${yyyy}-${mm}-${dd}T${timePart}`);
}

// ── POST /api/corrida — Crear si no existe ───────────────────
app.post('/api/corrida', async (req, res) => {
  const { id_corrida, usuario } = req.body;
  if (!id_corrida || !usuario)
    return res.status(400).json({ error: 'Faltan campos' });

  try {
    const existe = await pool.query(
      `SELECT id FROM corridas WHERE id_corrida = $1 LIMIT 1`,
      [id_corrida]
    );
    if (existe.rows.length === 0) {
      await pool.query(
        `INSERT INTO corridas (id_corrida, fecha, hora_inicio)
         VALUES ($1, $2, $3)`,
        [id_corrida, todayStr(), nowStr()]
      );
      return res.json({ ok: true, nueva: true });
    }
    res.json({ ok: true, nueva: false });
  } catch (e) {
    console.error('POST /api/corrida:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/corrida/:id/finalizar ─────────────────────────
app.patch('/api/corrida/:id_corrida/finalizar', async (req, res) => {
  const { id_corrida } = req.params;
  try {
    const r = await pool.query(
      `SELECT hora_inicio FROM corridas WHERE id_corrida = $1 LIMIT 1`,
      [id_corrida]
    );
    if (!r.rows.length)
      return res.status(404).json({ error: 'Corrida no encontrada' });

    const finStr = nowStr();
    let tiempoTotal = 0;
    const inicio  = parseTS(r.rows[0].hora_inicio);
    const finDate = parseTS(finStr);
    if (inicio && finDate && !isNaN(inicio) && !isNaN(finDate)) {
      tiempoTotal = (finDate - inicio) / 3600000;
    }

    await pool.query(
      `UPDATE corridas SET hora_fin = $1, tiempo_total = $2
       WHERE id_corrida = $3`,
      [finStr, tiempoTotal, id_corrida]
    );
    res.json({ ok: true, hora_fin: finStr, tiempo_total: tiempoTotal });
  } catch (e) {
    console.error('PATCH finalizar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/corrida/:id/area ──────────────────────────────
app.patch('/api/corrida/:id_corrida/area', async (req, res) => {
  const { id_corrida } = req.params;
  const { area, horas, usuario } = req.body;

  const colTiempo = {
    'Pretratamiento': 'tiempo_pretratamiento',
    'Extraccion':     'tiempo_extraccion',
    'Mastermix':      'tiempo_mastermix',
    'Amplificacion':  'tiempo_amplificacion'
  };
  const colAn = {
    'Pretratamiento': 'an_pretratamiento',
    'Extraccion':     'an_extraccion',
    'Mastermix':      'an_mastermix',
    'Amplificacion':  'an_amplificacion'
  };

  const areaNorm = (area || '')
    .replace('Extracción', 'Extraccion')
    .replace('Amplificación', 'Amplificacion');

  const ct = colTiempo[areaNorm];
  const ca = colAn[areaNorm];
  if (!ct) return res.status(400).json({ error: `Area invalida: "${area}"` });

  try {
    const r = await pool.query(
      `SELECT ${ct}, ${ca} FROM corridas WHERE id_corrida = $1 LIMIT 1`,
      [id_corrida]
    );
    if (!r.rows.length)
      return res.status(404).json({ error: 'Corrida no encontrada' });

    const anActual = r.rows[0][ca];
    if (anActual && anActual !== '' && anActual !== usuario) {
      return res.status(409).json({
        error: `El area ${area} ya fue capturada por ${anActual}`
      });
    }

    const nuevoTiempo = (parseFloat(r.rows[0][ct]) || 0) + horas;
    await pool.query(
      `UPDATE corridas SET ${ct} = $1, ${ca} = $2 WHERE id_corrida = $3`,
      [nuevoTiempo, usuario, id_corrida]
    );
    res.json({ ok: true, tiempo_acumulado: nuevoTiempo });
  } catch (e) {
    console.error('PATCH area:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/corridas ────────────────────────────────────────
app.get('/api/corridas', async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM corridas ORDER BY id DESC`);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/corridas/csv ────────────────────────────────────
app.get('/api/corridas/csv', async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM corridas ORDER BY id DESC`);
    const header = [
      'ID','ID Corrida','Fecha','Hora Inicio','Hora Fin','Tiempo Total (h)',
      'Pretratamiento (h)','Extraccion (h)','Mastermix (h)','Amplificacion (h)',
      'AnPretratamiento','AnExtraccion','AnMastermix','AnAmplificacion'
    ].join(',');
    const lines = r.rows.map(row => [
      row.id, row.id_corrida, row.fecha, row.hora_inicio, row.hora_fin,
      Number(row.tiempo_total).toFixed(4),
      Number(row.tiempo_pretratamiento).toFixed(4),
      Number(row.tiempo_extraccion).toFixed(4),
      Number(row.tiempo_mastermix).toFixed(4),
      Number(row.tiempo_amplificacion).toFixed(4),
      row.an_pretratamiento, row.an_extraccion,
      row.an_mastermix, row.an_amplificacion
    ].join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="corridas.csv"');
    res.send([header, ...lines].join('\n'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/corridas/activas — Sin hora_fin ────────────────
app.get('/api/corridas/activas', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id_corrida, hora_inicio,
             an_pretratamiento, an_extraccion, an_mastermix, an_amplificacion
      FROM corridas
      WHERE hora_fin IS NULL OR hora_fin = ''
      ORDER BY id DESC
    `);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/sesion/entrada — Registrar entrada a área ─────
app.post('/api/sesion/entrada', async (req, res) => {
  const { id_corrida, area, usuario } = req.body;
  if (!id_corrida || !area || !usuario)
    return res.status(400).json({ error: 'Faltan campos' });
  try {
    // Borrar sesión previa de este usuario en cualquier área de esta corrida
    await pool.query(
      `DELETE FROM sesiones_activas WHERE id_corrida=$1 AND usuario=$2`,
      [id_corrida, usuario]
    );
    // Registrar nueva entrada
    await pool.query(
      `INSERT INTO sesiones_activas (id_corrida, area, usuario, hora_entrada)
       VALUES ($1, $2, $3, $4)`,
      [id_corrida, area, usuario, nowStr()]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('POST sesion/entrada:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/sesion/salida — Limpiar sesión al confirmar ─
app.delete('/api/sesion/salida', async (req, res) => {
  const { id_corrida, usuario } = req.body;
  if (!id_corrida || !usuario)
    return res.status(400).json({ error: 'Faltan campos' });
  try {
    await pool.query(
      `DELETE FROM sesiones_activas WHERE id_corrida=$1 AND usuario=$2`,
      [id_corrida, usuario]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE sesion/salida:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/monitor — Corridas activas + sesiones en curso ─
app.get('/api/monitor', async (req, res) => {
  try {
    const corridas = await pool.query(`
      SELECT id_corrida, hora_inicio,
             an_pretratamiento, an_extraccion, an_mastermix, an_amplificacion
      FROM corridas
      WHERE hora_fin IS NULL OR hora_fin = ''
      ORDER BY id DESC
    `);
    const sesiones = await pool.query(
      `SELECT id_corrida, area, usuario, hora_entrada FROM sesiones_activas`
    );
    res.json({ corridas: corridas.rows, sesiones: sesiones.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/corrida/:id_corrida — Eliminar corrida ──────
app.delete('/api/corrida/:id_corrida', async (req, res) => {
  const { id_corrida } = req.params;
  try {
    await pool.query(`DELETE FROM corridas WHERE id_corrida=$1`, [id_corrida]);
    await pool.query(`DELETE FROM sesiones_activas WHERE id_corrida=$1`, [id_corrida]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Arrancar ─────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', async () => {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Conectado a Supabase (PostgreSQL)');
  } catch (e) {
    console.error('❌ Error conectando a Supabase:', e.message);
  }
  const ifaces = os.networkInterfaces();
  let localIP = 'localhost';
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) { localIP = addr.address; break; }
    }
  }
  console.log(`\n✅ Servidor corriendo en puerto ${PORT}`);
  console.log(`   Local:     http://localhost:${PORT}`);
  console.log(`   Red local: http://${localIP}:${PORT}/lab-timer.html\n`);
});
