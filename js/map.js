// js/map.js
// ============================================================
//  Mapa Leaflet — Antamina
//  v3: soporta MÚLTIPLES polígonos de zona simultáneos
//      (uno por zona activa), y permite quitar uno solo.
// ============================================================

let map;
let geoLayer;
let markerSeleccionado = null;

const MAPTILER_KEY = "j4zAW83dNrfEbSRUvYN0";
const MAP_STYLE = "hybrid-v4";

let markerUbicacion = null;
let circleAccuracy = null;
let watchId = null;
let iconoTu = null;

// ======================================================
// Paleta unificada
// ======================================================
const COLORES_NIVEL = {
    vigilancia: "#2ecc71",
    amarilla:   "#f1c40f",
    naranja:    "#e67e22",
    roja:       "#e74c3c",
    // Alias legacy
    precaucion: "#f1c40f",
    alerta:     "#e67e22",
    emergencia: "#e74c3c"
};

function colorDeNivel(nivelKey) {
    return COLORES_NIVEL[nivelKey] || COLORES_NIVEL.roja;
}

// ======================================================
//  MAPA DE POLÍGONOS ACTIVOS
//  Estructura: Map<nombreZona, { poligono, color }>
//  Así podemos tener N zonas pintadas a la vez.
// ======================================================
const poligonosActivos = new Map();  // nombreZona -> { poligono, color }
let zonasData = null;

// ======================================================
// ILUMINAR DISTRITO — rayo + núcleo + pulso sobre un punto
// ======================================================
export function iluminarDistrito(lat, lng, nivelKey = "roja") {
    if (!map) return null;

    const color = colorDeNivel(nivelKey);

    const nucleo = L.circleMarker([lat, lng], {
        radius: 10,
        color: "#fff",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95
    }).addTo(map);

    const rayoIcon = L.divIcon({
        className: "al-mapa-rayo",
        html: `<svg class="al-mapa-rayo-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                 <polygon points="58,5 30,52 48,52 38,95 72,42 52,42 62,5"
                          fill="#ffeb3b" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
               </svg>`,
        iconSize: [50, 50],
        iconAnchor: [25, 25]
    });
    const rayoMarker = L.marker([lat, lng], {
        icon: rayoIcon,
        zIndexOffset: 2000
    }).addTo(map);

    const pulsoIcon = L.divIcon({
        className: "",
        html: `<div style="width:40px;height:40px;border-radius:50%;
                 border:3px solid ${color};position:relative;
                 animation:al-radar-pulso 2s ease-out infinite;"></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });
    const pulsoMarker = L.marker([lat, lng], { icon: pulsoIcon, zIndexOffset: 1900 }).addTo(map);

    nucleo.bindPopup(
        `<b>⚡ Zona de alerta</b><br>` +
        `Actividad eléctrica detectada<br>` +
        `Lat: ${lat.toFixed(5)}<br>Lng: ${lng.toFixed(5)}`
    );

    let pulsoVisible = true;
    const intervalParpadeo = setInterval(() => {
        pulsoVisible = !pulsoVisible;
        const elementoPulso = pulsoMarker.getElement();
        if (elementoPulso) {
            elementoPulso.style.opacity = pulsoVisible ? "1" : "0.35";
        }
        if (nucleo) {
            nucleo.setStyle({ fillOpacity: pulsoVisible ? 0.95 : 0.55 });
        }
    }, 700);

    map.flyTo([lat, lng], 12, { duration: 1.4 });

    return {
        map, nucleo, rayoMarker, pulsoMarker, intervalParpadeo,
        detener() {
            clearInterval(intervalParpadeo);
            try { map.removeLayer(nucleo); } catch(e){}
            try { map.removeLayer(rayoMarker); } catch(e){}
            try { map.removeLayer(pulsoMarker); } catch(e){}
        }
    };
}

// ======================================================
// ILUMINAR ZONA DESDE GEOJSON (lugares.json)
// ======================================================
export async function iluminarDistritoZona(nombreZona, nivelKey = "roja") {
    if (!map) return null;

    const color = colorDeNivel(nivelKey);

    let puntoEncontrado = null;

    const zonaLower = (nombreZona || "").toLowerCase();
    const partes = nombreZona.split("-");
    const nombreBusqueda = partes.length > 1
        ? partes.slice(1).join("-").trim().toLowerCase()
        : zonaLower;

    if (geoLayer) {
        geoLayer.eachLayer(layer => {
            if (puntoEncontrado) return;
            const f = layer.feature;
            if (!f) return;
            if (f.geometry && f.geometry.type === "Point") {
                const nombre = (f.properties?.Name || "").toLowerCase();
                if (nombre.includes(nombreBusqueda) || nombreBusqueda.includes(nombre)) {
                    const coords = f.geometry.coordinates;
                    puntoEncontrado = {
                        lat: coords[1],
                        lng: coords[0],
                        nombre: f.properties?.Name || nombreZona,
                        layer: layer
                    };
                }
            }
        });
    }

    if (!puntoEncontrado) {
        try {
            const data = await cargarZonas();
            if (data && data.zonas) {
                const zona = data.zonas.find(z =>
                    z.nombre === nombreZona ||
                    z.nombre.includes(nombreZona) ||
                    nombreZona.includes(z.nombreCorto)
                );
                if (zona) {
                    puntoEncontrado = {
                        lat: zona.lat,
                        lng: zona.lng,
                        nombre: zona.nombre,
                        layer: null
                    };
                }
            }
        } catch (e) { /* fallback ya manejado */ }
    }

    if (!puntoEncontrado) {
        console.warn("map.js: no se encontró punto para la zona:", nombreZona);
        return null;
    }

    const lat = puntoEncontrado.lat;
    const lng = puntoEncontrado.lng;

    const circulo = L.circle([lat, lng], {
        radius: 1800, color, weight: 3, opacity: 0.9,
        fillColor: color, fillOpacity: 0.2, dashArray: "6 6"
    }).addTo(map);

    const circuloMedio = L.circle([lat, lng], {
        radius: 900, color, weight: 2, opacity: 0.7,
        fillColor: color, fillOpacity: 0.15
    }).addTo(map);

    const nucleo = L.circleMarker([lat, lng], {
        radius: 10, color: "#fff", weight: 2,
        fillColor: color, fillOpacity: 0.95
    }).addTo(map);

    const rayoIcon = L.divIcon({
        className: "al-mapa-rayo",
        html: `<svg class="al-mapa-rayo-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                 <polygon points="58,5 30,52 48,52 38,95 72,42 52,42 62,5"
                          fill="#ffeb3b" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
               </svg>`,
        iconSize: [50, 50], iconAnchor: [25, 25]
    });
    const rayoMarker = L.marker([lat, lng], {
        icon: rayoIcon, zIndexOffset: 2000
    }).addTo(map);

    const pulsoIcon = L.divIcon({
        className: "",
        html: `<div style="width:40px;height:40px;border-radius:50%;
                 border:3px solid ${color};position:relative;
                 animation:al-radar-pulso 2s ease-out infinite;"></div>`,
        iconSize: [40, 40], iconAnchor: [20, 20]
    });
    const pulsoMarker = L.marker([lat, lng], { icon: pulsoIcon, zIndexOffset: 1900 }).addTo(map);

    circulo.bindPopup(
        `<b>⚡ Zona de alerta</b><br>` +
        `Actividad eléctrica detectada<br>` +
        `<b>${puntoEncontrado.nombre}</b><br>` +
        `Lat: ${lat.toFixed(5)}<br>Lng: ${lng.toFixed(5)}`
    );

    let parpadeoOn = true;
    const intervalParpadeo = setInterval(() => {
        parpadeoOn = !parpadeoOn;
        circulo.setStyle({ fillOpacity: parpadeoOn ? 0.35 : 0.12, opacity: parpadeoOn ? 0.9 : 0.4 });
        circuloMedio.setStyle({ fillOpacity: parpadeoOn ? 0.25 : 0.08, opacity: parpadeoOn ? 0.7 : 0.3 });
    }, 700);

    map.flyTo([lat, lng], 12, { duration: 1.4 });

    return {
        map, circulo, circuloMedio, nucleo, rayoMarker, pulsoMarker,
        puntoEncontrado, intervalParpadeo,
        detener() {
            clearInterval(intervalParpadeo);
            try { map.removeLayer(circulo); } catch(e){}
            try { map.removeLayer(circuloMedio); } catch(e){}
            try { map.removeLayer(nucleo); } catch(e){}
            try { map.removeLayer(rayoMarker); } catch(e){}
            try { map.removeLayer(pulsoMarker); } catch(e){}
        }
    };
}

// ======================================================
// CREAR MAPA
// ======================================================
export function crearMapa(idDiv) {
    map = L.map(idDiv);

    iconoTu = L.divIcon({
        className: "",
        html: '<div style="position:relative;text-align:center;">' +
                '<div class="marker-tu"></div>' +
                '<div class="etiqueta-tu">Tú</div>' +
              '</div>',
        iconSize: [22, 22], iconAnchor: [11, 11]
    });

    L.tileLayer(
        `https://api.maptiler.com/maps/${MAP_STYLE}/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`,
        {
            tileSize: 512, zoomOffset: -1, minZoom: 1,
            attribution:
                '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> ' +
                '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>',
            crossOrigin: true
        }
    ).addTo(map);

    map.setView([-9.50, -77.00], 9);

    const btnUbicacion = document.getElementById("btn-ubicacion");
    if (btnUbicacion) {
        btnUbicacion.addEventListener("click", mostrarMiUbicacion);
    }

    return { cargarGeoJSON, irA, limpiarSeleccion, filtrarLugares };
}

// ======================================================
// MOSTRAR MI UBICACIÓN
// ======================================================
function mostrarMiUbicacion() {
    const btn = document.getElementById("btn-ubicacion");

    if (!navigator.geolocation) {
        alert("Tu navegador no soporta geolocalización.");
        return;
    }

    btn.classList.add("buscar");

    const options = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            btn.classList.remove("buscar");

            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const accuracy = pos.coords.accuracy;

            if (markerUbicacion) map.removeLayer(markerUbicacion);
            if (circleAccuracy) map.removeLayer(circleAccuracy);

            circleAccuracy = L.circle([lat, lng], {
                radius: accuracy, color: "#00c853", weight: 1.5,
                opacity: 0.4, fillColor: "#00c853", fillOpacity: 0.12
            }).addTo(map);

            markerUbicacion = L.marker([lat, lng], {
                icon: iconoTu, zIndexOffset: 1000
            }).addTo(map);

            markerUbicacion.bindPopup(
                `<b>📍 Tu ubicación</b><br>` +
                `Lat: ${lat.toFixed(6)}<br>` +
                `Lng: ${lng.toFixed(6)}<br>` +
                `Precisión: ±${Math.round(accuracy)} m`
            );

            let zoomLevel = 16;
            if (accuracy > 100) zoomLevel = 14;
            if (accuracy > 500) zoomLevel = 12;

            map.flyTo([lat, lng], zoomLevel, { duration: 1.2 });

            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            watchId = navigator.geolocation.watchPosition(
                (pos2) => {
                    if (markerUbicacion) {
                        markerUbicacion.setLatLng([pos2.coords.latitude, pos2.coords.longitude]);
                    }
                    if (circleAccuracy) {
                        circleAccuracy.setLatLng([pos2.coords.latitude, pos2.coords.longitude]);
                        circleAccuracy.setRadius(pos2.coords.accuracy);
                    }
                },
                () => {},
                { enableHighAccuracy: true, maximumAge: 5000 }
            );
        },
        (error) => {
            btn.classList.remove("buscar");
            let mensaje = "No se pudo obtener tu ubicación.\n\n";
            switch (error.code) {
                case error.PERMISSION_DENIED:
                    mensaje += "⛔ Permiso denegado.";
                    break;
                case error.POSITION_UNAVAILABLE:
                    mensaje += "📡 Posición no disponible.";
                    break;
                case error.TIMEOUT:
                    mensaje += "⏱️ Tiempo agotado.";
                    break;
                default:
                    mensaje += "Error desconocido: " + error.message;
            }
            alert(mensaje);
        },
        options
    );
}

// ======================================================
// CARGAR GEOJSON
// ======================================================
function cargarGeoJSON(lugares) {
    if (geoLayer) geoLayer.remove();

    const geojson = {
        type: "FeatureCollection",
        features: lugares.map(l => l.feature)
    };

    geoLayer = L.geoJSON(geojson, {
        pointToLayer(feature, latlng) {
            return L.circleMarker(latlng, {
                radius: 7, fillColor: "#4285f4", color: "#ffffff",
                weight: 2, opacity: 1, fillOpacity: 0.9
            });
        },
        onEachFeature(feature, layer) {
            const nombre = feature.properties?.Name || "Sin nombre";
            layer.bindPopup(`<b>${nombre}</b><br>${feature.geometry.type}`);
        }
    }).addTo(map);

    map.fitBounds(geoLayer.getBounds(), { padding: [30, 30] });
}

function limpiarSeleccion() {
    if (markerSeleccionado) {
        markerSeleccionado.setStyle({ fillColor: "#4285f4", radius: 7 });
    }
}

function irA(lugar) {
    limpiarSeleccion();

    map.flyTo([lugar.lat, lugar.lng], 18, { duration: 1.2 });

    map.once("moveend", () => {
        const desplazamientoY = Math.round(map.getSize().y * 0.10);
        map.panBy([0, desplazamientoY], { animate: true, duration: 0.5 });
    });

    geoLayer.eachLayer(layer => {
        const f = layer.feature;
        if (f === lugar.feature) {
            markerSeleccionado = layer;
            if (layer.setStyle) {
                layer.setStyle({ radius: 11, fillColor: "#ff4444" });
            }
            layer.openPopup();
        }
    });
}

// ======================================================
// CARGAR ZONAS.JSON
// ======================================================
async function cargarZonas() {
    if (zonasData) return zonasData;
    try {
        const resp = await fetch("./zonas.json");
        zonasData = await resp.json();
        return zonasData;
    } catch (e) {
        console.warn("map.js: no se pudo cargar zonas.json", e);
        return null;
    }
}

// ======================================================
// PINTAR POLÍGONO DE ZONA (SOPORTA N SIMULTÁNEOS)
// ======================================================
/**
 * Pinta el polígono de la zona indicada SIN borrar los demás.
 * Si ya existía un polígono para esa zona, lo reemplaza (borra
 * el anterior y pinta el nuevo con el color actualizado).
 *
 * @param {string} nombreZona - Nombre de la zona (ej: "Zona 1 - Campamentos")
 * @param {string} color - Color hex (ej: "#e74c3c")
 * @returns {Promise<object|null>}
 */
export async function pintarPoligonoZona(nombreZona, color = "#e74c3c") {
    if (!map) return null;

    // Si ya hay un polígono para esa zona, quitarlo (para repintar con nuevo color)
    quitarPoligonoZona(nombreZona);

    const data = await cargarZonas();
    if (!data || !data.zonas) return null;

    const zona = data.zonas.find(z =>
        z.nombre === nombreZona ||
        z.nombreCorto === nombreZona ||
        z.nombre.includes(nombreZona) ||
        nombreZona.includes(z.nombreCorto)
    );

    if (!zona) {
        console.warn("map.js: zona no encontrada:", nombreZona);
        return null;
    }

    const latlngs = zona.poligono.map(coord => [coord[1], coord[0]]);

    const poligono = L.polygon(latlngs, {
        color, weight: 4, opacity: 0.9,
        fillColor: color, fillOpacity: 0.3, dashArray: "10 6"
    }).addTo(map);

    poligono.bindPopup(
        `<b>⚡ ${zona.nombre}</b><br>Zona bajo alerta meteorológica`
    );

    // Registrar en el Map de polígonos activos
    poligonosActivos.set(zona.nombre, { poligono, color });

    // NO hacemos flyTo aquí para no mover el mapa cada vez que se
    // pinta una nueva zona. El flyTo se hace una sola vez cuando
    // se recibe la primera alerta (ver iluminarDistrito).
    // Si quieres que vuele, descomenta:
    // if (zona.lat && zona.lng) map.flyTo([zona.lat, zona.lng], 13, { duration: 1.4 });

    return {
        zona, poligono,
        detener() { quitarPoligonoZona(zona.nombre); }
    };
}

// ======================================================
// QUITAR UN POLÍGONO ESPECÍFICO
// ======================================================
/**
 * Quita el polígono de una zona específica (por nombre).
 * @param {string} nombreZona
 * @returns {boolean} true si se quitó algo, false si no existía
 */
export function quitarPoligonoZona(nombreZona) {
    if (!map) return false;

    // Buscar por nombre exacto o parcial
    for (const [key, entry] of poligonosActivos.entries()) {
        if (key === nombreZona ||
            key.includes(nombreZona) ||
            nombreZona.includes(key)) {
            try { map.removeLayer(entry.poligono); } catch (e) {}
            poligonosActivos.delete(key);
            return true;
        }
    }
    return false;
}

// ======================================================
// QUITAR TODOS LOS POLÍGONOS
// ======================================================
export function limpiarPoligonosZona() {
    if (!map) return;
    for (const [, entry] of poligonosActivos.entries()) {
        try { map.removeLayer(entry.poligono); } catch (e) {}
    }
    poligonosActivos.clear();
}

// ======================================================
// CONSULTAR POLÍGONOS ACTIVOS (útil para debug)
// ======================================================
export function obtenerPoligonosActivos() {
    return Array.from(poligonosActivos.keys());
}
// ======================================================
// FILTRAR LUGARES (oculta/muestra capas existentes)
// ------------------------------------------------------
// Recibe un predicado (props) => boolean.
// NO reconstruye geoLayer → rápido y sin parpadeos.
// Devuelve el número de features visibles.
// ======================================================
export function filtrarLugares(predicado) {
    if (!geoLayer || typeof predicado !== "function") return 0;

    let visibles = 0;

    geoLayer.eachLayer(layer => {
        const f = layer.feature;
        if (!f) return;

        const props = f.properties || {};
        const mostrar = predicado(props);

        if (mostrar) {
            if (!map.hasLayer(layer)) layer.addTo(map);
            visibles++;
        } else {
            if (map.hasLayer(layer)) map.removeLayer(layer);
        }
    });

    return visibles;
}
