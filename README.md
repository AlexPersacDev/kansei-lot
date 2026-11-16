# Kansei Lot

Prototipo de drift en el navegador al estilo FR Legends: un BMW 316i E30 coupé poco modificado y una explanada de 600 × 600 m con zonas. Funciona en PC (volante, mando, teclado y ratón) y en móvil (giroscopio y táctil), y se instala como app (PWA).

- **URL:** https://alexpersacdev.github.io/kansei-lot/
- **Código de acceso:** te lo pasa quien te mandó el enlace.

---

## Para jugar (instrucciones para los colegas)

### iPhone
1. Abre el enlace en **Safari** (no vale Chrome en iPhone para instalar).
2. Mete el código de acceso.
3. **Compartir** (cuadrado con flecha) → **Añadir a pantalla de inicio** → Añadir.
4. Abre la app desde el icono: va a pantalla completa, sin barras de Safari.
5. Gira el móvil en horizontal y toca la pantalla. Te pedirá **acceso al movimiento**: dale a **Permitir** (es para conducir inclinando el móvil).
   - Si lo deniegas, se conduce con botones ◀ ▶. Para volver al giroscopio: Pausa → Móvil → Dirección → Giroscopio (vuelve a preguntar). Si iOS ya no pregunta, cierra la app del todo y ábrela de nuevo; como último recurso, Ajustes → Safari → Avanzado → Datos de sitios web → borra los de github.io.
6. Quita el **modo silencio** (el interruptor lateral) si quieres oír el motor.

### Android
1. Abre el enlace en **Chrome** y mete el código.
2. Menú ⋮ → **Instalar app** (o **Añadir a pantalla de inicio**).
3. Ábrela desde el icono, en horizontal, y toca para empezar.

### Conducir en el móvil (estilo FR Legends)
- **Dirección:** botones **◀ ▶** a la izquierda. Si prefieres inclinar el móvil como un volante: Pausa → Móvil → Dirección → Giroscopio (±60° = tope, **◎** recentra).
- **GAS**, **FRENO** y **FRENO DE MANO** a la derecha. Pulsar es casi pedal a fondo; solo la parte baja de la zona dosifica.
- **Ayuda al derrape (100 % en móvil):** entra con freno de mano + ◀ o ▶ y **mantén el gas**: el coche sujeta solo unos 45° y la velocidad, y el contravolante es automático. Los botones ajustan el ángulo: hacia dentro de la curva, más ángulo; hacia fuera, menos o cambio de lado. Se regula en Pausa (0 % = física pura).
- Caja automática por defecto (en Pausa puedes poner botones + / −). Mantén el freno parado para marcha atrás.
- Arriba: pausa ❚❚, ayuda ?, cámara 📷, recolocar ↺.

### PC
Recomendado **Chrome o Edge**.
- **Teclado:** WASD o flechas, Espacio freno de mano, Shift embrague, E/Q cambiar (pasa a manual), C cámara, R recolocar, H ayuda, Esc pausa. En Pausa puedes activar la **dirección con ratón** (clic izquierdo gas, derecho freno).
- **Mando (Xbox, PlayStation o genérico):** conéctalo por USB o Bluetooth y **pulsa un botón** con la página abierta para que el navegador lo vea. Stick izquierdo dirección, R2/RT gas, L2/LT freno, ✕/A freno de mano, □/X embrague, R1/L1 marchas, △/Y cámara, ○/B recolocar, Options/Menu pausa, Create/View ayuda.
- **Volante (Logitech, Thrustmaster, Fanatec, Moza…):**
  1. Instala el software del fabricante (G Hub, Thrustmaster, Fanalab, Moza Pit House) y deja el volante en modo PC.
  2. Conéctalo y gira el volante o pulsa un botón con la página abierta.
  3. Se abre la pantalla de **asignación**: sigue las instrucciones (mueve o pulsa cada control). La palanca H puede ser otro USB distinto; también funciona.
  4. En Pausa → «Calibrar ejes» ajustas centro, reposo, fondo e inversión de cada eje, y en Controles el rango de giro.
  - El navegador **no puede mover el motor del volante** (sin force feedback). Si quieres que vuelva al centro, activa un muelle de centrado en el software del fabricante.
  - Por defecto la palanca H exige embrague (se puede desactivar en Pausa).

### Cosas del juego
- **Puntos:** ángulo × velocidad × tiempo, con multiplicador que sube mientras dura el combo. Bonus por **transiciones** (cambiar de lado) y por **clipping** (pasar cerca de los pivotes o de las marcas amarillas y rojas).
- **Pierdes el combo** con un trompo, un golpe contra muro, bloque o farola, o al recolocar. Los conos se pueden tumbar sin perderlo. Ir recto más de 1 s guarda el combo.
- **Zonas:** libre, pivotes, carriles y gymkhana. Récord por zona. Pausa → «Ir a zona».
- **Pausa:** autocontravolante por dispositivo (volante 0 %, mando y teclado 60 %, móvil 70 %), caja, sensibilidades, calidad gráfica, volumen y reglaje en vivo (potencia, diferencial, ángulo de dirección, agarre, reparto de frenada).

---

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173  (añade ?touch para ver la interfaz de móvil en el PC)
npm run build      # typecheck + build en dist/ (genera también dist/sw.js)
npm run sim        # pruebas de física sin gráficos
npx tsx scripts/bot.ts 0.6 40    # piloto automático: ¿se sostiene un derrape a 40° con un 60 % de ayuda?
node scripts/make-icons.mjs      # regenera los iconos de la PWA
```

| Qué | Dónde |
|---|---|
| Datos del coche (todo lo que usa la física) | `src/data/e30.ts` |
| Física del coche (240 Hz, neumático, embrague, diferencial) | `src/physics/` |
| Puntuación | `src/game/scoring.ts` |
| Explanada: zonas, obstáculos, pintura, clips | `src/world/layout.ts` |
| Obstáculos (Rapier) y colisiones del coche | `src/world/track.ts` |
| Modelo del E30 (sustituible por un glTF vía `CarVisual`) | `src/render/e30Model.ts`, `src/render/carView.ts` |
| Entrada: teclado, mando, volante, táctil y giroscopio | `src/input/` |
| Force feedback (interfaz vacía para una futura versión de escritorio) | `src/input/ffb.ts` |
| PWA: manifest, iconos y service worker | `public/`, `src/pwa/sw-template.js`, `vite.config.ts` |

## Despliegue

Cada push a `main` compila con Vite y publica en GitHub Pages (`.github/workflows/deploy.yml`). `base: './'`, así que funciona con cualquier nombre de repo. El service worker precachea la build entera (el juego funciona sin conexión tras la primera carga) y sirve el HTML desde la red primero, de modo que una versión nueva aparece al volver a abrir la app con conexión.

## Privacidad: léelo

- El repositorio es **público** (Pages gratis lo exige). Cualquiera que lo encuentre puede leer el código.
- `noindex` y `robots.txt` piden a los buscadores que no lo indexen, pero no lo impiden.
- El **código de acceso es un filtro, no seguridad**: se compara un hash SHA-256 en el cliente y el hash está en el bundle. Saltárselo es trivial. Sirve solo para que no entre cualquiera por casualidad.
- Para cambiar el código, calcula `sha256('kansei-lot:' + código_en_minúsculas)` y sustituye `HASH` en `src/ui/gate.ts`.
