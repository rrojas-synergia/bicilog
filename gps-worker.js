// gps-worker.js - Web Worker para procesamiento de GPS y detección de subidas (ClimbPro)

// --- CLASES Y ALGORITMOS DE FILTRADO ---

// Filtro de Kalman 1D para coordenadas y altitud
class KalmanFilter {
  constructor(r = 0.0001, q = 0.00001) {
    this.R = r; // Ruido de medición
    this.Q = q; // Ruido de proceso
    this.x = null; // Estimado
    this.P = 1.0;  // Covarianza del error
  }

  filter(measurement) {
    if (this.x === null) {
      this.x = measurement;
      return measurement;
    }
    // Predicción
    this.P = this.P + this.Q;
    // Actualización
    const K = this.P / (this.P + this.R); // Ganancia de Kalman
    this.x = this.x + K * (measurement - this.x);
    this.P = (1 - K) * this.P;
    return this.x;
  }
}

// Inicializar filtros de Kalman para Latitud, Longitud y Altitud
const latFilter = new KalmanFilter(0.00005, 0.000005);
const lonFilter = new KalmanFilter(0.00005, 0.000005);
const altFilter = new KalmanFilter(3.0, 0.1); // Mayor tolerancia al ruido de altitud GPS

// --- ALMACENAMIENTO DE HISTORIAL EN TRABAJO ---
let gpsPoints = []; // Historial de puntos limpios {lat, lon, alt, timestamp, distance, speed, grade, power}
let totalDistance = 0; // en KM
let totalAscent = 0; // en metros
let altitudeHistory = []; // Para media móvil de altitud

// Warm-up: Los primeros 3 puntos consecutivos válidos deben pasar el filtro de
// velocidad física entre sí antes de encender los Kalman y acumular distancia.
const WARMUP_QUEUE = [];
const WARMUP_SIZE = 3;

// Configuración de la bicicleta y ciclista (valores por defecto)
let riderWeight = 70; // kg
let bikeWeight = 10;  // kg
const GRAVITY = 9.81;
const CR_ROLLING = 0.004; // Coeficiente de rodadura promedio
const CDA_AERO = 0.32;    // Resistencia aerodinámica promedio (Cd * Area)
const AIR_DENSITY = 1.225; // kg/m³

// --- ALGORITMO DE DETECCIÓN DE SUBIDAS (ClimbPro) ---
let activeClimb = null; // { startIdx, distance, ascent, avgGrade, score, points }
let slidingWindow = []; // Ventana deslizante de coordenadas para detectar subida

// Evaluar e identificar subidas (ClimbPro)
function evaluateClimbPro(newPoint, index) {
  // Mantener ventana de los últimos 500m de trayecto
  slidingWindow.push({ point: newPoint, idx: index });
  
  // Limpiar ventana para mantener solo los últimos 600m
  while (slidingWindow.length > 1 && (newPoint.distance - slidingWindow[0].point.distance) > 0.6) {
    slidingWindow.shift();
  }

  if (slidingWindow.length < 2) return null;

  const firstInWindow = slidingWindow[0].point;
  const distDiff = (newPoint.distance - firstInWindow.distance) * 1000; // en metros
  const altDiff = newPoint.alt - firstInWindow.alt; // en metros
  const grade = distDiff > 50 ? (altDiff / distDiff) * 100 : 0; // pendiente %

  // Si no hay subida activa y detectamos pendiente positiva considerable en la ventana
  if (!activeClimb) {
    if (distDiff >= 200 && grade >= 3.5) {
      // Iniciar potencial subida
      activeClimb = {
        startIdx: firstInWindow.idx || 0,
        startIndexInHistory: firstInWindow.idx,
        distance: distDiff, // m
        ascent: altDiff > 0 ? altDiff : 0, // m
        avgGrade: grade,
        score: distDiff * Math.max(0, grade),
        isActive: false // Aún no califica para ClimbPro
      };
    }
  } else {
    // Si ya hay una subida potencial/activa, actualizar sus métricas
    const startPoint = gpsPoints[activeClimb.startIndexInHistory];
    const totalClimbDist = (newPoint.distance - startPoint.distance) * 1000; // en metros
    const totalClimbAscent = newPoint.alt - startPoint.alt; // en metros
    const totalClimbGrade = totalClimbDist > 0 ? (totalClimbAscent / totalClimbDist) * 100 : 0;
    const score = totalClimbDist * Math.max(0, totalClimbGrade);

    activeClimb.distance = totalClimbDist;
    activeClimb.ascent = totalClimbAscent;
    activeClimb.avgGrade = totalClimbGrade;
    activeClimb.score = score;

    // Reglas de activación para ClimbPro:
    // 1. Distancia >= 500m
    // 2. Pendiente media >= 3%
    // 3. Score >= 1500
    if (totalClimbDist >= 500 && totalClimbGrade >= 3.0 && score >= 1500) {
      activeClimb.isActive = true;
    }

    // Cancelar subida si empezamos a bajar significativamente
    // (Ej. perdemos más del 20% del ascenso acumulado o la pendiente en los últimos 200m es < -2%)
    if (distDiff >= 200 && grade < -1.5 && totalClimbDist > 300) {
      if (activeClimb.isActive) {
        // Guardar subida completada si califica, y resetear
        activeClimb = null;
      } else {
        activeClimb = null; // Se desinfló la potencial subida
      }
    }
  }

  // Si la subida está activa, colorear los micro-segmentos de 100m
  if (activeClimb && activeClimb.isActive) {
    const startPoint = gpsPoints[activeClimb.startIndexInHistory];
    const segments = [];
    const segmentLength = 100; // metros
    const numSegments = Math.ceil(activeClimb.distance / segmentLength);

    for (let i = 0; i < numSegments; i++) {
      const segStartDist = startPoint.distance + (i * segmentLength) / 1000;
      const segEndDist = Math.min(newPoint.distance, startPoint.distance + ((i + 1) * segmentLength) / 1000);
      
      // Buscar puntos de GPS que correspondan a este tramo
      const segPoints = gpsPoints.filter(p => p.distance >= segStartDist && p.distance <= segEndDist);
      
      if (segPoints.length >= 2) {
        const p1 = segPoints[0];
        const p2 = segPoints[segPoints.length - 1];
        const dDist = (p2.distance - p1.distance) * 1000;
        const dAlt = p2.alt - p1.alt;
        const segGrade = dDist > 10 ? (dAlt / dDist) * 100 : 0;
        
        let color = '#1DD1A1'; // 0-3%: Verde (Suave)
        if (segGrade >= 3 && segGrade < 6) color = '#FECA57'; // 3-6%: Amarillo
        else if (segGrade >= 6 && segGrade < 9) color = '#FF9F43'; // 6-9%: Naranja
        else if (segGrade >= 9) color = '#FF6B6B'; // >9%: Rojo/Negro

        segments.push({
          index: i,
          grade: segGrade,
          color: color
        });
      }
    }
    
    return {
      active: true,
      distance: activeClimb.distance,
      ascent: activeClimb.ascent,
      avgGrade: activeClimb.avgGrade,
      score: activeClimb.score,
      segments: segments
    };
  }

  return null;
}

// --- FÓRMULA DE POTENCIA ESTIMADA (Watts) ---
function estimatePower(speedKmh, gradePercent) {
  const speedMs = speedKmh / 3.6;
  if (speedMs < 0.5) return 0; // Detenido

  const totalMass = riderWeight + bikeWeight;
  const angleRad = Math.atan(gradePercent / 100);

  // 1. Fuerza de Gravedad
  const fGravity = totalMass * GRAVITY * Math.sin(angleRad);
  
  // 2. Fuerza de Rodadura
  const fRolling = totalMass * GRAVITY * Math.cos(angleRad) * CR_ROLLING;

  // 3. Fuerza de Resistencia Aerodinámica
  const fDrag = 0.5 * CDA_AERO * AIR_DENSITY * Math.pow(speedMs, 2);

  // Potencia total mecánica necesaria
  const totalForce = fGravity + fRolling + fDrag;
  let powerWatts = totalForce * speedMs;

  // Si va de bajada, la gravedad ayuda y puede dar fuerza negativa. Limitamos potencia mínima a 0.
  if (powerWatts < 0) powerWatts = 0;

  // Asumir eficiencia de transmisión del 95%
  return Math.round(powerWatts / 0.95);
}

// --- ALGORITMO DE DOUGLAS-PEUCKER (Simplificación geométrica de ruta) ---
function getSqDist(p1, p2) {
  const dx = p1.lat - p2.lat;
  const dy = p1.lon - p2.lon;
  return dx * dx + dy * dy;
}

function getSqSegDist(p, p1, p2) {
  let x = p1.lat;
  let y = p1.lon;
  let dx = p2.lat - x;
  let dy = p2.lon - y;

  if (dx !== 0 || dy !== 0) {
    let t = ((p.lat - x) * dx + (p.lon - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2.lat;
      y = p2.lon;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p.lat - x;
  dy = p.lon - y;
  return dx * dx + dy * dy;
}

function douglasPeucker(points, sqTolerance) {
  const len = points.length;
  if (len <= 2) return points;

  const markers = new Uint8Array(len);
  let first = 0;
  let last = len - 1;
  let stack = [];
  let keepPoints = [];

  markers[first] = markers[last] = 1;

  while (last !== undefined) {
    let maxSqDist = 0;
    let index;

    for (let i = first + 1; i < last; i++) {
      let sqDist = getSqSegDist(points[i], points[first], points[last]);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }

    if (maxSqDist > sqTolerance) {
      markers[index] = 1;
      stack.push(first, index, index, last);
    }

    last = stack.pop();
    first = stack.pop();
  }

  for (let i = 0; i < len; i++) {
    if (markers[i]) {
      keepPoints.push(points[i]);
    }
  }

  return keepPoints;
}

// --- ESCUCHAR MENSAJES DEL HILO PRINCIPAL ---
self.onmessage = function (e) {
  const { type, data } = e.data;

  if (type === 'CONFIGURE') {
    // Configurar pesos
    riderWeight = data.riderWeight || 70;
    bikeWeight = data.bikeWeight || 10;
    console.log(`[Worker] Configurado: Peso ciclista = ${riderWeight}kg, Bicicleta = ${bikeWeight}kg`);
  } 
  
  else if (type === 'RESET') {
    gpsPoints = [];
    totalDistance = 0;
    totalAscent = 0;
    altitudeHistory = [];
    activeClimb = null;
    slidingWindow = [];
    WARMUP_QUEUE.length = 0;
    latFilter.x = null;
    lonFilter.x = null;
    altFilter.x = null;
  } 
  
  else if (type === 'GPS_RAW') {
    const { lat, lon, alt, speed: rawSpeed, timestamp, accuracy } = data;

    // --- WARM-UP: validar los primeros 3 puntos antes de encender la lógica ---
    if (WARMUP_QUEUE.length < WARMUP_SIZE) {
      if (accuracy !== undefined && accuracy !== null && accuracy > 20) {
        console.warn(`[Worker Warmup] Punto descartado por precisión (${accuracy.toFixed(0)}m). Reiniciando warm-up.`);
        WARMUP_QUEUE.length = 0;
        return;
      }
      WARMUP_QUEUE.push({ lat, lon, alt, timestamp });
      if (WARMUP_QUEUE.length === WARMUP_SIZE) {
        // Validar que los 3 puntos no tengan saltos entre sí
        let warmupOk = true;
        for (let i = 1; i < WARMUP_QUEUE.length; i++) {
          const prev = WARMUP_QUEUE[i - 1];
          const curr = WARMUP_QUEUE[i];
          const timeDiff = (curr.timestamp - prev.timestamp) / 1000;
          if (timeDiff <= 0) { warmupOk = false; break; }
          const R = 6371;
          const dLat = (curr.lat - prev.lat) * Math.PI / 180;
          const dLon = (curr.lon - prev.lon) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 +
                    Math.cos(prev.lat * Math.PI / 180) * Math.cos(curr.lat * Math.PI / 180) *
                    Math.sin(dLon / 2) ** 2;
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distKm = R * c;
          const impSpeed = (distKm * 3600) / timeDiff;
          if (impSpeed > 120) { warmupOk = false; break; }
        }
        if (!warmupOk) {
          console.warn('[Worker Warmup] Salto detectado en fase warm-up. Reiniciando buffer.');
          WARMUP_QUEUE.length = 0;
        } else {
          console.log('[Worker Warmup] Warm-up exitoso. Iniciando tracking GPS con filtros Kalman.');
          for (const pt of WARMUP_QUEUE) {
            latFilter.filter(pt.lat);
            lonFilter.filter(pt.lon);
            if (pt.alt !== null) { altFilter.filter(pt.alt); altitudeHistory.push(pt.alt); }
            gpsPoints.push({ lat: pt.lat, lon: pt.lon, alt: pt.alt, timestamp: pt.timestamp, distance: 0, speed: 0, grade: 0, power: 0, idx: gpsPoints.length });
          }
        }
      }
      return;
    }

    // --- FILTROS ESTRICTOS (post warm-up) ---
    // Filtro 1: Precisión
    if (accuracy !== undefined && accuracy !== null && accuracy > 20) {
      console.warn(`[Worker] Coordenada descartada por baja precisión (${accuracy.toFixed(1)}m > 20m)`);
      return;
    }

    // Filtro 2: Velocidad implícita > 120 km/h (salto de torre/IP)
    if (gpsPoints.length > 0) {
      const lastPoint = gpsPoints[gpsPoints.length - 1];
      const timeDiff = (timestamp - lastPoint.timestamp) / 1000; // segundos
      
      if (timeDiff > 0) {
        const R = 6371; // Radio de la Tierra en km
        const dLat = (lat - lastPoint.lat) * Math.PI / 180;
        const dLon = (lon - lastPoint.lon) * Math.PI / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lastPoint.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const rawDist = R * c; // distancia en km
        const implicitSpeed = (rawDist * 3600) / timeDiff; // velocidad implícita en km/h

        if (implicitSpeed > 120) {
          console.warn(`[Worker] Coordenada descartada por salto GPS de velocidad física imposible: ${implicitSpeed.toFixed(1)} km/h`);
          return;
        }
      }
    }

    // 1. Limpieza de datos (Filtro de Kalman)
    const filteredLat = latFilter.filter(lat);
    const filteredLon = lonFilter.filter(lon);

    // 2. Filtro de Media Móvil de Altitud (Suavizado de altimetría)
    let filteredAlt = alt;
    if (alt !== null) {
      const kalmanAlt = altFilter.filter(alt);
      altitudeHistory.push(kalmanAlt);
      if (altitudeHistory.length > 5) {
        altitudeHistory.shift(); // Ventana de 5 puntos
      }
      filteredAlt = altitudeHistory.reduce((a, b) => a + b, 0) / altitudeHistory.length;
    }

    // Priorizar velocidad del GPS nativo si está disponible (convertida de m/s a km/h)
    let calculatedSpeed = 0;
    const hasRawSpeed = (rawSpeed !== null && rawSpeed !== undefined && rawSpeed >= 0);
    if (hasRawSpeed) {
      calculatedSpeed = rawSpeed * 3.6;
    }

    let pointDistance = 0;

    // 3. Calcular distancia y velocidad basadas en filtro de Kalman
    if (gpsPoints.length > 0) {
      const lastPoint = gpsPoints[gpsPoints.length - 1];
      
      // Calcular distancia en KM (Fórmula Haversine con coordenadas filtradas)
      const R = 6371; // Radio de la tierra en km
      const dLat = (filteredLat - lastPoint.lat) * Math.PI / 180;
      const dLon = (filteredLon - lastPoint.lon) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lastPoint.lat * Math.PI / 180) * Math.cos(filteredLat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      pointDistance = R * c;

      // Filtro de deriva estática (Jitter filter):
      // Si la distancia es ínfima (< 1.5 metros por segundo) y no hay velocidad real, ignorar cambio
      const timeDiff = (timestamp - lastPoint.timestamp) / 1000; // en segundos
      
      // Umbral de velocidad en ciclismo: ignoramos acumulación si la velocidad calculada es < 1.5 km/h
      const estSpeed = timeDiff > 0 ? (pointDistance * 3600) / timeDiff : 0;
      
      if (estSpeed > 1.5) {
        totalDistance += pointDistance;
        if (!hasRawSpeed) {
          calculatedSpeed = estSpeed;
        }
      } else {
        pointDistance = 0;
        // Si no hay movimiento real estimado y la velocidad GPS nativa es baja/cero, forzar a 0
        if (!hasRawSpeed || calculatedSpeed < 1.5) {
          calculatedSpeed = 0;
        }
      }

      // Calcular Ascenso (desnivel acumulado positivo)
      if (filteredAlt !== null && lastPoint.alt !== null) {
        const altDiff = filteredAlt - lastPoint.alt;
        // Acumular desnivel solo si sube y la velocidad indica movimiento
        if (altDiff > 0.3 && calculatedSpeed > 1.5) {
          totalAscent += altDiff;
        }
      }
    }

    // Calcular pendiente (%) instantánea
    let grade = 0;
    if (gpsPoints.length > 0 && pointDistance > 0) {
      const lastPoint = gpsPoints[gpsPoints.length - 1];
      const deltaD = pointDistance * 1000; // en metros
      const deltaH = filteredAlt - lastPoint.alt;
      grade = (deltaH / deltaD) * 100;
      
      // Limitar pendiente a rangos físicos viables (-25% a 25%)
      grade = Math.max(-25, Math.min(25, grade));
    }

    // 4. Estimación de Potencia (Watts)
    const power = estimatePower(calculatedSpeed, grade);

    // Crear nuevo punto limpio
    const newPoint = {
      lat: filteredLat,
      lon: filteredLon,
      alt: filteredAlt,
      timestamp: timestamp,
      distance: totalDistance, // distancia total acumulada en KM
      speed: calculatedSpeed,   // km/h
      grade: grade,
      power: power,
      idx: gpsPoints.length
    };

    gpsPoints.push(newPoint);

    // 5. Analizar subidas ClimbPro
    const climbInfo = evaluateClimbPro(newPoint, gpsPoints.length - 1);

    // Enviar resultado procesado de vuelta al hilo principal de inmediato
    self.postMessage({
      type: 'GPS_PROCESSED',
      data: {
        lat: filteredLat,
        lon: filteredLon,
        alt: filteredAlt,
        speed: calculatedSpeed,
        distance: totalDistance,
        ascent: totalAscent,
        grade: grade,
        power: power,
        climbInfo: climbInfo
      }
    });
  } 
  
  else if (type === 'EXPORT_GPX') {
    // Reducir vector usando Douglas-Peucker antes de enviar para exportación
    // sqTolerance = 0.00000001 (aproximadamente 10 metros en coordenadas cuadráticas)
    const simplified = douglasPeucker(gpsPoints, 0.00000001);
    self.postMessage({
      type: 'GPX_EXPORT_READY',
      data: simplified
    });
  }
};
