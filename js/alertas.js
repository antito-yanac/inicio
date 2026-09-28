// js/alertas.js
//
// ============================================================
// Sistema de Alerta Meteorológica — v3
// ------------------------------------------------------------
// - Soporta MÚLTIPLES zonas activas simultáneamente.
// - Cola FIFO de banners (uno por zona, secuencial).
// - Barra superior y tarjeta flotante AGREGADAS (resumen).
// - Maneja "alerta-resuelta" (quita una zona específica).
// - Cuando todas las zonas vuelven a VERDE → "Libre de alertas".
// - Cada zona tiene su propio contador sincronizado.
// - Mapa: N polígonos (delegado a map.js v3).
// ============================================================

import { reproducirSonidoAlerta, detenerSonidoAlerta } from "./notifications.js";

// ----------------------------------------------------------
// Niveles de alerta
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
        recomendacion: "Manténgase informado sobre el desarrollo del clima.",
        orden: 0
    },
    amarilla: {
        nombre: "Alerta amarilla",
        color: "#f1c40f",
        colorDark: "#c9a003",
        glow: "rgba(241,196,15,0.6)",
        icono: "🟡",
        iconoBig: "⚡",
        descripcion: "Posibles descargas eléctricas en la zona.",
        recomendacion: "Manténgase atento a la evolución de la actividad eléctrica.",
        orden: 1
    },
    naranja: {
        nombre: "Alerta naranja",
        color: "#e67e22",
        colorDark: "#b9530f",
        glow: "rgba(230,126,34,0.65)",
        icono: "🟠",
        iconoBig: "⚡",
        descripcion: "Actividad eléctrica cercana.",
        recomendacion: "Evite actividades al aire libre.",
        orden: 2
    },
    roja: {
        nombre: "Alerta roja",
        color: "#e74c3c",
        colorDark: "#c0392b",
        glow: "rgba(231,76,60,0.7)",
        icono: "🔴",
        iconoBig: "⚡",
        descripcion: "Actividad eléctrica muy cercana.",
        recomendacion: "Refúgiese inmediatamente.",
        orden: 3
    }
};

// ----------------------------------------------------------
// Medidas de seguridad por nivel
// ----------------------------------------------------------
const MEDIDAS_SEGURIDAD = {
    vigilancia: [
        { icono: "📡", texto: "<strong>Monitoree</strong> los partes meteorológicos locales." },
        { icono: "📱", texto: "Mantenga su dispositivo <strong>cargado</strong> por si hay cortes." },
        { icono: "👀", texto: "Observe la evolución de las nubes en la zona." }
    ],
    amarilla: [
        { icono: "🏠", texto: "Identifique <strong>lugares seguros</strong> cercanos." },
        { icono: "🚫", texto: "Evite el uso de <strong>equipos eléctricos sensibles</strong>." },
        { icono: "⚡", texto: "Aléjese de <strong>estructuras metálicas</strong> elevadas." },
        { icono: "☂️", texto: "Tenga a mano <strong>paraguas e impermeables</strong>." }
    ],
    naranja: [
        { icono: "🏃", texto: "<strong>Suspenda</strong> toda actividad al aire libre." },
        { icono: "🏠", texto: "Busque <strong>refugio en edificaciones</strong> cerradas." },
        { icono: "🌳", texto: "Aléjese de <strong>árboles solitarios</strong> y postes." },
        { icono: "💧", texto: "Evite <strong>contacto con agua</strong> (no se bañe ni lave)." },
        { icono: "🔌", texto: "<strong>Desconecte</strong> equipos electrónicos sensibles." }
    ],
    roja: [
        { icono: "🏛️", texto: "<strong>Refúgiese de inmediato</strong> en un lugar cerrado." },
        { icono: "🚫", texto: "No toque <strong>metales ni agua</strong>." },
        { icono: "🪑", texto: "Adopte posición de <strong>cuclillas</strong>, pies juntos." },
        { icono: "📱", texto: "Mantenga el <strong>móvil cargado</strong>, evite llamadas con cable." },
        { icono: "🚗", texto: "Dentro de un <strong>vehículo</strong> es seguro (jaula de Faraday)." },
        { icono: "❤️", texto: "Si alguien es fulminado, llame a <strong>emergencias</strong>." }
    ]
};

// ----------------------------------------------------------
// SVG del rayo
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

// ----------------------------------------------------------
// ESTADO INTERNO — Múltiples zonas activas
// ----------------------------------------------------------
const estado = {
    zonasActivas: new Map(),      // distrito -> { nivel, nivelKey, inicio, fin, timestampInicio, duracionMin, titulo, mensaje, sectorOriginal }
    colaBanners: [],              // array de distritos pendientes de mostrar
    bannerActual: null,           // distrito del banner actualmente abierto
    intervalContador: null,       // interval del contador del banner actual
    intervalTimestamp: null       // interval del "hace X min"
};

// ----------------------------------------------------------
// DURACIÓN DEL TIMER DE ALERTA (default, si no viene en datos)
// ----------------------------------------------------------
const DURACION_TIMER_MINUTOS = 15;

// ----------------------------------------------------------
// Inyección del HTML base
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
            <div class="al-cola-indicador" id="al-cola-indicador" style="display:none;"></div>
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
    while (cont.firstChild) {
        document.body.appendChild(cont.firstChild);
    }

    // Conectar eventos
    document.getElementById("al-btn-cerrar").addEventListener("click", () => cerrarBannerActual());
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

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (document.getElementById("al-modal-seguridad").classList.contains("al-visible")) {
                cerrarModalSeguridad();
            } else if (document.getElementById("al-overlay").classList.contains("al-visible")) {
                cerrarBannerActual();
            }
        }
    });
}

// ----------------------------------------------------------
// Importar map.js dinámicamente
// ----------------------------------------------------------
async function obtenerModuloMapa() {
    try {
        return await import("./map.js");
    } catch (e) {
        console.warn("alertas.js: no se pudo importar map.js", e);
        return null;
    }
}

// ==========================================================
// API PÚBLICA: mostrarAlertaCompleta(datos)
// ==========================================================
/**
 * Añade o actualiza una zona en alerta. Si ya estaba activa,
 * actualiza su nivel/tiempos. Si es nueva, la añade y la pone
 * en la cola de banners.
 *
 * datos = {
 *   nivel: "amarilla" | "naranja" | "roja",
 *   distrito: "Zona 1 - Campamentos",
 *   lat, lng,
 *   duracionMin, timestampInicio,
 *   sectorOriginal, inicio, fin,
 *   titulo, mensaje
 * }
 */
export async function mostrarAlertaCompleta(datos = {}) {
    try {
        asegurarEstructuraDOM();

        const nivelKey = NIVELES_ALERTA[datos.nivel] ? datos.nivel : "roja";
        const distrito = datos.distrito || `Zona ${estado.zonasActivas.size + 1}`;

        const duracionMin = (datos.duracionMin && datos.duracionMin > 0)
            ? datos.duracionMin
            : DURACION_TIMER_MINUTOS;

        const tsInicio = (typeof datos.timestampInicio === "number" && datos.timestampInicio > 0)
            ? datos.timestampInicio
            : Date.now();

        // Registrar / actualizar la zona
        const yaExistia = estado.zonasActivas.has(distrito);
        estado.zonasActivas.set(distrito, {
            nivel: nivelKey,
            nivelKey,
            distrito,
            lat: datos.lat ?? null,
            lng: datos.lng ?? null,
            duracionMin,
            timestampInicio: tsInicio,
            sectorOriginal: datos.sectorOriginal || null,
            inicio: datos.inicio || null,
            fin: datos.fin || null,
            titulo: datos.titulo || `⚡ ALERTA ${nivelKey.toUpperCase()} — ${distrito}`,
            mensaje: datos.mensaje || `Actividad eléctrica detectada en ${distrito}.`
        });

        // Pintar polígono de esa zona en el mapa (sin borrar las otras)
        if (datos.distrito) {
            const mod = await obtenerModuloMapa();
            if (mod && typeof mod.pintarPoligonoZona === "function") {
                const nivel = NIVELES_ALERTA[nivelKey];
                await mod.pintarPoligonoZona(datos.distrito, nivel.color);
            }
        }

        // Rayo sobre el punto (solo si es la primera vez que se activa esa zona)
        if (!yaExistia && datos.lat != null && datos.lng != null) {
            const mod = await obtenerModuloMapa();
            if (mod && typeof mod.iluminarDistrito === "function") {
                await mod.iluminarDistrito(datos.lat, datos.lng, nivelKey);
            }
        }

        // Añadir a la cola de banners si es nueva
        if (!yaExistia) {
            estado.colaBanners.push(distrito);
            // Ordenar la cola por criticidad: ROJA > NARANJA > AMARILLA.
            // Así, si llegan 4 alertas a la vez, el usuario ve primero
            // la más crítica.
            estado.colaBanners.sort((a, b) => {
                const za = estado.zonasActivas.get(a);
                const zb = estado.zonasActivas.get(b);
                if (!za || !zb) return 0;
                return NIVELES_ALERTA[zb.nivelKey].orden - NIVELES_ALERTA[za.nivelKey].orden;
            });
        }

        // Si no hay banner abierto, mostrar el siguiente
        if (estado.bannerActual === null) {
            mostrarSiguienteBanner();
        } else {
            // Ya hay banner abierto: actualizar indicador de cola
            actualizarIndicadorCola();
        }

        // Actualizar la barra superior y la tarjeta flotante agregadas
        actualizarBarraYTarjetaAgregadas();

        // Reproducir sonido (solo si es alerta nueva y no vigilancia)
        if (!yaExistia && nivelKey !== "vigilancia") {
            try { reproducirSonidoAlerta(30); } catch (e) {}
        }

    } catch (e) {
        console.error("alertas.js: error al mostrar alerta", e);
    }
}

// Typo-fix: la función se llama actualizarBarraYTarjetaAgregadas
function actualizarBarraYTarjetaAgregadas() {
    actualizarBarraYTarjetaAgregadas();
}

// ==========================================================
// API PÚBLICA: quitarAlerta(distrito)
// ==========================================================
/**
 * Quita una zona específica del estado de alertas.
 * - Quita el polígono del mapa.
 * - Quita el banner de la cola si estaba pendiente.
 * - Si era el banner actual, pasa al siguiente.
 * - Si no quedan zonas activas, vuelve a "Libre de alertas".
 */
export async function quitarAlerta(distrito) {
    try {
        if (!distrito) return false;

        // Buscar la zona por nombre exacto o parcial
        let distritoReal = null;
        for (const key of estado.zonasActivas.keys()) {
            if (key === distrito || key.includes(distrito) || distrito.includes(key)) {
                distritoReal = key;
                break;
            }
        }

        if (!distritoReal) return false;

        // 1) Quitar polígono del mapa
        const mod = await obtenerModuloMapa();
        if (mod && typeof mod.quitarPoligonoZona === "function") {
            mod.quitarPoligonoZona(distritoReal);
        }

        // 2) Quitar del estado
        estado.zonasActivas.delete(distritoReal);

        // 3) Quitar de la cola si estaba pendiente
        estado.colaBanners = estado.colaBanners.filter(d => d !== distritoReal);

        // 4) Si era el banner actual, cerrar y pasar al siguiente (o a libre)
        if (estado.bannerActual === distritoReal) {
            estado.bannerActual = null;
            if (estado.colaBanners.length > 0) {
                mostrarSiguienteBanner();
            } else if (estado.zonasActivas.size === 0) {
                mostrarAlertaLibre();
            } else {
                // Quedan zonas activas pero ninguna en cola
                cerrarBanner();
                actualizarBarraYTarjetaAgregadas();
            }
        } else {
            actualizarIndicadorCola();
        }

        // 5) Actualizar barra/tarjeta
        if (estado.zonasActivas.size > 0) {
            actualizarBarraYTarjetaAgregadas();
        }

        return true;

    } catch (e) {
        console.error("alertas.js: error al quitar alerta", e);
        return false;
    }
}

// ==========================================================
// COLA DE BANNERS (UI-A)
// ==========================================================
function mostrarSiguienteBanner() {
    if (estado.colaBanners.length === 0) {
        estado.bannerActual = null;
        cerrarBanner();
        if (estado.zonasActivas.size === 0) {
            mostrarAlertaLibre();
        }
        return;
    }

    const distrito = estado.colaBanners.shift();
    const zona = estado.zonasActivas.get(distrito);
    if (!zona) {
        // La zona ya no está activa, pasar al siguiente
        mostrarSiguienteBanner();
        return;
    }

    estado.bannerActual = distrito;
    pintarBannerDeZona(zona);
    actualizarIndicadorCola();
}

function actualizarIndicadorCola() {
    const el = document.getElementById("al-cola-indicador");
    if (!el) return;

    const pendientes = estado.colaBanners.length;
    if (pendientes === 0) {
        el.style.display = "none";
        el.textContent = "";
        return;
    }

    el.style.display = "block";
    el.textContent = `+ ${pendientes} zona${pendientes > 1 ? "s" : ""} en alerta`;
}

function pintarBannerDeZona(zona) {
    const nivel = NIVELES_ALERTA[zona.nivelKey];

    // Aplicar variables CSS
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
    aplicarVars(document.getElementById("al-modal-seguridad"));

    // Contenido del banner
    document.getElementById("al-icono-big").textContent = nivel.iconoBig;
    document.getElementById("al-nivel-badge").textContent = nivel.nombre;
    document.getElementById("al-titulo-texto").textContent = zona.titulo;
    document.getElementById("al-mensaje-texto").textContent = zona.mensaje;
    document.getElementById("al-recomendacion-texto").textContent = nivel.recomendacion;

    // Reiniciar animaciones
    const panel = document.getElementById("al-panel");
    panel.classList.remove("al-resplandor-activo", "al-sirena-activa");
    void panel.offsetWidth;

    // Mostrar overlay
    const overlay = document.getElementById("al-overlay");
    overlay.classList.remove("al-libre");
    overlay.classList.add("al-visible");
    panel.classList.add("al-sirena-activa");

    activarFlashFondo();

    // Contador de ESTA zona
    const duracionMs = zona.duracionMin * 60 * 1000;
    iniciarContadorSincronizado(zona.timestampInicio, duracionMs, zona.distrito);

    // Actualizar timestamp de la barra
    actualizarTimestampBarra(zona.timestampInicio);

    setTimeout(() => document.getElementById("al-btn-cerrar")?.focus(), 800);
}

function cerrarBannerActual() {
    cerrarBanner();
    estado.bannerActual = null;
    detenerContador();
    detenerSonidoAlerta();

    // Si quedan más banners en cola, mostrar el siguiente
    if (estado.colaBanners.length > 0) {
        setTimeout(() => mostrarSiguienteBanner(), 400);
    } else if (estado.zonasActivas.size === 0) {
        mostrarAlertaLibre();
    } else {
        actualizarBarraYTarjetaAgregadas();
    }
}

function cerrarBanner() {
    const overlay = document.getElementById("al-overlay");
    overlay?.classList.remove("al-visible");
    overlay?.classList.remove("al-libre");
}

// ==========================================================
// BARRA SUPERIOR Y TARJETA AGREGADAS
// ==========================================================
function actualizarBarraYTarjetaAgregadas() {
    const barra = document.getElementById("al-barra-superior");
    const tarjeta = document.getElementById("al-tarjeta");
    if (!barra || !tarjeta) return;

    const zonas = Array.from(estado.zonasActivas.values());

    if (zonas.length === 0) {
        // No hay zonas → dejar que mostrarAlertaLibre() se encargue
        return;
    }

    // Determinar el nivel MÁS ALTO para el color de la barra
    let nivelMax = NIVELES_ALERTA.vigilancia;
    for (const z of zonas) {
        const n = NIVELES_ALERTA[z.nivelKey];
        if (n.orden > nivelMax.orden) nivelMax = n;
    }

    const vars = [
        ["--al-color", nivelMax.color],
        ["--al-color-dark", nivelMax.colorDark],
        ["--al-glow", nivelMax.glow]
    ];
    const aplicarVars = (el) => {
        if (!el) return;
        vars.forEach(([k, v]) => el.style.setProperty(k, v));
    };
    aplicarVars(barra);
    aplicarVars(tarjeta);

    barra.classList.remove("al-modo-libre");
    tarjeta.classList.remove("al-modo-libre");

    // ---- BARRA SUPERIOR AGREGADA ----
    document.getElementById("al-barra-icono").textContent = nivelMax.iconoBig;

    if (zonas.length === 1) {
        const z = zonas[0];
        const n = NIVELES_ALERTA[z.nivelKey];
        document.getElementById("al-barra-nivel").textContent =
            (n.nombre + " " + n.icono).toUpperCase();
        document.getElementById("al-barra-desc").textContent =
            `${z.sectorOriginal || z.distrito} · ${z.distrito}`;
    } else {
        document.getElementById("al-barra-nivel").textContent =
            `${zonas.length} ZONAS EN ALERTA`;
        const resumen = zonas
            .sort((a, b) => NIVELES_ALERTA[b.nivelKey].orden - NIVELES_ALERTA[a.nivelKey].orden)
            .map(z => {
                const n = NIVELES_ALERTA[z.nivelKey];
                return `${n.icono} ${z.distrito}`;
            })
            .join(" · ");
        document.getElementById("al-barra-desc").textContent = resumen;
    }
    barra.classList.add("al-visible");

    // ---- TARJETA FLOTANTE AGREGADA ----
    document.getElementById("al-tarjeta-icono").textContent = nivelMax.iconoBig;

    if (zonas.length === 1) {
        const z = zonas[0];
        const n = NIVELES_ALERTA[z.nivelKey];
        document.getElementById("al-tarjeta-sub").textContent = ("ALERTA " + n.nombre).toUpperCase();
        document.getElementById("al-tarjeta-titulo").textContent = z.titulo;
        const cuerpo = [];
        if (z.sectorOriginal) cuerpo.push(`<strong>🏭 Sector:</strong> ${z.sectorOriginal}`);
        if (z.distrito)       cuerpo.push(`<strong>📍 Zona:</strong> ${z.distrito}`);
        if (z.inicio)         cuerpo.push(`<strong>🕒 Inicio:</strong> ${z.inicio}`);
        if (z.fin)            cuerpo.push(`<strong>⏹️ Fin previsto:</strong> ${z.fin}`);
        cuerpo.push(`<strong>⚡ Nivel:</strong> ${n.nombre}`);
        document.getElementById("al-tarjeta-cuerpo").innerHTML = cuerpo.join("<br>");
    } else {
        document.getElementById("al-tarjeta-sub").textContent = `${zonas.length} ZONAS EN ALERTA`;
        document.getElementById("al-tarjeta-titulo").textContent = "Alerta múltiple";
        const lineas = zonas
            .sort((a, b) => NIVELES_ALERTA[b.nivelKey].orden - NIVELES_ALERTA[a.nivelKey].orden)
            .map(z => {
                const n = NIVELES_ALERTA[z.nivelKey];
                return `${n.icono} <strong>${z.distrito}</strong> — ${n.nombre}`;
            });
        document.getElementById("al-tarjeta-cuerpo").innerHTML = lineas.join("<br>");
    }
    tarjeta.classList.add("al-visible");
}

// ==========================================================
// CONTADOR SINCRONIZADO (por zona)
// ==========================================================
function iniciarContadorSincronizado(timestampInicio, duracionMs, distrito) {
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

    const calcularRestante = () => {
        const ahora = Date.now();
        const transcurrido = ahora - timestampInicio;
        return Math.ceil((duracionMs - transcurrido) / 1000);
    };

    detenerContador();

    const actualizar = () => {
        let restante = calcularRestante();
        if (restante <= 0) {
            el.textContent = "00:00:00";
            el.classList.remove("al-critico");
            detenerContador();
            detenerSonidoAlerta();
            // Esta zona expiró: quitarla
            quitarAlerta(distrito);
            return;
        }
        el.textContent = formatear(restante);
        if (restante <= 60) el.classList.add("al-critico");
        else el.classList.remove("al-critico");
    };

    actualizar();
    estado.intervalContador = setInterval(actualizar, 1000);
}

function detenerContador() {
    if (estado.intervalContador) {
        clearInterval(estado.intervalContador);
        estado.intervalContador = null;
    }
}

// ==========================================================
// TIMESTAMP "Hace X min" EN LA BARRA
// ==========================================================
function actualizarTimestampBarra(timestampInicio) {
    const el = document.getElementById("al-barra-tiempo");
    if (!el) return;

    const actualizar = () => {
        if (!timestampInicio) return;
        const diff = Math.floor((Date.now() - timestampInicio) / 1000);
        let txt;
        if (diff < 60) txt = `Hace ${diff} seg`;
        else if (diff < 3600) txt = `Hace ${Math.floor(diff / 60)} min`;
        else txt = `Hace ${Math.floor(diff / 3600)} h`;
        el.textContent = txt;
    };

    actualizar();
    if (estado.intervalTimestamp) clearInterval(estado.intervalTimestamp);
    estado.intervalTimestamp = setInterval(actualizar, 15000);
}

// ==========================================================
// MOSTRAR BARRA + TARJETA "LIBRE DE ALERTAS"
// ==========================================================
export function mostrarBarraTarjetaLibre() {
    try {
        asegurarEstructuraDOM();

        const nivel = NIVELES_ALERTA.vigilancia;

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

        barra?.classList.add("al-modo-libre");
        tarjeta?.classList.add("al-modo-libre");

        document.getElementById("al-barra-icono").textContent = "✅";
        document.getElementById("al-barra-nivel").textContent = "LIBRE DE ALERTAS";
        document.getElementById("al-barra-desc").textContent = "Sistema en vigilancia — sin alertas activas";
        document.getElementById("al-barra-tiempo").textContent = "Vigilancia";
        barra?.classList.add("al-visible");

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

// ==========================================================
// MOSTRAR ESTADO "LIBRE DE ALERTAS"
// ==========================================================
export function mostrarAlertaLibre() {
    try {
        asegurarEstructuraDOM();
        detenerContador();
        detenerSonidoAlerta();

        // Limpiar TODOS los polígonos del mapa
        obtenerModuloMapa().then(mod => {
            if (mod && typeof mod.limpiarPoligonosZona === "function") {
                mod.limpiarPoligonosZona();
            }
        }).catch(() => {});

        // Reset estado
        estado.zonasActivas.clear();
        estado.colaBanners = [];
        estado.bannerActual = null;

        const nivel = NIVELES_ALERTA.vigilancia;

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

        document.getElementById("al-icono-big").textContent = "✅";
        document.getElementById("al-nivel-badge").textContent = "VIGILANCIA";
        document.getElementById("al-nivel-badge").style.background = nivel.color;
        document.getElementById("al-titulo-texto").textContent = "🟢 LIBRE DE ALERTAS";
        document.getElementById("al-mensaje-texto").textContent =
            "No se han emitido alertas meteorológicas. El sistema se encuentra en vigilancia.";
        document.getElementById("al-recomendacion-texto").textContent =
            "Manténgase informado sobre el desarrollo del clima.";

        const wrap = document.getElementById("al-contador-wrap");
        if (wrap) wrap.style.display = "none";

        const panel = document.getElementById("al-panel");
        panel.classList.remove("al-resplandor-activo", "al-sirena-activa");
        void panel.offsetWidth;
        const overlay = document.getElementById("al-overlay");
        overlay.classList.add("al-visible", "al-libre");

        // Ocultar indicador de cola
        const cola = document.getElementById("al-cola-indicador");
        if (cola) cola.style.display = "none";

        mostrarBarraTarjetaLibre();

        setTimeout(() => document.getElementById("al-btn-cerrar")?.focus(), 1000);

    } catch (e) {
        console.error("alertas.js: error al mostrar alerta libre", e);
    }
}

// ==========================================================
// BOTONES DE ACCIÓN
// ==========================================================
function verMapaAlerta() {
    try {
        cerrarBanner();
        const mapEl = document.getElementById("map");
        if (mapEl) mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {}
}

function abrirBannerDeNuevo() {
    // Si hay banner actual, mostrarlo
    if (estado.bannerActual) {
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
    } else if (estado.colaBanners.length > 0) {
        mostrarSiguienteBanner();
    } else if (estado.zonasActivas.size > 0) {
        // Re-encolar todas las zonas activas para mostrar sus banners
        estado.colaBanners = Array.from(estado.zonasActivas.keys());
        mostrarSiguienteBanner();
    }
}

// ==========================================================
// MODAL DE MEDIDAS DE SEGURIDAD
// ==========================================================
function mostrarModalSeguridad() {
    try {
        // Nivel: el del banner actual si hay, o el más alto de zonas activas
        let nivelKey = "roja";
        if (estado.bannerActual) {
            const z = estado.zonasActivas.get(estado.bannerActual);
            if (z) nivelKey = z.nivelKey;
        } else if (estado.zonasActivas.size > 0) {
            let max = NIVELES_ALERTA.vigilancia;
            for (const z of estado.zonasActivas.values()) {
                const n = NIVELES_ALERTA[z.nivelKey];
                if (n.orden > max.orden) max = n;
            }
            nivelKey = max === NIVELES_ALERTA.vigilancia ? "roja" :
                Object.keys(NIVELES_ALERTA).find(k => NIVELES_ALERTA[k] === max) || "roja";
        }
        const nivel = NIVELES_ALERTA[nivelKey];

        document.getElementById("al-modal-sub").textContent =
            ("NIVEL: " + nivel.nombre).toUpperCase();
        document.getElementById("al-modal-seguridad").style.setProperty("--al-color", nivel.color);

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

        const lista = document.getElementById("al-medidas-lista");
        lista.innerHTML = "";
        const medidas = MEDIDAS_SEGURIDAD[nivelKey] || MEDIDAS_SEGURIDAD.roja;
        medidas.forEach(m => {
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

// ==========================================================
// FLASH DE FONDO
// ==========================================================
function activarFlashFondo() {
    try {
        const body = document.body;
        body.classList.remove("al-flash-activo");
        void body.offsetWidth;
        body.classList.add("al-flash-activo");
        setTimeout(() => body.classList.remove("al-flash-activo"), 4600);
    } catch (e) {}
}

// ==========================================================
// CERRAR / OCULTAR
// ==========================================================
function ocultarBarraSuperior() {
    const barra = document.getElementById("al-barra-superior");
    if (barra?.classList.contains("al-modo-libre")) return;
    // Si hay zonas activas, la barra se queda visible (no se puede ocultar)
    if (estado.zonasActivas.size > 0) return;
    barra?.classList.remove("al-visible");
    if (estado.intervalTimestamp) {
        clearInterval(estado.intervalTimestamp);
        estado.intervalTimestamp = null;
    }
}

function ocultarTarjeta() {
    const tarjeta = document.getElementById("al-tarjeta");
    if (tarjeta?.classList.contains("al-modo-libre")) return;
    if (estado.zonasActivas.size > 0) return;
    tarjeta?.classList.remove("al-visible");
}

export function cerrarAlerta() {
    cerrarBannerActual();
}

export function cerrarAlertaTotal() {
    cerrarBanner();
    ocultarBarraSuperior();
    ocultarTarjeta();
    cerrarModalSeguridad();
    detenerContador();
    detenerSonidoAlerta();
    estado.zonasActivas.clear();
    estado.colaBanners = [];
    estado.bannerActual = null;
    obtenerModuloMapa().then(mod => {
        if (mod && typeof mod.limpiarPoligonosZona === "function") {
            mod.limpiarPoligonosZona();
        }
    }).catch(() => {});
}

// ==========================================================
// UTILIDADES
// ==========================================================
export function hayAlertaActiva() {
    return estado.zonasActivas.size > 0;
}

export function obtenerZonasActivas() {
    return Array.from(estado.zonasActivas.values());
}
