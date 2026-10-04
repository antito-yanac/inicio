// ============================================================
//  Monitor Keraunos — Scraper (v8)
//  ------------------------------------------------------------
//  Responsabilidad ÚNICA:
//    1. Scrapear Keraunos cada INTERVALO ms.
//    2. Extraer {nombre, nivel, inicio, fin} por cada tarjeta.
//    3. Escribir estado.json con `sectores[]` + `alertas[]`.
//    4. git push a GitHub Pages.
//
//  FIX v8 (sobre v7):
//    - FIX LOOKUP DE ZONA: antes se hacía CONFIG.MAPA_ZONAS[s.nombre]
//      con el nombre COMPLETO de la tarjeta ("Campamento Yanacancha -
//      (Nuevo Campamento, ...)"), pero MAPA_ZONAS usa claves CORTAS
//      ("Campamento Yanacancha"). El lookup devolvía undefined y todas
//      las alertas se descartaban con "continue" -> alertas[] siempre
//      vacío. Ahora se usa coincidencia PARCIAL (buscarZona), igual
//      que ya se hace con SECTORES_ESPERADOS.
//
//  FIX v7 (mantenido):
//    - Eliminado "git stash --include-untracked".
//    - Solo se usa "git pull --rebase --autostash".
//    - "git add -f" para forzar el add.
// ============================================================

const { exec } = require('child_process');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const CONFIG = require('./config.js');

const URL = CONFIG.URL;
const ARCHIVO_LOG = CONFIG.ARCHIVO_LOG;
const ARCHIVO_JSON = CONFIG.ARCHIVO_JSON;
const INTERVALO = CONFIG.INTERVALO;

// ------------------------------------------------------------
//  Mapa de niveles -> color y número
// ------------------------------------------------------------
const NIVELES = {
    ROJA:     { numero: 3, color: "#FA5858", clase: "roja",     emoji: "🔴" },
    NARANJA:  { numero: 2, color: "#FF8C00", clase: "naranja",  emoji: "🟠" },
    AMARILLA: { numero: 1, color: "#FFD400", clase: "amarilla", emoji: "🟡" },
    VERDE:    { numero: 0, color: "#2ECC71", clase: "verde",    emoji: "🟢" }
};

function registrarLog(mensaje) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const logLinea = `[${timestamp}] ${mensaje}\n`;
    console.log(logLinea.trim());
    try { fs.appendFileSync(ARCHIVO_LOG, logLinea, 'utf-8'); } catch (e) {}
}

// ------------------------------------------------------------
//  Normaliza un texto para comparar (minúsculas, espacios simples)
// ------------------------------------------------------------
function normalizar(texto) {
    return (texto || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------
//  Detecta el nivel de UNA tarjeta
// ------------------------------------------------------------
function detectarNivelDeTarjeta($, el) {
    const $el = $(el);

    let textoNivel = $el.find('.alert-text h2').first().text().trim().toUpperCase();
    if (!textoNivel) textoNivel = $el.find('.badge').first().text().trim().toUpperCase();
    if (!textoNivel) textoNivel = $el.find('.card-message').first().text().trim().toUpperCase();
    if (!textoNivel) textoNivel = $el.find('.icon').first().text().trim();
    if (!textoNivel) textoNivel = ($el.find('.alert-box').attr('style') || '').toUpperCase();

    if (textoNivel.includes("ROJA") || textoNivel.includes("ROJO") ||
        textoNivel.includes("NIVEL 3") || textoNivel.includes("🔴") ||
        textoNivel.includes("#FA5858")) {
        return "ROJA";
    }
    if (textoNivel.includes("NARANJA") ||
        textoNivel.includes("NIVEL 2") || textoNivel.includes("🟠") ||
        textoNivel.includes("#FF8C00")) {
        return "NARANJA";
    }
    if (textoNivel.includes("AMARILLA") || textoNivel.includes("AMARILLO") ||
        textoNivel.includes("NIVEL 1") || textoNivel.includes("🟡") ||
        textoNivel.includes("#FFD400")) {
        return "AMARILLA";
    }

    return "VERDE";
}

// ------------------------------------------------------------
//  Extrae hora de INICIO y FIN de UNA tarjeta
// ------------------------------------------------------------
function extraerHorasDeTarjeta($, el) {
    const $el = $(el);
    let inicio = null;
    let fin = null;

    $el.find('.small-text').each((i, p) => {
        const texto = $(p).text().trim();
        const m = texto.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
        if (!m) return;
        const valor = m[1];
        if (/inicio/i.test(texto)) inicio = valor;
        else if (/fin/i.test(texto)) fin = valor;
    });

    return { inicio, fin };
}

// ------------------------------------------------------------
//  FIX v8: busca la zona por COINCIDENCIA PARCIAL del nombre.
//  El nombre de la tarjeta es largo ("Campamento Yanacancha - (...)")
//  y las claves de MAPA_ZONAS son cortas ("Campamento Yanacancha").
// ------------------------------------------------------------
function buscarZona(nombre) {
    const norm = normalizar(nombre);
    for (const clave of Object.keys(CONFIG.MAPA_ZONAS)) {
        if (norm.includes(normalizar(clave))) {
            return CONFIG.MAPA_ZONAS[clave];
        }
    }
    return null;
}

// ------------------------------------------------------------
//  Consulta la página y devuelve el estado por sector
// ------------------------------------------------------------
async function consultarKeraunos() {
    try {
        const respuesta = await axios.get(URL, {
            headers: { "User-Agent": "Mozilla/5.0" },
            timeout: 20000
        });

        const $ = cheerio.load(respuesta.data);
        const tarjetas = $('.card.card-activo');
        const sectoresEnPagina = [];

        tarjetas.each((i, el) => {
            const $el = $(el);
            let nombre = $el.find('h1.title').first().text().trim();
            if (!nombre) nombre = ($el.attr('data-nombre') || `Sector ${i + 1}`).trim();

            const nivel = detectarNivelDeTarjeta($, el);
            const { inicio, fin } = extraerHorasDeTarjeta($, el);

            sectoresEnPagina.push({ nombre, nivel, inicio, fin });
        });

        // Combinar con la lista maestra de sectores esperados.
        const sectoresDetectados = [];
        const usados = new Set();

        for (const esperado of CONFIG.SECTORES_ESPERADOS) {
            const normEsperado = normalizar(esperado);
            const encontrado = sectoresEnPagina.find(s =>
                normalizar(s.nombre).includes(normEsperado)
            );

            if (encontrado) {
                usados.add(encontrado.nombre);
                sectoresDetectados.push({
                    nombre: encontrado.nombre,
                    nivel: encontrado.nivel,
                    inicio: encontrado.inicio,
                    fin: encontrado.fin
                });
            } else {
                sectoresDetectados.push({
                    nombre: esperado,
                    nivel: "VERDE",
                    inicio: null,
                    fin: null
                });
            }
        }

        if (CONFIG.INCLUIR_SECTORES_EXTRA) {
            for (const s of sectoresEnPagina) {
                if (!usados.has(s.nombre)) {
                    sectoresDetectados.push({ ...s });
                }
            }
        }

        const sectoresFinal = sectoresDetectados.map(s => {
            const info = NIVELES[s.nivel];
            return {
                nombre: s.nombre,
                nivel: s.nivel,
                nivelNumero: info.numero,
                color: info.color,
                clase: info.clase,
                emoji: info.emoji,
                inicio: s.inicio,
                fin: s.fin
            };
        });

        // Estado global = nivel más alto
        let estadoGlobal = "VERDE";
        let maxNumero = 0;
        for (const s of sectoresFinal) {
            if (s.nivelNumero > maxNumero) {
                maxNumero = s.nivelNumero;
                estadoGlobal = s.nivel;
            }
        }

        return { estadoGlobal, sectoresDetectados: sectoresFinal };

    } catch (e) {
        registrarLog(`Error al consultar Keraunos: ${e.message}`);
        return null;
    }
}

// ------------------------------------------------------------
//  Calcula duración y timestampInicio desde las horas
//  de la tarjeta. Si no hay hora de fin, usa DURACION_DEFAULT_MIN.
// ------------------------------------------------------------
function calcularDuracion(sector) {
    const defMin = CONFIG.DURACION_DEFAULT_MIN || 15;

    if (!sector.inicio) {
        return { duracionMin: defMin, timestampInicio: Date.now() };
    }

    const inicioMs = Date.parse(sector.inicio.replace(" ", "T"));
    if (isNaN(inicioMs)) {
        return { duracionMin: defMin, timestampInicio: Date.now() };
    }

    if (sector.fin) {
        const finMs = Date.parse(sector.fin.replace(" ", "T"));
        if (!isNaN(finMs) && finMs > inicioMs) {
            const min = Math.round((finMs - inicioMs) / 60000);
            return { duracionMin: Math.max(1, min), timestampInicio: inicioMs };
        }
    }

    return { duracionMin: defMin, timestampInicio: inicioMs };
}

// ------------------------------------------------------------
//  Escribe estado.json con `sectores[]` + `alertas[]`
// ------------------------------------------------------------
function guardarJSON(estadoGlobal, sectores) {
    const alertas = [];

    for (const s of sectores) {
        if (s.nivel === "VERDE") continue;

        // FIX v8: coincidencia parcial en lugar de CONFIG.MAPA_ZONAS[s.nombre]
        const zona = buscarZona(s.nombre);
        if (!zona) {
            registrarLog(`Aviso: sector sin zona mapeada, se omite alerta -> ${s.nombre}`);
            continue;
        }

        const coords = CONFIG.COORDENADAS_ZONAS[zona] || {};
        const { duracionMin, timestampInicio } = calcularDuracion(s);

        alertas.push({
            sectorOriginal:  s.nombre,
            nivelScraper:    s.nivel,
            nivel:           s.nivel.toLowerCase(),
            distrito:        zona,
            lat:             coords.lat ?? null,
            lng:             coords.lng ?? null,
            duracionMin,
            timestampInicio,
            inicio:          s.inicio || null,
            fin:             s.fin    || null,
            color:           s.color,
            emoji:           s.emoji,
            titulo:  `⚡ ALERTA ${s.nivel} — ${s.nombre}`,
            mensaje: `Actividad eléctrica detectada en ${s.nombre} (${zona}). ` +
                     `Nivel ${s.nivel}.` +
                     (s.inicio ? ` Inicio: ${s.inicio}.` : "") +
                     (s.fin    ? ` Fin previsto: ${s.fin}.` : "")
        });
    }

    const data = {
        actualizado: new Date().toISOString(),
        estadoGlobal,
        estadoGlobalNumero: NIVELES[estadoGlobal].numero,
        totalSectores: sectores.length,
        resumen: {
            roja:     sectores.filter(s => s.nivel === "ROJA").length,
            naranja:  sectores.filter(s => s.nivel === "NARANJA").length,
            amarilla: sectores.filter(s => s.nivel === "AMARILLA").length,
            verde:    sectores.filter(s => s.nivel === "VERDE").length
        },
        sectores: sectores.map(s => ({
            nombre: s.nombre,
            nivel: s.nivel,
            nivelNumero: s.nivelNumero,
            color: s.color,
            inicio: s.inicio,
            fin: s.fin
        })),
        alertas
    };

    fs.writeFileSync(ARCHIVO_JSON, JSON.stringify(data, null, 2), 'utf-8');
    return data;
}

// ------------------------------------------------------------
//  Procesa un resultado: guarda el JSON y hace push
// ------------------------------------------------------------
function procesarResultado(resultado) {
    if (!resultado) return;

    const json = guardarJSON(resultado.estadoGlobal, resultado.sectoresDetectados);

    registrarLog(
        `estado.json actualizado. Global: ${resultado.estadoGlobal} | ` +
        `R:${json.resumen.roja} N:${json.resumen.naranja} ` +
        `A:${json.resumen.amarilla} V:${json.resumen.verde} | ` +
        `Alertas publicadas: ${json.alertas.length}`
    );

    if (CONFIG.SUBIR_A_GITHUB) {
        subirAGithub();
    }
}

// ------------------------------------------------------------
//  Sube estado.json a GitHub (FIX v7)
//  ------------------------------------------------------------
//  NO usa "git stash" porque guardaría estado.json (untracked) y
//  luego el "git add" fallaría con "pathspec did not match".
//
//  Secuencia:
//    1. git pull --rebase --autostash  (integra cambios remotos)
//    2. git add -f estado.json         (force, por si algo lo ignora)
//    3. git commit -m "..."
//    4. git push origin main
//
//  Si falla, se aborta cualquier rebase a medias y se loguea.
// ------------------------------------------------------------
function subirAGithub() {
    const archivos = [ARCHIVO_JSON].join(" ");

    const cmd =
        `git pull --rebase --autostash --quiet origin main; ` +
        `git add -f ${archivos} && ` +
        `git commit -m "Update estado.json $(date +%H:%M)" && ` +
        `git push origin main`;

    exec(cmd, (error) => {
        if (error) {
            registrarLog(`Error en Git Push: ${error.message}`);
            exec("git rebase --abort 2>/dev/null", () => {});
            return;
        }
        registrarLog("estado.json subido a GitHub Pages exitosamente.");
    });
}

// ------------------------------------------------------------
//  Ciclo principal
// ------------------------------------------------------------
async function cicloPrincipal() {
    registrarLog(`Monitor Keraunos iniciado. Intervalo: ${INTERVALO / 1000}s`);

    procesarResultado(await consultarKeraunos());

    setInterval(async () => {
        procesarResultado(await consultarKeraunos());
    }, INTERVALO);
}

module.exports = {
    consultarKeraunos,
    detectarNivelDeTarjeta,
    extraerHorasDeTarjeta,
    buscarZona,
    guardarJSON,
    calcularDuracion,
    procesarResultado,
    NIVELES
};

if (require.main === module) {
    cicloPrincipal();
}

