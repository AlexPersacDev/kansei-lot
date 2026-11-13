# Kansei Lot

Prototipo de drift en el navegador (three.js + física propia). Coche: E30 316i coupé poco modificado. Pista: explanada de 600 × 600 m.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + build en dist/
npm run sim        # pruebas de física sin gráficos (aceleración, frenada, giro)
npx tsx scripts/bot.ts 0.6 40   # piloto automático: ¿se sostiene un derrape a 40° con un 60 % de ayuda?
```

- Datos del coche: `src/data/e30.ts` (nada está fijado en el código de la física).
- Física: `src/physics/` a 240 Hz, desacoplada del render.
- Modelo visual: `src/render/carView.ts`, detrás de la interfaz `CarVisual` para poder sustituirlo por un glTF.

## Despliegue

Cada push a `main` compila con Vite y publica en GitHub Pages (`.github/workflows/deploy.yml`). `base: './'` en Vite, así que funciona con cualquier nombre de repo.

## Privacidad: léelo

- El repositorio es **público** (Pages gratis lo exige). Cualquiera que lo encuentre puede leer el código.
- `noindex` y `robots.txt` piden a los buscadores que no lo indexen, pero no lo impiden.
- El **código de acceso es un filtro, no seguridad**: se compara un hash SHA-256 en el cliente y el hash está en el bundle. Saltárselo es trivial. Sirve solo para que no entre cualquiera por casualidad.
- Para cambiar el código, calcula `sha256('kansei-lot:' + código_en_minúsculas)` y sustituye `HASH` en `src/ui/gate.ts`.
