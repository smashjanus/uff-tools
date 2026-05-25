/**
 * Smash Janus - Google Apps Script backend.
 *
 * This version supports a SPA OAuth Authorization Code flow:
 * 1. Browser redirects to start.gg using the frontend URL as redirect_uri.
 * 2. Browser receives ?code=... on the frontend.
 * 3. Browser POSTs the code to this GAS endpoint.
 * 4. GAS attaches START_GG_CLIENT_SECRET, exchanges the code for tokens, and
 *    stores those tokens server-side.
 *
 * Store these in Project Settings > Script properties:
 * - START_GG_CLIENT_ID
 * - START_GG_CLIENT_SECRET
 * - START_GG_REDIRECT_URI, optional; defaults to http://127.0.0.1:5500/
 * - ADMIN_USER_IDS, comma-separated start.gg user IDs allowed to approve sets
 * - ADMIN_PLAYER_IDS, optional comma-separated start.gg player IDs
 * - ADMIN_GAMERTAGS, optional comma-separated gamerTags
 */

const START_GG_TOKEN_URL = 'https://api.start.gg/oauth/access_token';
const START_GG_GRAPHQL_URL = 'https://api.start.gg/gql/alpha';
const DEFAULT_START_GG_REDIRECT_URI = 'http://127.0.0.1:5500/';
const START_GG_OAUTH_SCOPES = 'user.identity tournament.reporter';
const START_GG_SESSION_PREFIX = 'START_GG_SESSION_';
const SET_REPORT_PREFIX = 'SET_REPORT_';
const SET_REPORT_INDEX_KEY = 'SET_REPORT_INDEX';
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const START_GG_QUERIES = {
  CURRENT_USER: `
    query CurrentUser {
      currentUser {
        id
        discriminator
        player {
          id
          gamerTag
        }
      }
    }
  `,

  GET_USER: `
    query GetUser($slug: String!) {
      user(slug: $slug) {
        id
        discriminator
        player {
          id
          gamerTag
        }
      }
    }
  `,

  TOURNAMENTS_BY_OWNER: `
    query TournamentsByOwner($ownerId: ID!, $perPage: Int!) {
      tournaments(query: { perPage: $perPage, filter: { ownerId: $ownerId } }) {
        nodes {
          id
          name
          slug
          startAt
          endAt
          isOnline
          city
          addrState
          countryCode
          numAttendees
        }
      }
    }
  `,

  TOURNAMENT_EVENTS: `
    query TournamentEvents($tournamentId: ID!) {
      tournament(id: $tournamentId) {
        id
        name
        events {
          id
          name
          slug
          numEntrants
        }
      }
    }
  `,

  EVENT_SETS: `
    query EventSets($eventId: ID!, $page: Int!, $perPage: Int!) {
      event(id: $eventId) {
        id
        name
        sets(page: $page, perPage: $perPage) {
          pageInfo {
            totalPages
          }
          nodes {
            id
            fullRoundText
            state
            displayScore
            winnerId
            slots {
              entrant {
                id
                name
              }
            }
          }
        }
      }
    }
  `,

  STARTED_EVENT_SETS: `
    query StartedEventSets($eventId: ID!, $page: Int!, $perPage: Int!) {
      event(id: $eventId) {
        id
        name
        sets(page: $page, perPage: $perPage) {
          pageInfo {
            totalPages
          }
          nodes {
            id
            fullRoundText
            state
            startedAt
            displayScore
            winnerId
            slots {
              entrant {
                id
                name
              }
            }
          }
        }
      }
    }
  `,

  SET_BY_ID: `
    query SetById($setId: ID!) {
      set(id: $setId) {
        id
        state
        winnerId
        displayScore
      }
    }
  `,

  ULTIMATE_CHARACTERS: `
    query UltimateCharacters($name: String!, $perPage: Int!) {
      videogames(query: { filter: { name: $name }, perPage: $perPage }) {
        nodes {
          id
          name
          displayName
          characters {
            id
            name
          }
        }
      }
    }
  `,

  REPORT_SET: `
    mutation ReportSet($setId: ID!, $winnerId: ID!, $gameData: [BracketSetGameDataInput]) {
      reportBracketSet(setId: $setId, winnerId: $winnerId, gameData: $gameData) {
        id
        state
        winnerId
        displayScore
      }
    }
  `
};

function doGet() {
  return jsonResponse_({
    ok: true,
    service: 'smash-janus-gas',
    authFlow: 'spa-authorization-code'
  });
}

function doPost(e) {
  try {
    const body = parseJsonBody_(e);

    if (body.action === 'exchangeAuthCode') {
      assertRequired_(body.code, 'code');
      const session = exchangeAuthCode_(String(body.code), body.redirectUri);
      return jsonResponse_({
        ok: true,
        authenticated: true,
        sessionId: session.sessionId,
        user: session.user || null,
        isAdmin: Boolean(session.isAdmin),
        expiresAt: session.token.expiresAt || null
      });
    }

    if (body.action === 'status') {
      const session = getStoredSession_(body.sessionId);
      return jsonResponse_({
        ok: true,
        authenticated: Boolean(session),
        user: session && session.user ? session.user : null,
        isAdmin: Boolean(session && session.isAdmin)
      });
    }

    if (body.action === 'logout') {
      deleteStoredSession_(body.sessionId);
      return jsonResponse_({ ok: true, authenticated: false });
    }

    if (body.action === 'getUser') {
      assertRequired_(body.slug, 'slug');
      const data = startGgGraphQL_(
        body.sessionId,
        START_GG_QUERIES.GET_USER,
        { slug: String(body.slug) },
        'GetUser'
      );
      return jsonResponse_({ ok: true, user: data.user });
    }

    if (body.action === 'getTournamentsByOwner') {
      assertRequired_(body.ownerId, 'ownerId');
      const data = startGgGraphQL_(
        body.sessionId,
        START_GG_QUERIES.TOURNAMENTS_BY_OWNER,
        {
          ownerId: String(body.ownerId),
          perPage: Number(body.perPage || 100)
        },
        'TournamentsByOwner'
      );
      return jsonResponse_({ ok: true, tournaments: data.tournaments.nodes });
    }

    if (body.action === 'getTournamentEvents') {
      assertRequired_(body.tournamentId, 'tournamentId');
      const data = startGgGraphQL_(
        body.sessionId,
        START_GG_QUERIES.TOURNAMENT_EVENTS,
        { tournamentId: String(body.tournamentId) },
        'TournamentEvents'
      );
      return jsonResponse_({ ok: true, tournament: data.tournament });
    }

    if (body.action === 'getEventSets') {
      assertRequired_(body.eventId, 'eventId');
      const data = startGgGraphQL_(
        body.sessionId,
        START_GG_QUERIES.EVENT_SETS,
        {
          eventId: String(body.eventId),
          page: Number(body.page || 1),
          perPage: Math.min(Number(body.perPage || 100), 100)
        },
        'EventSets'
      );
      return jsonResponse_({ ok: true, event: data.event });
    }

    if (body.action === 'getStartedSets') {
      requireAdmin_(body.sessionId);
      assertRequired_(body.eventId, 'eventId');
      const data = startGgGraphQL_(
        body.sessionId,
        START_GG_QUERIES.STARTED_EVENT_SETS,
        {
          eventId: String(body.eventId),
          page: Number(body.page || 1),
          perPage: Math.min(Number(body.perPage || 100), 100)
        },
        'StartedEventSets'
      );
      return jsonResponse_({ ok: true, event: data.event });
    }

    if (body.action === 'getUltimateCharacters') {
      const data = startGgGraphQL_(
        body.sessionId,
        START_GG_QUERIES.ULTIMATE_CHARACTERS,
        {
          name: 'Super Smash Bros. Ultimate',
          perPage: 10
        },
        'UltimateCharacters'
      );
      return jsonResponse_({
        ok: true,
        characters: getUltimateCharactersFromResponse_(data)
      });
    }

    if (body.action === 'getSetReportStatus') {
      assertRequired_(body.sessionId, 'sessionId');
      assertRequired_(body.setId, 'setId');
      getValidAccessToken_(body.sessionId);
      return jsonResponse_(Object.assign({
        ok: true
      }, getSetReportStatusWithStartGg_(body.sessionId, body.setId)));
    }

    if (body.action === 'reportSet') {
      assertRequired_(body.sessionId, 'sessionId');
      assertRequired_(body.setId, 'setId');
      assertRequired_(body.winnerId, 'winnerId');
      assertRequired_(body.gameData, 'gameData');
      const report = saveSetReport_(
        body.sessionId,
        body.setId,
        body.winnerId,
        body.gameData,
        body.selections || [],
        body.summary || null
      );
      return jsonResponse_({ ok: true, report: report });
    }

    if (body.action === 'listSetReports') {
      requireAdmin_(body.sessionId);
      return jsonResponse_({
        ok: true,
        reports: listSetReports_(body.status || 'pending')
      });
    }

    if (body.action === 'approveSetReport') {
      assertRequired_(body.reportId, 'reportId');
      const approvedReport = approveSetReport_(body.sessionId, body.reportId);
      return jsonResponse_({ ok: true, report: approvedReport });
    }

    if (body.action === 'denySetReport') {
      assertRequired_(body.reportId, 'reportId');
      const deniedReport = denySetReport_(body.sessionId, body.reportId);
      return jsonResponse_({ ok: true, report: deniedReport });
    }

    return jsonResponse_({
      ok: false,
      error: 'UNKNOWN_ACTION',
      message: 'Unknown or missing action.'
    });
  } catch (err) {
    return errorResponse_(err);
  }
}

function exchangeAuthCode_(code, redirectUri) {
  const token = fetchStartGgToken_({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: getValidatedRedirectUri_(redirectUri)
  });

  const session = {
    sessionId: createSessionId_(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    token: normalizeToken_(token)
  };
  session.user = fetchCurrentUserWithToken_(session.token.access_token);
  session.isAdmin = isAdminUser_(session.user);
  const reusableSession = getReusableSessionForUser_(session.user);
  if (reusableSession) {
    session.sessionId = reusableSession.sessionId;
    session.createdAt = reusableSession.createdAt || session.createdAt;
  }
  pruneExpiredSessions_();
  pruneSessionsForUser_(session.user, session.sessionId);

  storeSession_(session);
  return session;
}

function startGgGraphQL_(sessionId, query, variables, operationName) {
  const accessToken = getValidAccessToken_(sessionId);
  return startGgGraphQLWithToken_(accessToken, query, variables, operationName);
}

function startGgGraphQLWithToken_(accessToken, query, variables, operationName) {
  const payload = {
    query: query,
    variables: variables || {}
  };

  if (operationName) {
    payload.operationName = operationName;
  }

  const response = UrlFetchApp.fetch(START_GG_GRAPHQL_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + accessToken
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();
  const result = parseJsonText_(text, 'start.gg returned a non-JSON GraphQL response.');

  if (status < 200 || status >= 300 || result.errors) {
    const err = new Error(getGraphQLErrorMessage_(result.errors) || 'start.gg GraphQL request failed.');
    err.code = 'START_GG_GRAPHQL_ERROR';
    err.status = status;
    err.details = result.errors || result;
    throw err;
  }

  return result.data;
}

function getGraphQLErrorMessage_(errors) {
  if (!Array.isArray(errors) || !errors.length) {
    return '';
  }

  return errors
    .map(function(error) {
      return error && error.message ? String(error.message) : '';
    })
    .filter(Boolean)
    .join(' ');
}

function saveSetReport_(sessionId, setId, winnerId, gameData, selections, summary) {
  const session = getStoredSession_(sessionId);
  getValidAccessToken_(sessionId);
  const lock = LockService.getScriptLock();
  let hasLock = false;

  try {
    lock.waitLock(5000);
    hasLock = true;
    assertSetCanReceiveReport_(sessionId, setId);

    const report = {
      id: Utilities.getUuid(),
      status: 'pending',
      setId: String(setId),
      winnerId: String(winnerId),
      gameData: gameData,
      selections: selections || [],
      summary: summary || null,
      submittedAt: new Date().toISOString(),
      submittedBy: session && session.user ? session.user : null,
      submittedByHash: hashValue_(sessionId)
    };

    const props = PropertiesService.getScriptProperties();
    props.setProperty(SET_REPORT_PREFIX + report.id, JSON.stringify(report));
    props.setProperty(SET_REPORT_INDEX_KEY, JSON.stringify([
      report.id
    ].concat(getSetReportIndex_()).slice(0, 200)));

    return report;
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

function assertSetCanReceiveReport_(sessionId, setId) {
  const reportStatus = getSetReportStatus_(setId);

  if (reportStatus.status === 'pending') {
    const err = new Error('Esta partida ya fue reportada y está pendiente de aprobación. Avísale al organizador para que sea aprobado el resultado.');
    err.code = 'SET_REPORT_PENDING';
    throw err;
  }

  if (reportStatus.status === 'approved') {
    const err = new Error('Esta partida ya fue reportada y aprobada por un organizador. Si deseas cambiar algo por favor acércate al equipo de Smash Janus.');
    err.code = 'SET_REPORT_APPROVED';
    throw err;
  }

  if (isStartGgSetCompleted_(fetchStartGgSetSafely_(sessionId, setId))) {
    const err = new Error('Esta partida ya fue reportada y aprobada por un organizador. Si deseas cambiar algo por favor acércate al equipo de Smash Janus.');
    err.code = 'SET_COMPLETED';
    throw err;
  }
}

function getSetReportStatusWithStartGg_(sessionId, setId) {
  const reportStatus = getSetReportStatus_(setId);

  if (reportStatus.status === 'pending' || reportStatus.status === 'approved') {
    return reportStatus;
  }

  const startGgSet = fetchStartGgSetSafely_(sessionId, setId);

  if (isStartGgSetCompleted_(startGgSet)) {
    return {
      status: 'completed',
      report: reportStatus.report || null,
      startGgSet: summarizeStartGgSet_(startGgSet)
    };
  }

  return Object.assign({}, reportStatus, {
    startGgSet: summarizeStartGgSet_(startGgSet)
  });
}

function getSetReportStatus_(setId) {
  const reports = getSetReportsForSet_(setId);
  const pendingReport = reports.find(function(report) {
    return report.status === 'pending';
  });

  if (pendingReport) {
    return {
      status: 'pending',
      report: summarizeSetReport_(pendingReport)
    };
  }

  const approvedReport = reports.find(function(report) {
    return report.status === 'approved';
  });

  if (approvedReport) {
    return {
      status: 'approved',
      report: summarizeSetReport_(approvedReport)
    };
  }

  const deniedReport = reports.find(function(report) {
    return report.status === 'denied';
  });

  if (deniedReport) {
    return {
      status: 'denied',
      report: summarizeSetReport_(deniedReport)
    };
  }

  return {
    status: 'none',
    report: null
  };
}

function getSetReportsForSet_(setId) {
  const targetSetId = String(setId);

  return getSetReportIndex_()
    .map(function(reportId) {
      return getStoredSetReport_(reportId);
    })
    .filter(Boolean)
    .filter(function(report) {
      return String(report.setId) === targetSetId;
    });
}

function summarizeSetReport_(report) {
  return {
    id: report.id,
    status: report.status,
    setId: report.setId,
    submittedAt: report.submittedAt || null,
    approvedAt: report.approvedAt || null,
    deniedAt: report.deniedAt || null,
    summary: report.summary || null
  };
}

function fetchStartGgSetSafely_(sessionId, setId) {
  try {
    const data = startGgGraphQL_(
      sessionId,
      START_GG_QUERIES.SET_BY_ID,
      { setId: String(setId) },
      'SetById'
    );
    return data.set || null;
  } catch (err) {
    return null;
  }
}

function isStartGgSetCompleted_(set) {
  const state = Number(set && set.state);
  return Boolean(set && (set.winnerId || (state > 0 && state !== 1 && state !== 2)));
}

function summarizeStartGgSet_(set) {
  if (!set) {
    return null;
  }

  return {
    id: set.id ? String(set.id) : '',
    state: set.state || null,
    winnerId: set.winnerId ? String(set.winnerId) : '',
    displayScore: set.displayScore || ''
  };
}

function listSetReports_(status) {
  return getSetReportIndex_()
    .map(function(reportId) {
      return getStoredSetReport_(reportId);
    })
    .filter(Boolean)
    .filter(function(report) {
      return status === 'all' || report.status === status;
    });
}

function approveSetReport_(sessionId, reportId) {
  const adminSession = requireAdmin_(sessionId);
  const report = getStoredSetReport_(reportId);

  if (!report) {
    const err = new Error('Set report was not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (report.status !== 'pending') {
    const err = new Error('Only pending reports can be approved.');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  validateReportBeforeApproval_(report);

  const data = startGgGraphQL_(
    sessionId,
    START_GG_QUERIES.REPORT_SET,
    {
      setId: String(report.setId),
      winnerId: String(report.winnerId),
      gameData: normalizeGameDataForMutation_(report.gameData)
    },
    'ReportSet'
  );

  report.status = 'approved';
  report.approvedAt = new Date().toISOString();
  report.approvedBy = adminSession.user || null;
  report.startGgSet = data.reportBracketSet;
  storeSetReport_(report);

  return report;
}

function denySetReport_(sessionId, reportId) {
  const adminSession = requireAdmin_(sessionId);
  const report = getStoredSetReport_(reportId);

  if (!report) {
    const err = new Error('Set report was not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (report.status !== 'pending') {
    const err = new Error('Only pending reports can be denied.');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  report.status = 'denied';
  report.deniedAt = new Date().toISOString();
  report.deniedBy = adminSession.user || null;
  storeSetReport_(report);

  return report;
}

function getStoredSetReport_(reportId) {
  const raw = PropertiesService
    .getScriptProperties()
    .getProperty(SET_REPORT_PREFIX + String(reportId));

  return raw ? parseJsonText_(raw, 'Stored set report is invalid.') : null;
}

function storeSetReport_(report) {
  PropertiesService
    .getScriptProperties()
    .setProperty(SET_REPORT_PREFIX + report.id, JSON.stringify(report));
}

function validateReportBeforeApproval_(report) {
  assertRequired_(report.setId, 'setId');
  assertRequired_(report.winnerId, 'winnerId');

  if (!Array.isArray(report.gameData) || report.gameData.length === 0) {
    const err = new Error('Report must include at least one game.');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  report.gameData.forEach(function(game, index) {
    assertRequired_(game.winnerId, 'gameData[' + index + '].winnerId');
    assertRequired_(game.gameNum, 'gameData[' + index + '].gameNum');
    assertRequired_(game.entrant1Score, 'gameData[' + index + '].entrant1Score');
    assertRequired_(game.entrant2Score, 'gameData[' + index + '].entrant2Score');

    if (!Array.isArray(game.selections) || game.selections.length !== 2) {
      const err = new Error('Each game must include two character selections.');
      err.code = 'BAD_REQUEST';
      throw err;
    }
  });
}

function normalizeGameDataForMutation_(gameData) {
  return gameData.map(function(game) {
    const normalized = {
      winnerId: String(game.winnerId),
      gameNum: Number(game.gameNum),
      entrant1Score: Number(game.entrant1Score),
      entrant2Score: Number(game.entrant2Score),
      selections: game.selections.map(function(selection) {
        return {
          entrantId: String(selection.entrantId),
          characterId: Number(selection.characterId)
        };
      })
    };

    if (game.stageId !== undefined && game.stageId !== null && game.stageId !== '') {
      normalized.stageId = Number(game.stageId);
    }

    return normalized;
  });
}

function getSetReportIndex_() {
  const raw = PropertiesService
    .getScriptProperties()
    .getProperty(SET_REPORT_INDEX_KEY);

  if (!raw) {
    return [];
  }

  return parseJsonText_(raw, 'Stored set report index is invalid.');
}

function fetchCurrentUserWithToken_(accessToken) {
  const data = startGgGraphQLWithToken_(
    accessToken,
    START_GG_QUERIES.CURRENT_USER,
    {},
    'CurrentUser'
  );
  return normalizeCurrentUser_(data.currentUser);
}

function normalizeCurrentUser_(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id ? String(user.id) : '',
    discriminator: user.discriminator || '',
    playerId: user.player && user.player.id ? String(user.player.id) : '',
    gamerTag: user.player && user.player.gamerTag ? String(user.player.gamerTag) : ''
  };
}

function isAdminUser_(user) {
  if (!user) {
    return false;
  }

  const adminUserIds = getScriptList_('ADMIN_USER_IDS');
  const adminPlayerIds = getScriptList_('ADMIN_PLAYER_IDS');
  const adminGamerTags = getScriptList_('ADMIN_GAMERTAGS').map(function(value) {
    return value.toLowerCase();
  });

  return adminUserIds.indexOf(String(user.id)) !== -1 ||
    adminPlayerIds.indexOf(String(user.playerId)) !== -1 ||
    adminGamerTags.indexOf(String(user.gamerTag || '').toLowerCase()) !== -1;
}

function requireAdmin_(sessionId) {
  const session = getStoredSession_(sessionId);

  if (!session || !session.isAdmin) {
    const err = new Error('Admin access is required.');
    err.code = 'FORBIDDEN';
    throw err;
  }

  getValidAccessToken_(sessionId);
  return session;
}

function getUltimateCharactersFromResponse_(data) {
  const nodes = data && data.videogames && data.videogames.nodes
    ? data.videogames.nodes
    : [];
  const ultimate = nodes.find(function(node) {
    const label = String((node.displayName || node.name || '')).toLowerCase();
    return label.indexOf('ultimate') !== -1;
  }) || nodes[0];

  if (!ultimate || !Array.isArray(ultimate.characters)) {
    return [];
  }

  return ultimate.characters
    .map(function(character) {
      return {
        id: Number(character.id),
        name: character.name
      };
    })
    .sort(function(a, b) {
      return a.name.localeCompare(b.name);
    });
}

function getValidAccessToken_(sessionId) {
  const session = getStoredSession_(sessionId);

  if (!session || !session.token || !session.token.access_token) {
    const err = new Error('The user must authorize start.gg before this request.');
    err.code = 'START_GG_AUTH_REQUIRED';
    throw err;
  }

  if (shouldRefreshToken_(session.token)) {
    return refreshSessionToken_(session).token.access_token;
  }

  return session.token.access_token;
}

function refreshSessionToken_(session) {
  if (!session.token.refresh_token) {
    const err = new Error('The start.gg access token expired and no refresh token is available.');
    err.code = 'START_GG_AUTH_REQUIRED';
    throw err;
  }

  const token = fetchStartGgToken_({
    grant_type: 'refresh_token',
    refresh_token: session.token.refresh_token
  });

  session.token = normalizeToken_(token, session.token);
  session.updatedAt = new Date().toISOString();
  storeSession_(session);
  return session;
}

function fetchStartGgToken_(payload) {
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('START_GG_CLIENT_ID');
  const clientSecret = props.getProperty('START_GG_CLIENT_SECRET');
  assertConfigured_(clientId, 'START_GG_CLIENT_ID');
  assertConfigured_(clientSecret, 'START_GG_CLIENT_SECRET');

  const requestPayload = Object.assign({}, payload, {
    client_id: clientId,
    client_secret: clientSecret,
    scope: payload.scope || START_GG_OAUTH_SCOPES,
    redirect_uri: payload.redirect_uri || getConfiguredRedirectUri_()
  });

  const response = UrlFetchApp.fetch(START_GG_TOKEN_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Accept: 'application/json'
    },
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();
  const token = parseJsonText_(text, 'start.gg returned a non-JSON token response.');

  if (status < 200 || status >= 300 || token.error) {
    const err = new Error('start.gg token exchange failed.');
    err.code = 'START_GG_TOKEN_ERROR';
    err.status = status;
    err.details = token;
    throw err;
  }

  return token;
}

function normalizeToken_(token, previousToken) {
  const now = Date.now();
  const expiresIn = Number(token.expires_in || token.expires || 0);
  const normalized = Object.assign({}, previousToken || {}, token, {
    grantedAt: now
  });

  if (expiresIn > 0) {
    normalized.expiresAt = now + expiresIn * 1000;
  }

  if (!normalized.refresh_token && previousToken && previousToken.refresh_token) {
    normalized.refresh_token = previousToken.refresh_token;
  }

  return normalized;
}

function shouldRefreshToken_(token) {
  return Boolean(token.expiresAt && Date.now() > token.expiresAt - TOKEN_REFRESH_BUFFER_MS);
}

function storeSession_(session) {
  PropertiesService
    .getScriptProperties()
    .setProperty(getSessionKey_(session.sessionId), JSON.stringify(session));
}

function getStoredSession_(sessionId) {
  if (!sessionId) {
    return null;
  }

  const raw = PropertiesService
    .getScriptProperties()
    .getProperty(getSessionKey_(sessionId));

  return raw ? parseJsonText_(raw, 'Stored session data is invalid.') : null;
}

function deleteStoredSession_(sessionId) {
  if (!sessionId) {
    return;
  }

  PropertiesService
    .getScriptProperties()
    .deleteProperty(getSessionKey_(sessionId));
}

function getReusableSessionForUser_(user) {
  if (!user) {
    return null;
  }

  return getStoredSessions_()
    .map(function(item) {
      return item.session;
    })
    .filter(function(session) {
      return isSameSessionUser_(session, user);
    })
    .sort(function(a, b) {
      return getSessionTimestamp_(b) - getSessionTimestamp_(a);
    })[0] || null;
}

function pruneExpiredSessions_() {
  const now = Date.now();
  const props = PropertiesService.getScriptProperties();

  getStoredSessions_().forEach(function(item) {
    const timestamp = getSessionTimestamp_(item.session);

    if (timestamp && now - timestamp > SESSION_MAX_AGE_MS) {
      props.deleteProperty(item.key);
    }
  });
}

function pruneSessionsForUser_(user, keepSessionId) {
  if (!user) {
    return;
  }

  const props = PropertiesService.getScriptProperties();

  getStoredSessions_().forEach(function(item) {
    if (
      String(item.session.sessionId) !== String(keepSessionId) &&
      isSameSessionUser_(item.session, user)
    ) {
      props.deleteProperty(item.key);
    }
  });
}

function getStoredSessions_() {
  const properties = PropertiesService.getScriptProperties().getProperties();

  return Object.keys(properties)
    .filter(function(key) {
      return key.indexOf(START_GG_SESSION_PREFIX) === 0;
    })
    .map(function(key) {
      try {
        return {
          key: key,
          session: JSON.parse(properties[key])
        };
      } catch (err) {
        return null;
      }
    })
    .filter(function(item) {
      return item && item.session;
    });
}

function isSameSessionUser_(session, user) {
  const sessionUser = session && session.user ? session.user : {};

  if (user.id && sessionUser.id) {
    return String(user.id) === String(sessionUser.id);
  }

  if (user.playerId && sessionUser.playerId) {
    return String(user.playerId) === String(sessionUser.playerId);
  }

  return Boolean(
    user.gamerTag &&
    sessionUser.gamerTag &&
    String(user.gamerTag).toLowerCase() === String(sessionUser.gamerTag).toLowerCase()
  );
}

function getSessionTimestamp_(session) {
  return Date.parse(session.updatedAt || session.createdAt || '') || 0;
}

function getSessionKey_(sessionId) {
  return START_GG_SESSION_PREFIX + String(sessionId);
}

function getScriptList_(propertyName) {
  const raw = PropertiesService.getScriptProperties().getProperty(propertyName) || '';
  return raw
    .split(',')
    .map(function(value) {
      return value.trim();
    })
    .filter(Boolean);
}

function createSessionId_() {
  const raw = Utilities.getUuid() + Utilities.getUuid() + Date.now();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function hashValue_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value)
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function getValidatedRedirectUri_(redirectUri) {
  const configuredUri = getConfiguredRedirectUri_();
  const value = String(redirectUri || configuredUri);

  if (value !== configuredUri) {
    const err = new Error('Invalid OAuth redirect_uri.');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  return configuredUri;
}

function getConfiguredRedirectUri_() {
  return PropertiesService
    .getScriptProperties()
    .getProperty('START_GG_REDIRECT_URI') || DEFAULT_START_GG_REDIRECT_URI;
}

function parseJsonBody_(e) {
  const contents = e && e.postData && e.postData.contents;
  if (!contents) {
    return {};
  }

  return parseJsonText_(contents, 'Request body must be valid JSON.');
}

function parseJsonText_(text, errorMessage) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const wrapped = new Error(errorMessage);
    wrapped.code = 'INVALID_JSON';
    wrapped.details = String(text || '').slice(0, 500);
    throw wrapped;
  }
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(err) {
  return jsonResponse_({
    ok: false,
    error: err.code || 'SERVER_ERROR',
    message: err.message || String(err),
    status: err.status || null,
    details: err.details || null
  });
}

function assertRequired_(value, name) {
  if (value === undefined || value === null || value === '') {
    const err = new Error('Missing required field: ' + name);
    err.code = 'BAD_REQUEST';
    throw err;
  }
}

function assertConfigured_(value, name) {
  if (!value) {
    const err = new Error('Missing Apps Script property: ' + name);
    err.code = 'CONFIGURATION_ERROR';
    throw err;
  }
}
