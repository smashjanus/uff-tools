// Pega aquí la URL terminada en /exec que entrega Google Apps Script.
// Déjala vacía para conservar la demo estática de GitHub Pages.
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzoAw5dUCTruXRIMrg8cc3Oiv5r0NgWVtJBK1AuZXNZjkvaAX4McgLq26I1COB_NVvt/exec';
const appsScript = Boolean(APPS_SCRIPT_URL.trim());

export const CONFIG = {
  name: 'Salamandra Queue',
  mode: appsScript ? 'apps-script' : 'demo',
  backend: appsScript ? 'apps-script' : 'demo',
  apiBase: appsScript ? APPS_SCRIPT_URL.trim() : '',
  refreshMs: 30000,
  fullReloadMs: 120000,
  oauthEnabled: appsScript,
  poolSchedules: {
    A: { date: '26 de septiembre de 2026', time: '09:30–9:45 a. m.' },
    B: { date: '26 de septiembre de 2026', time: '01:15–01:30 p. m.' },
  },
};
