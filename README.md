# AretesApp Web

Sistema de control de entrega y trazabilidad de aretes (CUIA) por **habilitado** y **productor**,
para la operadora de la Alcaldía El Tortuguero (licencia IPSA).

Reemplaza la app nativa de Android + el `index.html` local por **web-móvil** (HTML/CSS/JS) con
**Google Sheets** como base de datos vía **Google Apps Script**.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Página de inicio con acceso a los dos tableros. |
| `habilitado.html` | Tablero del **habilitado** (reemplaza la app Android). |
| `digitador.html` | Panel del **digitador** (tú). |
| `backend.js` | Cliente de datos. **Async.** Modo remoto (Sheets) o local (localStorage). |
| `Code.gs` | Backend en **Google Apps Script** (se pega en el editor de la hoja). |
| `INSTALACION.md` | Paso a paso: Sheets + Apps Script + publicar en GitHub Pages. |

## Dos modos (los controla `backend.js`)

```js
const SCRIPT_URL = "";   // vacío  → LOCAL  (localStorage, pruebas sin internet)
                         // con URL → REMOTO (Google Sheets, datos reales compartidos)
```

## Probar en LOCAL (sin Google todavía)

Para que los dos tableros compartan datos deben abrirse desde el mismo origen. Levanta un servidor local en la carpeta:

```bash
python -m http.server 8000
```

y abre `http://localhost:8000/` . Entra como habilitado con número **1537** / PIN **1234**.
Para reiniciar los datos de prueba: consola del navegador (F12) → `Backend._reset()`.

## Pasar a PRODUCCIÓN (Google Sheets + GitHub)

Sigue **`INSTALACION.md`**. Resumen: pega `Code.gs` en Apps Script, ejecuta `inicializar()`,
despliega como Web App, copia la URL `/exec` a `SCRIPT_URL` en `backend.js`, y sube todo a GitHub Pages.

## Flujo

1. **Habilitado** crea un expediente y agrega sus productores (CUPA, CUE, cantidad) → estado `PENDIENTE_PAGO`.
2. Paga en caja y lleva el recibo.
3. **Digitador** ingresa el recibo y aprueba → el sistema asigna los **CUIA por productor** y descuenta el lote → `PAGADO`.
4. **Digitador** copia, productor por productor, los datos al formulario del IPSA y marca cada entrega → `ENTREGADO`.
5. **Habilitado** ve el estado y los CUIA asignados a cada productor.

## Datos de prueba

Habilitados `1537` y `1601` (PIN `1234`). Lote CUIA 15972996–15978995 (6000). Precio C$60.
