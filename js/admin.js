// js/admin.js
//
// Panel de Administración de Mensajes.
// Permite enviar notificaciones push a los dispositivos registrados
// mediante Firebase Cloud Messaging (FCM).
//
// Usa modales personalizados (no confirm() nativo) para una mejor UX.

import { inicializarFirebase } from "./notifications.js";
import { enviarMensajePush, escucharMensajesPush } from "./mensajes.js";
import { mostrarToast } from "./notifications.js";
import { iniciarSesion, cerrarSesion, observarSesion, traducirErrorAuth } from "./auth.js";
import { mostrarAlertaCompleta, NIVELES_ALERTA } from "./alertas.js";

// ======================================================
// Referencias al DOM: login
// ======================================================
const loginContainer = document.getElementById("login-container");
const panelContainer = document.getElementById("panel-container");
const formLogin = document.getElementById("form-login");
const inputEmail = document.getElementById("login-email");
const inputPassword = document.getElementById("login-password");
const btnLogin = document.getElementById("btn-login");
const loginStatus = document.getElementById("login-status");
const btnLogout = document.getElementById("btn-logout");

// ======================================================
// Referencias al DOM: panel de mensajes
// ======================================================
const form = document.getElementById("form-mensaje");
const inputTitulo = document.getElementById("titulo");
const inputCuerpo = document.getElementById("cuerpo");
const charCounter = document.getElementById("char-counter");
const btnEnviar = document.getElementById("btn-enviar");
const btnCancelar = document.getElementById("btn-cancelar");
const statusBar = document.getElementById("status-bar");

// Campos de ALERTA METEOROLÓGICA
const tipoSelector = document.getElementById("tipo-selector");
const camposAlerta = document.getElementById("campos-alerta");
const selectNivel = document.getElementById("nivel");
const inputDistrito = document.getElementById("distrito");
// const selectIntensidad = document.getElementById("intensidad");
const inputLat = document.getElementById("lat");
const inputLng = document.getElementById("lng");
const inputDuracion = document.getElementById("duracion");
const nivelPreview = document.getElementById("nivel-preview");

// Modal de confirmación
const modalConfirm = document.getElementById("modal-confirm");
const modalTitulo = document.getElementById("modal-titulo");
const modalMensaje = document.getElementById("modal-mensaje");
const btnModalAceptar = document.getElementById("modal-btn-aceptar");
const btnModalCancelarModal = document.getElementById("modal-btn-cancelar");

// Callback del modal
let modalCallback = null;

// ======================================================
// Autenticación: mostrar panel solo si hay sesión iniciada
// ======================================================
let panelYaInicializado = false;

observarSesion((user) => {
    if (user) {
        // Sesión activa: mostrar panel, ocultar login
        loginContainer.style.display = "none";
        panelContainer.style.display = "";
        if (!panelYaInicializado) {
            panelYaInicializado = true;
            initFirebase();
        }
    } else {
        // Sin sesión: mostrar login, ocultar panel
        loginContainer.style.display = "";
        panelContainer.style.display = "none";
    }
});

formLogin.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = inputEmail.value.trim();
    const password = inputPassword.value;

    if (!email || !password) return;

    btnLogin.disabled = true;
    btnLogin.innerHTML = '<span class="spinner"></span> Ingresando...';
    loginStatus.textContent = "";
    loginStatus.className = "status-bar";

    try {
        await iniciarSesion(email, password);
        inputPassword.value = "";
        loginStatus.textContent = "";
    } catch (error) {
        console.error("Error de autenticación:", error);
        loginStatus.textContent = traducirErrorAuth(error.code);
        loginStatus.className = "status-bar error";
    } finally {
        btnLogin.disabled = false;
        btnLogin.innerHTML = "🔓 Ingresar";
    }
});

btnLogout.addEventListener("click", async () => {
    try {
        await cerrarSesion();
        mostrarEstado("Sesión cerrada.", "");
    } catch (error) {
        console.error("Error cerrando sesión:", error);
    }
});

// ======================================================
// Inicializar Firebase al cargar la página
// ======================================================
async function initFirebase() {
    try {
        // Habilitar Firebase Messaging (permiso + Service Worker) de
        // forma silenciosa, igual que en la página principal.
        await inicializarFirebase();

        // También escuchar mensajes en tiempo real desde este mismo
        // panel (por si el propio admin tiene la app abierta también).
        escucharMensajesPush();

        mostrarEstado("Panel listo. Escribe tu mensaje y presiona Enviar.", "");
    } catch (error) {
        console.error("Error iniciando Firebase:", error);
        mostrarEstado("Panel listo. Escribe tu mensaje y presiona Enviar.", "");
    }
}

// ======================================================
// Modal de confirmación personalizado
// ======================================================
function mostrarModalConfirmacion(titulo, mensaje, callback) {
    modalTitulo.textContent = titulo;
    modalMensaje.textContent = mensaje;
    modalCallback = callback;
    modalConfirm.classList.add("modal-visible");
}

function cerrarModal() {
    modalConfirm.classList.remove("modal-visible");
    modalCallback = null;
}

btnModalAceptar.addEventListener("click", () => {
    const cb = modalCallback;
    cerrarModal();
    if (cb) cb(true);
});

btnModalCancelarModal.addEventListener("click", () => {
    cerrarModal();
});

// Cerrar modal al hacer clic en el overlay
modalConfirm.addEventListener("click", (e) => {
    if (e.target === modalConfirm) {
        cerrarModal();
    }
});

// Cerrar modal con tecla Escape
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalConfirm.classList.contains("modal-visible")) {
        cerrarModal();
    }
});

// ======================================================
// Contador de caracteres del textarea
// ======================================================
inputCuerpo.addEventListener("input", () => {
    const len = inputCuerpo.value.length;
    const max = 500;
    charCounter.textContent = `${len} / ${max}`;

    charCounter.classList.remove("warn", "danger");
    if (len > max * 0.8) charCounter.classList.add("warn");
    if (len > max * 0.95) charCounter.classList.add("danger");
});

// ======================================================
// Campos de ALERTA METEOROLÓGICA
// ======================================================

// Mostrar / ocultar campos según el tipo seleccionado
function actualizarVisibilidadCamposAlerta() {
    const tipo = document.querySelector('input[name="tipo"]:checked')?.value || "normal";
    if (tipo === "alerta") {
        camposAlerta.style.display = "";
        // Autofocus de sugerencias por defecto para una alerta común
        if (!inputTitulo.value) inputTitulo.value = "⚡ ALERTA DE TORMENTA ELÉCTRICA";
        actualizarNivelPreview();
    } else {
        camposAlerta.style.display = "none";
    }
}

// Resaltar la opción activa (respaldo para navegadores sin :has())
function actualizarOpcionActiva() {
    document.querySelectorAll(".tipo-opcion").forEach(label => {
        const radio = label.querySelector('input[type="radio"]');
        if (radio.checked) label.classList.add("activa");
        else label.classList.remove("activa");
    });
}

// Vista previa en vivo del nivel de alerta seleccionado
function actualizarNivelPreview() {
    const nivelKey = selectNivel.value;
    const nivel = NIVELES_ALERTA[nivelKey];
    if (!nivel || !nivelPreview) return;
    nivelPreview.className = "nivel-preview np-" + nivelKey;
    nivelPreview.innerHTML = `
        <div class="np-titulo">${nivel.icono} ${nivel.nombre.toUpperCase()}</div>
        <div class="np-desc">${nivel.descripcion}</div>`;
}

// Escuchar cambios de tipo (radio buttons)
tipoSelector?.addEventListener("change", () => {
    actualizarOpcionActiva();
    actualizarVisibilidadCamposAlerta();
});

// Escuchar cambios de nivel
selectNivel?.addEventListener("change", actualizarNivelPreview);

// Rellenar coordenadas automáticamente según la zona seleccionada.
// Las 3 zonas oficiales de Antamina tienen coordenadas predefinidas
// que coinciden con los polígonos de zonas.json, de modo que el mapa
// ilumine el área correcta al emitir la alerta.
const COORDENADAS_ZONAS = {
    "Zona 1 - Campamentos":   { lat: -9.5822364, lng: -77.0223100 },
    "Zona 2 - Botadero Este": { lat: -9.5718388, lng: -77.0447182 },
    "Zona 3 - Tucush":        { lat: -9.5263487, lng: -77.0485794 },
    "Zona 4 - Tajo":          { lat: -9.5416465, lng: -77.0707659 }
};

inputDistrito?.addEventListener("change", () => {
    const zona = inputDistrito.value;
    const coords = COORDENADAS_ZONAS[zona];
    if (coords) {
        inputLat.value = coords.lat;
        inputLng.value = coords.lng;
    }
});

// Inicializar estado de los campos
actualizarOpcionActiva();
actualizarVisibilidadCamposAlerta();

// ======================================================
// Botón Cancelar: limpia el formulario
// ======================================================
btnCancelar.addEventListener("click", () => {
    const tieneContenido = inputTitulo.value.trim() || inputCuerpo.value.trim();

    if (!tieneContenido) {
        // Si no hay contenido, simplemente limpiar y salir
        limpiarFormulario();
        mostrarEstado("Mensaje cancelado.", "");
        return;
    }

    // Confirmar antes de cancelar usando el modal personalizado
    mostrarModalConfirmacion(
        "¿Cancelar mensaje?",
        "Se borrará el contenido del formulario. ¿Deseas continuar?",
        (aceptar) => {
            if (aceptar) {
                limpiarFormulario();
                mostrarToast("🚫 Cancelado", "El mensaje ha sido borrado.", "info", false);
                mostrarEstado("Mensaje cancelado.", "");
            }
        }
    );
});

// ======================================================
// Botón Enviar (submit del formulario)
// ======================================================
form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const titulo = inputTitulo.value.trim();
    const cuerpo = inputCuerpo.value.trim();
    const tipo = document.querySelector('input[name="tipo"]:checked')?.value || "normal";

    // Validar campos
    if (!titulo) {
        mostrarToast("⚠️ Falta el título", "Escribe un título para el mensaje.", "alerta", true);
        inputTitulo.focus();
        return;
    }

    if (!cuerpo) {
        mostrarToast("⚠️ Falta el mensaje", "Escribe el contenido del mensaje.", "alerta", true);
        inputCuerpo.focus();
        return;
    }

    // Recopilar datos de alerta (si aplica)
    let datosAlerta = null;
    if (tipo === "alerta") {
        const nivel = selectNivel.value;
        const distrito = inputDistrito.value.trim();
        const lat = parseFloat(inputLat.value);
        const lng = parseFloat(inputLng.value);
        const duracionMin = parseInt(inputDuracion.value, 10);

        datosAlerta = {
            tipo: "alerta",
            nivel: nivel,
            distrito: distrito,
            lat: (!isNaN(lat)) ? lat : null,
            lng: (!isNaN(lng)) ? lng : null,
            duracionMin: (!isNaN(duracionMin) && duracionMin > 0) ? duracionMin : null
        };
    }

    // Mensaje de confirmación según el tipo
    let confirmMsg = `¿Enviar este mensaje?\n\n📋 ${titulo}\n💬 ${cuerpo}`;
    if (tipo === "alerta") {
        const nivel = NIVELES_ALERTA[datosAlerta.nivel];
        confirmMsg = `¿Enviar esta ALERTA a todos los dispositivos?\n\n` +
                     `${nivel.icono} Nivel: ${nivel.nombre}\n` +
                     `📋 ${titulo}\n💬 ${cuerpo}`;
        if (datosAlerta.distrito) confirmMsg += `\n📍 ${datosAlerta.distrito}`;
        if (datosAlerta.duracionMin) confirmMsg += `\n⏰ ${datosAlerta.duracionMin} min`;
    }

    // Confirmar antes de enviar usando el modal personalizado
    mostrarModalConfirmacion(
        "Confirmar envío",
        confirmMsg,
        (aceptar) => {
            if (aceptar) {
                enviarMensaje(titulo, cuerpo, datosAlerta);
            }
        }
    );
});

// ======================================================
// Enviar el mensaje push (REAL, a todos los navegadores conectados)
// ======================================================
async function enviarMensaje(titulo, cuerpo, datosAlerta = null) {
    btnEnviar.disabled = true;
    btnCancelar.disabled = true;
    btnEnviar.innerHTML = '<span class="spinner"></span> Enviando...';

    try {
        // Guardar mensaje en localStorage como respaldo/historial local
        guardarMensajeLocal({
            id: Date.now(),
            titulo,
            cuerpo,
            tipo: datosAlerta ? "alerta" : "normal",
            datosAlerta: datosAlerta,
            fecha: new Date().toISOString()
        });

        // Enviar a Firestore: todos los navegadores con la página
        // abierta (index.html o admin.html) que estén escuchando
        // recibirán este mensaje en tiempo real.
        // Si es alerta, datosAlerta viaja dentro del documento.
        await enviarMensajePush(titulo, cuerpo, datosAlerta);

        const esAlerta = datosAlerta && datosAlerta.tipo === "alerta";
        mostrarToast(
            esAlerta ? "✅ Alerta enviada" : "✅ Mensaje enviado",
            esAlerta
                ? "La alerta meteorológica fue enviada a todos los navegadores conectados."
                : "El mensaje fue enviado a todos los navegadores conectados.",
            "exito", true
        );
        mostrarEstado(esAlerta ? "✓ Alerta enviada correctamente." : "✓ Mensaje enviado correctamente.", "success");
        limpiarFormulario();

    } catch (error) {
        console.error("Error enviando mensaje:", error);
        mostrarToast("❌ Error", "No se pudo enviar el mensaje. Revisa la consola (F12).", "alerta", true);
        mostrarEstado("✗ Error al enviar el mensaje: " + error.message, "error");
    } finally {
        btnEnviar.disabled = false;
        btnCancelar.disabled = false;
        btnEnviar.innerHTML = "✅ Enviar";
    }
}

// ======================================================
// Guardar mensajes en localStorage
// ======================================================
function guardarMensajeLocal(mensaje) {
    try {
        const lista = JSON.parse(localStorage.getItem("antamina_mensajes") || "[]");
        lista.unshift(mensaje);
        if (lista.length > 50) lista.length = 50;
        localStorage.setItem("antamina_mensajes", JSON.stringify(lista));
    } catch (e) {
        console.warn("No se pudo guardar en localStorage:", e);
    }
}

// ======================================================
// Mostrar estado en la barra
// ======================================================
function mostrarEstado(texto, tipo) {
    statusBar.textContent = texto;
    statusBar.className = "status-bar" + (tipo ? " " + tipo : "");
}

// ======================================================
// Limpiar formulario
// ======================================================
function limpiarFormulario() {
    form.reset();
    charCounter.textContent = "0 / 500";
    charCounter.classList.remove("warn", "danger");
    // Reiniciar a "Mensaje normal" y ocultar campos de alerta
    const radioNormal = document.querySelector('input[name="tipo"][value="normal"]');
    if (radioNormal) radioNormal.checked = true;
    actualizarOpcionActiva();
    actualizarVisibilidadCamposAlerta();
    if (nivelPreview) nivelPreview.innerHTML = "";
    inputTitulo.focus();
}

// ======================================================
// Iniciar: la inicialización de Firebase Messaging/Firestore
// ahora ocurre dentro de observarSesion(), una vez que el
// usuario haya iniciado sesión correctamente.
// ======================================================
