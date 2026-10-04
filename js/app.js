//======================================================
// Buscador Lugares Antamina 2026
// Archivo principal
//======================================================

import { cargarLugares, obtenerCarpetas } from "./data.js";   // ⬅️ CORREGIDO
import { crearBuscador, teclado } from "./search.js";
import { crearMapa } from "./map.js";
import { inicializarFirebase } from "./notifications.js";
import { escucharMensajesPush } from "./mensajes.js";
import { mostrarAlertaCompleta, cerrarAlertaTotal, mostrarAlertaLibre } from "./alertas.js";
import { iniciarEstadoCliente } from "./estado-cliente.js";

//======================================================
// Referencias HTML
//======================================================

const input   = document.getElementById("search");
const stats   = document.getElementById("stats");
const results = document.getElementById("results");

//======================================================

let lugares = [];
let buscar  = null;
let mapa    = null;

//======================================================
// Inicio
//======================================================

async function iniciar() {

    try {

        stats.textContent = "Cargando lugares...";

        lugares = await cargarLugares();

        buscar = crearBuscador(lugares);

        mapa = crearMapa("map");

        mapa.cargarGeoJSON(lugares);

        stats.textContent = `${lugares.length} lugares cargados`;

        // ⬅️ NUEVO: activar filtros de carpeta + tipo
        inicializarFiltros(lugares, mapa);

        // Escuchar mensajes push en tiempo real (Firestore).
        escucharMensajesPush();

        // Habilitar Firebase Messaging
        inicializarFirebase().catch(err => console.warn("Firebase:", err.message));

        // Respaldo del cliente Keraunos
        try {
            iniciarEstadoCliente({ modo: "index" });
        } catch (e) {
            console.warn("estado-cliente (index) no arrancó:", e);
        }

    } catch (error) {

        console.error(error);

        stats.textContent = "Error cargando lugares";

    }

}

//======================================================
// Eventos
//======================================================

input.addEventListener("input", buscarTexto);
input.addEventListener("keydown", controlarTeclado);

//======================================================
// Buscar
//======================================================

function buscarTexto() {

    const texto = input.value.trim();

    cambiarColorFondo(texto);

    buscar(texto, results, mapa, stats);

}

//======================================================
// Teclado
//======================================================

function controlarTeclado(e) {
    teclado(e, mapa);
}

//======================================================
// Fondo dinámico
//======================================================

function cambiarColorFondo(texto) {

    if (texto.length === 0) {
        document.body.style.backgroundColor = "#2c3e50";
        return;
    }

    const tono = (texto.length * 18) % 360;
    document.body.style.backgroundColor = `hsl(${tono},45%,30%)`;

}

//======================================================
// Botón "Consultar alerta meteorológica"
//======================================================

function configurarBotonConsulta() {

    const btn = document.getElementById("btn-test-alerta");
    if (!btn) return;

    btn.addEventListener("click", () => {
        consultarEstadoAlerta();
    });

}

async function consultarEstadoAlerta() {
    try {
        const { getFirestore, collection, query, orderBy, limit, getDocs } =
            await import("https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js");
        const { obtenerApp } = await import("./firebase-app.js");

        const db = getFirestore(obtenerApp());
        const ref = collection(db, "mensajes_push");
        const q = query(ref, orderBy("fecha", "desc"), limit(1));
        const snapshot = await getDocs(q);

        const DURACION_ALERTA_MS = 15 * 60 * 1000;

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            const data = doc.data();
            const esAlerta = data.tipo === "alerta" ||
                (data.nivel && data.nivel !== "normal" && data.nivel !== "vigilancia");

            if (esAlerta) {
                const timestampInicio = data.timestampInicio || null;
                const fechaDoc = data.fecha?.toMillis?.() || null;
                let tiempoRef = timestampInicio || fechaDoc;

                if (tiempoRef) {
                    const transcurrido = Date.now() - tiempoRef;
                    if (transcurrido < DURACION_ALERTA_MS) {
                        mostrarAlertaCompleta({
                            nivel:           data.nivel || "roja",
                            titulo:          data.titulo || "⚡ ALERTA DE TORMENTA ELÉCTRICA",
                            mensaje:         data.cuerpo || "",
                            distrito:        data.distrito || "",
                            intensidad:      data.intensidad || "",
                            lat:             (typeof data.lat === "number") ? data.lat : null,
                            lng:             (typeof data.lng === "number") ? data.lng : null,
                            duracionMin:     data.duracionMin || 15,
                            timestampInicio: timestampInicio,
                            sectorOriginal:  data.sectorOriginal || null,
                            inicio:          data.inicio || null,
                            fin:             data.fin || null
                        });
                        return;
                    }
                } else {
                    mostrarAlertaCompleta({
                        nivel:           data.nivel || "roja",
                        titulo:          data.titulo || "⚡ ALERTA DE TORMENTA ELÉCTRICA",
                        mensaje:         data.cuerpo || "",
                        distrito:        data.distrito || "",
                        intensidad:      data.intensidad || "",
                        lat:             (typeof data.lat === "number") ? data.lat : null,
                        lng:             (typeof data.lng === "number") ? data.lng : null,
                        duracionMin:     data.duracionMin || 15,
                        timestampInicio: fechaDoc,
                        sectorOriginal:  data.sectorOriginal || null,
                        inicio:          data.inicio || null,
                        fin:             data.fin || null
                    });
                    return;
                }
            }
        }

        mostrarAlertaLibre();

    } catch (e) {
        console.warn("app.js: error consultando estado de alerta", e);
        mostrarAlertaLibre();
    }
}

configurarBotonConsulta();

//======================================================
// ⬅️ NUEVO: Filtros de carpeta + tipo
//======================================================

function inicializarFiltros(lugares, mapa) {

    const selectCarpeta = document.getElementById("folder-select");
    const botonesTipo   = document.querySelectorAll(".type-btn");

    if (!selectCarpeta) {
        console.warn("app.js: no existe #folder-select");
        return;
    }
    if (!mapa || typeof mapa.filtrarLugares !== "function") {
        console.warn("app.js: mapa.filtrarLugares no está disponible");
        return;
    }

    // 1) Poblar el select
    const carpetas = obtenerCarpetas(lugares);
    console.info(`app.js: ${carpetas.length} carpetas detectadas`, carpetas);

    selectCarpeta.innerHTML =
        `<option value="__all__">📁 Todas las carpetas</option>` +
        carpetas.map(c =>
            `<option value="${escapeHtml(c)}">📁 ${escapeHtml(c)}</option>`
        ).join("");

    // 2) Estado
    let filtroCarpeta = "__all__";
    let filtroTipo    = "all";

    // 3) Aplicar filtros
    function aplicar() {
        const visibles = mapa.filtrarLugares(props => {
            const okCarpeta =
                filtroCarpeta === "__all__" ||
                (props.carpeta || "(Raíz)") === filtroCarpeta;

            const okTipo =
                filtroTipo === "all" ||
                props.tipo === filtroTipo;

            return okCarpeta && okTipo;
        });

        stats.textContent = `${visibles} lugares visibles`;
    }

    // 4) Eventos
    selectCarpeta.addEventListener("change", e => {
        filtroCarpeta = e.target.value;
        aplicar();
    });

    botonesTipo.forEach(btn => {
        btn.addEventListener("click", () => {
            botonesTipo.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            filtroTipo = btn.dataset.type;
            aplicar();
        });
    });

}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

//======================================================

iniciar();
