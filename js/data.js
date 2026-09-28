// js/data.js

let geojsonOriginal = null;

export async function cargarLugares() {

    const respuesta = await fetch("./lugares.json");

    if (!respuesta.ok) {
        throw new Error("No se pudo cargar lugares.json");
    }

    geojsonOriginal = await respuesta.json();

    return geojsonOriginal.features.map((feature, index) => {

        const tipo = feature.geometry.type;

        let lng = null;
        let lat = null;
        let alt = 0;

        switch (tipo) {

            case "Point":

                lng = feature.geometry.coordinates[0];
                lat = feature.geometry.coordinates[1];
                alt = feature.geometry.coordinates[2] || 0;

                break;

            case "LineString":

                const mitad = Math.floor(feature.geometry.coordinates.length / 2);

                lng = feature.geometry.coordinates[mitad][0];
                lat = feature.geometry.coordinates[mitad][1];
                alt = feature.geometry.coordinates[mitad][2] || 0;

                break;

            case "Polygon":

                lng = feature.geometry.coordinates[0][0][0];
                lat = feature.geometry.coordinates[0][0][1];
                alt = feature.geometry.coordinates[0][0][2] || 0;

                break;

            default:

                break;

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

    });

}

export function obtenerGeoJSON() {

    return geojsonOriginal;

}