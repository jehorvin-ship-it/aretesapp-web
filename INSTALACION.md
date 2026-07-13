# AretesApp — Instalación (Google Sheets + Apps Script + GitHub)

Guía para poner la base de datos real en **Google Sheets** y publicar las web app en **GitHub Pages**.

Arquitectura:

```
  Navegador (GitHub Pages)                Google
  ┌─────────────────────┐   fetch()   ┌──────────────────────────┐
  │ index.html          │  ─────────► │ Apps Script (Code.gs)    │
  │ habilitado.html     │  ◄───────── │  doGet / doPost          │
  │ digitador.html      │    JSON     │        ▼                 │
  │ backend.js          │             │  Google Sheets (5 hojas) │
  └─────────────────────┘             └──────────────────────────┘
```

---

## PARTE A — Base de datos en Google Sheets

1. Entra a <https://sheets.google.com> y crea una **hoja de cálculo nueva**. Ponle nombre, por ejemplo `AretesApp DB`.
2. Menú **Extensiones → Apps Script**. Se abre el editor.
3. Borra lo que venga en `Código.gs` y **pega todo el contenido de `Code.gs`** de este proyecto. Guarda (💾).
4. En el editor, arriba selecciona la función **`inicializar`** y pulsa **Ejecutar** (▶).
   - Google pedirá permisos la primera vez → *Revisar permisos* → elige tu cuenta → *Avanzado* → *Ir a (nombre) (no seguro)* → *Permitir*.
   - Esto crea las 5 pestañas (`Config`, `Habilitados`, `Productores`, `Expedientes`, `Detalle`) con datos de prueba.
5. Vuelve a la hoja de cálculo: verás las pestañas creadas. Aquí puedes editar precio, lote y habilitados a mano cuando quieras.
6. **Cargar los habilitados reales de la operadora:** en el editor selecciona la función **`configurarOperadora`** y pulsa **Ejecutar**. Esto rellena `Config` si estaba vacío y carga la lista de habilitados con estado `ACTIVO` y PIN por defecto `1234`. Cambia los PIN por habilitado directamente en la hoja `Habilitados` cuando quieras.

> **¿Mejor escribir los habilitados a mano?** No hace falta: `configurarOperadora()` los carga sin errores de tipeo. Si prefieres agregarlos/editarlos a mano, solo cuida que la columna **estado** diga `ACTIVO` (si la dejas en blanco ahora también funciona; el login solo bloquea si dice `PENDIENTE`, `INACTIVO` o `BLOQUEADO`).

### Publicar el Web App

6. En el editor de Apps Script: **Implementar → Nueva implementación**.
7. Engranaje ⚙ → tipo **Aplicación web**.
8. Configura:
   - **Descripción:** AretesApp API
   - **Ejecutar como:** *Yo (tu correo)*
   - **Quién tiene acceso:** **Cualquier persona**  ← importante para que las web puedan llamarla
9. **Implementar** → copia la **URL** que termina en `/exec`. Esa es tu `SCRIPT_URL`.

> Cada vez que cambies el `Code.gs`, usa **Implementar → Gestionar implementaciones → editar (✏) → Nueva versión** para que los cambios salgan en vivo (así la URL no cambia).

---

## PARTE B — Conectar el frontend

1. Abre `backend.js` y pega tu URL en la línea:

   ```js
   const SCRIPT_URL = "https://script.google.com/macros/s/XXXXXXXX/exec";
   ```

   - Con URL puesta → modo **REMOTO** (Google Sheets, datos compartidos de verdad).
   - Vacía `""` → modo **LOCAL** (localStorage, para pruebas).

2. Prueba local rápida: abre `digitador.html`; en la consola (F12) debe decir `Backend en modo: REMOTO (Google Sheets)` y cargar sin errores.

---

## PARTE C — Subir a GitHub y publicar (GitHub Pages)

1. Crea un repositorio nuevo en GitHub (ej. `aretesapp-web`).
2. Sube estos archivos (por la web con *Add file → Upload files*, o por consola):

   ```
   index.html
   habilitado.html
   digitador.html
   backend.js
   manifest.json
   icon-192.png
   icon-512.png
   icon-maskable-512.png
   README.md
   INSTALACION.md
   Code.gs          (referencia; el que corre es el pegado en Apps Script)
   ```

   Por consola:

   ```bash
   git init
   git add .
   git commit -m "AretesApp web"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/aretesapp-web.git
   git push -u origin main
   ```

3. En el repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/root`. Guardar.
4. En 1-2 minutos tu app queda pública en:
   - `https://TU_USUARIO.github.io/aretesapp-web/`  (landing)
   - `.../habilitado.html` y `.../digitador.html`

Los habilitados abren el enlace `habilitado.html` en su celular y pueden **instalarlo** desde el menú del navegador ("Agregar a pantalla de inicio").

---

## Estructura de las hojas (referencia)

**Config** — precio · cuiaSiguiente · cuiaFinLote
**Habilitados** — numero · nombre · cedula · pin · estado
**Productores** — cupa · nombre · cue · habilitadoNumero
**Expedientes** — id · fecha · categoria · habilitadoNumero · habilitadoNombre · estado · recibo · controlPago · totalAretes · total · fechaAprobacion
**Detalle** — expedienteId · idx · cupa · nombre · cue · cantidad · cuiaInicial · cuiaFinal · entregado

Estados de un expediente: `PENDIENTE_PAGO` → `PAGADO` (recibo + CUIA asignados) → `ENTREGADO` (todos sus productores marcados en el IPSA).

---

## Solución de problemas

- **El scroll solo funciona con 2 dedos / la app se ve como una versión vieja:** el celular está
  cargando una versión ANTERIOR desde la caché (GitHub Pages y Chrome guardan copias hasta ~10 min o más;
  si la app está "instalada" en la pantalla de inicio, la copia puede durar días). Después de subir archivos
  nuevos: espera 2-10 minutos, luego en Chrome del celular abre ⋮ → Historial → Borrar datos de navegación →
  "Imágenes y archivos en caché" (o mantén presionado el botón recargar y elige recarga completa).
  Si la instalaste en pantalla de inicio, elimínala y vuélvela a agregar. Esta versión además carga
  `backend.js?v=3`, que fuerza al navegador a traer el JS nuevo.

- **"Cuenta pendiente de aprobación" al entrar:** la columna `estado` del habilitado está en blanco o dice algo distinto de `ACTIVO`. Ejecuta `configurarOperadora()` o pon `ACTIVO` a mano. (La versión nueva del `Code.gs` ya no bloquea por estado en blanco — recuerda **redesplegar** después de pegar el código actualizado: *Implementar → Gestionar implementaciones → editar ✏ → Nueva versión*.)
- **Totales en C$ 0:** la hoja `Config` está vacía. Ejecuta `configurarOperadora()` (rellena precio y lote por defecto) o escribe los valores en la fila 2.
- **Cambié el `Code.gs` y no se refleja:** los cambios en funciones que corres desde el editor aplican al instante; pero los que afectan al Web App (doGet/doPost, login) requieren **Nueva versión** en Gestionar implementaciones.

## Seguridad (ojo)

- La URL `/exec` con acceso "Cualquier persona" queda pública: quien la tenga puede leer/escribir. Para un sistema interno de bajo riesgo suele bastar, pero conviene:
  - No publicar la `SCRIPT_URL` en sitios visibles.
  - Como mejora futura: agregar un "token" secreto que el frontend mande en cada llamada y el `Code.gs` valide, y hashear los PIN. Te lo puedo implementar cuando quieras.

## Notas

- Para reiniciar los datos de prueba en modo local: consola (F12) → `Backend._reset()`.
- El precio se usa al **crear** el expediente. Si lo cambias en Config, aplica a los expedientes nuevos, no a los ya creados.
