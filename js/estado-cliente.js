// js/estado-cliente.js
// ============================================================
// Puente entre estado.json (publicado por monitor.js en Termux)
// y el sistema de alertas de Antamina.
//
// Modos:
//   - modo: "admin"  → Lee estado.json, y por cada alerta NUEVA
//                      llama a enviarMensajePush() (Firestore).
//                      Solo corre en admin.html con sesión.
//   - modo: "index"  → Lee estado.json, y por cada alerta NUEVA
//                      llama a mostrarAlertaCompleta() directamente.
//                      Sirve como respaldo si admin.html está cerrado.
//                      Corre en index.html.
//
// Filtros:
//   E1) Solo dispara si nivel ∈ {amarilla, naranja, roja}. VERDE = no.
//   F3) Dispara cuando cambia el nivel O cuando cambia el
//       timestampInicio (evento nuevo).
// ============================================================

import { mostrarAlertaCompleta, mostrarAlertaLibre, quitarAlerta } from "./alertas.js";

const ESTADO_URL    = "./estado.json";
const INTERVALO_MS  = 30_000;
const STORAGE_KEY   = "keraunos_estado_cliente_v2";
const MAX_HISTORIAL = 200;

// Estado interno del cliente
const cliente = {
    modo: null,                 // "admin" | "index"
    intervaloId: null,
    // Historial: { clave -> { nivel, timestampInicio } }
    historial: {},              // Map serializable
    // Últimas zonas vistas: para detectar resoluciones
    zonasVistas: new Set(),     // distritos con alerta activa en el último ciclo
    cargado: false
};

// ------------------------------------------------------------
// Persistencia del historial
// ------------------------------------------------------------
function cargarHistorial() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { historial: {}, zonas: [] };
        const parsed = JSON.parse(raw);
        return {
            historial: parsed.historial || {},
            zonas: parsed.zonas || []
        };
    } catch {
        return { historial: {}, zonas: [] };
    }
}

function guardarHistorial(historial, zonas) {
    try {
        // Limitar a MAX_HISTORIAL entradas
        const claves = Object.keys(historial);
        if (claves.length > MAX_HISTORIAL) {
            const recortadas = claves.slice(-MAX_HISTORIAL);
            const nuevo = {};
            recortadas.forEach(k => nuevo[k] = historial[k]);
            historial = nuevo;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            historial,
            zonas: Array.from(zonas)
        }));
    } catch {}
}

// ------------------------------------------------------------
// Clave única para cada alerta: distrito::timestampInicio
// ------------------------------------------------------------
function claveAlerta(a) {
    return `${a.distrito}::${a.timestampInicio}`;
}

// ------------------------------------------------------------
// Leer estado.json (con cache-busting)
// ------------------------------------------------------------
async function leerEstado() {
    const url = `${ESTADO_URL}?t=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
}

// ------------------------------------------------------------
// Enviar alerta a Firestore (solo modo admin)
// ------------------------------------------------------------
async function enviarAlertaFirestore(alerta) {
    const { enviarMensajePush } = await import("./mensajes.js");

    // Armar datosAlerta en el formato que espera enviarMensajePush
    const datosAlerta = {
        tipo:            "alerta",
        nivel:           alerta.nivel,                  // "amarilla" | "naranja" | "roja"
        distrito:        alerta.distrito,
        lat:             alerta.lat,
        lng:             alerta.lng,
        duracionMin:     alerta.duracionMin,
        timestampInicio: alerta.timestampInicio,
        sectorOriginal:  alerta.sectorOriginal,
        inicio:          alerta.inicio,
        fin:             alerta.fin
    };

    await enviarMensajePush(
        alerta.titulo || `⚡ ALERTA ${alerta.nivel.toUpperCase()} — ${alerta.distrito}`,
        alerta.mensaje || `Actividad eléctrica detectada en ${alerta.distrito}.`,
        datosAlerta
    );
}

// ------------------------------------------------------------
// Enviar resolución a Firestore (solo modo admin)
// ------------------------------------------------------------
async function enviarResolucionFirestore(distrito) {
    const { enviarMensajePush } = await import("./mensajes.js");
    await enviarMensajePush(
        `✅ Alerta finalizada — ${distrito}`,
        `La alerta meteorológica en ${distrito} ha finalizado.`,
        {
            tipo: "alerta-resuelta",
            distrito
        }
    );
}

// ------------------------------------------------------------
// Ciclo principal
// ------------------------------------------------------------
async function ciclo() {
    let data;
    try {
        data = await leerEstado();
    } catch (e) {
        console.warn("estado-cliente: no se pudo leer estado.json:", e.message);
        return;
    }

    const alertas = Array.isArray(data.alertas) ? data.alertas : [];

    // Cargar historial persistido
    const { historial, zonas } = cargarHistorial();
    const zonasVistas = new Set(zonas);

    // Distritos presentes en este ciclo (con nivel > verde)
    const distritosActuales = new Set();

    // --------------------------------------------------------
    // FASE 1 — Detectar alertas NUEVAS (E1 + F3)
    // --------------------------------------------------------
    for (const a of alertas) {
        // E1: solo alertas amarilla, naranja, roja
        if (a.nivel !== "amarilla" && a.nivel !== "naranja" && a.nivel !== "roja") {
            continue;
        }

        // Verificar que tenga distrito (si no, no podemos pintarlo)
        if (!a.distrito) continue;

        distritosActuales.add(a.distrito);

        const clave = claveAlerta(a);
        const anterior = historial[clave];

        // F3: dispara si es nueva, o si cambió el nivel con el mismo
        // timestampInicio (poco probable pero posible), o si es un
        // timestampInicio distinto (evento nuevo).
        const esNueva = !anterior;

        if (esNueva) {
            // Registrar ANTES de disparar (para evitar duplicados si
            // el ciclo se solapa)
            historial[clave] = {
                nivel: a.nivel,
                timestampInicio: a.timestampInicio,
                distrito: a.distrito
            };
            zonasVistas.add(a.distrito);

            // Disparar según el modo
            if (cliente.modo === "admin") {
                try {
                    await enviarAlertaFirestore(a);
                    // Toast informativo (no bloquea)
                    try {
                        const { mostrarToast } = await import("./notifications.js");
                        mostrarToast(
                            "🤖 Alerta automática enviada",
                            `${a.distrito} · ${a.nivel.toUpperCase()}`,
                            "exito",
                            false
                        );
                    } catch {}
                } catch (e) {
                    console.error("estado-cliente: error enviando a Firestore:", e);
                }
            } else if (cliente.modo === "index") {
                // Modo index: mostrar directamente como respaldo
                try {
                    await mostrarAlertaCompleta({
                        tipo:            "alerta",
                        nivel:           a.nivel,
                        titulo:          a.titulo,
                        mensaje:         a.mensaje,
                        distrito:        a.distrito,
                        lat:             a.lat,
                        lng:             a.lng,
                        duracionMin:     a.duracionMin,
                        timestampInicio: a.timestampInicio,
                        sectorOriginal:  a.sectorOriginal,
                        inicio:          a.inicio,
                        fin:             a.fin
                    });
                } catch (e) {
                    console.error("estado-cliente: error mostrando alerta:", e);
                }
            }
        }
    }

    // --------------------------------------------------------
    // FASE 2 — Detectar alertas RESUELTAS (D2)
    // Una zona que antes estaba en alerta y ya no está en el JSON.
    // --------------------------------------------------------
    const distritosResueltos = [];
    for (const distritoAnterior of zonasVistas) {
        if (!distritosActuales.has(distritoAnterior)) {
            distritosResueltos.push(distritoAnterior);
        }
    }

    for (const distrito of distritosResueltos) {
        zonasVistas.delete(distrito);

        if (cliente.modo === "admin") {
            try {
                await enviarResolucionFirestore(distrito);
                try {
                    const { mostrarToast } = await import("./notifications.js");
                    mostrarToast(
                        "✅ Alerta finalizada",
                        distrito,
                        "info",
                        false
                    );
                } catch {}
            } catch (e) {
                console.error("estado-cliente: error enviando resolución:", e);
            }
        } else if (cliente.modo === "index") {
            try {
                await quitarAlerta(distrito);
            } catch (e) {
                console.error("estado-cliente: error quitando alerta:", e);
            }
        }
    }

    // --------------------------------------------------------
    // FASE 3 — Si no hay ninguna zona activa, mostrar libre
    // (solo en modo index; en admin no pintamos nada)
    // --------------------------------------------------------
    if (cliente.modo === "index" &&
        distritosActuales.size === 0 &&
        zonasVistas.size === 0 &&
        !cliente.cargado) {
        // Solo la primera vez, mostrar libre
        try { await mostrarAlertaLibre(); } catch {}
        cliente.cargado = true;
    }

    // Persistir historial
    guardarHistorial(historial, zonasVistas);
}

// ------------------------------------------------------------
// API pública
// ------------------------------------------------------------
export function iniciarEstadoCliente(opciones = {}) {
    if (cliente.intervaloId !== null) return;

    cliente.modo = opciones.modo || "index";
    console.log(`estado-cliente: iniciado en modo "${cliente.modo}" (${INTERVALO_MS / 1000}s)`);

    // Primera pasada inmediata
    ciclo();

    // Ciclo periódico
    cliente.intervaloId = setInterval(ciclo, INTERVALO_MS);
}

export function detenerEstadoCliente() {
    if (cliente.intervaloId !== null) {
        clearInterval(cliente.intervaloId);
        cliente.intervaloId = null;
    }
}

// ------------------------------------------------------------
// Utilidad: resetear el historial (útil en pruebas)
// ------------------------------------------------------------
export function resetearHistorial() {
    try {
        localStorage.removeItem(STORAGE_KEY);
        cliente.historial = {};
        cliente.zonasVistas = new Set();
        cliente.cargado = false;
        console.log("estado-cliente: historial reseteado");
    } catch {}
}
