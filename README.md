# CaneSmart MR — Simulador Biomédico de Realidad Mixta (Meta Quest WebXR)

Gemelo digital interactivo en **3D y Realidad Mixta (WebXR `immersive-ar` Passthrough)** del bastón inteligente **CaneSmart**, modelado a escala métrica real (`1:1`, `0.88 m` de altura) a partir del plano técnico original adjunto.

---

## Características Principales

1. **Modelo 3D Fiel al Diseño CaneSmart (`CaneSmartModel.js`)**
   - Empuñadura ergonómica curva de 5 segmentos acanalados con doble collar de transición, silla palmar en `T`, ventana OLED lateral en tiempo real y radomo frontal biselado de `60 GHz`.
   - Tubo vertical anodizado con doble botón físico interactivo en el eje superior.
   - Celda de carga axial integrada en el cuello inferior y base cuádruple articulada (`Quad-Pod`) con 4 apoyos elastoméricos independientes.

2. **Biomecánica en Tiempo Real: Matriz 6×FSR + Celda de Carga (`BiomechanicalEngine.js`)**
   - **6 zonas FSR** distribuidas a lo largo del arco curvo, silla palmar y apoyo anterior con mapa de calor térmico continuo (`0 N` azul cobalto → cian → verde esmeralda → amarillo → naranja → rojo crítico).
   - **Celda de Carga Axial (`0 – 450 N`)** con deflexión elástica real, cálculo dinámico del **Centro de Presión (`CoP`)** sobre las 4 patas y flecha vectorial 3D de fuerza de reacción del suelo (`GRF`).
   - Simulador automático de **Ciclo de Marcha Asistida** (fase de balanceo + curva bimodal `M` de apoyo plantar).

3. **Radar mmWave FMCW de 60 GHz (`λ = 5.0 mm`) y Usuario Virtual (`VirtualPatientAndRadar.js`)**
   - Cono volumétrico de radiación con inclinación de antena (`+21.5°`), frentes de onda `Tx` animados, ondas transversales ortogonales **Campo E / Campo H** y ecos reflejados por efecto Doppler desde el esternón.
   - Avatar anatómico holográfico con pulmones animados a la **Frecuencia Respiratoria (`RPM`)** y corazón latiendo a la **Frecuencia Cardíaca (`BPM`)**, con cálculo real de relación señal-ruido (`SNR dB`) según distancia y ángulo.

4. **Detección Física de Caída, Alarma Sonora Espacial 3D y Baliza GPS 3D (`FallGpsHologram.js` + `SpatialBioAudio.js`)**
   - Caída física por gravedad rotacional al inclinar y soltar el bastón (`> 43°`) o mediante botón de prueba SOS, con rebote e impacto IMU (`> 3.5 g`).
   - **Audio Espacial 3D (`HRTF` Web Audio API)**: golpe mecánico contra el suelo, alarma médica de alta prioridad `IEC 60601-1-8` y alerta hablada en español.
   - **Despliegue Holográfico GPS en el Espacio 3D**: ondas de choque en el suelo, rosa náutica, pilar láser SOS, constelación orbital de satélites GNSS con líneas de triangulación y tarjeta holográfica 3D flotante con coordenadas `Lat / Lon / DMS / Altitud` (compatible con `navigator.geolocation` en vivo).

---

## Uso en Gafas Meta Quest (Quest 2 / Quest Pro / Quest 3 / Quest 3S)

1. Abre **Meta Quest Browser** en las gafas y navega a la URL `https://` de la vista previa (o de tu despliegue HTTPS).
2. Pulsa **`🥽 Meta Quest MR (Passthrough)`** en la barra superior.
3. El fondo se vuelve transparente mostrando tu **entorno físico real** y el bastón CaneSmart se ancla a escala `1:1` sobre el suelo real mediante `WebXR Hit-Test` + `local-floor`.
4. **Interacción con Controles Touch / Seguimiento de Manos**:
   - Acerca la mano o el control a la empuñadura y mantén **Grip (`Squeeze`) / Gatillo (`Trigger`)** para sujetar el bastón, ejercer presión analógica (con respuesta háptica proporcional), inclinarlo o apuntar el haz de `60 GHz`.
   - Inclínalo más de `43°` y suéltalo para disparar la caída en tu habitación real junto con el holograma GPS 3D.
   - Apunta con el rayo láser al panel espacial 3D o a la tarjeta GPS para restablecer el bastón o cambiar modos.

## Ejecución Local

```bash
npm install
npm run dev
```
