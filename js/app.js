/**
 * Uai, Qual Casa? Lista + mapa fixo, opinião só no modal (Curti / Não curti).
 */
(function () {
  "use strict";

  const STORAGE_NOME = "uai_qual_casa_nome";
  const STORAGE_NOME_NORM = "uai_qual_casa_nome_norm";
  const STORAGE_DEVICE = "uai_qual_casa_device";
  const STORAGE_OPINIOES = "uai_qual_casa_opinioes";
  const STORAGE_RODADA = "uai_qual_casa_rodada";
  /** Ponto de referência no mapa (lat, lng, nome) + cache de distâncias por rota */
  const STORAGE_REF_MAP = "uai_qual_casa_ref_map";
  const STORAGE_ROTA_CACHE = "uai_qual_casa_rota_cache_v1";

  const cfg = window.UAI_CONFIG || {};
  const supabaseUrl = cfg.supabaseUrl || "";
  const supabaseAnonKey = cfg.supabaseAnonKey || "";
  const functionsBase =
    cfg.functionsUrl || (supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/functions/v1` : "");

  /** @type {import('@supabase/supabase-js').SupabaseClient | null} */
  let supabase = null;
  if (supabaseUrl && supabaseAnonKey && window.supabase?.createClient) {
    supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  }

  const params = new URLSearchParams(window.location.search);
  /** The organizer's secret lives only in the link: the Edge Function is what checks it. */
  const adminApiKey = params.get("admin") || "";
  const isAdmin = Boolean(adminApiKey);

  const estado = {
    casas: /** @type {Array<any>} */ ([]),
    /** curtidas por casa_id */
    counts: /** @type {Record<string, number>} */ {},
    map: /** @type {import('leaflet').Map | null} */ (null),
    refMapa: /** @type {{ nome: string; lat: number; lng: number } | null} */ (null),
    refMarker: /** @type {import('leaflet').Marker | null} */ (null),
    marcandoPonto: false,
    voltarAposMarcar: false,
    rotasCompletas: /** @type {Record<string, { coords: [number, number][]; km: number; min: number }>} */ ({}),
    rotaPedido: 0,
    modalMapa: /** @type {import('leaflet').Map | null} */ (null),
    modalRotaLayer: /** @type {import('leaflet').Layer | null} */ (null),
    refRouteLayer: /** @type {import('leaflet').Layer | null} */ (null),
    rotasKm: /** @type {Record<string, number>} */ {},
    rotasEmBusca: false,
    /** Elemento .popup-dist de cada marker (popup aberto ou não) */
    popupDistEls: /** @type {Record<string, HTMLElement>} */ {},
    markers: /** @type {Record<string, import('leaflet').Marker>} */ {},
    casaAtivaId: /** @type {string | null} */ (null),
    modalCasaId: /** @type {string | null} */ (null),
    modalGallery: /** @type {{ fotos: string[]; idx: number }} */ ({ fotos: [], idx: 0 }),
    votingClosed: false,
    showResults: false,
    revelacaoFechada: false,
  };

  const els = {
    lista: document.getElementById("lista-casas"),
    ordenacao: document.getElementById("ordenacao"),
    ordemCurtidas: document.getElementById("ordem-curtidas"),
    btnVista: document.getElementById("btn-vista"),
    pontoDica: document.getElementById("ponto-dica"),
    btnPontoMarcar: document.getElementById("btn-ponto-marcar"),
    btnPontoMarcarTexto: document.getElementById("btn-ponto-marcar-texto"),
    btnPontoRemover: document.getElementById("btn-ponto-remover"),
    modalRota: document.getElementById("modal-rota"),
    modalRotaTexto: document.getElementById("modal-rota-texto"),
    modalRotaMapa: document.getElementById("modal-rota-mapa"),
    modal: document.getElementById("modal-detalhe"),
    modalTitulo: document.getElementById("modal-titulo"),
    modalPreco: document.getElementById("modal-preco"),
    modalDesc: document.getElementById("modal-desc"),
    modalLink: document.getElementById("modal-link"),
    galeria: document.getElementById("modal-galeria"),
    modalVoto: document.getElementById("modal-voto"),
    modalVotoMsg: document.getElementById("modal-voto-msg"),
    modalCarimbo: document.getElementById("modal-carimbo"),
    btnCurti: document.getElementById("btn-curti"),
    btnNaoCurti: document.getElementById("btn-nao-curti"),
    supabaseAviso: document.getElementById("supabase-aviso"),
    overlayNome: document.getElementById("overlay-nome"),
    overlayNomeCard: document.querySelector("#overlay-nome .nome-overlay__card"),
    nomeOverlayStepBoas: document.getElementById("nome-overlay-step-boas"),
    nomeOverlayStepNome: document.getElementById("nome-overlay-step-nome"),
    btnBoasContinuar: document.getElementById("btn-boas-continuar"),
    inputNomeOverlay: document.getElementById("input-nome-overlay"),
    btnConfirmarNome: document.getElementById("btn-confirmar-nome"),
    nomeOverlayErro: document.getElementById("nome-overlay-erro"),
    linkVerVotacao: document.getElementById("link-ver-votacao"),
    blocoUsuario: document.getElementById("bloco-usuario"),
    nomeUsuarioDisplay: document.getElementById("nome-usuario-display"),
    btnSairUsuario: document.getElementById("btn-sair-usuario"),
    admin: document.getElementById("admin"),
    adminRanking: document.getElementById("admin-ranking"),
    adminConfigStatus: document.getElementById("admin-config-status"),
    adminFetchErro: document.getElementById("admin-fetch-erro"),
    adminVotosLista: document.getElementById("admin-votos-lista"),
    adminJson: document.getElementById("admin-json"),
    btnVotacao: document.getElementById("btn-votacao"),
    btnResultados: document.getElementById("btn-resultados"),
    btnLimparVotos: document.getElementById("btn-limpar-votos"),
    revelacao: document.getElementById("revelacao"),
    revelacaoConvite: document.getElementById("revelacao-convite"),
    revelacaoResultado: document.getElementById("revelacao-resultado"),
    revelacaoChamada: document.getElementById("revelacao-chamada"),
    revelacaoVencedoras: document.getElementById("revelacao-vencedoras"),
    revelacaoRanking: document.getElementById("revelacao-ranking"),
    btnRevelar: document.getElementById("btn-revelar"),
    btnRevelacaoFechar: document.getElementById("btn-revelacao-fechar"),
    confete: document.getElementById("confete"),
    btnCopiarJson: document.getElementById("btn-copiar-json"),
  };

  function formatPreco(n) {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  }

  function formatPrecoCurto(n) {
    const s = formatPreco(n);
    return s.replace(/\s/g, " ").replace("R$", "R$");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Converte um texto com **negrito** e linhas "- item" em HTML seguro. */
  function descricaoMarkdownLegivel(markdown) {
    const esc = escapeHtml(markdown || "");
    const boldInline = (line) => line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const lines = esc.split(/\r?\n/);
    let html = "";
    let inList = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        continue;
      }
      if (trimmed.startsWith("- ")) {
        if (!inList) {
          html += '<ul class="descricao-lista">';
          inList = true;
        }
        html += `<li>${boldInline(trimmed.slice(2))}</li>`;
      } else {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += `<p class="descricao-bloco">${boldInline(trimmed)}</p>`;
      }
    }
    if (inList) html += "</ul>";
    return html || `<p class="descricao-bloco">${boldInline(esc)}</p>`;
  }

  function lerRefMapaStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_REF_MAP);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o.lat !== "number" || typeof o.lng !== "number") return null;
      const nome =
        typeof o.nome === "string" && o.nome.trim() ? o.nome.trim() : "Ponto de referência";
      return { nome, lat: o.lat, lng: o.lng };
    } catch {
      return null;
    }
  }

  function gravarRefMapaStorage(ref) {
    try {
      if (!ref) localStorage.removeItem(STORAGE_REF_MAP);
      else localStorage.setItem(STORAGE_REF_MAP, JSON.stringify(ref));
    } catch {
      /* ignore */
    }
  }

  function refKeyForCache(ref) {
    if (!ref || typeof ref.lat !== "number" || typeof ref.lng !== "number") return "";
    return `${ref.lat.toFixed(5)}_${ref.lng.toFixed(5)}`;
  }

  function lerRotaCache() {
    try {
      const raw = localStorage.getItem(STORAGE_ROTA_CACHE);
      if (!raw) return { refKey: "", casas: {} };
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object") return { refKey: "", casas: {} };
      return {
        refKey: typeof o.refKey === "string" ? o.refKey : "",
        casas: o.casas && typeof o.casas === "object" ? o.casas : {},
      };
    } catch {
      return { refKey: "", casas: {} };
    }
  }

  function gravarRotaCache(refKey, casasMap) {
    try {
      localStorage.setItem(STORAGE_ROTA_CACHE, JSON.stringify({ refKey: refKey || "", casas: casasMap || {} }));
    } catch {
      /* ignore */
    }
  }

  function aplicarCacheRotasParaRef(ref) {
    const key = refKeyForCache(ref);
    const c = lerRotaCache();
    estado.rotasKm = key && c.refKey === key && c.casas ? { ...c.casas } : {};
  }

  /** Only exists after someone marks it on the map (kept in localStorage). */
  function getPontoReferencia() {
    return estado.refMapa;
  }

  function formatDistanciaKm(km) {
    if (!Number.isFinite(km) || km < 0) return "";
    if (km < 1) return `${Math.round(km * 1000)} m`;
    const decimals = km < 10 ? 1 : 0;
    return `${km.toFixed(decimals).replace(".", ",")} km`;
  }

  /** Distância por rota de carro (OSRM demo); undefined = a calcular ou falhou. */
  function kmRotaParaCasa(casaId) {
    const v = estado.rotasKm[String(casaId)];
    return Number.isFinite(v) ? v : undefined;
  }

  function distanciaDaReferencia(casa) {
    const ref = getPontoReferencia();
    if (!ref) return null;
    const la = Number(casa.lat);
    const lo = Number(casa.lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
    const km = kmRotaParaCasa(casa.id);
    return {
      refNome: ref.nome,
      km,
      calculando: estado.rotasEmBusca && !Number.isFinite(km),
    };
  }

  function textoDistanciaUi(dref) {
    if (!getPontoReferencia() || !dref) return "";
    if (dref.calculando) return "Calculando a distância…";
    if (Number.isFinite(dref.km)) return `${formatDistanciaKm(dref.km)} de carro até o ponto`;
    return "";
  }

  function sincronizarTextosDistancia() {
    document.querySelectorAll("[data-casa-dist]").forEach((el) => {
      const id = el.getAttribute("data-casa-dist");
      const c = id ? casaPorId(id) : null;
      const dref = c ? distanciaDaReferencia(c) : null;
      el.textContent = textoDistanciaUi(dref);
      el.hidden = !el.textContent;
    });
    for (const id of Object.keys(estado.popupDistEls)) {
      const el = estado.popupDistEls[id];
      if (!el || !el.isConnected) {
        delete estado.popupDistEls[id];
        continue;
      }
      const c = casaPorId(id);
      const dref = getPontoReferencia() && c ? distanciaDaReferencia(c) : null;
      el.textContent = textoDistanciaUi(dref);
      el.hidden = !el.textContent;
    }
  }

  async function buscarDistanciaRotaKm(lat1, lng1, lat2, lng2) {
    const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`osrm ${res.status}`);
    const data = await res.json();
    const m = data?.routes?.[0]?.distance;
    if (typeof m !== "number") throw new Error("osrm sem distância");
    return m / 1000;
  }

  function formatTempo(min) {
    const total = Math.max(1, Math.round(min));
    if (total < 60) return `${total} min`;
    const horas = Math.floor(total / 60);
    const resto = total % 60;
    return resto ? `${horas} h ${resto} min` : `${horas} h`;
  }

  async function buscarRotaCompleta(ref, casa) {
    const chave = `${refKeyForCache(ref)}|${casa.id}`;
    if (estado.rotasCompletas[chave]) return estado.rotasCompletas[chave];
    const url = `https://router.project-osrm.org/route/v1/driving/${ref.lng},${ref.lat};${Number(casa.lng)},${Number(casa.lat)}?overview=full&geometries=geojson`;
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`osrm ${res.status}`);
    const data = await res.json();
    const rota = data?.routes?.[0];
    if (!rota?.geometry?.coordinates?.length) throw new Error("osrm sem rota");
    const pronta = {
      coords: rota.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      km: rota.distance / 1000,
      min: rota.duration / 60,
    };
    estado.rotasCompletas[chave] = pronta;
    return pronta;
  }

  function linhaDaRota(coords) {
    return [
      L.polyline(coords, { color: "#0a2342", weight: 9, lineCap: "round", lineJoin: "round", interactive: false }),
      L.polyline(coords, { color: "#ffa91f", weight: 5, lineCap: "round", lineJoin: "round", interactive: false }),
    ];
  }

  function limparRotaMapa() {
    if (estado.refRouteLayer && estado.map) estado.map.removeLayer(estado.refRouteLayer);
    estado.refRouteLayer = null;
  }

  function desenharRotaMapa(rota) {
    const map = estado.map;
    if (!map) return;
    limparRotaMapa();
    const meio = rota.coords[Math.floor(rota.coords.length / 2)];
    const etiqueta = L.tooltip({
      permanent: true,
      direction: "center",
      className: "rota-etiqueta",
      interactive: false,
    })
      .setLatLng(meio)
      .setContent(`${formatDistanciaKm(rota.km)}, ${formatTempo(rota.min)}`);
    estado.refRouteLayer = L.layerGroup([...linhaDaRota(rota.coords), etiqueta]).addTo(map);
    map.fitBounds(L.latLngBounds(rota.coords), { paddingTopLeft: [40, 300], paddingBottomRight: [40, 130] });
  }

  function desenharRotaModal(rota) {
    if (!els.modalRotaMapa || typeof L === "undefined") return;
    if (!estado.modalMapa) {
      estado.modalMapa = L.map(els.modalRotaMapa, {
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(estado.modalMapa);
    }
    const map = estado.modalMapa;
    map.invalidateSize();
    if (estado.modalRotaLayer) map.removeLayer(estado.modalRotaLayer);
    const inicio = rota.coords[0];
    const fim = rota.coords[rota.coords.length - 1];
    estado.modalRotaLayer = L.layerGroup([
      ...linhaDaRota(rota.coords),
      L.marker(inicio, { icon: iconePonto(false), interactive: false, keyboard: false }),
      L.circleMarker(fim, { radius: 8, color: "#0a2342", weight: 3, fillColor: "#fffdf6", fillOpacity: 1, interactive: false }),
    ]).addTo(map);
    map.fitBounds(L.latLngBounds(rota.coords), { padding: [34, 34], maxZoom: 16 });
  }

  /** Draws the car route for a house on the main map and, when open, in the house detail. */
  async function mostrarRotaDaCasa(casa) {
    const pedido = ++estado.rotaPedido;
    const ref = getPontoReferencia();
    const detalheAberto = () => estado.modalCasaId === String(casa.id);
    if (!ref) {
      limparRotaMapa();
      if (els.modalRota) els.modalRota.hidden = true;
      return;
    }
    if (detalheAberto() && els.modalRota && els.modalRotaTexto) {
      els.modalRota.hidden = false;
      els.modalRotaMapa.hidden = true;
      els.modalRotaTexto.textContent = "Calculando a rota…";
    }
    try {
      const rota = await buscarRotaCompleta(ref, casa);
      if (pedido !== estado.rotaPedido) return;
      desenharRotaMapa(rota);
      if (detalheAberto()) {
        els.modalRotaTexto.textContent = `${formatDistanciaKm(rota.km)} de carro, cerca de ${formatTempo(rota.min)} até o ponto da família`;
        els.modalRotaMapa.hidden = false;
        desenharRotaModal(rota);
      }
    } catch (e) {
      console.warn("rota:", e instanceof Error ? e.message : e);
      if (pedido !== estado.rotaPedido) return;
      limparRotaMapa();
      if (detalheAberto()) {
        els.modalRotaMapa.hidden = true;
        els.modalRotaTexto.textContent = "Não foi possível traçar a rota agora. Tente de novo mais tarde.";
      }
    }
  }

  async function atualizarRotasParaTodasCasas() {
    const ref = getPontoReferencia();
    if (!ref || !estado.casas.length) {
      estado.rotasKm = {};
      gravarRotaCache("", {});
      sincronizarTextosDistancia();
      renderLista();
      return;
    }
    const refKey = refKeyForCache(ref);
    const existentes = estado.rotasKm;
    const pendentes = [];
    for (const casa of estado.casas) {
      const id = String(casa.id);
      const la = Number(casa.lat);
      const lo = Number(casa.lng);
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      if (!Number.isFinite(existentes[id])) pendentes.push(casa);
    }
    if (pendentes.length === 0) {
      sincronizarTextosDistancia();
      renderLista();
      return;
    }
    estado.rotasEmBusca = true;
    sincronizarTextosDistancia();
    renderLista();
    const novo = { ...existentes };
    const batch = 4;
    for (let i = 0; i < pendentes.length; i += batch) {
      const slice = pendentes.slice(i, i + batch);
      await Promise.all(
        slice.map(async (casa) => {
          const id = String(casa.id);
          const la = Number(casa.lat);
          const lo = Number(casa.lng);
          try {
            const km = await buscarDistanciaRotaKm(ref.lat, ref.lng, la, lo);
            novo[id] = km;
          } catch (e) {
            console.warn("rota:", id, e instanceof Error ? e.message : e);
            delete novo[id];
          }
        }),
      );
      estado.rotasKm = { ...novo };
      gravarRotaCache(refKey, estado.rotasKm);
      sincronizarTextosDistancia();
      renderLista();
    }
    estado.rotasEmBusca = false;
    sincronizarTextosDistancia();
    renderLista();
    if (estado.modalCasaId) {
      const c = casaPorId(estado.modalCasaId);
      if (c) mostrarRotaDaCasa(c);
    }
  }

  function iconePonto(caindo) {
    return L.divIcon({
      className: `uai-ref-marker${caindo ? " uai-ref-marker--caindo" : ""}`,
      html: '<svg class="pin" aria-hidden="true"><use href="#icone-pin" /></svg>',
      iconSize: [40, 52],
      iconAnchor: [20, 50],
      popupAnchor: [0, -46],
    });
  }

  function atualizarMarcadorReferencia(caindo) {
    const map = estado.map;
    const ref = estado.refMapa;
    if (!map) return;
    if (estado.refMarker) {
      map.removeLayer(estado.refMarker);
      estado.refMarker = null;
    }
    limparRotaMapa();
    if (!ref) return;
    const m = L.marker([ref.lat, ref.lng], {
      icon: iconePonto(caindo),
      draggable: true,
      zIndexOffset: 500,
      title: "Ponto da família",
      alt: "Ponto da família",
    }).addTo(map);
    m.bindPopup('<strong>Ponto da família</strong><br/><span class="uai-ref-marker__hint">Arraste o pin para ajustar o lugar.</span>');
    m.on("dragend", () => {
      const ll = m.getLatLng();
      const nome = estado.refMapa?.nome || "Ponto da família";
      estado.refMapa = { nome, lat: ll.lat, lng: ll.lng };
      gravarRefMapaStorage(estado.refMapa);
      atualizarRotasParaTodasCasas();
    });
    estado.refMarker = m;
  }

  function atualizarControlePonto() {
    const temPonto = Boolean(estado.refMapa);
    const marcando = estado.marcandoPonto;
    document.body.classList.toggle("marcando-ponto", marcando);
    if (els.pontoDica) els.pontoDica.hidden = !marcando;
    if (els.btnPontoMarcarTexto) {
      els.btnPontoMarcarTexto.textContent = marcando ? "Cancelar" : temPonto ? "Mudar o ponto" : "Marcar ponto da família";
    }
    if (els.btnPontoRemover) els.btnPontoRemover.hidden = !temPonto || marcando;
  }

  function setMarcandoPonto(ativo) {
    estado.marcandoPonto = ativo;
    if (ativo && estado.map) estado.map.closePopup();
    atualizarControlePonto();
    if (ativo) return;
    if (!estado.refMapa) voltarParaOrdemPadrao();
    if (estado.voltarAposMarcar) {
      estado.voltarAposMarcar = false;
      setVistaMapa(false);
    }
  }

  function voltarParaOrdemPadrao() {
    const perto = els.ordenacao?.querySelector('input[value="perto"]');
    const padrao = els.ordenacao?.querySelector('input[value="ordem"]');
    if (perto?.checked && padrao) {
      padrao.checked = true;
      renderLista();
    }
  }

  function removerPontoFamilia() {
    estado.refMapa = null;
    gravarRefMapaStorage(null);
    estado.rotasKm = {};
    gravarRotaCache("", {});
    atualizarMarcadorReferencia();
    sincronizarTextosDistancia();
    voltarParaOrdemPadrao();
    renderLista();
    atualizarControlePonto();
  }

  function setupMapaReferencia() {
    const map = estado.map;
    if (!map) return;
    map.on("click", (ev) => {
      if (!estado.marcandoPonto) return;
      const ref = { nome: "Ponto da família", lat: ev.latlng.lat, lng: ev.latlng.lng };
      estado.rotaPedido += 1;
      estado.refMapa = ref;
      gravarRefMapaStorage(ref);
      aplicarCacheRotasParaRef(ref);
      atualizarMarcadorReferencia(true);
      setMarcandoPonto(false);
      atualizarRotasParaTodasCasas();
    });
    if (els.btnPontoMarcar) {
      els.btnPontoMarcar.addEventListener("click", () => setMarcandoPonto(!estado.marcandoPonto));
    }
    if (els.btnPontoRemover) els.btnPontoRemover.addEventListener("click", removerPontoFamilia);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && estado.marcandoPonto) setMarcandoPonto(false);
    });
    atualizarControlePonto();
  }

  function normalizaNome(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem(STORAGE_DEVICE);
      if (!id) {
        id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `d_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
        localStorage.setItem(STORAGE_DEVICE, id);
      }
      return id;
    } catch {
      return `sess_${Date.now()}`;
    }
  }

  function getNomeSalvo() {
    try {
      return localStorage.getItem(STORAGE_NOME) || "";
    } catch {
      return "";
    }
  }

  function getNomeNormSalvo() {
    try {
      return localStorage.getItem(STORAGE_NOME_NORM) || "";
    } catch {
      return "";
    }
  }

  function salvarNome(displayRaw) {
    const display = String(displayRaw || "").trim();
    const norm = normalizaNome(display);
    try {
      if (display) {
        localStorage.setItem(STORAGE_NOME, display);
        localStorage.setItem(STORAGE_NOME_NORM, norm);
      } else {
        localStorage.removeItem(STORAGE_NOME);
        localStorage.removeItem(STORAGE_NOME_NORM);
      }
    } catch {
      /* ignore */
    }
    atualizarHeaderUsuario();
  }

  function limparUsuario() {
    try {
      localStorage.removeItem(STORAGE_NOME);
      localStorage.removeItem(STORAGE_NOME_NORM);
    } catch {
      /* ignore */
    }
    atualizarHeaderUsuario();
    mostrarOverlayNome();
  }

  function atualizarHeaderUsuario() {
    const nome = getNomeSalvo();
    if (els.blocoUsuario) {
      els.blocoUsuario.hidden = !nome || isAdmin;
    }
    if (els.nomeUsuarioDisplay) {
      els.nomeUsuarioDisplay.textContent = nome;
    }
  }

  function nomeProntoParaVotar() {
    return Boolean(getNomeNormSalvo());
  }

  function irOverlayPassoNome() {
    if (els.nomeOverlayStepBoas) {
      els.nomeOverlayStepBoas.hidden = true;
      els.nomeOverlayStepBoas.classList.remove("nome-overlay__step--ativo");
    }
    if (els.nomeOverlayStepNome) {
      els.nomeOverlayStepNome.hidden = false;
      els.nomeOverlayStepNome.classList.add("nome-overlay__step--ativo");
    }
    if (els.overlayNomeCard) {
      els.overlayNomeCard.setAttribute("aria-labelledby", "nome-overlay-titulo-nome");
    }
    if (els.inputNomeOverlay) {
      els.inputNomeOverlay.value = getNomeSalvo();
      requestAnimationFrame(() => els.inputNomeOverlay && els.inputNomeOverlay.focus());
    }
  }

  function irOverlayPassoBoasVindas() {
    if (els.nomeOverlayStepNome) {
      els.nomeOverlayStepNome.hidden = true;
      els.nomeOverlayStepNome.classList.remove("nome-overlay__step--ativo");
    }
    if (els.nomeOverlayStepBoas) {
      els.nomeOverlayStepBoas.hidden = false;
      els.nomeOverlayStepBoas.classList.add("nome-overlay__step--ativo");
    }
    if (els.overlayNomeCard) {
      els.overlayNomeCard.setAttribute("aria-labelledby", "nome-overlay-titulo-boas");
    }
  }

  function mostrarOverlayNome() {
    if (isAdmin || !els.overlayNome) return;
    els.overlayNome.hidden = false;
    irOverlayPassoBoasVindas();
    if (els.nomeOverlayErro) els.nomeOverlayErro.textContent = "";
  }

  function fecharOverlayNome() {
    if (els.overlayNome) els.overlayNome.hidden = true;
  }

  function garantirNomeParaAcao() {
    if (isAdmin) return true;
    if (!nomeProntoParaVotar()) {
      mostrarOverlayNome();
      if (els.nomeOverlayErro) els.nomeOverlayErro.textContent = "Coloca seu nome pra continuar.";
      return false;
    }
    return true;
  }

  /** Opinions sent from this device, by house. The server hides them until results are released. */
  function getOpinioesLocais() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_OPINIOES) || "{}") || {};
    } catch {
      return {};
    }
  }

  function salvarOpiniaoLocal(casaId, gostei) {
    try {
      const opinioes = getOpinioesLocais();
      opinioes[String(casaId)] = gostei;
      localStorage.setItem(STORAGE_OPINIOES, JSON.stringify(opinioes));
    } catch {
      /* ignore */
    }
  }

  /** When the organizer clears the votes, each device forgets its stamps on the next read. */
  function sincronizarRodada(rodada) {
    try {
      if (localStorage.getItem(STORAGE_RODADA) === rodada) return;
      localStorage.setItem(STORAGE_RODADA, rodada);
      localStorage.removeItem(STORAGE_OPINIOES);
    } catch {
      /* ignore */
    }
    if (estado.modalCasaId) {
      atualizarOpiniaoModal(false);
      msgModal("");
    }
  }

  function opiniaoDaCasa(casaId) {
    const gostei = getOpinioesLocais()[String(casaId)];
    return typeof gostei === "boolean" ? { gostei } : null;
  }

  function carimboHtml(gostei, batendo) {
    const tipo = gostei ? "curti" : "nao-curti";
    const classes = `carimbo carimbo--${tipo}${batendo ? " carimbo--batendo" : ""}`;
    return `<svg class="${classes}" viewBox="0 0 200 200" aria-hidden="true"><use href="#carimbo-${tipo}" /></svg>`;
  }

  /** Uses the "quartos" field; older entries fall back to what the title or description says. */
  function quartosDaCasa(casa) {
    if (casa.quartos != null && Number.isFinite(Number(casa.quartos))) return Number(casa.quartos);
    const achado = `${casa.titulo || ""} ${casa.descricao || ""}`.match(/(\d+)\s*quartos?/i);
    return achado ? Number(achado[1]) : null;
  }

  function urlEhVideo(url) {
    return /\.(mp4|webm|mov|ogg)(\?|#|$)/i.test(String(url || ""));
  }

  /** Primeira URL da lista (foto ou vídeo), para galeria e ordem das mídias. */
  function casaPrincipalFoto(casa) {
    const arr = Array.isArray(casa.fotos) ? casa.fotos : [];
    return arr.find(Boolean) || "";
  }

  /** Primeira imagem para miniatura na lista e no mapa; vazio se só há vídeo. */
  function casaThumbImagem(casa) {
    const arr = Array.isArray(casa.fotos) ? casa.fotos : [];
    const u = arr.find((x) => x && !urlEhVideo(x));
    return u || "";
  }

  function casaPorId(id) {
    const sid = String(id);
    return estado.casas.find((c) => String(c.id) === sid) || null;
  }

  async function carregarCasas() {
    const res = await fetch("casas.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Não achei casas.json");
    const data = await res.json();
    estado.casas = Array.isArray(data) ? data : [];
    if (els.adminJson) {
      els.adminJson.value = JSON.stringify(estado.casas, null, 2);
    }
  }

  async function fetchConfigSupabase() {
    if (!supabase) return;
    const { data, error } = await supabase.from("config").select("key, value");
    if (error) {
      console.warn("config:", error.message);
      return;
    }
    for (const row of data || []) {
      if (row.key === "voting_closed") estado.votingClosed = row.value === "true";
      if (row.key === "show_results") estado.showResults = row.value === "true";
      if (row.key === "votes_reset_at") sincronizarRodada(row.value);
    }
  }

  async function fetchTotals() {
    if (!supabase) return;
    await fetchConfigSupabase();

    if (!estado.showResults && !isAdmin) {
      estado.counts = {};
      return;
    }

    if (estado.showResults) {
      const { data, error } = await supabase.from("votos").select("casa_id, gostei").eq("gostei", true);
      if (error) {
        console.warn("totais:", error.message);
        return;
      }
      const m = /** @type {Record<string, number>} */ ({});
      for (const row of data || []) {
        const id = String(row.casa_id);
        m[id] = (m[id] || 0) + 1;
      }
      estado.counts = m;
      return;
    }

    if (isAdmin) {
      try {
        const data = await adminFetch({ action: "vote-totals" });
        const rows = data?.totals || [];
        const m = /** @type {Record<string, number>} */ ({});
        for (const row of rows) {
          m[String(row.casa_id)] = Number(row.total) || 0;
        }
        estado.counts = m;
      } catch (e) {
        console.warn("totais admin:", e instanceof Error ? e.message : e);
        estado.counts = {};
      }
    }
  }

  function casasOrdenadas() {
    const list = [...estado.casas];
    const marcada = els.ordenacao ? els.ordenacao.querySelector("input:checked") : null;
    const sort = marcada ? marcada.value : "ordem";
    const byOrdem = (a, b) => {
      const oa = a.ordem != null ? Number(a.ordem) : 999;
      const ob = b.ordem != null ? Number(b.ordem) : 999;
      if (oa !== ob) return oa - ob;
      return String(a.id).localeCompare(String(b.id));
    };
    if (sort === "preco") {
      list.sort((a, b) => Number(a.preco) - Number(b.preco));
    } else if (sort === "perto") {
      list.sort((a, b) => {
        const ka = kmRotaParaCasa(a.id);
        const kb = kmRotaParaCasa(b.id);
        if (ka === undefined && kb === undefined) return byOrdem(a, b);
        if (ka === undefined) return 1;
        if (kb === undefined) return -1;
        return ka - kb;
      });
    } else if (sort === "votos") {
      const can = estado.showResults || isAdmin;
      if (!can) {
        list.sort(byOrdem);
      } else {
        list.sort((a, b) => {
          const va = estado.counts[String(a.id)] || 0;
          const vb = estado.counts[String(b.id)] || 0;
          if (vb !== va) return vb - va;
          return byOrdem(a, b);
        });
      }
    } else {
      list.sort(byOrdem);
    }
    return list;
  }

  function atualizarChipCurtidas() {
    if (!els.ordemCurtidas) return;
    const visivel = estado.showResults || isAdmin;
    els.ordemCurtidas.hidden = !visivel;
    const input = els.ordemCurtidas.querySelector("input");
    if (!visivel && input && input.checked) {
      const primeira = els.ordenacao.querySelector('input[value="ordem"]');
      if (primeira) primeira.checked = true;
    }
  }

  function renderLista() {
    if (!els.lista) return;
    atualizarChipCurtidas();
    els.lista.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const casa of casasOrdenadas()) {
      const li = document.createElement("li");
      li.className = "air-card-wrap";
      const card = document.createElement("article");
      card.className = "air-card";
      card.dataset.id = String(casa.id);
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      const opiniao = isAdmin ? null : opiniaoDaCasa(casa.id);
      const opiniaoTxt = opiniao ? (opiniao.gostei ? ", você curtiu" : ", você não curtiu") : "";
      card.setAttribute("aria-label", `Abrir ${casa.titulo || "casa"}${opiniaoTxt}`);

      const wrapImg = document.createElement("div");
      wrapImg.className = "air-card__img-wrap";
      const thumb = casaThumbImagem(casa);
      if (thumb) {
        const img = document.createElement("img");
        img.className = "air-card__img";
        img.alt = "";
        img.loading = "lazy";
        img.src = thumb;
        wrapImg.appendChild(img);
      } else if (casaPrincipalFoto(casa)) {
        const ph = document.createElement("div");
        ph.className = "air-card__img air-card__img--video-placeholder";
        ph.setAttribute("role", "img");
        ph.setAttribute("aria-label", "Vídeo");
        ph.textContent = "▶ Vídeo";
        wrapImg.appendChild(ph);
      } else {
        const img = document.createElement("img");
        img.className = "air-card__img";
        img.alt = "";
        wrapImg.appendChild(img);
      }

      const selo = document.createElement("div");
      selo.className = "selo air-card__selo";
      selo.innerHTML = '<div class="selo__papel"><div class="selo__miolo"><strong></strong><span>total</span></div></div>';
      selo.querySelector("strong").textContent = formatPreco(Number(casa.preco) || 0);
      card.appendChild(selo);
      if (opiniao) {
        const marca = document.createElement("div");
        marca.className = "air-card__carimbo";
        marca.innerHTML = carimboHtml(opiniao.gostei, false);
        wrapImg.appendChild(marca);
      }

      const body = document.createElement("div");
      body.className = "air-card__body";
      const h3 = document.createElement("h3");
      h3.className = "air-card__titulo";
      h3.textContent = casa.local || casa.titulo || "Sem título";
      body.appendChild(h3);
      const quartos = quartosDaCasa(casa);
      if (quartos !== null) {
        const info = document.createElement("p");
        info.className = "air-card__info";
        info.textContent = quartos === 1 ? "1 quarto" : `${quartos} quartos`;
        body.appendChild(info);
      }
      const distP = document.createElement("p");
      distP.className = "air-card__dist";
      distP.setAttribute("data-casa-dist", String(casa.id));
      distP.textContent = textoDistanciaUi(distanciaDaReferencia(casa));
      distP.hidden = !distP.textContent;
      body.appendChild(distP);
      const podeVerCurtidas = estado.showResults || isAdmin;
      if (podeVerCurtidas) {
        const n = estado.counts[String(casa.id)] || 0;
        const badge = document.createElement("span");
        badge.className = "air-card__badge";
        badge.textContent = n === 1 ? "★ 1 curtida" : `★ ${n} curtidas`;
        body.appendChild(badge);
      }

      card.appendChild(wrapImg);
      card.appendChild(body);

      const open = () => abrirDetalhe(casa);
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
      card.addEventListener("mouseenter", () => destacarCasa(casa.id, true));
      card.addEventListener("mouseleave", () => destacarCasa(casa.id, false));

      li.appendChild(card);
      frag.appendChild(li);
    }
    els.lista.appendChild(frag);
    atualizarAtivoCards();
  }

  function atualizarAtivoCards() {
    document.querySelectorAll(".air-card").forEach((card) => {
      card.classList.toggle("air-card--ativo", card.dataset.id === estado.casaAtivaId);
    });
  }

  function destacarCasa(id, ativo) {
    if (!ativo) {
      if (estado.casaAtivaId === String(id)) {
        estado.casaAtivaId = null;
        atualizarMarcadoresAtivo();
        atualizarAtivoCards();
      }
      return;
    }
    estado.casaAtivaId = String(id);
    atualizarMarcadoresAtivo();
    atualizarAtivoCards();
  }

  function atualizarMarcadoresAtivo() {
    const mid = estado.casaAtivaId;
    for (const key of Object.keys(estado.markers)) {
      const el = estado.markers[key].getElement();
      if (el) el.classList.toggle("uai-marker-price--ativo", key === mid);
    }
  }

  function montarMapa() {
    const el = document.getElementById("map");
    if (!el || typeof L === "undefined") return;

    const casas = estado.casas;
    if (!casas.length) {
      el.innerHTML = '<p style="padding:1rem">Cadê as casas no casas.json?</p>';
      return;
    }

    estado.popupDistEls = {};

    const lats = casas.map((c) => Number(c.lat));
    const lngs = casas.map((c) => Number(c.lng));
    const center = [
      lats.reduce((a, b) => a + b, 0) / lats.length,
      lngs.reduce((a, b) => a + b, 0) / lngs.length,
    ];

    estado.map = L.map(el, { scrollWheelZoom: true }).setView(center, 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(estado.map);

    const tpl = document.getElementById("popup-template");
    const tplNode = tpl ? tpl.querySelector(".popup-casa") : null;

    estado.markers = {};

    const medidasMarcadorCache = new Map();
    function medirMarcadorPrecoHtml(html) {
      const hit = medidasMarcadorCache.get(html);
      if (hit) return hit;
      const wrap = document.createElement("div");
      wrap.className = "leaflet-marker-icon uai-marker-price";
      wrap.setAttribute("style", "position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;");
      wrap.innerHTML = html;
      document.body.appendChild(wrap);
      const w = wrap.offsetWidth || 56;
      const h = wrap.offsetHeight || 24;
      document.body.removeChild(wrap);
      const out = { w, h };
      medidasMarcadorCache.set(html, out);
      return out;
    }

    for (const casa of casas) {
      const precoTxt = formatPrecoCurto(Number(casa.preco) || 0);
      const innerHtml = `<div class="uai-marker-price__inner"><div class="uai-marker-price__pill">${precoTxt}</div></div>`;
      const { w, h } = medirMarcadorPrecoHtml(innerHtml);
      const icon = L.divIcon({
        className: "uai-marker-price",
        html: innerHtml,
        iconSize: [w, h],
        iconAnchor: [Math.round(w / 2), h],
      });

      const m = L.marker([Number(casa.lat), Number(casa.lng)], { icon }).addTo(estado.map);
      estado.markers[String(casa.id)] = m;

      const node = tplNode ? /** @type {HTMLElement} */ (tplNode.cloneNode(true)) : null;
      if (node) {
        const imgEl = node.querySelector(".popup-img");
        const titulo = node.querySelector(".popup-titulo");
        const preco = node.querySelector(".popup-preco");
        const btnVer = node.querySelector(".js-ver-mais");
        if (imgEl) {
          const t = casaThumbImagem(casa);
          if (t) {
            imgEl.src = t;
            imgEl.alt = casa.titulo || "";
            imgEl.style.display = "";
          } else if (casaPrincipalFoto(casa)) {
            imgEl.removeAttribute("src");
            imgEl.alt = "";
            imgEl.style.display = "none";
          } else {
            imgEl.src = "";
            imgEl.alt = "";
            imgEl.style.display = "";
          }
        }
        if (titulo) titulo.textContent = casa.titulo || "";
        if (preco) preco.textContent = formatPreco(Number(casa.preco) || 0);
        const distPopup = node.querySelector(".popup-dist");
        if (distPopup) {
          estado.popupDistEls[String(casa.id)] = distPopup;
          distPopup.textContent = textoDistanciaUi(distanciaDaReferencia(casa));
          distPopup.hidden = false;
        }
        if (btnVer) {
          btnVer.addEventListener("click", (ev) => {
            ev.stopPropagation();
            abrirDetalhe(casa);
            m.closePopup();
          });
        }
        m.bindPopup(node, { minWidth: 240, maxWidth: 280 });
        m.on("popupopen", () => {
          const el = m.getPopup()?.getElement?.();
          const pe = el?.querySelector(".popup-dist");
          if (pe) {
            estado.popupDistEls[String(casa.id)] = pe;
            sincronizarTextosDistancia();
          }
        });
      }

      m.on("click", () => {
        destacarCasa(casa.id, true);
        if (!estado.marcandoPonto) mostrarRotaDaCasa(casa);
      });
    }

    const bounds = L.latLngBounds(casas.map((c) => [Number(c.lat), Number(c.lng)]));
    estado.map.fitBounds(bounds.pad(0.12), { maxZoom: 14 });

    aplicarCacheRotasParaRef(estado.refMapa);
    atualizarMarcadorReferencia();
    setupMapaReferencia();
    sincronizarTextosDistancia();
    atualizarRotasParaTodasCasas();

    setTimeout(() => estado.map && estado.map.invalidateSize(), 300);
  }

  function abrirDetalhe(casa) {
    if (!els.modal) return;
    document.body.classList.add("modal-aberto");
    estado.modalCasaId = String(casa.id);
    destacarCasa(casa.id, true);

    els.modal.hidden = false;
    document.body.style.overflow = "hidden";
    const corpo = els.modal.querySelector(".modal-corpo");
    if (corpo) corpo.scrollTop = 0;

    if (els.modalTitulo) els.modalTitulo.textContent = casa.titulo || "";
    if (els.modalPreco) els.modalPreco.textContent = formatPreco(Number(casa.preco) || 0);
    if (els.modalDesc) {
      els.modalDesc.innerHTML = descricaoMarkdownLegivel(casa.descricao || "");
    }
    mostrarRotaDaCasa(casa);
    if (els.modalLink) {
      if (casa.link) {
        els.modalLink.innerHTML = `<a href="${escapeHtml(casa.link)}" target="_blank" rel="noopener">Ver anúncio original</a>`;
      } else {
        els.modalLink.innerHTML = "";
      }
    }

    if (els.modalVoto) {
      els.modalVoto.hidden = isAdmin;
    }
    if (els.modalVotoMsg) els.modalVotoMsg.textContent = "";
    atualizarBotoesOpiniao();
    atualizarOpiniaoModal(false);
    if (estado.votingClosed && !isAdmin) msgModal("Votação encerrada.");

    if (els.galeria) {
      els.galeria.innerHTML = "";
      const fotos = Array.isArray(casa.fotos) ? casa.fotos.filter(Boolean) : [];
      estado.modalGallery = { fotos, idx: 0 };

      if (fotos.length === 0) {
        const stage = document.createElement("div");
        stage.className = "galeria-stage";
        const p = document.createElement("p");
        p.className = "galeria-vazia";
        p.textContent = "Sem fotos cadastradas.";
        stage.appendChild(p);
        els.galeria.appendChild(stage);
      } else {
        const stage = document.createElement("div");
        stage.className = "galeria-stage";
        const slot = document.createElement("div");
        slot.className = "galeria-principal-slot";
        stage.appendChild(slot);

        if (fotos.length > 1) {
          const nav = document.createElement("div");
          nav.className = "galeria-nav";
          const prev = document.createElement("button");
          prev.type = "button";
          prev.className = "btn-icon js-galeria-prev";
          prev.setAttribute("aria-label", "Anterior");
          prev.textContent = "‹";
          const next = document.createElement("button");
          next.type = "button";
          next.className = "btn-icon js-galeria-next";
          next.setAttribute("aria-label", "Próxima");
          next.textContent = "›";
          prev.addEventListener("click", (ev) => {
            ev.stopPropagation();
            if (estado.modalGallery.idx > 0) {
              estado.modalGallery.idx -= 1;
              atualizarGaleriaModal();
            }
          });
          next.addEventListener("click", (ev) => {
            ev.stopPropagation();
            if (estado.modalGallery.idx < estado.modalGallery.fotos.length - 1) {
              estado.modalGallery.idx += 1;
              atualizarGaleriaModal();
            }
          });
          nav.appendChild(prev);
          nav.appendChild(next);
          stage.appendChild(nav);
          const counter = document.createElement("span");
          counter.className = "galeria-counter";
          stage.appendChild(counter);
        }

        els.galeria.appendChild(stage);

        if (fotos.length > 1) {
          const row = document.createElement("div");
          row.className = "galeria-miniaturas";
          fotos.forEach((url, i) => {
            const b = document.createElement("button");
            b.type = "button";
            b.setAttribute("aria-label", urlEhVideo(url) ? `Vídeo ${i + 1}` : `Foto ${i + 1}`);
            if (urlEhVideo(url)) {
              const ph = document.createElement("span");
              ph.className = "galeria-mini-ph galeria-mini-ph--video";
              ph.textContent = "▶";
              ph.title = "Vídeo";
              b.appendChild(ph);
            } else {
              const im = document.createElement("img");
              im.src = url;
              im.alt = "";
              b.appendChild(im);
            }
            b.addEventListener("click", (ev) => {
              ev.stopPropagation();
              estado.modalGallery.idx = i;
              atualizarGaleriaModal();
            });
            row.appendChild(b);
          });
          els.galeria.appendChild(row);
        }
        atualizarGaleriaModal();
      }
    }

    requestAnimationFrame(() => {
      const fecharBtn = els.modal.querySelector(".modal-fechar");
      if (fecharBtn) fecharBtn.focus();
      if (estado.map) estado.map.invalidateSize();
    });
  }

  function atualizarGaleriaModal() {
    const g = els.galeria;
    if (!g) return;
    const slot = g.querySelector(".galeria-principal-slot");
    const counter = g.querySelector(".galeria-counter");
    const btnPrev = g.querySelector(".js-galeria-prev");
    const btnNext = g.querySelector(".js-galeria-next");
    const { fotos, idx } = estado.modalGallery;
    const n = fotos.length;
    const url = n > 0 ? fotos[idx] : "";
    const casaAtual = estado.modalCasaId ? casaPorId(estado.modalCasaId) : null;

    g.querySelectorAll(".galeria-stage video").forEach((v) => {
      v.pause();
    });

    if (slot && url) {
      slot.innerHTML = "";
      if (urlEhVideo(url)) {
        const v = document.createElement("video");
        v.className = "galeria-principal galeria-principal--video";
        v.setAttribute("controls", "");
        v.setAttribute("playsinline", "");
        v.setAttribute("preload", "metadata");
        v.src = url;
        slot.appendChild(v);
      } else {
        const img = document.createElement("img");
        img.className = "galeria-principal";
        img.decoding = "async";
        img.alt = casaAtual?.titulo ? `Foto: ${casaAtual.titulo}` : "Foto";
        img.src = url;
        slot.appendChild(img);
      }
    }

    if (counter) counter.textContent = n ? `${idx + 1} / ${n}` : "";
    if (btnPrev) btnPrev.disabled = n <= 1 || idx <= 0;
    if (btnNext) btnNext.disabled = n <= 1 || idx >= n - 1;
    g.querySelectorAll(".galeria-miniaturas button").forEach((btn, i) => {
      btn.classList.toggle("ativa", i === idx);
    });
  }

  function fecharDetalhe() {
    if (!els.modal) return;
    if (els.galeria) els.galeria.querySelectorAll("video").forEach((v) => v.pause());
    document.body.classList.remove("modal-aberto");
    estado.modalCasaId = null;
    estado.casaAtivaId = null;
    atualizarMarcadoresAtivo();
    atualizarAtivoCards();
    els.modal.hidden = true;
    document.body.style.overflow = "";
    estado.modalGallery = { fotos: [], idx: 0 };
    requestAnimationFrame(() => {
      if (estado.map) estado.map.invalidateSize();
    });
  }

  function setupSwipeGaleria() {
    if (!els.galeria) return;
    let inicioX = null;
    els.galeria.addEventListener(
      "touchstart",
      (e) => {
        inicioX = e.touches.length === 1 ? e.touches[0].clientX : null;
      },
      { passive: true },
    );
    els.galeria.addEventListener("touchend", (e) => {
      if (inicioX === null) return;
      const distancia = e.changedTouches[0].clientX - inicioX;
      inicioX = null;
      if (Math.abs(distancia) < 40) return;
      const { fotos, idx } = estado.modalGallery;
      const proximo = distancia < 0 ? idx + 1 : idx - 1;
      if (proximo < 0 || proximo >= fotos.length) return;
      estado.modalGallery.idx = proximo;
      atualizarGaleriaModal();
    });
  }

  function setVistaMapa(vendoMapa) {
    document.body.classList.toggle("vendo-mapa", vendoMapa);
    if (els.btnVista) els.btnVista.textContent = vendoMapa ? "Ver as casas" : "Ver no mapa";
    if (!vendoMapa && estado.marcandoPonto) setMarcandoPonto(false);
    if (estado.map) estado.map.invalidateSize();
  }

  function setupVistaMapa() {
    if (!els.btnVista) return;
    els.btnVista.addEventListener("click", () => {
      setVistaMapa(!document.body.classList.contains("vendo-mapa"));
    });
  }

  function setupModalClose() {
    if (!els.modal) return;
    els.modal.addEventListener("click", (e) => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (t.dataset.close === "true") fecharDetalhe();
    });
    document.addEventListener("keydown", (e) => {
      if (!els.modal || els.modal.hidden) return;
      if (e.key === "Escape") {
        fecharDetalhe();
        return;
      }
      const { fotos, idx } = estado.modalGallery;
      if (fotos.length <= 1) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        estado.modalGallery.idx = Math.max(0, idx - 1);
        atualizarGaleriaModal();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        estado.modalGallery.idx = Math.min(fotos.length - 1, idx + 1);
        atualizarGaleriaModal();
      }
    });
  }

  function atualizarBotoesOpiniao() {
    const bloqueado = estado.votingClosed || !supabase || isAdmin;
    if (els.btnCurti) els.btnCurti.disabled = bloqueado;
    if (els.btnNaoCurti) els.btnNaoCurti.disabled = bloqueado;
  }

  function atualizarOpiniaoModal(batendo) {
    const opiniao = estado.modalCasaId && !isAdmin ? opiniaoDaCasa(estado.modalCasaId) : null;
    if (els.modalCarimbo) {
      els.modalCarimbo.innerHTML = opiniao ? carimboHtml(opiniao.gostei, batendo) : "";
    }
    if (els.btnCurti) els.btnCurti.setAttribute("aria-pressed", String(Boolean(opiniao && opiniao.gostei)));
    if (els.btnNaoCurti) els.btnNaoCurti.setAttribute("aria-pressed", String(Boolean(opiniao && !opiniao.gostei)));
  }

  function msgModal(texto) {
    if (els.modalVotoMsg) els.modalVotoMsg.textContent = texto;
  }

  async function enviarOpiniao(gostei) {
    if (isAdmin) return;
    if (!supabase) {
      msgModal("Configura o Supabase em js/config.js.");
      return;
    }
    if (estado.votingClosed) {
      msgModal("Votação encerrada.");
      return;
    }
    if (!garantirNomeParaAcao()) return;

    const casaId = estado.modalCasaId;
    if (!casaId) return;

    const nomeNorm = getNomeNormSalvo();
    const nomeDisplay = getNomeSalvo().trim() || nomeNorm;
    const deviceId = getDeviceId();

    msgModal("Salvando…");

    const row = {
      p_device_id: deviceId,
      p_nome_norm: nomeNorm,
      p_nome_display: nomeDisplay,
      p_casa_id: casaId,
      p_gostei: gostei,
    };

    const { error } = await supabase.rpc("registrar_opiniao", row);

    if (error) {
      if (error.code === "PGRST202") {
        msgModal("Falta atualizar o banco: roda o SQL novo do README.");
      } else if (error.message.includes("voting_closed")) {
        msgModal("Votação encerrada.");
      } else {
        msgModal(error.message);
      }
      return;
    }

    salvarOpiniaoLocal(casaId, gostei);
    atualizarOpiniaoModal(true);
    msgModal(gostei ? "Anotado! Você curtiu essa casa." : "Anotado! Essa não agradou.");
    await fetchTotals();
    renderLista();
    if (isAdmin) renderRankingAdmin();
  }

  function avisoSupabase() {
    if (!els.supabaseAviso) return;
    if (!supabase) {
      els.supabaseAviso.hidden = false;
      els.supabaseAviso.textContent =
        "Supabase não configurado. Copia js/config.example.js pra js/config.js e preenche URL + chave.";
    } else {
      els.supabaseAviso.hidden = true;
    }
  }

  function renderRankingAdmin() {
    if (!isAdmin || !els.adminRanking) return;
    const total = Object.values(estado.counts).reduce((a, b) => a + b, 0);
    const sorted = [...estado.casas].sort((a, b) => {
      const va = estado.counts[String(a.id)] || 0;
      const vb = estado.counts[String(b.id)] || 0;
      if (vb !== va) return vb - va;
      return String(a.id).localeCompare(String(b.id));
    });
    els.adminRanking.innerHTML = "";
    sorted.forEach((casa, i) => {
      const n = estado.counts[String(casa.id)] || 0;
      const pct = total ? Math.round((n / total) * 1000) / 10 : 0;
      const li = document.createElement("li");
      if (i === 0 && n > 0) li.classList.add("destaque");
      li.textContent = `${i + 1}. ${casa.titulo || "Casa"} (#${casa.id}): ${n} ${n === 1 ? "curtida" : "curtidas"}${total ? ` (${pct}%)` : ""}`;
      els.adminRanking.appendChild(li);
    });
  }

  async function refreshUi() {
    await fetchTotals();
    renderLista();
    renderRankingAdmin();
    atualizarBotoesOpiniao();
    checarRevelacao();
  }

  function textoCurtidas(n) {
    return `${n} ${n === 1 ? "curtida" : "curtidas"}`;
  }

  /** Houses by likes, sharing a position on a tie: nobody wins a tie by list order. */
  function rankingDasCasas() {
    const contagem = (casa) => estado.counts[String(casa.id)] || 0;
    const ordenadas = [...estado.casas].sort((a, b) => contagem(b) - contagem(a));
    return ordenadas.map((casa) => {
      const n = contagem(casa);
      return { casa, n, posicao: ordenadas.findIndex((c) => contagem(c) === n) + 1 };
    });
  }

  function checarRevelacao() {
    if (isAdmin || !els.revelacao) return;
    if (!estado.showResults) {
      els.revelacao.hidden = true;
      estado.revelacaoFechada = false;
      return;
    }
    if (estado.revelacaoFechada || !els.revelacao.hidden) return;
    if (els.overlayNome && !els.overlayNome.hidden) return;
    if (els.revelacaoConvite) els.revelacaoConvite.hidden = false;
    if (els.revelacaoResultado) els.revelacaoResultado.hidden = true;
    els.revelacao.hidden = false;
    if (els.btnRevelar) els.btnRevelar.focus();
  }

  function cartaoVencedora(casa, n) {
    const art = document.createElement("article");
    art.className = "revelacao__vencedora";
    const thumb = casaThumbImagem(casa) || casaPrincipalFoto(casa);
    if (thumb) {
      if (!urlEhVideo(thumb)) {
        const img = document.createElement("img");
        img.src = thumb;
        img.alt = "";
        art.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "revelacao__video-ph";
        ph.textContent = "▶ Vídeo";
        art.appendChild(ph);
      }
    }
    const nome = document.createElement("h2");
    nome.textContent = casa.titulo || casa.local || "Casa";
    const detalhe = document.createElement("p");
    detalhe.textContent = [casa.local, textoCurtidas(n)].filter(Boolean).join(", ");
    art.append(nome, detalhe);
    return art;
  }

  function renderRevelacao() {
    const ranking = rankingDasCasas();
    const maximo = ranking.length ? ranking[0].n : 0;
    const vencedoras = maximo > 0 ? ranking.filter((r) => r.n === maximo) : [];
    if (els.revelacaoChamada) {
      els.revelacaoChamada.textContent =
        vencedoras.length === 0
          ? "Nenhuma casa recebeu curtida ainda."
          : vencedoras.length > 1
            ? "Deu empate!"
            : "A casa mais curtida é";
    }
    if (els.revelacaoVencedoras) {
      els.revelacaoVencedoras.replaceChildren(...vencedoras.map((r) => cartaoVencedora(r.casa, r.n)));
    }
    if (els.revelacaoRanking) {
      els.revelacaoRanking.replaceChildren(
        ...ranking.map((r) => {
          const li = document.createElement("li");
          const pos = document.createElement("span");
          pos.className = "revelacao__posicao";
          pos.textContent = `${r.posicao}º`;
          const nome = document.createElement("span");
          nome.className = "revelacao__nome";
          nome.textContent = r.casa.titulo || r.casa.local || "Casa";
          const total = document.createElement("strong");
          total.textContent = textoCurtidas(r.n);
          li.append(pos, nome, total);
          return li;
        }),
      );
    }
    return vencedoras.length > 0;
  }

  /** A short paper burst in the site's colors, drawn on a canvas that never catches clicks. */
  function soltarConfete() {
    const canvas = els.confete;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.hidden = false;
    const escala = window.devicePixelRatio || 1;
    const largura = window.innerWidth;
    const altura = window.innerHeight;
    canvas.width = largura * escala;
    canvas.height = altura * escala;
    ctx.scale(escala, escala);

    const cores = ["#f26a0a", "#ffa91f", "#0a9cc2", "#17803d", "#c62828", "#fffdf6"];
    const lancar = (origemX, origemY, quantos, direcao) =>
      Array.from({ length: quantos }, () => {
        const angulo = direcao + (Math.random() - 0.5) * 1.3;
        const forca = (0.55 + Math.random() * 0.75) * Math.max(altura, 620);
        return {
          x: origemX,
          y: origemY,
          vx: Math.cos(angulo) * forca,
          vy: Math.sin(angulo) * forca,
          giro: Math.random() * Math.PI * 2,
          vGiro: (Math.random() - 0.5) * 12,
          lado: 6 + Math.random() * 7,
          cor: cores[Math.floor(Math.random() * cores.length)],
        };
      });
    const pecas = [
      ...lancar(0, altura * 0.8, 70, -Math.PI / 3),
      ...lancar(largura, altura * 0.8, 70, (-Math.PI * 2) / 3),
      ...lancar(largura / 2, altura * 0.55, 90, -Math.PI / 2),
    ];

    const inicio = performance.now();
    let anterior = inicio;
    const quadro = (agora) => {
      const dt = Math.min((agora - anterior) / 1000, 0.05);
      anterior = agora;
      ctx.clearRect(0, 0, largura, altura);
      let noAr = false;
      for (const p of pecas) {
        p.vx *= 1 - 1.4 * dt;
        p.vy = p.vy * (1 - 1.4 * dt) + 1050 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.giro += p.vGiro * dt;
        if (p.y > altura + 20) continue;
        noAr = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.giro);
        ctx.scale(1, Math.cos(p.giro * 2));
        ctx.fillStyle = p.cor;
        ctx.fillRect(-p.lado / 2, -p.lado / 3, p.lado, (p.lado * 2) / 3);
        ctx.restore();
      }
      if (noAr && agora - inicio < 6000) {
        requestAnimationFrame(quadro);
      } else {
        ctx.clearRect(0, 0, largura, altura);
        canvas.hidden = true;
      }
    };
    requestAnimationFrame(quadro);
  }

  function setupRevelacao() {
    if (isAdmin) return;
    if (els.btnRevelar) {
      els.btnRevelar.addEventListener("click", async () => {
        els.btnRevelar.disabled = true;
        await fetchTotals();
        els.btnRevelar.disabled = false;
        const temVencedora = renderRevelacao();
        if (els.revelacaoConvite) els.revelacaoConvite.hidden = true;
        if (els.revelacaoResultado) els.revelacaoResultado.hidden = false;
        if (els.revelacao) els.revelacao.scrollTop = 0;
        if (temVencedora) soltarConfete();
        if (els.btnRevelacaoFechar) els.btnRevelacaoFechar.focus({ preventScroll: true });
      });
    }
    if (els.btnRevelacaoFechar) {
      els.btnRevelacaoFechar.addEventListener("click", () => {
        estado.revelacaoFechada = true;
        if (els.revelacao) els.revelacao.hidden = true;
      });
    }
  }

  function erroFetchAdminDetalhe(causeMsg) {
    const url = `${functionsBase}/admin`;
    const filePage =
      typeof window !== "undefined" &&
      window.location &&
      window.location.protocol === "file:";
    let dica =
      "Abre o site por http (ex.: npx serve .). Abrir index.html como file:// bloqueia chamadas ao Supabase.";
    if (!filePage) {
      dica =
        "Pode ser rede, extensão (adblock), firewall ou URL errada. Testa no terminal: curl -X POST " +
        url +
        " -H \"Content-Type: application/json\" -H \"Authorization: Bearer SUA_ANON\" -H \"X-Admin-Key: SEU_ADMIN\" -d \"{\\\"action\\\":\\\"list-votes\\\"}\"";
    }
    return `Falha de rede ao chamar ${url} (${causeMsg}). ${dica}`;
  }

  async function adminFetch(body) {
    if (!functionsBase) throw new Error("Supabase URL não configurada.");
    let res;
    try {
      res = await fetch(`${functionsBase}/admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseAnonKey}`,
          "X-Admin-Key": adminApiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(erroFetchAdminDetalhe(msg));
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      throw new Error(typeof data === "string" ? data : data?.error || res.statusText);
    }
    return data;
  }

  function mostrarErroAdmin(msg) {
    if (els.adminFetchErro) {
      els.adminFetchErro.hidden = !msg;
      els.adminFetchErro.textContent = msg || "";
    }
  }

  async function adminCarregar() {
    if (!isAdmin || !els.admin) return;
    els.admin.hidden = false;
    try {
      const data = await adminFetch({ action: "list-votes" });
      mostrarErroAdmin("");
      const rows = data?.votes || [];
      if (els.adminVotosLista) {
        els.adminVotosLista.innerHTML = "";
        for (const v of rows) {
          const li = document.createElement("li");
          const left = document.createElement("span");
          const opin = v.gostei === false ? "não curti" : "curti";
          const who = v.nome_display || v.nome_norm || "?";
          left.textContent = `${who} → #${v.casa_id} (${opin})`;
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn btn-small btn-danger";
          btn.textContent = "Apagar";
          btn.addEventListener("click", async () => {
            if (!confirm("Apagar este registro?")) return;
            await adminFetch({ action: "delete-vote", id: v.id });
            await adminCarregar();
            await refreshUi();
          });
          li.appendChild(left);
          li.appendChild(btn);
          els.adminVotosLista.appendChild(li);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (els.adminVotosLista) {
        const aviso = document.createElement("li");
        aviso.className = "muted";
        aviso.textContent = `Lista: ${msg}`;
        els.adminVotosLista.replaceChildren(aviso);
      }
      mostrarErroAdmin(
        `Função admin no Supabase falhou (${msg}). Confirma: deploy da função \`admin\`, secret ADMIN_KEY igual ao segredo do link, e URL do projeto certa.`,
      );
    }

    await fetchConfigSupabase();
    atualizarControleAdmin();
    renderRankingAdmin();
  }

  function atualizarControleAdmin() {
    if (els.adminConfigStatus) {
      els.adminConfigStatus.textContent =
        `A votação está ${estado.votingClosed ? "pausada" : "aberta"}. ` +
        `Os resultados estão ${estado.showResults ? "aparecendo para a família" : "escondidos"}.`;
    }
    if (els.btnVotacao) els.btnVotacao.textContent = estado.votingClosed ? "Abrir votação" : "Pausar votação";
    if (els.btnResultados) els.btnResultados.textContent = estado.showResults ? "Esconder resultados" : "Mostrar resultados";
  }

  function setupAdminHandlers() {
    if (!isAdmin) return;
    const reload = async () => {
      await refreshUi();
      await adminCarregar();
    };
    const acaoAdmin = async (botao, corpo) => {
      botao.disabled = true;
      try {
        await adminFetch(corpo);
        mostrarErroAdmin("");
        await reload();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        mostrarErroAdmin(`Erro: ${msg}. Verifica Edge Function \`admin\` e se o secret ADMIN_KEY é igual ao segredo do link.`);
      } finally {
        botao.disabled = false;
      }
    };
    if (els.btnVotacao) {
      els.btnVotacao.addEventListener("click", () =>
        acaoAdmin(els.btnVotacao, { action: "set-config", key: "voting_closed", value: String(!estado.votingClosed) }),
      );
    }
    if (els.btnResultados) {
      els.btnResultados.addEventListener("click", () =>
        acaoAdmin(els.btnResultados, { action: "set-config", key: "show_results", value: String(!estado.showResults) }),
      );
    }
    if (els.btnLimparVotos) {
      els.btnLimparVotos.addEventListener("click", () => {
        if (!confirm("Apagar todos os votos da família? Isso não pode ser desfeito.")) return;
        acaoAdmin(els.btnLimparVotos, { action: "clear-votes" });
      });
    }
    if (els.btnCopiarJson) {
      els.btnCopiarJson.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(els.adminJson?.value || "");
          if (els.modalVotoMsg) els.modalVotoMsg.textContent = "";
          alert("JSON copiado.");
        } catch {
          alert("Não deu pra copiar.");
        }
      });
    }
  }

  function setupNomeUi() {
    if (els.btnBoasContinuar) {
      els.btnBoasContinuar.addEventListener("click", () => {
        irOverlayPassoNome();
      });
    }
    if (els.btnConfirmarNome && els.inputNomeOverlay) {
      els.btnConfirmarNome.addEventListener("click", () => {
        const nome = els.inputNomeOverlay.value.trim();
        if (nome.length < 2) {
          if (els.nomeOverlayErro) els.nomeOverlayErro.textContent = "Nome muito curto, uai.";
          return;
        }
        salvarNome(nome);
        fecharOverlayNome();
        checarRevelacao();
      });
      els.inputNomeOverlay.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          els.btnConfirmarNome.click();
        }
      });
    }
    if (els.btnSairUsuario) {
      els.btnSairUsuario.addEventListener("click", () => limparUsuario());
    }
  }

  async function init() {
    document.body.classList.toggle("admin-logado", isAdmin);
    document.body.classList.toggle("air-body--admin-full", isAdmin);

    if (els.linkVerVotacao) {
      els.linkVerVotacao.hidden = !isAdmin;
    }

    avisoSupabase();
    setupNomeUi();
    atualizarHeaderUsuario();
    if (!isAdmin && !nomeProntoParaVotar()) {
      mostrarOverlayNome();
    } else {
      fecharOverlayNome();
    }

    try {
      await carregarCasas();
    } catch (e) {
      console.error(e);
      if (els.lista) els.lista.innerHTML = "<li class='muted'>Erro ao carregar casas.json</li>";
    }

    estado.refMapa = lerRefMapaStorage();
    aplicarCacheRotasParaRef(estado.refMapa);

    montarMapa();
    renderLista();
    setupModalClose();
    setupSwipeGaleria();
    setupVistaMapa();
    setupRevelacao();

    if (els.btnCurti) els.btnCurti.addEventListener("click", () => enviarOpiniao(true));
    if (els.btnNaoCurti) els.btnNaoCurti.addEventListener("click", () => enviarOpiniao(false));

    await refreshUi();
    setupAdminHandlers();
    if (isAdmin) await adminCarregar();

    if (els.ordenacao) {
      els.ordenacao.addEventListener("change", (e) => {
        const escolha = /** @type {HTMLInputElement} */ (e.target).value;
        if (escolha === "perto" && !estado.refMapa) {
          estado.voltarAposMarcar = true;
          setVistaMapa(true);
          setMarcandoPonto(true);
        }
        renderLista();
      });
    }

    setInterval(refreshUi, 25000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
