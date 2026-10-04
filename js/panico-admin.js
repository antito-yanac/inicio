// js/panico-admin.js
// ============================================================
// Listener de solicitudes de pánico en admin.html
// ============================================================
// - Escucha Firestore en tiempo real.
// - Muestra una tarjeta flotante persistente por cada solicitud
//   no atendida.
// - Botón "Ver en mapa" y "Marcar como atendido".
// ============================================================

import { getFirestore, collection, query, where, onSnapshot,
         doc, updateDoc, serverTimestamp, orderBy }
    from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import { obtenerApp } from "./firebase-app.js";
import { mostrarToast } from "./notifications.js";

const COLECCION = "mensajes_push";

let contenedor = null;

// ------------------------------------------------------------
// Crear contenedor para las tarjetas
// ------------------------------------------------------------
function asegurarContenedor() {
    if (document.getElementById("panico-admin-contenedor")) {
        contenedor = document.getElementById("panico-admin-contenedor");
        return contenedor;
    }
    contenedor = document.createElement("div");
    contenedor.id = "panico-admin-contenedor";
    document.body.appendChild(contenedor);
    return contenedor;
}

// ------------------------------------------------------------
// Render de una tarjeta
// ------------------------------------------------------------
function crearTarjeta(docId, data) {
    const id = `panico-card-${docId}`;
    if (document.getElementById(id)) return; // ya existe

    const card = document.createElement("div");
    card.id = id;
    card.className = "panico-card";

    const fecha = data.fecha
        ? new Date(data.fecha).toLocaleString("es-PE")
        : "Hora desconocida";

    const mapsUrl = (data.lat != null && data.lng != null)
        ? `https://www.google.com/maps?q=${data.lat},${data.lng}`
        : null;

    card.innerHTML = `
        <div class="panico-card-header">
            <span class="panico-card-icono">🆘</span>
            <div>
                <div class="panico-card-sub">SOLICITUD DE AYUDA</div>
                <div class="panico-card-hora">${fecha}</div>
            </div>
            <button class="panico-card-cerrar" aria-label="Cerrar">×</button>
        </div>
        <div class="panico-card-body">
            <p><strong>👤 Nombre:</strong> ${escapeHtml(data.nombre || "(no indicado)")}</p>
            <p><strong>📝 Descripción:</strong> ${escapeHtml(data.descripcion || "(sin descripción)")}</p>
            ${data.lat != null ? `
                <p><strong>📍 Ubicación:</strong> ${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}</p>
            ` : ""}
        </div>
        <div class="panico-card-acciones">
            ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" class="panico-card-btn-mapa">📍 Ver en mapa</a>` : ""}
            <button class="panico-card-btn-atender">✓ Marcar como atendido</button>
        </div>
    `;

    // Cerrar localmente (sin marcar como atendido)
    card.querySelector(".panico-card-cerrar").addEventListener("click", () => {
        card.remove();
    });

    // Marcar como atendido
    card.querySelector(".panico-card-btn-atender").addEventListener("click", async () => {
        try {
            const db = getFirestore(obtenerApp());
            await updateDoc(doc(db, COLECCION, docId), {
                atendido: true,
                atendidoEn: serverTimestamp()
            });
            mostrarToast("✅ Atendido", "La solicitud fue marcada como atendida.", "exito", false);
            card.remove();
        } catch (e) {
            console.error("panico-admin: error marcando atendido", e);
            mostrarToast("⚠️ Error", "No se pudo marcar como atendido.", "alerta", true);
        }
    });

    asegurarContenedor().appendChild(card);
}

function escapeHtml(txt) {
    return String(txt)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ------------------------------------------------------------
// Escuchar Firestore en tiempo real
// ------------------------------------------------------------
function iniciarListener() {
    try {
        const db = getFirestore(obtenerApp());
        const ref = collection(db, COLECCION);

        // Traer los últimos 20 (para incluir los no atendidos recientes)
        const q = query(ref, orderBy("fecha", "desc"));

        onSnapshot(q, (snapshot) => {
            snapshot.docs.forEach((d) => {
                const data = d.data();
                if (data.tipo !== "panico") return;
                if (data.atendido === true) {
                    // Si ya está marcado como atendido, quitar la tarjeta si existe
                    const el = document.getElementById(`panico-card-${d.id}`);
                    if (el) el.remove();
                    return;
                }
                crearTarjeta(d.id, data);
            });
        }, (error) => {
            console.warn("panico-admin: error listener", error);
        });

        console.log("🆘 panico-admin: escuchando solicitudes");
    } catch (e) {
        console.warn("panico-admin: no se pudo iniciar", e);
    }
}

// ------------------------------------------------------------
// Auto-init
// ------------------------------------------------------------
function init() {
    asegurarContenedor();
    iniciarListener();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
