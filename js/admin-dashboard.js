const ADMIN_DASHBOARD_EVENT_ID = '1414455';
const ADMIN_STARTED_SET_STATE = 2;

document.addEventListener('DOMContentLoaded', () => {
  const openAdminButton = document.getElementById('open-admin-dashboard-button');
  const backButton = document.getElementById('back-to-player-dashboard-button');
  const reloadReportsButton = document.getElementById('reload-admin-reports-button');
  const sessionId = getAdminSessionId();

  if (openAdminButton) {
    openAdminButton.addEventListener('click', () => {
      showAdminView();
      loadAdminDashboard();
    });
  }

  if (backButton) {
    backButton.addEventListener('click', () => {
      window.SmashJanusAuth?.showView
        ? window.SmashJanusAuth.showView('player-dashboard-view')
        : showOnlyView('player-dashboard-view');
    });
  }

  if (reloadReportsButton) {
    reloadReportsButton.addEventListener('click', loadAdminDashboard);
  }

  if (sessionId) {
    refreshAdminStatus(sessionId);
  }
});

window.addEventListener('smashjanus:authenticated', event => {
  setAdminEntryVisible(Boolean(event.detail && event.detail.isAdmin));
});

document.addEventListener('click', event => {
  const approveButton = event.target.closest('[data-admin-approve-report-id]');
  const denyButton = event.target.closest('[data-admin-deny-report-id]');

  if (approveButton) {
    approveReport(approveButton.dataset.adminApproveReportId);
    return;
  }

  if (denyButton) {
    denyReport(denyButton.dataset.adminDenyReportId);
  }
});

async function refreshAdminStatus(sessionId) {
  try {
    const status = await gasRequest('status', { sessionId });
    localStorage.setItem('smashJanus.startgg.isAdmin', status.isAdmin ? '1' : '0');
    setAdminEntryVisible(Boolean(status.isAdmin));
  } catch (error) {
    setAdminEntryVisible(false);
  }
}

async function loadAdminReports() {
  const container = document.getElementById('admin-reports-container');
  const sessionId = getAdminSessionId();

  if (!container) {
    return;
  }

  container.innerHTML = '<p class="dashboard-status">Cargando, dale un beso a Charlit3rs para mientras..</p>';

  try {
    const response = await gasRequest('listSetReports', {
      sessionId,
      status: 'pending'
    });
    renderAdminReports(response.reports || []);
  } catch (error) {
    container.innerHTML = `<p class="dashboard-status">${escapeAdminHtml(error.message || 'No se pudieron cargar sets reportados.')}</p>`;
  }
}

async function loadAdminStartedSets() {
  const container = document.getElementById('admin-started-sets-container');
  const sessionId = getAdminSessionId();

  if (!container) {
    return;
  }

  container.innerHTML = '<p class="dashboard-status">Revisando sets empezados...</p>';

  try {
    const response = await gasRequest('getStartedSets', {
      sessionId,
      eventId: ADMIN_DASHBOARD_EVENT_ID,
      perPage: 100
    });
    renderAdminStartedSets(response.event?.sets?.nodes || []);
  } catch (error) {
    container.innerHTML = `<p class="dashboard-status">${escapeAdminHtml(formatAdminError(error, 'No se pudieron cargar los sets empezados.'))}</p>`;
  }
}

function loadAdminDashboard() {
  loadAdminStartedSets();
  loadAdminReports();
}

function renderAdminReports(reports) {
  const container = document.getElementById('admin-reports-container');

  if (!container) {
    return;
  }

  if (!reports.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="empty-state-title">Sin reportes pendientes</p>
        <p class="empty-state-copy">Sets reportados aparecerán acá</p>
      </div>
    `;
    return;
  }

  container.innerHTML = reports.map(renderAdminReportCard).join('');
}

function renderAdminStartedSets(sets) {
  const container = document.getElementById('admin-started-sets-container');
  const startedSets = sets
    .filter(set => Number(set.state) === ADMIN_STARTED_SET_STATE)
    .map(set => ({
      ...set,
      elapsedMinutes: getStartedSetElapsedMinutes(set.startedAt)
    }))
    .sort((a, b) => b.elapsedMinutes - a.elapsedMinutes);

  if (!container) {
    return;
  }

  if (!startedSets.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="empty-state-title">No hay sets empezados</p>
        <p class="empty-state-copy">Cuando start.gg marque un set como empezado, aparecerá acá.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = startedSets.map(renderAdminStartedSetCard).join('');
}

function renderAdminStartedSetCard(set) {
  const [entrantOne, entrantTwo] = getAdminSetEntrants(set);
  const tone = getStartedSetTone(set.elapsedMinutes);
  const startedText = set.startedAt
    ? `Jugando hace ${formatElapsedMinutes(set.elapsedMinutes)}`
    : 'Sin hora de inicio';

  return `
    <article class="admin-started-card ${tone.className}">
      <div class="match-card-main">
        <p class="match-round">${escapeAdminHtml(set.fullRoundText || 'Set')}</p>
        <div class="match-players" aria-label="${escapeAdminHtml(entrantOne.name)} versus ${escapeAdminHtml(entrantTwo.name)}">
          <span>${escapeAdminHtml(entrantOne.name)}</span>
          <span class="match-versus">vs</span>
          <span>${escapeAdminHtml(entrantTwo.name)}</span>
        </div>
        <p class="match-meta">${escapeAdminHtml(startedText)} · Set ${escapeAdminHtml(set.id)}</p>
      </div>
      <span class="started-time-badge">${escapeAdminHtml(tone.label)}</span>
    </article>
  `;
}

function renderAdminReportCard(report) {
  const submittedBy = report.submittedBy?.gamerTag || 'Jugador';
  const summary = normalizeAdminReportSummary(report);
  const [entrantOne, entrantTwo] = summary.entrants;
  const entrantOneScore = Number(summary.finalScore[String(entrantOne.id)] || 0);
  const entrantTwoScore = Number(summary.finalScore[String(entrantTwo.id)] || 0);

  return `
    <article class="admin-review-card">
      <header class="admin-review-header">
        <p class="match-round">${escapeAdminHtml(summary.roundText)}</p>
        <div class="admin-score-line">
          <span class="admin-player-name player-red">${escapeAdminHtml(entrantOne.name)}</span>
          <strong>${entrantOneScore} - ${entrantTwoScore}</strong>
          <span class="admin-player-name player-blue">${escapeAdminHtml(entrantTwo.name)}</span>
        </div>
        <p class="match-meta">reportado por ${escapeAdminHtml(submittedBy)} · ${escapeAdminHtml(formatAdminDate(report.submittedAt))}</p>
      </header>

      <div class="admin-game-list">
        ${summary.games.map(game => renderAdminGameSummary(game, summary.entrants)).join('')}
      </div>

      <div class="admin-actions">
        <button class="button button-primary" type="button" data-admin-approve-report-id="${escapeAdminHtml(report.id)}">
          Aceptar resultado
        </button>
        <button class="button button-danger" type="button" data-admin-deny-report-id="${escapeAdminHtml(report.id)}">
          Rechazar
        </button>
      </div>
    </article>
  `;
}

function renderAdminGameSummary(game, entrants) {
  const [entrantOne, entrantTwo] = entrants;
  const entrantOneSelection = findAdminSelection(game, entrantOne.id);
  const entrantTwoSelection = findAdminSelection(game, entrantTwo.id);
  const entrantOneWon = String(game.winnerId) === String(entrantOne.id);
  const entrantTwoWon = String(game.winnerId) === String(entrantTwo.id);

  return `
    <div class="admin-game-row">
      ${renderAdminCharacterPill(entrantOne, entrantOneSelection, entrantOneWon, 'player-red')}
      <div class="admin-game-center">
        <span>Game ${escapeAdminHtml(game.gameNum || '')}</span>
        <strong>${escapeAdminHtml(game.stageName || 'Pantalla no reportada')}</strong>
      </div>
      ${renderAdminCharacterPill(entrantTwo, entrantTwoSelection, entrantTwoWon, 'player-blue')}
    </div>
  `;
}

function renderAdminCharacterPill(entrant, selection, isWinner, colorClass) {
  return `
    <div class="admin-character-pill ${colorClass} ${isWinner ? 'is-winner' : ''}">
      <span>${escapeAdminHtml(entrant.name)}</span>
      <strong>${escapeAdminHtml(selection?.characterName || 'Personaje sin elegir')}</strong>
      ${isWinner ? '<em>WIN</em>' : ''}
    </div>
  `;
}

function normalizeAdminReportSummary(report) {
  const summary = report.summary && typeof report.summary === 'object' ? report.summary : {};
  const entrants = normalizeAdminEntrants(summary.entrants, report);
  const games = normalizeAdminGames(summary.games, report, entrants);
  const finalScore = normalizeAdminFinalScore(summary.finalScore, games, entrants);

  return {
    roundText: summary.roundText || `Set ${report.setId}`,
    winnerId: String(summary.winnerId || report.winnerId || ''),
    entrants,
    games,
    finalScore
  };
}

function normalizeAdminEntrants(summaryEntrants, report) {
  if (Array.isArray(summaryEntrants) && summaryEntrants.length >= 2) {
    return summaryEntrants.slice(0, 2).map((entrant, index) => ({
      id: String(entrant.id || index + 1),
      name: entrant.name || `Jugador ${index + 1}`
    }));
  }

  const fallbackIds = (report.gameData?.[0]?.selections || [])
    .map(selection => String(selection.entrantId))
    .filter(Boolean)
    .slice(0, 2);

  while (fallbackIds.length < 2) {
    fallbackIds.push(String(fallbackIds.length + 1));
  }

  return fallbackIds.map((id, index) => ({
    id,
    name: id ? `Entrant ${id}` : `Jugador ${index + 1}`
  }));
}

function normalizeAdminGames(summaryGames, report, entrants) {
  if (Array.isArray(summaryGames) && summaryGames.length) {
    return summaryGames.map(game => ({
      gameNum: Number(game.gameNum || 0),
      winnerId: String(game.winnerId || ''),
      stageName: game.stageName || '',
      selections: Array.isArray(game.selections) ? game.selections.map(selection => ({
        entrantId: String(selection.entrantId || ''),
        entrantName: selection.entrantName || getAdminEntrantName(entrants, selection.entrantId),
        characterId: selection.characterId,
        characterName: selection.characterName || formatAdminCharacterFallback(selection.characterId)
      })) : []
    }));
  }

  return (Array.isArray(report.gameData) ? report.gameData : []).map(game => ({
    gameNum: Number(game.gameNum || 0),
    winnerId: String(game.winnerId || ''),
    stageName: game.stageName || '',
    selections: (game.selections || []).map(selection => ({
      entrantId: String(selection.entrantId || ''),
      entrantName: getAdminEntrantName(entrants, selection.entrantId),
      characterId: selection.characterId,
      characterName: formatAdminCharacterFallback(selection.characterId)
    }))
  }));
}

function normalizeAdminFinalScore(summaryScore, games, entrants) {
  const score = {};

  entrants.forEach(entrant => {
    score[String(entrant.id)] = Number(summaryScore?.[String(entrant.id)] || 0);
  });

  if (Object.values(score).some(value => value > 0)) {
    return score;
  }

  games.forEach(game => {
    const winnerId = String(game.winnerId || '');

    if (winnerId in score) {
      score[winnerId] += 1;
    }
  });

  return score;
}

function findAdminSelection(game, entrantId) {
  return (game.selections || []).find(selection => String(selection.entrantId) === String(entrantId));
}

function getAdminEntrantName(entrants, entrantId) {
  return entrants.find(entrant => String(entrant.id) === String(entrantId))?.name || `Entrant ${entrantId}`;
}

function formatAdminCharacterFallback(characterId) {
  const character = Array.isArray(window.SMASH_ULTIMATE_CHARACTERS)
    ? window.SMASH_ULTIMATE_CHARACTERS.find(item => Number(item.id) === Number(characterId))
    : null;

  return character?.name || (characterId ? `Personaje ${characterId}` : 'Personaje sin elegir');
}

function getAdminSetEntrants(set) {
  const entrants = (Array.isArray(set?.slots) ? set.slots : [])
    .map(slot => slot?.entrant)
    .filter(Boolean)
    .map((entrant, index) => ({
      id: String(entrant.id || index + 1),
      name: entrant.name || `Jugador ${index + 1}`
    }));

  while (entrants.length < 2) {
    entrants.push({
      id: String(entrants.length + 1),
      name: `Jugador ${entrants.length + 1}`
    });
  }

  return entrants.slice(0, 2);
}

function getStartedSetElapsedMinutes(startedAt) {
  const startedAtMs = toAdminTimestampMs(startedAt);

  if (!startedAtMs) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - startedAtMs) / 60000));
}

function getStartedSetTone(elapsedMinutes) {
  if (elapsedMinutes > 25) {
    return {
      className: 'is-danger',
      label: `${formatElapsedMinutes(elapsedMinutes)}`
    };
  }

  if (elapsedMinutes >= 15) {
    return {
      className: 'is-warning',
      label: `${formatElapsedMinutes(elapsedMinutes)}`
    };
  }

  if (elapsedMinutes >= 10) {
    return {
      className: 'is-caution',
      label: `${formatElapsedMinutes(elapsedMinutes)}`
    };
  }

  return {
    className: 'is-ok',
    label: `${formatElapsedMinutes(elapsedMinutes)}`
  };
}

function formatElapsedMinutes(minutes) {
  return `${Number(minutes || 0)} min`;
}

function toAdminTimestampMs(value) {
  const timestamp = Number(value || 0);

  if (!timestamp) {
    return 0;
  }

  return timestamp > 1000000000000 ? timestamp : timestamp * 1000;
}

async function approveReport(reportId) {
  const container = document.getElementById('admin-reports-container');

  if (container) {
    container.innerHTML = '<p class="dashboard-status">Aprobando resultado, saludos a Lulu...</p>';
  }

  try {
    await gasRequest('approveSetReport', {
      sessionId: getAdminSessionId(),
      reportId
    });
    loadAdminDashboard();
  } catch (error) {
    if (container) {
      container.innerHTML = `<p class="dashboard-status">${escapeAdminHtml(formatAdminError(error, 'No se pudo aprobar el resultado'))}</p>`;
    }
  }
}

async function denyReport(reportId) {
  const container = document.getElementById('admin-reports-container');

  if (container) {
    container.innerHTML = '<p class="dashboard-status">Rechazando...</p>';
  }

  try {
    await gasRequest('denySetReport', {
      sessionId: getAdminSessionId(),
      reportId
    });
    loadAdminDashboard();
  } catch (error) {
    if (container) {
      container.innerHTML = `<p class="dashboard-status">${escapeAdminHtml(formatAdminError(error, 'Hubo un problema al rechazar, mejor reportalo directo en start.gg, no sirve esta mierda.'))}</p>`;
    }
  }
}

function formatAdminError(error, fallbackMessage) {
  const response = error?.response || {};
  const details = response.details;

  if (Array.isArray(details) && details.length) {
    const messages = details
      .map(detail => detail?.message)
      .filter(Boolean)
      .join(' ');

    if (messages) {
      return messages;
    }
  }

  return error?.message || fallbackMessage;
}

function setAdminEntryVisible(isVisible) {
  document.getElementById('dashboard-actions')?.classList.toggle('hidden', !isVisible);
}

function showAdminView() {
  window.SmashJanusAuth?.showView
    ? window.SmashJanusAuth.showView('admin-dashboard-view')
    : showOnlyView('admin-dashboard-view');
}

function showOnlyView(viewId) {
  document.querySelectorAll('.view').forEach(view => {
    view.classList.toggle('hidden', view.id !== viewId);
  });
}

function getAdminSessionId() {
  if (window.SmashJanusAuth?.getSessionId) {
    return window.SmashJanusAuth.getSessionId();
  }

  return localStorage.getItem('smashJanus.startgg.sessionId');
}

function formatAdminDate(value) {
  if (!value) {
    return 'Se reportó recién';
  }

  return new Date(value).toLocaleString();
}

function escapeAdminHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.SmashJanusAdminDashboard = {
  load: loadAdminDashboard,
  refreshStatus: refreshAdminStatus
};
