/* =====================================================================
   AretesApp - Backend en Google Apps Script + Google Sheets
   ---------------------------------------------------------------------
   Base de datos: la hoja de cálculo donde está pegado este script.
   Expone un Web App (doGet / doPost) que consumen habilitado.html y
   digitador.html.

   INSTALACIÓN (resumen, ver INSTALACION.md):
     1. Crea una hoja de cálculo nueva en Google Sheets.
     2. Extensiones > Apps Script. Pega TODO este archivo.
     3. Ejecuta una vez la función  inicializar()  (crea las pestañas
        y carga los datos de prueba). Autoriza los permisos.
     4. Implementar > Nueva implementación > Aplicación web:
          - Ejecutar como: Yo
          - Quién tiene acceso: Cualquier persona
        Copia la URL /exec y pégala en backend.js (SCRIPT_URL).
   ===================================================================== */

// ---- Nombres de las hojas ------------------------------------------
var SH = {
  CONFIG: 'Config',
  HABILITADOS: 'Habilitados',
  PRODUCTORES: 'Productores',
  EXPEDIENTES: 'Expedientes',
  DETALLE: 'Detalle',
  CUES: 'CUES',
  COLA: 'ColaCue'
};

// =====================================================================
//  ENRUTADORES WEB
// =====================================================================
function doGet(e) {
  var accion = (e && e.parameter && e.parameter.action) || '';
  try {
    switch (accion) {
      case 'config':               return json(getConfig());
      case 'habilitados':          return json(getHabilitados());
      case 'login':                return json(login(e.parameter.numero, e.parameter.pin));
      case 'buscarProductor':      return json(buscarProductor(e.parameter.cupa));
      case 'expedientesHabilitado':return json(getExpedientesDeHabilitado(e.parameter.numero));
      case 'pendientes':           return json(getPendientes());
      case 'confirmados':          return json(getConfirmados());
      case 'estadoCue':            return json(estadoCue(e.parameter.cue));
      case 'cues':                 return json(getCues());
      case 'resultadoCue':         return json(resultadoCue(e.parameter.jobId));
      case 'trabajosPendientes':   return json(trabajosPendientes());
      default:                     return json({ status: 'error', message: 'Acción GET no reconocida: ' + accion });
    }
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json({ status: 'error', message: 'JSON inválido' }); }

  try {
    switch (body.tipo) {
      case 'crearExpediente':  return json(crearExpediente(body.datos));
      case 'aprobar':          return json(aprobarExpediente(body.id, body.recibo, body.controlPago, body.recibos));
      case 'actualizarExpediente': return json(actualizarExpediente(body.id, body.datos));
      case 'marcarEntregado':  return json(marcarProductorEntregado(body.expedienteId, body.indice, body.entregado));
      case 'saveConfig':       return json(saveConfig(body));
      case 'guardarCue':       return json(guardarCue(body));
      case 'solicitarCue':          return json(solicitarCue(body.cue, body.habilitadoNumero));
      case 'entregarResultadoCue':  return json(entregarResultadoCue(body.jobId, body.datos));
      default:                 return json({ status: 'error', message: 'Operación POST no reconocida: ' + body.tipo });
    }
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =====================================================================
//  UTILIDADES DE HOJAS
// =====================================================================
function libro() { return SpreadsheetApp.getActiveSpreadsheet(); }
function hoja(nombre) {
  var sh = libro().getSheetByName(nombre);
  if (!sh) throw new Error('Falta la hoja "' + nombre + '". Ejecuta inicializar().');
  return sh;
}

// Lee una hoja completa como array de objetos (usa la 1a fila como encabezados)
function leerObjetos(nombre) {
  var sh = hoja(nombre);
  var datos = sh.getDataRange().getValues();
  if (datos.length < 2) return [];
  var headers = datos[0];
  var filas = [];
  for (var i = 1; i < datos.length; i++) {
    var obj = { _fila: i + 1 };
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = datos[i][j];
    filas.push(obj);
  }
  return filas;
}

function esVerdadero(v) { return v === true || String(v).toUpperCase() === 'TRUE' || v === 'SI' || v === 'sí'; }

// =====================================================================
//  CONFIG
// =====================================================================
function getConfig() {
  var sh = hoja(SH.CONFIG);
  var v = sh.getRange(2, 1, 1, 5).getValues()[0];
  var precio = Number(v[0]) || 0;
  var ini = Number(v[1]) || 0;
  var fin = Number(v[2]) || 0;
  var factor = Number(v[3]) || 1.5;   // factor de carga: capacidad = área bovina × factor
  var umbral = Number(v[4]) || 85;    // % de ocupación que dispara el estado "casi lleno"
  return { precio: precio, cuiaSiguiente: ini, cuiaFinLote: fin,
           disponible: Math.max(0, fin - ini + 1), factorCarga: factor, umbralAlerta: umbral };
}

function saveConfig(d) {
  var sh = hoja(SH.CONFIG);
  sh.getRange(1, 4, 1, 2).setValues([['factorCarga', 'umbralAlerta']]).setFontWeight('bold');
  sh.getRange(2, 1, 1, 5).setValues([[Number(d.precio), Number(d.cuiaSiguiente), Number(d.cuiaFinLote),
    Number(d.factorCarga) || 1.5, Number(d.umbralAlerta) || 85]]);
  return { status: 'success' };
}

// =====================================================================
//  HABILITADOS
// =====================================================================
function getHabilitados() {
  return leerObjetos(SH.HABILITADOS).map(function (h) {
    return { numero: String(h.numero), nombre: h.nombre, cedula: String(h.cedula), estado: h.estado };
  });
}

function login(numero, pin) {
  var h = leerObjetos(SH.HABILITADOS).filter(function (x) {
    return String(x.numero).trim() === String(numero).trim() && String(x.pin).trim() === String(pin).trim();
  })[0];
  if (!h) return { status: 'error', message: 'Número o PIN incorrecto' };
  // Solo se bloquea si el estado dice explícitamente PENDIENTE / INACTIVO / BLOQUEADO.
  // Si está vacío o dice ACTIVO, se permite entrar.
  var estado = String(h.estado || '').trim().toUpperCase();
  if (estado === 'PENDIENTE' || estado === 'INACTIVO' || estado === 'BLOQUEADO')
    return { status: 'pendiente', message: 'Cuenta ' + estado.toLowerCase() + '. Contacta al digitador.' };
  return { status: 'ok', habilitado: { numero: String(h.numero).trim(), nombre: String(h.nombre).trim(), cedula: String(h.cedula), estado: estado || 'ACTIVO' } };
}

// =====================================================================
//  PRODUCTORES (autocompletar)
// =====================================================================
function buscarProductor(cupa) {
  var key = String(cupa || '').trim().toUpperCase();
  var p = leerObjetos(SH.PRODUCTORES).filter(function (x) { return String(x.cupa).toUpperCase() === key; })[0];
  if (!p) return null;
  return { cupa: String(p.cupa), nombre: p.nombre, cue: String(p.cue), habilitadoNumero: String(p.habilitadoNumero) };
}

function upsertProductor(cupa, nombre, cue, habNum) {
  var sh = hoja(SH.PRODUCTORES);
  var key = String(cupa || '').trim().toUpperCase();
  if (!key) return;
  var datos = leerObjetos(SH.PRODUCTORES);
  var existe = datos.filter(function (x) { return String(x.cupa).toUpperCase() === key; })[0];
  if (existe) {
    sh.getRange(existe._fila, 1, 1, 4).setValues([[key, nombre, cue, habNum]]);
  } else {
    sh.appendRow([key, nombre, cue, habNum]);
  }
}

// =====================================================================
//  EXPEDIENTES + DETALLE
// =====================================================================
function nuevoId() {
  var exps = leerObjetos(SH.EXPEDIENTES);
  var max = 0;
  exps.forEach(function (e) { var n = Number(e.id); if (n > max) max = n; });
  return max + 1;
}

// Arma un expediente con su lista de productores (desde Detalle)
function armarExpediente(e, detallePorExp) {
  var prods = (detallePorExp[e.id] || []).sort(function (a, b) { return Number(a.idx) - Number(b.idx); });
  return {
    id: Number(e.id),
    fecha: fechaLegible(e.fecha),
    categoria: e.categoria,
    habilitadoNumero: String(e.habilitadoNumero),
    habilitadoNombre: e.habilitadoNombre,
    estado: e.estado,
    recibo: String(e.recibo || ''),
    controlPago: esVerdadero(e.controlPago),
    totalAretes: Number(e.totalAretes) || 0,
    total: Number(e.total) || 0,
    fechaAprobacion: fechaLegible(e.fechaAprobacion),
    productores: prods.map(function (p) {
      return {
        cupa: String(p.cupa || ''),
        nombre: p.nombre || '',
        cue: String(p.cue || ''),
        cantidad: Number(p.cantidad) || 0,
        cuiaInicial: p.cuiaInicial === '' || p.cuiaInicial === null ? null : Number(p.cuiaInicial),
        cuiaFinal: p.cuiaFinal === '' || p.cuiaFinal === null ? null : Number(p.cuiaFinal),
        entregado: esVerdadero(p.entregado),
        recibo: String(p.recibo || '')
      };
    })
  };
}

function agruparDetalle() {
  var mapa = {};
  leerObjetos(SH.DETALLE).forEach(function (d) {
    var k = Number(d.expedienteId);
    (mapa[k] = mapa[k] || []).push(d);
  });
  return mapa;
}

function getExpedientes(filtro) {
  var det = agruparDetalle();
  return leerObjetos(SH.EXPEDIENTES)
    .map(function (e) { return armarExpediente(e, det); })
    .filter(filtro);
}

function getExpedientesDeHabilitado(numero) {
  return getExpedientes(function (e) { return String(e.habilitadoNumero) === String(numero); })
    .sort(function (a, b) { return b.id - a.id; });
}

function getPendientes() {
  return getExpedientes(function (e) { return e.estado === 'PENDIENTE_PAGO'; })
    .sort(function (a, b) { return a.id - b.id; });
}

function getConfirmados() {
  return getExpedientes(function (e) { return e.estado === 'PAGADO' || e.estado === 'ENTREGADO'; })
    .sort(function (a, b) { return b.id - a.id; });
}

// =====================================================================
//  ESTADO DEL CUE (capacidad de carga del establecimiento)
//  capacidad  = área bovina declarada (Mz) × factorCarga (Config, def. 1.5)
//  estimado   = bovinos según SNITB + aretes entregados por la operadora
//               DESDE la fecha del dato (Opción B)
// =====================================================================
function hojaCues() {
  var ss = libro();
  var sh = ss.getSheetByName(SH.CUES);
  if (!sh) {
    sh = ss.insertSheet(SH.CUES);
    sh.getRange(1, 1, 1, 5).setValues([['cue', 'nombre', 'areaBovino', 'bovinos', 'fechaDato']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getCues() {
  hojaCues();
  return leerObjetos(SH.CUES).map(function (x) {
    return { cue: String(x.cue), nombre: x.nombre || '', areaBovino: Number(x.areaBovino) || 0,
             bovinos: Number(x.bovinos) || 0, fechaDato: fechaLegible(x.fechaDato) };
  });
}

function guardarCue(d) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = hojaCues();
    if (!soloDigitos(d.cue)) return { status: 'error', message: 'CUE inválido' };
    var reg = leerObjetos(SH.CUES).filter(function (x) { return mismoCue(x.cue, d.cue); })[0];
    var fila = [String(d.cue).trim(), d.nombre || '', Number(d.areaBovino) || 0,
                Number(d.bovinos) || 0, d.fechaDato || fechaHoy()];
    if (reg) sh.getRange(reg._fila, 1, 1, 5).setValues([fila]);
    else sh.appendRow(fila);
    return { status: 'success' };
  } finally {
    lock.releaseLock();
  }
}

function estadoCue(cue) {
  hojaCues();
  var cfg = getConfig();
  var reg = leerObjetos(SH.CUES).filter(function (x) { return mismoCue(x.cue, cue); })[0];
  if (!reg) return { status: 'sin_datos', cue: String(cue || '').trim() };

  var area = Number(reg.areaBovino) || 0;
  var bovinos = Number(reg.bovinos) || 0;
  var capacidad = Math.floor(area * cfg.factorCarga);
  var fechaDato = fechaLegible(reg.fechaDato);
  var fBase = parseFecha(fechaDato);

  // Opción B: sumar aretes entregados por la operadora desde la fecha del dato
  var entregados = 0;
  var det = agruparDetalle();
  leerObjetos(SH.EXPEDIENTES).forEach(function (e) {
    if (e.estado !== 'PAGADO' && e.estado !== 'ENTREGADO') return;
    var fAp = parseFecha(fechaLegible(e.fechaAprobacion)) || parseFecha(fechaLegible(e.fecha));
    if (fBase && fAp && fAp < fBase) return; // solo entregas desde la fecha del dato (inclusive)
    (det[Number(e.id)] || []).forEach(function (d) {
      if (mismoCue(d.cue, cue)) entregados += Number(d.cantidad) || 0;
    });
  });

  var estimado = bovinos + entregados;
  var disponibles = capacidad - estimado;
  var pct = capacidad > 0 ? Math.round(estimado * 100 / capacidad) : 0;
  var estado = 'DISPONIBLE';
  if (capacidad <= 0) estado = 'SIN_DATOS';
  else if (disponibles <= 0) estado = 'LLENO';
  else if (pct >= cfg.umbralAlerta) estado = 'CASI_LLENO';
  var viejo = !fBase || ((new Date()).getTime() - fBase.getTime()) > 60 * 24 * 3600 * 1000;

  return { status: 'ok', cue: String(reg.cue), nombre: reg.nombre || '', areaBovino: area,
           factor: cfg.factorCarga, capacidad: capacidad, bovinosIpsa: bovinos, fechaDato: fechaDato,
           entregadosDespues: entregados, estimado: estimado, disponibles: disponibles,
           porcentaje: pct, estado: estado, datoViejo: viejo };
}

// =====================================================================
//  RELAY EN VIVO (cola de consultas de CUE al SNITB)
//  El habilitado pide -> se encola -> el bot de guardia (navegador del
//  digitador) lo toma, consulta el SNITB con su sesión y devuelve el
//  dato. De paso se cachea en CUES (respaldo para cuando el bot no está).
// =====================================================================
function hojaCola() {
  var ss = libro();
  var sh = ss.getSheetByName(SH.COLA);
  if (!sh) {
    sh = ss.insertSheet(SH.COLA);
    sh.getRange(1, 1, 1, 7).setValues([['jobId', 'cue', 'hab', 'estado', 'tsSolicitud', 'tsResultado', 'resultado']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function purgarCola_(sh) {
  var ahora = new Date().getTime();
  var viejas = leerObjetos(SH.COLA)
    .filter(function (d) { return (ahora - Number(d.tsSolicitud || 0)) > 5 * 60 * 1000; })
    .map(function (d) { return d._fila; })
    .sort(function (a, b) { return b - a; });
  viejas.forEach(function (f) { sh.deleteRow(f); });
}

// El habilitado solicita: encola y devuelve de inmediato el dato en caché (si hay)
function solicitarCue(cue, hab) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = hojaCola();
    purgarCola_(sh);
    var jobId = Utilities.getUuid();
    sh.appendRow([jobId, soloDigitos(cue), String(hab || ''), 'PENDIENTE', new Date().getTime(), '', '']);
    return { status: 'ok', jobId: jobId, cache: estadoCue(cue) };
  } finally {
    lock.releaseLock();
  }
}

// El bot de guardia pregunta qué hay pendiente (y lo reclama para no repetir)
function trabajosPendientes() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = hojaCola();
    var pend = leerObjetos(SH.COLA).filter(function (d) { return d.estado === 'PENDIENTE'; });
    pend.forEach(function (d) { sh.getRange(d._fila, 4).setValue('EN_PROCESO'); });
    return pend.map(function (d) { return { jobId: String(d.jobId), cue: String(d.cue) }; });
  } finally {
    lock.releaseLock();
  }
}

// El bot devuelve el dato scrapeado: se cachea en CUES y se computa el estado (Opción B)
function entregarResultadoCue(jobId, datos) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = hojaCola();
    var job = leerObjetos(SH.COLA).filter(function (d) { return String(d.jobId) === String(jobId); })[0];
    if (!job) return { status: 'error', message: 'Job no encontrado' };
    var resultado;
    if (datos && datos.error) {
      sh.getRange(job._fila, 4).setValue('ERROR');
      resultado = JSON.stringify({ status: 'error', message: String(datos.error) });
    } else {
      guardarCue({ cue: datos.cue, nombre: datos.nombre, areaBovino: datos.areaBovino, bovinos: datos.bovinos, fechaDato: fechaHoy() });
      var est = estadoCue(datos.cue);
      est.enVivo = true;
      sh.getRange(job._fila, 4).setValue('LISTO');
      resultado = JSON.stringify(est);
    }
    sh.getRange(job._fila, 6).setValue(new Date().getTime());
    sh.getRange(job._fila, 7).setValue(resultado);
    return { status: 'success' };
  } finally {
    lock.releaseLock();
  }
}

// El habilitado consulta si su pedido ya tiene respuesta
function resultadoCue(jobId) {
  var job = leerObjetos(SH.COLA).filter(function (d) { return String(d.jobId) === String(jobId); })[0];
  if (!job) return { status: 'expirado' };
  if (job.estado === 'LISTO') {
    try { return { status: 'listo', datos: JSON.parse(job.resultado) }; }
    catch (e) { return { status: 'error', message: 'Resultado ilegible' }; }
  }
  if (job.estado === 'ERROR') {
    try { var r = JSON.parse(job.resultado); return { status: 'error', message: r.message || 'error' }; }
    catch (e) { return { status: 'error', message: 'error' }; }
  }
  return { status: 'pendiente' };
}

// ---- Crear expediente (lo hace el habilitado) ----------------------
function crearExpediente(datos) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cfg = getConfig();
    var prods = (datos.productores || []).map(function (p) {
      return {
        cupa: String(p.cupa || '').trim().toUpperCase(),
        nombre: p.nombre || '',
        cue: String(p.cue || '').trim(),
        cantidad: Number(p.cantidad) || 0
      };
    });
    if (prods.length === 0) return { status: 'error', message: 'Agrega al menos un productor' };
    if (prods.some(function (p) { return p.cantidad <= 0; })) return { status: 'error', message: 'Toda cantidad debe ser mayor que 0' };

    var totalAretes = prods.reduce(function (s, p) { return s + p.cantidad; }, 0);
    var total = totalAretes * cfg.precio;
    var id = nuevoId();
    var fecha = datos.fecha || fechaHoy();

    hoja(SH.EXPEDIENTES).appendRow([
      id, fecha, datos.categoria || 'PRODUCTORES',
      datos.habilitadoNumero, datos.habilitadoNombre,
      'PENDIENTE_PAGO', '', 'FALSE', totalAretes, total, ''
    ]);

    var shDet = hoja(SH.DETALLE);
    prods.forEach(function (p, i) {
      shDet.appendRow([id, i, p.cupa, p.nombre, p.cue, p.cantidad, '', '', 'FALSE', '']);
      upsertProductor(p.cupa, p.nombre, p.cue, datos.habilitadoNumero);
    });

    return { status: 'success', id: id };
  } finally {
    lock.releaseLock();
  }
}

// ---- Editar expediente (solo mientras está PENDIENTE_PAGO) ---------
function actualizarExpediente(id, datos) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    id = Number(id);
    var shExp = hoja(SH.EXPEDIENTES);
    var exp = leerObjetos(SH.EXPEDIENTES).filter(function (e) { return Number(e.id) === id; })[0];
    if (!exp) return { status: 'error', message: 'Expediente no encontrado' };
    if (exp.estado !== 'PENDIENTE_PAGO') return { status: 'error', message: 'Solo se puede editar un expediente Pendiente de Pago' };

    var cfg = getConfig();
    var prods = (datos.productores || []).map(function (p) {
      return {
        cupa: String(p.cupa || '').trim().toUpperCase(),
        nombre: p.nombre || '',
        cue: String(p.cue || '').trim(),
        cantidad: Number(p.cantidad) || 0
      };
    });
    if (prods.length === 0) return { status: 'error', message: 'Agrega al menos un productor' };
    if (prods.some(function (p) { return p.cantidad <= 0; })) return { status: 'error', message: 'Toda cantidad debe ser mayor que 0' };

    var totalAretes = prods.reduce(function (s, p) { return s + p.cantidad; }, 0);
    var total = totalAretes * cfg.precio;

    // Actualiza la fila del expediente: fecha(2) categoria(3) totalAretes(9) total(10)
    shExp.getRange(exp._fila, 2).setValue(datos.fecha || fechaLegible(exp.fecha));
    shExp.getRange(exp._fila, 3).setValue(datos.categoria || exp.categoria);
    shExp.getRange(exp._fila, 9).setValue(totalAretes);
    shExp.getRange(exp._fila, 10).setValue(total);

    // Reemplaza el detalle: borra las filas viejas (de abajo hacia arriba) y agrega las nuevas
    var shDet = hoja(SH.DETALLE);
    var viejas = leerObjetos(SH.DETALLE)
      .filter(function (d) { return Number(d.expedienteId) === id; })
      .map(function (d) { return d._fila; })
      .sort(function (a, b) { return b - a; });
    viejas.forEach(function (f) { shDet.deleteRow(f); });

    prods.forEach(function (p, i) {
      shDet.appendRow([id, i, p.cupa, p.nombre, p.cue, p.cantidad, '', '', 'FALSE', '']);
      upsertProductor(p.cupa, p.nombre, p.cue, exp.habilitadoNumero);
    });

    return { status: 'success' };
  } finally {
    lock.releaseLock();
  }
}

// ---- Aprobar: asigna CUIA por productor y descuenta lote -----------
function aprobarExpediente(id, recibo, controlPago, recibos) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    id = Number(id);
    var porProd = recibos && recibos.length > 0;
    if (!recibo && !porProd) return { status: 'error', message: 'Falta el número de recibo (DOCUMENTO)' };

    var shExp = hoja(SH.EXPEDIENTES);
    var exps = leerObjetos(SH.EXPEDIENTES);
    var exp = exps.filter(function (e) { return Number(e.id) === id; })[0];
    if (!exp) return { status: 'error', message: 'Expediente no encontrado' };
    if (exp.estado !== 'PENDIENTE_PAGO') return { status: 'error', message: 'El expediente ya fue procesado' };

    var cfg = getConfig();
    var totalAretes = Number(exp.totalAretes) || 0;
    if (totalAretes > cfg.disponible) {
      return { status: 'error', message: 'El lote no alcanza (disponible: ' + cfg.disponible + ', requiere: ' + totalAretes + ')' };
    }

    // Asigna rangos consecutivos productor por productor
    var shDet = hoja(SH.DETALLE);
    // Auto-crea la columna 'recibo' en Detalle si la hoja es de una versión anterior
    if (String(shDet.getRange(1, 10).getValue()) !== 'recibo') {
      shDet.getRange(1, 10).setValue('recibo').setFontWeight('bold');
    }
    var det = leerObjetos(SH.DETALLE)
      .filter(function (d) { return Number(d.expedienteId) === id; })
      .sort(function (a, b) { return Number(a.idx) - Number(b.idx); });

    if (porProd) {
      if (recibos.length !== det.length) return { status: 'error', message: 'Debe haber un recibo por cada productor (' + det.length + ')' };
      for (var ri = 0; ri < recibos.length; ri++) {
        if (!String(recibos[ri] || '').replace(/\s/g, '')) return { status: 'error', message: 'Falta el recibo del productor #' + (ri + 1) };
      }
    }

    var cursor = cfg.cuiaSiguiente;
    det.forEach(function (d, i) {
      var cant = Number(d.cantidad) || 0;
      var ini = cursor;
      var fin = cursor + cant - 1;
      shDet.getRange(d._fila, 7, 1, 2).setValues([[ini, fin]]); // cols cuiaInicial, cuiaFinal
      shDet.getRange(d._fila, 10).setValue(porProd ? String(recibos[i]).trim() : String(recibo).trim());
      cursor = fin + 1;
    });

    // Actualiza Config (nuevo cuiaSiguiente)
    hoja(SH.CONFIG).getRange(2, 2).setValue(cursor);

    // Actualiza el expediente
    // columnas: id(1) fecha(2) categoria(3) habNum(4) habNom(5) estado(6) recibo(7) controlPago(8) totalAretes(9) total(10) fechaAprobacion(11)
    var reciboExp = recibo;
    if (porProd) {
      var unicos = [];
      recibos.forEach(function (r) { r = String(r).trim(); if (unicos.indexOf(r) === -1) unicos.push(r); });
      reciboExp = unicos.join(', ');
    }
    shExp.getRange(exp._fila, 6).setValue('PAGADO');
    shExp.getRange(exp._fila, 7).setValue(String(reciboExp).trim());
    shExp.getRange(exp._fila, 8).setValue(controlPago ? 'TRUE' : 'FALSE');
    shExp.getRange(exp._fila, 11).setValue(fechaHoy());

    return { status: 'success' };
  } finally {
    lock.releaseLock();
  }
}

// ---- Marcar productor entregado en IPSA ----------------------------
function marcarProductorEntregado(expedienteId, indice, entregado) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    expedienteId = Number(expedienteId);
    indice = Number(indice);
    var shDet = hoja(SH.DETALLE);
    var det = leerObjetos(SH.DETALLE)
      .filter(function (d) { return Number(d.expedienteId) === expedienteId; })
      .sort(function (a, b) { return Number(a.idx) - Number(b.idx); });
    if (!det[indice]) return { status: 'error', message: 'Productor no encontrado' };

    shDet.getRange(det[indice]._fila, 9).setValue(entregado ? 'TRUE' : 'FALSE'); // col entregado

    // Recalcular estado del expediente
    var todos = det.every(function (d, i) {
      return i === indice ? !!entregado : esVerdadero(d.entregado);
    });
    var shExp = hoja(SH.EXPEDIENTES);
    var exp = leerObjetos(SH.EXPEDIENTES).filter(function (e) { return Number(e.id) === expedienteId; })[0];
    if (exp) shExp.getRange(exp._fila, 6).setValue(todos ? 'ENTREGADO' : 'PAGADO');

    return { status: 'success' };
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
//  FECHA
// =====================================================================
function parseFecha(s) { // 'dd/MM/yyyy' -> Date (o null)
  var m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function soloDigitos(v) { return String(v || '').replace(/\D/g, ''); }

// Compara CUEs tolerando el prefijo de municipio (5589316044757 == 9316044757)
function mismoCue(a, b) {
  a = soloDigitos(a); b = soloDigitos(b);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 6 && b.length >= 6) return a.slice(-b.length) === b || b.slice(-a.length) === a;
  return false;
}

function fechaLegible(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return String(v || '');
}

function fechaHoy() {
  var d = new Date();
  var dd = ('0' + d.getDate()).slice(-2);
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  return dd + '/' + mm + '/' + d.getFullYear();
}

// =====================================================================
//  INICIALIZAR (ejecutar UNA vez desde el editor)
// =====================================================================
function inicializar() {
  var ss = libro();

  crearHoja(ss, SH.CONFIG, ['precio', 'cuiaSiguiente', 'cuiaFinLote', 'factorCarga', 'umbralAlerta'], [[60, 15972996, 15978995, 1.5, 85]]);
  crearHoja(ss, SH.HABILITADOS,
    ['numero', 'nombre', 'cedula', 'pin', 'estado'],
    [
      ['1537', 'ALEXANDER GABRIEL DIAZ ARAGON', '6191909970000A', '1234', 'ACTIVO'],
      ['1601', 'JUAN PEREZ LOPEZ', '0011203850000B', '1234', 'ACTIVO']
    ]);
  crearHoja(ss, SH.PRODUCTORES,
    ['cupa', 'nombre', 'cue', 'habilitadoNumero'],
    [
      ['6191909970000N', 'ALEXANDER GABRIEL DIAZ ARAGON', '558', '1537'],
      ['6191909970001M', 'LENINS ANTONIO LAZO DIAZ', '559', '1537']
    ]);
  crearHoja(ss, SH.EXPEDIENTES,
    ['id', 'fecha', 'categoria', 'habilitadoNumero', 'habilitadoNombre', 'estado', 'recibo', 'controlPago', 'totalAretes', 'total', 'fechaAprobacion'],
    []);
  crearHoja(ss, SH.DETALLE,
    ['expedienteId', 'idx', 'cupa', 'nombre', 'cue', 'cantidad', 'cuiaInicial', 'cuiaFinal', 'entregado', 'recibo'],
    []);
  crearHoja(ss, SH.CUES, ['cue', 'nombre', 'areaBovino', 'bovinos', 'fechaDato'], []);

  // Borra la hoja "Hoja 1" / "Sheet1" vacía si existe
  ['Hoja 1', 'Hoja1', 'Sheet1'].forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (h && ss.getSheets().length > 1) ss.deleteSheet(h);
  });

  SpreadsheetApp.getUi && SpreadsheetApp.flush();
  Logger.log('Inicialización completa. Hojas creadas y datos de prueba cargados.');
}

// =====================================================================
//  CONFIGURAR OPERADORA (ejecutar UNA vez para cargar tus habilitados)
//  - Rellena Config con valores por defecto SI está vacío (no pisa lo tuyo)
//  - Carga la lista real de habilitados de la operadora (estado ACTIVO)
//  PIN por defecto: 1234  → cámbialo por habilitado en la hoja cuando quieras.
// =====================================================================
function configurarOperadora() {
  var ss = libro();

  // --- Config: valores por defecto solo si está vacío ---
  var cfg = ss.getSheetByName(SH.CONFIG);
  if (!cfg) { cfg = ss.insertSheet(SH.CONFIG); }
  cfg.getRange(1, 1, 1, 3).setValues([['precio', 'cuiaSiguiente', 'cuiaFinLote']]).setFontWeight('bold');
  var v = cfg.getRange(2, 1, 1, 3).getValues()[0];
  if (!v[0] && !v[1] && !v[2]) {
    cfg.getRange(2, 1, 1, 3).setValues([[60, 15972996, 15978995]]);
  }
  cfg.setFrozenRows(1);

  // --- Habilitados de la operadora ---
  var lista = [
    ['3982', 'LESTER ALBERTO TORREZ MEDINA', '', '1234', 'ACTIVO'],
    ['3986', 'SALOMON DEL SOCORRO RIVAS GRANADOS', '', '1234', 'ACTIVO'],
    ['3988', 'LENINS ANTONIO LAZO DIAZ', '', '1234', 'ACTIVO'],
    ['1537', 'ALEXANDER GABRIEL DIAZ ARAGON', '6190306950000U', '1234', 'ACTIVO'],
    ['3981', 'RAFAEL ANTONIO URBINA', '', '1234', 'ACTIVO'],
    ['3742', 'JUSTINO JIRON URBINA', '', '1234', 'ACTIVO'],
    ['3985', 'RUBNER ALFONSO MATUS TOLEDO', '', '1234', 'ACTIVO']
  ];
  crearHoja(ss, SH.HABILITADOS, ['numero', 'nombre', 'cedula', 'pin', 'estado'], lista);
  // Fuerza la columna número y PIN como TEXTO para que no se pierdan ceros
  var shH = hoja(SH.HABILITADOS);
  shH.getRange(2, 1, lista.length, 1).setNumberFormat('@'); // numero
  shH.getRange(2, 4, lista.length, 1).setNumberFormat('@'); // pin

  Logger.log('Listo: Config verificado y ' + lista.length + ' habilitados cargados.');
}

// Ejecutar UNA vez (opcional) para rellenar el recibo en filas de Detalle
// de expedientes viejos aprobados con recibo único.
function rellenarRecibosFaltantes() {
  var shDet = hoja(SH.DETALLE);
  if (String(shDet.getRange(1, 10).getValue()) !== 'recibo') {
    shDet.getRange(1, 10).setValue('recibo').setFontWeight('bold');
  }
  var exps = {};
  leerObjetos(SH.EXPEDIENTES).forEach(function (e) { exps[Number(e.id)] = String(e.recibo || ''); });
  var n = 0;
  leerObjetos(SH.DETALLE).forEach(function (d) {
    if (String(d.recibo || '')) return;               // ya tiene
    var er = exps[Number(d.expedienteId)] || '';
    if (er && er.indexOf(',') === -1) {               // recibo único del expediente
      shDet.getRange(d._fila, 10).setValue(er); n++;
    }
  });
  Logger.log('Recibos rellenados en ' + n + ' filas.');
}

function crearHoja(ss, nombre, headers, filas) {
  var sh = ss.getSheetByName(nombre);
  if (!sh) sh = ss.insertSheet(nombre);
  sh.clear();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (filas && filas.length) sh.getRange(2, 1, filas.length, headers.length).setValues(filas);
  sh.setFrozenRows(1);
}
