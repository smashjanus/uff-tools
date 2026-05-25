# Smash Janus Project Structure

Recommended structure for the GitHub Pages frontend plus Google Apps Script
middleware:

```text
smash-janus/
  index.html
  assets/
    ruleset.jpeg
    stages/
      small-battlefield.jpg
      final-destination.jpg
      pokemon-stadium-2.jpg
      smashville.jpg
      town-and-city.jpg
      kalos-pokemon-league.jpg
      battlefield.jpg
      hollow-bastion.jpg
  css/
    styles.css
  js/
    app.js
    api.js
    auth.js
    stages.js
    match-wizard.js
    player-dashboard.js
    admin-dashboard.js
  gas/
    Code.gs
    appsscript.json
  docs/
    PROJECT_STRUCTURE.md
  startgg.postman_collection.json
```

## Responsibilities

- `index.html`: Mobile-first shell for login, player dashboard, match wizard,
  and admin queue.
- `css/styles.css`: Minimal responsive layout, stage state styling, and touch
  target rules.
- `js/api.js`: Calls the deployed Google Apps Script web app. It never stores
  start.gg tokens or secrets.
- `js/auth.js`: Handles login redirects, session status checks, and logout.
- `js/stages.js`: Fixed eight-stage ruleset data and stage state helpers.
- `js/match-wizard.js`: Stateful Bo3/Bo5 striking and game reporting flow.
- `js/player-dashboard.js`: Upcoming/current set view.
- `js/admin-dashboard.js`: Active tournament picker and completed-set approval
  queue.
- `gas/Code.gs`: start.gg OAuth2 flow, GraphQL wrapper, and REST routes.
- `gas/appsscript.json`: Apps Script manifest with OAuth2 library dependency
  and `UrlFetchApp` scope.

## Security Boundary

All start.gg OAuth client credentials, user bearer tokens, refresh tokens, and
GraphQL requests live in Google Apps Script. The browser only calls named REST
actions exposed by the Apps Script web app.
