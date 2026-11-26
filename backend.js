/* =====================================================================
   AretesApp v2 - Cliente de datos (backend.js) — Supabase
   ---------------------------------------------------------------------
   Misma interfaz "Backend.*" que la versión con Google Sheets, así que
   habilitado.html y digitador.html casi no cambian.

   Requiere, ANTES de este archivo:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="config.js"></script>

   • Habilitado: entra con número + PIN → recibe un token de sesión.
   • Digitador : entra con correo + contraseña (Supabase Auth).
   ===================================================================== */
(function (global) {
  "use strict";

  const URL_ = global.SUPABASE_URL, KEY = global.SUPABASE_ANON_KEY;
  if (!URL_ || !KEY || !global.supabase) {
    console.error("[AretesApp] Falta configurar config.js (SUPABASE_URL / SUPABASE_ANON_KEY) o la librería de Supabase.");
  }
  const sb = (URL_ && KEY && global.supabase)
    ? global.supabase.createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "aretesapp-auth" } })
    : null;

  /* ---------------- sesión del habilitado ---------------- */
  const TOK_KEY = "aretesapp_hab_token";
  let tokenHab = null;
  const HAB_INFO = "aretesapp_hab_info";
  try { tokenHab = global.localStorage.getItem(TOK_KEY) || global.sessionStorage.getItem(TOK_KEY); } catch (e) {}
  function setToken(t) {
    tokenHab = t;
    try {
      if (t) localStorage.setItem(TOK_KEY, t);
      else { localStorage.removeItem(TOK_KEY); localStorage.removeItem(HAB_INFO); }
      sessionStorage.removeItem(TOK_KEY);
    } catch (e) {}
  }

  const MOV_KEY = "aretesapp_mov_token";
  let tokenMov = null;
  try { tokenMov = global.localStorage.getItem(MOV_KEY); } catch (e) {}
  function setTokenMov(t) { tokenMov = t; try { t ? localStorage.setItem(MOV_KEY, t) : localStorage.removeItem(MOV_KEY); } catch (e) {} }
  const tokM = () => { if (!tokenMov) throw new Error("Tu sesión venció. Vuelve a entrar."); return tokenMov; };

  /* ---------------- llamada RPC con manejo de errores ---------------- */
  /* ---- Teléfono: llave secreta propia de este teléfono + su modelo ---- */
  const LLAVE_KEY = "aretesapp_llave";
  function llaveTelefono() {
    let k = null;
    try { k = localStorage.getItem(LLAVE_KEY); } catch (e) {}
    if (!k || k.length < 32) {
      const b = new Uint8Array(24); (global.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => b[i] = Math.random() * 256 | 0);
      k = "tel-" + Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
      try { localStorage.setItem(LLAVE_KEY, k); } catch (e) {}
    }
    return k;
  }
  async function modeloTelefono() {
    const ua = global.navigator ? navigator.userAgent : "";
    let modelo = "", sistema = "";
    try {
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        const v = await navigator.userAgentData.getHighEntropyValues(["model", "platform", "platformVersion"]);
        modelo = v.model || ""; sistema = (v.platform || "") + (v.platformVersion ? " " + String(v.platformVersion).split(".")[0] : "");
      }
    } catch (e) {}
    if (!modelo) { const m = ua.match(/Android [\d.]+; ([^;)]+)/); if (m && m[1] !== "K") modelo = m[1].replace(/ Build.*/, ""); }
    if (!modelo && /iPhone/.test(ua)) modelo = "iPhone";
    if (!modelo && /iPad/.test(ua)) modelo = "iPad";
    if (!sistema) sistema = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "";
    const nav = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox/.test(ua) ? "Firefox" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
    return [modelo || "Teléfono", sistema, nav].filter(Boolean).join(" · ");
  }

  // Funciones que solo leen datos: se pueden repetir sin riesgo si la red falla un instante.
  const SOLO_LECTURA = /^(hab_(expedientes|resultado|buscar_productor|disponible|config|cues|mis)|mov_(resultado|mis)|dig_(yo|pendientes|confirmados|cues|habilitados|bitacora|personal|movimientos|telefonos)|get_config|estado_puente|puente_)/;
  const esErrorDeRed = m => /Failed to fetch|NetworkError|Load failed|network|ERR_|fetch/i.test(m);
  const esErrorDeAuth = (e, m) => e.code === "42501" || e.code === "PGRST301" || e.code === "PGRST303" || /JWT|jwt expired|not authorized|Acceso solo para el digitador/i.test(m);
  const dormir = ms => new Promise(r => setTimeout(r, ms));

  async function rpc(fn, args, _intento) {
    if (!sb) throw new Error("Supabase no está configurado (config.js)");
    const intento = _intento || 0;
    let data, error;
    try { ({ data, error } = await sb.rpc(fn, args || {})); }
    catch (e) { error = { message: String(e && e.message || e) }; }
    if (error) {
      const msg = String(error.message || error);
      if (msg.indexOf("SESION_VENCIDA") >= 0) {
        if (fn.indexOf("mov_") === 0) setTokenMov(null); else setToken(null);
        global.dispatchEvent(new CustomEvent("aretes:sesion-vencida"));
        throw new Error("Tu sesión venció. Vuelve a entrar.");
      }
      // Digitador: el permiso de Supabase dura 1 hora y se renueva solo. Si la pestaña estuvo
      // dormida, la primera llamada puede salir con el permiso viejo: se renueva y se repite.
      if (intento === 0 && esErrorDeAuth(error, msg)) {
        try {
          const { data: ses } = await sb.auth.getSession();
          if (ses && ses.session) { await sb.auth.refreshSession(); return rpc(fn, args, 1); }
        } catch (e) {}
      }
      // Corte de red de un instante (celular que despierta, cambio de wifi/datos)
      if (intento < 2 && esErrorDeRed(msg) && SOLO_LECTURA.test(fn)) { await dormir(1200 * (intento + 1)); return rpc(fn, args, intento + 1); }
      if (esErrorDeAuth(error, msg) && fn.indexOf("dig_") === 0) global.dispatchEvent(new CustomEvent("aretes:no-autorizado"));
      if (esErrorDeRed(msg)) throw new Error("Sin conexión a internet por un momento. Intenta de nuevo.");
      throw new Error(msg);
    }
    return data;
  }
  // Al volver a la app (celular desbloqueado, otra pestaña), renueva el permiso del digitador de una vez
  try {
    global.document.addEventListener("visibilitychange", () => {
      if (global.document.visibilityState === "visible" && sb) { try { sb.auth.startAutoRefresh(); sb.auth.getSession(); } catch (e) {} }
      else if (sb) { try { sb.auth.stopAutoRefresh(); } catch (e) {} }
    });
  } catch (e) {}
  const tok = () => { if (!tokenHab) throw new Error("Tu sesión venció. Vuelve a entrar."); return tokenHab; };

  /* ---------------- aviso en tiempo real de resultados ---------------- */
  // El bot avisa por "broadcast" cuando termina un trabajo; además se
  // pregunta cada 1.5 s como respaldo. Así responde al instante.
  const esperando = new Map();
  let canalPuente = null;
  function asegurarCanal() {
    if (canalPuente || !sb) return;
    canalPuente = sb.channel("puente-resultados")
      .on("broadcast", { event: "listo" }, (msg) => {
        const id = msg && msg.payload && msg.payload.jobId;
        const fn = id && esperando.get(id);
        if (fn) fn();
      })
      .subscribe();
  }

  async function esperarResultado(jobId, ms, consultar) {
    consultar = consultar || (() => rpc("hab_resultado", { p_token: tok(), p_job: jobId }));
    asegurarCanal();
    const limite = Date.now() + (ms || 20000);
    let despertar = null;
    esperando.set(jobId, () => despertar && despertar());
    try {
      while (Date.now() < limite) {
        let r;
        try { r = await consultar(); } catch (e) { r = null; }
        if (r && r.status !== "pendiente") return r;
        await new Promise(res => { despertar = res; setTimeout(res, 1500); });
      }
      return { status: "timeout" };
    } finally { esperando.delete(jobId); }
  }

  /* =================================================================
     INTERFAZ PÚBLICA
     ================================================================= */
  const Backend = {
    modo: "SUPABASE",
    cliente: sb,

    /* ---- generales ---- */
    getConfig:      ()  => rpc("get_config"),
    disponibleLote: async () => (await rpc("get_config")).disponible,
    estadoPuente:   ()  => rpc("estado_puente"),

    /* ---- habilitado ---- */
    async login(numero, pin) {
      const r = await rpc("hab_login", { p_numero: String(numero || "").trim(), p_pin: String(pin || "").trim(),
                                         p_llave: llaveTelefono(), p_modelo: await modeloTelefono() });
      if (r && r.status === "ok") { setToken(r.token); try { localStorage.setItem(HAB_INFO, JSON.stringify(r.habilitado || {})); } catch (e) {} }
      return r;
    },
    async logout() { const t = tokenHab; setToken(null); if (t) { try { await rpc("hab_logout", { p_token: t }); } catch (e) {} } },
    tieneSesion: () => !!tokenHab,
    habilitadoGuardado() { try { return tokenHab ? JSON.parse(localStorage.getItem(HAB_INFO) || "null") : null; } catch (e) { return null; } },
    buscarProductor:            (cupa)        => rpc("hab_buscar_productor", { p_token: tok(), p_cupa: cupa }),
    crearExpediente:            (datos)       => rpc("hab_crear_expediente", { p_token: tok(), p_datos: datos }),
    actualizarExpediente:       (id, datos)   => rpc("hab_actualizar_expediente", { p_token: tok(), p_id: Number(id), p_datos: datos }),
    getExpedientesDeHabilitado: ()            => rpc("hab_expedientes", { p_token: tok() }),
    solicitarCue:               (cue)         => rpc("hab_solicitar", { p_token: tok(), p_tipo: "CUE",  p_termino: String(cue || "") }),
    solicitarCupa:              (cupa)        => rpc("hab_solicitar", { p_token: tok(), p_tipo: "CUPA", p_termino: String(cupa || "") }),
    resultadoCue:               (jobId)       => rpc("hab_resultado", { p_token: tok(), p_job: jobId }),
    esperarResultado,

    /* ---- digitador: sesión ---- */
    async loginDigitador(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: String(email).trim(), password });
      if (error) return { status: "error", message: error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos" : error.message };
      const yo = await rpc("dig_yo");
      if (!yo.digitador) { await sb.auth.signOut(); return { status: "error", message: "Esta cuenta no está autorizada como digitador." }; }
      return { status: "ok" };
    },
    async sesionDigitador() {
      if (!sb) return false;
      const { data } = await sb.auth.getSession();
      if (!data || !data.session) return false;
      try { return !!(await rpc("dig_yo")).digitador; } catch (e) { return false; }
    },
    async logoutDigitador() { await sb.auth.signOut(); },
    async correoDigitador() { const { data } = await sb.auth.getUser(); return data && data.user ? data.user.email : ""; },

    /* ---- digitador: datos ---- */
    saveConfig:               (d)    => rpc("dig_save_config", { p: d }),
    getPendientes:            ()     => rpc("dig_pendientes"),
    getConfirmados:           ()     => rpc("dig_confirmados"),
    aprobarExpediente:        (id, recibo, controlPago, recibos) =>
                                rpc("dig_aprobar", { p_id: Number(id), p_recibo: recibo || "", p_control_pago: !!controlPago, p_recibos: recibos && recibos.length ? recibos : null }),
    marcarProductorEntregado: (expedienteId, indice, entregado) =>
                                rpc("dig_marcar_entregado", { p_exp: Number(expedienteId), p_idx: Number(indice), p_val: !!entregado }),
    getCues:                  ()     => rpc("dig_cues"),
    guardarCue:               (d)    => rpc("dig_guardar_cue", { p: d }),
    estadoCue:                (cue)  => rpc("dig_estado_cue", { p_cue: String(cue || "") }),
    getHabilitados:           ()     => rpc("dig_habilitados"),
    guardarHabilitado:        (d)    => rpc("dig_guardar_habilitado", { p: d }),
    bitacora:                 (n)    => rpc("dig_bitacora", { p_limite: n || 50 }),
    getPersonal:              ()     => rpc("dig_personal"),
    getTelefonos:             ()     => rpc("dig_telefonos"),
    telefonoAccion:           (id, a) => rpc("dig_telefono_accion", { p_id: id, p_accion: a }),
    telefonosPendientes:      ()     => rpc("dig_telefonos_pendientes"),
    guardarPersonal:          (d)    => rpc("dig_guardar_personal", { p: d }),
    getMovimientos:           (estado, n) => rpc("dig_movimientos", { p_estado: estado || null, p_limite: n || 100 }),
    registroAuto:             (on)   => rpc("dig_registro_auto", { p_on: !!on }),
    cambiarEstadoMov:         (id, estado, ref, error) => rpc("dig_mov_estado", { p_id: Number(id), p_estado: estado, p_ref: ref || "", p_error: error || "" }),
    async urlFoto(path) {
      const { data, error } = await sb.storage.from("cartas").createSignedUrl(path, 600);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },

    /* ---- personal de movimientos ---- */
    mov: {
      async login(usuario, pass) {
        const r = await rpc("mov_login", { p_usuario: String(usuario || "").trim(), p_pass: String(pass || ""),
                                           p_llave: llaveTelefono(), p_modelo: await modeloTelefono() });
        if (r && r.status === "ok") { setTokenMov(r.token); try { localStorage.setItem("aretesapp_mov_user", JSON.stringify(r.usuario)); } catch (e) {} }
        return r;
      },
      async logout() { const t = tokenMov; setTokenMov(null); try { localStorage.removeItem("aretesapp_mov_user"); } catch (e) {}
                       if (t) { try { await rpc("mov_logout", { p_token: t }); } catch (e) {} } },
      usuarioGuardado() { try { return tokenMov ? JSON.parse(localStorage.getItem("aretesapp_mov_user") || "null") : null; } catch (e) { return null; } },
      consultarAretes: (codigos) => rpc("mov_solicitar", { p_token: tokM(), p_tipo: "ARETES", p_termino: String(codigos || "") }),
      consultarCupa:   (cupa)    => rpc("mov_solicitar", { p_token: tokM(), p_tipo: "CUPA", p_termino: String(cupa || "") }),
      esperar: (jobId, ms) => esperarResultado(jobId, ms, () => rpc("mov_resultado", { p_token: tokM(), p_job: jobId })),
      crear:   (datos)  => rpc("mov_crear", { p_token: tokM(), p: datos }),
      mios:    ()       => rpc("mov_mis", { p_token: tokM() }),
      async subirFoto(blob) {
        const nombre = (global.crypto && crypto.randomUUID ? crypto.randomUUID()
                       : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); })) + ".jpg";
        const { error } = await sb.storage.from("cartas").upload(nombre, blob, { contentType: "image/jpeg", upsert: false });
        if (error) throw new Error("No se pudo subir la foto: " + error.message);
        return nombre;
      }
    }
  };

  global.Backend = Backend;
  console.log("Backend en modo: SUPABASE");
})(window);
