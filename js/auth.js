const START_GG_CLIENT_ID = '281';
const START_GG_REDIRECT_URI = 'https://smashjanus.github.io/uff-tools/';
const START_GG_AUTH_URL = 'https://start.gg/oauth/authorize';
const START_GG_AUTH_SCOPES = ['user.identity', 'tournament.reporter'];
const SMASH_JANUS_SESSION_KEY = 'smashJanus.startgg.sessionId';
const SMASH_JANUS_ADMIN_KEY = 'smashJanus.startgg.isAdmin';
const SMASH_JANUS_OAUTH_STATE_KEY = 'smashJanus.startgg.oauthState';

document.addEventListener('DOMContentLoaded', () => {
  const loginButton = document.getElementById('startgg-login-button');
  const logoutButton = document.getElementById('logout-button');

  if (loginButton) {
    loginButton.addEventListener('click', beginStartGgLogin);
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', logoutSmashJanus);
  }

  handleOAuthReturn();
});

function beginStartGgLogin() {
  if (!START_GG_CLIENT_ID) {
    showAuthMessage('Add your public start.gg client ID in js/auth.js.');
    return;
  }

  const state = createOAuthState();
  sessionStorage.setItem(SMASH_JANUS_OAUTH_STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: START_GG_CLIENT_ID,
    scope: START_GG_AUTH_SCOPES.join(' '),
    redirect_uri: START_GG_REDIRECT_URI,
    state
  });

  window.location.assign(`${START_GG_AUTH_URL}?${params.toString()}`);
}

async function handleOAuthReturn() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (error) {
    showAuthMessage(params.get('error_description') || 'Se canceló el login');
    clearOAuthQuery();
    setLogoutVisible(false);
    return;
  }

  if (!code) {
    restoreExistingSession();
    return;
  }

  if (!isValidOAuthState(params.get('state'))) {
    showAuthMessage('Intentá de nuevo');
    clearOAuthQuery();
    return;
  }

  setLoginButtonLoading(true);
  showAuthMessage('Terminando login...');

  try {
    const result = await gasRequest('exchangeAuthCode', {
      code,
      redirectUri: START_GG_REDIRECT_URI
    });

    localStorage.setItem(SMASH_JANUS_SESSION_KEY, result.sessionId);
    localStorage.setItem(SMASH_JANUS_ADMIN_KEY, result.isAdmin ? '1' : '0');
    sessionStorage.removeItem(SMASH_JANUS_OAUTH_STATE_KEY);
    clearOAuthQuery();
    showView('player-dashboard-view');
    setLogoutVisible(true);
    window.dispatchEvent(new CustomEvent('smashjanus:authenticated', {
      detail: result
    }));
  } catch (error) {
    showAuthMessage(error.message || 'No se pudo completar el login con start.gg');
  } finally {
    setLoginButtonLoading(false);
  }
}

async function restoreExistingSession() {
  const sessionId = getSmashJanusSessionId();

  if (!sessionId) {
    setLogoutVisible(false);
    return;
  }

  try {
    const status = await gasRequest('status', { sessionId });

    if (!status.authenticated) {
      clearSmashJanusSession();
      setLogoutVisible(false);
      return;
    }

    localStorage.setItem(SMASH_JANUS_ADMIN_KEY, status.isAdmin ? '1' : '0');
    showView('player-dashboard-view');
    setLogoutVisible(true);
    window.dispatchEvent(new CustomEvent('smashjanus:authenticated', {
      detail: {
        ...status,
        sessionId
      }
    }));
  } catch (error) {
    clearSmashJanusSession();
    setLogoutVisible(false);
  }
}

async function logoutSmashJanus() {
  const sessionId = getSmashJanusSessionId();

  setLogoutButtonLoading(true);

  try {
    if (sessionId) {
      await gasRequest('logout', { sessionId });
    }
  } catch (error) {
    // Local logout should still happen if the network is unavailable.
  } finally {
    clearSmashJanusSession();
    sessionStorage.removeItem(SMASH_JANUS_OAUTH_STATE_KEY);
    setLogoutButtonLoading(false);
    showView('login-view');
    setLogoutVisible(false);
    showAuthMessage('Sesión cerrada.');
  }
}

function getSmashJanusSessionId() {
  return localStorage.getItem(SMASH_JANUS_SESSION_KEY);
}

function clearSmashJanusSession() {
  localStorage.removeItem(SMASH_JANUS_SESSION_KEY);
  localStorage.removeItem(SMASH_JANUS_ADMIN_KEY);
}

function isSmashJanusAdmin() {
  return localStorage.getItem(SMASH_JANUS_ADMIN_KEY) === '1';
}

function createOAuthState() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function isValidOAuthState(state) {
  const expectedState = sessionStorage.getItem(SMASH_JANUS_OAUTH_STATE_KEY);
  return Boolean(expectedState && state && state === expectedState);
}

function clearOAuthQuery() {
  const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, document.title, cleanUrl);
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach(view => {
    view.classList.toggle('hidden', view.id !== viewId);
  });
  setLogoutVisible(viewId !== 'login-view' && Boolean(getSmashJanusSessionId()));
}

function showAuthMessage(message) {
  const loginView = document.getElementById('login-view');

  if (!loginView) {
    return;
  }

  let messageElement = document.getElementById('auth-message');

  if (!messageElement) {
    messageElement = document.createElement('p');
    messageElement.id = 'auth-message';
    messageElement.className = 'auth-message';
    loginView.appendChild(messageElement);
  }

  messageElement.textContent = message;
}

function setLoginButtonLoading(isLoading) {
  const loginButton = document.getElementById('startgg-login-button');

  if (!loginButton) {
    return;
  }

  loginButton.disabled = isLoading;
  loginButton.textContent = isLoading ? 'Logging in...' : 'Login con start.gg';
}

function setLogoutVisible(isVisible) {
  const logoutButton = document.getElementById('logout-button');

  if (logoutButton) {
    logoutButton.classList.toggle('hidden', !isVisible);
  }
}

function setLogoutButtonLoading(isLoading) {
  const logoutButton = document.getElementById('logout-button');

  if (!logoutButton) {
    return;
  }

  logoutButton.disabled = isLoading;
  logoutButton.textContent = isLoading ? 'Saliendo...' : 'Salir';
}

window.SmashJanusAuth = {
  beginStartGgLogin,
  logout: logoutSmashJanus,
  getSessionId: getSmashJanusSessionId,
  isAdmin: isSmashJanusAdmin,
  clearSession: clearSmashJanusSession,
  showView
};
