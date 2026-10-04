// js/data.js
// ============================================================
//  Carga de lugares desde KML (con fallback a lugares.json)
//  - Mismo contrato de salida que antes: array de objetos
//    { id, nombre, tipo, lat, lng, alt, feature }
//  - Normaliza properties.Name (togeojson produce .name)
//  - Si el KML falla, cae al JSON antiguo sin romper la app
// ============================================================

let geojsonOriginal = null;

const KML_URL  = "./lugares.kml";
const JSON_URL = "./lugares.json";   // respaldo

// ======================================================
// CARGA PRINCIPAL
// ======================================================

export async function cargarLugares() {

    let geojson = null;

    // 1) Intentar KML
    try {
        geojson = await cargarDesdeKML(KML_URL);
        console.info(
            `data.js: KML cargado (${geojson.features.length} features)`
        );
    } catch (err) {
        console.warn("data.js: fallo KML, usando JSON de respaldo:", err);
    }

    // 2) Fallback a JSON si el KML falló
    if (!geojson) {
        geojson = await cargarDesdeJSON(JSON_URL);
        console.info(
            `data.js: JSON cargado (${geojson.features.length} features)`
        );
    }

    geojsonOriginal = geojson;

    // 3) Normalizar y aplanar → mismo formato que antes
    return geojson.features.map((feature, index) => {
        return normalizarFeature(feature, index);
    });
}


// ======================================================
// KML → GeoJSON
// ======================================================

async function cargarDesdeKML(url) {

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);

    const kmlText = await res.text();
    if (!kmlText || kmlText.length < 50) {
        throw new Error("KML vacío o demasiado corto");
    }

    const kmlDom = new DOMParser().parseFromString(kmlText, "text/xml");

    // Detectar errores de parseo XML
    const parserError = kmlDom.querySelector("parsererror");
    if (parserError) throw new Error("KML con XML inválido");

    // togeojson.umd.js expone window.toGeoJSON
    if (!window.toGeoJSON || typeof window.toGeoJSON.kml !== "function") {
        throw new Error("togeojson no está cargado");
    }

    const geojson = window.toGeoJSON.kml(kmlDom);

    if (!geojson || !Array.isArray(geojson.features)) {
        throw new Error("togeojson no devolvió features");
    }

    // Normalizar properties: togeojson usa .name, la app usa .Name
    geojson.features.forEach(f => {
        const p = f.properties || {};
        f.properties = {
            ...p,
            Name: p.Name || p.name || "Sin nombre"
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
// Normalizar Feature → objeto plano (mismo contrato de antes)
// ======================================================

function normalizarFeature(feature, index) {

    const tipo = feature.geometry?.type || "Unknown";

    let lng = null;
    let lat = null;
    let alt = 0;

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

            // MultiLineString / MultiPolygon → añade si los usas
            default:
                break;
        }
    }

    return {
        id: index,
        nombre: feature.properties?.Name || `Elemento ${index + 1}`,
        tipo,
        lat,
        lng,
        alt,
        feature
    };
}


// ======================================================
// API pública existente (sin cambios)
// ======================================================

export function obtenerGeoJSON() {
    return geojsonOriginal;
}
