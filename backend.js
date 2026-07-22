/* =====================================================================
   AretesApp - Cliente de datos (backend.js)
   ---------------------------------------------------------------------
   Una sola interfaz, dos modos:

     • REMOTO  : si defines SCRIPT_URL abajo, habla con el Google Apps
                 Script (Google Sheets como base de datos real).
     • LOCAL   : si SCRIPT_URL queda vacío, usa localStorage del
                 navegador (útil para desarrollar sin conexión).

   TODAS las funciones devuelven Promesas (async), así que en los HTML
   se llaman con  await Backend.loQueSea(...).
   ===================================================================== */

(function (global) {
  "use strict";

  /* >>> PEGA AQUÍ la URL /exec de tu implementación del Apps Script <<<
     Déjala vacía ("") para trabajar en modo LOCAL con localStorage.   */
  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyLqMOwccxqgW49geXTKJdi9Lp6teRShV2nduu8kgDV4_Sg_BmL4V-pwDt-tLlOhVgUVw/exec";

  const MODO_REMOTO = !!SCRIPT_URL;

  // =================================================================
  //  MODO REMOTO  (Google Apps Script + Sheets)
  // =================================================================
  async function get(action, params) {
    const url = new URL(SCRIPT_URL);
    url.searchParams.set("action", action);
    if (params) Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
    const resp = await fetch(url.toString());
    return await resp.json();
  }
  // POST con body de texto plano => petición "simple" => sin preflight CORS
  async function post(payload) {
    const resp = await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return await resp.json();
  }

  const Remote = {
    getConfig:                 ()                       => get("config"),
    saveConfig:                (d)                      => post({ tipo: "saveConfig", precio: d.precio, cuiaSiguiente: d.cuiaSiguiente, cuiaFinLote: d.cuiaFinLote }),
    disponibleLote:            async ()                 => (await get("config")).disponible,
    getHabilitados:            ()                       => get("habilitados"),
    login:                     (numero, pin)            => get("login", { numero, pin }),
    buscarProductor:           (cupa)                   => get("buscarProductor", { cupa }),
    crearExpediente:           (datos)                  => post({ tipo: "crearExpediente", datos }),
    getExpedientesDeHabilitado:(numero)                 => get("expedientesHabilitado", { numero }),
    getPendientes:             ()                       => get("pendientes"),
    aprobarExpediente:         (id, recibo, controlPago, recibos)=> post({ tipo: "aprobar", id, recibo, controlPago, recibos }),
    actualizarExpediente:      (id, datos)              => post({ tipo: "actualizarExpediente", id, datos }),
    getConfirmados:            ()                       => get("confirmados"),
    marcarProductorEntregado:  (expedienteId, indice, entregado) => post({ tipo: "marcarEntregado", expedienteId, indice, entregado }),
    estadoCue:                 (cue)                    => get("estadoCue", { cue }),
    getCues:                   ()                       => get("cues"),
    guardarCue:                (d)                      => post({ tipo: "guardarCue", cue: d.cue, nombre: d.nombre, areaBovino: d.areaBovino, bovinos: d.bovinos, fechaDato: d.fechaDato })
  };

  // =================================================================
  //  MODO LOCAL  (localStorage) — misma interfaz, resuelta con Promesas
  // =================================================================
  const DB_KEY = "aretesapp_db_v1";

  function datosSemilla() {
    return {
      config: { precio: 60, cuiaSiguiente: 15972996, cuiaFinLote: 15978995 },
      habilitados: [
        { numero: "1537", nombre: "ALEXANDER GABRIEL DIAZ ARAGON", cedula: "6191909970000A", pin: "1234", estado: "ACTIVO" },
        { numero: "1601", nombre: "JUAN PEREZ LOPEZ", cedula: "0011203850000B", pin: "1234", estado: "ACTIVO" }
      ],
      productores: [
        { cupa: "6191909970000N", nombre: "ALEXANDER GABRIEL DIAZ ARAGON", cue: "558", habilitadoNumero: "1537" },
        { cupa: "6191909970001M", nombre: "LENINS ANTONIO LAZO DIAZ", cue: "559", habilitadoNumero: "1537" }
      ],
      expedientes: [],
      cues: [],
      secuencia: 1
    };
  }
  function cargar() {
    let raw = null;
    try { raw = global.localStorage.getItem(DB_KEY); } catch (e) {}
    if (!raw) { const db = datosSemilla(); guardar(db); return db; }
    try { return JSON.parse(raw); } catch (e) { const db = datosSemilla(); guardar(db); return db; }
  }
  function guardar(db) { try { global.localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) {} }
  function hoyISO() {
    const d = new Date();
    return ("0"+d.getDate()).slice(-2)+"/"+("0"+(d.getMonth()+1)).slice(-2)+"/"+d.getFullYear();
  }
  function disponible(db) { return Math.max(0, db.config.cuiaFinLote - db.config.cuiaSiguiente + 1); }

  const Local = {
    async getConfig() {
      const c = cargar().config;
      return { precio: c.precio, cuiaSiguiente: c.cuiaSiguiente, cuiaFinLote: c.cuiaFinLote, disponible: disponible(cargar()), factorCarga: c.factorCarga || 1.5, umbralAlerta: c.umbralAlerta || 85 };
    },
    async saveConfig(d) {
      const db = cargar();
      db.config.precio = Number(d.precio);
      db.config.cuiaSiguiente = Number(d.cuiaSiguiente);
      db.config.cuiaFinLote = Number(d.cuiaFinLote);
      if (d.factorCarga !== undefined) db.config.factorCarga = Number(d.factorCarga) || 1.5;
      if (d.umbralAlerta !== undefined) db.config.umbralAlerta = Number(d.umbralAlerta) || 85;
      guardar(db);
      return { status: "success" };
    },
    async disponibleLote() { return disponible(cargar()); },
    async getHabilitados() { return cargar().habilitados; },
    async login(numero, pin) {
      const h = cargar().habilitados.find(x => String(x.numero).trim() === String(numero).trim() && String(x.pin).trim() === String(pin).trim());
      if (!h) return { status: "error", message: "Número o PIN incorrecto" };
      const estado = String(h.estado || "").trim().toUpperCase();
      if (["PENDIENTE","INACTIVO","BLOQUEADO"].includes(estado)) return { status: "pendiente", message: "Cuenta " + estado.toLowerCase() + ". Contacta al digitador." };
      return { status: "ok", habilitado: h };
    },
    async buscarProductor(cupa) {
      return cargar().productores.find(p => p.cupa === (cupa || "").trim().toUpperCase()) || null;
    },
    async crearExpediente(datos) {
      const db = cargar();
      const productores = (datos.productores || []).map(p => ({
        cupa: (p.cupa || "").trim().toUpperCase(), nombre: p.nombre || "", cue: (p.cue || "").trim(),
        cantidad: Number(p.cantidad) || 0, cuiaInicial: null, cuiaFinal: null, entregado: false
      }));
      if (productores.length === 0) return { status: "error", message: "Agrega al menos un productor" };
      if (productores.some(p => p.cantidad <= 0)) return { status: "error", message: "Toda cantidad debe ser mayor que 0" };
      const totalAretes = productores.reduce((s, p) => s + p.cantidad, 0);
      const exp = {
        id: db.secuencia++, fecha: datos.fecha || hoyISO(), categoria: datos.categoria || "PRODUCTORES",
        habilitadoNumero: datos.habilitadoNumero, habilitadoNombre: datos.habilitadoNombre,
        estado: "PENDIENTE_PAGO", recibo: "", controlPago: false,
        totalAretes: totalAretes, total: totalAretes * db.config.precio, productores: productores
      };
      db.expedientes.push(exp);
      productores.forEach(p => {
        if (!p.cupa) return;
        const k = db.productores.find(x => x.cupa === p.cupa);
        if (k) { k.nombre = p.nombre; k.cue = p.cue; k.habilitadoNumero = exp.habilitadoNumero; }
        else db.productores.push({ cupa: p.cupa, nombre: p.nombre, cue: p.cue, habilitadoNumero: exp.habilitadoNumero });
      });
      guardar(db);
      return { status: "success", id: exp.id };
    },
    async actualizarExpediente(id, datos) {
      const db = cargar();
      const exp = db.expedientes.find(e => e.id === Number(id));
      if (!exp) return { status: "error", message: "Expediente no encontrado" };
      if (exp.estado !== "PENDIENTE_PAGO") return { status: "error", message: "Solo se puede editar un expediente Pendiente de Pago" };
      const productores = (datos.productores || []).map(p => ({
        cupa: (p.cupa || "").trim().toUpperCase(), nombre: p.nombre || "", cue: (p.cue || "").trim(),
        cantidad: Number(p.cantidad) || 0, cuiaInicial: null, cuiaFinal: null, entregado: false, recibo: ""
      }));
      if (productores.length === 0) return { status: "error", message: "Agrega al menos un productor" };
      if (productores.some(p => p.cantidad <= 0)) return { status: "error", message: "Toda cantidad debe ser mayor que 0" };
      const totalAretes = productores.reduce((s, p) => s + p.cantidad, 0);
      exp.fecha = datos.fecha || exp.fecha;
      exp.categoria = datos.categoria || exp.categoria;
      exp.productores = productores;
      exp.totalAretes = totalAretes;
      exp.total = totalAretes * db.config.precio;
      productores.forEach(p => {
        if (!p.cupa) return;
        const k = db.productores.find(x => x.cupa === p.cupa);
        if (k) { k.nombre = p.nombre; k.cue = p.cue; k.habilitadoNumero = exp.habilitadoNumero; }
        else db.productores.push({ cupa: p.cupa, nombre: p.nombre, cue: p.cue, habilitadoNumero: exp.habilitadoNumero });
      });
      guardar(db);
      return { status: "success" };
    },
    async getExpedientesDeHabilitado(numero) {
      return cargar().expedientes.filter(e => String(e.habilitadoNumero) === String(numero)).sort((a, b) => b.id - a.id);
    },
    async getPendientes() {
      return cargar().expedientes.filter(e => e.estado === "PENDIENTE_PAGO").sort((a, b) => a.id - b.id);
    },
    async aprobarExpediente(id, recibo, controlPago, recibos) {
      const db = cargar();
      const exp = db.expedientes.find(e => e.id === Number(id));
      if (!exp) return { status: "error", message: "Expediente no encontrado" };
      if (exp.estado !== "PENDIENTE_PAGO") return { status: "error", message: "El expediente ya fue procesado" };
      const porProd = Array.isArray(recibos) && recibos.length > 0;
      if (!recibo && !porProd) return { status: "error", message: "Falta el número de recibo (DOCUMENTO)" };
      if (porProd) {
        if (recibos.length !== exp.productores.length) return { status: "error", message: "Debe haber un recibo por cada productor" };
        if (recibos.some(r => !String(r || "").trim())) return { status: "error", message: "Falta el recibo de uno o más productores" };
      }
      const disp = disponible(db);
      if (exp.totalAretes > disp) return { status: "error", message: "El lote no alcanza (disponible: " + disp + ", requiere: " + exp.totalAretes + ")" };
      let cursor = db.config.cuiaSiguiente;
      exp.productores.forEach((p, i) => {
        p.cuiaInicial = cursor; p.cuiaFinal = cursor + p.cantidad - 1; cursor = p.cuiaFinal + 1;
        p.recibo = porProd ? String(recibos[i]).trim() : String(recibo).trim();
      });
      db.config.cuiaSiguiente = cursor;
      exp.recibo = porProd ? [...new Set(recibos.map(r => String(r).trim()))].join(", ") : String(recibo).trim();
      exp.controlPago = !!controlPago; exp.estado = "PAGADO"; exp.fechaAprobacion = hoyISO();
      guardar(db);
      return { status: "success" };
    },
    async getConfirmados() {
      return cargar().expedientes.filter(e => e.estado === "PAGADO" || e.estado === "ENTREGADO").sort((a, b) => b.id - a.id);
    },
    async marcarProductorEntregado(expedienteId, indice, entregado) {
      const db = cargar();
      const exp = db.expedientes.find(e => e.id === Number(expedienteId));
      if (!exp || !exp.productores[indice]) return { status: "error" };
      exp.productores[indice].entregado = !!entregado;
      exp.estado = exp.productores.every(p => p.entregado) ? "ENTREGADO" : "PAGADO";
      guardar(db);
      return { status: "success" };
    },
    async getCues() {
      return (cargar().cues || []).map(x => ({ ...x }));
    },
    async guardarCue(d) {
      const db = cargar(); db.cues = db.cues || [];
      const digitos = v => String(v || "").replace(/\D/g, "");
      if (!digitos(d.cue)) return { status: "error", message: "CUE inválido" };
      const igual = (a, b) => { a = digitos(a); b = digitos(b);
        return a && b && (a === b || (a.length >= 6 && b.length >= 6 && (a.endsWith(b) || b.endsWith(a)))); };
      const reg = db.cues.find(x => igual(x.cue, d.cue));
      const fila = { cue: String(d.cue).trim(), nombre: d.nombre || "", areaBovino: Number(d.areaBovino) || 0,
                     bovinos: Number(d.bovinos) || 0, fechaDato: d.fechaDato || hoyISO() };
      if (reg) Object.assign(reg, fila); else db.cues.push(fila);
      guardar(db);
      return { status: "success" };
    },
    async estadoCue(cue) {
      const db = cargar(); db.cues = db.cues || [];
      const digitos = v => String(v || "").replace(/\D/g, "");
      const igual = (a, b) => { a = digitos(a); b = digitos(b);
        return a && b && (a === b || (a.length >= 6 && b.length >= 6 && (a.endsWith(b) || b.endsWith(a)))); };
      const pf = s => { const m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };
      const reg = db.cues.find(x => igual(x.cue, cue));
      if (!reg) return { status: "sin_datos", cue: String(cue || "").trim() };
      const factor = db.config.factorCarga || 1.5;
      const umbral = db.config.umbralAlerta || 85;
      const area = Number(reg.areaBovino) || 0;
      const bovinos = Number(reg.bovinos) || 0;
      const capacidad = Math.floor(area * factor);
      const fBase = pf(reg.fechaDato);
      let entregados = 0;
      db.expedientes.forEach(e => {
        if (e.estado !== "PAGADO" && e.estado !== "ENTREGADO") return;
        const fAp = pf(e.fechaAprobacion) || pf(e.fecha);
        if (fBase && fAp && fAp < fBase) return;
        e.productores.forEach(p => { if (igual(p.cue, cue)) entregados += Number(p.cantidad) || 0; });
      });
      const estimado = bovinos + entregados;
      const disponibles = capacidad - estimado;
      const pct = capacidad > 0 ? Math.round(estimado * 100 / capacidad) : 0;
      let estado = "DISPONIBLE";
      if (capacidad <= 0) estado = "SIN_DATOS";
      else if (disponibles <= 0) estado = "LLENO";
      else if (pct >= umbral) estado = "CASI_LLENO";
      const viejo = !fBase || (Date.now() - fBase.getTime()) > 60 * 24 * 3600 * 1000;
      return { status: "ok", cue: String(reg.cue), nombre: reg.nombre || "", areaBovino: area, factor,
               capacidad, bovinosIpsa: bovinos, fechaDato: reg.fechaDato, entregadosDespues: entregados,
               estimado, disponibles, porcentaje: pct, estado, datoViejo: viejo };
    },
    // utilidades de prototipo local
    _reset() { const db = datosSemilla(); guardar(db); return db; },
    _dump() { return cargar(); }
  };

  const Backend = MODO_REMOTO ? Remote : Local;
  Backend.MODO = MODO_REMOTO ? "REMOTO (Google Sheets)" : "LOCAL (localStorage)";
  global.Backend = Backend;
  console.log("AretesApp Backend en modo:", Backend.MODO);
})(window);
