// ==UserScript==
// @name         AretesApp - Bot Puente SNITB
// @namespace    aretesapp
// @version      1.3
// @description  Sincroniza área bovina y existencias de los CUE desde el SNITB (IPSA) hacia la hoja CUES de AretesApp. Corre con TU sesión iniciada; no guarda contraseñas.
// @match        https://trazabilidad.ipsa.gob.ni/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  /* ================================================================
     CONFIGURACIÓN — pega aquí la MISMA URL /exec de tu Apps Script
     (la que está en backend.js del sistema AretesApp)
     ================================================================ */
  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyLqMOwccxqgW49geXTKJdi9Lp6teRShV2nduu8kgDV4_Sg_BmL4V-pwDt-tLlOhVgUVw/exec";

  const PAUSA_MS = 1800; // pausa entre CUEs para no saturar el SNITB

  if (!SCRIPT_URL) { console.warn("[AretesApp] Falta SCRIPT_URL en el userscript."); return; }

  /* ---------------- utilidades ---------------- */
  const digitos = v => String(v || "").replace(/\D/g, "");
  const hoy = () => { const d = new Date();
    return ("0"+d.getDate()).slice(-2)+"/"+("0"+(d.getMonth()+1)).slice(-2)+"/"+d.getFullYear(); };
  const espera = ms => new Promise(r => setTimeout(r, ms));

  async function apiGet(action) {
    const r = await fetch(SCRIPT_URL + "?action=" + action);
    return r.json();
  }
  async function apiPost(payload) {
    const r = await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) });
    return r.json();
  }

  /* ------------- lectura del SNITB (con TU sesión) ------------- */

  // Busca el CUE en establecimientos.php y devuelve {nombre, bovinos, hrefDetalle}
  async function leerFila(cue) {
    const d = new Date();
    const iso = d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
    const url = "https://trazabilidad.ipsa.gob.ni/establecimientos.php?c=&pfechaini="+iso+"&pfechafin="+iso+
                "&q="+encodeURIComponent(digitos(cue))+"&search=Buscar";
    const html = await (await fetch(url, { credentials: "include" })).text();
    if (/login|iniciar sesi/i.test(html) && !/Establecimientos/i.test(html))
      throw new Error("Sesión del SNITB vencida: inicia sesión y reintenta");

    const doc = new DOMParser().parseFromString(html, "text/html");
    const filas = [...doc.querySelectorAll("tr")].filter(tr => digitos(tr.textContent).includes(digitos(cue)));
    if (!filas.length) throw new Error("CUE no encontrado en el SNITB");
    const fila = filas[0];

    const badge = fila.querySelector('[title="BOVINOS"], [title="bovinos"]');
    const bovinos = badge ? Number(digitos(badge.textContent)) : null;

    const linkNombre = fila.querySelector("a.frame");
    const nombre = linkNombre ? (linkNombre.getAttribute("title") || linkNombre.textContent).trim().replace(/\.+$/, "") : "";
    const hrefDetalle = linkNombre ? linkNombre.getAttribute("href") : null;

    return { nombre, bovinos, hrefDetalle };
  }

  // Abre la ficha del establecimiento y extrae el área bovina (Mz)
  async function leerAreas(hrefDetalle) {
    if (!hrefDetalle) return { areaBovino: null, areaFinca: null };
    const url = new URL(hrefDetalle, "https://trazabilidad.ipsa.gob.ni/").href;
    const html = await (await fetch(url, { credentials: "include" })).text();

    const buscar = (etiqueta) => {
      // 1) etiqueta y valor como texto plano
      const texto = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      let m = texto.match(new RegExp(etiqueta + "\\s*\\(MZ\\)\\s*:?\\s*([\\d.,]+)", "i"));
      if (m) return parseFloat(m[1].replace(/,/g, ""));
      // 2) valor dentro de un input cercano a la etiqueta
      m = html.match(new RegExp(etiqueta + "\\s*\\(MZ\\)[\\s\\S]{0,400}?value\\s*=\\s*[\"']([\\d.,]+)[\"']", "i"));
      if (m) return parseFloat(m[1].replace(/,/g, ""));
      return null;
    };

    return { areaBovino: buscar("AREA\\s*BOVINO"), areaFinca: buscar("AREA\\s*DE\\s*LA\\s*FINCA"),
             nombreProductor: extraerNombreProductor(html) };
  }

  // Extrae el NOMBRE DE LA PERSONA (productor/propietario) desde la ficha del
  // establecimiento. El SNITB guarda los nombres en MAYÚSCULAS. Probamos varias
  // etiquetas y validamos que parezca un nombre de persona (2+ palabras, solo
  // letras) y NO el nombre de la finca/lugar. Si no lo halla, devuelve "".
  function esNombrePersona(v) {
    if (!v) return false;
    var t = String(v).trim().replace(/\s+/g, " ");
    if (t.length < 6 || t.length > 60) return false;
    if (!/^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .'’-]+$/.test(t)) return false;
    if (/(ESTABLECIMIENTO|FINCA|PREDIO|GRANJA|DEPARTAMENTO|MUNICIPIO|ATL[ÁA]NTICO|TORTUGUERO|BOVINO|\bAREA\b|INSCRIP|TRAZAB|SISTEMA|NACIONAL|FORMATO|SELECCIONE|NINGUN|NOMBRE|CEDULA|C[ÓO]DIGO|DOCUMENTO|FECHA|CATEGOR|\bTIPO\b|CORREO|TEL[ÉE]FONO|DIRECCI[ÓO]N)/.test(t)) return false;
    if (/^(EL|LA|LOS|LAS)\s/.test(t)) return false;   // los nombres de finca suelen iniciar con artículo
    return t.split(" ").filter(Boolean).length >= 2;
  }
  // Recorta un valor capturado para que no arrastre el siguiente campo de la ficha
  // (p.ej. "LENINS ANTONIO LAZO DIAZ MUNICIPIO" -> "LENINS ANTONIO LAZO DIAZ").
  function limpiarNombre(v) {
    var palabras = String(v || "").trim().split(/\s+/);
    var corte = /^(MUNICIPIO|DEPARTAMENTO|CUE|CUPA|CUC|CUS|C[ÓO]DIGO|FECHA|[ÁA]REA|BOVINOS?|TIPO|CATEGOR[ÍI]A|DOCUMENTO|ESTABLECIMIENTO|NOMBRE|C[ÉE]DULA|DIRECCI[ÓO]N|TEL[ÉE]FONO|CORREO|RUC|ACTIVIDAD|REGISTRO|PREDIO|GRANJA|FINCA)$/;
    var res = [];
    for (var k = 0; k < palabras.length; k++) {
      var w = palabras[k];
      if (!/^[A-ZÁÉÍÓÚÑ]/i.test(w)) break;                       // token que no inicia con letra -> fin del nombre
      var limpio = w.replace(/[.,;:]+$/, "");
      if (corte.test(limpio.toUpperCase())) break;               // etiqueta del siguiente campo
      res.push(limpio);
    }
    return res.join(" ").trim();
  }
  function extraerNombreProductor(html) {
    var NOMBRE = "([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .'’-]{5,58})";
    var etiquetas = [
      "NOMBRE\\s+DEL\\s+PRODUCTOR", "NOMBRES?\\s+Y\\s+APELLIDOS?", "NOMBRE\\s+COMPLETO",
      "PRODUCTOR", "PROPIETARIO", "DUE(?:Ñ|N)O", "TITULAR", "RESPONSABLE"
    ];
    var i, m, v;
    // 1) valor dentro de un input cercano a la etiqueta (lo más fiable en la ficha)
    for (i = 0; i < etiquetas.length; i++) {
      m = html.match(new RegExp(etiquetas[i] + "[\\s\\S]{0,260}?value\\s*=\\s*[\"']\\s*" + NOMBRE + "\\s*[\"']", "i"));
      if (m) { v = limpiarNombre(m[1]); if (esNombrePersona(v)) return v; }
    }
    // 2) etiqueta seguida del valor en texto plano
    var texto = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
    for (i = 0; i < etiquetas.length; i++) {
      m = texto.match(new RegExp(etiquetas[i] + "\\s*:?\\s*" + NOMBRE, "i"));
      if (m) { v = limpiarNombre(m[1]); if (esNombrePersona(v)) return v; }
    }
    // 3) input cuyo name/id menciona al productor/propietario
    m = html.match(/(?:name|id)\s*=\s*["'][^"']*(?:productor|propietario|due|nombre)[^"']*["'][^>]*value\s*=\s*["']\s*([^"']{6,60})["']/i);
    if (m) { v = limpiarNombre(m[1].toUpperCase()); if (esNombrePersona(v)) return v; }
    return "";
  }

  async function sincronizarCue(cue, log) {
    log(`⏳ ${cue}: consultando SNITB…`);
    const fila = await leerFila(cue);
    const areas = await leerAreas(fila.hrefDetalle);
    if (fila.bovinos === null) throw new Error("no pude leer los bovinos (insignia)");
    if (areas.areaBovino === null) throw new Error("no pude leer el área bovina — regístralo manual en el panel");
    const res = await apiPost({ tipo: "guardarCue", cue: digitos(cue), nombre: fila.nombre,
                                areaBovino: areas.areaBovino, bovinos: fila.bovinos, fechaDato: hoy() });
    if (res.status !== "success") throw new Error(res.message || "error al guardar");
    log(`✅ ${cue}: ${fila.nombre} — ${areas.areaBovino} Mz, ${fila.bovinos} bovinos`);
    return true;
  }

  /* ---------------- panel flotante ---------------- */
  const css = `
    #aretesPanel{position:fixed;bottom:16px;right:16px;z-index:99999;width:330px;background:#0f172a;color:#f1f5f9;
      border:1px solid #00d2ff55;border-radius:14px;font:13px 'Segoe UI',sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5);}
    #aretesPanel .ap-head{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;
      border-bottom:1px solid #ffffff18;cursor:default;}
    #aretesPanel .ap-head b{color:#00d2ff;}
    #aretesPanel .ap-body{padding:12px 14px;max-height:46vh;overflow-y:auto;}
    #aretesPanel button{background:#00d2ff;color:#03222b;border:none;border-radius:8px;padding:8px 12px;
      font-weight:700;cursor:pointer;font-size:12px;}
    #aretesPanel button.ghost{background:transparent;border:1px solid #00d2ff;color:#00d2ff;}
    #aretesPanel input{background:#0b1120;border:1px solid #ffffff25;color:#fff;border-radius:8px;padding:7px 9px;width:130px;}
    #aretesPanel .ap-log{margin-top:10px;background:#0b1120;border-radius:8px;padding:8px 10px;max-height:150px;
      overflow-y:auto;font-size:12px;line-height:1.5;white-space:pre-wrap;}
    #aretesPanel .ap-mini{color:#94a3b8;font-size:11px;margin-top:8px;}
    #aretesPanel .ap-x{background:none;border:none;color:#94a3b8;font-size:15px;cursor:pointer;}
  `;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const panel = document.createElement("div");
  panel.id = "aretesPanel";
  panel.innerHTML = `
    <div class="ap-head"><b>🏷️ AretesApp — Puente SNITB</b><button class="ap-x" title="Cerrar">✕</button></div>
    <div class="ap-body">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
        <input id="apCue" placeholder="CUE (ej. 9316044757)" inputmode="numeric">
        <button id="apUno">Sincronizar</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button id="apTodos" class="ghost">⟳ Sincronizar TODOS los CUE registrados</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin:4px 0 10px;cursor:pointer;font-size:12px;padding:8px;background:#0b1120;border-radius:8px;border:1px solid #ffffff20">
        <input type="checkbox" id="apGuardia" style="width:auto"> 🛡️ <b>Modo de guardia</b> — atender consultas en vivo de los habilitados
      </label>
      <div class="ap-log" id="apLog">Listo. Usa tu sesión abierta del SNITB.</div>
      <div class="ap-mini">Con el <b>modo de guardia</b> activado, deja esta pestaña abierta: cada vez que un
      habilitado consulte un CUE en su app, el bot lo busca en el SNITB y le responde en vivo. Cierra con ✕ para detener.</div>
    </div>`;
  document.body.appendChild(panel);

  const logEl = panel.querySelector("#apLog");
  let detener = false;
  let guardiaTimer = null;
  const log = m => { logEl.textContent += "\n" + m; logEl.scrollTop = logEl.scrollHeight; };

  panel.querySelector(".ap-x").onclick = () => { detener = true; if (guardiaTimer) clearInterval(guardiaTimer); panel.remove(); };

  panel.querySelector("#apUno").onclick = async () => {
    const cue = panel.querySelector("#apCue").value.trim();
    if (!digitos(cue)) { log("✗ Escribe un CUE válido."); return; }
    try { await sincronizarCue(cue, log); } catch (e) { log(`✗ ${cue}: ${e.message}`); }
  };

  panel.querySelector("#apTodos").onclick = async () => {
    detener = false;
    log("⟳ Obteniendo lista de CUE registrados en AretesApp…");
    let lista = [];
    try { lista = await apiGet("cues"); } catch (e) { log("✗ No pude leer la lista: " + e.message); return; }
    if (!lista.length) { log("No hay CUEs registrados aún. Sincroniza uno con el campo de arriba."); return; }
    log(`${lista.length} CUE(s) por sincronizar.`);
    let ok = 0, fail = 0;
    for (const item of lista) {
      if (detener) { log("⏹ Detenido."); break; }
      try { await sincronizarCue(item.cue, log); ok++; }
      catch (e) { log(`✗ ${item.cue}: ${e.message}`); fail++; }
      await espera(PAUSA_MS);
    }
    log(`— Fin: ${ok} sincronizados, ${fail} con error —`);
  };

  /* ---------------- modo de guardia (relay en vivo) ---------------- */
  // Lista todos los establecimientos que aparecen al buscar un CUPA
  async function listarPorCupa(cupa) {
    const q = String(cupa || "").trim();
    const url = "https://trazabilidad.ipsa.gob.ni/establecimientos.php?c=&pfechaini=2010-01-01&pfechafin=2026-12-31&q=" + encodeURIComponent(q) + "&search=Buscar";
    const html = await (await fetch(url, { credentials: "include" })).text();
    if (/login|iniciar sesi/i.test(html) && !/Establecimientos/i.test(html)) throw new Error("Sesión del SNITB vencida");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const filas = [...doc.querySelectorAll("tr")].filter(tr => tr.querySelector('[title="BOVINOS"]'));
    return filas.map(f => {
      const link = f.querySelector("a.frame");
      const tds = [...f.querySelectorAll("td")].map(td => td.textContent.trim().replace(/\s+/g, " "));
      const cue = tds.find(t => /^\d{10,15}$/.test(t.replace(/\s/g, "")));
      const badge = f.querySelector('[title="BOVINOS"]');
      return {
        cue: cue || "",
        nombre: link ? (link.getAttribute("title") || link.textContent).trim().replace(/\.+$/, "") : "",
        bovinos: badge ? Number(digitos(badge.textContent)) : "",
        hrefDetalle: link ? link.getAttribute("href") : null
      };
    }).filter(x => x.cue);
  }

  async function atenderPendientes() {
    let jobs = [];
    try { jobs = await apiGet("trabajosPendientes"); } catch (e) { return; }
    if (!Array.isArray(jobs) || !jobs.length) return;
    for (const j of jobs) {
      try {
        if (j.tipo === "CUPA") {
          const lista = await listarPorCupa(j.termino);
          let unico = null, nombreProductor = "";
          if (lista.length >= 1) {
            // Abre UNA ficha (la primera) para leer el NOMBRE de la persona (es el mismo para todas sus fincas)
            let areas0 = {};
            try { areas0 = await leerAreas(lista[0].hrefDetalle); } catch (e) {}
            nombreProductor = areas0.nombreProductor || "";
            if (lista.length === 1) {
              unico = { cue: lista[0].cue, nombre: lista[0].nombre, areaBovino: areas0.areaBovino, bovinos: lista[0].bovinos, nombreProductor: nombreProductor };
            }
          }
          const listaLimpia = lista.map(x => ({ cue: x.cue, nombre: x.nombre, bovinos: x.bovinos }));
          await apiPost({ tipo: "entregarResultadoCue", jobId: j.jobId, datos: { lista: listaLimpia, unico, nombreProductor } });
          log(`📡 CUPA ${j.termino}: ${lista.length} establecimiento(s)${nombreProductor ? " — " + nombreProductor : ""}`);
        } else {
          const fila = await leerFila(j.termino);
          const areas = await leerAreas(fila.hrefDetalle);
          if (fila.bovinos === null || areas.areaBovino === null) throw new Error("dato incompleto en el SNITB");
          await apiPost({ tipo: "entregarResultadoCue", jobId: j.jobId,
            datos: { cue: digitos(j.termino), nombre: fila.nombre, areaBovino: areas.areaBovino, bovinos: fila.bovinos, nombreProductor: areas.nombreProductor || "" } });
          log(`📡 CUE ${j.termino} → ${fila.nombre} (${areas.areaBovino} Mz, ${fila.bovinos} bov.)`);
        }
      } catch (e) {
        try { await apiPost({ tipo: "entregarResultadoCue", jobId: j.jobId, datos: { error: e.message } }); } catch (_) {}
        log(`⚠️ ${j.termino}: ${e.message}`);
      }
      await espera(600);
    }
  }
  panel.querySelector("#apGuardia").onchange = (ev) => {
    if (ev.target.checked) {
      log("🛡️ Modo de guardia ACTIVADO — atendiendo consultas en vivo. Deja esta pestaña abierta.");
      atenderPendientes();
      guardiaTimer = setInterval(atenderPendientes, 4000);
    } else {
      if (guardiaTimer) clearInterval(guardiaTimer);
      guardiaTimer = null;
      log("⚪ Modo de guardia desactivado.");
    }
  };
})();
