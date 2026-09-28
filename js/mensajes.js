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
// v2:
// - Soporta MÚLTIPLES alertas activas simultáneas (una por zona).
// - Maneja "alerta-resuelta" para quitar una zona específica.
// - Pasa sectorOriginal / inicio / fin a mostrarAlertaCompleta.
// - Trae los últimos 20 documentos (no solo 1) para no perder alertas
//   cuando el scraper dispara varias zonas seguidas.
// ============================================================

import {
    getFirestore,
    collection,
    addDoc,
    query,
    orderBy,
    limit,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import { obtenerApp } from "./firebase-app.js";
import { mostrarToast, reproducirSonido, reproducirSonidoAlerta } from "./notifications.js";
import {
    mostrarAlertaCompleta,
    mostrarAlertaLibre,
    quitarAlerta
} from "./alertas.js";

const NOMBRE_COLECCION = "mensajes_push";

// Duración máxima de una alerta activa (15 minutos en milisegundos)
const DURACION_ALERTA_MS = 15 * 60 * 1000;

// Cuántos documentos traer en el listener. Se necesitan varios para
// no perder alertas cuando el scraper dispara varias zonas seguidas.
const LIMITE_DOCS = 50;

let db = null;
let yaEscuchando = false;
let primeraCarga = true; // evita mostrar todos los mensajes viejos al abrir la página

// Map de docId -> datos, para detectar duplicados y evitar reprocesar
const docsProcesados = new Set();

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
 * Para una RESOLUCIÓN de alerta (zona que vuelve a VERDE), pasar:
 *   { tipo: "alerta-resuelta", distrito: "Zona 1 - Campamentos" }
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
    if (datosAlerta) {
        // Si es alerta (no resuelta) y no tiene duración, forzar 15 min
        if (datosAlerta.tipo !== "alerta-resuelta") {
            if (!datosAlerta.duracionMin || datosAlerta.duracionMin <= 0) {
                datosAlerta.duracionMin = 15;
            }
        }
        // Agregar timestamp de inicio para calcular si la alerta sigue activa
        datosAlerta.timestampInicio = Date.now();
        Object.assign(doc, datosAlerta);
    }

    await addDoc(ref, doc);
}

/**
 * Escucha en tiempo real los mensajes nuevos y muestra la UI de alertas
 * a TODOS los navegadores con la página abierta.
 *
 * LÓGICA:
 * - Al cargar la página (primeraCarga), se procesan los últimos documentos
 *   para reconstruir el estado actual (qué zonas están en alerta).
 * - Cuando llega un mensaje NUEVO (cambio del admin o del scraper):
 *   - Si es "alerta": muestra la alerta completa (o actualiza la zona).
 *   - Si es "alerta-resuelta": quita la zona específica.
 *   - Si es mensaje normal: muestra toast simple.
 */
export function escucharMensajesPush() {
    if (yaEscuchando) return;
    yaEscuchando = true;

    try {
        const database = obtenerDB();
        const ref = collection(database, NOMBRE_COLECCION);
        const q = query(ref, orderBy("fecha", "desc"), limit(LIMITE_DOCS));

        onSnapshot(q, (snapshot) => {
            // ------------------------------------------------------------
            // PRIMERA CARGA: reconstruir el estado a partir de los últimos
            // documentos. Buscar todas las zonas que tienen una alerta
            // activa (dentro de los 15 min) y que NO hayan sido resueltas
            // por un "alerta-resuelta" posterior.
            // ------------------------------------------------------------
            if (primeraCarga) {
                primeraCarga = false;
                procesarPrimeraCarga(snapshot);
                return;
            }

            // ------------------------------------------------------------
            // CAMBIOS POSTERIORES (nuevos mensajes del admin o del scraper)
            // ------------------------------------------------------------
            snapshot.docChanges().forEach((cambio) => {
                if (cambio.type !== "added") return;

                const docId = cambio.doc.id;
                if (docsProcesados.has(docId)) return;
                docsProcesados.add(docId);

                const data = cambio.doc.data();
                procesarDocumentoNuevo(data);
            });
        }, (error) => {
            console.error("Error escuchando mensajes:", error);
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

// ============================================================
// PRIMERA CARGA — reconstruir el estado actual
// ============================================================
function procesarPrimeraCarga(snapshot) {
    // El snapshot viene ordenado por fecha desc (más reciente primero).
    // Necesitamos procesar de más viejo a más nuevo para que las
    // "alerta-resuelta" posteriores anulen las alertas previas.

    const docs = snapshot.docs.map(d => ({
        id: d.id,
        data: d.data()
    })).reverse(); // ahora más viejo primero

    // Mapa: distrito -> { tipo: "alerta"|"resuelta", ... }
    // Recorremos todos los docs y nos quedamos con el último estado
    // por distrito.
    const estadoPorZona = new Map();

    // También llevamos los mensajes normales que aún estén dentro
    // de la ventana de 15 min (para mostrarlos al cargar)
    const mensajesNormales = [];

    const ahora = Date.now();

    for (const { data } of docs) {
        const esResuelta = data.tipo === "alerta-resuelta";
        const esAlerta = data.tipo === "alerta" ||
            (data.nivel && data.nivel !== "normal" && data.nivel !== "vigilancia");
        const esNormal = !esResuelta && !esAlerta;

        if (esResuelta) {
            const distrito = data.distrito || "";
            if (distrito) {
                estadoPorZona.set(distrito, { tipo: "resuelta", data });
            }
            continue;
        }

        if (esAlerta) {
            const distrito = data.distrito || "";
            if (!distrito) continue;

            // Verificar si sigue dentro de los 15 min
            const tsInicio = data.timestampInicio ||
                             (data.fecha?.toMillis?.() || 0);
            const duracionMin = data.duracionMin || 15;
            const duracionMs = duracionMin * 60 * 1000;

            if (tsInicio && (ahora - tsInicio) < duracionMs) {
                estadoPorZona.set(distrito, { tipo: "alerta", data, tsInicio, duracionMin });
            }
            continue;
        }

        if (esNormal) {
            const fecha = data.fecha?.toMillis?.() || 0;
            if (fecha && (ahora - fecha) < DURACION_ALERTA_MS) {
                mensajesNormales.push(data);
            }
        }
    }

    // Aplicar el estado reconstruido
    const zonasActivas = [];
    for (const [distrito, entrada] of estadoPorZona.entries()) {
        if (entrada.tipo === "alerta") {
            zonasActivas.push(entrada);
        }
        // Si es "resuelta", no se muestra
    }

    if (zonasActivas.length === 0) {
        mostrarAlertaLibre();
        // Mostrar mensajes normales recientes (si hay) después de un pequeño delay
        if (mensajesNormales.length > 0) {
            setTimeout(() => {
                mensajesNormales.slice(0, 3).forEach(m => {
                    mostrarToast(m.titulo || "🔔 Notificación", m.cuerpo || "", "alerta", true);
                });
            }, 1500);
        }
        return;
    }

    // Mostrar la primera zona (el resto se encolará)
    // Pasamos todas a mostrarAlertaCompleta; la cola FIFO interna de
    // alertas.js se encarga de mostrarlas una por una.
    for (const entrada of zonasActivas) {
        mostrarAlertaActiva(
            entrada.data,
            entrada.duracionMin,
            entrada.tsInicio
        );
    }
}

// ============================================================
// NUEVO DOCUMENTO — procesar según su tipo
// ============================================================
function procesarDocumentoNuevo(data) {
    const titulo = data.titulo || "🔔 Notificación";
    const cuerpo = data.cuerpo || "";

    const esResuelta = data.tipo === "alerta-resuelta";
    const esAlerta = data.tipo === "alerta" ||
        (data.nivel && data.nivel !== "normal" && data.nivel !== "vigilancia");

    // ------------------------------------------------------------
    // CASO 1: alerta-resuelta → quitar la zona específica
    // ------------------------------------------------------------
    if (esResuelta) {
        const distrito = data.distrito || "";
        if (distrito) {
            quitarAlerta(distrito);
        } else {
            // Sin distrito → quitar todas
            mostrarAlertaLibre();
        }
        return;
    }

    // ------------------------------------------------------------
    // CASO 2: alerta → mostrar / actualizar zona
    // ------------------------------------------------------------
    if (esAlerta) {
        reproducirSonido();
        const duracionMin = data.duracionMin || 15;
        const tsInicio = (typeof data.timestampInicio === "number")
            ? data.timestampInicio
            : null;

        mostrarAlertaActiva(data, duracionMin, tsInicio);

        // Notificación nativa del sistema (si hay permiso)
        if ("Notification" in window && Notification.permission === "granted") {
            try {
                new Notification(titulo, {
                    body: cuerpo,
                    icon: "https://cdn-icons-png.flaticon.com/512/1827/1827301.png",
                    tag: "antamina-alerta-" + Date.now()
                });
            } catch (e) { /* silencioso */ }
        }
        return;
    }

    // ------------------------------------------------------------
    // CASO 3: mensaje normal → toast simple
    // ------------------------------------------------------------
    mostrarToast(titulo, cuerpo, "alerta", true);

    if ("Notification" in window && Notification.permission === "granted") {
        try {
            new Notification(titulo, {
                body: cuerpo,
                icon: "https://cdn-icons-png.flaticon.com/512/1827/1827301.png",
                tag: "antamina-mensaje-" + Date.now()
            });
        } catch (e) { /* silencioso */ }
    }
}

/**
 * Muestra una alerta activa con todos los datos del documento Firestore.
 * Pasa el timestampInicio real del documento para que el contador
 * se sincronice entre todos los navegadores (llegue a cero al mismo
 * tiempo que el del admin).
 *
 * @param {object} data - datos del documento
 * @param {number} duracionMin - duración del timer en minutos
 * @param {number|null} timestampInicio - ms epoch del inicio de la alerta
 */
function mostrarAlertaActiva(data, duracionMin, timestampInicio) {
    mostrarAlertaCompleta({
        tipo:            "alerta",
        nivel:           data.nivel || "roja",
        titulo:          data.titulo || "⚡ ALERTA DE TORMENTA ELÉCTRICA",
        mensaje:         data.cuerpo || data.mensaje || "",
        distrito:        data.distrito || "",
        intensidad:      data.intensidad || "",
        lat:             (typeof data.lat === "number") ? data.lat : null,
        lng:             (typeof data.lng === "number") ? data.lng : null,
        duracionMin:     duracionMin,
        timestampInicio: timestampInicio,
        // Campos nuevos (vienen del scraper):
        sectorOriginal:  data.sectorOriginal || null,
        inicio:          data.inicio || null,
        fin:             data.fin || null
    });
}
