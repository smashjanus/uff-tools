const PLAYER_DASHBOARD_EVENT_ID = '1414455';
const PLAYER_DASHBOARD_TEST_ENTRANT_ID = '';
const PLAYER_DASHBOARD_VISIBLE_SET_STATES = new Set([1, 2]);
const PLAYER_REPORT_PENDING_MESSAGE = 'Esta partida ya fue reportada y está pendiente de aprobación. Avísale al organizador para que sea aprobado el resultado.';
const PLAYER_REPORT_APPROVED_MESSAGE = 'Esta partida ya fue reportada y aprobada por un organizador. Si deseas cambiar algo por favor acércate al equipo de Smash Janus.';
const playerDashboardSetsById = new Map();

window.addEventListener('smashjanus:authenticated', event => {
  const sessionId = event.detail && event.detail.sessionId
    ? event.detail.sessionId
    : getPlayerDashboardSessionId();

  initializePlayerDashboard(sessionId);
});

document.addEventListener('DOMContentLoaded', () => {
  const sessionId = getPlayerDashboardSessionId();
  const dashboardVisible = !document
    .getElementById('player-dashboard-view')
    ?.classList.contains('hidden');
  const reloadButton = document.getElementById('reload-player-matches-button');

  if (reloadButton) {
    reloadButton.addEventListener('click', () => {
      initializePlayerDashboard(getPlayerDashboardSessionId());
    });
  }

  if (sessionId && dashboardVisible) {
    initializePlayerDashboard(sessionId);
  }
});

document.addEventListener('click', async event => {
  const reportButton = event.target.closest('.report-match-button');

  if (!reportButton) {
    return;
  }

  await handleReportMatchClick(reportButton);
});

async function handleReportMatchClick(reportButton) {
  const setId = String(reportButton.dataset.setId);
  const setNode = playerDashboardSetsById.get(setId);

  if (isStartGgSetCompleted(setNode)) {
    window.alert(PLAYER_REPORT_APPROVED_MESSAGE);
    return;
  }

  const originalText = reportButton.textContent;
  reportButton.disabled = true;
  reportButton.textContent = 'Revisando reporte...';

  try {
    const reportStatus = await getSetReportStatus({
      sessionId: getPlayerDashboardSessionId(),
      setId
    });

    if (reportStatus.status === 'pending') {
      window.alert(PLAYER_REPORT_PENDING_MESSAGE);
      return;
    }

    if (reportStatus.status === 'approved' || reportStatus.status === 'completed') {
      window.alert(PLAYER_REPORT_APPROVED_MESSAGE);
      return;
    }

    if (setNode && window.SmashJanusMatchWizard?.init) {
      window.SmashJanusMatchWizard.init(setNode);
    }
  } catch (error) {
    window.alert(error.message || 'No se pudo validar si esta partida ya fue reportada.');
  } finally {
    reportButton.disabled = false;
    reportButton.textContent = originalText;
  }
}

async function initializePlayerDashboard(sessionId) {
  if (!sessionId) {
    renderDashboardMessage('Inicia sesión en start.gg para ver tus partidas');
    return;
  }

  if (hasPlaceholderConfig()) {
    renderDashboardMessage('Set PLAYER_DASHBOARD_EVENT_ID en js/player-dashboard.js.');
    return;
  }

  setDashboardLoading(true);

  try {
    const [statusResponse, eventResponse] = await Promise.all([
      gasRequest('status', {
        sessionId
      }),
      gasRequest('getEventSets', {
        sessionId,
        eventId: PLAYER_DASHBOARD_EVENT_ID
      })
    ]);

    const user = normalizeAuthenticatedUser(statusResponse.user);
    const event = eventResponse.event;
    const matches = getUserActiveMatches(event?.sets?.nodes || [], user);

    renderPlayerHeader(user, event);
    renderUpcomingMatches(matches, user);
  } catch (error) {
    renderDashboardMessage(error.message || 'No pudimos cargas tus partidas');
  } finally {
    setDashboardLoading(false);
  }
}

function renderPlayerHeader(user, event) {
  const gamerTagElement = document.getElementById('player-gamertag');
  const eventNameElement = document.getElementById('player-event-name');

  if (gamerTagElement) {
    gamerTagElement.textContent = user?.player?.gamerTag || 'Player';
  }

  if (eventNameElement) {
    eventNameElement.textContent = event?.name || 'Active event';
  }
}

function normalizeAuthenticatedUser(user) {
  if (!user) {
    return null;
  }

  if (user.player) {
    return user;
  }

  return {
    id: user.id || '',
    discriminator: user.discriminator || '',
    player: {
      id: user.playerId || '',
      gamerTag: user.gamerTag || ''
    }
  };
}

function getUserActiveMatches(sets, user) {
  return sets
    .filter(set => PLAYER_DASHBOARD_VISIBLE_SET_STATES.has(Number(set.state)))
    .filter(set => getUserSlot(set, user))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

function renderUpcomingMatches(matches, user) {
  const container = document.getElementById('upcoming-matches-container');

  if (!container) {
    return;
  }

  if (!matches.length) {
    playerDashboardSetsById.clear();
    container.innerHTML = `
      <div class="empty-state">
        <p class="empty-state-title">No hay pertidas por ahora.</p>
        <p class="empty-state-copy">Tus sets pendientes aparecerán acá</p>
      </div>
    `;
    return;
  }

  playerDashboardSetsById.clear();
  matches.forEach(match => {
    playerDashboardSetsById.set(String(match.id), match);
  });

  container.innerHTML = matches.map(match => renderMatchCard(match, user)).join('');
}

function renderMatchCard(match, user) {
  const userSlot = getUserSlot(match, user);
  const opponentSlot = getOpponentSlot(match, userSlot);
  const roundText = escapeHtml(match.fullRoundText || 'Bracket set');
  const playerName = escapeHtml(userSlot?.entrant?.name || user?.player?.gamerTag || 'You');
  const opponentName = escapeHtml(opponentSlot?.entrant?.name || 'Opponent TBD');
  const status = getSetStatusLabel(match.state);
  const setId = escapeHtml(match.id);

  return `
    <article class="match-card" data-set-id="${setId}">
      <div class="match-card-main">
        <p class="match-round">${roundText}</p>
        <div class="match-players" aria-label="${playerName} -vs- ${opponentName}">
          <span>${playerName}</span>
          <span class="match-versus">vs</span>
          <span>${opponentName}</span>
        </div>
        <p class="match-meta">${status} · Set </p>
      </div>
      <button class="button button-primary report-match-button" type="button" data-set-id="${setId}">
        Reportar partida
      </button>
    </article>
  `;
}
// <p class="match-meta">${status} · Set ${setId}</p>

function getUserSlot(set, user) {
  const slots = Array.isArray(set?.slots) ? set.slots : [];
  const gamerTag = user?.player?.gamerTag;
  const entrantId = String(PLAYER_DASHBOARD_TEST_ENTRANT_ID || '').trim();

  return slots.find(slot => {
    const entrant = slot?.entrant;

    if (!entrant) {
      return false;
    }

    if (entrantId && String(entrant.id) === entrantId) {
      return true;
    }

    return Boolean(gamerTag && namesMatch(entrant.name, gamerTag));
  });
}

function getOpponentSlot(set, userSlot) {
  const userEntrantId = userSlot?.entrant?.id;
  const slots = Array.isArray(set?.slots) ? set.slots : [];

  return slots.find(slot => {
    const entrant = slot?.entrant;
    return entrant && String(entrant.id) !== String(userEntrantId);
  });
}

function namesMatch(entrantName, gamerTag) {
  const normalizedEntrant = normalizeName(entrantName);
  const normalizedGamerTag = normalizeName(gamerTag);
  return normalizedEntrant === normalizedGamerTag || normalizedEntrant.includes(normalizedGamerTag);
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getSetStatusLabel(state) {
  const stateNumber = Number(state);

  if (stateNumber === 1) {
    return 'Pending';
  }

  if (stateNumber === 2) {
    return 'Ongoing';
  }

  return `State ${state}`;
}

function isStartGgSetCompleted(setNode) {
  const state = Number(setNode?.state);
  return Boolean(setNode?.winnerId) || (state > 0 && !PLAYER_DASHBOARD_VISIBLE_SET_STATES.has(state));
}

function setDashboardLoading(isLoading) {
  const container = document.getElementById('upcoming-matches-container');

  if (isLoading && container) {
    container.innerHTML = '<p class="dashboard-status">Loading your matches...</p>';
  }
}

function renderDashboardMessage(message) {
  const container = document.getElementById('upcoming-matches-container');

  if (!container) {
    return;
  }

  container.innerHTML = `<p class="dashboard-status">${escapeHtml(message)}</p>`;
}

function hasPlaceholderConfig() {
  return PLAYER_DASHBOARD_EVENT_ID === 'YOUR_TEST_EVENT_ID';
}

function getPlayerDashboardSessionId() {
  if (window.SmashJanusAuth?.getSessionId) {
    return window.SmashJanusAuth.getSessionId();
  }

  return localStorage.getItem('smashJanus.startgg.sessionId');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.SmashJanusPlayerDashboard = {
  initialize: initializePlayerDashboard,
  getSetById: setId => playerDashboardSetsById.get(String(setId))
};
