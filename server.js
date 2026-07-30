// ============================================================
// server.js — Lab Timer v4 (Supabase JS client, sin pg directo)
// ============================================================
const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const os           = require('os');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Conexión a Supabase via supabase-js ──────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── Helpers de fecha (Hermosillo UTC-7 fijo) ─────────────────
function horaHermosillo() {
  return new Date(Date.now() - 7 * 60 * 60 * 1000);
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

// ── POST /api/corrida ────────────────────────────────────────
app.post('/api/corrida', async (req, res) => {
  const { id_corrida, usuario } = req.body;
  if (!id_corrida || !usuario)
    return res.status(400).json({ error: 'Faltan campos' });
  try {
    const { data: existe } = await supabase
      .from('corridas')
      .select('id')
      .eq('id_corrida', id_corrida)
      .limit(1);

    if (!existe || existe.length === 0) {
      const { error } = await supabase.from('corridas').insert({
        id_corrida, fecha: todayStr(), hora_inicio: nowStr()
      });
      if (error) throw error;
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
    const { data, error } = await supabase
      .from('corridas')
      .select('hora_inicio')
      .eq('id_corrida', id_corrida)
      .limit(1);
    if (error) throw error;
    if (!data || !data.length)
      return res.status(404).json({ error: 'Corrida no encontrada' });

    const finStr = nowStr();
    let tiempoTotal = 0;
    const inicio  = parseTS(data[0].hora_inicio);
    const finDate = parseTS(finStr);
    if (inicio && finDate && !isNaN(inicio) && !isNaN(finDate)) {
      tiempoTotal = (finDate - inicio) / 3600000;
    }

    const { error: e2 } = await supabase
      .from('corridas')
      .update({ hora_fin: finStr, tiempo_total: tiempoTotal })
      .eq('id_corrida', id_corrida);
    if (e2) throw e2;

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
    const { data, error } = await supabase
      .from('corridas')
      .select(`${ct}, ${ca}`)
      .eq('id_corrida', id_corrida)
      .limit(1);
    if (error) throw error;
    if (!data || !data.length)
      return res.status(404).json({ error: 'Corrida no encontrada' });

    const anActual = data[0][ca];
    if (anActual && anActual !== '' && anActual !== usuario) {
      return res.status(409).json({
        error: `El area ${area} ya fue capturada por ${anActual}`
      });
    }

    const nuevoTiempo = (parseFloat(data[0][ct]) || 0) + horas;
    const { error: e2 } = await supabase
      .from('corridas')
      .update({ [ct]: nuevoTiempo, [ca]: usuario })
      .eq('id_corrida', id_corrida);
    if (e2) throw e2;

    res.json({ ok: true, tiempo_acumulado: nuevoTiempo });
  } catch (e) {
    console.error('PATCH area:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/corridas ────────────────────────────────────────
app.get('/api/corridas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('corridas')
      .select('*')
      .order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/corridas/csv ────────────────────────────────────
app.get('/api/corridas/csv', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('corridas')
      .select('*')
      .order('id', { ascending: false });
    if (error) throw error;

    const header = [
      'ID','ID Corrida','Fecha','Hora Inicio','Hora Fin','Tiempo Total (h)',
      'Pretratamiento (h)','Extraccion (h)','Mastermix (h)','Amplificacion (h)',
      'AnPretratamiento','AnExtraccion','AnMastermix','AnAmplificacion'
    ].join(',');
    const lines = data.map(row => [
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

// ── GET /api/corridas/activas ────────────────────────────────
app.get('/api/corridas/activas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('corridas')
      .select('id_corrida, fecha, hora_inicio, an_pretratamiento, an_extraccion, an_mastermix, an_amplificacion')
      .or('hora_fin.is.null,hora_fin.eq.')
      .order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/sesion/entrada ─────────────────────────────────
app.post('/api/sesion/entrada', async (req, res) => {
  const { id_corrida, area, usuario } = req.body;
  if (!id_corrida || !area || !usuario)
    return res.status(400).json({ error: 'Faltan campos' });
  try {
    await supabase.from('sesiones_activas')
      .delete()
      .eq('id_corrida', id_corrida)
      .eq('usuario', usuario);

    const { error } = await supabase.from('sesiones_activas').insert({
      id_corrida, area, usuario, hora_entrada: nowStr()
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('POST sesion/entrada:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/sesion/salida ────────────────────────────────
app.delete('/api/sesion/salida', async (req, res) => {
  const { id_corrida, usuario } = req.body;
  if (!id_corrida || !usuario)
    return res.status(400).json({ error: 'Faltan campos' });
  try {
    const { error } = await supabase.from('sesiones_activas')
      .delete()
      .eq('id_corrida', id_corrida)
      .eq('usuario', usuario);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE sesion/salida:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/monitor ─────────────────────────────────────────
app.get('/api/monitor', async (req, res) => {
  try {
    const { data: corridas, error: e1 } = await supabase
      .from('corridas')
      .select('id_corrida, hora_inicio, an_pretratamiento, an_extraccion, an_mastermix, an_amplificacion')
      .or('hora_fin.is.null,hora_fin.eq.')
      .order('id', { ascending: false });
    if (e1) throw e1;

    const { data: sesiones, error: e2 } = await supabase
      .from('sesiones_activas')
      .select('id_corrida, area, usuario, hora_entrada');
    if (e2) throw e2;

    res.json({ corridas, sesiones });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/corrida/:id_corrida ──────────────────────────
app.delete('/api/corrida/:id_corrida', async (req, res) => {
  const { id_corrida } = req.params;
  try {
    await supabase.from('sesiones_activas').delete().eq('id_corrida', id_corrida);
    const { error } = await supabase.from('corridas').delete().eq('id_corrida', id_corrida);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Arrancar ─────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', async () => {
  try {
    const { error } = await supabase.from('corridas').select('id').limit(1);
    if (error) throw error;
    console.log('✅ Conectado a Supabase');
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
