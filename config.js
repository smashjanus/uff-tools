// GitHub Pages needs the public HTTPS URL of the Salamandra server for shared
// start.gg data, login and administrator actions. Local development uses /api.
export const CONFIG = {
  name: 'Salamandra Queue',
  mode: 'demo',
  apiBase: ['localhost', '127.0.0.1'].includes(location.hostname) ? '/api' : '',
  refreshMs: 15000,
};
