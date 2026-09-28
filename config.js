// config.js
// ============================================================
// Configuración del Monitor Keraunos — Scraper Termux
// ============================================================

module.exports = {

    URL: "https://antito-yanac.github.io/antito-yanac-test/",

    ARCHIVO_JSON: "estado.json",
    ARCHIVO_LOG:  "monitor.log",

    INTERVALO: 60 * 1000,

    SUBIR_A_GITHUB: true,

    SECTORES_ESPERADOS: [
        "Campamento Yanacancha",
        "Oficinas Mina",
        "Tucush",
        "Tajo"
    ],

    INCLUIR_SECTORES_EXTRA: false,

    MAPA_ZONAS: {
        "Campamento Yanacancha": "Zona 1 - Campamentos",
        "Oficinas Mina":         "Zona 2 - Botadero Este",
        "Tucush":                "Zona 3 - Tucush",
        "Tajo":                  "Zona 4 - Tajo"
    },

    COORDENADAS_ZONAS: {
        "Zona 1 - Campamentos":   { lat: -9.5822364, lng: -77.0223100 },
        "Zona 2 - Botadero Este": { lat: -9.5718388, lng: -77.0447182 },
        "Zona 3 - Tucush":        { lat: -9.5263487, lng: -77.0485794 },
        "Zona 4 - Tajo":          { lat: -9.5416465, lng: -77.0707659 }
    },

    DURACION_DEFAULT_MIN: 15
};
