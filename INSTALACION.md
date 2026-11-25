# AretesApp v2 — Instalación (Supabase + extensión de Chrome)

```
 Habilitado (celular)          Supabase (PostgreSQL + tiempo real)          Tu PC (Chrome)
 habilitado.html  ── RPC ──►  funciones seguras  ◄── tiempo real ──  Extensión "Puente SNITB"
 digitador.html   ── RPC ──►  tablas protegidas                       └─ pestaña del SNITB (tu sesión)
```

**Qué cambia respecto a la v1**
- La base de datos pasa de Google Sheets a **Supabase**: sin bloqueos de hoja, sin límites de Apps Script y con respuestas en milisegundos.
- El puente ya no es un script de Tampermonkey, sino una **extensión de Chrome**:
  - Al recargar el SNITB (F5), la guardia **sigue activa**.
  - Arranca sola cuando abres Chrome.
  - Abre la pestaña del SNITB si no está abierta.
  - Te avisa con una notificación cuando la sesión del SNITB vence.
- Las consultas de los habilitados llegan **al instante**: el bot ya no tiene que preguntar a cada rato si hay algo nuevo.
- El digitador entra con **correo y contraseña**. Los PIN de los habilitados se guardan cifrados y se bloquean tras 5 intentos fallidos.
- En el panel hay pestañas nuevas: **Habilitados** (alta, edición y cambio de PIN) y **Puente SNITB** (estado y registro de consultas).

> Los datos de la v1 (Google Sheets) ya se migraron a Supabase el 24/11/2026 y se verificaron uno por uno. La sección de migración se quitó del panel porque ya no se necesita.

---

## Paso 1 — Crear el proyecto en Supabase (5 min)
1. Entra a <https://supabase.com> e inicia sesión (por ejemplo, con tu cuenta de GitHub).
2. **New project**. Ponle nombre `aretesapp`, crea una contraseña de base de datos y guárdala. Como región, elige **East US** (es la más cercana a Nicaragua).
3. Espera a que termine de crearse (1–2 min).
4. Ve a **Project Settings → API** (o **Data API / API Keys**) y copia estos dos datos:
   - **Project URL** → por ejemplo `https://abcdxyz.supabase.co`
   - **anon public key** (o **Publishable key**)
   > ⚠️ La clave **service_role** (o **secret**) NO se pone nunca en la app.

## Paso 2 — Crear la base de datos (2 min)
1. En Supabase abre **SQL Editor → New query**.
2. Pega **todo** el contenido de `supabase/schema.sql` y pulsa **Run**. Debe decir *Success*.
   (Si algún día lo vuelves a ejecutar, no se pierde nada.)

## Paso 3 — Crear tu usuario de digitador (2 min)
1. **Authentication → Users → Add user → Create new user**. Escribe tu correo y una contraseña fuerte y marca **Auto Confirm User**.
2. En **SQL Editor**, abre `supabase/agregar_digitador.sql`, cambia el correo por el tuyo y pulsa **Run**.
3. Recomendado: en **Authentication → Sign In / Providers**, desactiva **Allow new users to sign up**. Así nadie más puede crearse una cuenta.

## Paso 4 — Configurar y probar la web (5 min)
1. Abre `config.js` y pega tu **Project URL** y tu **anon key**.
2. Prueba en tu PC antes de publicar. En la carpeta, ejecuta `python -m http.server 8000` y abre <http://localhost:8000/digitador.html>.
3. Entra con el correo y la contraseña del Paso 3.

## Paso 5 — Instalar la extensión "Puente SNITB" (5 min)
1. Abre `extension/config.js` y pega **los mismos** URL y anon key.
2. En Chrome, abre `chrome://extensions` y activa **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar descomprimida** y elige la carpeta `extension`.
4. Fija el ícono 🏷️ en la barra: botón de rompecabezas → 📌.
5. **Desactiva el script viejo de Tampermonkey** ("AretesApp - Bot Puente SNITB"). Si no lo haces, verás dos paneles.
6. Clic en el ícono → entra con tu correo y contraseña de digitador. La guardia se activa sola.
7. Pulsa **Abrir SNITB** e inicia sesión en el SNITB como siempre.
8. La insignia del ícono te dice el estado:
   - **ON** (verde): en guardia, todo bien.
   - **!** (amarillo): falta iniciar sesión en el SNITB o en la extensión.
   - **OFF**: guardia apagada.

**Para que nunca se caiga:**
- No cierres la pestaña fijada del SNITB. Si la cierras, la extensión la vuelve a abrir cuando llegue una consulta.
- Chrome → Configuración → Rendimiento → **Ahorro de memoria**: agrega `trazabilidad.ipsa.gob.ni` a "Mantener siempre activos estos sitios".
- Si la sesión del SNITB vence, te sale una notificación. Haz clic en ella, inicia sesión y listo: la guardia sigue sola.

## Paso 6 — Publicar (el cambio)
1. Sube a tu repositorio de GitHub (`aretesapp-web`):
   - Los archivos de la web: `index.html`, `habilitado.html`, `digitador.html`, `backend.js`, `config.js`, `manifest.json` y los íconos.
   - La carpeta `supabase/` también, como referencia (no tiene secretos).
   - **No subas** la carpeta `extension/` ni `Code.gs`.
2. Borra del repositorio `snitb-sync.user.js` y `Code.gs`. Ya no se usan.
3. Pide a los habilitados que **recarguen la app** (o borren la caché). Entran con el mismo número y PIN de siempre.

## Prueba final (2 min)
1. En tu celular, entra como habilitado → **Estado CUE** → debe decir **● En línea**.
2. Consulta un CUE: debe responder en 2–5 segundos con "Datos en vivo".
3. Ahora recarga la pestaña del SNITB con **F5** y vuelve a consultar: debe seguir respondiendo. ✅
4. En el panel → pestaña **Puente SNITB** → verás cada consulta con su tiempo de respuesta.

## Mantenimiento
- **Copia de seguridad:** Supabase (plan gratis) no guarda copias automáticas. Una vez a la semana, ve a **Table Editor**, abre `expedientes` y `detalle` → **Export → CSV**.
- **Proyecto pausado:** en el plan gratis, el proyecto se pausa si pasa 7 días sin uso. Con el uso diario no pasa, pero si ocurre, entra a Supabase y pulsa **Restore**.
- **Actualizar la extensión:** reemplaza los archivos de la carpeta y pulsa ⟳ en `chrome://extensions`. No sobrescribas `extension/config.js`.
