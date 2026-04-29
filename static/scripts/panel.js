// panel.js — выбор из website_schema.json и POST на локальный агент

const SCHEMA_URL = "data/website_schema.json";
const CUSTOM_IMAGES_URL = "data/custom_images.json"; 
const HERO_RENDER_BASE = window.APP_CONFIG.HERO_RENDER_BASE;
const INVENTORY_IMAGE_BASE = window.APP_CONFIG.INVENTORY_IMAGE_BASE;
const LS_SELECTIONS = "ds_selections";
const LS_HOST = "ds_bridge_host";
const LS_PORT = "ds_bridge_port";
const LS_PRESETS = "ds_presets";
const LS_ACTIVE_PRESET = "ds_active_preset";
const LS_GLOBAL_COLLAPSED = "ds_global_collapsed_sections";

/** @type {Record<string, unknown> | null} */
let schema = null;
/** @type {Record<string, { image_inventory?: string }>} */
let customImages = {}; 
/** @type {Record<string, string>} */
let selections = {};

/** @type {{ type: 'global', id: string } | { type: 'hero', hero: string, slot: string } | { type: 'effect', hero: string, slot: string } | null} */
let pickerContext = null;

/** @type {Record<string, Record<string, string>>} */
let presets = {};
/** @type {Record<string, boolean>} */
let collapsedGlobalSections = {};

const el = (id) => document.getElementById(id);

const DEFAULT_VALUES = {
  ancients: "Default Ancient",
  announcers: "Default Announcer",
  couriers: "Default Courier",
  current_hero: "Abaddon",
  cursors: "Default Cursor Pack",
  dire_creep: "Default Dire Creeps",
  dire_towers: "Default Dire Towers",
  emblems: "Default Emblem",
  huds: "Default Hud Skin",
  kill_banners: "Default Kill Banners",
  killstreaks: "Default KillStreak",
  loading_screens: "Default Loading Screen",
  megakills: "Default Mega-Kill Announcer",
  music_packs: "Default Music",
  rad_creep: "Default Radiant Creeps",
  rad_towers: "Default Radiant Towers",
  river_vials: "River Vial: Default",
  roshans: "Default Roshan",
  shaders: "Default Shaders",
  terrains: "Default Terrain",
  tormentors: "Default Tormentor",
  versus_screens: "Default Versus Screen",
  wards: "Default Ward",
  weathers: "Default Weather"
};

const GLOBAL_CATEGORY_TITLE = {
  ancients: "Древние",
  announcers: "Аннонсер",
  couriers: "Курьер",
  cursors: "Курсоры",
  dire_creep: "Крипы (Dire)",
  dire_towers: "Башни (Dire)",
  emblems: "Эмблемы",
  huds: "Интерфейс (HUD)",
  kill_banners: "Сообщения о серии убийств",
  killstreaks: "Киллстрики",
  loading_screens: "Загрузочные экраны",
  megakills: "Мега-киллы",
  music_packs: "Музыка",
  rad_creep: "Крипы (Radiant)",
  rad_towers: "Башни (Radiant)",
  river_vials: "Виалы реки",
  roshans: "Рошан",
  shaders: "Шейдеры экрана",
  terrains: "Ландшафты",
  tormentors: "Торменторы",
  versus_screens: "Экраны Versus",
  wards: "Варды",
  weathers: "Погода",
};

const GLOBAL_SECTION_LAYOUT = [
  {
    title: "Звук",
    items: ["music_packs", "announcers", "megakills"],
  },
  {
    title: "Интерфейс",
    items: ["loading_screens", "versus_screens", "huds", "killstreaks", "cursors",  "kill_banners"],
  },
  {
    title: "Окружение",
    items: ["couriers", "wards", "terrains", "dire_creep", "rad_creep", "dire_towers", "rad_towers", "ancients", "roshans", "tormentors", "shaders", "weathers", "emblems", "river_vials"],
  }
];

function getCategoriesRecord() {
  if (!schema || typeof schema !== "object" || !("categories" in schema)) return null;
  const c = schema.categories;
  return c && typeof c === "object" ? c : null;
}

function getGlobalCategoryIds() {
  const cats = getCategoriesRecord();
  if (!cats) return [];
  return Object.keys(cats).filter((k) => Array.isArray(cats[k]));
}

function globalCategoryTitle(catId) {
  const titled = GLOBAL_CATEGORY_TITLE[catId];
  if (typeof titled === "string") return titled;
  return catId.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function getConfiguredGlobalSections() {
  const available = new Set(getGlobalCategoryIds());
  const used = new Set();
  const sections = [];

  for (const section of GLOBAL_SECTION_LAYOUT) {
    const items = section.items.filter((id) => available.has(id) && !used.has(id));
    for (const id of items) used.add(id);
    if (items.length) sections.push({ title: section.title, items });
  }

  const uncategorized = [...available].filter((id) => !used.has(id)).sort((a, b) => a.localeCompare(b, "en"));
  if (uncategorized.length) sections.push({ title: "Остальное", items: uncategorized });
  return sections;
}

function loadGlobalSectionState() {
  try {
    const raw = localStorage.getItem(LS_GLOBAL_COLLAPSED);
    const parsed = raw ? JSON.parse(raw) : {};
    collapsedGlobalSections = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    collapsedGlobalSections = {};
  }
}

function saveGlobalSectionState() {
  localStorage.setItem(LS_GLOBAL_COLLAPSED, JSON.stringify(collapsedGlobalSections));
}

function sectionKeyFromTitle(title) {
  return title.toLowerCase().trim().replace(/\s+/g, "_");
}

function buildGlobalTile(catId) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "card tile";
  btn.dataset.openPicker = catId;
  btn.setAttribute("aria-haspopup", "dialog");

  const lab = document.createElement("span");
  lab.className = "tile-label";
  lab.textContent = globalCategoryTitle(catId);

  const val = document.createElement("span");
  val.className = "tile-value";
  val.id = `val-${catId}`;
  val.textContent = DEFAULT_VALUES[catId] || "По умолчанию";

  const thumb = document.createElement("img");
  thumb.className = "tile-thumb";
  thumb.id = `thumb-${catId}`;
  thumb.hidden = true;
  thumb.loading = "lazy";
  thumb.decoding = "async";

  btn.append(lab, val, thumb);
  return btn;
}

// --- УНИВЕРСАЛЬНАЯ ЛОГИКА ГАЛЕРЕИ ИНВЕНТАРЯ ---
function buildGalleryData(sourceData) {
  const globals = [];
  const heroesData = {};

  if (!schema || typeof schema !== "object") return { globals, heroesData };

  // Глобальные
  const globalCats = getGlobalCategoryIds();
  for (const cat of globalCats) {
    const selId = sourceData[cat];
    if (selId) {
      const list = asItemList(schema.categories[cat]);
      const item = list.find((i) => i.id === selId);
      if (item) {
        globals.push({
          slotName: globalCategoryTitle(cat),
          itemName: item.name,
          url: getItemImageUrl(item),
          isEffect: false
        });
      }
    }
  }

  // Герои
  if (schema.skin_changer && typeof schema.skin_changer === "object") {
    for (const hero of Object.keys(schema.skin_changer)) {
      const heroData = schema.skin_changer[hero];
      if (!heroData || typeof heroData !== "object") continue;

      for (const slot of Object.keys(heroData)) {
        const itemKey = `${hero}_${slot}`;
        const effKey = `${hero}_${slot}_effect`;

        const selectedItemId = sourceData[itemKey];
        const selectedEffId = sourceData[effKey];

        if (selectedItemId || selectedEffId) {
          if (!heroesData[hero]) heroesData[hero] = [];

          if (selectedItemId) {
            const items = asItemList(heroData[slot]);
            const item = items.find((i) => i.id === selectedItemId);
            heroesData[hero].push({
              slotName: slot.replace(/_/g, " "),
              itemName: item ? item.name : "Неизвестный предмет",
              url: getItemImageUrl(item),
              isEffect: false
            });
          }

          if (selectedEffId) {
            const effList = getEffectsList();
            const effItem = effList.find((e) => e.id === selectedEffId);
            heroesData[hero].push({
              slotName: slot.replace(/_/g, " "),
              itemName: effItem ? `✨ ${effItem.name}` : "✨ Неизвестный эффект",
              url: "",
              isEffect: true
            });
          }
        }
      }
    }
  }

  return { globals, heroesData };
}

function renderGallery(containerId, sourceData, emptyMessage) {
  const container = el(containerId);
  if (!container) return;
  container.innerHTML = "";

  const { globals, heroesData } = buildGalleryData(sourceData);

  if (globals.length === 0 && Object.keys(heroesData).length === 0) {
    container.innerHTML = `<div class="summary-empty">${emptyMessage}</div>`;
    return;
  }

  const frag = document.createDocumentFragment();

  function buildRow(title, itemsData, isGlobal = false) {
    if (!itemsData || itemsData.length === 0) return null;

    const row = document.createElement("div");
    row.className = `summary-row ${isGlobal ? "global-row" : ""}`;

    const header = document.createElement("div");
    header.className = "summary-row-header";
    header.textContent = title;
    row.appendChild(header);

    const flex = document.createElement("div");
    flex.className = "summary-items-flex";

    for (const item of itemsData) {
      const card = document.createElement("div");
      card.className = "summary-item-card";
      // БЕЗ атрибута title — ничего не вылезет при наведении

      const imgWrap = document.createElement("div");
      imgWrap.className = "summary-img-wrap";
      if (item.isEffect) imgWrap.classList.add("effect-border");

      if (item.url) {
        const img = document.createElement("img");
        img.className = "summary-item-img";
        img.src = item.url;
        img.loading = "lazy";
        img.alt = item.itemName; // Альт оставим для валидности, он обычно не всплывает как title
        imgWrap.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "summary-item-placeholder";
        ph.textContent = item.isEffect ? "✨" : "?";
        imgWrap.appendChild(ph);
      }

      const txt = document.createElement("span");
      txt.className = "summary-item-label";
      txt.textContent = item.slotName;

      card.append(imgWrap, txt);
      flex.appendChild(card);
    }

    row.appendChild(flex);
    return row;
  }

  const globalsRow = buildRow("Глобальные предметы", globals, true);
  if (globalsRow) frag.appendChild(globalsRow);

  const heroesKeys = Object.keys(heroesData).sort();
  for (const h of heroesKeys) {
    const hTitle = h.replace(/_/g, " ");
    const hRow = buildRow(hTitle, heroesData[h]);
    if (hRow) frag.appendChild(hRow);
  }

  container.appendChild(frag);
}

function renderPresetPreview(presetName) {
  let presetData;
  let isCurrent = false;

  if (!presetName || !presets[presetName]) {
    presetData = selections;
    isCurrent = true;
  } else {
    presetData = presets[presetName];
  }

  const msg = isCurrent 
    ? "В текущем выборе пока нет нестандартных предметов." 
    : "В этом пресете нет нестандартных предметов.";

  renderGallery("preset-preview-area", presetData, msg);
}

function renderGlobalGrid() {
  const root = el("global-grid");
  if (!root) return;
  root.innerHTML = "";

  const sections = getConfiguredGlobalSections();
  const frag = document.createDocumentFragment();

  for (const section of sections) {
    const sectionKey = sectionKeyFromTitle(section.title);
    const isCollapsed = collapsedGlobalSections[sectionKey] === true;
    const block = document.createElement("div");
    block.className = "global-subsection";
    if (isCollapsed) block.classList.add("collapsed");
    block.dataset.sectionKey = sectionKey;

    const heading = document.createElement("button");
    heading.type = "button";
    heading.className = "global-subsection-title";
    heading.dataset.toggleGlobalSection = sectionKey;
    heading.setAttribute("aria-expanded", isCollapsed ? "false" : "true");

    const headingText = document.createElement("span");
    headingText.textContent = section.title;
    const chevron = document.createElement("span");
    chevron.className = "global-subsection-chevron";
    chevron.textContent = "▸";
    chevron.setAttribute("aria-hidden", "true");
    heading.append(headingText, chevron);

    const grid = document.createElement("div");
    grid.className = "global-grid-inner";
    if (isCollapsed) grid.hidden = true;
    for (const catId of section.items) {
      grid.appendChild(buildGlobalTile(catId));
    }

    block.append(heading, grid);
    frag.appendChild(block);
  }
  root.appendChild(frag);
}

function loadSelections() {
  try {
    const raw = localStorage.getItem(LS_SELECTIONS);
    const parsed = raw ? JSON.parse(raw) : {};
    selections = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    selections = {};
  }

  if (!selections.current_hero) {
    selections.current_hero = DEFAULT_VALUES.current_hero;
  }
}

function saveSelectionsLocal() {
  localStorage.setItem(LS_SELECTIONS, JSON.stringify(selections));
}

function trimSlash(s) {
  return s.replace(/\/+$/, "");
}

function joinUrl(base, path) {
  const b = trimSlash(base);
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

function getAgentBaseUrl() {
  const host = localStorage.getItem(LS_HOST)?.trim() || "127.0.0.1";
  const portRaw = localStorage.getItem(LS_PORT)?.trim() || "3847";
  const port = parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return "";
  return `http://${host}:${port}`;
}

let saveTimeoutId = null;

function setSaveStatus(text, kind) {
  const node = el("save-status");
  if (!node) return;
  node.textContent = text;
  node.classList.remove("ok", "err");
  if (kind === "ok") node.classList.add("ok");
  if (kind === "err") node.classList.add("err");

  if (saveTimeoutId) clearTimeout(saveTimeoutId);

  if (text) {
    saveTimeoutId = setTimeout(() => {
      node.textContent = "";
      node.classList.remove("ok", "err");
    }, 3500);
  }
}

function setApplyVpkState(isEnabled) {
  const btn = el("btn-apply-all");
  if (!btn) return;
  btn.disabled = !isEnabled;
  if (isEnabled) {
    btn.style.opacity = "1";
    btn.style.cursor = "pointer";
    btn.title = "Установить созданный VPK";
  } else {
    btn.style.opacity = "0.5";
    btn.style.cursor = "not-allowed";
    btn.title = "Сначала создайте VPK (кнопка сохранения)";
  }
}

let isBuildingVpk = false;

function setSaveButtonState(isBuilding) {
  const btn = el("btn-save-all");
  if (!btn) return;
  btn.disabled = isBuilding;

  if (isBuilding) {
    btn.style.opacity = "0.5";
    btn.style.cursor = "wait"; 
    btn.textContent = "Сборка VPK...";
  } else {
    btn.style.opacity = "1";
    btn.style.cursor = "pointer";
    btn.textContent = "Создать VPK"; 
  }
}

let presetTimeoutId = null;

function setPresetStatus(text, kind) {
  const node = el("preset-status");
  if (!node) return;
  node.textContent = text;
  node.classList.remove("ok", "err");
  if (kind === "ok") node.classList.add("ok");
  if (kind === "err") node.classList.add("err");

  if (presetTimeoutId) clearTimeout(presetTimeoutId);

  if (text) {
    presetTimeoutId = setTimeout(() => {
      node.textContent = "";
      node.classList.remove("ok", "err");
    }, 3500);
  }
}

function cloneSelections(source) {
  return JSON.parse(JSON.stringify(source));
}

function sanitizedPresetName(raw) {
  const name = raw.trim().replace(/\s+/g, " ");
  return name.slice(0, 48);
}

function loadPresets() {
  try {
    const raw = localStorage.getItem(LS_PRESETS);
    const parsed = raw ? JSON.parse(raw) : {};
    presets = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    presets = {};
  }
}

function savePresetsLocal() {
  localStorage.setItem(LS_PRESETS, JSON.stringify(presets));
}

function renderPresetSelect() {
  const select = el("preset-select");
  if (!(select instanceof HTMLSelectElement)) return;
  const active = localStorage.getItem(LS_ACTIVE_PRESET) || "";
  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b, "ru"));
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = names.length ? "(Текущий пресет)" : "Пресетов пока нет";
  select.appendChild(placeholder);

  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }

  if (active && names.includes(active)) select.value = active;
  renderPresetPreview(select.value);
}

function resetSelectionsToDefault() {
  selections = { current_hero: DEFAULT_VALUES.current_hero };
  saveSelectionsLocal();
  updateUI();
  setApplyVpkState(false);
  clearActivePreset();
}

function clearActivePreset() {
  localStorage.removeItem(LS_ACTIVE_PRESET);
  const select = el("preset-select");
  if (select instanceof HTMLSelectElement) {
    select.value = "";
    if (typeof renderPresetPreview === "function") {
      renderPresetPreview("");
    }
  }
}

function savePresetFromInput() {
  const input = el("preset-name");
  if (!(input instanceof HTMLInputElement)) return;
  const name = sanitizedPresetName(input.value);
  if (!name) {
    setPresetStatus("Введите имя пресета.", "err");
    return;
  }

  presets[name] = cloneSelections(selections);
  savePresetsLocal();
  localStorage.setItem(LS_ACTIVE_PRESET, name);
  renderPresetSelect();
  const select = el("preset-select");
  if (select instanceof HTMLSelectElement) select.value = name;
  input.value = "";
  setPresetStatus(`Пресет "${name}" сохранен.`, "ok");
}

function loadSelectedPreset() {
  const select = el("preset-select");
  if (!(select instanceof HTMLSelectElement)) return;
  const name = select.value;
  if (!name || !presets[name]) {
    setPresetStatus("Выберите сохраненный пресет.", "err");
    return;
  }

  selections = cloneSelections(presets[name]);
  if (!selections.current_hero) selections.current_hero = DEFAULT_VALUES.current_hero;
  saveSelectionsLocal();
  localStorage.setItem(LS_ACTIVE_PRESET, name);
  updateUI();
  setPresetStatus(`Пресет "${name}" загружен.`, "ok");
  setApplyVpkState(false);
}

function deleteSelectedPreset() {
  const select = el("preset-select");
  if (!(select instanceof HTMLSelectElement)) return;
  const name = select.value;
  if (!name || !presets[name]) {
    setPresetStatus("Нечего удалять: пресет не выбран.", "err");
    return;
  }

  delete presets[name];
  savePresetsLocal();
  if (localStorage.getItem(LS_ACTIVE_PRESET) === name) localStorage.removeItem(LS_ACTIVE_PRESET);
  renderPresetSelect();
  setPresetStatus(`Пресет "${name}" удален.`, "ok");
}

function shortServerNote(data) {
  if (!data) return "Конфиг принят.";
  if (typeof data === "string") return data.slice(0, 72);
  if (typeof data === "object") {
    const msg = data.message || data.status || data.result;
    if (typeof msg === "string" && msg.trim()) return msg.slice(0, 72);
  }
  return "Конфиг принят.";
}

function prettySaveMessage(data, ok) {
  const body = shortServerNote(data);
  return ok ? `Готово - ${body}` : body;
}

function setHeroListOpen(open) {
  const list = el("hero-drop-list");
  const btn = el("btn-toggle-hero");
  if (!list || !btn) return;
  list.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function setPickerOpen(open) {
  const modal = el("picker-modal");
  if (!modal) return;
  modal.hidden = !open;
  if (open) el("item-search")?.focus();
}

function closePicker() {
  pickerContext = null;
  setPickerOpen(false);
}

function asItemList(cat) {
  if (!Array.isArray(cat)) return [];
  return cat.filter(
    (i) =>
      i &&
      typeof i === "object" &&
      "id" in i &&
      "name" in i &&
      typeof i.id === "string" &&
      typeof i.name === "string"
  );
}

function getItemImageUrl(item) {
  if (!item) return "";
  let path = item.image_inventory;

  const override = customImages[item.name] || customImages[item.id];
  if (override && override.image_inventory) {
    path = override.image_inventory;
  }

  if (!path) return "";
  return `${INVENTORY_IMAGE_BASE}/${encodeURI(path)}.webp`;
}

function labelForGlobal(catId) {
  const fallback = DEFAULT_VALUES[catId] || "По умолчанию";

  if (!schema || typeof schema !== "object" || !("categories" in schema))
    return fallback;
  const cats = schema.categories;
  if (!cats || typeof cats !== "object") return fallback;
  const id = selections[catId];
  if (!id) return fallback;
  const list = asItemList(cats[catId]);
  const item = list.find((i) => i.id === id);

  return item?.name ?? fallback;
}

function updateGlobalTiles() {
  for (const cat of getGlobalCategoryIds()) {
    const node = el(`val-${cat}`);
    if (node) node.textContent = labelForGlobal(cat);
    const thumb = el(`thumb-${cat}`);
    if (!(thumb instanceof HTMLImageElement)) continue;

    if (!schema || typeof schema !== "object" || !("categories" in schema)) {
      thumb.hidden = true;
      thumb.removeAttribute("src");
      continue;
    }

    const cats = schema.categories;
    const list = asItemList(cats[cat]);
    const selId = selections[cat];
    let item = null;

    if (selId) {
      item = list.find((i) => i.id === selId);
    } else {
      const defaultName = DEFAULT_VALUES[cat];
      if (defaultName) {
        item = list.find((i) => i.name === defaultName);
      }
    }

    const url = getItemImageUrl(item);
    if (!url) {
      thumb.hidden = true;
      thumb.removeAttribute("src");
      continue;
    }

    thumb.src = url;
    thumb.alt = item?.name ?? "";
    thumb.hidden = false;
  }
}

function updateHeroHeader() {
  const nameEl = el("current-hero-name");
  const preview = el("hero-preview-video");
  const heroId = selections.current_hero;
  if (!nameEl) return;

  const syncVideo = (video, src) => {
    if (!(video instanceof HTMLVideoElement)) return;
    if (!src) {
      video.removeAttribute("src");
      video.load();
      return;
    }
    if (video.src !== src) {
      video.src = src;
      video.load();
    }
  };

  if (!heroId) {
    nameEl.textContent = "Выберите героя…";
    syncVideo(preview, "");
    return;
  }
  const heroName = heroId.replace(/_/g, " ");
  nameEl.textContent = heroName;

  const normalized = heroId.toLowerCase().replace(/\s+/g, "_");
  const heroSlug = normalized.replace(/[^a-z0-9_]/g, "");
  const src = `${HERO_RENDER_BASE}/${heroSlug}.webm`;
  syncVideo(preview, src);
}

function getHeroSlots(heroId) {
  if (!schema || typeof schema !== "object" || !("skin_changer" in schema)) return null;
  const sc = schema.skin_changer;
  if (!sc || typeof sc !== "object") return null;
  const hero = sc[heroId];
  if (!hero || typeof hero !== "object") return null;
  return hero;
}

function renderHeroSlots(heroId) {
  const area = el("hero-slots-area");
  if (!area) return;
  const heroData = getHeroSlots(heroId);
  if (!heroData) {
    area.hidden = true;
    area.innerHTML = "";
    return;
  }
  area.hidden = false;
  area.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const slot of Object.keys(heroData)) {
    const list = asItemList(heroData[slot]);
    const selId = selections[`${heroId}_${slot}`];
    let item = null;

    if (selId) {
      item = list.find((i) => i.id === selId);
    } else {
      item = list.find((i) => i.name.toLowerCase().includes("default"));
    }

    const wrapper = document.createElement("div");
    wrapper.className = "slot-wrapper";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card tile";
    btn.dataset.openHeroPicker = "";
    btn.dataset.hero = heroId;
    btn.dataset.slot = slot;
    btn.setAttribute("aria-haspopup", "dialog");

    const lab = document.createElement("span");
    lab.className = "tile-label";
    lab.textContent = slot;

    const val = document.createElement("span");
    val.className = "tile-value";
    val.textContent = item ? item.name : "Стандарт";

    const url = getItemImageUrl(item);
    if (url) {
      const thumb = document.createElement("img");
      thumb.className = "tile-thumb";
      thumb.src = url;
      thumb.alt = item?.name ?? "";
      thumb.loading = "lazy";
      thumb.decoding = "async";
      btn.append(lab, val, thumb);
    } else {
      btn.append(lab, val);
    }

    const effSelId = selections[`${heroId}_${slot}_effect`];
    const effList = getEffectsList();
    const effItem = effList.find((e) => e.id === effSelId);

    const effBtn = document.createElement("button");
    effBtn.type = "button";
    effBtn.className = "effect-btn";
    effBtn.dataset.openEffectPicker = "";
    effBtn.dataset.hero = heroId;
    effBtn.dataset.slot = slot;
    effBtn.textContent = effItem ? `✨ ${effItem.name}` : "✨ Без эффекта";
    effBtn.title = "Выбрать Unusual Эффект";

    wrapper.append(btn, effBtn);
    frag.appendChild(wrapper);
  }
  area.appendChild(frag);
}

function renderHeroGrid() {
  const grid = el("hero-grid");
  const input = el("hero-search");
  if (!grid || !schema || typeof schema !== "object" || !("skin_changer" in schema)) return;
  const sc = schema.skin_changer;
  const q = (input?.value ?? "").toLowerCase().trim();
  const heroes = Object.keys(sc).sort();
  grid.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const h of heroes) {
    if (q && !h.toLowerCase().includes(q)) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hero-chip";
    b.dataset.hero = h;
    b.textContent = h.replace(/_/g, " ");
    frag.appendChild(b);
  }
  grid.appendChild(frag);
}

function showPickerModal(title, items, currentId, defaultText = "По умолчанию") {
  const titleEl = el("modal-title");
  const list = el("modal-item-list");
  const search = el("item-search");
  const modal = el("picker-modal");
  if (!titleEl || !list || !modal) return;

  titleEl.textContent = title;
  if (search) search.value = "";

  function renderList(query) {
    const q = query.toLowerCase().trim();
    list.innerHTML = "";
    const frag = document.createDocumentFragment();

    if (pickerContext && pickerContext.type !== "global") {
      const noneBtn = document.createElement("button");
      noneBtn.type = "button";
      noneBtn.className = "item-option none-opt";
      noneBtn.dataset.pickId = "";
      noneBtn.textContent = `— ${defaultText} —`;
      frag.appendChild(noneBtn);
    }

    for (const i of items) {
      if (q && !i.name.toLowerCase().includes(q)) continue;
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "item-option";
      if (i.id === currentId) opt.classList.add("selected");
      opt.dataset.pickId = i.id;
      const label = document.createElement("span");
      label.className = "item-option-label";
      label.textContent = i.name;
      const url = getItemImageUrl(i);
      if (url) {
        const img = document.createElement("img");
        img.className = "item-option-thumb";
        img.src = url;
        img.alt = i.name;
        img.loading = "lazy";
        img.decoding = "async";
        opt.append(img, label);
      } else {
        opt.append(label);
      }
      frag.appendChild(opt);
    }
    list.appendChild(frag);
  }

  renderList("");
  if (search) {
    search.oninput = (e) => {
      const t = e.target;
      if (t instanceof HTMLInputElement) renderList(t.value);
    };
  }

  setPickerOpen(true);
}

function openGlobalPicker(catId) {
  if (!schema || typeof schema !== "object" || !("categories" in schema)) return;
  const cats = schema.categories;
  const items = asItemList(cats?.[catId]);
  pickerContext = { type: "global", id: catId };

  const fallback = DEFAULT_VALUES[catId] || "По умолчанию";
  showPickerModal(globalCategoryTitle(catId), items, selections[catId], fallback);
}

function openHeroPicker(heroId, slot) {
  const heroData = getHeroSlots(heroId);
  if (!heroData) return;
  const items = asItemList(heroData[slot]);
  pickerContext = { type: "hero", hero: heroId, slot };

  showPickerModal(slot, items, selections[`${heroId}_${slot}`], "Стандарт");
}

function applyPick(id) {
  if (!pickerContext) return;

  if (pickerContext.type === "global") {
    if (!id) delete selections[pickerContext.id];
    else selections[pickerContext.id] = id;
  } else if (pickerContext.type === "hero") {
    const key = `${pickerContext.hero}_${pickerContext.slot}`;
    if (!id) delete selections[key];
    else selections[key] = id;
  } else if (pickerContext.type === "effect") {
    const key = `${pickerContext.hero}_${pickerContext.slot}_effect`;
    if (!id) delete selections[key];
    else selections[key] = id;
  }

  saveSelectionsLocal();
  updateUI();
  closePicker();
  setApplyVpkState(false);
  clearActivePreset();
}

function updateUI() {
  updateGlobalTiles();
  updateHeroHeader();
  const heroId = selections.current_hero;
  if (heroId) {
    renderHeroSlots(heroId);
  } else {
    const area = el("hero-slots-area");
    if (area) {
      area.hidden = true;
      area.innerHTML = "";
    }
  }
  // Рендерим для окна "Галерея" (текущие изменения)
  renderGallery("main-gallery-area", selections, "Вы пока не выбрали ни одного нестандартного предмета.");
}

function getDefaultItemId(hero, slot) {
  if (!schema || !schema.effect_targets) return null;
  const heroNameLower = hero.replace(/_/g, " ").toLowerCase();

  const target = schema.effect_targets.find(t => {
    const tName = t.name.toLowerCase();
    if (!tName.includes(heroNameLower)) return false;

    if (tName.includes(`(${slot.toLowerCase()})`)) return true;
    if (slot.toLowerCase() === "weapon" && tName.includes("(unknown)")) return true;

    return false;
  });

  return target ? target.id : null;
}

async function saveToAgent() {
  setSaveStatus("Создание VPK...", undefined);
  const base = getAgentBaseUrl();
  if (!base) {
    setSaveStatus("Задай порт на главной (шестерёнка).", "err");
    return;
  }

  const path = "/bridge/action/mastervpk";
  const url = joinUrl(base, path);

  const formattedSelections = {
    skin_changer: {},
    effect_targets: {}
  };

  const globalCats = getGlobalCategoryIds();

  for (const [key, val] of Object.entries(selections)) {
    if (!val) continue;

    if (key === "current_hero" || globalCats.includes(key)) {
      formattedSelections[key] = val;
    } else if (schema && schema.skin_changer) {
      for (const hero of Object.keys(schema.skin_changer)) {
        const prefix = `${hero}_`;
        if (key.startsWith(prefix)) {
          const isEffect = key.endsWith("_effect");
          const slot = isEffect ? key.substring(prefix.length, key.length - 7) : key.substring(prefix.length);
          const heroLower = hero.toLowerCase();

          if (!formattedSelections.skin_changer[heroLower]) {
            formattedSelections.skin_changer[heroLower] = {};
          }
          if (!formattedSelections.skin_changer[heroLower][slot]) {
            formattedSelections.skin_changer[heroLower][slot] = { id: "", style: 1 };
          }

          if (isEffect) {
            formattedSelections.skin_changer[heroLower][slot]._effect = val;
          } else {
            formattedSelections.skin_changer[heroLower][slot].id = val;
          }
          break;
        }
      }
    }
  }

  if (schema && schema.skin_changer) {
    for (const heroLower of Object.keys(formattedSelections.skin_changer)) {
      const origHero = Object.keys(schema.skin_changer).find(h => h.toLowerCase() === heroLower);
      if (!origHero) continue;

      const slots = formattedSelections.skin_changer[heroLower];
      for (const [slot, data] of Object.entries(slots)) {

        if (data._effect) {
          const defaultId = getDefaultItemId(origHero, slot);
          if (defaultId) {
            formattedSelections.effect_targets[defaultId] = data._effect;
          }
        }

        delete data._effect;

        if (!data.id) {
          delete slots[slot];
        }
      }

      if (Object.keys(slots).length === 0) {
        delete formattedSelections.skin_changer[heroLower];
      }
    }
  }

  if (Object.keys(formattedSelections.skin_changer || {}).length === 0) delete formattedSelections.skin_changer;
  if (Object.keys(formattedSelections.effect_targets || {}).length === 0) delete formattedSelections.effect_targets;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(formattedSelections),
    });

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (res.ok) {
      setSaveStatus(prettySaveMessage("VPK Создан", true), "ok");
      setApplyVpkState(true);
    } else {
      setSaveStatus(`Ошибка ${res.status}: ${prettySaveMessage(data, false)}`, "err");
    }
  } catch (e) {
    setSaveStatus(
      e instanceof Error ? e.message : "Агент недоступен (сеть / CORS).",
      "err"
    );
  }
}

async function applyVpk() {
  setSaveStatus("Установка VPK...", undefined);
  const base = getAgentBaseUrl();
  if (!base) {
    setSaveStatus("Задай порт на главной (шестерёнка).", "err");
    return;
  }
  const path = "/bridge/action/applyvpk";
  const url = joinUrl(base, path);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (res.ok) {
      setSaveStatus(prettySaveMessage("VPK Установлен", true), "ok");
    } else {
      setSaveStatus(`Ошибка ${res.status}: ${prettySaveMessage(data, false)}`, "err");
    }
  } catch (e) {
    setSaveStatus(
      e instanceof Error ? e.message : "Агент недоступен (сеть / CORS).",
      "err"
    );
  }
}

function onDocumentKeydown(e) {
  if (e.key !== "Escape") return;

  const galleryModal = el("gallery-section");
  if (galleryModal && !galleryModal.hidden) {
    galleryModal.hidden = true;
    document.body.style.overflow = ""; // Сбрасываем скролл
    return;
  }

  const presetsModal = el("presets-section");
  if (presetsModal && !presetsModal.hidden) {
    presetsModal.hidden = true;
    return;
  }

  const modal = el("picker-modal");
  if (modal && !modal.hidden) {
    closePicker();
    return;
  }
  setHeroListOpen(false);
}

function onModalBackdropClick(e) {
  if (e.target === el("picker-modal")) closePicker();
}

function wireEvents() {
  el("btn-save-all")?.addEventListener("click", () => void saveToAgent());
  el("btn-apply-all")?.addEventListener("click", () => void applyVpk());

// Кнопка открытия/закрытия Галереи
  el("btn-open-gallery")?.addEventListener("click", () => {
    const section = el("gallery-section");
    if (section) {
      if (section.hidden) {
        // Если закрыта -> Открываем
        section.hidden = false;
        document.body.style.overflow = "hidden"; // Блокируем скролл сайта
        renderGallery("main-gallery-area", selections, "Вы пока не выбрали ни одного нестандартного предмета.");
      } else {
        // Если открыта -> Закрываем
        section.hidden = true;
        document.body.style.overflow = ""; // Возвращаем скролл
      }
    }
  });

  // Кнопка открытия Пресетов
  el("btn-open-presets")?.addEventListener("click", () => {
    const presetsSection = el("presets-section");
    if (presetsSection) {
      if (presetsSection.hidden) {
        presetsSection.hidden = false;
        const select = el("preset-select");
        if (select instanceof HTMLSelectElement) {
           renderPresetPreview(select.value);
        }
      } else {
        presetsSection.hidden = true;
      }
    }
  });

  // Закрытие Пресетов по фону
  el("presets-section")?.addEventListener("click", (e) => {
    if (e.target === el("presets-section")) {
      el("presets-section").hidden = true;
    }
  });

  el("btn-preset-save")?.addEventListener("click", savePresetFromInput);
  el("btn-preset-load")?.addEventListener("click", loadSelectedPreset);
  el("btn-preset-delete")?.addEventListener("click", deleteSelectedPreset);
  el("btn-reset-all")?.addEventListener("click", () => {
    resetSelectionsToDefault();
    setPresetStatus("Текущий выбор сброшен до стандартного.", "ok");
  });
  el("preset-select")?.addEventListener("change", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (!target.value) return;
    localStorage.setItem(LS_ACTIVE_PRESET, target.value);
    renderPresetPreview(target.value);
  });
  el("preset-name")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      savePresetFromInput();
    }
  });

  el("btn-toggle-hero")?.addEventListener("click", () => {
    const list = el("hero-drop-list");
    const open = list?.hidden ?? true;
    setHeroListOpen(open);
    if (open) renderHeroGrid();
  });

  el("hero-search")?.addEventListener("input", () => renderHeroGrid());

  el("global-grid")?.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    const toggler = t.closest("[data-toggle-global-section]");
    if (toggler && toggler instanceof HTMLElement) {
      const key = toggler.dataset.toggleGlobalSection;
      if (!key) return;
      collapsedGlobalSections[key] = !collapsedGlobalSections[key];
      saveGlobalSectionState();
      renderGlobalGrid();
      updateGlobalTiles();
      return;
    }

    const btn = t.closest("[data-open-picker]");
    if (!btn || !(btn instanceof HTMLElement)) return;
    const id = btn.dataset.openPicker;
    if (id) openGlobalPicker(id);
  });

  el("hero-grid")?.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const chip = t.closest("[data-hero]");
    if (!chip || !(chip instanceof HTMLElement)) return;
    const h = chip.dataset.hero;
    if (!h) return;
    selections.current_hero = h;
    saveSelectionsLocal();
    setHeroListOpen(false);
    updateUI();
    clearActivePreset();
  });

  el("hero-slots-area")?.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    const btnEff = t.closest("[data-open-effect-picker]");
    if (btnEff && btnEff instanceof HTMLElement) {
      const hero = btnEff.dataset.hero;
      const slot = btnEff.dataset.slot;
      if (hero && slot) {
         const items = getEffectsList();
         pickerContext = { type: "effect", hero, slot };
         showPickerModal(`Эффект: ${slot}`, items, selections[`${hero}_${slot}_effect`], "Без эффекта");
      }
      return;
    }

    const btn = t.closest("[data-open-hero-picker]");
    if (!btn || !(btn instanceof HTMLElement)) return;
    const hero = btn.dataset.hero;
    const slot = btn.dataset.slot;
    if (hero && slot) openHeroPicker(hero, slot);
  });

  el("modal-item-list")?.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const opt = t.closest("[data-pick-id]");
    if (!opt || !(opt instanceof HTMLElement)) return;
    const raw = opt.dataset.pickId;
    applyPick(raw === undefined || raw === "" ? "" : raw);
  });

  el("btn-close-picker")?.addEventListener("click", () => closePicker());
  el("picker-modal")?.addEventListener("click", onModalBackdropClick);
  el("btn-export-gallery")?.addEventListener("click", () => void exportGalleryImages());

  document.addEventListener("keydown", onDocumentKeydown);
}

async function exportGalleryImages() {
  if (typeof html2canvas === "undefined") {
    alert("Библиотека html2canvas не загружена. Проверьте подключение в HTML.");
    return;
  }

  const btn = el("btn-export-gallery");
  if (!btn) return;

  const originalText = btn.textContent;
  btn.textContent = "Создание...";
  btn.disabled = true;

  // Ультимативный фикс: качаем картинку как бинарный файл и переводим в Base64.
  // Это полностью исключает ошибки отрисовки в Canvas.
async function getBase64Image(url) {
    try {
      // Генерируем уникальный URL, чтобы браузер и R2 отдали свежий файл с CORS
      const bustUrl = url.includes('?') ? `${url}&nocache=${Date.now()}` : `${url}?nocache=${Date.now()}`;
      
      const res = await fetch(bustUrl, { mode: 'cors' });
      if (!res.ok) throw new Error("HTTP " + res.status);
      
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn("Ошибка загрузки (CORS/Сеть):", url, e);
      // Если все же ошибка, отдаем прозрачный пиксель, чтобы не "пачкать" холст
      return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    }
  }

  try {
    const { globals, heroesData } = buildGalleryData(selections);
    const heroKeys = Object.keys(heroesData).sort();

    if (globals.length === 0 && heroKeys.length === 0) {
      alert("Нет выбранных предметов для экспорта.");
      return;
    }

    const ITEMS_PER_PAGE = 8; 
    const pages = [];
    let currentPage = [];

    if (globals.length > 0) {
      currentPage.push({ title: "Глобальные предметы", data: globals, isGlobal: true });
    }

    for (const h of heroKeys) {
      if (currentPage.length >= ITEMS_PER_PAGE) {
        pages.push(currentPage);
        currentPage = [];
      }
      currentPage.push({ title: h.replace(/_/g, " "), data: heroesData[h], isGlobal: false });
    }
    if (currentPage.length > 0) {
      pages.push(currentPage);
    }

    for (let i = 0; i < pages.length; i++) {
      const pageData = pages[i];
      const exportContainer = document.createElement("div");
      
      // Размещаем блок прямо в документе, но под основным слоем (z-index: -10)
      exportContainer.style.position = "absolute";
      exportContainer.style.top = "0";
      exportContainer.style.left = "0";
      exportContainer.style.width = "3840px"; 
      exportContainer.style.background = "#0a0a0a";
      exportContainer.style.padding = "2rem";
      exportContainer.style.display = "flex";
      exportContainer.style.flexDirection = "column";
      exportContainer.style.zIndex = "-10";
      
const styleTag = document.createElement("style");
      styleTag.textContent = `
        /* Темный фон рядов */
        .export-row { background: #1a1a1a; border-bottom: 4px solid #000; width: 100%; display: flex; flex-direction: column; margin-bottom: 0; }
        
        /* Серая полоса с именем героя (как на скрине) */
        .export-header { background: #333333; padding: 1.2rem 2rem; text-align: center; font-family: 'IBM Plex Sans', sans-serif; font-weight: 700; font-size: 2.2rem; color: #ffffff; text-transform: uppercase; letter-spacing: 0.08em; border-top: 2px solid #4a4a4a; border-bottom: 2px solid #111; box-shadow: inset 0 0 10px rgba(0,0,0,0.3); }
        .export-header.global { color: #3fb950; background: #223322; border-top-color: #2a4a2a; }
        
        /* flex-wrap: nowrap - строго в одну линию! */
        .export-items { display: flex; flex-wrap: nowrap; justify-content: center; gap: 2rem; padding: 3rem 1rem; }
        
        /* Огромные карточки (320px) */
        .export-card { width: 320px; display: flex; flex-direction: column; align-items: center; gap: 1rem; flex-shrink: 0; }
        
        /* Рамка картинки: 320x213px (пропорции Доты) */
        .export-img-wrap { width: 320px; height: 213px; background: #0a0a0a; border: 3px solid #555; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; position: relative; box-shadow: 0 6px 16px rgba(0,0,0,0.4); }
        .export-img-wrap.effect { border-color: rgba(63, 185, 80, 0.9); box-shadow: 0 0 24px rgba(63, 185, 80, 0.4); }
        .export-img { width: 100%; height: 100%; object-fit: cover; }
        
        /* Крупный текст названия слота */
        .export-label { font-family: 'IBM Plex Sans', sans-serif; font-size: 1.6rem; font-weight: 600; color: #b0b0b0; text-transform: uppercase; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
        
        /* Вотермарка внизу */
        .export-watermark { text-align: center; padding: 2.5rem 0; font-family: 'IBM Plex Mono', monospace; color: #555; font-size: 2rem; background: #0a0a0a; font-weight: 600; }
      `;
      exportContainer.appendChild(styleTag);

      const watermark = document.createElement("div");
      watermark.className = "export-watermark";
      watermark.textContent = `@DeadSouls_VPK | ItemSettings (Часть ${i + 1} из ${pages.length})`;
      exportContainer.appendChild(watermark);

      // Массив для ожидания загрузки всех картинок
      const imagePromises = [];

      for (const section of pageData) {
        const row = document.createElement("div");
        row.className = "export-row";

        const header = document.createElement("div");
        header.className = `export-header ${section.isGlobal ? "global" : ""}`;
        header.textContent = section.title;
        row.appendChild(header);

        const itemsFlex = document.createElement("div");
        itemsFlex.className = "export-items";

        for (const item of section.data) {
          const card = document.createElement("div");
          card.className = "export-card";

          const imgWrap = document.createElement("div");
          imgWrap.className = `export-img-wrap ${item.isEffect ? "effect" : ""}`;

          if (item.url) {
            const img = document.createElement("img");
            img.className = "export-img";
            
            // Превращаем ссылку в Base64 перед вставкой в тег
            const promise = getBase64Image(item.url).then(b64 => {
              img.src = b64;
              return new Promise(res => {
                img.onload = res;
                img.onerror = res;
              });
            });
            imagePromises.push(promise);

            imgWrap.appendChild(img);
          } else {
            imgWrap.innerHTML = `<span style="font-size:5rem;color:#8b949e;">${item.isEffect ? "✨" : "?"}</span>`;
          }

          const label = document.createElement("div");
          label.className = "export-label";
          label.textContent = item.slotName;

          card.appendChild(imgWrap);
          card.appendChild(label);
          itemsFlex.appendChild(card);
        }
        row.appendChild(itemsFlex);
        exportContainer.appendChild(row);
      }

      document.body.appendChild(exportContainer);

      // Строго ждем, пока все картинки конвертируются в Base64 и отрисуются
      await Promise.all(imagePromises);
      await new Promise(res => setTimeout(res, 300));

      const canvas = await html2canvas(exportContainer, {
        backgroundColor: "#0a0a0a",
        scale: 2, 
        useCORS: true, 
        logging: false
      });

      document.body.removeChild(exportContainer);

      const link = document.createElement("a");
      link.download = `deadsouls_loadout_part_${i + 1}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();

      await new Promise(res => setTimeout(res, 800));
    }

  } catch (err) {
    console.error(err);
    alert("Произошла ошибка при создании скриншотов.");
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function getEffectsList() {
  if (!schema || typeof schema !== "object" || !("effects" in schema)) return [];
  const effs = schema.effects;
  if (!Array.isArray(effs)) return [];

  return effs.map((e) => ({
    id: e.path,
    name: e.name
  }));
}

async function init() {
  setApplyVpkState(false);

  loadSelections();
  loadPresets();
  loadGlobalSectionState();
  wireEvents();

  try {
    const resCustom = await fetch(CUSTOM_IMAGES_URL);
    if (resCustom.ok) {
      customImages = await resCustom.json();
    }
  } catch {
    console.log("Кастомные картинки не найдены, используем стандартные.");
  }

  try {
    const res = await fetch(SCHEMA_URL);
    if (!res.ok) {
      setSaveStatus(`Схема: HTTP ${res.status}`, "err");
      return;
    }
    schema = await res.json();
  } catch {
    setSaveStatus("Не удалось загрузить website_schema.json", "err");
    return;
  }

  renderGlobalGrid();
  renderPresetSelect();
  updateUI();
}

init();