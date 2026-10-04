//======================================================
// Buscador Lugares Antamina 2026
// Archivo principal
//
// v2: añade el cliente del scraper Keraunos (modo "index"),
// que actúa como RESPALDO si admin.html no está abierto.
// ======================================================

//import { cargarLugares } from "./data.js";
import { cargarLugares, obtenerCarpetas } from "./data.js";
import { crearBuscador, teclado } from "./search.js";
import { crearMapa } from "./map.js";
import { inicializarFirebase } from "./notifications.js";
import { escucharMensajesPush } from "./mensajes.js";
import { mostrarAlertaCompleta, cerrarAlertaTotal, mostrarAlertaLibre } from "./alertas.js";
import { iniciarEstadoCliente } from "./estado-cliente.js";

//======================================================
// Referencias HTML
//======================================================

const input = document.getElementById("search");
const stats = document.getElementById("stats");
const results = document.getElementById("results");

//======================================================

let lugares = [];
let buscar = null;
let mapa = null;

//======================================================
// Inicio
//======================================================

async function iniciar() {

    try {

        stats.textContent = "Cargando lugares...";
        // Filtros de carpeta y tipo
        inicializarFiltros(lugares, mapa);

        lugares = await cargarLugares();

        buscar = crearBuscador(lugares);

        mapa = crearMapa("map");

        mapa.cargarGeoJSON(lugares);

        stats.textContent = `${lugares.length} lugares cargados`;

        // Escuchar mensajes push en tiempo real (Firestore).
        // Todos los navegadores con la página abierta reciben el
        // mensaje real que el admin envíe desde admin.html.
        escucharMensajesPush();

        // Habilitar Firebase Messaging de forma silenciosa (permiso +
        // Service Worker + token). No muestra toasts de estado.
        inicializarFirebase().catch(err => console.warn("Firebase:", err.message));

        // Respaldo del cliente Keraunos: si admin.html NO está abierto,
        // leemos estado.json nosotros mismos y mostramos las alertas
        // directamente (sin pasar por Firestore).
        try {
            iniciarEstadoCliente({ modo: "index" });
        } catch (e) {
            console.warn("estado-cliente (index) no arrancó:", e);
        }

    } catch (error) {

        console.error(error);

        stats.textContent = "Error cargando lugares.json";

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

    buscar(
        texto,
        results,
        mapa,
        stats
    );

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

    document.body.style.backgroundColor =
        `hsl(${tono},45%,30%)`;

}

//======================================================
// Botón "Consultar alerta meteorológica"
// Al presionar, consulta el estado actual de las alertas.
// Si el admin ha emitido una alerta activa (dentro de los 15
// minutos), la muestra. Si no hay alerta activa, muestra
// "Libre de alertas" (verde por defecto).
//======================================================

function configurarBotonConsulta() {

    const btn = document.getElementById("btn-test-alerta");

    if (!btn) return;

    btn.addEventListener("click", () => {
        // Consultar el estado actual: re-verificar Firestore
        // al forzar una nueva carga inicial
        consultarEstadoAlerta();
    });

}

// Consulta el estado actual de las alertas desde Firestore
async function consultarEstadoAlerta() {
    try {
        // Importar Firestore dinámicamente
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
                // Verificar si está dentro de los 15 minutos
                const timestampInicio = data.timestampInicio || null;
                const fechaDoc = data.fecha?.toMillis?.() || null;
                let tiempoRef = timestampInicio || fechaDoc;

                if (tiempoRef) {
                    const transcurrido = Date.now() - tiempoRef;
                    if (transcurrido < DURACION_ALERTA_MS) {
                        // Mostrar la alerta activa.
                        // Se pasa el timestampInicio REAL y la duración completa
                        // (15 min) para que el contador se sincronice entre todos
                        // los navegadores y llegue a cero al mismo tiempo.
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
                    // Sin timestamp, mostrar la alerta igual (contador local)
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

        // No hay alerta activa → mostrar "Libre de alertas"
        mostrarAlertaLibre();

    } catch (e) {
        console.warn("app.js: error consultando estado de alerta", e);
        // En caso de error, mostrar "Libre de alertas" como fallback
        mostrarAlertaLibre();
    }
}

configurarBotonConsulta();

//======================================================

iniciar();
// ======================================================
// FILTROS: carpeta + tipo
// ======================================================

function inicializarFiltros(lugares, mapa) {

    const selectCarpeta = document.getElementById("folder-select");
    const botonesTipo   = document.querySelectorAll(".type-btn");

    if (!selectCarpeta) return;

    // 1) Poblar el select con las carpetas detectadas
    const carpetas = obtenerCarpetas(lugares);
    selectCarpeta.innerHTML =
        `<option value="__all__">📁 Todas las carpetas</option>` +
        carpetas.map(c =>
            `<option value="${escapeHtml(c)}">📁 ${escapeHtml(c)}</option>`
        ).join("");

    // 2) Estado de filtros
    let filtroCarpeta = "__all__";
    let filtroTipo    = "all";

    // 3) Función que aplica ambos filtros al mapa
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

// Helper para evitar inyección en el <option>
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
