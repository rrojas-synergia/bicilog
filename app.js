// app.js - Orquestador Principal de la Aplicación BiciLog con Telemetría Avanzada

import { Storage } from './storage.js';
import { BiciSensors } from './bluetooth.js';
import { BiciGPS } from './gps.js';
import { BiciCharts } from './charts.js';

// --- ESTADO GLOBAL DE LA APLICACIÓN ---
const AppState = {
  currentScreen: 'dashboard',
  settings: null,
  hrZones: null,
  rides: [],
  selectedRide: null,

  // Mapas Leaflet
  recMap: null,
  recMarker: null,
  recPathLine: null,
  recTargetMarker: null,
  detMap: null,
  detPathLine: null,

  // Datos de la rodada actual
  activeRide: {
    isRecording: false,
    isPaused: false,
    isAutoPaused: false, // Estado de auto-pausa
    autoPauseTicks: 0,   // Contador para detectar inactividad
    timerInterval: null,
    elapsedSeconds: 0,
    distance: 0,
    speed: 0,
    ascent: 0,
    grade: 0,
    power: 0,
    hr: 0,
    cadence: 0,
    respiration: 0,
    temp: 22,
    targetCoords: null, // Destino fijado en el mapa
    
    // Arrays para guardar muestras temporales de la rodada (cada 5s)
    samples: [],
    sampleInterval: null,
    
    // Acumuladores de tiempo en zonas de FC (en segundos)
    zoneTimes: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  },

  // Simulación
  simulation: {
    isActive: false,
    intervalId: null,
    simSpeed: 25.0,
    simHr: 120,
    simCad: 85
  }
};

// --- SELECTORES DOM ---
const DOM = {
  screens: {
    dashboard: document.getElementById('screen-dashboard'),
    recording: document.getElementById('screen-recording'),
    detail: document.getElementById('screen-detail'),
    settings: document.getElementById('screen-settings')
  },
  
  // Dashboard
  statsTotalKm: document.getElementById('stats-total-km'),
  statsTotalTime: document.getElementById('stats-total-time'),
  statsTotalRides: document.getElementById('stats-total-rides'),
  weeklyChart: document.getElementById('weekly-chart-container'),
  recentRidesList: document.getElementById('recent-rides-list'),
  btnStartRide: document.getElementById('btn-start-ride'),
  btnOpenSettings: document.getElementById('btn-open-settings'),

  // Grabación en vivo
  gpsAccuracy: document.getElementById('gps-accuracy-badge'),
  liveStatusBadge: document.getElementById('live-status-badge'),
  btnConnectHr: document.getElementById('btn-connect-hr'),
  btnConnectCsc: document.getElementById('btn-connect-csc'),
  sensorPillHr: document.getElementById('sensor-pill-hr'),
  sensorPillCsc: document.getElementById('sensor-pill-csc'),
  liveSpeed: document.getElementById('live-speed'),
  liveTimer: document.getElementById('live-timer'),
  liveDistance: document.getElementById('live-distance'),
  liveHr: document.getElementById('live-hr'),
  liveHrZone: document.getElementById('live-hr-zone'),
  liveCadence: document.getElementById('live-cadence'),
  liveAscent: document.getElementById('live-ascent'),
  liveWatts: document.getElementById('live-watts'),
  liveGrade: document.getElementById('live-grade'),
  liveRespiration: document.getElementById('live-respiration'),
  liveTemp: document.getElementById('live-temp'),
  chkSimulate: document.getElementById('chk-simulate-data'),
  btnPauseRide: document.getElementById('btn-pause-ride'),
  btnResumeRide: document.getElementById('btn-resume-ride'),
  btnStopRide: document.getElementById('btn-stop-ride'),

  // Map controls
  mapTargetStatus: document.getElementById('map-target-status'),
  mapTargetDistance: document.getElementById('map-target-distance'),
  btnClearTarget: document.getElementById('btn-clear-target'),

  // ClimbPro Widget
  climbproWidget: document.getElementById('climbpro-widget'),
  climbScoreBadge: document.getElementById('climb-score-badge'),
  climbDistLeft: document.getElementById('climb-dist-left'),
  climbAvgGrade: document.getElementById('climb-avg-grade'),
  climbProfileBars: document.getElementById('climb-profile-bars'),

  // Detalle
  detailTitle: document.getElementById('detail-title'),
  detailDate: document.getElementById('detail-date'),
  detailValDistance: document.getElementById('detail-val-distance'),
  detailValTime: document.getElementById('detail-val-time'),
  detailValSpeed: document.getElementById('detail-val-speed'),
  detailValAscent: document.getElementById('detail-val-ascent'),
  detailValHr: document.getElementById('detail-val-hr'),
  detailValCadence: document.getElementById('detail-val-cadence'),
  detailValRespiration: document.getElementById('detail-val-respiration'),
  detailValTemp: document.getElementById('detail-val-temp'),
  detailProfileChart: document.getElementById('detail-ride-profile-chart'),
  detailHrZonesChart: document.getElementById('detail-hr-zones-chart'),
  btnDetailBack: document.getElementById('btn-detail-back'),
  btnDeleteRide: document.getElementById('btn-delete-ride'),

  // Ajustes
  settingsForm: document.getElementById('settings-form'),
  setAge: document.getElementById('set-age'),
  setWeight: document.getElementById('set-weight'),
  setBikeWeight: document.getElementById('set-bike-weight'),
  setAutopause: document.getElementById('set-autopause'),
  setUseAuto: document.getElementById('set-use-auto'),
  manualZonesContainer: document.getElementById('manual-zones-container'),
  autoZonesPreview: document.getElementById('auto-zones-preview'),
  btnSettingsBack: document.getElementById('btn-settings-back'),

  // Recuperación de sesión (Modal)
  sessionRecoveryModal: document.getElementById('session-recovery-modal'),
  recoveryTime: document.getElementById('recovery-time'),
  recoveryDistance: document.getElementById('recovery-distance'),
  btnRecoveryDiscard: document.getElementById('btn-recovery-discard'),
  btnRecoveryResume: document.getElementById('btn-recovery-resume')
};

// --- NAVEGACIÓN SPA ---
function navigateTo(screenId) {
  Object.keys(DOM.screens).forEach(key => {
    DOM.screens[key].classList.remove('active');
  });
  DOM.screens[screenId].classList.add('active');
  AppState.currentScreen = screenId;
  
  // Acciones al abrir pantallas específicas
  if (screenId === 'dashboard') {
    loadDashboardData();
  } else if (screenId === 'settings') {
    loadSettingsScreen();
  }
}

// --- CARGAR DATOS EN PANTALLAS ---

// Cargar Dashboard
function loadDashboardData() {
  AppState.rides = Storage.getRides();
  AppState.settings = Storage.getSettings();
  AppState.hrZones = Storage.getHRZones(AppState.settings);

  // Totales Históricos
  let totalKm = 0;
  let totalSeconds = 0;
  
  AppState.rides.forEach(ride => {
    totalKm += ride.distance || 0;
    totalSeconds += ride.duration || 0;
  });

  DOM.statsTotalKm.textContent = totalKm.toFixed(1);
  DOM.statsTotalTime.textContent = BiciCharts.formatDuration(totalSeconds);
  DOM.statsTotalRides.textContent = AppState.rides.length;

  // Renderizar gráficos
  BiciCharts.renderWeeklySummary('weekly-chart-container', AppState.rides);
  renderRecentRidesList();
}

// Lista de rodadas recientes
function renderRecentRidesList() {
  DOM.recentRidesList.innerHTML = '';
  
  if (AppState.rides.length === 0) {
    DOM.recentRidesList.innerHTML = `
      <div class="empty-state">
        <p>No tienes rodadas registradas. ¡Sal a rodar!</p>
      </div>
    `;
    return;
  }

  AppState.rides.slice(0, 5).forEach(ride => {
    const card = document.createElement('div');
    card.className = 'ride-card';
    
    const date = new Date(ride.timestamp);
    const options = { weekday: 'long', day: 'numeric', month: 'short' };
    const dateStr = date.toLocaleDateString('es-ES', options);
    
    card.innerHTML = `
      <div class="ride-card-left">
        <span class="ride-card-title">${ride.title}</span>
        <span class="ride-card-date">${dateStr}</span>
      </div>
      <div class="ride-card-right">
        <div class="ride-card-metric">
          <span class="val">${ride.distance.toFixed(1)}</span>
          <span class="lbl">Km</span>
        </div>
        <div class="ride-card-metric">
          <span class="val">${BiciCharts.formatDuration(ride.duration)}</span>
          <span class="lbl">Tiempo</span>
        </div>
      </div>
    `;
    
    card.addEventListener('click', () => {
      openRideDetail(ride);
    });
    DOM.recentRidesList.appendChild(card);
  });
}

// Ver Detalle de Rodada
function openRideDetail(ride) {
  AppState.selectedRide = ride;
  
  DOM.detailTitle.textContent = ride.title;
  const date = new Date(ride.timestamp);
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  DOM.detailDate.textContent = date.toLocaleDateString('es-ES', options);

  DOM.detailValDistance.textContent = ride.distance.toFixed(2);
  DOM.detailValTime.textContent = BiciCharts.formatDuration(ride.duration);
  DOM.detailValSpeed.textContent = ride.avgSpeed.toFixed(1);
  DOM.detailValAscent.textContent = Math.round(ride.ascent);
  DOM.detailValHr.textContent = ride.avgHr > 0 ? Math.round(ride.avgHr) : '--';
  DOM.detailValCadence.textContent = ride.avgCadence > 0 ? Math.round(ride.avgCadence) : '--';
  DOM.detailValRespiration.textContent = ride.avgRespiration > 0 ? Math.round(ride.avgRespiration) : '--';
  DOM.detailValTemp.textContent = ride.avgTemp ? Math.round(ride.avgTemp) : '22';

  // Renderizar gráficos del detalle
  navigateTo('detail');
  
  // Retrasar renderización un momento para que el contenedor tenga tamaño en el DOM
  setTimeout(() => {
    BiciCharts.renderHRZones('detail-hr-zones-chart', ride.zoneTimes, ride.duration);
    BiciCharts.renderRideProfile('detail-ride-profile-chart', ride.samples);
    initDetailMap(ride);
  }, 100);
}

// Cargar Ajustes
function loadSettingsScreen() {
  const settings = Storage.getSettings();
  DOM.setAge.value = settings.age;
  DOM.setWeight.value = settings.weight;
  DOM.setBikeWeight.value = settings.bikeWeight || 10;
  DOM.setAutopause.checked = settings.autoPause;
  DOM.setUseAuto.checked = settings.useAutoZones;

  if (settings.useAutoZones) {
    DOM.manualZonesContainer.classList.add('hide');
    DOM.autoZonesPreview.classList.remove('hide');
    updateAutoZonesPreview();
  } else {
    DOM.manualZonesContainer.classList.remove('hide');
    DOM.autoZonesPreview.classList.add('hide');
    // Rellenar inputs manuales
    Object.keys(settings.manualZones).forEach(zone => {
      document.getElementById(`${zone}-min`).value = settings.manualZones[zone].min;
      document.getElementById(`${zone}-max`).value = settings.manualZones[zone].max;
    });
  }
}

// Actualizar preview de zonas automáticas basadas en la edad actual en el input
function updateAutoZonesPreview() {
  const age = parseInt(DOM.setAge.value) || 30;
  const maxHR = 220 - age;
  
  const z1Min = Math.round(maxHR * 0.50), z1Max = Math.round(maxHR * 0.60);
  const z2Min = z1Max + 1, z2Max = Math.round(maxHR * 0.70);
  const z3Min = z2Max + 1, z3Max = Math.round(maxHR * 0.80);
  const z4Min = z3Max + 1, z4Max = Math.round(maxHR * 0.90);
  const z5Min = z4Max + 1, z5Max = maxHR;

  DOM.autoZonesPreview.innerHTML = `
    <div class="preview-zone-item"><span class="zone-badge-dot z1-dot"></span><span>Z1 Recuperación:</span><span class="val">${z1Min} - ${z1Max} BPM</span></div>
    <div class="preview-zone-item"><span class="zone-badge-dot z2-dot"></span><span>Z2 Resistencia:</span><span class="val">${z2Min} - ${z2Max} BPM</span></div>
    <div class="preview-zone-item"><span class="zone-badge-dot z3-dot"></span><span>Z3 Tempo:</span><span class="val">${z3Min} - ${z3Max} BPM</span></div>
    <div class="preview-zone-item"><span class="zone-badge-dot z4-dot"></span><span>Z4 Umbral:</span><span class="val">${z4Min} - ${z4Max} BPM</span></div>
    <div class="preview-zone-item"><span class="zone-badge-dot z5-dot"></span><span>Z5 Anaeróbico:</span><span class="val">${z5Min} - ${z5Max} BPM</span></div>
  `;
}

// --- INTEGRACIÓN DE MAPAS LEAFLET ---

// Inicializar el mapa en vivo de grabación
function initRecordingMap() {
  if (AppState.recMap) {
    AppState.recMap.remove();
    AppState.recMap = null;
  }

  // Coordenadas iniciales por defecto (fijadas si no hay GPS aún)
  const defaultCoords = [4.6097, -74.0817]; // Bogotá por defecto o cualquier centro
  
  AppState.recMap = L.map('recording-map', {
    zoomControl: false,
    doubleClickZoom: false
  }).setView(defaultCoords, 16);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OSM'
  }).addTo(AppState.recMap);

  // Inicializar indicador de ciclista (Icono azul clásico)
  const bikeIcon = L.divIcon({
    className: 'custom-bike-marker',
    html: `<div style="background-color: var(--color-accent); width: 14px; height: 14px; border-radius: 50%; border: 2.5px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.3);"></div>`,
    iconSize: [14, 14]
  });
  
  AppState.recMarker = L.marker(defaultCoords, { icon: bikeIcon }).addTo(AppState.recMap);

  // Línea de trayectoria
  AppState.recPathLine = L.polyline([], {
    color: 'var(--color-accent)',
    weight: 4.5,
    opacity: 0.85
  }).addTo(AppState.recMap);

  // Evento de clic en el mapa para marcar Destino
  AppState.recMap.on('click', (e) => {
    setTargetCoords(e.latlng.lat, e.latlng.lng);
  });
}

// Fijar coordenadas de destino en la rodada
function setTargetCoords(lat, lng) {
  AppState.activeRide.targetCoords = { lat, lng };

  // Crear o mover el marcador rojo de destino
  if (AppState.recTargetMarker) {
    AppState.recTargetMarker.setLatLng([lat, lng]);
  } else {
    const targetIcon = L.divIcon({
      className: 'custom-target-marker',
      html: `<div style="background-color: var(--color-danger); width: 14px; height: 14px; transform: rotate(45deg); border: 2.5px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.3);"></div>`,
      iconSize: [14, 14]
    });
    AppState.recTargetMarker = L.marker([lat, lng], { icon: targetIcon }).addTo(AppState.recMap);
  }

  DOM.mapTargetStatus.style.display = 'block';
  DOM.mapTargetDistance.style.display = 'block';
  DOM.btnClearTarget.style.display = 'block';

  updateTargetDistance();
}

// Quitar coordenadas de destino
function clearTargetCoords() {
  AppState.activeRide.targetCoords = null;
  if (AppState.recTargetMarker) {
    AppState.recTargetMarker.remove();
    AppState.recTargetMarker = null;
  }
  DOM.mapTargetStatus.style.display = 'none';
  DOM.mapTargetDistance.style.display = 'none';
  DOM.btnClearTarget.style.display = 'none';
}

// Calcular distancia restante al destino fijado
function updateTargetDistance() {
  if (!AppState.activeRide.targetCoords || !AppState.recMarker) return;

  const currentLatLng = AppState.recMarker.getLatLng();
  const target = AppState.activeRide.targetCoords;

  // Calcular Haversine
  const R = 6371; // Radio de la Tierra en km
  const dLat = (target.lat - currentLatLng.lat) * Math.PI / 180;
  const dLon = (target.lng - currentLatLng.lng) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(currentLatLng.lat * Math.PI / 180) * Math.cos(target.lat * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const dist = R * c; // en km

  DOM.mapTargetDistance.textContent = `Quedan: ${dist.toFixed(2)} km`;
}

// Inicializar y graficar el mapa del detalle al finalizar
function initDetailMap(ride) {
  if (AppState.detMap) {
    AppState.detMap.remove();
    AppState.detMap = null;
  }

  // Filtrar muestras que tengan coordenadas válidas
  const coords = ride.samples
    .filter(s => s.lat !== undefined && s.lon !== undefined)
    .map(s => [s.lat, s.lon]);

  if (coords.length === 0) {
    document.getElementById('detail-map').innerHTML = `<div style="text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: 13px;">No hay datos de mapas grabados en esta rodada.</div>`;
    return;
  }

  AppState.detMap = L.map('detail-map', { zoomControl: false }).setView(coords[0], 15);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OSM'
  }).addTo(AppState.detMap);

  // Dibujar línea de trayectoria
  AppState.detPathLine = L.polyline(coords, {
    color: 'var(--color-danger)',
    weight: 5,
    opacity: 0.9
  }).addTo(AppState.detMap);

  // Marcador de inicio (Verde) y final (Rojo)
  const startIcon = L.divIcon({
    html: `<div style="background-color: var(--color-success); width: 12px; height: 12px; border-radius:50%; border:2px solid white; box-shadow:0 0 5px rgba(0,0,0,0.3);"></div>`,
    iconSize: [12, 12]
  });
  const endIcon = L.divIcon({
    html: `<div style="background-color: var(--color-danger); width: 12px; height: 12px; border-radius:50%; border:2px solid white; box-shadow:0 0 5px rgba(0,0,0,0.3);"></div>`,
    iconSize: [12, 12]
  });

  L.marker(coords[0], { icon: startIcon }).addTo(AppState.detMap);
  L.marker(coords[coords.length - 1], { icon: endIcon }).addTo(AppState.detMap);

  // Ajustar la cámara para que encuadre toda la ruta
  AppState.detMap.fitBounds(AppState.detPathLine.getBounds(), { padding: [20, 20] });
}

// --- LÓGICA DE GRABACIÓN ---

function startWorkout() {
  AppState.activeRide = {
    isRecording: true,
    isPaused: false,
    isAutoPaused: false,
    autoPauseTicks: 0,
    timerInterval: null,
    elapsedSeconds: 0,
    distance: 0,
    speed: 0,
    ascent: 0,
    grade: 0,
    power: 0,
    hr: 0,
    cadence: 0,
    respiration: 0,
    temp: 22,
    targetCoords: null,
    samples: [],
    sampleInterval: null,
    zoneTimes: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  };

  DOM.liveSpeed.textContent = '0.0';
  DOM.liveDistance.textContent = '0.00';
  DOM.liveTimer.textContent = '00:00:00';
  DOM.liveHr.textContent = '--';
  DOM.liveHrZone.textContent = '--';
  DOM.liveHrZone.className = 'hr-zone-tag hide';
  DOM.liveCadence.textContent = '--';
  DOM.liveAscent.textContent = '0';
  DOM.liveWatts.textContent = '--';
  DOM.liveGrade.textContent = '0%';
  DOM.liveRespiration.textContent = '--';
  DOM.liveTemp.textContent = '22';

  // Mostrar botón de pausar y ocultar el de reanudar
  DOM.btnPauseRide.classList.remove('hide');
  DOM.btnResumeRide.classList.add('hide');

  // Limpiar el widget ClimbPro
  DOM.climbproWidget.classList.add('hide');
  DOM.climbProfileBars.innerHTML = '';

  clearTargetCoords();
  navigateTo('recording');

  // Inicializar mapa de grabación Leaflet
  initRecordingMap();

  // 1. Iniciar Cronómetro
  AppState.activeRide.timerInterval = setInterval(() => {
    // Lógica de Auto-Pausa:
    // Si la autopausa está activa en ajustes, y la velocidad es < 2.0 km/h
    if (AppState.settings.autoPause) {
      if (AppState.activeRide.speed < 2.0) {
        AppState.activeRide.autoPauseTicks++;
        if (AppState.activeRide.autoPauseTicks >= 6 && !AppState.activeRide.isAutoPaused) {
          AppState.activeRide.isAutoPaused = true;
          DOM.liveStatusBadge.textContent = 'AUTO-PAUSA';
          DOM.liveStatusBadge.className = 'status-indicator live-badge autopaused';
          console.log("[BiciLog] Actividad auto-pausada por falta de movimiento.");
        }
      } else {
        AppState.activeRide.autoPauseTicks = 0;
        if (AppState.activeRide.isAutoPaused) {
          AppState.activeRide.isAutoPaused = false;
          DOM.liveStatusBadge.textContent = 'EN VIVO';
          DOM.liveStatusBadge.className = 'status-indicator live-badge';
          console.log("[BiciLog] Actividad reanudada automáticamente.");
        }
      }
    }

    const isRunning = !AppState.activeRide.isPaused && !AppState.activeRide.isAutoPaused;

    if (isRunning) {
      AppState.activeRide.elapsedSeconds++;
      DOM.liveTimer.textContent = BiciCharts.formatDuration(AppState.activeRide.elapsedSeconds);
      
      // Acumular tiempo en zonas si hay FC activa
      if (AppState.activeRide.hr > 0) {
        const zoneNum = Storage.getZoneForHR(AppState.activeRide.hr, AppState.hrZones);
        if (zoneNum > 0) {
          AppState.activeRide.zoneTimes[`z${zoneNum}`]++;
        }
      }

      // GUARDADO EN CALIENTE (SESIÓN ACTIVA) para recuperar por cortes/cierre
      Storage.saveActiveSession({
        elapsedSeconds: AppState.activeRide.elapsedSeconds,
        distance: AppState.activeRide.distance,
        ascent: AppState.activeRide.ascent,
        hr: AppState.activeRide.hr,
        cadence: AppState.activeRide.cadence,
        respiration: AppState.activeRide.respiration,
        temp: AppState.activeRide.temp,
        samples: AppState.activeRide.samples,
        zoneTimes: AppState.activeRide.zoneTimes,
        simulationActive: AppState.simulation.isActive,
        targetCoords: AppState.activeRide.targetCoords
      });
    }
  }, 1000);

  // 2. Iniciar Toma de Muestras (Cada 5s para el gráfico final)
  AppState.activeRide.sampleInterval = setInterval(() => {
    if (!AppState.activeRide.isPaused && !AppState.activeRide.isAutoPaused) {
      AppState.activeRide.samples.push({
        time: AppState.activeRide.elapsedSeconds,
        hr: AppState.activeRide.hr,
        speed: AppState.activeRide.speed,
        cadence: AppState.activeRide.cadence,
        lat: AppState.activeRide.lat,
        lon: AppState.activeRide.lon
      });
    }
  }, 5000);

  // 3. Iniciar GPS si el simulador no está encendido
  if (!AppState.simulation.isActive) {
    BiciGPS.startTracking(
      AppState.settings,
      (gpsData) => {
        // Callback de datos filtrados desde el Web Worker
        if (AppState.activeRide.isAutoPaused) return; // Ignorar si está auto-pausada

        AppState.activeRide.speed = gpsData.speed;
        AppState.activeRide.distance = gpsData.distance;
        AppState.activeRide.ascent = gpsData.ascent;
        AppState.activeRide.grade = gpsData.grade;
        AppState.activeRide.power = gpsData.power;
        AppState.activeRide.lat = gpsData.latitude;
        AppState.activeRide.lon = gpsData.longitude;
        
        DOM.liveSpeed.textContent = gpsData.speed.toFixed(1);
        DOM.liveDistance.textContent = gpsData.distance.toFixed(2);
        DOM.liveAscent.textContent = Math.round(gpsData.ascent);
        DOM.liveGrade.textContent = Math.round(gpsData.grade) + '%';
        DOM.liveWatts.textContent = Math.round(gpsData.power);
        
        // Simular temperatura basada en altura
        const baseTemp = 22;
        const tempShift = -((gpsData.ascent / 100) * 0.65);
        AppState.activeRide.temp = Math.round((baseTemp + tempShift) * 10) / 10;
        DOM.liveTemp.textContent = AppState.activeRide.temp;

        // Actualizar el mapa Leaflet en vivo
        if (AppState.recMap && gpsData.latitude && gpsData.longitude) {
          const newPos = [gpsData.latitude, gpsData.longitude];
          AppState.recMarker.setLatLng(newPos);
          AppState.recPathLine.addLatLng(newPos);
          AppState.recMap.panTo(newPos);

          updateTargetDistance(); // recalcular distancia al destino si existe
        }

        // Renderizar ClimbPro si hay subida activa
        updateClimbProUI(gpsData.climbInfo);
      },
      (error) => {
        DOM.gpsAccuracy.textContent = "GPS: Error";
      }
    );
  } else {
    startDemoSimulation();
  }
}

// Actualizar el Widget de ClimbPro en vivo
function updateClimbProUI(climbInfo) {
  if (climbInfo && climbInfo.active) {
    DOM.climbproWidget.classList.remove('hide');
    DOM.climbDistLeft.textContent = Math.round(climbInfo.distance);
    DOM.climbAvgGrade.textContent = climbInfo.avgGrade.toFixed(1);
    DOM.climbScoreBadge.textContent = `Score: ${Math.round(climbInfo.score)}`;

    // Renderizar las barras de color de inclinación
    DOM.climbProfileBars.innerHTML = '';
    climbInfo.segments.forEach(seg => {
      const bar = document.createElement('div');
      bar.className = 'climb-segment-bar';
      bar.style.backgroundColor = seg.color;
      DOM.climbProfileBars.appendChild(bar);
    });
  } else {
    DOM.climbproWidget.classList.add('hide');
  }
}

// Pausar
function pauseWorkout() {
  AppState.activeRide.isPaused = true;
  DOM.btnPauseRide.classList.add('hide');
  DOM.btnResumeRide.classList.remove('hide');
  
  if (!AppState.simulation.isActive) {
    BiciGPS.stopTracking();
  }
}

// Reanudar
function resumeWorkout() {
  AppState.activeRide.isPaused = false;
  DOM.btnPauseRide.classList.remove('hide');
  DOM.btnResumeRide.classList.add('hide');

  if (!AppState.simulation.isActive) {
    BiciGPS.startTracking(
      AppState.settings,
      (gpsData) => {
        if (AppState.activeRide.isAutoPaused) return;

        AppState.activeRide.speed = gpsData.speed;
        AppState.activeRide.distance = gpsData.distance;
        AppState.activeRide.ascent = gpsData.ascent;
        AppState.activeRide.grade = gpsData.grade;
        AppState.activeRide.power = gpsData.power;
        AppState.activeRide.lat = gpsData.latitude;
        AppState.activeRide.lon = gpsData.longitude;
        
        DOM.liveSpeed.textContent = gpsData.speed.toFixed(1);
        DOM.liveDistance.textContent = gpsData.distance.toFixed(2);
        DOM.liveAscent.textContent = Math.round(gpsData.ascent);
        DOM.liveGrade.textContent = Math.round(gpsData.grade) + '%';
        DOM.liveWatts.textContent = Math.round(gpsData.power);

        if (AppState.recMap && gpsData.latitude && gpsData.longitude) {
          const newPos = [gpsData.latitude, gpsData.longitude];
          AppState.recMarker.setLatLng(newPos);
          AppState.recPathLine.addLatLng(newPos);
          AppState.recMap.panTo(newPos);
          updateTargetDistance();
        }
        updateClimbProUI(gpsData.climbInfo);
      }
    );
  }
}

// Finalizar y Guardar
function stopWorkout() {
  clearInterval(AppState.activeRide.timerInterval);
  clearInterval(AppState.activeRide.sampleInterval);
  
  if (AppState.simulation.isActive) {
    stopDemoSimulation();
  } else {
    BiciGPS.stopTracking();
    BiciSensors.disconnectAll();
    resetPillsUI();
  }

  // Quitar mapas
  if (AppState.recMap) {
    AppState.recMap.remove();
    AppState.recMap = null;
  }

  const rideData = AppState.activeRide;
  
  if (rideData.samples.length === 0) {
    rideData.samples.push({ time: 0, hr: rideData.hr || 70, speed: rideData.speed || 0, cadence: rideData.cadence || 0 });
    rideData.samples.push({ time: rideData.elapsedSeconds, hr: rideData.hr || 70, speed: rideData.speed || 0, cadence: rideData.cadence || 0 });
  }

  // Calcular Promedios
  const hrs = rideData.samples.map(s => s.hr).filter(h => h > 0);
  const speeds = rideData.samples.map(s => s.speed);
  const cadences = rideData.samples.map(s => s.cadence).filter(c => c > 0);

  const avgHr = hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0;
  const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  const avgCadence = cadences.length > 0 ? cadences.reduce((a, b) => a + b, 0) / cadences.length : 0;

  // Estimación de la respiración promedio basada en FC Promedio
  const avgRespiration = avgHr > 0 ? Math.round(12 + (avgHr - 60) / 3.5) : 0;

  // Titular dinámico basado en hora
  const hour = new Date().getHours();
  let timeOfDay = "Rodada Matutina";
  if (hour >= 12 && hour < 19) timeOfDay = "Rodada Vespertina";
  else if (hour >= 19 || hour < 6) timeOfDay = "Rodada Nocturna";

  const newRide = {
    timestamp: Date.now(),
    title: timeOfDay,
    duration: rideData.elapsedSeconds,
    distance: rideData.distance,
    ascent: rideData.ascent,
    avgSpeed: avgSpeed || rideData.speed || 0,
    avgHr: avgHr || rideData.hr || 0,
    avgCadence: avgCadence || rideData.cadence || 0,
    avgRespiration: avgRespiration,
    avgTemp: rideData.temp,
    samples: rideData.samples,
    zoneTimes: rideData.zoneTimes
  };

  // Guardar en LocalStorage (Limpia sesión activa internamente)
  Storage.saveRide(newRide);

  // Redirigir a detalle
  openRideDetail(newRide);
}

// Resetear UI de pastillas de conexión
function resetPillsUI() {
  DOM.sensorPillHr.className = 'sensor-connect-pill';
  DOM.sensorPillHr.querySelector('.sensor-status-text').textContent = 'FC: Desconectado';
  DOM.btnConnectHr.textContent = 'Emparejar';

  DOM.sensorPillCsc.className = 'sensor-connect-pill';
  DOM.sensorPillCsc.querySelector('.sensor-status-text').textContent = 'Cad: Desconectado';
  DOM.btnConnectCsc.textContent = 'Emparejar';
}

// --- CONEXIONES BLUETOOTH ---

async function toggleHRConnection() {
  if (BiciSensors.isHrConnected) {
    BiciSensors.disconnectAll();
    resetPillsUI();
  } else {
    DOM.btnConnectHr.textContent = 'Buscando...';
    DOM.sensorPillHr.className = 'sensor-connect-pill';
    
    try {
      await BiciSensors.connectHeartRate(
        (hrValue) => {
          AppState.activeRide.hr = hrValue;
          DOM.liveHr.textContent = hrValue;

          // Calcular zona actual en vivo
          const zone = Storage.getZoneForHR(hrValue, AppState.hrZones);
          if (zone > 0) {
            DOM.liveHrZone.textContent = `Z${zone}`;
            DOM.liveHrZone.className = `hr-zone-tag z${zone}-dot`;
            DOM.liveHrZone.style.backgroundColor = BiciCharts.ZONE_COLORS[`z${zone}`];
            DOM.liveHrZone.classList.remove('hide');
          } else {
            DOM.liveHrZone.classList.add('hide');
          }

          // Estimación respiratoria instantánea
          const respRate = Math.round(12 + (hrValue - 60) / 3.5);
          AppState.activeRide.respiration = respRate;
          DOM.liveRespiration.textContent = respRate;
        },
        (disconnectMsg) => {
          console.log(disconnectMsg);
          resetPillsUI();
        }
      );

      DOM.sensorPillHr.className = 'sensor-connect-pill connected';
      DOM.sensorPillHr.querySelector('.sensor-status-text').textContent = 'FC: Conectado';
      DOM.btnConnectHr.textContent = 'Desconectar';
    } catch (err) {
      alert("No se pudo conectar el sensor de Frecuencia Cardíaca. Recuerda usar el navegador Bluefy en iPhone.");
      resetPillsUI();
    }
  }
}

async function toggleCSCConnection() {
  if (BiciSensors.isCscConnected) {
    BiciSensors.disconnectAll();
    resetPillsUI();
  } else {
    DOM.btnConnectCsc.textContent = 'Buscando...';
    DOM.sensorPillCsc.className = 'sensor-connect-pill';
    
    try {
      await BiciSensors.connectCadence(
        (cadenceValue) => {
          AppState.activeRide.cadence = cadenceValue;
          DOM.liveCadence.textContent = cadenceValue;
        },
        (disconnectMsg) => {
          console.log(disconnectMsg);
          resetPillsUI();
        }
      );

      DOM.sensorPillCsc.className = 'sensor-connect-pill connected';
      DOM.sensorPillCsc.querySelector('.sensor-status-text').textContent = 'Cad: Conectado';
      DOM.btnConnectCsc.textContent = 'Desconectar';
    } catch (err) {
      alert("No se pudo conectar el sensor de Cadencia.");
      resetPillsUI();
    }
  }
}

// --- MOTOR DE SIMULACIÓN (MODO DEMO PARA PRUEBAS) ---

function startDemoSimulation() {
  AppState.simulation.isActive = true;
  AppState.simulation.simSpeed = 24.5;
  AppState.simulation.simHr = 135;
  AppState.simulation.simCad = 85;

  DOM.gpsAccuracy.textContent = "GPS: Simulado";
  DOM.sensorPillHr.className = 'sensor-connect-pill connected';
  DOM.sensorPillHr.querySelector('.sensor-status-text').textContent = 'FC: Simulado';
  DOM.btnConnectHr.textContent = 'Desconectar';
  
  DOM.sensorPillCsc.className = 'sensor-connect-pill connected';
  DOM.sensorPillCsc.querySelector('.sensor-status-text').textContent = 'Cad: Simulado';
  DOM.btnConnectCsc.textContent = 'Desconectar';

  // Ruta simulada alrededor de Bogotá / montañas
  let simLat = 4.6097;
  let simLon = -74.0817;

  AppState.simulation.intervalId = setInterval(() => {
    if (AppState.activeRide.isPaused || AppState.activeRide.isAutoPaused) return;

    // 1. Simular velocidad con altibajos
    const speedDelta = (Math.random() - 0.5) * 1.8;
    AppState.simulation.simSpeed = Math.min(Math.max(AppState.simulation.simSpeed + speedDelta, 12), 42);
    AppState.activeRide.speed = AppState.simulation.simSpeed;
    DOM.liveSpeed.textContent = AppState.activeRide.speed.toFixed(1);

    // 2. Simular Distancia Acumulada
    const distancePerSecond = AppState.activeRide.speed / 3600;
    AppState.activeRide.distance += distancePerSecond;
    DOM.liveDistance.textContent = AppState.activeRide.distance.toFixed(2);

    // Mover coordenadas falsas
    simLat += 0.00008 * (AppState.activeRide.speed / 20);
    simLon += 0.00005 * Math.sin(AppState.activeRide.elapsedSeconds / 10);
    AppState.activeRide.lat = simLat;
    AppState.activeRide.lon = simLon;

    // Actualizar mapa Leaflet simulado
    if (AppState.recMap) {
      const newPos = [simLat, simLon];
      AppState.recMarker.setLatLng(newPos);
      AppState.recPathLine.addLatLng(newPos);
      AppState.recMap.panTo(newPos);
      updateTargetDistance();
    }

    // 3. Simular Pendiente (%) variable
    // Si la velocidad baja, asumimos que está subiendo
    let grade = 0;
    if (AppState.activeRide.speed < 18) {
      grade = (18 - AppState.activeRide.speed) * 0.8; // pendiente hasta 12%
    } else {
      grade = (18 - AppState.activeRide.speed) * 0.3; // pendiente negativa o llano
    }
    AppState.activeRide.grade = grade;
    DOM.liveGrade.textContent = Math.round(grade) + '%';

    // 4. Simular Ascenso
    if (grade > 0) {
      AppState.activeRide.ascent += (grade / 100) * (distancePerSecond * 1000);
      DOM.liveAscent.textContent = Math.round(AppState.activeRide.ascent);
    }

    // 5. Simular Frecuencia Cardíaca
    const targetHR = 110 + (grade > 0 ? grade * 7 : 0) + (AppState.activeRide.speed > 25 ? 15 : 0);
    const hrDelta = (targetHR - AppState.simulation.simHr) * 0.08 + (Math.random() - 0.5) * 3;
    AppState.simulation.simHr = Math.round(Math.min(Math.max(AppState.simulation.simHr + hrDelta, 90), 185));
    AppState.activeRide.hr = AppState.simulation.simHr;
    DOM.liveHr.textContent = AppState.activeRide.hr;

    const zone = Storage.getZoneForHR(AppState.activeRide.hr, AppState.hrZones);
    if (zone > 0) {
      DOM.liveHrZone.textContent = `Z${zone}`;
      DOM.liveHrZone.className = `hr-zone-tag z${zone}-dot`;
      DOM.liveHrZone.style.backgroundColor = BiciCharts.ZONE_COLORS[`z${zone}`];
      DOM.liveHrZone.classList.remove('hide');
    }

    // 6. Simular Watts basado en modelo mecánico
    const riderM = AppState.settings.weight || 70;
    const bikeM = AppState.settings.bikeWeight || 10;
    const totalMass = riderM + bikeM;
    const speedMs = AppState.activeRide.speed / 3.6;
    const angleRad = Math.atan(grade / 100);

    const fGravity = totalMass * 9.81 * Math.sin(angleRad);
    const fRolling = totalMass * 9.81 * Math.cos(angleRad) * 0.004;
    const fDrag = 0.5 * 0.32 * 1.225 * Math.pow(speedMs, 2);
    let power = (fGravity + fRolling + fDrag) * speedMs;
    if (power < 0) power = 0;
    AppState.activeRide.power = Math.round(power / 0.95);
    DOM.liveWatts.textContent = AppState.activeRide.power;

    // 7. Simular Cadencia
    const cadDelta = (Math.random() - 0.5) * 4;
    AppState.simulation.simCad = Math.round(Math.min(Math.max(AppState.simulation.simCad + cadDelta, 60), 110));
    AppState.activeRide.cadence = AppState.simulation.simCad;
    DOM.liveCadence.textContent = AppState.activeRide.cadence;

    // 8. Simular Respiración
    const respRate = Math.round(12 + (AppState.activeRide.hr - 60) / 3.5);
    AppState.activeRide.respiration = respRate;
    DOM.liveRespiration.textContent = respRate;

    // 9. Temperatura
    DOM.liveTemp.textContent = AppState.activeRide.temp;

    // Simular widgets de ClimbPro periódicos
    const isClimbSim = AppState.activeRide.elapsedSeconds % 100 > 30; // subida simulada cada 100s, por 70s
    if (isClimbSim) {
      const mockClimb = {
        active: true,
        distance: Math.max(0, 1200 - (AppState.activeRide.elapsedSeconds % 100) * 10),
        avgGrade: Math.max(3.2, grade),
        score: 1800,
        segments: [
          { color: '#FECA57' }, { color: '#FF9F43' }, { color: '#FF6B6B' }, { color: '#FECA57' }
        ]
      };
      updateClimbProUI(mockClimb);
    } else {
      updateClimbProUI(null);
    }

  }, 1000);
}

function stopDemoSimulation() {
  AppState.simulation.isActive = false;
  clearInterval(AppState.simulation.intervalId);
  resetPillsUI();
  DOM.gpsAccuracy.textContent = "GPS: --";
}

// --- RECUPERACIÓN DE SESIÓN (RESTAURACIÓN) ---

function resumeActiveSession(session) {
  // Rehidratar AppState con datos de la sesión anterior
  AppState.activeRide = {
    isRecording: true,
    isPaused: false,
    isAutoPaused: false,
    autoPauseTicks: 0,
    timerInterval: null,
    elapsedSeconds: session.elapsedSeconds,
    distance: session.distance,
    ascent: session.ascent,
    grade: 0,
    power: 0,
    hr: session.hr,
    cadence: session.cadence,
    respiration: session.respiration,
    temp: session.temp,
    targetCoords: session.targetCoords,
    samples: session.samples || [],
    sampleInterval: null,
    zoneTimes: session.zoneTimes
  };

  DOM.liveSpeed.textContent = '0.0';
  DOM.liveDistance.textContent = AppState.activeRide.distance.toFixed(2);
  DOM.liveTimer.textContent = BiciCharts.formatDuration(AppState.activeRide.elapsedSeconds);
  DOM.liveHr.textContent = AppState.activeRide.hr || '--';
  DOM.liveCadence.textContent = AppState.activeRide.cadence || '--';
  DOM.liveAscent.textContent = Math.round(AppState.activeRide.ascent);
  DOM.liveWatts.textContent = '--';
  DOM.liveGrade.textContent = '0%';
  DOM.liveRespiration.textContent = AppState.activeRide.respiration || '--';
  DOM.liveTemp.textContent = AppState.activeRide.temp;

  // Restaurar UI de botones
  DOM.btnPauseRide.classList.remove('hide');
  DOM.btnResumeRide.classList.add('hide');

  navigateTo('recording');
  initRecordingMap();

  // Redibujar la línea de mapa existente
  if (session.samples && session.samples.length > 0) {
    const coords = session.samples
      .filter(s => s.lat !== undefined && s.lon !== undefined)
      .map(s => [s.lat, s.lon]);
    
    if (coords.length > 0) {
      AppState.recPathLine.setLatLngs(coords);
      const lastCoord = coords[coords.length - 1];
      AppState.recMarker.setLatLng(lastCoord);
      AppState.recMap.setView(lastCoord, 16);
      AppState.activeRide.lat = lastCoord[0];
      AppState.activeRide.lon = lastCoord[1];
    }
  }

  // Restaurar destino si existía
  if (session.targetCoords) {
    setTargetCoords(session.targetCoords.lat, session.targetCoords.lng);
  }

  // Restaurar simulación o rastreo GPS real
  if (session.simulationActive) {
    startDemoSimulation();
  } else {
    // Rastreador real
    BiciGPS.startTracking(
      AppState.settings,
      (gpsData) => {
        if (AppState.activeRide.isAutoPaused) return;

        AppState.activeRide.speed = gpsData.speed;
        AppState.activeRide.distance = gpsData.distance;
        AppState.activeRide.ascent = gpsData.ascent;
        AppState.activeRide.grade = gpsData.grade;
        AppState.activeRide.power = gpsData.power;
        AppState.activeRide.lat = gpsData.latitude;
        AppState.activeRide.lon = gpsData.longitude;
        
        DOM.liveSpeed.textContent = gpsData.speed.toFixed(1);
        DOM.liveDistance.textContent = gpsData.distance.toFixed(2);
        DOM.liveAscent.textContent = Math.round(gpsData.ascent);
        DOM.liveGrade.textContent = Math.round(gpsData.grade) + '%';
        DOM.liveWatts.textContent = Math.round(gpsData.power);

        if (AppState.recMap && gpsData.latitude && gpsData.longitude) {
          const newPos = [gpsData.latitude, gpsData.longitude];
          AppState.recMarker.setLatLng(newPos);
          AppState.recPathLine.addLatLng(newPos);
          AppState.recMap.panTo(newPos);
          updateTargetDistance();
        }
        updateClimbProUI(gpsData.climbInfo);
      }
    );
  }

  // Iniciar intervalos de cronómetro nuevamente
  AppState.activeRide.timerInterval = setInterval(() => {
    if (AppState.settings.autoPause) {
      if (AppState.activeRide.speed < 2.0) {
        AppState.activeRide.autoPauseTicks++;
        if (AppState.activeRide.autoPauseTicks >= 6 && !AppState.activeRide.isAutoPaused) {
          AppState.activeRide.isAutoPaused = true;
          DOM.liveStatusBadge.textContent = 'AUTO-PAUSA';
          DOM.liveStatusBadge.className = 'status-indicator live-badge autopaused';
        }
      } else {
        AppState.activeRide.autoPauseTicks = 0;
        if (AppState.activeRide.isAutoPaused) {
          AppState.activeRide.isAutoPaused = false;
          DOM.liveStatusBadge.textContent = 'EN VIVO';
          DOM.liveStatusBadge.className = 'status-indicator live-badge';
        }
      }
    }

    const isRunning = !AppState.activeRide.isPaused && !AppState.activeRide.isAutoPaused;

    if (isRunning) {
      AppState.activeRide.elapsedSeconds++;
      DOM.liveTimer.textContent = BiciCharts.formatDuration(AppState.activeRide.elapsedSeconds);
      
      if (AppState.activeRide.hr > 0) {
        const zoneNum = Storage.getZoneForHR(AppState.activeRide.hr, AppState.hrZones);
        if (zoneNum > 0) {
          AppState.activeRide.zoneTimes[`z${zoneNum}`]++;
        }
      }

      // Guardar en caliente cada segundo
      Storage.saveActiveSession({
        elapsedSeconds: AppState.activeRide.elapsedSeconds,
        distance: AppState.activeRide.distance,
        ascent: AppState.activeRide.ascent,
        hr: AppState.activeRide.hr,
        cadence: AppState.activeRide.cadence,
        respiration: AppState.activeRide.respiration,
        temp: AppState.activeRide.temp,
        samples: AppState.activeRide.samples,
        zoneTimes: AppState.activeRide.zoneTimes,
        simulationActive: AppState.simulation.isActive,
        targetCoords: AppState.activeRide.targetCoords
      });
    }
  }, 1000);

  // Intervalo de muestras cada 5s
  AppState.activeRide.sampleInterval = setInterval(() => {
    if (!AppState.activeRide.isPaused && !AppState.activeRide.isAutoPaused) {
      AppState.activeRide.samples.push({
        time: AppState.activeRide.elapsedSeconds,
        hr: AppState.activeRide.hr,
        speed: AppState.activeRide.speed,
        cadence: AppState.activeRide.cadence,
        lat: AppState.activeRide.lat,
        lon: AppState.activeRide.lon
      });
    }
  }, 5000);
}

// --- INICIALIZADORES Y EVENTOS ---

document.addEventListener('DOMContentLoaded', () => {
  // Cargar estado inicial
  loadDashboardData();

  // --- COMPROBAR RECUPERACIÓN DE SESIÓN EN CALIENTE ---
  const savedSession = Storage.getActiveSession();
  if (savedSession && savedSession.elapsedSeconds > 5) {
    // Mostrar modal de recuperación
    DOM.recoveryTime.textContent = BiciCharts.formatDuration(savedSession.elapsedSeconds);
    DOM.recoveryDistance.textContent = savedSession.distance.toFixed(2) + ' km';
    DOM.sessionRecoveryModal.classList.remove('hide');

    DOM.btnRecoveryDiscard.addEventListener('click', () => {
      Storage.clearActiveSession();
      DOM.sessionRecoveryModal.classList.add('hide');
    });

    DOM.btnRecoveryResume.addEventListener('click', () => {
      DOM.sessionRecoveryModal.classList.add('hide');
      resumeActiveSession(savedSession);
    });
  }

  // Interceptar eventos "Undo" del sistema (Shake to Undo en Safari de iPhone)
  window.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
      e.preventDefault();
      console.log("[BiciLog] Shake-to-Undo bloqueado por seguridad.");
    }
  });

  // --- REGISTRO DE EVENTOS DE BOTONES ---

  // Navegación Básica
  DOM.btnOpenSettings.addEventListener('click', () => navigateTo('settings'));
  DOM.btnSettingsBack.addEventListener('click', () => navigateTo('dashboard'));
  DOM.btnDetailBack.addEventListener('click', () => navigateTo('dashboard'));

  // Iniciar Rodada
  DOM.btnStartRide.addEventListener('click', () => {
    // Quitar focos de inputs para prevenir alertas de Shake-to-Undo en iPhone
    if (document.activeElement) {
      document.activeElement.blur();
    }
    startWorkout();
  });

  // Conectar Sensores
  DOM.btnConnectHr.addEventListener('click', (e) => {
    e.stopPropagation();
    if (AppState.simulation.isActive) return;
    toggleHRConnection();
  });

  DOM.btnConnectCsc.addEventListener('click', (e) => {
    e.stopPropagation();
    if (AppState.simulation.isActive) return;
    toggleCSCConnection();
  });

  // Controles de Rodada
  DOM.btnPauseRide.addEventListener('click', () => {
    if (document.activeElement) document.activeElement.blur();
    pauseWorkout();
  });
  
  DOM.btnResumeRide.addEventListener('click', () => {
    if (document.activeElement) document.activeElement.blur();
    resumeWorkout();
  });
  
  DOM.btnStopRide.addEventListener('click', () => {
    if (document.activeElement) document.activeElement.blur();
    stopWorkout();
  });

  // Limpiar destino fijado en el mapa
  DOM.btnClearTarget.addEventListener('click', (e) => {
    e.stopPropagation();
    clearTargetCoords();
  });

  // Selector del Simulador
  DOM.chkSimulate.addEventListener('change', (e) => {
    if (e.target.checked) {
      if (AppState.activeRide.isRecording) {
        BiciGPS.stopTracking();
        startDemoSimulation();
      } else {
        AppState.simulation.isActive = true;
      }
    } else {
      if (AppState.activeRide.isRecording) {
        stopDemoSimulation();
        BiciGPS.startTracking(
          AppState.settings,
          (gpsData) => {
            if (AppState.activeRide.isAutoPaused) return;

            AppState.activeRide.speed = gpsData.speed;
            AppState.activeRide.distance = gpsData.distance;
            AppState.activeRide.ascent = gpsData.ascent;
            AppState.activeRide.grade = gpsData.grade;
            AppState.activeRide.power = gpsData.power;
            AppState.activeRide.lat = gpsData.latitude;
            AppState.activeRide.lon = gpsData.longitude;
            
            DOM.liveSpeed.textContent = gpsData.speed.toFixed(1);
            DOM.liveDistance.textContent = gpsData.distance.toFixed(2);
            DOM.liveAscent.textContent = Math.round(gpsData.ascent);
            DOM.liveGrade.textContent = Math.round(gpsData.grade) + '%';
            DOM.liveWatts.textContent = Math.round(gpsData.power);

            if (AppState.recMap && gpsData.latitude && gpsData.longitude) {
              const newPos = [gpsData.latitude, gpsData.longitude];
              AppState.recMarker.setLatLng(newPos);
              AppState.recPathLine.addLatLng(newPos);
              AppState.recMap.panTo(newPos);
              updateTargetDistance();
            }
            updateClimbProUI(gpsData.climbInfo);
          }
        );
      } else {
        AppState.simulation.isActive = false;
      }
    }
  });

  // Borrar rodada actual
  DOM.btnDeleteRide.addEventListener('click', () => {
    if (AppState.selectedRide) {
      if (confirm(`¿Estás seguro de que quieres eliminar la rodada "${AppState.selectedRide.title}"?`)) {
        Storage.deleteRide(AppState.selectedRide.timestamp);
        navigateTo('dashboard');
      }
    }
  });

  // Guardar Ajustes
  DOM.settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const useAuto = DOM.setUseAuto.checked;
    let manualZones = {};

    if (!useAuto) {
      const zones = ['z1', 'z2', 'z3', 'z4', 'z5'];
      for (const z of zones) {
        const minVal = parseInt(document.getElementById(`${z}-min`).value) || 0;
        const maxVal = parseInt(document.getElementById(`${z}-max`).value) || 0;
        manualZones[z] = { min: minVal, max: maxVal };
      }
    }

    const updatedSettings = {
      age: parseInt(DOM.setAge.value) || 30,
      weight: parseInt(DOM.setWeight.value) || 70,
      bikeWeight: parseInt(DOM.setBikeWeight.value) || 10,
      autoPause: DOM.setAutopause.checked,
      useAutoZones: useAuto,
      manualZones: useAuto ? AppState.settings.manualZones : manualZones
    };

    Storage.saveSettings(updatedSettings);
    loadDashboardData(); // Recargar zonas
    navigateTo('dashboard');
  });

  // Comportamiento del Switch de Auto Zonas en Ajustes
  DOM.setUseAuto.addEventListener('change', (e) => {
    if (e.target.checked) {
      DOM.manualZonesContainer.classList.add('hide');
      DOM.autoZonesPreview.classList.remove('hide');
      updateAutoZonesPreview();
    } else {
      DOM.manualZonesContainer.classList.remove('hide');
      DOM.autoZonesPreview.classList.add('hide');
      
      const settings = Storage.getSettings();
      Object.keys(settings.manualZones).forEach(zone => {
        document.getElementById(`${zone}-min`).value = settings.manualZones[zone].min;
        document.getElementById(`${zone}-max`).value = settings.manualZones[zone].max;
      });
    }
  });

  // Escuchar cambios en edad para actualizar previsualización automática
  DOM.setAge.addEventListener('input', () => {
    if (DOM.setUseAuto.checked) {
      updateAutoZonesPreview();
    }
  });
});

// Registrar Service Worker para soporte offline PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registrado con éxito:', reg.scope))
      .catch(err => console.error('Error al registrar Service Worker:', err));
  });
}
