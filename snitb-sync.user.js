// ==UserScript==
// @name         AretesApp - Bot Puente SNITB
// @namespace    aretesapp
// @version      1.0
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

    return { areaBovino: buscar("AREA\\s*BOVINO"), areaFinca: buscar("AREA\\s*DE\\s*LA\\s*FINCA") };
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
      <div style="display:flex;gap:8px;margin-bottom:4px">
        <button id="apTodos" class="ghost">⟳ Sincronizar TODOS los CUE registrados</button>
      </div>
      <div class="ap-log" id="apLog">Listo. La sincronización usa tu sesión abierta del SNITB.</div>
      <div class="ap-mini">Los datos van a la hoja <b>CUES</b> de AretesApp con la fecha de hoy.
      Cierra el panel con ✕ para detener todo.</div>
    </div>`;
  document.body.appendChild(panel);

  const logEl = panel.querySelector("#apLog");
  let detener = false;
  const log = m => { logEl.textContent += "\n" + m; logEl.scrollTop = logEl.scrollHeight; };

  panel.querySelector(".ap-x").onclick = () => { detener = true; panel.remove(); };

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
})();
