# AretesApp Web — v2 (Supabase + Puente SNITB en extensión de Chrome)

Sistema de control de entrega y trazabilidad de aretes (CUIA) por **habilitado** y **productor**,
para la operadora de la Alcaldía El Tortuguero (licencia IPSA).

| Archivo / carpeta | Qué es |
|---|---|
| `index.html` | Inicio con acceso a los dos tableros. |
| `habilitado.html` | Portal del **habilitado** (celular). |
| `digitador.html` | Panel del **digitador** (con inicio de sesión). |
| `backend.js` | Cliente de datos sobre Supabase (misma interfaz `Backend.*` que la v1). |
| `config.js` | URL y clave pública de Supabase. **No lo sobrescribas al actualizar.** |
| `supabase/schema.sql` | Base de datos: tablas, seguridad (RLS) y funciones. |
| `supabase/agregar_digitador.sql` | Autoriza una cuenta como digitador. |
| `extension/` | Extensión de Chrome **Puente SNITB** (no se sube a GitHub Pages). |
| `Code.gs` | Backend viejo de Google Sheets. Solo como respaldo: no se publica ni se usa. |

Instalación paso a paso: **`INSTALACION.md`**.

## Flujo
1. El **habilitado** crea un expediente con sus productores → `PENDIENTE_PAGO`.
2. Paga en caja → el **digitador** aprueba con el recibo → se asignan los CUIA por productor (atómico) → `PAGADO`.
3. El digitador pasa los datos al IPSA y marca cada entrega → `ENTREGADO`.
4. Consultas de CUE/CUPA en vivo: habilitado → cola en Supabase → extensión (tiempo real) → SNITB → respuesta en segundos.
