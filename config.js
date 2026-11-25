/* =====================================================================
   AretesApp v2 - CONFIGURACIÓN DE CONEXIÓN (config.js)
   ---------------------------------------------------------------------
   Único archivo donde se configura la conexión a Supabase.
   Los dos datos están en Supabase → Project Settings → API:
     • Project URL           → SUPABASE_URL
     • anon / public key     → SUPABASE_ANON_KEY   (es pública, es seguro
                                que esté aquí: la base está protegida por
                                RLS y funciones con validación)
   NUNCA pongas aquí la "service_role key".

   Cuando actualices la app con archivos nuevos, NO sobrescribas este
   archivo, así tus claves se conservan.
   ===================================================================== */

window.SUPABASE_URL      = "https://vzgvrinetlfizlsenwgh.supabase.co";   // ej. ""
window.SUPABASE_ANON_KEY = "sb_publishable_F71q5CaD3P3IUMIqXoVZ8Q_Hrp5gMKt";   // ej. ""
