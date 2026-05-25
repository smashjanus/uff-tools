const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyWuroFP51vC0ySGDq2BdIMySmo3WelWLRL-8VM9CuIsrPMjh91ngYx4qv4U87BRVQOug/exec';

async function gasRequest(action, payload = {}) {
  if (!GAS_WEB_APP_URL) {
    throw new Error('Decile a Koki que agregue el GAS_WEB_APP_URL');
  }

  const requestBody = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? { action, ...payload }
    : { action, payload };

  let response;

  try {
    response = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    throw new Error('No sirve esta porquería. Decile a Koki');
  }

  let data;

  try {
    data = await response.json();
  } catch (error) {
    throw new Error('El backend de Smash Janus se rompió el ligamento cruzado. Respuesta inválida. ');
  }

  if (!response.ok || data.ok === false) {
    const message = data.message || `Solicitud falló con el status: ${response.status}.`;
    const error = new Error(message);
    error.response = data;
    error.status = response.status;
    throw error;
  }

  return data;
}

async function reportSet({ sessionId, setId, winnerId, gameData, selections = [], summary = null }) {
  return gasRequest('reportSet', {
    sessionId,
    setId,
    winnerId,
    gameData,
    selections,
    summary
  });
}

async function getUltimateCharacters(sessionId) {
  return gasRequest('getUltimateCharacters', { sessionId });
}

async function getSetReportStatus({ sessionId, setId }) {
  return gasRequest('getSetReportStatus', { sessionId, setId });
}

window.GAS_WEB_APP_URL = GAS_WEB_APP_URL;
window.gasRequest = gasRequest;
window.reportSet = reportSet;
window.getUltimateCharacters = getUltimateCharacters;
window.getSetReportStatus = getSetReportStatus;
window.SmashJanusApi = {
  gasRequest,
  reportSet,
  getUltimateCharacters,
  getSetReportStatus
};
