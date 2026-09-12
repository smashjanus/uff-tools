// Pega aquí la URL terminada en /exec que entrega Google Apps Script.
// Déjala vacía para conservar la demo estática de GitHub Pages.
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzoAw5dUCTruXRIMrg8cc3Oiv5r0NgWVtJBK1AuZXNZjkvaAX4McgLq26I1COB_NVvt/exec';
const local = ['localhost', '127.0.0.1'].includes(location.hostname);

export const CONFIG = {
  name: 'Salamandra Queue',
  mode: local ? 'node' : APPS_SCRIPT_URL ? 'apps-script' : 'demo',
  backend: local ? 'node' : APPS_SCRIPT_URL ? 'apps-script' : 'demo',
  apiBase: local ? '/api' : APPS_SCRIPT_URL.trim(),
  refreshMs: local ? 15000 : 30000,
  oauthEnabled: local || Boolean(APPS_SCRIPT_URL),
};
