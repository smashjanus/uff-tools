# Salamandra Queue

Aplicación de organización de partidas de Super Smash Bros. Ultimate. Proyecto nuevo e independiente del sitio anterior.

## Abrir la aplicación local

Requiere Node.js 22 o posterior. No necesita instalar dependencias.

Desde esta carpeta:

```sh
node server.mjs
```

Abre **http://127.0.0.1:4173**.

- **Iniciar sesión con start.gg** usa OAuth real cuando `.env` contiene la configuración requerida.
- **Entrar como invitado** permite ver y buscar el orden general sin una cuenta.
- Al entrar aparece una guía breve adaptada a invitado, jugador o administrador. El icono de información permite abrirla nuevamente.
- El selector del encabezado conserva el modo claro u oscuro en ese navegador.
- La cuenta configurada en `STARTGG_EVENT_SELECTOR_USER_SLUG` puede elegir uno de los eventos pertenecientes a sus torneos administrados. El selector ordena primero los torneos recientes; si start.gg omite uno de la lista, se puede pegar su enlace público y el servidor verificará la administración antes de aceptarlo.
- La conexión con start.gg importa eventos, fases, pools, participantes, sets y resultados. Una cuenta confirmada como administradora del torneo puede asignar una estación y llamar a los jugadores; el servidor vuelve a validar su permiso antes de cada acción.
- Pool A usa las estaciones 1–6 y Pool B las estaciones 7–12. Las estaciones deben existir y estar habilitadas previamente en start.gg.
- Salamandra no reporta resultados. Esa operación se mantiene exclusivamente en start.gg. start.gg exige el scope OAuth `tournament.reporter` para las mutaciones de estación y llamado, por lo que se solicita junto con `tournament.manager`, aunque el servidor no implementa ninguna mutación de resultados.

Sin `.env`, el servidor conserva el modo ficticio para desarrollo. Nunca publiques `.env`, tokens ni el directorio `data/`.

## Estado y actualización

La demo inicial tiene dos pools de 32 jugadores y seis estaciones por pool. El motor admite de 4 a 128 jugadores por pool, con pases automáticos y cuatro clasificados: dos por winners y dos por losers. Los pools pueden tener tamaños diferentes.

Con el servidor, todos los navegadores conectados comparten `data/demo-state.json`. Los cambios se guardan en disco antes de confirmarse y se notifican a las sesiones abiertas. Las escrituras se serializan y verifican versión, permisos, estación y jugadores. Ejecutar **una sola instancia** del servidor por directorio de datos.

Hay actualización periódica cada 15 segundos, botón de actualizar y recuperación al regresar a la pestaña, recargar, volver desde la caché del navegador o recuperar conexión. start.gg puede conservar respuestas públicas durante aproximadamente 45 segundos. Los errores muestran datos anteriores. El buscador conserva su texto y foco al actualizar.

Las sesiones viven en memoria del servidor durante 24 horas; reiniciarlo conserva el evento seleccionado, pero requiere iniciar sesión de nuevo. Las cookies son HttpOnly. Las funciones de administrador se validan contra el propietario y la lista de administradores del torneo, tanto al entrar como antes de cada escritura.

## Probar con un teléfono de la misma red

Detén el servidor anterior y, en PowerShell, ejecuta:

```powershell
$env:HOST = '0.0.0.0'
node server.mjs
```

En el teléfono, abre `http://IP-LOCAL-DE-LA-PC:4173`. La PC y el teléfono deben estar en la misma red y el puerto debe estar permitido por el firewall. La demo es accesible a quienes alcancen esa dirección; cualquier persona puede seleccionar una cuenta ficticia, incluido el administrador.

## GitHub Pages

```sh
node scripts/build-pages.mjs
```

Publica el contenido de `dist/`. El proyecto usa rutas relativas y funciona dentro de una subcarpeta de GitHub Pages. No hay fuentes externas, imágenes remotas ni dependencias que cargar desde CDN.

**Sin backend configurado, GitHub Pages ejecuta una demo de este dispositivo:** guarda el torneo en localStorage, comparte cambios entre pestañas del mismo navegador mediante BroadcastChannel y usa bloqueos del navegador cuando están disponibles. No sincroniza teléfonos diferentes. Esta limitación se indica en pantalla.

Para servir un estado compartido desde GitHub Pages, hace falta alojar `server.mjs` por HTTPS y configurar `apiBase` en `config.js`, `FRONTEND_ORIGIN` en el servidor y el callback HTTPS en start.gg. Las cookies entre sitios pueden ser restringidas por algunos navegadores; se recomienda servir web y API bajo el mismo sitio. El arranque local usa `/api`.

El compilado contiene únicamente archivos públicos. No incluye el servidor, datos, sesiones ni secretos. Por eso `dist/` sirve para una vista estática, pero las acciones reales requieren el servidor. La lista exacta de archivos y variables está en `docs/DEPLOYMENT.md`.

## Qué significa la fila

La prioridad se calcula y se presenta por separado para cada pool. Primero muestra sets en juego y llamados. Entre los pendientes, prefiere cruces listos, favorece losers, mantiene trabajo de winners y retrasa cruces avanzados cuyo recorrido de losers va atrasado. Cuatro estaciones para losers y dos para winners es una orientación; todas son compartidas dentro de su pool.

Los números en la lista son posiciones entre los cruces disponibles de **su pool**, no el número de sets consecutivos que debe esperar un jugador. Varias estaciones funcionan a la vez.

Las horas son estimaciones basadas en 12 minutos por set y dos minutos de descanso. La estimación de disponibilidad de una estación en uso no sustituye la confirmación de que el set terminó. Una partida con rival desconocido no recibe una hora inventada: se muestra cuántos sets previos faltan por resolver. Un llamado confirma estación; una estimación nunca la reserva.

## Validación

```sh
node --test tests/*.test.mjs
```

Las pruebas cubren tamaños de 4 a 128, clasificación y eliminación, pases automáticos, descansos, estaciones ocupadas, pools distintos, estimaciones en paralelo, permisos, mutaciones de estación sin reporte de resultados y prioridad de losers. Se verificó además en navegador: acceso invitado/jugador/administrador, estaciones correctas por pool, llamado, inicio, rival pendiente, cantidad de partidas anteriores, vista móvil y transporte estático sin backend.

Capturas y evidencia de pruebas visuales están en `artifacts/`, excluida de Git. La conexión real y sus permisos se describen en `docs/STARTGG-INTEGRATION.md`.
