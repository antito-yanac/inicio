// js/panico.js
// ============================================================
// Botón de pánico + modal + envío a Firestore + WhatsApp (v3)
// ============================================================
// v3 — Correcciones:
//   - Fix typo CALLMEBOT_APIKEY.
//   - Autenticación anónima antes de escribir en Firestore.
//   - Try/catch global en enviarSolicitud: SIEMPRE cierra el modal.
//   - Timeout de Firestore para no colgar la UI.
// ============================================================

import { enviarMensajePush } from "./mensajes.js";
import { mostrarToast } from "./notifications.js";
import { getAuth, signInAnonymously }
    from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { obtenerApp } from "./firebase-app.js";

// ------------------------------------------------------------
// CONFIGURACIÓN WHATSAPP (CallMeBot)
// ------------------------------------------------------------
const CALLMEBOT_PHONE  = "+51964125058";
const CALLMEBOT_APIKEY = "9034887";   // ← pega tu API key aquí

// ------------------------------------------------------------
// Estado interno
// ------------------------------------------------------------
let gpsActual = null;
let gpsError = null;
let watchId = null;
let modalAbierto = false;
let enviando = false;

// ------------------------------------------------------------
// Sesión anónima
// ------------------------------------------------------------
async function asegurarSesion() {
    const auth = getAuth(obtenerApp());
    if (auth.currentUser) return auth.currentUser;
    const cred = await signInAnonymously(auth);
    console.log("panico: sesión anónima creada:", cred.user.uid);
    return cred.user;
}

// ------------------------------------------------------------
// Captura GPS
// ------------------------------------------------------------
function obtenerUbicacionUna(timeoutMs, altaPrecision) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error("no-soportado"));
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            }),
            (err) => reject(err),
            { enableHighAccuracy: altaPrecision, timeout: timeoutMs, maximumAge: 30000 }
        );
    });
}

async function iniciarGPS() {
    gpsActual = null;
    gpsError = null;
    actualizarTextoGPS();

    try {
        gpsActual = await obtenerUbicacionUna(8000, false);
        actualizarTextoGPS();
    } catch (e) {
        console.warn("panico: GPS rápido falló", e.message || e.code);
    }

    obtenerUbicacionUna(25000, true)
        .then((pos) => {
            if (!gpsActual || pos.accuracy < (gpsActual.accuracy || 99999)) {
                gpsActual = pos;
                actualizarTextoGPS();
            }
        })
        .catch((e) => {
            if (!gpsActual) {
                gpsError = traducirErrorGPS(e);
                actualizarTextoGPS();
            }
        });

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
        case 2: return "Ubicación no disponible. Verifica el GPS";
        case 3: return "Tiempo de espera agotado";
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
// HTML
// ------------------------------------------------------------
function inyectarEstructura() {
    if (document.getElementById("btn-panico")) return;

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

function abrirModal() {
    inyectarEstructura();
    document.getElementById("panico-overlay").classList.add("panico-visible");
    modalAbierto = true;
    document.getElementById("panico-nombre").focus();
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
// Enviar solicitud — con try/catch global, SIEMPRE cierra el modal
// ------------------------------------------------------------
async function enviarSolicitud() {
    if (enviando) return;
    enviando = true;

    const btn = document.getElementById("panico-btn-enviar");
    btn.disabled = true;
    btn.innerHTML = "⏳ Enviando...";

    const nombre = (document.getElementById("panico-nombre").value || "").trim();
    const descripcion = (document.getElementById("panico-descripcion").value || "").trim();

    try {
        // 1. Ubicación (si no la tenemos, intentar capturar)
        if (!gpsActual) {
            btn.innerHTML = "⏳ Obteniendo ubicación...";
            try {
                gpsActual = await obtenerUbicacionUna(30000, false);
                actualizarTextoGPS();
            } catch (e) {
                try {
                    gpsActual = await obtenerUbicacionUna(20000, true);
                    actualizarTextoGPS();
                } catch (e2) {
                    gpsError = traducirErrorGPS(e2);
                    actualizarTextoGPS();
                    mostrarToast("📍 Falta ubicación",
                        "No se pudo capturar tu ubicación. Verifica el GPS y los permisos.",
                        "alerta", true);
                    return; // el finally cierra el modal
                }
            }
        }

        // 2. Sesión anónima
        btn.innerHTML = "⏳ Conectando...";
        try {
            await asegurarSesion();
        } catch (e) {
            console.error("panico: error auth anónima", e);
            mostrarToast("⚠️ Error de conexión",
                "No se pudo conectar con el servidor. Intenta de nuevo.",
                "alerta", true);
            return; // el finally cierra el modal
        }

        // 3. Enviar a Firestore con timeout
        btn.innerHTML = "⏳ Enviando...";
        let okFirestore = false;
        try {
            const envioPromise = enviarMensajePush(
                "🆘 Solicitud de ayuda",
                `Ubicación: ${gpsActual.lat.toFixed(6)}, ${gpsActual.lng.toFixed(6)}` +
                (nombre ? ` | ${nombre}` : "") +
                (descripcion ? ` | ${descripcion}` : ""),
                {
                    tipo:        "panico",
                    nombre:      nombre,
                    descripcion: descripcion,
                    lat:         gpsActual.lat,
                    lng:         gpsActual.lng,
                    accuracy:    gpsActual.accuracy || null,
                    fecha:       new Date().toISOString(),
                    atendido:    false
                }
            );
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout-firestore")), 12000)
            );
            await Promise.race([envioPromise, timeoutPromise]);
            okFirestore = true;
        } catch (e) {
            console.error("panico: error Firestore", e);
        }

        // 4. WhatsApp en background (silencioso, sin await)
        try {
            enviarWhatsApp(nombre, descripcion, gpsActual.lat, gpsActual.lng);
        } catch (e) {
            console.warn("panico: WhatsApp falló", e);
        }

        // 5. Feedback
        if (okFirestore) {
            mostrarToast("🆘 Solicitud enviada",
                "Vigilancia ha sido notificada.", "exito", true);
        } else {
            mostrarToast("⚠️ Envío parcial",
                "Se intentó notificar a vigilancia. Si es urgente, llama al 911.",
                "alerta", true);
        }

        // Limpiar campos
        document.getElementById("panico-nombre").value = "";
        document.getElementById("panico-descripcion").value = "";

    } catch (e) {
        // Cualquier error inesperado: log y toast
        console.error("panico: error inesperado", e);
        mostrarToast("⚠️ Error", "Ocurrió un problema. Intenta de nuevo.", "alerta", true);
    } finally {
        // SIEMPRE cerrar modal y resetear botón
        enviando = false;
        btn.disabled = false;
        btn.innerHTML = "🆘 ENVIAR SOLICITUD";
        cerrarModal();
    }
}

// ------------------------------------------------------------
// WhatsApp CallMeBot (usa CALLMEBOT_APIKEY, no CALLMEBOT_KEY)
// ------------------------------------------------------------
function enviarWhatsApp(nombre, descripcion, lat, lng) {
    if (!CALLMEBOT_APIKEY || CALLMEBOT_APIKEY === "9034887") {
        console.warn("panico: CallMeBot no configurado (falta APIKEY). Se omite WhatsApp.");
        return;
    }

    const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    const hora = new Date().toLocaleString("es-PE");

    const texto = [
        "🚨 SOLICITUD DE AYUDA 🚨",
        "",
        `👤 Nombre: ${nombre || "(no indicado)"}`,
        `📝 Descripción: ${descripcion || "(sin descripción)"}`,
        "",
        `📍 Ubicación: ${mapsUrl}`,
        `🌐 Coordenadas: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        `🕒 Hora: ${hora}`
    ].join("\n");

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
