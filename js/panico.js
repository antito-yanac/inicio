// js/panico.js
// ============================================================
// Botón de pánico + modal + envío a Firestore + WhatsApp
// ============================================================
// - Botón 🆘 flotante junto al de "Mi ubicación".
// - Modal con: nombre (opcional) y descripción (opcional).
// - GPS capturado automáticamente (obligatorio).
// - Envía a Firestore (colección "mensajes_push", tipo "panico").
// - Envía a WhatsApp vía CallMeBot (background, sin esperar).
// ============================================================

import { enviarMensajePush } from "./mensajes.js";
import { mostrarToast } from "./notifications.js";

// ------------------------------------------------------------
// CONFIGURACIÓN WHATSAPP (CallMeBot)
// ------------------------------------------------------------
// Para activar: el número receptor (51964125058) debe enviar
// el texto "I allow callmebot to send me messages" por WhatsApp
// al +34 644 51 95 23. Recibirá un APIKEY por respuesta.
// Pegar ese APIKEY en la constante de abajo.
const CALLMEBOT_PHONE  = "+51964125058";
const CALLMEBOT_APIKEY = "TU_API_KEY_AQUI";

// ------------------------------------------------------------
// Estado interno
// ------------------------------------------------------------
let gpsActual = null;
let gpsError = null;
let watchId = null;
let modalAbierto = false;
let enviando = false;

// ------------------------------------------------------------
// Capturar GPS automáticamente
// ------------------------------------------------------------
function iniciarGPS() {
    gpsActual = null;
    gpsError = null;

    if (!navigator.geolocation) {
        gpsError = "Geolocalización no soportada";
        actualizarTextoGPS();
        return;
    }

    // Intento rápido
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            gpsActual = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            };
            actualizarTextoGPS();
        },
        (err) => {
            let msg = "Error desconocido";
            switch (err.code) {
                case err.PERMISSION_DENIED: msg = "Permiso de ubicación denegado"; break;
                case err.POSITION_UNAVAILABLE: msg = "Ubicación no disponible"; break;
                case err.TIMEOUT: msg = "Tiempo de espera agotado"; break;
            }
            gpsError = msg;
            actualizarTextoGPS();
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    // Seguimiento continuo para mejorar precisión
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            gpsActual = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            };
            actualizarTextoGPS();
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 3000 }
    );
}

function actualizarTextoGPS() {
    const el = document.getElementById("panico-gps-texto");
    if (!el) return;

    if (gpsActual) {
        el.textContent = `📍 ${gpsActual.lat.toFixed(6)}, ${gpsActual.lng.toFixed(6)} (±${Math.round(gpsActual.accuracy)}m)`;
        el.parentElement.classList.add("panico-gps-ok");
        el.parentElement.classList.remove("panico-gps-error");
    } else if (gpsError) {
        el.textContent = `⚠️ ${gpsError}`;
        el.parentElement.classList.add("panico-gps-error");
        el.parentElement.classList.remove("panico-gps-ok");
    } else {
        el.textContent = "Capturando ubicación...";
        el.parentElement.classList.remove("panico-gps-ok", "panico-gps-error");
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

    // GPS obligatorio
    if (!gpsActual) {
        mostrarToast("📍 Falta ubicación", "Espera a que se capture tu ubicación. Verifica permisos.", "alerta", true);
        return;
    }

    enviando = true;
    const btn = document.getElementById("panico-btn-enviar");
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

    // 1. Firestore (obligatorio)
    let okFirestore = false;
    try {
        await enviarMensajePush(
            "🆘 Solicitud de ayuda",
            `Ubicación: ${gpsActual.lat.toFixed(6)}, ${gpsActual.lng.toFixed(6)}` +
            (nombre ? ` | ${nombre}` : "") +
            (descripcion ? ` | ${descripcion}` : ""),
            datosPanico
        );
        okFirestore = true;
    } catch (e) {
        console.error("panico: error Firestore", e);
    }

    // 2. WhatsApp en background (no bloquea)
    enviarWhatsApp(nombre, descripcion, gpsActual.lat, gpsActual.lng);

    // 3. Feedback y cierre
    if (okFirestore) {
        mostrarToast("🆘 Solicitud enviada", "Vigilancia ha sido notificada.", "exito", true);
        cerrarModal();
        // Limpiar campos
        document.getElementById("panico-nombre").value = "";
        document.getElementById("panico-descripcion").value = "";
    } else {
        mostrarToast("⚠️ No se pudo enviar", "Intenta nuevamente o llama al 911.", "alerta", true);
    }

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

    // Fetch fire-and-forget: no esperamos respuesta
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
