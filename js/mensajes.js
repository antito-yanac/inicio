// js/mensajes.js
//
// Sistema de mensajes en tiempo real usando Firebase Firestore.
//
// ¿Por qué Firestore y no "FCM puro"?
// Enviar una notificación push real (FCM) a MUCHOS dispositivos requiere
// un servidor backend con la Admin SDK / clave privada — no se puede hacer
// de forma segura solo con JavaScript en el navegador.
//
// Firestore SÍ permite tiempo real sin backend: el panel admin escribe
// un documento, y TODOS los navegadores con la página abierta (gracias a
// onSnapshot) reciben el cambio al instante y muestran el popup con el
// mensaje real.
//
// Esto cubre el caso principal: "que llegue el mensaje real a todos los
// que están viendo la página en ese momento".

import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import { obtenerApp } from "./firebase-app.js";
import { mostrarToast, reproducirSonido, reproducirSonidoAlerta } from "./notifications.js";
import { mostrarAlertaCompleta, mostrarAlertaLibre } from "./alertas.js";

const NOMBRE_COLECCION = "mensajes_push";

// Duración máxima de una alerta activa (15 minutos en milisegundos)
const DURACION_ALERTA_MS = 15 * 60 * 1000;

let db = null;
let yaEscuchando = false;
let primeraCarga = true; // evita mostrar todos los mensajes viejos al abrir la página

function obtenerDB() {
    if (!db) {
        db = getFirestore(obtenerApp());
    }
    return db;
}

/**
 * Envía un mensaje nuevo a Firestore. Todos los navegadores con
 * escucharMensajesPush() activo lo recibirán en tiempo real.
 *
 * Para una ALERTA METEOROLÓGICA, pasar el objeto datosAlerta:
 *   { nivel, titulo, cuerpo, distrito, intensidad, lat, lng, duracionMin, tipo:"alerta" }
 *
 * @param {string} titulo
 * @param {string} cuerpo
 * @param {object} [datosAlerta]  - datos extendidos de alerta (opcional)
 */
export async function enviarMensajePush(titulo, cuerpo, datosAlerta = null) {
    const database = obtenerDB();
    const ref = collection(database, NOMBRE_COLECCION);
    const doc = {
        titulo,
        cuerpo,
        fecha: serverTimestamp()
    };
    // Si vienen datos de alerta, incluirlos para que los navegadores
    // puedan mostrar el sistema de alerta completo.
    // Todas las alertas tienen un timer de 15 minutos por defecto.
    if (datosAlerta) {
        // Forzar duracionMin a 15 si no se especifica
        if (!datosAlerta.duracionMin || datosAlerta.duracionMin <= 0) {
            datosAlerta.duracionMin = 15;
        }
        // Agregar timestamp de inicio para calcular si la alerta sigue activa
        datosAlerta.timestampInicio = Date.now();
        Object.assign(doc, datosAlerta);
    }
    await addDoc(ref, doc);
}

/**
 * Escucha en tiempo real los mensajes nuevos y muestra un toast +
 * notificación nativa (si hay permiso) a TODOS los navegadores con
 * la página abierta.
 *
 * NUEVA LÓGICA:
 * - Al cargar la página (primeraCarga), verifica si hay una alerta
 *   activa dentro de los 15 minutos. Si la hay, la muestra; si no,
 *   muestra "Libre de alertas" (verde).
 * - Cuando llega un mensaje NUEVO (cambio del admin), lo procesa:
 *   - Si es alerta: muestra la alerta completa con timer de 15 min.
 *   - Si es mensaje normal: muestra toast simple.
 */
export function escucharMensajesPush() {
    if (yaEscuchando) return;
    yaEscuchando = true;

    try {
        const database = obtenerDB();
        const ref = collection(database, NOMBRE_COLECCION);
        const q = query(ref, orderBy("fecha", "desc"), limit(1));

        onSnapshot(q, (snapshot) => {
            // PRIMERA CARGA: verificar si hay alerta activa
            if (primeraCarga) {
                primeraCarga = false;

                // Revisar el documento más reciente para ver si es una alerta activa
                if (!snapshot.empty) {
                    const doc = snapshot.docs[0];
                    const data = doc.data();
                    const esAlerta = data.tipo === "alerta" ||
                        (data.nivel && data.nivel !== "normal" && data.nivel !== "vigilancia");

                    if (esAlerta) {
                        // Verificar si la alerta está dentro de los 15 minutos
                        const timestampInicio = data.timestampInicio || null;
                        const fechaDoc = data.fecha?.toMillis?.() || null;
                        let tiempoReferencia = timestampInicio || fechaDoc;

                        if (tiempoReferencia) {
                            const transcurrido = Date.now() - tiempoReferencia;
                            if (transcurrido < DURACION_ALERTA_MS) {
                                // La alerta sigue activa → mostrarla.
                                // Se pasa la duración completa (15 min) y el
                                // timestampInicio real; el contador sincronizado
                                // calcula el tiempo restante por sí mismo.
                                mostrarAlertaActiva(data, data.duracionMin || 15);
                                return;
                            }
                        } else {
                            // Sin timestamp, asumir activa (compatibilidad)
                            mostrarAlertaActiva(data, 15);
                            return;
                        }
                    }
                }

                // No hay alerta activa → mostrar "Libre de alertas"
                mostrarAlertaLibre();
                return;
            }

            // CAMBIOS POSTERIORES (nuevos mensajes del admin)
            snapshot.docChanges().forEach((cambio) => {
                if (cambio.type === "added") {
                    const data = cambio.doc.data();
                    const titulo = data.titulo || "🔔 Notificación";
                    const cuerpo = data.cuerpo || "";

                    // ¿Es una ALERTA METEOROLÓGICA?
                    const esAlerta = data.tipo === "alerta" ||
                        (data.nivel && data.nivel !== "normal" && data.nivel !== "vigilancia");

                    if (esAlerta) {
                        // --- Sistema de alerta completo (12 efectos) ---
                        // El timer se resetea a 15 minutos (lo maneja mostrarAlertaCompleta)
                        mostrarAlertaActiva(data, data.duracionMin || 15);
                    } else {
                        // --- Mensaje normal: toast simple (comportamiento original) ---
                        mostrarToast(titulo, cuerpo, "alerta", true);
                    }

                    // Notificación nativa del sistema (si hay permiso)
                    if ("Notification" in window && Notification.permission === "granted") {
                        try {
                            new Notification(titulo, {
                                body: cuerpo,
                                icon: "https://cdn-icons-png.flaticon.com/512/1827/1827301.png",
                                tag: "antamina-mensaje-" + Date.now()
                            });
                        } catch (e) {
                            // Silencioso: el toast ya se mostró
                        }
                    }
                }
            });
        }, (error) => {
            console.error("Error escuchando mensajes:", error);
            // En caso de error, mostrar "Libre de alertas" como fallback
            try {
                mostrarAlertaLibre();
            } catch (e) { /* no crítico */ }
        });

    } catch (error) {
        console.error("No se pudo iniciar la escucha de mensajes:", error);
        try {
            mostrarAlertaLibre();
        } catch (e) { /* no crítico */ }
    }
}

/**
 * Muestra una alerta activa con todos los datos del documento Firestore.
 * Pasa el timestampInicio real del documento para que el contador
 * se sincronice entre todos los navegadores (llegue a cero al mismo
 * tiempo que el del admin).
 * @param {object} data - datos del documento
 * @param {number} duracionMin - duración del timer en minutos
 */
function mostrarAlertaActiva(data, duracionMin) {
    reproducirSonido();
    mostrarAlertaCompleta({
        nivel:           data.nivel || "emergencia",
        titulo:          data.titulo || "⚡ ALERTA DE TORMENTA ELÉCTRICA",
        mensaje:         data.cuerpo || "",
        distrito:        data.distrito || "",
        intensidad:      data.intensidad || "",
        lat:             (typeof data.lat === "number") ? data.lat : null,
        lng:             (typeof data.lng === "number") ? data.lng : null,
        duracionMin:     duracionMin,
        timestampInicio: (typeof data.timestampInicio === "number") ? data.timestampInicio : null
    });
}
