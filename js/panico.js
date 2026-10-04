// js/panico.js
// ============================================================
// Botón de pánico + modal + envío a Firestore + WhatsApp (v2)
// ============================================================
// v2 — Correcciones:
//   - GPS robusto: intenta baja precisión primero (rápido),
//     luego alta precisión si falla. Timeouts progresivos.
//   - Al enviar: si no hay GPS, lo intenta capturar con spinner
//     y timeout extendido (30s) antes de descartar.
//   - Cierre garantizado del modal (éxito o error).
//   - Timeout máximo de 12s para Firestore.
// ============================================================

import { enviarMensajePush } from "./mensajes.js";
import { mostrarToast } from "./notifications.js";

// ------------------------------------------------------------
// CONFIGURACIÓN WHATSAPP (CallMeBot)
// ------------------------------------------------------------
const CALLMEBOT_PHONE  = "+51954125058";
const CALLMEBOT_APIKEY = "9034887";

// ------------------------------------------------------------
// Estado interno
// ------------------------------------------------------------
let gpsActual = null;
let gpsError = null;
let watchId = null;
let modalAbierto = false;
let enviando = false;

// ------------------------------------------------------------
// Captura GPS robusta
// ------------------------------------------------------------
function obtenerUbicacionUna(timeoutMs, altaPrecision) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("no-soportado"));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            }),
            (err) => reject(err),
            {
                enableHighAccuracy: altaPrecision,
                timeout: timeoutMs,
                maximumAge: 30000 // aceptar posiciones de hasta 30s
            }
        );
    });
}

// Inicia captura completa: baja precisión primero (rápida),
// luego alta precisión como refinamiento.
async function iniciarGPS() {
    gpsActual = null;
    gpsError = null;
    actualizarTextoGPS();

    // 1. Intento rápido con red/WiFi (baja precisión, sin GPS)
    try {
        gpsActual = await obtenerUbicacionUna(8000, false);
        actualizarTextoGPS();
    } catch (e) {
        console.warn("panico: GPS baja precisión falló", e.message || e.code);
    }

    // 2. Refinamiento con GPS real (alta precisión) en background
    obtenerUbicacionUna(25000, true)
        .then((pos) => {
            // Solo sobreescribir si mejora la precisión
            if (!gpsActual || pos.accuracy < (gpsActual.accuracy || 99999)) {
                gpsActual = pos;
                actualizarTextoGPS();
            }
        })
        .catch((e) => {
            // Si ya teníamos algo, mantenerlo. Si no, dejar el error.
            if (!gpsActual) {
                gpsError = traducirErrorGPS(e);
                actualizarTextoGPS();
            }
        });

    // 3. Watch continuo para refinar en movimiento
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            gpsActual = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            };
            gpsError = null;
            actualizarTextoGPS();
        },
        () => {},
        { enableHighAccuracy: false, maximumAge: 5000, timeout: 30000 }
    );
}

function traducirErrorGPS(err) {
    if (!err) return "Error desconocido";
    switch (err.code) {
        case 1: return "Permiso de ubicación denegado";
        case 2: return "Ubicación no disponible. Verifica que el GPS esté encendido";
        case 3: return "Tiempo de espera agotado. Intenta de nuevo";
        default: return err.message || "Error desconocido";
    }
}

function actualizarTextoGPS() {
    const el = document.getElementById("panico-gps-texto");
    const cont = document.getElementById("panico-gps");
    if (!el || !cont) return;

    if (gpsActual) {
        el.textContent = `📍 ${gpsActual.lat.toFixed(6)}, ${gpsActual.lng.toFixed(6)}` +
                         (gpsActual.accuracy ? ` (±${Math.round(gpsActual.accuracy)}m)` : "");
        cont.classList.add("panico-gps-ok");
        cont.classList.remove("panico-gps-error");
    } else if (gpsError) {
        el.textContent = `⚠️ ${gpsError}`;
        cont.classList.add("panico-gps-error");
        cont.classList.remove("panico-gps-ok");
    } else {
        el.textContent = "Capturando ubicación... (puede tardar unos segundos)";
        cont.classList.remove("panico-gps-ok", "panico-gps-error");
    }
}

function detenerGPS() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
}

// ------------------------------------------------------------
// HTML del botón + modal
// ------------------------------------------------------------
function inyectarEstructura() {
    if (document.getElementById("btn-panico")) return;

    // Botón flotante
    const btn = document.createElement("button");
    btn.id = "btn-panico";
    btn.title = "Solicitar ayuda";
    btn.setAttribute("aria-label", "Solicitar ayuda");
    btn.innerHTML = `<span class="panico-btn-emoji">🆘</span>`;

    const btnUbic = document.getElementById("btn-ubicacion");
    if (btnUbic && btnUbic.parentNode) {
        btnUbic.parentNode.insertBefore(btn, btnUbic.nextSibling);
    } else {
        document.body.appendChild(btn);
    }

    // Modal
    const modalHtml = `
    <div id="panico-overlay" class="panico-overlay">
        <div class="panico-modal">
            <button class="panico-cerrar" id="panico-btn-cerrar" aria-label="Cerrar">×</button>
            <h2 class="panico-titulo">🆘 Solicitar ayuda</h2>
            <p class="panico-subtitulo">Completa los datos. Tu ubicación se capturará automáticamente.</p>

            <div class="panico-campo">
                <label for="panico-nombre">Nombre</label>
                <input type="text" id="panico-nombre" placeholder="Tu nombre (opcional)"
                       maxlength="60" autocomplete="off">
            </div>

            <div class="panico-campo">
                <label for="panico-descripcion">Descripción (opcional)</label>
                <textarea id="panico-descripcion" placeholder="Describe brevemente tu situación..."
                          maxlength="300" rows="3"></textarea>
            </div>

            <div class="panico-gps" id="panico-gps">
                <span class="panico-gps-icono">📍</span>
                <span class="panico-gps-texto" id="panico-gps-texto">Capturando ubicación...</span>
            </div>

            <button class="panico-btn-enviar" id="panico-btn-enviar">
                🆘 ENVIAR SOLICITUD
            </button>

            <p class="panico-nota">Tu solicitud será atendida por el equipo de vigilancia.</p>
        </div>
    </div>`;

    const cont = document.createElement("div");
    cont.innerHTML = modalHtml;
    document.body.appendChild(cont.firstElementChild);

    // Eventos
    btn.addEventListener("click", abrirModal);
    document.getElementById("panico-btn-cerrar").addEventListener("click", cerrarModal);
    document.getElementById("panico-overlay").addEventListener("click", (e) => {
        if (e.target.id === "panico-overlay") cerrarModal();
    });
    document.getElementById("panico-btn-enviar").addEventListener("click", enviarSolicitud);

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modalAbierto) cerrarModal();
    });
}

// ------------------------------------------------------------
// Abrir / cerrar modal
// ------------------------------------------------------------
function abrirModal() {
    inyectarEstructura();
    const overlay = document.getElementById("panico-overlay");
    overlay.classList.add("panico-visible");
    modalAbierto = true;
    document.getElementById("panico-nombre").focus();
    // Resetear el botón de enviar por si acaso
    const btn = document.getElementById("panico-btn-enviar");
    btn.disabled = false;
    btn.innerHTML = "🆘 ENVIAR SOLICITUD";
    iniciarGPS();
}

function cerrarModal() {
    const overlay = document.getElementById("panico-overlay");
    if (overlay) overlay.classList.remove("panico-visible");
    modalAbierto = false;
    detenerGPS();
}

// ------------------------------------------------------------
// Enviar solicitud
// ------------------------------------------------------------
async function enviarSolicitud() {
    if (enviando) return;

    const nombre = (document.getElementById("panico-nombre").value || "").trim();
    const descripcion = (document.getElementById("panico-descripcion").value || "").trim();

    const btn = document.getElementById("panico-btn-enviar");

    // Si no hay ubicación todavía, intentar capturarla con spinner
    if (!gpsActual) {
        enviando = true;
        btn.disabled = true;
        btn.innerHTML = "⏳ Obteniendo ubicación...";

        try {
            gpsActual = await obtenerUbicacionUna(30000, false);
            actualizarTextoGPS();
        } catch (e) {
            // Reintentar con alta precisión
            try {
                gpsActual = await obtenerUbicacionUna(20000, true);
                actualizarTextoGPS();
            } catch (e2) {
                gpsError = traducirErrorGPS(e2);
                actualizarTextoGPS();
                mostrarToast(
                    "📍 Falta ubicación",
                    "No se pudo capturar tu ubicación. Verifica que el GPS esté activado y da permisos al navegador.",
                    "alerta",
                    true
                );
                enviando = false;
                btn.disabled = false;
                btn.innerHTML = "🆘 ENVIAR SOLICITUD";
                return;
            }
        }
    }

    // Ya tenemos ubicación: enviar
    enviando = true;
    btn.disabled = true;
    btn.innerHTML = "⏳ Enviando...";

    const hora = new Date().toISOString();
    const datosPanico = {
        tipo:        "panico",
        nombre:      nombre,
        descripcion: descripcion,
        lat:         gpsActual.lat,
        lng:         gpsActual.lng,
        accuracy:    gpsActual.accuracy || null,
        fecha:       hora,
        atendido:    false
    };

    // 1. Firestore con timeout de 12s
    let okFirestore = false;
    try {
        const envioPromise = enviarMensajePush(
            "🆘 Solicitud de ayuda",
            `Ubicación: ${gpsActual.lat.toFixed(6)}, ${gpsActual.lng.toFixed(6)}` +
            (nombre ? ` | ${nombre}` : "") +
            (descripcion ? ` | ${descripcion}` : ""),
            datosPanico
        );
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout-firestore")), 12000)
        );
        await Promise.race([envioPromise, timeoutPromise]);
        okFirestore = true;
    } catch (e) {
        console.error("panico: error Firestore", e);
    }

    // 2. WhatsApp en background (no espera)
    enviarWhatsApp(nombre, descripcion, gpsActual.lat, gpsActual.lng);

    // 3. Feedback y CIERRE GARANTIZADO
    if (okFirestore) {
        mostrarToast("🆘 Solicitud enviada", "Vigilancia ha sido notificada.", "exito", true);
    } else {
        // Aun si Firestore falló, WhatsApp pudo haber salido.
        // Cerrar igual y avisar.
        mostrarToast(
            "⚠️ Envío parcial",
            "Se intentó notificar a vigilancia. Si es urgente, llama al 911.",
            "alerta",
            true
        );
    }

    // Limpiar campos
    document.getElementById("panico-nombre").value = "";
    document.getElementById("panico-descripcion").value = "";

    // Cerrar SIEMPRE el modal
    cerrarModal();

    // Resetear estado del botón (por si el modal se vuelve a abrir)
    enviando = false;
    btn.disabled = false;
    btn.innerHTML = "🆘 ENVIAR SOLICITUD";
}

// ------------------------------------------------------------
// WhatsApp CallMeBot (background, no espera)
// ------------------------------------------------------------
function enviarWhatsApp(nombre, descripcion, lat, lng) {
    if (CALLMEBOT_APIKEY === "TU_API_KEY_AQUI") {
        console.warn("panico: CallMeBot no configurado (falta APIKEY). Se omite WhatsApp.");
        return;
    }

    const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    const hora = new Date().toLocaleString("es-PE");

    const lineas = [
        "🚨 SOLICITUD DE AYUDA 🚨",
        "",
        `👤 Nombre: ${nombre || "(no indicado)"}`,
        `📝 Descripción: ${descripcion || "(sin descripción)"}`,
        "",
        `📍 Ubicación: ${mapsUrl}`,
        `🌐 Coordenadas: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        `🕒 Hora: ${hora}`
    ];

    const texto = lineas.join("\n");
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(CALLMEBOT_PHONE)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(CALLMEBOT_APIKEY)}`;

    fetch(url, { mode: "no-cors" })
        .then(() => console.log("panico: WhatsApp enviado (background)"))
        .catch((e) => console.warn("panico: WhatsApp falló", e));
}

// ------------------------------------------------------------
// Auto-init
// ------------------------------------------------------------
function init() {
    inyectarEstructura();
    console.log("🆘 panico.js inicializado");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
