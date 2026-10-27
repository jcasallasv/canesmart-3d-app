# CaneSmart MR — Simulación de marcha y monitorización biomédica (Meta Quest WebXR)

Aplicación web en **3D / Realidad Mixta** del bastón inteligente **CaneSmart**, modelado a escala real (`1:1`, `0.88 m`) a partir del plano técnico adjunto.

La app arranca en **Modo juego**, que muestra **solo los datos importantes**; el botón `🔬 Modo técnico` abre la telemetría completa (mapa de calor 6×FSR, osciloscopios, calibración de sensores y planos).

---

## 1. Modo juego: caminar por la habitación y medir signos vitales

**Objetivo:** camina con el bastón por la habitación, encuentra a la persona y apunta el radar de 60 GHz a su tórax para medir **FC (ritmo cardíaco)** y **FR (frecuencia respiratoria)** en tiempo real.

### Qué se ve en pantalla

| Elemento | Qué muestra |
|---|---|
| **Banner superior de presencia** | `BUSCANDO PRESENCIA HUMANA` → `PRESENCIA HUMANA DETECTADA` (≤ 2.75 m y ±55°) → `MIDIENDO SIGNOS VITALES` (≤ 2.40 m y ±30°), con la distancia real en metros. |
| **PRESIÓN EN EL BASTÓN** | Fuerza total de los **6 sensores FSR** de la empuñadura (N y kg), barra de presión con escala térmica, **celda de carga axial** con el peso que soporta el bastón y el **pico de la sesión**. |
| **RITMO CARDÍACO / FRECUENCIA RESPIRATORIA** | Cifras grandes de **BPM** y **RPM** con esparcograma en vivo, calidad de la medición y `SNR` del radar. Cuando no hay enganche muestran `--`. |
| **MAPA DE LA HABITACIÓN** | Vista cenital 5.2 × 4.4 m con muros, puerta y mobiliario; tu posición (flecha `TÚ` con orientación), el bastón, el rastro del recorrido, el cono del radar y la persona **solo cuando el radar la detecta** (si se pierde queda un `?` en la última posición conocida). También marca el `SOS` si el bastón cae. |
| **Estadísticas de marcha** | Pasos, distancia recorrida y cadencia (ppm) en tiempo real. |

### Cómo moverse

- **Teclado:** `W A S D` o flechas para caminar, `Shift` para correr. El bastón va en tu mano derecha, apuntando hacia donde caminas.
- **Ratón:** arrastra para mirar alrededor; **quieto**, el bastón apunta hacia donde mira la cámara (así apuntas el radar).
- **Táctil / móvil:** joystick en la esquina inferior izquierda.
- **Botones:** `🚶 Caminar automático` (patrulla la habitación sola), `👤 Mover persona` (la cambia de sitio), `⚠ Caída SOS`, `↻ Recoger bastón`.
- **Meta Quest:** al entrar en **Passthrough MR**, tú caminas físicamente y tu posición real se refleja en el mapa (WebXR `local-floor`).

### Interacciones 3D

- **Arrastra la empuñadura hacia abajo** → presión real (FSR + celda de carga), mapa de calor y vibración háptica en los mandos de Quest.
- **Arrástrala de lado y suéltala (> 43°)** → el bastón cae con física real, suena la alarma y se despliega el **holograma GPS 3D** en el punto exacto de la caída.
- **Haz clic en la persona** → se reubica en otro punto de la habitación (hay que volver a encontrarla).

### Señales fisiológicas

La persona en la habitación late y respira de verdad: pulmones y corazón animados sincronizados con la **FR** y **FC** elegidas (`Reposo 72/15`, `Marcha 104/22`, `Taquicardia 138/28`, `Bradipnea 56/10` en modo técnico). Solo se miden cuando el haz de 60 GHz está correctamente alineado y a menos de 2.40 m; la calidad depende de la distancia y del ángulo (ecuación de radar + patrón de antena).

---

## 2. Modo técnico

- Mapa de calor de las **6 zonas FSR** sobre la empuñadura 3D y huella del **centro de presión (CoP)** de la base cuádruple.
- Tres osciloscopios: celda de carga + agarre, onda de fase torácica 60 GHz (`Δφ(t)`) y aceleración IMU.
- Ajuste fino de presión manual, inclinación, perfiles de agarre, perfil fisiológico y distancia del usuario virtual.
- Coordenadas GNSS/DMS, botón de GPS real y plano original para comparar con el gemelo digital.

---

## 3. Ejecución local

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/
```

## 4. Meta Quest (Passthrough)

1. Abre la URL `https://` del despliegue en **Meta Quest Browser**.
2. Pulsa `🥽 Meta Quest MR (Passthrough)`: el fondo se vuelve transparente y el bastón aparece a escala real en tu suelo.
3. Con los mandos Touch o las manos: acerca la mano a la empuñadura y usa **Grip + Gatillo** para presionar, inclinar o soltar el bastón; camina físicamente para moverte por la habitación del mapa.
