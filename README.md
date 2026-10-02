# Fútbol de los viernes

Sistema web para cargar jugadores con estadísticas y armar dos equipos parejos de 5 vs 5 (1 arquero, 2 defensores, 2 delanteros).

## Probar localmente

Abrí `index.html` con doble click. Mientras `firebase-config.js` esté vacío el sistema corre en **modo local**: los datos se guardan en ese navegador (localStorage) y no pide usuario.

Para probar ya conectado a Firebase conviene un servidor local: `python -m http.server 8000` y entrar a http://localhost:8000.

## Cómo arma los equipos

- Cada jugador tiene un puntaje por puesto, calculado con sus estadísticas (ARQ: arquero, físico, pase, velocidad · DEF: defensa, físico, pase, velocidad · DEL: tiro, regate, velocidad, pase).
- Jugar en el segundo puesto resta 7 %; fuera de puesto, 18 %.
- Se evalúan las 126 formas de dividir a los 10 jugadores, con la mejor formación de cada equipo, y se elige la de menor diferencia total y por línea.
- La segunda opción es la siguiente más pareja en la que al menos 2 jugadores por equipo cambian de lado.

Los pesos están al comienzo de `app.js` (`PESOS` y `FIT`).

## Versión

El número que se ve abajo a la derecha está en `version.js` y se incrementa con cada cambio.

## Conectar Firebase (gratis, plan Spark)

1. En https://console.firebase.google.com creá un proyecto.
2. **Authentication → Sign-in method**: habilitá *Correo electrónico/contraseña*. En **Users**, agregá un usuario por cada administrador.
3. **Firestore Database**: creá la base (modo producción).
4. En Firestore creá la colección `admins` con un documento por administrador, cuyo **ID de documento sea su email** (el contenido puede ser cualquier campo, por ejemplo `activo: true`).
5. **Firestore → Reglas**: pegá el contenido de `firestore.rules` y publicá.
6. **Configuración del proyecto → Tus apps → Web (`</>`)**: registrá la app y copiá `apiKey`, `authDomain`, `projectId` y `appId` en `firebase-config.js`.

Las fotos se reducen a 240×240 y se guardan dentro de Firestore, así que no hace falta Firebase Storage (que ya no es gratuito).

## Subir a GitHub Pages

1. Creá un repositorio y subí todos los archivos de esta carpeta.
2. **Settings → Pages**: Source = *Deploy from a branch*, rama `main`, carpeta `/ (root)`.
3. En Firebase, **Authentication → Settings → Authorized domains**: agregá `TU_USUARIO.github.io`.

La `apiKey` de Firebase es pública por diseño; la seguridad la dan las reglas de Firestore.
