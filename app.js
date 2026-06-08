// app.js - Orquestador Principal de la Aplicación BiciLog

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

  // Datos de la rodada actual
  activeRide: {
    isRecording: false,
    isPaused: false,
    timerInterval: null,
    elapsedSeconds: 0,
    distance: 0,
    speed: 0,
    ascent: 0,
    hr: 0,
    cadence: 0,
    respiration: 0,
    temp: 22,
    
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
  liveRespiration: document.getElementById('live-respiration'),
  liveTemp: document.getElementById('live-temp'),
  chkSimulate: document.getElementById('chk-simulate-data'),
  btnPauseRide: document.getElementById('btn-pause-ride'),
  btnResumeRide: document.getElementById('btn-resume-ride'),
  btnStopRide: document.getElementById('btn-stop-ride'),

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
  setUseAuto: document.getElementById('set-use-auto'),
  manualZonesContainer: document.getElementById('manual-zones-container'),
  autoZonesPreview: document.getElementById('auto-zones-preview'),
  btnSettingsBack: document.getElementById('btn-settings-back')
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
  }, 100);
}

// Cargar Ajustes
function loadSettingsScreen() {
  const settings = Storage.getSettings();
  DOM.setAge.value = settings.age;
  DOM.setWeight.value = settings.weight;
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

// --- LÓGICA DE GRABACIÓN ---

function startWorkout() {
  AppState.activeRide = {
    isRecording: true,
    isPaused: false,
    timerInterval: null,
    elapsedSeconds: 0,
    distance: 0,
    speed: 0,
    ascent: 0,
    hr: 0,
    cadence: 0,
    respiration: 0,
    temp: 22,
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
  DOM.liveRespiration.textContent = '--';
  DOM.liveTemp.textContent = '22';

  // Mostrar botón de pausar y ocultar el de reanudar
  DOM.btnPauseRide.classList.remove('hide');
  DOM.btnResumeRide.classList.add('hide');

  navigateTo('recording');

  // 1. Iniciar Cronómetro
  AppState.activeRide.timerInterval = setInterval(() => {
    if (!AppState.activeRide.isPaused) {
      AppState.activeRide.elapsedSeconds++;
      DOM.liveTimer.textContent = BiciCharts.formatDuration(AppState.activeRide.elapsedSeconds);
      
      // Acumular tiempo en zonas si hay FC activa
      if (AppState.activeRide.hr > 0) {
        const zoneNum = Storage.getZoneForHR(AppState.activeRide.hr, AppState.hrZones);
        if (zoneNum > 0) {
          AppState.activeRide.zoneTimes[`z${zoneNum}`]++;
        }
      }
    }
  }, 1000);

  // 2. Iniciar Toma de Muestras (Cada 5s para el gráfico final)
  AppState.activeRide.sampleInterval = setInterval(() => {
    if (!AppState.activeRide.isPaused) {
      AppState.activeRide.samples.push({
        time: AppState.activeRide.elapsedSeconds,
        hr: AppState.activeRide.hr,
        speed: AppState.activeRide.speed,
        cadence: AppState.activeRide.cadence
      });
    }
  }, 5000);

  // 3. Iniciar GPS si el simulador no está encendido
  if (!AppState.simulation.isActive) {
    BiciGPS.startTracking(
      (gpsData) => {
        // Callback al actualizar coordenadas
        AppState.activeRide.speed = gpsData.speed;
        AppState.activeRide.distance = gpsData.distance;
        AppState.activeRide.ascent = gpsData.ascent;
        
        DOM.liveSpeed.textContent = gpsData.speed.toFixed(1);
        DOM.liveDistance.textContent = gpsData.distance.toFixed(2);
        DOM.liveAscent.textContent = Math.round(gpsData.ascent);
        DOM.gpsAccuracy.textContent = `GPS: ±${Math.round(gpsData.accuracy)}m`;
        
        // Simular temperatura variable basada en la ubicación inicial y altura
        const baseTemp = 22;
        const tempShift = -((gpsData.ascent / 100) * 0.65); // Baja 0.65°C por cada 100m de subida
        AppState.activeRide.temp = Math.round((baseTemp + tempShift) * 10) / 10;
        DOM.liveTemp.textContent = AppState.activeRide.temp;
      },
      (error) => {
        DOM.gpsAccuracy.textContent = "GPS: Error";
      }
    );
  } else {
    startDemoSimulation();
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
    BiciGPS.startTracking((gpsData) => {
      AppState.activeRide.speed = gpsData.speed;
      AppState.activeRide.distance = gpsData.distance;
      AppState.activeRide.ascent = gpsData.ascent;
      
      DOM.liveSpeed.textContent = gpsData.speed.toFixed(1);
      DOM.liveDistance.textContent = gpsData.distance.toFixed(2);
      DOM.liveAscent.textContent = Math.round(gpsData.ascent);
      DOM.gpsAccuracy.textContent = `GPS: ±${Math.round(gpsData.accuracy)}m`;
    });
  }
}

// Finalizar y Guardar
function stopWorkout() {
  // Limpiar timers
  clearInterval(AppState.activeRide.timerInterval);
  clearInterval(AppState.activeRide.sampleInterval);
  
  if (AppState.simulation.isActive) {
    stopDemoSimulation();
  } else {
    BiciGPS.stopTracking();
    BiciSensors.disconnectAll();
    resetPillsUI();
  }

  const rideData = AppState.activeRide;
  
  // Si no hay muestras (rodada muy corta), meter una inicial y final
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

  // Estimación fisiológica de la respiración promedio basada en FC Promedio
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

  // Guardar en LocalStorage
  Storage.saveRide(newRide);

  // Redirigir a vista de detalle
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
    BiciSensors.disconnectAll(); // Desconecta
    resetPillsUI();
  } else {
    DOM.btnConnectHr.textContent = 'Buscando...';
    DOM.sensorPillHr.className = 'sensor-connect-pill';
    
    try {
      await BiciSensors.connectHeartRate(
        (hrValue) => {
          // Callback de datos
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

          // Estimación fisiológica de Frecuencia Respiratoria instantánea
          // Formula: 12 + (HR - 60) / 3.5. Al subir la FC sube la frecuencia respiratoria
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
      alert("No se pudo conectar el sensor de Frecuencia Cardíaca. Asegúrate de tener Bluetooth activado y dar permisos.");
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
      alert("No se pudo conectar el sensor de Cadencia. Asegúrate de tener Bluetooth activado.");
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

  AppState.simulation.intervalId = setInterval(() => {
    if (AppState.activeRide.isPaused) return;

    // 1. Simular Fluctuación de Velocidad (20 - 35 km/h)
    const speedDelta = (Math.random() - 0.5) * 1.5;
    AppState.simulation.simSpeed = Math.min(Math.max(AppState.simulation.simSpeed + speedDelta, 18), 38);
    AppState.activeRide.speed = AppState.simulation.simSpeed;
    DOM.liveSpeed.textContent = AppState.activeRide.speed.toFixed(1);

    // 2. Simular Distancia Acumulada (aumenta según velocidad por segundo)
    // Velocidad en km/h dividida por 3600 da kilómetros por segundo
    const distancePerSecond = AppState.activeRide.speed / 3600;
    AppState.activeRide.distance += distancePerSecond;
    DOM.liveDistance.textContent = AppState.activeRide.distance.toFixed(2);

    // 3. Simular Ascenso (sube 1 metro cada ~10 segundos con pendiente suave)
    if (Math.random() > 0.85) {
      AppState.activeRide.ascent += Math.round(Math.random() * 2);
      DOM.liveAscent.textContent = Math.round(AppState.activeRide.ascent);
    }

    // 4. Simular Frecuencia Cardíaca (fluctúa entre 110 y 165 según esfuerzo)
    // Si la velocidad es alta, la FC tiende a subir
    const speedRatio = (AppState.activeRide.speed - 18) / 20; // 0 a 1
    const targetHR = 110 + speedRatio * 50;
    const hrDelta = (targetHR - AppState.simulation.simHr) * 0.1 + (Math.random() - 0.5) * 4;
    AppState.simulation.simHr = Math.round(Math.min(Math.max(AppState.simulation.simHr + hrDelta, 90), 185));
    AppState.activeRide.hr = AppState.simulation.simHr;
    DOM.liveHr.textContent = AppState.activeRide.hr;

    // Actualizar zonas en vivo para simulador
    const zone = Storage.getZoneForHR(AppState.activeRide.hr, AppState.hrZones);
    if (zone > 0) {
      DOM.liveHrZone.textContent = `Z${zone}`;
      DOM.liveHrZone.className = `hr-zone-tag z${zone}-dot`;
      DOM.liveHrZone.style.backgroundColor = BiciCharts.ZONE_COLORS[`z${zone}`];
      DOM.liveHrZone.classList.remove('hide');
    }

    // 5. Simular Cadencia (fluctúa entre 75 y 95 RPM)
    const cadDelta = (Math.random() - 0.5) * 3;
    AppState.simulation.simCad = Math.round(Math.min(Math.max(AppState.simulation.simCad + cadDelta, 60), 110));
    AppState.activeRide.cadence = AppState.simulation.simCad;
    DOM.liveCadence.textContent = AppState.activeRide.cadence;

    // 6. Simular Respiración
    const respRate = Math.round(12 + (AppState.activeRide.hr - 60) / 3.5);
    AppState.activeRide.respiration = respRate;
    DOM.liveRespiration.textContent = respRate;

    // 7. Simular Temperatura
    DOM.liveTemp.textContent = AppState.activeRide.temp;

  }, 1000);
}

function stopDemoSimulation() {
  AppState.simulation.isActive = false;
  clearInterval(AppState.simulation.intervalId);
  resetPillsUI();
  DOM.gpsAccuracy.textContent = "GPS: --";
}

// --- INICIALIZADORES Y EVENTOS ---

document.addEventListener('DOMContentLoaded', () => {
  // Cargar estado inicial
  loadDashboardData();

  // --- REGISTRO DE EVENTOS DE BOTONES ---

  // Navegación Básica
  DOM.btnOpenSettings.addEventListener('click', () => navigateTo('settings'));
  DOM.btnSettingsBack.addEventListener('click', () => navigateTo('dashboard'));
  DOM.btnDetailBack.addEventListener('click', () => navigateTo('dashboard'));

  // Iniciar Rodada
  DOM.btnStartRide.addEventListener('click', () => {
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
  DOM.btnPauseRide.addEventListener('click', pauseWorkout);
  DOM.btnResumeRide.addEventListener('click', resumeWorkout);
  DOM.btnStopRide.addEventListener('click', stopWorkout);

  // Selector del Simulador
  DOM.chkSimulate.addEventListener('change', (e) => {
    if (e.target.checked) {
      if (AppState.activeRide.isRecording) {
        // Si ya está rodando, arrancar simulador de golpe
        BiciGPS.stopTracking();
        startDemoSimulation();
      } else {
        AppState.simulation.isActive = true;
      }
    } else {
      if (AppState.activeRide.isRecording) {
        stopDemoSimulation();
        // Volver a GPS real
        BiciGPS.startTracking((gpsData) => {
          AppState.activeRide.speed = gpsData.speed;
          AppState.activeRide.distance = gpsData.distance;
          AppState.activeRide.ascent = gpsData.ascent;
          DOM.liveSpeed.textContent = gpsData.speed.toFixed(1);
          DOM.liveDistance.textContent = gpsData.distance.toFixed(2);
          DOM.liveAscent.textContent = Math.round(gpsData.ascent);
        });
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
      // Tomar valores de los inputs manuales
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
      useAutoZones: useAuto,
      manualZones: useAuto ? AppState.settings.manualZones : manualZones
    };

    Storage.saveSettings(updatedSettings);
    loadDashboardData(); // Recargar zonas de FC
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
      
      // Llenar inputs manuales si no tenían valor
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

