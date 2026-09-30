// ============================================================
// exportar.js — Genera el libro de Excel (corridas + TiempoEmision)
// ============================================================
const ExcelJS = require('exceljs');

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

function estilizarHoja(ws) {
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
}

async function construirLibro(corridas, casos) {
  const wb = new ExcelJS.Workbook();

  // ── Hoja 1: Corridas ───────────────────────────────────────
  const wsC = wb.addWorksheet('Corridas');
  wsC.columns = [
    { header: 'ID',                 key: 'id',                    width: 8  },
    { header: 'ID Corrida',         key: 'id_corrida',            width: 12 },
    { header: 'Fecha',              key: 'fecha',                 width: 13 },
    { header: 'Hora Inicio',        key: 'hora_inicio',           width: 21 },
    { header: 'Hora Fin',           key: 'hora_fin',              width: 21 },
    { header: 'Tiempo Total (h)',   key: 'tiempo_total',          width: 17, style: { numFmt: '0.0000' } },
    { header: 'Pretratamiento (h)', key: 'tiempo_pretratamiento', width: 20, style: { numFmt: '0.0000' } },
    { header: 'Extraccion (h)',     key: 'tiempo_extraccion',     width: 16, style: { numFmt: '0.0000' } },
    { header: 'Mastermix (h)',      key: 'tiempo_mastermix',      width: 15, style: { numFmt: '0.0000' } },
    { header: 'Amplificacion (h)',  key: 'tiempo_amplificacion',  width: 18, style: { numFmt: '0.0000' } },
    { header: 'AnPretratamiento',   key: 'an_pretratamiento',     width: 18 },
    { header: 'AnExtraccion',       key: 'an_extraccion',         width: 14 },
    { header: 'AnMastermix',        key: 'an_mastermix',          width: 14 },
    { header: 'AnAmplificacion',    key: 'an_amplificacion',      width: 17 }
  ];
  for (const r of corridas) {
    wsC.addRow({
      id: r.id, id_corrida: r.id_corrida, fecha: r.fecha,
      hora_inicio: r.hora_inicio, hora_fin: r.hora_fin,
      tiempo_total: num(r.tiempo_total),
      tiempo_pretratamiento: num(r.tiempo_pretratamiento),
      tiempo_extraccion: num(r.tiempo_extraccion),
      tiempo_mastermix: num(r.tiempo_mastermix),
      tiempo_amplificacion: num(r.tiempo_amplificacion),
      an_pretratamiento: r.an_pretratamiento, an_extraccion: r.an_extraccion,
      an_mastermix: r.an_mastermix, an_amplificacion: r.an_amplificacion
    });
  }
  estilizarHoja(wsC);

  // ── Hoja 2: TiempoEmision ──────────────────────────────────
  const wsT = wb.addWorksheet('TiempoEmision');
  wsT.columns = [
    { header: 'id_corrida', key: 'id_corrida', width: 12 },
    { header: 'no_caso',    key: 'no_caso',    width: 16 },
    { header: 'emision',    key: 'emision',    width: 21 },
    { header: 'reportado',  key: 'reportado',  width: 12 }
  ];
  for (const c of casos) {
    wsT.addRow({
      id_corrida: c.id_corrida, no_caso: c.no_caso,
      emision: c.emision || null, reportado: !!c.reportado
    });
  }
  estilizarHoja(wsT);

  return wb;
}

module.exports = { construirLibro };
