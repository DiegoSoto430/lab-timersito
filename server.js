// ============================================================
// server.js — Lab Timer v4 (Supabase JS client, sin pg directo)
// ============================================================
const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const os           = require('os');
const { createClient } = require('@supabase/supabase-js');
const { construirLibro } = require('./exportar');
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

// ── Helpers de casos (TiempoEmision) ─────────────────────────
const TABLA_CASOS = 'TiempoEmision';
const TABLA_DESC  = 'CasosDescartados';
const CASO_REGEX  = /^BM\d{4}-\d{3}$/;

// Prefijo del mes actual en hora Hermosillo, ej. "BM2609"
function prefijoCasos() {
  const d  = horaHermosillo();
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `BM${yy}${mm}`;
}

// ── GET /api/casos/siguientes ────────────────────────────────
// saltados:     huecos del mes actual (no registrados y no descartados)
// consecutivos: los siguientes 10 después del último registrado
// tomados:      todos los consecutivos ya registrados este mes
app.get('/api/casos/siguientes', async (req, res) => {
  try {
    const prefijo = prefijoCasos();
    const [rTom, rDesc] = await Promise.all([
      supabase.from(TABLA_CASOS).select('no_caso').like('no_caso', `${prefijo}-%`).limit(1000),
      supabase.from(TABLA_DESC).select('no_caso').like('no_caso', `${prefijo}-%`).limit(1000)
    ]);
    if (rTom.error)  throw rTom.error;
    if (rDesc.error) throw rDesc.error;

    const num = r => parseInt(r.no_caso.slice(-3), 10);
    const tomados     = new Set(rTom.data.map(num));
    const descartados = new Set(rDesc.data.map(num));
    const ultimo      = tomados.size ? Math.max(...tomados) : 0;

    const saltados = [];
    for (let n = 1; n < ultimo; n++) {
      if (!tomados.has(n) && !descartados.has(n)) saltados.push(n);
    }
    const consecutivos = [];
    for (let n = ultimo + 1; n <= Math.min(ultimo + 10, 999); n++) consecutivos.push(n);

    res.json({ prefijo, saltados, consecutivos, tomados: [...tomados] });
  } catch (e) {
    console.error('GET casos/siguientes:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/casos/descartar ────────────────────────────────
// Quita un caso saltado de las opciones del menú (no lo borra de TiempoEmision)
app.post('/api/casos/descartar', async (req, res) => {
  const { no_caso } = req.body;
  if (!CASO_REGEX.test(no_caso || '') || !no_caso.startsWith(prefijoCasos() + '-'))
    return res.status(400).json({ error: 'Caso inválido' });
  try {
    const { data: tomado, error: e1 } = await supabase
      .from(TABLA_CASOS).select('id').eq('no_caso', no_caso).limit(1);
    if (e1) throw e1;
    if (tomado && tomado.length)
      return res.status(409).json({ error: 'Ese caso ya está registrado en una corrida' });

    const { error } = await supabase
      .from(TABLA_DESC)
      .upsert({ no_caso }, { onConflict: 'no_caso', ignoreDuplicates: true });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('POST casos/descartar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/casos/pendientes ────────────────────────────────
// Casos de TiempoEmision que aún no se reportan (reportado = false)
app.get('/api/casos/pendientes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLA_CASOS)
      .select('id, id_corrida, no_caso')
      .eq('reportado', false)
      .order('no_caso', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error('GET casos/pendientes:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/casos/:no_caso/reportar ───────────────────────
// Marca el caso como reportado y registra fecha/hora en emision (texto DD/MM/YYYY HH:MM:SS, igual que las otras tablas)
app.patch('/api/casos/:no_caso/reportar', async (req, res) => {
  const { no_caso } = req.params;
  if (!CASO_REGEX.test(no_caso))
    return res.status(400).json({ error: 'Caso inválido' });
  try {
    const { data, error } = await supabase
      .from(TABLA_CASOS)
      .update({ reportado: true, emision: nowStr() })
      .eq('no_caso', no_caso)
      .eq('reportado', false)
      .select('no_caso, emision');
    if (error) throw error;
    if (!data || !data.length)
      return res.status(409).json({ error: 'El caso no existe o ya fue reportado' });
    res.json({ ok: true, emision: data[0].emision });
  } catch (e) {
    console.error('PATCH casos/reportar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Exportaciones ────────────────────────────────────────────
// Trae TODAS las filas de una tabla (Supabase devuelve máx. 1000 por consulta)
async function traerTodo(tabla) {
  const PASO = 1000;
  const filas = [];
  for (let desde = 0; ; desde += PASO) {
    const { data, error } = await supabase
      .from(tabla)
      .select('*')
      .order('id', { ascending: false })
      .range(desde, desde + PASO - 1);
    if (error) throw error;
    filas.push(...data);
    if (data.length < PASO) break;
  }
  return filas;
}

// ── GET /api/exportar ────────────────────────────────────────
// Excel con dos hojas: Corridas y TiempoEmision
app.get('/api/exportar', async (req, res) => {
  try {
    const [corridas, casos] = await Promise.all([
      traerTodo('corridas'),
      traerTodo(TABLA_CASOS)
    ]);
    const wb = await construirLibro(corridas, casos);
    const d = horaHermosillo();
    const p = n => String(n).padStart(2, '0');
    const fecha = `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="lab-timer_${fecha}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('GET exportar:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ── GET /api/casos/csv ───────────────────────────────────────
app.get('/api/casos/csv', async (req, res) => {
  try {
    const casos = await traerTodo(TABLA_CASOS);
    const header = ['id_corrida', 'no_caso', 'emision', 'reportado'].join(',');
    const lines = casos.map(c =>
      [c.id_corrida, c.no_caso, c.emision ?? '', c.reportado ? 'TRUE' : 'FALSE'].join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tiempoemision.csv"');
    res.send([header, ...lines].join('\n'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/corrida/:id/existe ──────────────────────────────
app.get('/api/corrida/:id_corrida/existe', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('corridas')
      .select('id')
      .eq('id_corrida', req.params.id_corrida)
      .limit(1);
    if (error) throw error;
    res.json({ existe: !!(data && data.length) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/corrida ────────────────────────────────────────
// body: { id_corrida, usuario, casos?: ["BM2609-031", ...] }
// Si la corrida es nueva y vienen casos, también los registra en TiempoEmision.
app.post('/api/corrida', async (req, res) => {
  const { id_corrida, usuario, casos } = req.body;
  if (!id_corrida || !usuario)
    return res.status(400).json({ error: 'Faltan campos' });

  if (casos !== undefined) {
    const valido = Array.isArray(casos) && casos.length > 0 &&
                   casos.every(c => typeof c === 'string' && CASO_REGEX.test(c));
    if (!valido)
      return res.status(400).json({ error: 'Lista de casos inválida' });
  }

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

      if (casos && casos.length) {
        const filas = casos.map(no_caso => ({ id_corrida, no_caso, reportado: false }));
        const { error: eCasos } = await supabase.from(TABLA_CASOS).insert(filas);
        if (eCasos) {
          // Deshacer la corrida recién creada para no dejarla a medias
          await supabase.from('corridas').delete().eq('id_corrida', id_corrida);
          console.error('POST /api/corrida (casos):', eCasos.message);
          const duplicado = eCasos.code === '23505';
          return res.status(duplicado ? 409 : 500).json({
            error: duplicado
              ? 'Alguno de esos casos ya fue tomado por otra corrida. Vuelve a intentarlo.'
              : eCasos.message
          });
        }
      }
      if (casos && casos.length) {
        await supabase.from(TABLA_DESC).delete().in('no_caso', casos); // best-effort
      }
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
    await supabase.from(TABLA_CASOS).delete().eq('id_corrida', id_corrida);
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
