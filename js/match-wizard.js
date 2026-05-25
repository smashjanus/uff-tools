const MATCH_WIZARD_DEFAULT_BEST_OF = 3;
const MATCH_WIZARD_GAME_ONE_BANS = 3;
const MATCH_WIZARD_COUNTERPICK_BANS = 3;

let matchWizardState = null;
let matchWizardCharactersLoadPromise = null;

function initMatchWizard(setNode) {
  const entrants = getSetEntrants(setNode);

  if (entrants.length < 2) {
    renderMatchWizardError('Falta un contrincante en este set.');
    showMatchWizardView();
    return;
  }

  const bestOf = getSetBestOf(setNode);

  matchWizardState = {
    setNode,
    setId: String(setNode.id),
    entrants,
    bestOf,
    requiredWins: getRequiredWins(bestOf),
    phase: 'setup',
    gameNumber: 1,
    score: createInitialScore(entrants),
    games: [],
    useStageBans: null,
    stages: createStageState(),
    turnQueue: [],
    turnIndex: 0,
    turnSelections: [],
    selectedStageId: null,
    rpsWinnerId: null,
    stagePromptVisible: false,
    previousWinnerId: null,
    previousLoserId: null,
    characterSelection: null,
    charactersConfirmedForGame: null,
    characterModalEntrantId: null,
    characterSearch: '',
    isSubmitting: false,
    error: ''
  };

  loadUltimateCharactersForWizard();
  showMatchWizardView();
  renderMatchWizard();
}

function continueFromSetup() {
  matchWizardState.phase = 'ban-choice';
  renderMatchWizard();
}

function chooseStageBanFlow(useStageBans) {
  matchWizardState.useStageBans = Boolean(useStageBans);

  if (matchWizardState.useStageBans) {
    matchWizardState.phase = 'rps-select';
    renderMatchWizard();
    return;
  }

  beginCharacterSelection({ nextAction: 'playing' });
}

function beginCharacterSelection(options = {}) {
  const previousGame = matchWizardState.games[matchWizardState.games.length - 1];

  matchWizardState.phase = 'character-select';
  matchWizardState.characterSelection = {
    gameIndex: matchWizardState.gameNumber,
    nextAction: options.nextAction || 'playing',
    selectionsByEntrant: {},
    previousSelectionsByEntrant: getPreviousSelectionsByEntrant(previousGame)
  };
  matchWizardState.characterModalEntrantId = null;
  matchWizardState.characterSearch = '';
  renderMatchWizard();
}

function showCharacterSelection(gameIndex, setNode) {
  if (!matchWizardState) {
    initMatchWizard(setNode);
  }

  matchWizardState.gameNumber = Number(gameIndex);
  beginCharacterSelection({ nextAction: 'playing' });
}

function startGameOneStriking(rpsWinnerId) {
  const otherEntrant = getOtherEntrant(rpsWinnerId);

  matchWizardState.phase = 'striking';
  matchWizardState.rpsWinnerId = String(rpsWinnerId);
  matchWizardState.stages = createStageState();
  matchWizardState.selectedStageId = null;
  matchWizardState.turnIndex = 0;
  matchWizardState.turnSelections = [];
  matchWizardState.stagePromptVisible = true;
  matchWizardState.turnQueue = [
    {
      type: 'ban',
      entrantId: String(rpsWinnerId),
      count: MATCH_WIZARD_GAME_ONE_BANS,
      label: 'Ganador de Piedra papel o tijera quita 3 stages'
    },
    {
      type: 'ban',
      entrantId: String(otherEntrant.id),
      count: MATCH_WIZARD_GAME_ONE_BANS,
      label: 'Perdedor quita 3 stages'
    },
    {
      type: 'pick',
      entrantId: String(rpsWinnerId),
      count: 1,
      label: 'Ganador escoje donde jugar. '
    }
  ];

  renderMatchWizard();
}

function startCounterpickFlow() {
  const winnerId = String(matchWizardState.previousWinnerId);
  const loser = getOtherEntrant(winnerId);

  matchWizardState.phase = 'striking';
  matchWizardState.stages = createStageState();
  matchWizardState.selectedStageId = null;
  matchWizardState.turnIndex = 0;
  matchWizardState.turnSelections = [];
  matchWizardState.stagePromptVisible = true;
  matchWizardState.turnQueue = [
    {
      type: 'ban',
      entrantId: winnerId,
      count: MATCH_WIZARD_COUNTERPICK_BANS,
      label: 'Ganador del juego anterior quita 3 stages.'
    },
    {
      type: 'pick',
      entrantId: String(loser.id),
      count: 1,
      label: 'Perdedor del juego anterior selecciona donde jugar.'
    }
  ];

  renderMatchWizard();
}

function handleStageClick(stageId) {
  if (!matchWizardState || matchWizardState.phase !== 'striking') {
    return;
  }

  const turn = getCurrentTurn();
  const stage = matchWizardState.stages.find(item => item.id === stageId);

  if (!turn || !stage || stage.status !== 'available') {
    return;
  }

  if (turn.type === 'ban') {
    stage.status = 'banned';
    stage.bannedBy = turn.entrantId;
    matchWizardState.turnSelections.push(stageId);

    if (matchWizardState.turnSelections.length >= turn.count) {
      advanceStrikeTurn();
    }

    renderMatchWizard();
    return;
  }

  stage.status = 'selected';
  stage.selectedBy = turn.entrantId;
  matchWizardState.selectedStageId = stageId;
  matchWizardState.turnSelections = [];

  if (matchWizardState.charactersConfirmedForGame === matchWizardState.gameNumber) {
    matchWizardState.phase = 'playing';
    renderMatchWizard();
    return;
  }

  beginCharacterSelection({ nextAction: 'playing' });
}

function advanceStrikeTurn() {
  matchWizardState.turnIndex += 1;
  matchWizardState.turnSelections = [];
  matchWizardState.stagePromptVisible = Boolean(getCurrentTurn());
}

function dismissStagePrompt() {
  matchWizardState.stagePromptVisible = false;
  renderMatchWizard();
}

function openCharacterPicker(entrantId) {
  matchWizardState.characterModalEntrantId = String(entrantId);
  matchWizardState.characterSearch = '';
  renderMatchWizard();
}

function closeCharacterPicker() {
  matchWizardState.characterModalEntrantId = null;
  matchWizardState.characterSearch = '';
  renderMatchWizard();
}

function selectCharacter(entrantId, characterId) {
  matchWizardState.characterSelection.selectionsByEntrant[String(entrantId)] = Number(characterId);
  closeCharacterPicker();
}

function useSameCharacter(entrantId) {
  const previousCharacterId = matchWizardState.characterSelection.previousSelectionsByEntrant[String(entrantId)];

  if (!previousCharacterId) {
    return;
  }

  matchWizardState.characterSelection.selectionsByEntrant[String(entrantId)] = Number(previousCharacterId);
  renderMatchWizard();
}

function confirmCharacterSelection() {
  if (!isCharacterSelectionComplete()) {
    matchWizardState.error = 'Escoje personaje para cada jugador.';
    renderMatchWizard();
    return;
  }

  matchWizardState.error = '';
  matchWizardState.charactersConfirmedForGame = matchWizardState.gameNumber;

  if (matchWizardState.characterSelection.nextAction === 'counterpick-striking') {
    startCounterpickFlow();
    return;
  }

  matchWizardState.phase = 'playing';
  renderMatchWizard();
}

function beginGameReporting() {
  matchWizardState.phase = 'reporting';
  renderMatchWizard();
}

function reportGameWinner(winnerId) {
  const winner = getEntrantById(winnerId);
  const loser = getOtherEntrant(winnerId);
  const selectedStage = getSelectedStage();
  const currentScore = matchWizardState.score[String(winner.id)] || 0;
  const winnerScore = currentScore + 1;
  const gameNumber = matchWizardState.gameNumber;
  const gameSelections = buildCurrentGameSelections();
  const entrantOneWon = String(matchWizardState.entrants[0].id) === String(winner.id);

  matchWizardState.score[String(winner.id)] = winnerScore;
  matchWizardState.games.push({
    winnerId: String(winner.id),
    gameNum: gameNumber,
    entrant1Score: entrantOneWon ? 1 : 0,
    entrant2Score: entrantOneWon ? 0 : 1,
    stageId: getReportStageId(selectedStage),
    selections: gameSelections,
    metadata: {
      gameNumber,
      stageName: selectedStage?.name || null,
      winnerName: winner.name,
      loserId: String(loser.id),
      loserName: loser.name,
      bans: getCurrentGameBans()
    }
  });

  matchWizardState.previousWinnerId = String(winner.id);
  matchWizardState.previousLoserId = String(loser.id);
  matchWizardState.characterSelection = null;
  matchWizardState.charactersConfirmedForGame = null;

  if (winnerScore >= matchWizardState.requiredWins) {
    matchWizardState.phase = 'set-complete';
  } else {
    matchWizardState.gameNumber += 1;
    matchWizardState.phase = 'between-games';
  }

  renderMatchWizard();
}

async function submitMatchWizardSet() {
  if (!matchWizardState || matchWizardState.isSubmitting) {
    return;
  }

  const winnerId = getSetWinnerId();

  if (!winnerId) {
    matchWizardState.error = 'No se ha seleccionado un ganador del set. ';
    renderMatchWizard();
    return;
  }

  matchWizardState.isSubmitting = true;
  matchWizardState.error = '';
  renderMatchWizard();

  const gameData = buildReportGameData();
  const selections = gameData.flatMap(game => game.selections || []);
  const summary = buildReportSummary(winnerId);

  try {
    await reportSet({
      sessionId: getMatchWizardSessionId(),
      setId: matchWizardState.setId,
      winnerId,
      gameData,
      selections,
      summary
    });

    matchWizardState.phase = 'submitted';
  } catch (error) {
    matchWizardState.error = error.message || 'Error al reportar el set, hablenle a los de Smash Janus.';
  } finally {
    matchWizardState.isSubmitting = false;
    renderMatchWizard();
  }
}

function renderMatchWizard() {
  const container = document.getElementById('match-wizard-container');

  if (!container || !matchWizardState) {
    return;
  }

  const renderers = {
    setup: renderSetupPhase,
    'ban-choice': renderBanChoicePhase,
    'rps-select': renderRpsPhase,
    'character-select': renderCharacterSelectionPhase,
    striking: renderStrikingPhase,
    playing: renderPlayingPhase,
    reporting: renderReportingPhase,
    'between-games': renderBetweenGamesPhase,
    'set-complete': renderSetCompletePhase,
    submitted: renderSubmittedPhase
  };

  container.innerHTML = `
    ${renderWizardHeader()}
    ${matchWizardState.error ? renderWizardError(matchWizardState.error) : ''}
    ${renderers[matchWizardState.phase]()}
  `;
}

function renderWizardHeader() {
  const [entrantOne, entrantTwo] = matchWizardState.entrants;

  return `
    <header class="wizard-header">
      <button class="button button-secondary wizard-back-button" type="button" data-wizard-action="back-to-dashboard">
        Regresar a las partidas
      </button>
      <div>
        <p class="eyebrow">${wizardEscapeHtml(matchWizardState.setNode.fullRoundText || 'Set')}</p>
        <h1 id="match-wizard-title">${wizardEscapeHtml(entrantOne.name)} vs ${wizardEscapeHtml(entrantTwo.name)}</h1>
        <p class="lede">Game ${matchWizardState.gameNumber} · Mejor de ${matchWizardState.bestOf}</p>
      </div>
      ${renderScorePills()}
      ${renderWizardTools()}
    </header>
  `;
}

function renderWizardTools() {
  if (matchWizardState.phase === 'submitted') {
    return '';
  }

  const canRestartGame = ![
    'setup',
    'ban-choice',
    'rps-select'
  ].includes(matchWizardState.phase);
  const canRestartStages = Boolean(
    matchWizardState.useStageBans &&
    (
      matchWizardState.phase === 'striking' ||
      matchWizardState.phase === 'playing' ||
      matchWizardState.phase === 'reporting' ||
      (matchWizardState.phase === 'character-select' && matchWizardState.selectedStageId)
    )
  );

  return `
    <div class="wizard-tools">
      <button class="mini-action" type="button" data-wizard-action="restart-set">
        Reiniciar set
      </button>
      ${canRestartGame ? `
        <button class="mini-action" type="button" data-wizard-action="restart-game">
          Reiniciar juego
        </button>
      ` : ''}
      ${canRestartStages ? `
        <button class="mini-action" type="button" data-wizard-action="restart-stages">
          Reiniciar stage ban
        </button>
      ` : ''}
    </div>
  `;
}

function renderScorePills() {
  return `
    <div class="score-row" aria-label="Resultado del set">
      ${matchWizardState.entrants.map((entrant, index) => `
        <div class="score-pill ${getPlayerColorClassByIndex(index)}">
          <span>${wizardEscapeHtml(entrant.name)}</span>
          <strong>${matchWizardState.score[String(entrant.id)] || 0}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSetupPhase() {
  return `
    <section class="wizard-panel">
      <p class="wizard-step-label">Formato del Set</p>
      <h2>Tipo de juego</h2>
      <div class="segmented-control" aria-label="Set length">
        <button class="segment ${matchWizardState.bestOf === 3 ? 'is-active' : ''}" type="button" data-wizard-best-of="3">
          Bo3
        </button>
        <button class="segment ${matchWizardState.bestOf === 5 ? 'is-active' : ''}" type="button" data-wizard-best-of="5">
          Bo5
        </button>
      </div>
      <button class="button button-primary" type="button" data-wizard-action="continue-setup">
        Continue
      </button>
    </section>
  `;
}

function renderBanChoicePhase() {
  return `
    <div class="wizard-modal-backdrop is-inline">
      <section class="wizard-modal">
        <p class="wizard-step-label">Stage bans</p>
        <h2>¿Quieren banear stages?</h2>
        <p class="wizard-copy">Baneo de stages con reglas del torneo. Si ya decidieron sus stages/mapas ó harán un ban aparte,pueden seleccionar la opción "No banear".</p>
        <div class="wizard-actions two-column-actions">
          <button class="button button-primary" type="button" data-stage-flow="yes">
            Si, banear stages
          </button>
          <button class="button button-secondary" type="button" data-stage-flow="no">
            No banear
          </button>
        </div>
      </section>
    </div>
  `;
}

function renderRpsPhase() {
  return `
    <section class="wizard-panel">
      <p class="wizard-step-label">RPS</p>
      <h2>Who won rock, paper, scissors?</h2>
      <p class="wizard-copy">El ganador de piedra, papel o tijera (PPT) banea primero, luego elige la pantalla entre las restantes..</p>
      <div class="wizard-actions">
        ${matchWizardState.entrants.map((entrant, index) => `
          <button class="button player-action ${getPlayerColorClassByIndex(index)}" type="button" data-rps-winner-id="${wizardEscapeHtml(entrant.id)}">
            ${wizardEscapeHtml(entrant.name)} won RPS
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

function renderCharacterSelectionPhase() {
  return `
    <section class="wizard-panel">
      <p class="wizard-step-label">Personajes</p>
      <h2>Confirmen personajes para el juego ${matchWizardState.gameNumber}</h2>
      <div class="character-selection-summary">
        ${matchWizardState.entrants.map((entrant, index) => renderCharacterSelectionCard(entrant, index)).join('')}
      </div>
      <button class="button button-primary" type="button" data-wizard-action="confirm-characters" ${isCharacterSelectionComplete() ? '' : 'disabled'}>
        Confirmar Personajes
      </button>
    </section>
    ${matchWizardState.characterModalEntrantId ? renderCharacterModal() : ''}
  `;
}

function renderCharacterSelectionCard(entrant, index) {
  const characterId = matchWizardState.characterSelection.selectionsByEntrant[String(entrant.id)];
  const character = getCharacterById(characterId);
  const previousCharacterId = matchWizardState.characterSelection.previousSelectionsByEntrant[String(entrant.id)];
  const previousCharacter = getCharacterById(previousCharacterId);

  return `
    <div class="character-card ${getPlayerColorClassByIndex(index)}">
      <button class="character-chip" type="button" data-open-character-picker="${wizardEscapeHtml(entrant.id)}">
        <span>${wizardEscapeHtml(entrant.name)}</span>
        <strong>${wizardEscapeHtml(character?.name || 'Elije personaje')}</strong>
      </button>
      ${previousCharacter ? `
        <button class="mini-action" type="button" data-same-character-entrant-id="${wizardEscapeHtml(entrant.id)}">
          Usar el mismo: ${wizardEscapeHtml(previousCharacter.name)}
        </button>
      ` : ''}
    </div>
  `;
}

function renderCharacterModal() {
  const entrant = getEntrantById(matchWizardState.characterModalEntrantId);

  return `
    <div class="wizard-modal-backdrop">
      <section class="wizard-modal character-modal">
        <button class="modal-close-button" type="button" data-wizard-action="close-character-modal" aria-label="Cerrar seleccionador de personaje">
          &times;
        </button>
        <p class="wizard-step-label">${wizardEscapeHtml(entrant?.name || 'Player')}</p>
        <h2>Elije personaje</h2>
        <input
          id="character-search-input"
          class="character-search-input"
          type="search"
          placeholder="Escribe el nombre del personaje"
          value="${wizardEscapeHtml(matchWizardState.characterSearch)}"
          autocomplete="off"
        >
        <div id="character-modal-results" class="character-modal-results">
          ${renderCharacterModalResults()}
        </div>
      </section>
    </div>
  `;
}

function renderCharacterModalResults() {
  return getFilteredCharacterList()
    .slice(0, 24)
    .map(character => `
      <button class="character-result-button" type="button" data-character-id="${wizardEscapeHtml(character.id)}">
        ${wizardEscapeHtml(character.name)}
      </button>
    `)
    .join('');
}

function renderStrikingPhase() {
  const turn = getCurrentTurn();
  const actorClass = getPlayerColorClass(turn?.entrantId);
  const remaining = turn ? turn.count - matchWizardState.turnSelections.length : 0;
  const actionText = turn?.type === 'pick'
    ? 'Selecciona una stage'
    : `Ban ${Math.max(remaining, 0)} ${remaining === 1 ? 'stage' : 'stages'}`;

  return `
    <section class="wizard-panel active-turn-panel ${actorClass}">
      <p class="wizard-step-label">Baneo de stages</p>
      <h2>${wizardEscapeHtml(actionText)}</h2>
      <p class="wizard-copy">${turn?.type === 'pick' ? 'Elije una de las stages' : `${Math.max(remaining, 0)} disponibles`}</p>
      ${renderStageGrid()}
    </section>
    ${matchWizardState.stagePromptVisible ? renderStageTurnPrompt() : ''}
  `;
}

function renderStageTurnPrompt() {
  const turn = getCurrentTurn();
  const actor = getEntrantById(turn?.entrantId);
  const actorClass = getPlayerColorClass(turn?.entrantId);
  const message = turn?.type === 'pick'
    ? `${actor?.name || 'Player'} elije la stage`
    : `${actor?.name || 'Player'} banea ${turn?.count || 0} stages`;

  return `
    <button class="wizard-modal-backdrop stage-turn-backdrop ${actorClass}" type="button" data-wizard-action="dismiss-stage-prompt">
      <span class="stage-turn-card">
        <span class="wizard-step-label">Tap para continuar</span>
        <strong>${wizardEscapeHtml(message)}</strong>
      </span>
    </button>
  `;
}

function renderPlayingPhase() {
  const selectedStage = getSelectedStage();

  return `
    <section class="wizard-panel">
      <p class="wizard-step-label">Empiecen el juego ${matchWizardState.gameNumber}</p>
      <h2>${selectedStage ? wizardEscapeHtml(selectedStage.name) : 'Juego listo'}</h2>
      ${selectedStage?.image ? `<img class="selected-stage-image" src="${wizardEscapeHtml(selectedStage.image)}" alt="">` : ''}
      ${renderCurrentCharactersSummary()}
      <p class="wizard-copy">3 stocks · 7 minutes · Hazards off</p>
      <button class="button button-primary" type="button" data-wizard-action="report-game">
        Reporten el ganador del juego
      </button>
    </section>
  `;
}

function renderCurrentCharactersSummary() {
  const selections = matchWizardState.characterSelection?.selectionsByEntrant || {};

  return `
    <div class="character-mini-summary">
      ${matchWizardState.entrants.map((entrant, index) => {
        const character = getCharacterById(selections[String(entrant.id)]);
        return `
          <div class="character-mini-pill ${getPlayerColorClassByIndex(index)}">
            <span>${wizardEscapeHtml(entrant.name)}</span>
            <strong>${wizardEscapeHtml(character?.name || 'Sin personaje')}</strong>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderReportingPhase() {
  return `
    <section class="wizard-panel">
      <p class="wizard-step-label">Resultado del juego ${matchWizardState.gameNumber}</p>
      <h2>Quién gano este juego?</h2>
      <div class="wizard-actions">
        ${matchWizardState.entrants.map((entrant, index) => `
          <button class="button player-action ${getPlayerColorClassByIndex(index)}" type="button" data-game-winner-id="${wizardEscapeHtml(entrant.id)}">
            ${wizardEscapeHtml(entrant.name)}
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

function renderBetweenGamesPhase() {
  return `
    <section class="wizard-panel">
      <p class="wizard-step-label">Siguiente juego</p>
      <h2>Preparen el juego ${matchWizardState.gameNumber}</h2>
      <p class="wizard-copy">Pueden elegir el mismo personaje o cambiar.</p>
      <button class="button button-primary" type="button" data-wizard-action="next-game-characters">
        Elijan personajes
      </button>
    </section>
  `;
}

function renderSetCompletePhase() {
  const winner = getEntrantById(getSetWinnerId());

  return `
    <section class="wizard-panel">
      <p class="wizard-step-label">Set completado</p>
      <h2>${wizardEscapeHtml(winner.name)} wins</h2>
      ${renderGameSummary()}
      <button class="button button-primary" type="button" data-wizard-action="submit-set" ${matchWizardState.isSubmitting ? 'disabled' : ''}>
        ${matchWizardState.isSubmitting ? 'Reportando a smash janus...' : 'Finish Set'}
      </button>
    </section>
  `;
}

function renderSubmittedPhase() {
  return `
    <section class="wizard-panel">
      <p class="wizard-step-label">REPORTADO</p>
      <h2>Partida reportada</h2>
      <p class="wizard-copy">Partida reportada, avísale al organizador para que sea aprobado el resultado.</p>
      <button class="button button-secondary" type="button" data-wizard-action="back-to-dashboard">
        Regresar a las partidas
      </button>
    </section>
  `;
}

function renderStageGrid() {
  return `
    <div class="stage-grid">
      ${matchWizardState.stages.map(stage => renderStageButton(stage)).join('')}
    </div>
  `;
}

function renderStageButton(stage) {
  const statusLabel = getStageStatusLabel(stage);
  const disabled = stage.status !== 'available' ? 'disabled' : '';
  const colorClass = stage.bannedBy ? getPlayerColorClass(stage.bannedBy) : '';

  return `
    <button class="stage-card is-${stage.status} ${colorClass}" type="button" data-stage-id="${wizardEscapeHtml(stage.id)}" ${disabled}>
      <span class="stage-image-wrap">
        ${stage.image ? `<img src="${wizardEscapeHtml(stage.image)}" alt="">` : ''}
      </span>
      <span class="stage-name">${wizardEscapeHtml(stage.name)}</span>
      <span class="stage-status">${wizardEscapeHtml(statusLabel)}</span>
    </button>
  `;
}

function renderGameSummary() {
  return `
    <div class="game-summary">
      ${matchWizardState.games.map(game => {
        const characterText = game.selections
          .map(selection => {
            const entrant = getEntrantById(selection.entrantId);
            const character = getCharacterById(selection.characterId);
            return `${entrant?.name || 'Player'}: ${character?.name || selection.characterId}`;
          })
          .join(' · ');

        return `
          <div class="summary-row">
            <span>Game ${game.gameNum}</span>
            <strong>${wizardEscapeHtml(game.metadata.winnerName)}</strong>
            <span>${wizardEscapeHtml(game.metadata.stageName || 'No stage')}</span>
            <span>${wizardEscapeHtml(characterText)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderWizardError(message) {
  return `<p class="wizard-error">${wizardEscapeHtml(message)}</p>`;
}

function renderMatchWizardError(message) {
  const container = document.getElementById('match-wizard-container');

  if (container) {
    container.innerHTML = renderWizardError(message);
  }
}

function getSetEntrants(setNode) {
  return (setNode?.slots || [])
    .map(slot => slot?.entrant)
    .filter(Boolean)
    .map(entrant => ({
      id: String(entrant.id),
      name: entrant.name || `Entrant ${entrant.id}`
    }))
    .slice(0, 2);
}

function createInitialScore(entrants) {
  return entrants.reduce((score, entrant) => {
    score[String(entrant.id)] = 0;
    return score;
  }, {});
}

function getSetBestOf(setNode) {
  const possibleValue = Number(setNode?.bestOf || setNode?.totalGames);
  return possibleValue === 5 ? 5 : MATCH_WIZARD_DEFAULT_BEST_OF;
}

function getRequiredWins(bestOf) {
  return Math.floor(Number(bestOf) / 2) + 1;
}

function createStageState() {
  return getMatchWizardStages().map(stage => ({
    ...stage,
    status: 'available',
    bannedBy: null,
    selectedBy: null
  }));
}

function getPreviousSelectionsByEntrant(previousGame) {
  if (!previousGame) {
    return {};
  }

  return previousGame.selections.reduce((selections, selection) => {
    selections[String(selection.entrantId)] = Number(selection.characterId);
    return selections;
  }, {});
}

function isCharacterSelectionComplete() {
  const selections = matchWizardState.characterSelection?.selectionsByEntrant || {};
  return matchWizardState.entrants.every(entrant => Boolean(selections[String(entrant.id)]));
}

function buildCurrentGameSelections() {
  const selectionsByEntrant = matchWizardState.characterSelection?.selectionsByEntrant || {};

  return matchWizardState.entrants.map(entrant => ({
    entrantId: Number(entrant.id),
    characterId: Number(selectionsByEntrant[String(entrant.id)])
  }));
}

function buildReportGameData() {
  return matchWizardState.games.map(game => {
    const gameData = {
      winnerId: Number(game.winnerId),
      gameNum: Number(game.gameNum),
      entrant1Score: Number(game.entrant1Score),
      entrant2Score: Number(game.entrant2Score),
      selections: game.selections.map(selection => ({
        entrantId: Number(selection.entrantId),
        characterId: Number(selection.characterId)
      }))
    };

    if (game.stageId !== null && game.stageId !== undefined && game.stageId !== '') {
      gameData.stageId = Number(game.stageId);
    }

    return gameData;
  });
}

function buildReportSummary(winnerId) {
  return {
    setId: matchWizardState.setId,
    roundText: matchWizardState.setNode.fullRoundText || 'Set',
    bestOf: matchWizardState.bestOf,
    winnerId: String(winnerId),
    entrants: matchWizardState.entrants.map(entrant => ({
      id: String(entrant.id),
      name: entrant.name
    })),
    finalScore: Object.keys(matchWizardState.score).reduce((score, entrantId) => {
      score[String(entrantId)] = Number(matchWizardState.score[entrantId] || 0);
      return score;
    }, {}),
    games: matchWizardState.games.map(game => ({
      gameNum: Number(game.gameNum),
      winnerId: String(game.winnerId),
      winnerName: game.metadata?.winnerName || getEntrantById(game.winnerId)?.name || 'Player',
      stageId: game.stageId || null,
      stageName: game.metadata?.stageName || null,
      selections: game.selections.map(selection => {
        const entrant = getEntrantById(selection.entrantId);
        const character = getCharacterById(selection.characterId);

        return {
          entrantId: String(selection.entrantId),
          entrantName: entrant?.name || `Entrant ${selection.entrantId}`,
          characterId: Number(selection.characterId),
          characterName: character?.name || `Character ${selection.characterId}`
        };
      })
    }))
  };
}

function getReportStageId(stage) {
  if (!stage) {
    return null;
  }

  return stage.startGgStageId || stage.stageId || null;
}

function getMatchWizardStages() {
  return Array.isArray(window.SmashJanusStages) ? window.SmashJanusStages : [];
}

function getCharacterList() {
  return Array.isArray(window.SMASH_ULTIMATE_CHARACTERS)
    ? window.SMASH_ULTIMATE_CHARACTERS
    : [];
}

function getFilteredCharacterList() {
  const query = normalizeText(matchWizardState.characterSearch);

  if (!query) {
    return getCharacterList();
  }

  return getCharacterList().filter(character => normalizeText(character.name).includes(query));
}

function getCharacterById(characterId) {
  return getCharacterList().find(character => Number(character.id) === Number(characterId));
}

function loadUltimateCharactersForWizard() {
  if (matchWizardCharactersLoadPromise || !getMatchWizardSessionId()) {
    return matchWizardCharactersLoadPromise;
  }

  matchWizardCharactersLoadPromise = getUltimateCharacters(getMatchWizardSessionId())
    .then(response => {
      if (Array.isArray(response.characters) && response.characters.length) {
        window.SMASH_ULTIMATE_CHARACTERS = response.characters;

        if (matchWizardState?.phase === 'character-select') {
          renderMatchWizard();
        }
      }
    })
    .catch(() => {
      matchWizardCharactersLoadPromise = null;
    });

  return matchWizardCharactersLoadPromise;
}

function getCurrentTurn() {
  return matchWizardState.turnQueue[matchWizardState.turnIndex];
}

function getSelectedStage() {
  return matchWizardState.stages.find(stage => stage.id === matchWizardState.selectedStageId);
}

function getCurrentGameBans() {
  return matchWizardState.stages
    .filter(stage => stage.status === 'banned')
    .map(stage => ({
      stageId: stage.id,
      stageName: stage.name,
      entrantId: stage.bannedBy
    }));
}

function getEntrantById(entrantId) {
  return matchWizardState.entrants.find(entrant => String(entrant.id) === String(entrantId));
}

function getOtherEntrant(entrantId) {
  return matchWizardState.entrants.find(entrant => String(entrant.id) !== String(entrantId));
}

function getSetWinnerId() {
  const winningEntry = Object.entries(matchWizardState.score)
    .find(([, wins]) => Number(wins) >= matchWizardState.requiredWins);

  return winningEntry ? winningEntry[0] : null;
}

function getStageStatusLabel(stage) {
  if (stage.status === 'selected') {
    return 'Selected';
  }

  if (stage.status === 'banned') {
    const entrant = getEntrantById(stage.bannedBy);
    return entrant ? `Baneado por ${entrant.name}` : 'Banned';
  }

  return 'Available';
}

function getPlayerColorClass(entrantId) {
  const index = matchWizardState.entrants.findIndex(entrant => String(entrant.id) === String(entrantId));
  return getPlayerColorClassByIndex(index);
}

function getPlayerColorClassByIndex(index) {
  return Number(index) === 1 ? 'player-blue' : 'player-red';
}

function setWizardBestOf(bestOf) {
  matchWizardState.bestOf = Number(bestOf);
  matchWizardState.requiredWins = getRequiredWins(bestOf);
  renderMatchWizard();
}

function restartSetFlow() {
  if (!window.confirm('Reiniciar set?')) {
    return;
  }

  initMatchWizard(matchWizardState.setNode);
}

function restartCurrentGame() {
  if (!window.confirm('Reiniciar este juego?')) {
    return;
  }

  if ((matchWizardState.phase === 'set-complete' || matchWizardState.phase === 'between-games') && matchWizardState.games.length) {
    const removedGame = matchWizardState.games.pop();
    matchWizardState.score[String(removedGame.winnerId)] = Math.max(
      0,
      Number(matchWizardState.score[String(removedGame.winnerId)] || 0) - 1
    );
    matchWizardState.gameNumber = Number(removedGame.gameNum);
    setPreviousGamePointers();
  }

  matchWizardState.error = '';
  matchWizardState.characterSelection = null;
  matchWizardState.charactersConfirmedForGame = null;
  matchWizardState.characterModalEntrantId = null;
  matchWizardState.characterSearch = '';
  matchWizardState.stages = createStageState();
  matchWizardState.selectedStageId = null;
  matchWizardState.turnQueue = [];
  matchWizardState.turnIndex = 0;
  matchWizardState.turnSelections = [];
  matchWizardState.stagePromptVisible = false;

  if (matchWizardState.useStageBans === null) {
    matchWizardState.phase = 'ban-choice';
    renderMatchWizard();
    return;
  }

  if (matchWizardState.useStageBans) {
    if (matchWizardState.gameNumber === 1) {
      matchWizardState.phase = 'rps-select';
      renderMatchWizard();
      return;
    }

    beginCharacterSelection({ nextAction: 'counterpick-striking' });
    return;
  }

  beginCharacterSelection({ nextAction: 'playing' });
}

function restartStageBans() {
  if (!window.confirm('Reiniciar selección de stage?')) {
    return;
  }

  matchWizardState.error = '';

  if (matchWizardState.gameNumber === 1) {
    if (matchWizardState.rpsWinnerId) {
      startGameOneStriking(matchWizardState.rpsWinnerId);
      return;
    }

    matchWizardState.phase = 'rps-select';
    renderMatchWizard();
    return;
  }

  if (matchWizardState.previousWinnerId) {
    startCounterpickFlow();
    return;
  }

  matchWizardState.phase = 'rps-select';
  renderMatchWizard();
}

function setPreviousGamePointers() {
  const previousGame = matchWizardState.games[matchWizardState.games.length - 1];

  matchWizardState.previousWinnerId = previousGame ? String(previousGame.winnerId) : null;
  matchWizardState.previousLoserId = previousGame?.metadata?.loserId || null;
}

function updateCharacterSearch(value) {
  matchWizardState.characterSearch = value;
  const results = document.getElementById('character-modal-results');

  if (results) {
    results.innerHTML = renderCharacterModalResults();
  }
}

function normalizeText(value) {
  return String(value || '').toLowerCase().trim();
}

function showMatchWizardView() {
  if (window.SmashJanusAuth?.showView) {
    window.SmashJanusAuth.showView('match-wizard-view');
    return;
  }

  document.querySelectorAll('.view').forEach(view => {
    view.classList.toggle('hidden', view.id !== 'match-wizard-view');
  });
}

function showPlayerDashboardView() {
  if (window.SmashJanusAuth?.showView) {
    window.SmashJanusAuth.showView('player-dashboard-view');
    return;
  }

  document.querySelectorAll('.view').forEach(view => {
    view.classList.toggle('hidden', view.id !== 'player-dashboard-view');
  });
}

function getMatchWizardSessionId() {
  if (window.SmashJanusAuth?.getSessionId) {
    return window.SmashJanusAuth.getSessionId();
  }

  return localStorage.getItem('smashJanus.startgg.sessionId');
}

function wizardEscapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('input', event => {
  if (event.target.id === 'character-search-input') {
    updateCharacterSearch(event.target.value);
  }
});

document.addEventListener('click', event => {
  const stageButton = event.target.closest('[data-stage-id]');
  const openCharacterButton = event.target.closest('[data-open-character-picker]');
  const sameCharacterButton = event.target.closest('[data-same-character-entrant-id]');
  const characterButton = event.target.closest('[data-character-id]');
  const stageFlowButton = event.target.closest('[data-stage-flow]');
  const rpsButton = event.target.closest('[data-rps-winner-id]');
  const winnerButton = event.target.closest('[data-game-winner-id]');
  const bestOfButton = event.target.closest('[data-wizard-best-of]');
  const actionButton = event.target.closest('[data-wizard-action]');

  if (stageButton) {
    handleStageClick(stageButton.dataset.stageId);
    return;
  }

  if (openCharacterButton) {
    openCharacterPicker(openCharacterButton.dataset.openCharacterPicker);
    return;
  }

  if (sameCharacterButton) {
    useSameCharacter(sameCharacterButton.dataset.sameCharacterEntrantId);
    return;
  }

  if (characterButton && matchWizardState?.characterModalEntrantId) {
    selectCharacter(matchWizardState.characterModalEntrantId, characterButton.dataset.characterId);
    return;
  }

  if (stageFlowButton) {
    chooseStageBanFlow(stageFlowButton.dataset.stageFlow === 'yes');
    return;
  }

  if (rpsButton) {
    startGameOneStriking(rpsButton.dataset.rpsWinnerId);
    return;
  }

  if (winnerButton) {
    reportGameWinner(winnerButton.dataset.gameWinnerId);
    return;
  }

  if (bestOfButton && matchWizardState?.phase === 'setup') {
    setWizardBestOf(bestOfButton.dataset.wizardBestOf);
    return;
  }

  if (!actionButton) {
    return;
  }

  if (actionButton.dataset.wizardAction === 'continue-setup') {
    continueFromSetup();
    return;
  }

  if (actionButton.dataset.wizardAction === 'close-character-modal') {
    closeCharacterPicker();
    return;
  }

  if (actionButton.dataset.wizardAction === 'dismiss-stage-prompt') {
    dismissStagePrompt();
    return;
  }

  if (actionButton.dataset.wizardAction === 'restart-set') {
    restartSetFlow();
    return;
  }

  if (actionButton.dataset.wizardAction === 'restart-game') {
    restartCurrentGame();
    return;
  }

  if (actionButton.dataset.wizardAction === 'restart-stages') {
    restartStageBans();
    return;
  }

  if (actionButton.dataset.wizardAction === 'confirm-characters') {
    confirmCharacterSelection();
    return;
  }

  if (actionButton.dataset.wizardAction === 'report-game') {
    beginGameReporting();
    return;
  }

  if (actionButton.dataset.wizardAction === 'next-game-characters') {
    beginCharacterSelection({
      nextAction: matchWizardState.useStageBans ? 'counterpick-striking' : 'playing'
    });
    return;
  }

  if (actionButton.dataset.wizardAction === 'submit-set') {
    submitMatchWizardSet();
    return;
  }

  if (actionButton.dataset.wizardAction === 'back-to-dashboard') {
    showPlayerDashboardView();
  }
});

window.initMatchWizard = initMatchWizard;
window.showCharacterSelection = showCharacterSelection;
window.SmashJanusMatchWizard = {
  init: initMatchWizard,
  showCharacterSelection
};
