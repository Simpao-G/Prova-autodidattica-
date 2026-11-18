/* Configurazione dell'account (Supabase).
 * Questi due valori sono pubblici: dicono solo all'app dove si trova il server.
 * I dati sono protetti dalle regole della tabella (ognuno vede solo i propri).
 * Finché sono vuoti, l'app funziona come prima, solo su questo dispositivo.
 */
window.ANIMETECA_CONFIG = {
  supabaseUrl: "", // es. "https://abcdefgh.supabase.co"
  supabaseKey: "", // la "publishable key" (sb_publishable_...) oppure la vecchia "anon key"
};
