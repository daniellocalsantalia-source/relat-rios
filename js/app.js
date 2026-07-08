/* ==========================================================================
   PAUTA — Calendário de Ensaios
   app.js — toda a lógica da aplicação (dados, cálculo de datas, UI, import/export)
   ========================================================================== */

(function () {
"use strict";

/* ----------------------------------------------------------------------
   1) CONSTANTES / CONFIGURAÇÃO
   ---------------------------------------------------------------------- */
const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho",
               "Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DIAS_SEMANA = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira",
                     "Quinta-feira","Sexta-feira","Sábado"];

const TIPOS = ["Mensal","Bimestral","Trimestral","Extra","Quadrimestral","Semestral"];
const TIPO_COLOR = {
  "Mensal":        "#2f6fed",
  "Bimestral":     "#1a9c67",
  "Trimestral":    "#e07b1f",
  "Extra":         "#8b5cf6",
  "Quadrimestral": "#d43f4b",
  "Semestral":     "#6b7280"
};

const TABLE_COLUMNS = [
  { key:"dataLabel",            label:"Data" },
  { key:"diaSemanaLabel",       label:"Dia da Semana" },
  { key:"congregacao",          label:"Congregação" },
  { key:"cidade",                label:"Cidade" },
  { key:"setor",                 label:"Setor" },
  { key:"horario",               label:"Horário" },
  { key:"encarregadoLocal",      label:"Enc. Local" },
  { key:"encarregadoRegional",   label:"Enc. Regional" },
  { key:"tipo",                  label:"Tipo" }
];

const LS_KEY = "pauta.ensaios.v1";

/* ----------------------------------------------------------------------
   2) MOTOR DE DATAS
   Regras do tipo "3ª segunda-feira de Janeiro" são convertidas em datas
   reais para qualquer ano solicitado. Isso permite gerar automaticamente
   o calendário completo de qualquer ano, presente ou futuro.
   ---------------------------------------------------------------------- */
function nthWeekdayOfMonth(year, monthIndex0, weekdayIndex0, nth) {
  const first = new Date(year, monthIndex0, 1);
  const firstWeekday = first.getDay();
  const offset = (weekdayIndex0 - firstWeekday + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  const result = new Date(year, monthIndex0, day);
  if (result.getMonth() !== monthIndex0) return null; // ex.: não existe 5ª ocorrência nesse mês
  return result;
}

function pad2(n){ return String(n).padStart(2,"0"); }
function isoDate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function brDate(d){ return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`; }

// Expande as "regras" recorrentes em ocorrências concretas para um ano.
function expandRegrasParaAno(regras, ano) {
  const out = [];
  regras.forEach((r) => {
    let dataObj = null;
    if (r.dataFixa) {
      dataObj = new Date(r.dataFixa + "T00:00:00");
      if (dataObj.getFullYear() !== ano) return; // data fixa só aparece no próprio ano
    } else {
      dataObj = nthWeekdayOfMonth(ano, r.mesNumero - 1, r.diaSemanaIndice, r.diaSemanaOrdinal);
      if (!dataObj) return; // ex.: "5ª segunda-feira" que não existe naquele mês/ano
    }
    out.push({
      ...r,
      ano,
      dataObj,
      dataISO: isoDate(dataObj),
      dataLabel: brDate(dataObj)
    });
  });
  out.sort((a,b) => a.dataObj - b.dataObj);
  return out;
}

/* ----------------------------------------------------------------------
   3) CAMADA DE DADOS (DB)
   Abstração pensada para permitir troca futura por Supabase/Firebase:
   basta reimplementar os métodos abaixo mantendo a mesma assinatura.
   ---------------------------------------------------------------------- */
const DB = {
  async getRegras() {
    const local = localStorage.getItem(LS_KEY);
    if (local) {
      try { return JSON.parse(local); } catch(e) { /* ignore */ }
    }
    const res = await fetch("data/dados.json");
    const json = await res.json();
    return json.ensaios;
  },
  async saveRegras(regras) {
    localStorage.setItem(LS_KEY, JSON.stringify(regras));
    return true;
  },
  async resetToOriginal() {
    localStorage.removeItem(LS_KEY);
    const res = await fetch("data/dados.json");
    const json = await res.json();
    return json.ensaios;
  }
  /* --------------------------------------------------------------------
     Exemplo de futura implementação com Supabase:
     async getRegras() {
       const { data, error } = await supabaseClient.from('ensaios').select('*');
       if (error) throw error;
       return data;
     },
     async saveRegras(regras) {
       const { error } = await supabaseClient.from('ensaios').upsert(regras);
       if (error) throw error;
       return true;
     }
  -------------------------------------------------------------------- */
};

/* ----------------------------------------------------------------------
   4) ESTADO GLOBAL
   ---------------------------------------------------------------------- */
const state = {
  regras: [],          // regras recorrentes (fonte da verdade)
  ano: new Date().getFullYear(),
  ocorrencias: [],      // regras expandidas para o ano corrente
  filtros: {
    setor: [], encRegional: [], encLocal: [], congregacao: [],
    cidade: [], tipo: [], mes: [], diaSemana: []
  },
  buscaGlobal: "",
  view: "dashboard",
  subview: "calendar",
  fullTable: { search:"", sortKey:"dataObj", sortDir:1, page:1, pageSize:20 },
  dashTable: { search:"" },
  calendar: null,
  theme: localStorage.getItem("pauta.theme") || "light"
};

/* ----------------------------------------------------------------------
   5) UTILIDADES
   ---------------------------------------------------------------------- */
function el(id){ return document.getElementById(id); }
function uniqueSorted(arr){ return [...new Set(arr)].filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR')); }
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ----------------------------------------------------------------------
   5b) COMPONENTE: dropdown de múltipla escolha com busca e checkboxes
   Usado em todos os filtros (Setor, Encarregado, Congregação, Cidade,
   Tipo, Mês, Dia da Semana) — muito mais usável que <select multiple>,
   principalmente em telas de celular.
   ---------------------------------------------------------------------- */
class MultiSelect {
  constructor(container, label, onChange) {
    this.container = container;
    this.label = label;
    this.onChange = onChange;
    this.values = [];
    this.selected = new Set();
    this._build();
  }
  _build() {
    this.container.classList.add("ms-dropdown");
    this.container.innerHTML = `
      <button type="button" class="ms-toggle" aria-haspopup="listbox">
        <span class="ms-toggle-text">Todos</span>
        <i class="bi bi-chevron-down"></i>
      </button>
      <div class="ms-panel" role="listbox">
        <div class="ms-panel-search">
          <i class="bi bi-search"></i>
          <input type="text" placeholder="Buscar ${escapeHtml(this.label.toLowerCase())}...">
        </div>
        <div class="ms-panel-actions">
          <button type="button" class="ms-select-all">Selecionar tudo</button>
          <button type="button" class="ms-clear">Limpar</button>
        </div>
        <div class="ms-options"></div>
      </div>`;
    this.toggleBtn = this.container.querySelector(".ms-toggle");
    this.toggleText = this.container.querySelector(".ms-toggle-text");
    this.panel = this.container.querySelector(".ms-panel");
    this.optionsEl = this.container.querySelector(".ms-options");
    this.searchInput = this.container.querySelector(".ms-panel-search input");

    this.toggleBtn.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(); });
    this.container.querySelector(".ms-select-all").addEventListener("click", () => {
      this._visibleValues().forEach(v => this.selected.add(v));
      this._renderOptions(); this._commit();
    });
    this.container.querySelector(".ms-clear").addEventListener("click", () => {
      this.selected.clear(); this._renderOptions(); this._commit();
    });
    this.searchInput.addEventListener("input", () => this._renderOptions());
    this.searchInput.addEventListener("click", (e) => e.stopPropagation());
  }
  _visibleValues() {
    const q = this.searchInput.value.trim().toLowerCase();
    return q ? this.values.filter(v => v.toLowerCase().includes(q)) : this.values;
  }
  _renderOptions() {
    const visible = this._visibleValues();
    this.optionsEl.innerHTML = visible.map(v => `
      <label class="ms-option">
        <input type="checkbox" value="${escapeHtml(v)}" ${this.selected.has(v) ? "checked" : ""}>
        <span>${escapeHtml(v)}</span>
      </label>`).join("") || `<div class="ms-empty">Nenhuma opção encontrada</div>`;
    this.optionsEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener("change", () => {
        if (cb.checked) this.selected.add(cb.value); else this.selected.delete(cb.value);
        this._commit();
      });
    });
  }
  _commit() { this._updateToggleLabel(); this.onChange([...this.selected]); }
  _updateToggleLabel() {
    const n = this.selected.size;
    this.toggleBtn.classList.toggle("has-selection", n > 0);
    if (n === 0) this.toggleText.textContent = "Todos";
    else if (n === 1) this.toggleText.textContent = [...this.selected][0];
    else this.toggleText.textContent = `${n} selecionados`;
  }
  open() {
    document.querySelectorAll(".ms-panel.open").forEach(p => p.classList.remove("open"));
    document.querySelectorAll(".ms-dropdown.open").forEach(d => d.classList.remove("open"));
    this.panel.classList.add("open");
    this.container.classList.add("open");
    this.searchInput.value = "";
    this._renderOptions();
    this.searchInput.focus();
  }
  close() { this.panel.classList.remove("open"); this.container.classList.remove("open"); }
  toggle() { this.panel.classList.contains("open") ? this.close() : this.open(); }
  setOptions(values) {
    this.values = values;
    this.selected = new Set([...this.selected].filter(v => values.includes(v)));
    this._renderOptions();
    this._updateToggleLabel();
  }
  clear() { this.selected.clear(); this._renderOptions(); this._updateToggleLabel(); }
  getSelected() { return [...this.selected]; }
}
document.addEventListener("click", () => {
  document.querySelectorAll(".ms-panel.open").forEach(p => p.classList.remove("open"));
  document.querySelectorAll(".ms-dropdown.open").forEach(d => d.classList.remove("open"));
});

function toast(msg, icon="check2-circle") {
  const stack = el("toastStack");
  const item = document.createElement("div");
  item.className = "toast-item";
  item.innerHTML = `<i class="bi bi-${icon}"></i><span>${msg}</span>`;
  stack.appendChild(item);
  setTimeout(() => item.remove(), 3200);
}

function applyFiltrosBusca(lista) {
  const f = state.filtros;
  const q = state.buscaGlobal.trim().toLowerCase();
  return lista.filter(o => {
    if (f.setor.length && !f.setor.includes(o.setor)) return false;
    if (f.encRegional.length && !f.encRegional.includes(o.encarregadoRegional)) return false;
    if (f.encLocal.length && !f.encLocal.includes(o.encarregadoLocal)) return false;
    if (f.congregacao.length && !f.congregacao.includes(o.congregacao)) return false;
    if (f.cidade.length && !f.cidade.includes(o.cidade)) return false;
    if (f.tipo.length && !f.tipo.includes(o.tipo)) return false;
    if (f.mes.length && !f.mes.includes(o.mes)) return false;
    if (f.diaSemana.length && !f.diaSemana.includes(o.diaSemanaLabel)) return false;
    if (q) {
      const hay = `${o.congregacao} ${o.cidade} ${o.setor} ${o.encarregadoLocal} ${o.encarregadoRegional} ${o.tipo} ${o.observacoes||""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ----------------------------------------------------------------------
   6) INICIALIZAÇÃO
   ---------------------------------------------------------------------- */
async function init() {
  document.documentElement.setAttribute("data-theme", state.theme);
  updateThemeToggleLabel();

  state.regras = await DB.getRegras();
  buildYearSelect();
  recomputeOccurrences();
  initMultiSelects();
  buildFilterOptions();
  renderLegend();
  initCalendar();
  bindEvents();
  renderAll();
}

function buildYearSelect() {
  const sel = el("yearSelect");
  const anosNasRegras = state.regras.filter(r=>r.dataFixa).map(r=>new Date(r.dataFixa).getFullYear());
  const base = new Date().getFullYear();
  const anos = uniqueSorted([base-1, base, base+1, base+2, ...anosNasRegras].map(String)).map(Number).sort((a,b)=>a-b);
  sel.innerHTML = anos.map(a => `<option value="${a}" ${a===state.ano?"selected":""}>${a}</option>`).join("");
  sel.value = state.ano;
}

function recomputeOccurrences() {
  state.ocorrencias = expandRegrasParaAno(state.regras, state.ano);
}

const FILTER_DEFS = [
  { id:"f-setor",        key:"setor",        label:"Setor" },
  { id:"f-encRegional",  key:"encRegional",  label:"Encarregado Regional" },
  { id:"f-encLocal",     key:"encLocal",     label:"Encarregado Local" },
  { id:"f-congregacao",  key:"congregacao",  label:"Congregação" },
  { id:"f-cidade",       key:"cidade",       label:"Cidade" },
  { id:"f-tipo",         key:"tipo",         label:"Tipo de Ensaio" },
  { id:"f-mes",          key:"mes",          label:"Mês" },
  { id:"f-diaSemana",    key:"diaSemana",    label:"Dia da Semana" }
];

function initMultiSelects() {
  state.multiSelects = {};
  FILTER_DEFS.forEach(d => {
    state.multiSelects[d.key] = new MultiSelect(el(d.id), d.label, (values) => {
      state.filtros[d.key] = values;
      renderActiveFilterChips();
      renderAll();
    });
  });
}

function buildFilterOptions() {
  const src = state.ocorrencias;
  const valuesByKey = {
    setor: uniqueSorted(src.map(o=>o.setor)),
    encRegional: uniqueSorted(src.map(o=>o.encarregadoRegional)),
    encLocal: uniqueSorted(src.map(o=>o.encarregadoLocal)),
    congregacao: uniqueSorted(src.map(o=>o.congregacao)),
    cidade: uniqueSorted(src.map(o=>o.cidade)),
    tipo: TIPOS,
    mes: MESES,
    diaSemana: DIAS_SEMANA
  };
  FILTER_DEFS.forEach(d => state.multiSelects[d.key].setOptions(valuesByKey[d.key]));
}

function renderActiveFilterChips() {
  const wrap = el("activeFilterChips");
  const chips = [];
  FILTER_DEFS.forEach(d => {
    (state.filtros[d.key] || []).forEach(val => {
      chips.push({ key:d.key, label:d.label, val });
    });
  });
  if (!chips.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = chips.map(c => `
    <span class="chip" data-key="${c.key}" data-val="${escapeHtml(c.val)}">
      <b>${c.label}:</b>${escapeHtml(c.val)}
      <button type="button" aria-label="Remover filtro"><i class="bi bi-x"></i></button>
    </span>`).join("");
  wrap.querySelectorAll(".chip button").forEach(btn => {
    btn.addEventListener("click", () => {
      const chip = btn.closest(".chip");
      const key = chip.dataset.key, val = chip.dataset.val;
      state.filtros[key] = state.filtros[key].filter(v => v !== val);
      state.multiSelects[key].selected.delete(val);
      state.multiSelects[key]._renderOptions();
      state.multiSelects[key]._updateToggleLabel();
      renderActiveFilterChips();
      renderAll();
    });
  });
}

function renderLegend() {
  el("typeLegend").innerHTML = TIPOS.map(t =>
    `<span class="legend-item"><span class="legend-dot" style="background:${TIPO_COLOR[t]}"></span>${t}</span>`
  ).join("");
}

/* ----------------------------------------------------------------------
   7) CALENDÁRIO (FullCalendar)
   ---------------------------------------------------------------------- */
function initCalendar() {
  const calendarEl = el("calendar");
  state.calendar = new FullCalendar.Calendar(calendarEl, {
    locale: "pt-br",
    initialDate: `${state.ano}-01-01`,
    headerToolbar: { left:"prev,next today", center:"title", right:"dayGridMonth,listMonth" },
    height: "auto",
    events: [],
    eventClick(info) {
      openEventModal(info.event.extendedProps.raw);
    },
    datesSet(info) {
      const newYear = info.view.currentStart.getFullYear();
      if (newYear !== state.ano && el("yearSelect").querySelector(`option[value="${newYear}"]`)) {
        state.ano = newYear;
        el("yearSelect").value = newYear;
        recomputeOccurrences();
        buildFilterOptions();
        renderAll(true);
      }
    }
  });
  state.calendar.render();
}

function refreshCalendarEvents() {
  const filtrados = applyFiltrosBusca(state.ocorrencias);
  const events = filtrados.map(o => ({
    id: String(o.id) + "-" + o.dataISO,
    title: `${o.congregacao} · ${o.horario}`,
    start: o.dataISO,
    color: TIPO_COLOR[o.tipo] || "#999",
    extendedProps: { raw: o }
  }));
  state.calendar.removeAllEvents();
  state.calendar.addEventSource(events);
}

/* ----------------------------------------------------------------------
   8) MODAL DE DETALHES
   ---------------------------------------------------------------------- */
let eventModalInstance = null;
function openEventModal(o) {
  el("mTipoBadge").textContent = o.tipo;
  el("mTipoBadge").style.background = TIPO_COLOR[o.tipo] || "#999";
  el("mCongregacao").textContent = o.congregacao;
  el("mData").textContent = `${o.dataLabel} (${o.diaSemanaTexto})`;
  el("mHorario").textContent = o.horario;
  el("mCidade").textContent = o.cidade;
  el("mSetor").textContent = o.setor;
  el("mEncLocal").textContent = o.encarregadoLocal;
  el("mEncRegional").textContent = o.encarregadoRegional;
  const obsWrap = el("mObsWrap");
  if (o.observacoes) {
    obsWrap.classList.remove("d-none");
    el("mObs").textContent = o.observacoes;
  } else {
    obsWrap.classList.add("d-none");
  }
  if (!eventModalInstance) eventModalInstance = new bootstrap.Modal(el("eventModal"));
  eventModalInstance.show();
}

/* ----------------------------------------------------------------------
   9) CARDS DE ESTATÍSTICA
   ---------------------------------------------------------------------- */
function renderStatCards() {
  const filtrados = applyFiltrosBusca(state.ocorrencias);
  const totalEnsaios = filtrados.length;
  const totalCongregacoes = new Set(filtrados.map(o=>o.congregacao)).size;
  const totalSetores = new Set(filtrados.map(o=>o.setor)).size;
  const totalRegionais = new Set(filtrados.map(o=>o.encarregadoRegional)).size;

  const cards = [
    { label:"Total de Ensaios", value:totalEnsaios, hint:`no ano de ${state.ano}`, icon:"calendar-check", color:"var(--tipo-mensal)" },
    { label:"Congregações", value:totalCongregacoes, hint:"atendidas nos filtros atuais", icon:"building", color:"var(--tipo-bimestral)" },
    { label:"Setores", value:totalSetores, hint:"envolvidos", icon:"diagram-3", color:"var(--tipo-trimestral)" },
    { label:"Encarregados Regionais", value:totalRegionais, hint:"responsáveis", icon:"person-badge", color:"var(--tipo-extra)" }
  ];
  const html = cards.map(c => `
    <div class="stat-card" style="--card-accent:${c.color}">
      <div class="stat-label"><i class="bi bi-${c.icon}"></i> ${c.label}</div>
      <div class="stat-value">${c.value}</div>
      <div class="stat-hint">${c.hint}</div>
    </div>`).join("");
  el("statCards").innerHTML = html;
  el("statCards2").innerHTML = html;
}

/* ----------------------------------------------------------------------
   10) TABELAS (dashboard mini-tabela e tabela completa)
   ---------------------------------------------------------------------- */
function tipoPillHTML(tipo) {
  return `<span class="type-pill" style="background:${TIPO_COLOR[tipo]||'#999'}">${tipo}</span>`;
}

function renderTableHead(theadEl, sortKey, sortDir) {
  theadEl.innerHTML = "<tr>" + TABLE_COLUMNS.map(c => {
    const sorted = c.key === sortKey;
    const icon = sorted ? (sortDir === 1 ? "bi-arrow-up" : "bi-arrow-down") : "bi-arrow-down-up";
    return `<th data-key="${c.key}" class="${sorted?'sorted':''}">${c.label} <i class="bi ${icon} sort-ic"></i></th>`;
  }).join("") + "</tr>";
}

function rowHTML(o) {
  return `<tr data-id="${o.id}-${o.dataISO}">
    <td>${o.dataLabel}</td>
    <td>${o.diaSemanaLabel}</td>
    <td>${o.congregacao}</td>
    <td>${o.cidade}</td>
    <td>${o.setor}</td>
    <td>${o.horario}</td>
    <td>${o.encarregadoLocal}</td>
    <td>${o.encarregadoRegional}</td>
    <td>${tipoPillHTML(o.tipo)}</td>
  </tr>`;
}

function renderDashTable() {
  const thead = el("dashTable").querySelector("thead");
  const tbody = el("dashTable").querySelector("tbody");
  renderTableHead(thead, "dataObj", 1);
  let rows = applyFiltrosBusca(state.ocorrencias);
  const q = state.dashTable.search.trim().toLowerCase();
  if (q) rows = rows.filter(o => JSON.stringify(o).toLowerCase().includes(q));
  rows.sort((a,b)=>a.dataObj-b.dataObj);
  tbody.innerHTML = rows.map(rowHTML).join("") || `<tr><td colspan="9" class="text-center text-muted py-4">Nenhum ensaio encontrado.</td></tr>`;
  attachRowClicks(tbody, rows);
}

function renderFullTable() {
  const thead = el("fullTable").querySelector("thead");
  const tbody = el("fullTable").querySelector("tbody");
  const ft = state.fullTable;
  renderTableHead(thead, ft.sortKey, ft.sortDir);

  let rows = applyFiltrosBusca(state.ocorrencias);
  const q = ft.search.trim().toLowerCase();
  if (q) rows = rows.filter(o => JSON.stringify(o).toLowerCase().includes(q));

  rows.sort((a,b) => {
    let av = a[ft.sortKey], bv = b[ft.sortKey];
    if (av instanceof Date) { av = av.getTime(); bv = bv.getTime(); }
    if (typeof av === "string") { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    if (av < bv) return -1 * ft.sortDir;
    if (av > bv) return 1 * ft.sortDir;
    return 0;
  });

  const total = rows.length;
  const pageSize = ft.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (ft.page > totalPages) ft.page = totalPages;
  const startIdx = (ft.page - 1) * pageSize;
  const pageRows = rows.slice(startIdx, startIdx + pageSize);

  tbody.innerHTML = pageRows.map(rowHTML).join("") || `<tr><td colspan="9" class="text-center text-muted py-4">Nenhum ensaio encontrado.</td></tr>`;
  attachRowClicks(tbody, pageRows);

  el("fullTableCount").textContent = `${total} ensaio(s) — página ${ft.page} de ${totalPages}`;
  renderPager(totalPages, ft.page);

  // export uses full filtered set (not just current page)
  state.fullTable._exportRows = rows;
}

function attachRowClicks(tbody, rows) {
  const map = {};
  rows.forEach(o => map[`${o.id}-${o.dataISO}`] = o);
  tbody.querySelectorAll("tr[data-id]").forEach(tr => {
    tr.addEventListener("click", () => {
      const o = map[tr.getAttribute("data-id")];
      if (o) openEventModal(o);
    });
  });
}

function renderPager(totalPages, current) {
  const pager = el("fullTablePager");
  let html = "";
  const maxButtons = 7;
  let start = Math.max(1, current - 3);
  let end = Math.min(totalPages, start + maxButtons - 1);
  start = Math.max(1, end - maxButtons + 1);
  html += `<button ${current===1?'disabled':''} data-page="${current-1}"><i class="bi bi-chevron-left"></i></button>`;
  for (let p = start; p <= end; p++) {
    html += `<button class="${p===current?'active':''}" data-page="${p}">${p}</button>`;
  }
  html += `<button ${current===totalPages?'disabled':''} data-page="${current+1}"><i class="bi bi-chevron-right"></i></button>`;
  pager.innerHTML = html;
  pager.querySelectorAll("button[data-page]").forEach(b => {
    b.addEventListener("click", () => {
      state.fullTable.page = Number(b.getAttribute("data-page"));
      renderFullTable();
    });
  });
}

/* ----------------------------------------------------------------------
   11) ESTATÍSTICAS (barras)
   ---------------------------------------------------------------------- */
function renderBarList(containerId, rows, keyFn, topN=12) {
  const counts = {};
  rows.forEach(o => { const k = keyFn(o); counts[k] = (counts[k]||0)+1; });
  const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0, topN);
  const max = entries.length ? entries[0][1] : 1;
  el(containerId).innerHTML = entries.map(([label, val]) => `
    <div class="bar-row">
      <span class="bar-label" title="${label}">${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(val/max*100).toFixed(1)}%"></div></div>
      <span class="bar-value">${val}</span>
    </div>`).join("") || `<p class="muted">Sem dados para exibir.</p>`;
}

function renderStatsView() {
  const rows = applyFiltrosBusca(state.ocorrencias);
  renderBarList("bySetor", rows, o=>o.setor);
  renderBarList("byRegional", rows, o=>o.encarregadoRegional);
  renderBarList("byTipo", rows, o=>o.tipo);
  renderBarList("byCidade", rows, o=>o.cidade);
}

/* ----------------------------------------------------------------------
   12) RENDER GERAL
   ---------------------------------------------------------------------- */
function renderAll(skipCalendarJump) {
  renderStatCards();
  refreshCalendarEvents();
  renderDashTable();
  renderFullTable();
  renderStatsView();
}

/* ----------------------------------------------------------------------
   13) NAVEGAÇÃO / VIEWS
   ---------------------------------------------------------------------- */
const VIEW_TITLES = {
  dashboard: ["Dashboard", "Visão geral dos ensaios do ministério de música"],
  tabela: ["Tabela de Ensaios", "Todos os ensaios com busca, ordenação e exportação"],
  estatisticas: ["Estatísticas", "Distribuição dos ensaios por setor, encarregado, tipo e cidade"],
  importar: ["Importar Excel", "Atualize o calendário a partir de uma planilha .xlsx"]
};

function setView(view) {
  state.view = view;
  document.querySelectorAll(".view-panel").forEach(v => v.classList.add("d-none"));
  el(`view-${view}`).classList.remove("d-none");
  document.querySelectorAll(".side-link").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  el("viewTitle").textContent = VIEW_TITLES[view][0];
  el("viewSubtitle").textContent = VIEW_TITLES[view][1];
  closeSidebarMobile();
  if (view === "dashboard" && state.calendar) setTimeout(()=>state.calendar.updateSize(), 50);
}

function closeSidebarMobile() {
  el("sidebar").classList.remove("open");
  el("sidebarBackdrop").classList.remove("show");
}

/* ----------------------------------------------------------------------
   14) IMPORTAÇÃO DE EXCEL (SheetJS)
   ---------------------------------------------------------------------- */
let pendingImportRegras = null;

function normalizeDiaSemana(text) {
  const m = String(text).trim().match(/^(\d)ª?\s*(.+)$/);
  if (!m) return null;
  const ordinal = Number(m[1]);
  const raw = m[2].trim().toLowerCase();
  const noAccents = raw.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const table = { "domingo":0, "segunda-feira":1, "terca-feira":2, "quarta-feira":3,
                   "quinta-feira":4, "sexta-feira":5, "sabado":6 };
  const idx = table[noAccents];
  if (idx === undefined) return null;
  return { ordinal, idx, label: DIAS_SEMANA[idx] };
}

function excelTimeToHHMM(v) {
  if (v instanceof Date) return `${pad2(v.getHours())}:${pad2(v.getMinutes())}`;
  if (typeof v === "number") {
    const totalMinutes = Math.round(v * 24 * 60);
    return `${pad2(Math.floor(totalMinutes/60))}:${pad2(totalMinutes%60)}`;
  }
  if (typeof v === "string" && /^\d{1,2}:\d{2}/.test(v)) {
    const [h,m] = v.split(":");
    return `${pad2(h)}:${pad2(m)}`;
  }
  return "19:00";
}

const TIPO_NORMALIZE = {
  "mensal":"Mensal", "bimestral":"Bimestral", "trimestral":"Trimestral", "trimestrais":"Trimestral",
  "extra":"Extra", "extras":"Extra", "quadrimestral":"Quadrimestral", "quatrimestral":"Quadrimestral",
  "quatrimestrais":"Quadrimestral", "semestral":"Semestral", "sementral":"Semestral"
};

function parseImportedWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type:"array", cellDates:true });
        const sheetName = wb.SheetNames.includes("Ensaios") ? "Ensaios" : wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval:"" });
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function mapImportedRows(rows) {
  const errors = [];
  const out = [];
  rows.forEach((row, idx) => {
    const get = (...keys) => {
      for (const k of keys) {
        const found = Object.keys(row).find(rk => rk.trim().toLowerCase() === k.toLowerCase());
        if (found && String(row[found]).trim() !== "") return row[found];
      }
      return "";
    };
    const mesTxt = String(get("Mês","Mes","mes")).trim();
    const diaSemanaTxt = String(get("Dia_Semana","Dia da Semana")).trim();
    const congregacao = String(get("Congregação","Congregacao")).trim();
    const cidade = String(get("Cidade")).trim() || congregacao;
    const setor = String(get("Setor")).trim();
    const tipoRaw = String(get("Tipo")).trim().toLowerCase();
    const tipo = TIPO_NORMALIZE[tipoRaw] || (tipoRaw ? tipoRaw.charAt(0).toUpperCase()+tipoRaw.slice(1) : "Mensal");
    const horario = excelTimeToHHMM(get("Horário","Horario","HORARIO"));
    const encLocal = String(get("Encarregado Local")).trim();
    const encRegional = String(get("Encarregado Regional")).trim();
    const obs = String(get("Observação","Observacao","OBS")).trim();
    const dataCell = get("Data");

    if (!congregacao) { errors.push(`Linha ${idx+2}: Congregação vazia — ignorada.`); return; }

    let dataFixa = null;
    let mesNumero = null, diaSemanaIndice = null, diaSemanaOrdinal = null, diaSemanaLabel = null;

    if (dataCell) {
      const d = dataCell instanceof Date ? dataCell : new Date(dataCell);
      if (!isNaN(d)) {
        dataFixa = isoDate(d);
        mesNumero = d.getMonth()+1;
        diaSemanaIndice = d.getDay();
        diaSemanaLabel = DIAS_SEMANA[diaSemanaIndice];
        diaSemanaOrdinal = Math.ceil(d.getDate()/7);
      }
    }
    if (!dataFixa) {
      mesNumero = MESES.findIndex(m => m.toLowerCase() === mesTxt.toLowerCase()) + 1;
      const parsedDia = normalizeDiaSemana(diaSemanaTxt);
      if (!mesNumero || !parsedDia) {
        errors.push(`Linha ${idx+2}: não foi possível calcular a data (verifique Mês/Dia_Semana ou Data) — ignorada.`);
        return;
      }
      diaSemanaOrdinal = parsedDia.ordinal;
      diaSemanaIndice = parsedDia.idx;
      diaSemanaLabel = parsedDia.label;
    }

    out.push({
      id: "imp-" + (idx+1) + "-" + Date.now(),
      mesNumero,
      mes: MESES[mesNumero-1],
      diaSemanaOrdinal, diaSemanaIndice, diaSemanaLabel,
      diaSemanaTexto: `${diaSemanaOrdinal}ª ${diaSemanaLabel}`,
      congregacao, cidade, setor,
      tipo: TIPOS.includes(tipo) ? tipo : "Mensal",
      horario, encarregadoLocal: encLocal, encarregadoRegional: encRegional,
      observacoes: obs, dataFixa
    });
  });
  return { out, errors };
}

/* ----------------------------------------------------------------------
   15) EXPORTAÇÃO (Excel / PDF)
   ---------------------------------------------------------------------- */
function exportRowsToExcel(rows, filename) {
  const data = rows.map(o => ({
    "Data": o.dataLabel, "Dia da Semana": o.diaSemanaLabel, "Congregação": o.congregacao,
    "Cidade": o.cidade, "Setor": o.setor, "Horário": o.horario,
    "Encarregado Local": o.encarregadoLocal, "Encarregado Regional": o.encarregadoRegional,
    "Tipo": o.tipo, "Observações": o.observacoes || ""
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{wch:12},{wch:16},{wch:24},{wch:18},{wch:16},{wch:9},{wch:20},{wch:20},{wch:14},{wch:28}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ensaios");
  XLSX.writeFile(wb, filename);
  toast("Planilha exportada com sucesso.", "file-earmark-excel");
}

function exportRowsToPDF(rows, filename, titulo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:"landscape", unit:"pt" });
  doc.setFontSize(14);
  doc.text(titulo, 40, 36);
  doc.setFontSize(9);
  doc.text(`Gerado em ${new Date().toLocaleDateString("pt-BR")} · ${rows.length} ensaio(s)`, 40, 52);
  doc.autoTable({
    startY: 66,
    head: [["Data","Dia da Semana","Congregação","Cidade","Setor","Horário","Enc. Local","Enc. Regional","Tipo"]],
    body: rows.map(o => [o.dataLabel, o.diaSemanaLabel, o.congregacao, o.cidade, o.setor, o.horario, o.encarregadoLocal, o.encarregadoRegional, o.tipo]),
    styles: { fontSize:8, cellPadding:4 },
    headStyles: { fillColor:[19,27,46] },
    alternateRowStyles: { fillColor:[246,244,238] }
  });
  doc.save(filename);
  toast("PDF exportado com sucesso.", "file-earmark-pdf");
}

/* ----------------------------------------------------------------------
   16) EVENTOS DE UI
   ---------------------------------------------------------------------- */
function bindEvents() {
  // navegação lateral
  document.querySelectorAll(".side-link").forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });
  el("btnGoImport").addEventListener("click", () => setView("importar"));

  // sidebar mobile
  el("sidebarOpen").addEventListener("click", () => {
    el("sidebar").classList.add("open");
    el("sidebarBackdrop").classList.add("show");
  });
  el("sidebarClose").addEventListener("click", closeSidebarMobile);
  el("sidebarBackdrop").addEventListener("click", closeSidebarMobile);

  // tema
  el("themeToggle").addEventListener("click", () => {
    state.theme = state.theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", state.theme);
    localStorage.setItem("pauta.theme", state.theme);
    updateThemeToggleLabel();
  });

  // ano
  el("yearSelect").addEventListener("change", (e) => {
    state.ano = Number(e.target.value);
    recomputeOccurrences();
    buildFilterOptions();
    state.calendar.gotoDate(`${state.ano}-01-01`);
    renderAll();
  });

  // filtros: cada MultiSelect já dispara renderAll() via seu próprio onChange
  el("clearFilters").addEventListener("click", () => {
    Object.keys(state.filtros).forEach(k => state.filtros[k] = []);
    Object.values(state.multiSelects).forEach(ms => ms.clear());
    renderActiveFilterChips();
    renderAll();
  });

  // busca global (topbar)
  el("globalSearch").addEventListener("input", (e) => {
    state.buscaGlobal = e.target.value;
    renderAll();
  });

  // alternância calendário / tabela no dashboard
  document.querySelectorAll(".view-switch button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-switch button").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const sub = btn.dataset.subview;
      state.subview = sub;
      el("calendarWrap").classList.toggle("d-none", sub!=="calendar");
      el("listWrap").classList.toggle("d-none", sub!=="list");
      if (sub === "calendar") setTimeout(()=>state.calendar.updateSize(), 50);
    });
  });

  // busca da mini-tabela do dashboard
  el("dashTableSearch").addEventListener("input", (e) => {
    state.dashTable.search = e.target.value;
    renderDashTable();
  });
  el("dashExportXlsx").addEventListener("click", () => {
    exportRowsToExcel(applyFiltrosBusca(state.ocorrencias), `ensaios_${state.ano}.xlsx`);
  });
  el("dashExportPdf").addEventListener("click", () => {
    exportRowsToPDF(applyFiltrosBusca(state.ocorrencias), `ensaios_${state.ano}.pdf`, `Ensaios — ${state.ano}`);
  });

  // tabela completa
  el("fullTableSearch").addEventListener("input", (e) => {
    state.fullTable.search = e.target.value;
    state.fullTable.page = 1;
    renderFullTable();
  });
  el("fullTable").querySelector("thead")?.addEventListener("click", ()=>{});
  el("fullTable").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-key]");
    if (!th) return;
    const key = th.dataset.key;
    if (state.fullTable.sortKey === key) {
      state.fullTable.sortDir *= -1;
    } else {
      state.fullTable.sortKey = key === "dataLabel" ? "dataObj" : key;
      state.fullTable.sortDir = 1;
    }
    renderFullTable();
  });
  el("fullExportXlsx").addEventListener("click", () => {
    exportRowsToExcel(state.fullTable._exportRows || [], `ensaios_${state.ano}.xlsx`);
  });
  el("fullExportPdf").addEventListener("click", () => {
    exportRowsToPDF(state.fullTable._exportRows || [], `ensaios_${state.ano}.pdf`, `Ensaios — ${state.ano}`);
  });

  // importação
  const dropzone = el("dropzone");
  const fileInput = el("fileInput");
  dropzone.addEventListener("click", () => fileInput.click());
  ["dragover","dragenter"].forEach(evt => dropzone.addEventListener(evt, (e)=>{ e.preventDefault(); dropzone.classList.add("dragover"); }));
  ["dragleave","drop"].forEach(evt => dropzone.addEventListener(evt, (e)=>{ e.preventDefault(); dropzone.classList.remove("dragover"); }));
  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) handleImportFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length) handleImportFile(e.target.files[0]);
  });
  el("cancelImport").addEventListener("click", resetImportUI);
  el("confirmImport").addEventListener("click", async () => {
    if (!pendingImportRegras) return;
    const replace = el("importReplace").checked;
    state.regras = replace ? pendingImportRegras : [...state.regras, ...pendingImportRegras];
    await DB.saveRegras(state.regras);
    buildYearSelect();
    recomputeOccurrences();
    buildFilterOptions();
    renderAll();
    toast(`${pendingImportRegras.length} ensaio(s) importado(s) com sucesso.`, "check2-circle");
    resetImportUI();
    setView("dashboard");
  });

  // zona de risco: apagar todos os registros
  el("clearAllData").addEventListener("click", async () => {
    if (!state.regras.length) { toast("A base já está vazia.", "info-circle"); return; }
    const ok = confirm(
      `Tem certeza que deseja apagar TODOS os ${state.regras.length} ensaios da base?\n` +
      `Esta ação não pode ser desfeita. Você pode reimportar a planilha depois, se precisar.`
    );
    if (!ok) return;
    state.regras = [];
    await DB.saveRegras([]);
    Object.keys(state.filtros).forEach(k => state.filtros[k] = []);
    Object.values(state.multiSelects).forEach(ms => ms.clear());
    renderActiveFilterChips();
    buildYearSelect();
    recomputeOccurrences();
    buildFilterOptions();
    resetImportUI();
    renderAll();
    toast("Todos os registros de ensaio foram removidos.", "trash3");
  });
}

function updateThemeToggleLabel() {
  const btn = el("themeToggle");
  const isDark = state.theme === "dark";
  btn.innerHTML = `<i class="bi bi-${isDark?'sun':'moon-stars'}"></i><span>Tema ${isDark?'claro':'escuro'}</span>`;
}

async function handleImportFile(file) {
  try {
    const rows = await parseImportedWorkbook(file);
    const { out, errors } = mapImportedRows(rows);
    pendingImportRegras = out;
    const summary = el("importSummary");
    summary.classList.remove("d-none");
    summary.innerHTML = `
      <strong>${out.length}</strong> ensaio(s) reconhecido(s) com sucesso.
      ${errors.length ? `<br><span class="text-danger">${errors.length} linha(s) com problema:</span>
      <ul class="mb-0 mt-1">${errors.slice(0,8).map(e=>`<li>${e}</li>`).join("")}</ul>
      ${errors.length>8?`<div class="muted">+ ${errors.length-8} outra(s)...</div>`:""}` : ""}
    `;
    el("importActions").classList.remove("d-none");
  } catch (err) {
    toast("Não foi possível ler o arquivo. Verifique se é um .xlsx válido.", "exclamation-triangle");
  }
}

function resetImportUI() {
  pendingImportRegras = null;
  el("fileInput").value = "";
  el("importSummary").classList.add("d-none");
  el("importActions").classList.add("d-none");
  el("importReplace").checked = false;
}

/* ----------------------------------------------------------------------
   17) START
   ---------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", init);

})();
