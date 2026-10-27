# CaneSmart MR — Diagnóstico y despliegue en GitHub Pages

## 1. Qué debería aparecer cuando carga bien

Al abrir la página **no** debe verse una página de texto con deslizadores. Debe aparecer una **escena 3D a pantalla completa** (fondo azul-noche con cuadrícula espacial) con:

- El **bastón CaneSmart de 88 cm** de pie en el centro, con empuñadura curva, pantalla OLED lateral encendida y base de 4 patas.
- Un **haz cónico de radar 60 GHz** saliendo del radomo frontal hacia un **avatar humanoide translúcido** (pulmones y corazón animados).
- **Paneles holográficos 3D flotantes** con líneas guía y cifras de FSR / celda de carga / BPM / RPM.
- Arriba: la barra **Horizon-OS**. Izquierda y derecha: los paneles de control y los 3 osciloscopios en vivo (curvas que se mueven).
- Al **arrastrar la empuñadura hacia abajo** el mapa de calor cambia de azul a rojo; al **arrastrarla de lado y soltarla** el bastón cae, suena una alarma y se despliega el **holograma GPS 3D** (ondas en el piso, pilar SOS y satélites).

Si solo ves textos, sliders y casillas, **el motor 3D no llegó a arrancar**.

---

## 2. Qué estaba pasando (causa exacta)

GitHub Pages estaba sirviendo el **código fuente sin compilar**. En ese modo el navegador recibe `src/main.js` tal cual, y su primera línea es:

```js
import * as THREE from 'three';
```

`'three'` es un *bare specifier*: el navegador **no sabe** a qué archivo corresponde (esa resolución la hace Vite o Node, no el navegador). Resultado: el módulo entero se aborta con

```
Uncaught TypeError: Failed to resolve module specifier "three".
```

Como el error ocurre en la primera línea del módulo, **nada de JavaScript se ejecuta**: no se crea el `<canvas>` WebGL, no se genera ningún objeto 3D. Solo queda el HTML y el CSS (que sí cargaban, por eso veías los paneles con estilo y los valores regulables). Esto también explica que los sliders "funcionaran" visualmente pero no movieran ninguna cifra.

---

## 3. Correcciones ya aplicadas en el proyecto

| Archivo | Cambio | Para qué |
|---|---|---|
| `index.html` | Se añadió un **`<script type="importmap">`** que mapea `three` y `three/examples/jsm/` al CDN de jsDelivr (v0.170.0). | El navegador ya resuelve `'three'` sin necesidad de compilar → la app corre directamente como sitio estático. |
| `index.html` | Rutas **relativas** (`./src/styles.css`, `./src/main.js`) y `<img onerror>` con respaldo. | Funciona tanto en la raíz como en el subdirectorio `/canesmart-3d-app/` de Pages. |
| `index.html` | Nuevo **overlay de arranque** + vigilante de errores en español. | Si algo vuelve a fallar, la propia página muestra el mensaje exacto en vez de quedarse en blanco. |
| `vite.config.js` | `base: './'`. | Que el `dist/` compilado también funcione bajo cualquier subruta. |
| `.github/workflows/deploy.yml` | Workflow de GitHub Actions que compila y publica `dist/`. | Alternativa recomendada: sitio ya empaquetado (sin CDN). |

---

## 4. Cómo publicarlo (elige UNA opción)

### Opción A — Rápida (sirve el código fuente, ya funciona con el importmap)

Desde la carpeta del proyecto:

```bash
git add index.html src/styles.css src/main.js vite.config.js .nojekyll public/.nojekyll
git commit -m "fix(webxr): importmap de Three.js + rutas relativas + overlay de diagnostico para GitHub Pages"
git push
```

Espera 1–2 minutos al build de Pages y abre `https://jcasallasv.github.io/canesmart-3d-app/` con **recarga forzada** (`Ctrl + Shift + R`, o en el celular/Quest cerrar y reabrir la pestaña).

> Requisito: en **Settings → Pages** la fuente debe ser **Deploy from a branch → `main` → `/ (root)`**.

### Opción B — Recomendada (compilado, sin depender del CDN)

```bash
git add . && git commit -m "build: despliegue con GitHub Actions" && git push
```

Luego en **Settings → Pages → Build and deployment → Source: `GitHub Actions`**. El workflow `Deploy CaneSmart MR (WebXR) a GitHub Pages` compila con Vite y publica `dist/`.

---

## 5. Verificación rápida tras el despliegue

1. La página muestra durante 1–2 s el mensaje **“Inicializando gemelo digital 3D…”** y luego desaparece.
2. Aparece la escena 3D con el bastón girando sobre la cuadrícula.
3. Los osciloscopios de la derecha dibujan curvas en movimiento (no líneas planas).
4. Al mover **Presión Agarre Empuñadura** cambia la cifra KPI y el mapa de calor de la empuñadura.
5. **Consola (F12)**: no debe aparecer ningún error rojo de tipo *module specifier*.

---

## 6. En Meta Quest (Realidad Mixta real)

1. Abre **Meta Quest Browser** dentro de las gafas y entra a la URL `https://jcasallasv.github.io/canesmart-3d-app/`.
2. Pulsa **`🥽 Meta Quest MR (Passthrough)`**. La cuadrícula de estudio desaparece y verás tu **habitación real** con el bastón anclado a escala 1:1 sobre tu suelo (`WebXR Hit-Test` + `local-floor`).
3. Acerca el control Touch o tu mano a la empuñadura y usa **Grip + Gatillo** para agarrarlo, presionarlo (vibración háptica proporcional), inclinarlo o soltarlo y disparar la caída con su baliza GPS 3D en tu propio espacio.
4. Si el botón MR mostrara un aviso, es porque ese navegador no expone `immersive-ar` (en PC/escritorio es normal): ahí usa **`📷 Webcam AR`** o la vista 3D normal.
