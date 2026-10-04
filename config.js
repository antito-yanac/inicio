// config.js
// ============================================================
// Configuración del Monitor Keraunos — Scraper Termux
// ============================================================

module.exports = {

    // --------------------------------------------------------
    //  FIX: la URL debe ser la FUENTE REAL de Keraunos.
    //  Antes apuntaba a "https://antito-yanac.github.io/antito-yanac-test/"
    //  que es la SALIDA del propio scraper (referencia circular):
    //  esa página usa .sector-box, pero el scraper busca
    //  .card.card-activo -> 0 coincidencias -> todo salía VERDE.
    // --------------------------------------------------------
    URL: "https://qr.keraunos.co/t/mHMsMSjw7fLzlVFzMsh9K99cFG7tiC",

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

    // Claves CORTAS. El scraper las busca por coincidencia parcial
    // dentro del nombre completo de cada tarjeta (ver buscarZona()).
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

