// js/alertas.js
//
// ============================================================
// Sistema de Alerta Meteorológica — Buscador Lugares Antamina
// ------------------------------------------------------------
// Orquesta los 12 efectos visuales cuando llega una alerta desde
// Firestore (js/mensajes.js). Diseñado para no romper la app si
// algún efecto falla (cada uno está aislado en try/catch).
//
// 1.  Banner de alerta a pantalla completa
// 2.  Flash de fondo
// 3.  Barra superior permanente
// 4.  Tarjeta flotante
// 5.  Pulso radar alrededor del icono
// 6.  Contador regresivo
// 7.  Mapa iluminado (círculo rojo + rayo)
// 8.  Efecto sirena (borde rojo↔naranja)
// 9.  Niveles de alerta estandarizados
// 10. Iconografía grande
// 11. Animación del rayo SVG
// 12. Botones de acción destacados
// ============================================================

// Importar funciones de sonido para el loop de 30 segundos
import { reproducirSonidoAlerta, detenerSonidoAlerta } from "./notifications.js";

// ----------------------------------------------------------
// Definición de niveles de alerta (característica #9)
// ----------------------------------------------------------
export const NIVELES_ALERTA = {
    vigilancia: {
        nombre: "Vigilancia",
        color: "#2ecc71",
        colorDark: "#27ae60",
        glow: "rgba(46,204,113,0.6)",
        icono: "🟢",
        iconoBig: "🌩️",
        descripcion: "Actividad eléctrica lejana.",
        recomendacion: "Manténgase informado sobre el desarrollo del clima."
    },
    amarilla: {
    nombre: "Alerta amarilla",
    color: "#f1c40f",
    colorDark: "#c9a003",
    glow: "rgba(241,196,15,0.6)",
    icono: "🟡",
    iconoBig: "⚡",
    descripcion: "Posibles descargas eléctricas en la zona.",
    recomendacion: "Manténgase atento a la evolución de la actividad eléctrica."
    },
    naranja: {
    nombre: "Alerta naranja",
    color: "#e67e22",
    colorDark: "#b9530f",
    glow: "rgba(230,126,34,0.65)",
    icono: "🟠",
    iconoBig: "⚡",
    descripcion: "Actividad eléctrica cercana.",
    recomendacion: "Evite actividades al aire libre."
    },
    roja: {
    nombre: "Alerta roja",
    color: "#e74c3c",
    colorDark: "#c0392b",
    glow: "rgba(231,76,60,0.7)",
    icono: "🔴",
    iconoBig: "⚡",
    descripcion: "Actividad eléctrica muy cercana.",
    recomendacion: "Refúgiese inmediatamente."
    }
};

// ----------------------------------------------------------
// Medidas de seguridad según el nivel (para el botón #12)
// ----------------------------------------------------------
const MEDIDAS_SEGURIDAD = {
    vigilancia: [
        { icono: "📡", texto: "<strong>Monitoree</strong> los partes meteorológicos locales." },
        { icono: "📱", texto: "Mantenga su dispositivo <strong>cargado</strong> por si hay cortes." },
        { icono: "👀", texto: "Observe la evolución de las nubes en la zona." }
    ],
    precaucion: [
        { icono: "🏠", texto: "Identifique <strong>lugares seguros</strong> cercanos." },
        { icono: "🚫", texto: "Evite el uso de <strong>equipos eléctricos sensibles</strong>." },
        { icono: "⚡", texto: "Aléjese de <strong>estructuras metálicas</strong> elevadas." },
        { icono: "☂️", texto: "Tenga a mano <strong>paraguas e impermeables</strong>." }
    ],
    alerta: [
        { icono: "🏃", texto: "<strong>Suspenda</strong> toda actividad al aire libre." },
        { icono: "🏠", texto: "Busque <strong>refugio en edificaciones</strong> cerradas." },
        { icono: "🌳", texto: "Aléjese de <strong>árboles solitarios</strong> y postes." },
        { icono: "💧", texto: "Evite <strong>contacto con agua</strong> (no se bañe ni lave)." },
        { icono: "🔌", texto: "<strong>Desconecte</strong> equipos electrónicos sensibles." }
    ],
    emergencia: [
        { icono: "🏛️", texto: "<strong>Refúgiese de inmediato</strong> en un lugar cerrado." },
        { icono: "🚫", texto: "No toque <strong>metales ni agua</strong>." },
        { icono: "🪑", texto: "Adopte posición de <strong>cuclillas</strong>, pies juntos." },
        { icono: "📱", texto: "Mantenga el <strong>móvil cargado</strong>, evite llamadas con cable." },
        { icono: "🚗", texto: "Dentro de un <strong>vehículo</strong> es seguro (jaula de Faraday)." },
        { icono: "❤️", texto: "Si alguien es fulminado, llame a <strong>emergencias</strong>." }
    ]
};

// ----------------------------------------------------------
// SVG del rayo (característica #11)
// ----------------------------------------------------------
const SVG_RAYO = `
<svg class="al-rayo-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="alRayoGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff7c2"/>
      <stop offset="50%" stop-color="#ffeb3b"/>
      <stop offset="100%" stop-color="#ffb300"/>
    </linearGradient>
  </defs>
  <polygon points="58,5 30,52 48,52 38,95 72,42 52,42 62,5" fill="url(#alRayoGrad)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

const SVG_RAYO_MAPA = `
<svg class="al-mapa-rayo-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <polygon points="58,5 30,52 48,52 38,95 72,42 52,42 62,5" fill="#ffeb3b" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
</svg>`;

// ----------------------------------------------------------
// Estado interno
// ----------------------------------------------------------
let alertaActiva = false;
let intervalContador = null;
let intervalSirena = null;
let intervalTimestamp = null;
let intervalRayoMapa = null;
let tiempoInicioAlerta = null;
let capaMapaAlerta = null;   // capa Leaflet con rayo + núcleo + pulso
let mapaRef = null;          // referencia al mapa Leaflet
let idAlertaMapa = 0;        // identifica la alerta de mapa vigente

// ----------------------------------------------------------
// DURACIÓN DEL TIMER DE ALERTA (15 minutos por defecto)
// ----------------------------------------------------------
const DURACION_TIMER_MINUTOS = 15;

// ----------------------------------------------------------
// Inyección del HTML base (contenedores) en el DOM
// ----------------------------------------------------------
function asegurarEstructuraDOM() {
    if (document.getElementById("al-overlay")) return;

    const html = `
    <!-- 1. BANNER A PANTALLA COMPLETA -->
    <div id="al-overlay" role="alertdialog" aria-modal="true" aria-labelledby="al-titulo-texto">
        <div class="al-panel" id="al-panel">
            <div class="al-icono-wrap">
                <span class="al-radar r1"></span>
                <span class="al-radar r2"></span>
                <span class="al-radar r3"></span>
                <span class="al-icono" id="al-icono-big">⚡</span>
                ${SVG_RAYO}
            </div>
            <div style="text-align:center;">
                <span class="al-nivel-badge" id="al-nivel-badge">EMERGENCIA</span>
            </div>
            <h2 class="al-titulo" id="al-titulo-texto">⚡ ALERTA DE TORMENTA ELÉCTRICA</h2>
            <p class="al-mensaje" id="al-mensaje-texto">Se detectó actividad eléctrica en la zona.</p>
            <p class="al-recomendacion" id="al-recomendacion-texto">Refúgiese inmediatamente.</p>
            <div class="al-contador-wrap" id="al-contador-wrap" style="display:none;">
                <div class="al-contador-label">⏰ Finaliza en</div>
                <div class="al-contador" id="al-contador">00:00:00</div>
            </div>
            <div class="al-botones">
                <button class="al-btn al-btn-primario" id="al-btn-mapa">📍 Ver mapa</button>
                <button class="al-btn al-btn-secundario" id="al-btn-seguridad">🛡️ Medidas de seguridad</button>
                <button class="al-btn al-btn-cerrar" id="al-btn-cerrar">Entendido</button>
            </div>
        </div>
    </div>

    <!-- 3. BARRA SUPERIOR PERMANENTE -->
    <div id="al-barra-superior" role="alert">
        <span class="al-barra-icono" id="al-barra-icono">⚡</span>
        <span class="al-barra-texto">
            <span class="al-barra-nivel" id="al-barra-nivel">ALERTA ROJA</span><br>
            <span class="al-barra-desc" id="al-barra-desc">Tormenta eléctrica intensa</span>
        </span>
        <span class="al-barra-tiempo" id="al-barra-tiempo">Hace 2 minutos</span>
        <button class="al-barra-cerrar" id="al-barra-cerrar" aria-label="Cerrar barra">×</button>
    </div>

    <!-- 4. TARJETA FLOTANTE -->
    <div id="al-tarjeta" role="alert">
        <button class="al-tarjeta-cerrar" id="al-tarjeta-cerrar" aria-label="Cerrar tarjeta">×</button>
        <div class="al-tarjeta-header">
            <span class="al-tarjeta-icono" id="al-tarjeta-icono">⚡</span>
            <div>
                <div class="al-tarjeta-sub" id="al-tarjeta-sub">ALERTA</div>
                <h3 class="al-tarjeta-titulo" id="al-tarjeta-titulo">Tormenta eléctrica</h3>
            </div>
        </div>
        <div class="al-tarjeta-cuerpo" id="al-tarjeta-cuerpo"></div>
        <button class="al-tarjeta-btn" id="al-tarjeta-btn">Ver</button>
    </div>

    <!-- MODAL DE MEDIDAS DE SEGURIDAD -->
    <div id="al-modal-seguridad" role="dialog" aria-modal="true">
        <div class="al-modal-contenido">
            <h3 class="al-modal-titulo">🛡️ Medidas de seguridad</h3>
            <div class="al-modal-sub" id="al-modal-sub">NIVEL DE ALERTA</div>
            <div class="al-leyenda" id="al-leyenda"></div>
            <div id="al-medidas-lista"></div>
            <button class="al-modal-cerrar" id="al-modal-cerrar">Entendido</button>
        </div>
    </div>`;

    const cont = document.createElement("div");
    cont.innerHTML = html;
    // Mover los elementos al body (no envolverlos en un div extra)
    while (cont.firstChild) {
        document.body.appendChild(cont.firstChild);
    }

    // Conectar eventos
    document.getElementById("al-btn-cerrar").addEventListener("click", () => cerrarAlerta());
    document.getElementById("al-btn-mapa").addEventListener("click", () => verMapaAlerta());
    document.getElementById("al-btn-seguridad").addEventListener("click", () => mostrarModalSeguridad());
    document.getElementById("al-modal-cerrar").addEventListener("click", () => cerrarModalSeguridad());
    document.getElementById("al-modal-seguridad").addEventListener("click", (e) => {
        if (e.target.id === "al-modal-seguridad") cerrarModalSeguridad();
    });
    document.getElementById("al-barra-cerrar").addEventListener("click", (e) => {
        e.stopPropagation();
        ocultarBarraSuperior();
    });
    document.getElementById("al-barra-superior").addEventListener("click", () => abrirBannerDeNuevo());
    document.getElementById("al-tarjeta-cerrar").addEventListener("click", () => ocultarTarjeta());
    document.getElementById("al-tarjeta-btn").addEventListener("click", () => abrirBannerDeNuevo());

    // Cerrar con Escape
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (document.getElementById("al-modal-seguridad").classList.contains("al-visible")) {
                cerrarModalSeguridad();
            } else if (document.getElementById("al-overlay").classList.contains("al-visible")) {
                cerrarAlerta();
            }
        }
    });
}

// ----------------------------------------------------------
// IMPORTAR el módulo del mapa de forma dinámica (para no
// crear dependencia circular). map.js expone iluminarDistrito.
// ----------------------------------------------------------
async function obtenerModuloMapa() {
    try {
        const mod = await import("./map.js");
        return mod;
    } catch (e) {
        console.warn("alertas.js: no se pudo importar map.js", e);
        return null;
    }
}

// ----------------------------------------------------------
// FUNCIÓN PRINCIPAL: mostrarAlertaCompleta(datos)
// datos = {
//   nivel: "vigilancia"|"amarilla"|"naranja"|"roja",
//   titulo: string,
//   mensaje: string,
//   distrito: string,
//   lat: number|null,
//   lng: number|null,
//   duracionMin: number|null
// }
// ----------------------------------------------------------
export async function mostrarAlertaCompleta(datos = {}) {
    try {
        asegurarEstructuraDOM();

        const nivelKey = NIVELES_ALERTA[datos.nivel] ? datos.nivel : "roja";
        const nivel = NIVELES_ALERTA[nivelKey];

        // Detener cualquier alerta previa
        detenerIntervalos();
        limpiarMapaAlerta();

        // Invalidar cualquier operación asíncrona de la alerta anterior
        idAlertaMapa++;
        const miIdAlerta = idAlertaMapa;

        alertaActiva = true;

        // Usar el mismo timestamp de Firestore que utiliza el contador.
        tiempoInicioAlerta =
            (typeof datos.timestampInicio === "number" && datos.timestampInicio > 0)
                ? datos.timestampInicio
                : Date.now();

        // Aplicar variables CSS del nivel a los contenedores
        const vars = [
            ["--al-color", nivel.color],
            ["--al-color-dark", nivel.colorDark],
            ["--al-glow", nivel.glow]
        ];
        const aplicarVars = (el) => {
            if (!el) return;
            vars.forEach(([k, v]) => el.style.setProperty(k, v));
        };
        aplicarVars(document.getElementById("al-overlay"));
        aplicarVars(document.getElementById("al-panel"));
        aplicarVars(document.getElementById("al-barra-superior"));
        aplicarVars(document.getElementById("al-tarjeta"));
        aplicarVars(document.getElementById("al-modal-seguridad"));

        // Quitar modo "libre" de barra y tarjeta (ahora son de alerta real)
        document.getElementById("al-barra-superior")?.classList.remove("al-modo-libre");
        document.getElementById("al-tarjeta")?.classList.remove("al-modo-libre");

        // ----- 1. BANNER A PANTALLA COMPLETA -----
        document.getElementById("al-icono-big").textContent = nivel.iconoBig;
        document.getElementById("al-nivel-badge").textContent = nivel.nombre;
        document.getElementById("al-titulo-texto").textContent = datos.titulo || "⚡ ALERTA DE TORMENTA ELÉCTRICA";
        document.getElementById("al-mensaje-texto").textContent =
            datos.mensaje || `Se detectó actividad eléctrica${datos.distrito ? " en " + datos.distrito : ""}.`;
        document.getElementById("al-recomendacion-texto").textContent = nivel.recomendacion;

        // Reiniciar animaciones del panel (quitar y re-añadir clases)
        const panel = document.getElementById("al-panel");
        panel.classList.remove("al-resplandor-activo", "al-sirena-activa");
        void panel.offsetWidth; // forzar reflow

        // Mostrar overlay (estado de alerta real: quitar clase "libre")
        const overlay = document.getElementById("al-overlay");
        overlay.classList.remove("al-libre");
        overlay.classList.add("al-visible");
        panel.classList.add("al-sirena-activa");

        // ----- 2. FLASH DE FONDO (solo en entrada, no repetitivo) -----
        activarFlashFondo();

        // ----- 3. BARRA SUPERIOR PERMANENTE -----
        document.getElementById("al-barra-icono").textContent = nivel.iconoBig;
        document.getElementById("al-barra-nivel").textContent =
            (nivel.nombre + " " + (nivelKey === "emergencia" ? "🔴" : nivelKey === "alerta" ? "🟠" : nivelKey === "precaucion" ? "🟡" : "🟢")).toUpperCase();
        document.getElementById("al-barra-desc").textContent = datos.titulo || "Tormenta eléctrica";
        document.getElementById("al-barra-tiempo").textContent = "Hace unos segundos";
        document.getElementById("al-barra-superior").classList.add("al-visible");
        iniciarTimestampBarra();

        // ----- 4. TARJETA FLOTANTE -----
        document.getElementById("al-tarjeta-icono").textContent = nivel.iconoBig;
        document.getElementById("al-tarjeta-sub").textContent = ("ALERTA " + nivel.nombre).toUpperCase();
        document.getElementById("al-tarjeta-titulo").textContent = datos.titulo || "Tormenta eléctrica";
        const cuerpo = [];
        if (datos.distrito) cuerpo.push(`<strong>📍 Distrito:</strong> ${datos.distrito}`);
        // if (datos.intensidad) cuerpo.push(`<strong>📊 Intensidad:</strong> ${datos.intensidad}`);
        cuerpo.push(`<strong>⚡ Nivel:</strong> ${nivel.nombre}`);
        document.getElementById("al-tarjeta-cuerpo").innerHTML = cuerpo.join("<br>");
        // Mostrar con un pequeño retardo para que entre después del banner
        setTimeout(() => {
            document.getElementById("al-tarjeta").classList.add("al-visible");
        }, 700);

        // ----- 6. CONTADOR REGRESIVO SINCRONIZADO -----
        // El contador se sincroniza entre TODOS los navegadores usando
        // el timestampInicio real del documento de Firestore que envió
        // el admin. De este modo, todos los navegadores calculan el
        // tiempo restante a partir del mismo instante y el contador
        // llega a cero al mismo tiempo en todas partes.
        //
        // datos.timestampInicio = milisegundos (epoch) del momento en
        //   que el admin emitió la alerta (guardado en Firestore).
        // datos.duracionMin = duración total en minutos (15 por defecto).
        const duracionMin = (datos.duracionMin && datos.duracionMin > 0)
            ? datos.duracionMin
            : DURACION_TIMER_MINUTOS;
        const duracionMs = duracionMin * 60 * 1000;
        const tsInicio = (typeof datos.timestampInicio === "number" && datos.timestampInicio > 0)
            ? datos.timestampInicio
            : Date.now(); // fallback: si no hay timestamp, usar ahora
        iniciarContadorSincronizado(tsInicio, duracionMs);

        // ----- 7. MAPA ILUMINADO -----
        // Solo se crea UNA capa de alerta: rayo + núcleo + pulso.
        // Esto evita duplicar los efectos cuando también existe distrito.
        if (datos.lat != null && datos.lng != null) {
            iluminarMapa(datos.lat, datos.lng, nivelKey, miIdAlerta);
        }

        // ----- 7b. PINTAR POLÍGONO DE ZONA -----
        // Si se especifica un distrito/zona, pintar el polígono con el color de la alerta
        if (datos.distrito) {
            pintarZonaEnMapa(datos.distrito, nivel.color, miIdAlerta);
        }

        // ----- SONIDO EN LOOP (30 segundos) -----
        // Las alertas amarilla, naranja y roja reproducen sonido en loop por 30 segundos
        if (nivelKey !== "vigilancia") {
            try {
                reproducirSonidoAlerta(30);
            } catch (e) { /* no crítico */ }
        }

        // Enfocar el botón de cerrar para accesibilidad
        setTimeout(() => document.getElementById("al-btn-cerrar").focus(), 1000);

    } catch (e) {
        console.error("alertas.js: error al mostrar alerta", e);
    }
}

// ----------------------------------------------------------
// 2. FLASH DE FONDO
// ----------------------------------------------------------
function activarFlashFondo() {
    try {
        const body = document.body;
        body.classList.remove("al-flash-activo");
        void body.offsetWidth;
        body.classList.add("al-flash-activo");
        setTimeout(() => body.classList.remove("al-flash-activo"), 4600);
    } catch (e) { /* no crítico */ }
}

// ----------------------------------------------------------
// 6. CONTADOR REGRESIVO
// ----------------------------------------------------------
function iniciarContador(segundosTotales) {
    let restante = segundosTotales;
    const el = document.getElementById("al-contador");
    const wrap = document.getElementById("al-contador-wrap");
    if (!el || !wrap) return;
    wrap.style.display = "block";

    const formatear = (s) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const seg = s % 60;
        return [h, m, seg].map(v => String(v).padStart(2, "0")).join(":");
    };

    el.textContent = formatear(restante);
    el.classList.remove("al-critico");

    if (intervalContador) clearInterval(intervalContador);
    intervalContador = setInterval(() => {
        restante--;
        if (restante <= 0) {
            el.textContent = "00:00:00";
            el.classList.remove("al-critico");
            clearInterval(intervalContador);
            intervalContador = null;
            return;
        }
        el.textContent = formatear(restante);
        // Últimos 60 segundos: parpadeo crítico
        if (restante <= 60) {
            el.classList.add("al-critico");
        }
    }, 1000);
}

// ----------------------------------------------------------
// 6b. CONTADOR REGRESIVO SINCRONIZADO ENTRE NAVEGADORES
// ----------------------------------------------------------
// A diferencia de iniciarContador(), este usa un timestamp de
// inicio REAL (el momento en que el admin emitió la alerta) en
// lugar de Date.now() local. Así, todos los navegadores calculan
// el tiempo restante a partir del mismo instante y el contador
// llega a cero al mismo tiempo en todas partes.
//
// @param {number} timestampInicio - epoch ms del inicio de la alerta
// @param {number} duracionMs - duración total en milisegundos
function iniciarContadorSincronizado(timestampInicio, duracionMs) {
    const el = document.getElementById("al-contador");
    const wrap = document.getElementById("al-contador-wrap");
    if (!el || !wrap) return;
    wrap.style.display = "block";

    const formatear = (s) => {
        if (s < 0) s = 0;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const seg = s % 60;
        return [h, m, seg].map(v => String(v).padStart(2, "0")).join(":");
    };

    // Función que calcula el tiempo restante a partir del timestamp real
    const calcularRestante = () => {
        const ahora = Date.now();
        const transcurrido = ahora - timestampInicio;
        return Math.ceil((duracionMs - transcurrido) / 1000); // segundos restantes
    };

    // Limpieza de interval previo
    if (intervalContador) { clearInterval(intervalContador); intervalContador = null; }

    const actualizar = () => {
        let restante = calcularRestante();
        if (restante <= 0) {
            el.textContent = "00:00:00";
            el.classList.remove("al-critico");

            clearInterval(intervalContador);
            intervalContador = null;

            // La alerta expira AHORA. Invalidar cualquier operación
            // asíncrona que todavía pudiera crear efectos en el mapa.
            alertaActiva = false;
            idAlertaMapa++;

            detenerSonidoAlerta();
            limpiarMapaAlerta();

            // Restaurar inmediatamente el estado normal.
            mostrarAlertaLibre();
            return;
        }
        el.textContent = formatear(restante);
        // Últimos 60 segundos: parpadeo crítico
        if (restante <= 60) {
            el.classList.add("al-critico");
        } else {
            el.classList.remove("al-critico");
        }
    };

    // Actualización inmediata + intervalo de 1 segundo
    actualizar();
    intervalContador = setInterval(actualizar, 1000);
}

// ----------------------------------------------------------
// 3. Timestamp "Hace X minutos" en la barra superior
// ----------------------------------------------------------
function iniciarTimestampBarra() {
    const el = document.getElementById("al-barra-tiempo");
    if (!el) return;
    const actualizar = () => {
        if (!tiempoInicioAlerta) return;
        const diff = Math.floor((Date.now() - tiempoInicioAlerta) / 1000);
        let txt;
        if (diff < 60) txt = `Hace ${diff} seg`;
        else if (diff < 3600) txt = `Hace ${Math.floor(diff / 60)} min`;
        else txt = `Hace ${Math.floor(diff / 3600)} h`;
        el.textContent = txt;
    };
    actualizar();
    if (intervalTimestamp) clearInterval(intervalTimestamp);
    intervalTimestamp = setInterval(actualizar, 15000);
}

// ----------------------------------------------------------
// 7. MAPA ILUMINADO (círculo rojo parpadeante + rayo)
// ----------------------------------------------------------
async function iluminarMapa(lat, lng, nivelKey, miIdAlerta) {
    try {
        const mod = await obtenerModuloMapa();

        // La alerta pudo expirar mientras esperábamos el módulo.
        if (!alertaActiva || miIdAlerta !== idAlertaMapa) {
            return;
        }

        if (!mod || typeof mod.iluminarDistrito !== "function") {
            // Compatibilidad con versiones antiguas.
            iluminarMapaLegacy(lat, lng, nivelKey);

            if (!alertaActiva || miIdAlerta !== idAlertaMapa) {
                limpiarMapaAlerta();
            }
            return;
        }

        const capa = await mod.iluminarDistrito(lat, lng, nivelKey);

        // Si la alerta terminó durante el await, destruir inmediatamente
        // la capa recién creada en lugar de dejarla visible.
        if (!alertaActiva || miIdAlerta !== idAlertaMapa) {
            if (capa && typeof capa.detener === "function") {
                capa.detener();
            }
            return;
        }

        capaMapaAlerta = capa;

    } catch (e) {
        console.warn("alertas.js: error iluminando mapa", e);
    }
}

// Respaldo para una versión antigua de map.js.
// La versión actual de map.js es la que se utiliza normalmente.
function iluminarMapaLegacy(lat, lng, nivelKey) {
    try {
        if (typeof L === "undefined") return;

        const nivel = NIVELES_ALERTA[nivelKey] || NIVELES_ALERTA.roja;
        const mapEl = document.getElementById("map");
        if (!mapEl) return;

        const mapInstance = Object.values(L._maps || {})
            .find(m => m.getContainer() === mapEl)
            || window.__leafMap
            || null;

        if (!mapInstance) return;
        mapaRef = mapInstance;

        const color = nivel.color;

        const nucleo = L.circleMarker([lat, lng], {
            radius: 10,
            color: "#fff",
            weight: 2,
            fillColor: color,
            fillOpacity: 0.95
        }).addTo(mapInstance);

        const rayoIcon = L.divIcon({
            className: "al-mapa-rayo",
            html: SVG_RAYO_MAPA,
            iconSize: [50, 50],
            iconAnchor: [25, 25]
        });
        const rayoMarker = L.marker([lat, lng], {
            icon: rayoIcon,
            zIndexOffset: 2000
        }).addTo(mapInstance);

        const pulsoIcon = L.divIcon({
            className: "",
            html: `<div style="width:40px;height:40px;border-radius:50%;
                     border:3px solid ${color};position:relative;
                     animation:al-radar-pulso 2s ease-out infinite;"></div>`,
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });
        const pulsoMarker = L.marker([lat, lng], {
            icon: pulsoIcon,
            zIndexOffset: 1900
        }).addTo(mapInstance);

        capaMapaAlerta = {
            map: mapInstance,
            nucleo,
            rayoMarker,
            pulsoMarker,
            detener() {
                try { mapInstance.removeLayer(nucleo); } catch (e) {}
                try { mapInstance.removeLayer(rayoMarker); } catch (e) {}
                try { mapInstance.removeLayer(pulsoMarker); } catch (e) {}
            }
        };

        mapInstance.flyTo([lat, lng], 12, { duration: 1.4 });

    } catch (e) {
        console.warn("alertas.js: iluminarMapaLegacy falló", e);
    }
}

function limpiarMapaAlerta() {
    try {
        if (intervalRayoMapa) {
            clearInterval(intervalRayoMapa);
            intervalRayoMapa = null;
        }

        if (!capaMapaAlerta) return;

        const capa = capaMapaAlerta;
        capaMapaAlerta = null;

        // La implementación actual de map.js elimina los tres elementos.
        if (typeof capa.detener === "function") {
            capa.detener();
            return;
        }

        // Compatibilidad con objetos de versiones anteriores.
        if (capa.map) {
            ["circulo", "circuloMedio", "nucleo", "rayoMarker", "pulsoMarker"]
                .forEach(nombre => {
                    if (capa[nombre]) {
                        try { capa.map.removeLayer(capa[nombre]); } catch (e) {}
                    }
                });
        }

    } catch (e) {
        capaMapaAlerta = null;
        console.warn("alertas.js: error limpiando mapa de alerta", e);
    }
}

// ----------------------------------------------------------
// PINTAR POLÍGONO DE ZONA EN EL MAPA
// ----------------------------------------------------------
async function pintarZonaEnMapa(nombreZona, color, miIdAlerta) {
    try {
        const mod = await obtenerModuloMapa();
        if (!mod || typeof mod.pintarPoligonoZona !== "function") return;

        await mod.pintarPoligonoZona(nombreZona, color);

        // No permitir que un polígono creado tarde sobreviva a la alerta.
        if (!alertaActiva || miIdAlerta !== idAlertaMapa) {
            if (typeof mod.limpiarPoligonosZona === "function") {
                mod.limpiarPoligonosZona();
            }
        }
    } catch (e) {
        console.warn("alertas.js: error pintando zona", e);
    }
}

// ----------------------------------------------------------
// ILUMINAR ZONA EN EL MAPA (efecto del rayo sobre punto real)
// ----------------------------------------------------------
// Busca el punto real de la zona en el GeoJSON (lugares.json)
// y pinta el efecto del rayo (círculos concéntricos + rayo SVG)
// sobre ese punto.
async function iluminarZonaEnMapa(nombreZona, nivelKey) {
    try {
        const mod = await obtenerModuloMapa();
        if (mod && typeof mod.iluminarDistritoZona === "function") {
            await mod.iluminarDistritoZona(nombreZona, nivelKey);
        }
    } catch (e) {
        console.warn("alertas.js: error iluminando zona en mapa", e);
    }
}

// ----------------------------------------------------------
// MOSTRAR BARRA SUPERIOR + TARJETA "LIBRE DE ALERTAS" (verde persistente)
// ----------------------------------------------------------
// Esta función muestra SOLAMENTE la barra superior verde y la
// tarjeta flotante verde indicando "LIBRE DE ALERTAS", SIN el
// overlay a pantalla completa. Estas dos elementos se quedan
// visibles permanentemente hasta que el admin lance una alerta
// amarilla/naranja/roja (en cuyo caso se reemplazan por las del
// nivel correspondiente).
//
// Se llama:
//  - Al cerrar el banner del overlay (cerrarAlerta) si no hay
//    alerta activa del admin.
//  - Como parte de mostrarAlertaLibre() (junto con el overlay).
export function mostrarBarraTarjetaLibre() {
    try {
        asegurarEstructuraDOM();

        const nivel = NIVELES_ALERTA.vigilancia;

        // Aplicar variables CSS del nivel verde a barra y tarjeta
        const vars = [
            ["--al-color", nivel.color],
            ["--al-color-dark", nivel.colorDark],
            ["--al-glow", nivel.glow]
        ];
        const aplicarVars = (el) => {
            if (!el) return;
            vars.forEach(([k, v]) => el.style.setProperty(k, v));
        };

        const barra = document.getElementById("al-barra-superior");
        const tarjeta = document.getElementById("al-tarjeta");

        aplicarVars(barra);
        aplicarVars(tarjeta);

        // Marcar barra y tarjeta como modo "libre" (verde persistente)
        barra?.classList.add("al-modo-libre");
        tarjeta?.classList.add("al-modo-libre");

        // ----- BARRA SUPERIOR VERDE -----
        document.getElementById("al-barra-icono").textContent = "✅";
        document.getElementById("al-barra-nivel").textContent = "LIBRE DE ALERTAS";
        document.getElementById("al-barra-desc").textContent = "Sistema en vigilancia — sin alertas activas";
        document.getElementById("al-barra-tiempo").textContent = "Vigilancia";
        barra?.classList.add("al-visible");

        // ----- TARJETA FLOTANTE VERDE -----
        document.getElementById("al-tarjeta-icono").textContent = "✅";
        document.getElementById("al-tarjeta-sub").textContent = "VIGILANCIA";
        document.getElementById("al-tarjeta-titulo").textContent = "Libre de alertas";
        document.getElementById("al-tarjeta-cuerpo").innerHTML =
            "<strong>🟢 Estado:</strong> Sin alertas meteorológicas<br>" +
            "<strong>📍 Sistema:</strong> En vigilancia";
        tarjeta?.classList.add("al-visible");

    } catch (e) {
        console.error("alertas.js: error al mostrar barra/tarjeta libre", e);
    }
}

// ----------------------------------------------------------
// MOSTRAR ESTADO "LIBRE DE ALERTAS" (verde por defecto)
// ----------------------------------------------------------
// Esta función muestra la notificación full-screen en verde
// indicando que no hay alertas activas. Se muestra al cargar
// la página y cuando el usuario consulta sin que el admin haya
// emitido ninguna alerta.
export function mostrarAlertaLibre() {
    try {
        asegurarEstructuraDOM();
        detenerIntervalos();
        idAlertaMapa++;
        limpiarMapaAlerta();
        detenerSonidoAlerta();

        // Limpiar polígonos de zona
        obtenerModuloMapa().then(mod => {
            if (mod && typeof mod.limpiarPoligonosZona === "function") {
                mod.limpiarPoligonosZona();
            }
        }).catch(() => {});

        alertaActiva = false;
        tiempoInicioAlerta = null;

        const nivel = NIVELES_ALERTA.vigilancia;

        // Aplicar variables CSS del nivel verde
        const vars = [
            ["--al-color", nivel.color],
            ["--al-color-dark", nivel.colorDark],
            ["--al-glow", nivel.glow]
        ];
        const aplicarVars = (el) => {
            if (!el) return;
            vars.forEach(([k, v]) => el.style.setProperty(k, v));
        };
        aplicarVars(document.getElementById("al-overlay"));
        aplicarVars(document.getElementById("al-panel"));
        aplicarVars(document.getElementById("al-barra-superior"));
        aplicarVars(document.getElementById("al-tarjeta"));
        aplicarVars(document.getElementById("al-modal-seguridad"));

        // Configurar contenido para "Libre de alertas"
        document.getElementById("al-icono-big").textContent = "✅";
        document.getElementById("al-nivel-badge").textContent = "VIGILANCIA";
        document.getElementById("al-nivel-badge").style.background = nivel.color;
        document.getElementById("al-titulo-texto").textContent = "🟢 LIBRE DE ALERTAS";
        document.getElementById("al-mensaje-texto").textContent =
            "No se han emitido alertas meteorológicas. El sistema se encuentra en vigilancia.";
        document.getElementById("al-recomendacion-texto").textContent =
            "Manténgase informado sobre el desarrollo del clima.";

        // Ocultar contador (no hay timer en estado libre)
        const wrap = document.getElementById("al-contador-wrap");
        if (wrap) wrap.style.display = "none";

        // Mostrar overlay con clase de estado libre (verde sereno)
        const panel = document.getElementById("al-panel");
        panel.classList.remove("al-resplandor-activo", "al-sirena-activa");
        void panel.offsetWidth;
        const overlay = document.getElementById("al-overlay");
        overlay.classList.add("al-visible", "al-libre");

        // Mostrar también la barra superior verde y la tarjeta flotante
        // verde de forma persistente (se quedarán visibles después de que
        // el usuario cierre el overlay, hasta que el admin lance una alerta)
        mostrarBarraTarjetaLibre();

        // Enfocar el botón de cerrar
        setTimeout(() => document.getElementById("al-btn-cerrar")?.focus(), 1000);

    } catch (e) {
        console.error("alertas.js: error al mostrar alerta libre", e);
    }
}

// ----------------------------------------------------------
// 12. BOTONES DE ACCIÓN
// ----------------------------------------------------------
function verMapaAlerta() {
    try {
        cerrarBanner(); // quitar el overlay para ver el mapa
        if (capaMapaAlerta && capaMapaAlerta.map) {
            // ya está iluminado; solo asegurar zoom
        }
        const mapEl = document.getElementById("map");
        if (mapEl) {
            mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    } catch (e) { /* no crítico */ }
}

function abrirBannerDeNuevo() {
    const overlay = document.getElementById("al-overlay");
    if (overlay && !overlay.classList.contains("al-visible")) {
        overlay.classList.add("al-visible");
        const panel = document.getElementById("al-panel");
        if (panel) {
            panel.classList.remove("al-sirena-activa");
            void panel.offsetWidth;
            panel.classList.add("al-sirena-activa");
        }
    }
}

// ----------------------------------------------------------
// MODAL DE MEDIDAS DE SEGURIDAD
// ----------------------------------------------------------
function mostrarModalSeguridad() {
    try {
        // Determinar nivel activo (leído del badge)
        const badge = document.getElementById("al-nivel-badge");
        const nivelNombre = (badge?.textContent || "Emergencia").toLowerCase();
        let nivelKey = Object.keys(NIVELES_ALERTA).find(k =>
            NIVELES_ALERTA[k].nombre.toLowerCase() === nivelNombre);
        if (!nivelKey) nivelKey = "emergencia";
        const nivel = NIVELES_ALERTA[nivelKey];

        // Subtítulo
        document.getElementById("al-modal-sub").textContent =
            ("NIVEL: " + nivel.nombre).toUpperCase();
        document.getElementById("al-modal-seguridad").style.setProperty("--al-color", nivel.color);

        // Leyenda de niveles (característica #9)
        const leyenda = document.getElementById("al-leyenda");
        leyenda.innerHTML = "";
        Object.entries(NIVELES_ALERTA).forEach(([k, n]) => {
            const item = document.createElement("div");
            item.className = "al-leyenda-item";
            item.innerHTML = `
                <span class="al-leyenda-punto" style="background:${n.color}"></span>
                <span class="al-leyenda-nombre">${n.icono} ${n.nombre}</span>
                <span class="al-leyenda-desc">— ${n.descripcion}</span>`;
            leyenda.appendChild(item);
        });

        // Medidas
        const lista = document.getElementById("al-medidas-lista");
        lista.innerHTML = "";
        MEDIDAS_SEGURIDAD[nivelKey].forEach(m => {
            const d = document.createElement("div");
            d.className = "al-medida";
            d.innerHTML = `<span class="al-medida-icono">${m.icono}</span><span class="al-medida-texto">${m.texto}</span>`;
            lista.appendChild(d);
        });

        document.getElementById("al-modal-seguridad").classList.add("al-visible");
    } catch (e) {
        console.error("alertas.js: error modal seguridad", e);
    }
}

function cerrarModalSeguridad() {
    document.getElementById("al-modal-seguridad")?.classList.remove("al-visible");
}

// ----------------------------------------------------------
// CERRAR ALERTA
// ----------------------------------------------------------
function cerrarBanner() {
    const overlay = document.getElementById("al-overlay");
    overlay?.classList.remove("al-visible");
    overlay?.classList.remove("al-libre");
}

function ocultarBarraSuperior() {
    // En modo "libre" (verde persistente) la barra SIEMPRE se queda
    // visible: el usuario no puede ocultarla manualmente.
    const barra = document.getElementById("al-barra-superior");
    if (barra?.classList.contains("al-modo-libre")) return;
    barra?.classList.remove("al-visible");
    if (intervalTimestamp) { clearInterval(intervalTimestamp); intervalTimestamp = null; }
}

function ocultarTarjeta() {
    // En modo "libre" (verde persistente) la tarjeta SIEMPRE se queda
    // visible: el usuario no puede ocultarla manualmente.
    const tarjeta = document.getElementById("al-tarjeta");
    if (tarjeta?.classList.contains("al-modo-libre")) return;
    tarjeta?.classList.remove("al-visible");
}

export function cerrarAlerta() {
    cerrarBanner();
    detenerSonidoAlerta();
    // NOTA: No se detienen los intervalos del contador aquí.
    // El usuario cierra solo el overlay del banner, pero el
    // contador sincronizado y la barra/tarjeta siguen visibles.
    //
    // Si no hay una alerta activa (estado libre), asegurar que
    // la barra y tarjeta verdes persistentes se muestren.
    if (!alertaActiva) {
        mostrarBarraTarjetaLibre();
    }
}

// Cierre total (limpia TODO: banner, barra, tarjeta, mapa, intervalos)
export function cerrarAlertaTotal() {
    cerrarBanner();
    ocultarBarraSuperior();
    ocultarTarjeta();
    cerrarModalSeguridad();
    detenerIntervalos();
    idAlertaMapa++;
    detenerSonidoAlerta();
    limpiarMapaAlerta();
    // Limpiar polígonos de zona
    obtenerModuloMapa().then(mod => {
        if (mod && typeof mod.limpiarPoligonosZona === "function") {
            mod.limpiarPoligonosZona();
        }
    }).catch(() => {});
    alertaActiva = false;
}

function detenerIntervalos() {
    if (intervalContador) { clearInterval(intervalContador); intervalContador = null; }
    if (intervalSirena) { clearInterval(intervalSirena); intervalSirena = null; }
    if (intervalTimestamp) { clearInterval(intervalTimestamp); intervalTimestamp = null; }
}

// ----------------------------------------------------------
// Utilidad: ¿hay una alerta activa?
// ----------------------------------------------------------
export function hayAlertaActiva() {
    return alertaActiva;
}