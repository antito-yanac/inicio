// js/data.js
// ============================================================
//  Carga de lugares desde KML (con fallback a JSON)
//  v3: extrae CARPETA padre + expone obtenerCarpetas()
// ============================================================

let geojsonOriginal = null;

const KML_URL  = "./lugares.kml";
const JSON_URL = "./lugares.json";   // respaldo


// ======================================================
// CARGA PRINCIPAL
// ======================================================

export async function cargarLugares() {

    let geojson = null;

    try {
        geojson = await cargarDesdeKML(KML_URL);
        console.info(`data.js: KML cargado (${geojson.features.length} features)`);
    } catch (err) {
        console.warn("data.js: fallo KML, usando JSON de respaldo:", err);
    }

    if (!geojson) {
        geojson = await cargarDesdeJSON(JSON_URL);
        console.info(`data.js: JSON cargado (${geojson.features.length} features)`);
    }

    geojsonOriginal = geojson;

    return geojson.features.map((feature, index) => normalizarFeature(feature, index));
}


// ======================================================
// KML → GeoJSON (con carpetas)
// ======================================================

async function cargarDesdeKML(url) {

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);

    const kmlText = await res.text();
    if (!kmlText || kmlText.length < 50) throw new Error("KML vacío");

    const kmlDom = new DOMParser().parseFromString(kmlText, "text/xml");
    if (kmlDom.querySelector("parsererror")) throw new Error("KML con XML inválido");

    if (!window.toGeoJSON || typeof window.toGeoJSON.kml !== "function") {
        throw new Error("togeojson no está cargado");
    }

    const geojson = window.toGeoJSON.kml(kmlDom);
    if (!geojson || !Array.isArray(geojson.features)) {
        throw new Error("togeojson no devolvió features");
    }

    // 👇 MAPEO Placemark ↔ Feature ↔ Carpeta
    const placemarks = kmlDom.querySelectorAll("Placemark");

    if (placemarks.length !== geojson.features.length) {
        console.warn(
            `data.js: desfase Placemarks (${placemarks.length}) ` +
            `vs features (${geojson.features.length}).`
        );
    }

    placemarks.forEach((pm, i) => {
        if (!geojson.features[i]) return;

        // Subir por el DOM hasta el Folder padre
        let padre = pm.parentElement;
        let carpeta = "(Raíz)";
        while (padre) {
            if (padre.tagName === "Folder") {
                const n = padre.querySelector(":scope > name");
                if (n) carpeta = n.textContent.trim();
                break;
            }
            padre = padre.parentElement;
        }

        const p = geojson.features[i].properties || {};
        geojson.features[i].properties = {
            ...p,
            Name:    p.Name || p.name || "Sin nombre",
            carpeta: carpeta
        };
    });

    return geojson;
}


// ======================================================
// JSON → GeoJSON (respaldo)
// ======================================================

async function cargarDesdeJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo cargar ${url}`);
    const json = await res.json();
    if (json.type === "FeatureCollection" && Array.isArray(json.features)) {
        return json;
    }
    throw new Error("JSON no es una FeatureCollection válida");
}


// ======================================================
// Normalizar Feature → objeto plano
// ======================================================

function normalizarFeature(feature, index) {

    const tipo = feature.geometry?.type || "Unknown";

    let lng = null, lat = null, alt = 0;

    if (feature.geometry?.coordinates) {
        switch (tipo) {
            case "Point":
                lng = feature.geometry.coordinates[0];
                lat = feature.geometry.coordinates[1];
                alt = feature.geometry.coordinates[2] || 0;
                break;
            case "LineString": {
                const arr = feature.geometry.coordinates;
                const mitad = Math.floor(arr.length / 2);
                lng = arr[mitad][0];
                lat = arr[mitad][1];
                alt = arr[mitad][2] || 0;
                break;
            }
            case "Polygon":
                lng = feature.geometry.coordinates[0][0][0];
                lat = feature.geometry.coordinates[0][0][1];
                alt = feature.geometry.coordinates[0][0][2] || 0;
                break;
            case "MultiPoint":
                lng = feature.geometry.coordinates[0][0];
                lat = feature.geometry.coordinates[0][1];
                alt = feature.geometry.coordinates[0][2] || 0;
                break;
            default:
                break;
        }
    }

    // Inyectar 'tipo' en las properties para filtrarLugares()
    feature.properties = { ...feature.properties, tipo };

    return {
        id: index,
        nombre: feature.properties?.Name || `Elemento ${index + 1}`,
        tipo,
        carpeta: feature.properties?.carpeta || "(Raíz)",
        lat, lng, alt,
        feature
    };
}


// ======================================================
// API pública
// ======================================================

export function obtenerGeoJSON() {
    return geojsonOriginal;
}

// ⬅️ NUEVO: devuelve la lista de carpetas únicas
export function obtenerCarpetas(lugares) {
    const set = new Set();
    lugares.forEach(l => { if (l.carpeta) set.add(l.carpeta); });

    return Array.from(set).sort((a, b) => {
        if (a === "(Raíz)") return -1;
        if (b === "(Raíz)") return 1;
        return a.localeCompare(b, "es");
    });
}
