// panel.js — выбор из website_schema.json и POST на локальный агент

const SCHEMA_URL = "https://cdn.deadsouls.cc/website/data/website_schema.json";
const CUSTOM_IMAGES_URL = "/data/custom_images.json";
const VALVE_HERO_RENDERS_CDN_URL = window.APP_CONFIG.VALVE_HERO_RENDERS_CDN_URL;
const CDN_URL = window.APP_CONFIG.CDN_URL;
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

// --- КЭШИРОВАНИЕ ДАННЫХ (JSON) ---
const CACHE_NAME = 'deadsouls-schema-v1';
const CACHE_TTL = 1000 * 60 * 60 * 6; // 6 часов

async function fetchCachedJson(url) {
  const cacheKey = `ds_cache_time_${url}`;
  const now = Date.now();
  const cachedTime = localStorage.getItem(cacheKey);

  try {
    if ('caches' in window) {
      const cache = await caches.open(CACHE_NAME);
      if (cachedTime && (now - parseInt(cachedTime)) < CACHE_TTL) {
        const cachedResponse = await cache.match(url);
        if (cachedResponse) return await cachedResponse.json();
      }
      const response = await fetch(url);
      if (response.ok) {
        cache.put(url, response.clone());
        localStorage.setItem(cacheKey, now.toString());
        return await response.json();
      }
    }
  } catch (e) {
    console.warn("[Cache Error] Ошибка кэширования JSON:", e);
  }
  const fallbackResponse = await fetch(url);
  if (fallbackResponse.ok) return await fallbackResponse.json();
  return null;
}

// --- КЭШИРОВАНИЕ КАРТИНОК ---
const IMAGE_CACHE_NAME = 'deadsouls-images-v1';
const blobCache = new Map();

async function applyCachedImage(imgElement, url) {
  if (!url) {
    imgElement.hidden = true;
    imgElement.removeAttribute("src");
    return;
  }

  imgElement.dataset.loadingUrl = url;

  if (blobCache.has(url)) {
    if (imgElement.src !== blobCache.get(url)) {
      imgElement.src = blobCache.get(url);
      imgElement.hidden = false;
    }
    return;
  }

  try {
    if ('caches' in window) {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      const cachedResponse = await cache.match(url);

      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        const objectUrl = URL.createObjectURL(blob);
        blobCache.set(url, objectUrl);

        if (imgElement.dataset.loadingUrl === url && imgElement.src !== objectUrl) {
          imgElement.src = objectUrl;
          imgElement.hidden = false;
        }
        return;
      }

      if (imgElement.dataset.loadingUrl === url && imgElement.src !== url) {
        imgElement.src = url;
        imgElement.hidden = false;
      }

      fetch(url, { mode: 'cors' }).then(async (res) => {
        if (res.ok) {
          cache.put(url, res.clone());
          const blob = await res.blob();
          blobCache.set(url, URL.createObjectURL(blob));
        }
      }).catch(() => {});

      return;
    }
  } catch (e) {}

  if (imgElement.dataset.loadingUrl === url && imgElement.src !== url) {
    imgElement.src = url;
    imgElement.hidden = false;
  }
}

const RARITY_COLORS = {
  "common": "#b0c3d9", "uncommon": "#5e98d9", "rare": "#4b69ff", "mythical": "#8847ff",
  "legendary": "#d32ce6", "ancient": "#eb4b4b", "immortal": "#e4ae39", "arcana": "#ade55c",
  "strange": "#CF6A32", "seasonal": "#FFF34F"
};

const DEFAULT_VALUES = {
  ancients: "Default Ancient", announcers: "Default Announcer", couriers: "Default Courier",
  current_hero: "Abaddon", cursors: "Default Cursor Pack", dire_creep: "Default Dire Creeps",
  dire_towers: "Default Dire Towers", emblems: "Default Emblem", huds: "Default Hud Skin",
  kill_banners: "Default Kill Banners", killstreaks: "Default KillStreak", loading_screens: "Default Loading Screen",
  megakills: "Default Mega-Kill Announcer", music_packs: "Default Music", rad_creep: "Default Radiant Creeps",
  rad_towers: "Default Radiant Towers", river_vials: "River Vial: Default", roshans: "Default Roshan",
  shaders: "Default Shaders", terrains: "Default Terrain", tormentors: "Default Tormentor",
  versus_screens: "Default Versus Screen", wards: "Default Ward", weathers: "Default Weather"
};

function globalCategoryTitle(catId) {
  return window.t('cat_' + catId) || catId.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const GLOBAL_SECTION_LAYOUT = [
  { titleKey: "cat_sound", items: ["music_packs", "announcers", "megakills"] },
  { titleKey: "cat_interface", items: ["loading_screens", "versus_screens", "huds", "killstreaks", "cursors",  "kill_banners"] },
  { titleKey: "cat_env", items: ["couriers", "wards", "terrains", "dire_creep", "rad_creep", "dire_towers", "rad_towers", "ancients", "roshans", "tormentors", "shaders", "weathers", "emblems", "river_vials"] }
];

function getItemColor(item) {
  if (!item || !item.item_rarity) return "";
  return RARITY_COLORS[item.item_rarity.toLowerCase()] || "";
}

function getCategoriesRecord() {
  if (!schema || typeof schema !== "object" || !("categories" in schema)) return null;
  return schema.categories;
}

function getGlobalCategoryIds() {
  const cats = getCategoriesRecord();
  if (!cats) return [];
  return Object.keys(cats).filter((k) => Array.isArray(cats[k]));
}

function getConfiguredGlobalSections() {
  const available = new Set(getGlobalCategoryIds());
  const used = new Set();
  const sections = [];

  for (const section of GLOBAL_SECTION_LAYOUT) {
    const items = section.items.filter((id) => available.has(id) && !used.has(id));
    for (const id of items) used.add(id);
    if (items.length) sections.push({ title: window.t(section.titleKey), items });
  }

  const uncategorized = [...available].filter((id) => !used.has(id)).sort((a, b) => a.localeCompare(b, "en"));
  if (uncategorized.length) sections.push({ title: window.t('cat_other'), items: uncategorized });
  return sections;
}

function loadGlobalSectionState() {
  try {
    const raw = localStorage.getItem(LS_GLOBAL_COLLAPSED);
    collapsedGlobalSections = raw ? JSON.parse(raw) : {};
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
  val.textContent = DEFAULT_VALUES[catId] || window.t('default_val');

  const thumb = document.createElement("img");
  thumb.className = "tile-thumb";
  thumb.id = `thumb-${catId}`;
  thumb.hidden = true;

  btn.append(lab, val, thumb);
  return btn;
}

function buildGalleryData(sourceData) {
  const globals = [];
  const heroesData = {};

  if (!schema || typeof schema !== "object") return { globals, heroesData };

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
          isEffect: false,
          color: getItemColor(item)
        });
      }
    }
  }

  if (schema.skin_changer) {
    for (const hero of Object.keys(schema.skin_changer)) {
      const heroData = schema.skin_changer[hero];
      const currentPersona = String(sourceData[`${hero}_active_persona`] || "0");

      for (const slot of Object.keys(heroData)) {
        if (slot === "persona_selector") continue;

        const isPersonaMatch = slot.match(/_persona_(\d+)$/i);
        if (currentPersona === "0") {
          if (isPersonaMatch) continue;
        } else {
          if (!isPersonaMatch || isPersonaMatch[1] !== currentPersona) continue;
        }

        const selectedItemId = sourceData[`${hero}_${slot}`];
        const selectedEffId = sourceData[`${hero}_${slot}_effect`];

        if (selectedItemId || selectedEffId) {
          if (!heroesData[hero]) heroesData[hero] = [];
          const visualSlotName = slot.replace(/_persona_\d+$/i, "").replace(/_/g, " ");

          if (selectedItemId) {
            const items = asItemList(heroData[slot]);
            const item = items.find((i) => i.id === selectedItemId);

            let imgUrl = getItemImageUrl(item);
            if (!imgUrl) {
               const baseUrl = CDN_URL ? CDN_URL.replace(/\/+$/, "") : "https://cdn.deadsouls.cc";
               imgUrl = `${baseUrl}/econ/default_no_item.webp`;
            }

            heroesData[hero].push({
              slotName: visualSlotName,
              itemName: item ? item.name : window.t('default_item'),
              url: imgUrl,
              isEffect: false,
              color: getItemColor(item)
            });
          }

          if (selectedEffId) {
            const effList = getEffectsList();
            const effItem = effList.find((e) => e.id === selectedEffId);
            heroesData[hero].push({
              slotName: visualSlotName,
              itemName: effItem ? `✨ ${effItem.name}` : window.t('unknown_effect'),
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

      const imgWrap = document.createElement("div");
      imgWrap.className = "summary-img-wrap";
      if (item.isEffect) imgWrap.classList.add("effect-border");

      if (item.color) {
        imgWrap.style.borderColor = item.color;
        imgWrap.style.boxShadow = `0 0 12px ${item.color}33`;
      }

      if (item.url) {
        const img = document.createElement("img");
        img.className = "summary-item-img";
        applyCachedImage(img, item.url);
        img.alt = item.itemName;

        img.onerror = () => {
          imgWrap.innerHTML = "";
          const ph = document.createElement("div");
          ph.className = "summary-item-placeholder";
          ph.textContent = "?";
          imgWrap.appendChild(ph);
        };
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

  const globalsRow = buildRow(window.t('global_items'), globals, true);
  if (globalsRow) frag.appendChild(globalsRow);

  const heroesKeys = Object.keys(heroesData).sort();
  for (const h of heroesKeys) {
    const hRow = buildRow(h.replace(/_/g, " "), heroesData[h]);
    if (hRow) frag.appendChild(hRow);
  }

  container.appendChild(frag);
}

function renderPresetPreview(presetName) {
  let presetData = (!presetName || !presets[presetName]) ? selections : presets[presetName];
  const msg = (!presetName || !presets[presetName])
    ? window.t('empty_gallery')
    : window.t('preset_no_custom');
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

    const headingText = document.createElement("span");
    headingText.textContent = section.title;
    const chevron = document.createElement("span");
    chevron.className = "global-subsection-chevron";
    chevron.textContent = "▸";
    heading.append(headingText, chevron);

    const grid = document.createElement("div");
    grid.className = "global-grid-inner";
    if (isCollapsed) grid.hidden = true;
    for (const catId of section.items) grid.appendChild(buildGlobalTile(catId));

    block.append(heading, grid);
    frag.appendChild(block);
  }
  root.appendChild(frag);
}

function loadSelections() {
  try {
    const raw = localStorage.getItem(LS_SELECTIONS);
    selections = raw ? JSON.parse(raw) : {};
  } catch { selections = {}; }
  if (!selections.kinetics) selections.kinetics = {};
  if (!selections.current_hero) selections.current_hero = DEFAULT_VALUES.current_hero;
}

function saveSelectionsLocal() {
  localStorage.setItem(LS_SELECTIONS, JSON.stringify(selections));
}

function getAgentBaseUrl() {
  const host = localStorage.getItem(LS_HOST)?.trim() || "127.0.0.1";
  const port = parseInt(localStorage.getItem(LS_PORT)?.trim() || "3847", 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return "";
  return `http://${host}:${port}`;
}

let saveTimeoutId = null;
function setSaveStatus(text, kind) {
  const node = el("save-status");
  if (!node) return;
  node.textContent = text;
  node.classList.remove("ok", "err");
  if (kind) node.classList.add(kind);

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
  btn.style.opacity = isEnabled ? "1" : "0.5";
  btn.style.cursor = isEnabled ? "pointer" : "not-allowed";
}

function setSaveButtonState(isBuilding) {
  const btn = el("btn-save-all");
  if (!btn) return;
  btn.disabled = isBuilding;
  btn.style.opacity = isBuilding ? "0.5" : "1";
  btn.style.cursor = isBuilding ? "wait" : "pointer";
  btn.textContent = isBuilding ? window.t('vpk_building') : window.t('create_vpk');
}

function setPresetStatus(text, kind) { setSaveStatus(text, kind); }

function cloneSelections(source) { return JSON.parse(JSON.stringify(source)); }

function loadPresets() {
  try {
    const raw = localStorage.getItem(LS_PRESETS);
    presets = raw ? JSON.parse(raw) : {};
  } catch { presets = {}; }
}

function savePresetsLocal() { localStorage.setItem(LS_PRESETS, JSON.stringify(presets)); }

function renderPresetSelect() {
  const select = el("preset-select");
  if (!select) return;
  const active = localStorage.getItem(LS_ACTIVE_PRESET) || "";
  const names = Object.keys(presets).sort();
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = names.length ? window.t('preset_current') : window.t('presets_empty');
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
  if (select) {
    select.value = "";
    renderPresetPreview("");
  }
}

function savePresetFromInput() {
  const input = el("preset-name");
  const name = input.value.trim().replace(/\s+/g, " ").slice(0, 48);
  if (!name) return setPresetStatus(window.t('preset_enter_name'), "err");

  presets[name] = cloneSelections(selections);
  savePresetsLocal();
  localStorage.setItem(LS_ACTIVE_PRESET, name);
  renderPresetSelect();
  input.value = "";
  setPresetStatus(window.t('preset_saved').replace('{name}', name), "ok");
}

function loadSelectedPreset() {
  const select = el("preset-select");
  const name = select?.value;
  if (!name || !presets[name]) return setPresetStatus(window.t('preset_select_req'), "err");

  selections = cloneSelections(presets[name]);
  if (!selections.current_hero) selections.current_hero = DEFAULT_VALUES.current_hero;
  saveSelectionsLocal();
  localStorage.setItem(LS_ACTIVE_PRESET, name);
  updateUI();
  setPresetStatus(window.t('preset_loaded').replace('{name}', name), "ok");
  setApplyVpkState(false);
}

function deleteSelectedPreset() {
  const select = el("preset-select");
  const name = select?.value;
  if (!name || !presets[name]) return setPresetStatus(window.t('preset_none_delete'), "err");

  delete presets[name];
  savePresetsLocal();
  if (localStorage.getItem(LS_ACTIVE_PRESET) === name) localStorage.removeItem(LS_ACTIVE_PRESET);
  renderPresetSelect();
  setPresetStatus(window.t('preset_deleted').replace('{name}', name), "ok");
}

function exportSelectedPreset() {
  const select = el("preset-select");
  if (!select) return;
  const name = select.value;

  if (!name || !presets[name]) {
    setSaveStatus(window.t('preset_select_dl'), "err");
    return;
  }

  const dataStr = JSON.stringify(presets[name], null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;

  const safeName = name.replace(/[^a-zа-я0-9_\-\s]/gi, '').trim() || "export";
  link.download = `deadsouls.${safeName}.preset`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  setSaveStatus(window.t('preset_downloaded').replace('{name}', name), "ok");
}

function setupDragAndDrop() {
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      document.body.classList.add('drag-over-active');
    }
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (!e.relatedTarget || e.relatedTarget.nodeName === "HTML") {
       document.body.classList.remove('drag-over-active');
    }
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over-active');

    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    const file = e.dataTransfer.files[0];

    if (!file.name.endsWith('.preset')) {
      setSaveStatus(window.t('invalid_format'), "err");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        let presetName = file.name.replace(/^deadsouls\./i, '').replace(/\.preset$/i, '');
        if (!presetName) presetName = "Imported";

        presets[presetName] = data;
        savePresetsLocal();
        renderPresetSelect();

        const select = el("preset-select");
        if (select) {
          select.value = presetName;
          localStorage.setItem(LS_ACTIVE_PRESET, presetName);
          renderPresetPreview(presetName);
        }

        setSaveStatus(window.t('preset_imported').replace('{name}', presetName), "ok");

        const presetsSection = el("presets-section");
        if (presetsSection && presetsSection.hidden) {
           presetsSection.hidden = false;
        }
      } catch (err) {
        setSaveStatus(window.t('preset_corrupted'), "err");
      }
    };
    reader.readAsText(file);
  });
}

function setHeroListOpen(open) {
  const list = el("hero-drop-list");
  if (list) list.hidden = !open;
}

function setPickerOpen(open) {
  const modal = el("picker-modal");
  if (modal) {
    modal.hidden = !open;
    if (open) el("item-search")?.focus();
  }
}

function closePicker() {
  pickerContext = null;
  setPickerOpen(false);
}

function asItemList(cat) { return Array.isArray(cat) ? cat : []; }

function getItemImageUrl(item) {
  if (!item) return "";
  let path = item.image_inventory;
  const override = customImages[item.name] || customImages[item.id];
  if (override?.image_inventory) path = override.image_inventory;
  if (!path) return "";
  const base = CDN_URL.replace(/\/+$/, "");
  return `${base}/${encodeURI(path)}.webp`;
}

function updateGlobalTiles() {
  for (const cat of getGlobalCategoryIds()) {
    const node = el(`val-${cat}`);
    const thumb = el(`thumb-${cat}`);
    if (!schema || typeof schema !== "object" || !("categories" in schema)) continue;

    const list = asItemList(schema.categories[cat]);
    const selId = selections[cat];
    let item = selId ? list.find((i) => i.id === selId) : list.find((i) => i.name === DEFAULT_VALUES[cat]);

    if (node) {
      node.textContent = item ? item.name : (DEFAULT_VALUES[cat] || window.t('default_val'));
      node.style.color = getItemColor(item);
    }

    if (thumb) {
      const url = getItemImageUrl(item);
      if (url) {
        applyCachedImage(thumb, url);
        thumb.alt = item?.name ?? "";
      } else {
        thumb.hidden = true;
        thumb.removeAttribute("src");
      }
    }
  }
}

function updateHeroHeader() {
  const nameEl = el("current-hero-name");
  const preview = el("hero-preview-video");
  const heroId = selections.current_hero;

  if (!heroId) {
    if (nameEl) nameEl.textContent = window.t('select_hero');
    if (preview) { preview.removeAttribute("src"); preview.load(); }
    return;
  }

  if (nameEl) nameEl.textContent = heroId.replace(/_/g, " ");
  if (preview) {
    const src = `${VALVE_HERO_RENDERS_CDN_URL}/${heroId.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")}.webm`;
    if (preview.src !== src) { preview.src = src; preview.load(); }
  }
}

function getHeroSlots(heroId) {
  return schema?.skin_changer?.[heroId] || null;
}

function renderHeroSlots(heroId) {
  const area = el("hero-slots-area");
  if (!area) return;
  const heroData = getHeroSlots(heroId);
  if (!heroData) { area.hidden = true; return; }
  area.hidden = false;

  const getPersonaIconUrl = (heroName, personaId) => {
    let name = heroName.toLowerCase().replace(/ /g, "_").replace(/[^a-z0-9_]/g, "");
    const aliases = {
      "zeus": "zuus", "nature's_prophet": "furion", "natures_prophet": "furion",
      "anti_mage": "antimage", "shadow_fiend": "nevermore", "clockwerk": "rattletrap",
      "timbersaw": "shredder", "treant_protector": "treant", "doom": "doom_bringer",
      "lifestealer": "life_stealer", "magnus": "magnataur", "outworld_destroyer": "obsidian_destroyer",
      "outworld_devourer": "obsidian_destroyer", "wraith_king": "skeleton_king",
      "underlord": "abyssal_underlord", "vengeful_spirit": "vengefulspirit",
      "windranger": "windrunner", "centaur_warrunner": "centaur", "necrophos": "necrolyte"
    };
    if (aliases[name]) name = aliases[name];
    const baseUrl = CDN_URL ? CDN_URL.replace(/\/+$/, "") : "https://cdn.deadsouls.cc";
    return personaId === "0" ? `${baseUrl}/econ/icons/npc_dota_hero_${name}_png.png` : `${baseUrl}/econ/icons/npc_dota_hero_${name}_persona${personaId}_png.png`;
  };

  const availablePersonas = new Set();
  let hasBaseSlots = false;

  for (const slot of Object.keys(heroData)) {
    if (slot === "persona_selector") continue;
    const match = slot.match(/_persona_(\d+)$/i);
    if (match) availablePersonas.add(match[1]);
    else hasBaseSlots = true;
  }

  let currentPersona = String(selections[`${heroId}_active_persona`] || "0");
  if (currentPersona === "0" && !hasBaseSlots && availablePersonas.size > 0) {
    currentPersona = Array.from(availablePersonas)[0];
  }

  if (area.dataset.hero !== heroId || area.dataset.persona !== currentPersona || area.children.length === 0) {
    area.innerHTML = "";
    area.dataset.hero = heroId;
    area.dataset.persona = currentPersona;
    const frag = document.createDocumentFragment();

    if (availablePersonas.size > 0) {
      const switchWrapper = document.createElement("div");
      switchWrapper.className = "persona-switch-wrapper card";
      switchWrapper.style.gridColumn = "1 / -1";
      switchWrapper.style.display = "flex";
      switchWrapper.style.width = "100%";
      switchWrapper.style.marginBottom = "8px";
      switchWrapper.style.padding = "6px";
      switchWrapper.style.gap = "6px";

      const createPersonaBtn = (id, text) => {
        const isActive = currentPersona === id;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.style.flex = "1";
        btn.style.display = "flex";
        btn.style.alignItems = "center";
        btn.style.justifyContent = "center";
        btn.style.gap = "8px";
        btn.style.borderRadius = "6px";
        btn.style.padding = "8px 16px";
        btn.style.fontWeight = "600";
        btn.style.fontSize = "0.95rem";
        btn.style.transition = "all 0.2s ease";
        btn.style.margin = "0";
        btn.style.border = "none";
        btn.style.cursor = "pointer";

        const icon = document.createElement("img");
        applyCachedImage(icon, getPersonaIconUrl(heroId, id));
        icon.style.height = "22px";
        icon.style.width = "auto";
        icon.style.borderRadius = "3px";
        icon.onerror = () => { icon.style.display = "none"; };

        const span = document.createElement("span");
        span.textContent = text;

        btn.append(icon, span);

        if (isActive) {
          btn.style.background = "rgba(255, 255, 255, 0.15)";
          btn.style.color = "#ffffff";
          btn.style.boxShadow = "0 2px 4px rgba(0,0,0,0.2)";
        } else {
          btn.style.background = "transparent";
          btn.style.color = "#8b949e";
          btn.onmouseover = () => { btn.style.background = "rgba(255, 255, 255, 0.05)"; btn.style.color = "#c9d1d9"; };
          btn.onmouseout = () => { btn.style.background = "transparent"; btn.style.color = "#8b949e"; };
        }

        btn.onclick = () => {
          selections[`${heroId}_active_persona`] = id;
          saveSelectionsLocal();
          updateUI();
          setApplyVpkState(false);
          clearActivePreset();
        };
        return btn;
      };

      if (hasBaseSlots) switchWrapper.appendChild(createPersonaBtn("0", window.t('base_persona')));
      const sortedPersonas = Array.from(availablePersonas).sort((a,b) => Number(a) - Number(b));
      for (const p of sortedPersonas) switchWrapper.appendChild(createPersonaBtn(p, `${window.t('persona_prefix')} ${p}`));

      frag.appendChild(switchWrapper);
    }

    const slotsGrid = document.createElement("div");
    slotsGrid.style.display = "contents";

    for (const slot of Object.keys(heroData)) {
      if (slot === "persona_selector") continue;
      const isPersonaSlotMatch = slot.match(/_persona_(\d+)$/i);

      if (currentPersona === "0") {
        if (isPersonaSlotMatch) continue;
      } else {
        if (!isPersonaSlotMatch || isPersonaSlotMatch[1] !== currentPersona) continue;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "slot-wrapper";
      const safeSlot = slot.replace(/[^a-zA-Z0-9]/g, '_');

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card tile";
      btn.dataset.openHeroPicker = "";
      btn.dataset.hero = heroId;
      btn.dataset.slot = slot;

      const lab = document.createElement("span");
      lab.className = "tile-label";
      lab.textContent = slot.replace(/_persona_\d+$/i, "");

      const val = document.createElement("span");
      val.className = "tile-value";
      val.id = `val-hero-${safeSlot}`;

      const thumb = document.createElement("img");
      thumb.className = "tile-thumb";
      thumb.id = `thumb-hero-${safeSlot}`;
      thumb.loading = "lazy";
      thumb.hidden = true;

      btn.append(lab, val, thumb);

      const effBtn = document.createElement("button");
      effBtn.type = "button";
      effBtn.className = "effect-btn";
      effBtn.dataset.openEffectPicker = "";
      effBtn.dataset.hero = heroId;
      effBtn.dataset.slot = slot;
      effBtn.id = `eff-hero-${safeSlot}`;

      wrapper.append(btn, effBtn);
      slotsGrid.appendChild(wrapper);
    }
    frag.appendChild(slotsGrid);
    area.appendChild(frag);
  }

  for (const slot of Object.keys(heroData)) {
    if (slot === "persona_selector") continue;

    const safeSlot = slot.replace(/[^a-zA-Z0-9]/g, '_');
    const valNode = el(`val-hero-${safeSlot}`);
    const thumbNode = el(`thumb-hero-${safeSlot}`);
    const effNode = el(`eff-hero-${safeSlot}`);

    if (!valNode && !thumbNode && !effNode) continue;

    const list = asItemList(heroData[slot]);
    const selId = selections[`${heroId}_${slot}`];
    let item = selId ? list.find((i) => i.id === selId) : list.find((i) => i.name.toLowerCase().includes("default"));

    if (valNode) {
      valNode.textContent = item ? item.name : window.t('standard');
      valNode.style.color = getItemColor(item);
    }

    if (thumbNode) {
      let url = getItemImageUrl(item);
      if (!url) {
        const baseUrl = CDN_URL ? CDN_URL.replace(/\/+$/, "") : "https://cdn.deadsouls.cc";
        url = `${baseUrl}/econ/default_no_item.webp`;
      }

      thumbNode.onerror = () => { thumbNode.hidden = true; };
      applyCachedImage(thumbNode, url);
      thumbNode.alt = item?.name ?? "";
    }

    if (effNode) {
      const effSelId = selections[`${heroId}_${slot}_effect`];
      const effItem = getEffectsList().find((e) => e.id === effSelId);
      effNode.textContent = effItem ? `✨ ${effItem.name}` : `✨ ${window.t('effect_none')}`;
    }
  }
}

function renderHeroGrid() {
  const grid = el("hero-grid");
  const input = el("hero-search");
  if (!grid || !schema?.skin_changer) return;
  const q = (input?.value ?? "").toLowerCase().trim();
  const heroes = Object.keys(schema.skin_changer).sort();
  grid.innerHTML = "";
  const frag = document.createDocumentFragment();

  const getHeroIconUrl = (heroName) => {
    let name = heroName.toLowerCase().replace(/ /g, "_").replace(/[^a-z0-9_]/g, "");
    const aliases = {
      "zeus": "zuus", "nature's_prophet": "furion", "anti_mage": "antimage", "shadow_fiend": "nevermore",
      "clockwerk": "rattletrap", "timbersaw": "shredder", "treant_protector": "treant", "doom": "doom_bringer",
      "lifestealer": "life_stealer", "magnus": "magnataur", "outworld_destroyer": "obsidian_destroyer",
      "outworld_devourer": "obsidian_destroyer", "wraith_king": "skeleton_king", "underlord": "abyssal_underlord",
      "vengeful_spirit": "vengefulspirit", "windranger": "windrunner", "centaur_warrunner": "centaur", "necrophos": "necrolyte"
    };
    if (aliases[name]) name = aliases[name];
    const baseUrl = CDN_URL ? CDN_URL.replace(/\/+$/, "") : "https://cdn.deadsouls.cc";
    return `${baseUrl}/econ/icons/npc_dota_hero_${name}_png.png`;
  };

  for (const h of heroes) {
    const displayName = h.replace(/_/g, " ");
    if (q && !displayName.toLowerCase().includes(q)) continue;

    const b = document.createElement("button");
    b.type = "button";
    b.className = "hero-chip";
    b.dataset.hero = h;
    b.style.display = "flex"; b.style.alignItems = "center"; b.style.gap = "8px"; b.style.padding = "6px 12px";

    const icon = document.createElement("img");
    applyCachedImage(icon, getHeroIconUrl(h));
    icon.style.height = "24px"; icon.style.width = "auto"; icon.style.borderRadius = "3px";
    icon.onerror = () => { icon.style.display = "none"; };

    const text = document.createElement("span");
    text.textContent = displayName;
    b.append(icon, text);
    frag.appendChild(b);
  }
  grid.appendChild(frag);
}

function showPickerModal(title, items, currentId, defaultText = window.t('default_val')) {
  const titleEl = el("modal-title");
  const list = el("modal-item-list");
  const search = el("item-search");

  if (!titleEl || !list) return;

  titleEl.textContent = title;
  if (search) search.value = "";

  function renderList(query) {
    const q = query.toLowerCase().trim();
    list.innerHTML = "";
    const frag = document.createDocumentFragment();

    if (pickerContext && pickerContext.type !== "global") {
      const noneBtn = document.createElement("button");
      noneBtn.className = "item-option none-opt";

      if (!currentId) noneBtn.classList.add("selected");
      noneBtn.dataset.pickId = "";

      const baseUrl = CDN_URL ? CDN_URL.replace(/\/+$/, "") : "https://cdn.deadsouls.cc";
      const img = document.createElement("img");
      img.className = "item-option-thumb";
      applyCachedImage(img, `${baseUrl}/econ/default_no_item.webp`);

      const label = document.createElement("span");
      label.className = "item-option-label";
      label.textContent = `— ${defaultText} —`;

      noneBtn.append(img, label);
      frag.appendChild(noneBtn);
    }

    for (const i of items) {
      if (q && !i.name.toLowerCase().includes(q)) continue;

      const opt = document.createElement("button");
      opt.className = "item-option";
      if (i.id === currentId) opt.classList.add("selected");
      opt.dataset.pickId = i.id;

      const label = document.createElement("span");
      label.className = "item-option-label";
      label.textContent = i.name;
      label.style.color = getItemColor(i);

      let url = getItemImageUrl(i);

      if (!url && pickerContext && pickerContext.type === "hero") {
        const baseUrl = CDN_URL ? CDN_URL.replace(/\/+$/, "") : "https://cdn.deadsouls.cc";
        url = `${baseUrl}/econ/default_no_item.webp`;
      }

      if (url) {
        const img = document.createElement("img");
        img.className = "item-option-thumb";
        applyCachedImage(img, url);
        opt.append(img, label);
      } else {
        opt.append(label);
      }

      frag.appendChild(opt);
    }

    list.appendChild(frag);
  }

  renderList("");
  if (search) search.oninput = (e) => renderList(e.target.value);

  setPickerOpen(true);
}

function openGlobalPicker(catId) {
  const items = asItemList(schema?.categories?.[catId]);
  pickerContext = { type: "global", id: catId };
  showPickerModal(globalCategoryTitle(catId), items, selections[catId], DEFAULT_VALUES[catId] || window.t('default_val'));
}

function openHeroPicker(heroId, slot) {
  const items = asItemList(getHeroSlots(heroId)?.[slot]);
  pickerContext = { type: "hero", hero: heroId, slot };
  showPickerModal(slot, items, selections[`${heroId}_${slot}`], window.t('standard'));
}

function applyPick(id) {
  if (!pickerContext) return;
  const key = pickerContext.type === "global" ? pickerContext.id
            : pickerContext.type === "effect" ? `${pickerContext.hero}_${pickerContext.slot}_effect`
            : `${pickerContext.hero}_${pickerContext.slot}`;

  if (!id) delete selections[key];
  else selections[key] = id;

  saveSelectionsLocal(); updateUI(); closePicker(); setApplyVpkState(false); clearActivePreset();
}

function renderHeroKinetics(heroId) {
  let kinArea = el("hero-kinetics-area");
  if (!kinArea) {
    kinArea = document.createElement("div");
    kinArea.id = "hero-kinetics-area";
    kinArea.className = "card";
    kinArea.style.marginTop = "16px"; kinArea.style.padding = "16px";
    document.querySelector(".hero-selector-wrapper")?.appendChild(kinArea);
  }
  if (!schema.kinetics) return kinArea.hidden = true;

  const heroNameLower = heroId.replace(/_/g, " ").toLowerCase();
  const kineticHeroKey = Object.keys(schema.kinetics).find(k => k.toLowerCase() === heroNameLower || k.toLowerCase().replace(/ /g, "_") === heroNameLower);

  if (!kineticHeroKey || schema.kinetics[kineticHeroKey].length === 0) return kinArea.hidden = true;
  kinArea.hidden = false;

  const availableGems = schema.kinetics[kineticHeroKey];
  const selectedGems = selections.kinetics?.[kineticHeroKey] || [];

  if (kinArea.dataset.hero !== kineticHeroKey || kinArea.innerHTML === "") {
    kinArea.dataset.hero = kineticHeroKey;
    kinArea.innerHTML = "";
    const headerFlex = document.createElement("div");
    headerFlex.style.display = "flex"; headerFlex.style.justifyContent = "space-between"; headerFlex.style.marginBottom = "12px";
    const title = document.createElement("span"); title.className = "label"; title.textContent = window.t('kinetic_gems');
    const gemIcon = document.createElement("img");
    const baseUrl = CDN_URL ? CDN_URL.replace(/\/+$/, "") : "https://cdn.deadsouls.cc";
    gemIcon.src = `${baseUrl}/econ/gem_animation_png.webp`;
    gemIcon.style.height = "24px"; gemIcon.style.width = "auto";
    headerFlex.append(title, gemIcon);
    kinArea.appendChild(headerFlex);

    const kinGrid = document.createElement("div");
    kinGrid.id = "kinetics-btn-grid";
    kinGrid.style.display = "flex"; kinGrid.style.flexWrap = "wrap"; kinGrid.style.gap = "8px";
    kinArea.appendChild(kinGrid);
  }

  const kinGrid = kinArea.querySelector("#kinetics-btn-grid");
  if (kinGrid) {
    kinGrid.innerHTML = "";
    for (const gem of availableGems) {
      const btn = document.createElement("button");
      const isActive = selectedGems.includes(gem.id);
      btn.className = isActive ? "btn primary" : "btn ghost";
      btn.textContent = gem.name;
      btn.style.padding = "6px 12px"; btn.style.fontSize = "0.85rem"; btn.style.borderRadius = "6px";
      btn.onclick = () => {
        if (!selections.kinetics) selections.kinetics = {};
        if (!selections.kinetics[kineticHeroKey]) selections.kinetics[kineticHeroKey] = [];
        const arr = selections.kinetics[kineticHeroKey];
        const idx = arr.indexOf(gem.id);
        if (idx === -1) arr.push(gem.id); else arr.splice(idx, 1);
        saveSelectionsLocal(); updateUI(); setApplyVpkState(false); clearActivePreset();
      };
      kinGrid.appendChild(btn);
    }
  }
}

function updateUI() {
  // Добавляем перерисовку сеток при смене языка, чтобы категории мгновенно переводились
  renderGlobalGrid();
  renderPresetSelect();

  updateGlobalTiles();
  updateHeroHeader();

  const heroId = selections.current_hero;
  if (heroId) {
    renderHeroSlots(heroId);
    renderHeroKinetics(heroId);
  } else {
    const area = el("hero-slots-area"), kinArea = el("hero-kinetics-area");
    if (area) { area.hidden = true; area.innerHTML = ""; }
    if (kinArea) { kinArea.hidden = true; kinArea.innerHTML = ""; }
  }
  renderGallery("main-gallery-area", selections, window.t('empty_gallery'));
}

window.updateUI = updateUI;

function getDefaultItemId(hero, slot) {
  if (!schema?.effect_targets) return null;
  const heroNameLower = hero.replace(/_/g, " ").toLowerCase();
  const target = schema.effect_targets.find(t => {
    const tName = t.name.toLowerCase();
    if (!tName.includes(heroNameLower)) return false;
    if (tName.includes(`(${slot.toLowerCase()})`)) return true;
    return slot.toLowerCase() === "weapon" && tName.includes("(unknown)");
  });
  return target ? target.id : null;
}

async function saveToAgent() {
  setSaveStatus(window.t('vpk_building'), undefined);
  const base = getAgentBaseUrl();
  if (!base) return setSaveStatus(window.t('agent_port_req'), "err");
  const url = `${base.replace(/\/+$/, "")}/bridge/action/mastervpk`;

  const formattedSelections = { skin_changer: {}, effect_targets: {} };
  const globalCats = getGlobalCategoryIds();

  for (const [key, val] of Object.entries(selections)) {
    if (!val) continue;
    if (key === "current_hero" || globalCats.includes(key)) {
      formattedSelections[key] = val;
    } else if (schema?.skin_changer) {
      for (const hero of Object.keys(schema.skin_changer)) {
        const prefix = `${hero}_`;
        if (key.startsWith(prefix)) {

          if (key.endsWith("_active_persona")) {
            if (val === "0") break;

            const heroLower = hero.toLowerCase();
            const pList = schema.skin_changer[hero].persona_selector;

            if (pList && Array.isArray(pList) && pList.length > 0) {
              const pIndex = Math.max(0, parseInt(val, 10) - 1);
              const pItem = pList[pIndex] || pList[0];

              if (pItem && pItem.id) {
                if (!formattedSelections.skin_changer[heroLower]) {
                  formattedSelections.skin_changer[heroLower] = {};
                }
                formattedSelections.skin_changer[heroLower]["persona_selector"] = {
                  id: String(pItem.id),
                  style: 1
                };
              }
            }
            break;
          }

          const isEffect = key.endsWith("_effect");
          const slot = isEffect ? key.substring(prefix.length, key.length - 7) : key.substring(prefix.length);
          const heroLower = hero.toLowerCase();

          if (!formattedSelections.skin_changer[heroLower]) formattedSelections.skin_changer[heroLower] = {};
          if (!formattedSelections.skin_changer[heroLower][slot]) formattedSelections.skin_changer[heroLower][slot] = { id: "", style: 1 };

          if (isEffect) formattedSelections.skin_changer[heroLower][slot]._effect = val;
          else formattedSelections.skin_changer[heroLower][slot].id = val;
          break;
        }
      }
    }
  }

  if (schema?.skin_changer) {
    for (const heroLower of Object.keys(formattedSelections.skin_changer)) {
      const origHero = Object.keys(schema.skin_changer).find(h => h.toLowerCase() === heroLower);
      if (!origHero) continue;

      const slots = formattedSelections.skin_changer[heroLower];
      for (const [slot, data] of Object.entries(slots)) {
        if (data._effect) {
          const defaultId = getDefaultItemId(origHero, slot);
          if (defaultId) formattedSelections.effect_targets[defaultId] = data._effect;
        }
        delete data._effect;
        if (!data.id) delete slots[slot];
      }
      if (Object.keys(slots).length === 0) delete formattedSelections.skin_changer[heroLower];
    }
  }

  formattedSelections.kinetics = {};
  if (selections.kinetics) {
    for (const [kHero, kArr] of Object.entries(selections.kinetics)) {
      if (kArr?.length) formattedSelections.kinetics[kHero] = [...kArr];
    }
  }
  if (Object.keys(formattedSelections.kinetics).length === 0) delete formattedSelections.kinetics;
  if (Object.keys(formattedSelections.skin_changer || {}).length === 0) delete formattedSelections.skin_changer;
  if (Object.keys(formattedSelections.effect_targets || {}).length === 0) delete formattedSelections.effect_targets;

  try {
    const res = await fetch(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(formattedSelections) });
    if (res.ok) { setSaveStatus(window.t('vpk_created'), "ok"); setApplyVpkState(true); }
    else { setSaveStatus(`${window.t('agent_error')} ${res.status}`, "err"); }
  } catch (e) {
    setSaveStatus(window.t('agent_unavail'), "err");
  }
}

async function applyVpk() {
  setSaveStatus(window.t('vpk_installing'), undefined);
  const base = getAgentBaseUrl();
  if (!base) return setSaveStatus(window.t('agent_port_req'), "err");

  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/bridge/action/applyvpk`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: "{}" });
    if (res.ok) setSaveStatus(window.t('vpk_installed'), "ok");
    else setSaveStatus(`${window.t('agent_error')} ${res.status}`, "err");
  } catch (e) { setSaveStatus(window.t('agent_unavail'), "err"); }
}

function onDocumentKeydown(e) {
  if (e.key !== "Escape") return;
  const galleryModal = el("gallery-section");
  if (galleryModal && !galleryModal.hidden) {
    galleryModal.hidden = true; document.body.style.overflow = ""; return;
  }
  const presetsModal = el("presets-section");
  if (presetsModal && !presetsModal.hidden) {
    presetsModal.hidden = true; return;
  }
  const modal = el("picker-modal");
  if (modal && !modal.hidden) {
    closePicker(); return;
  }
  setHeroListOpen(false);
}

function onModalBackdropClick(e) {
  if (e.target === el("picker-modal")) closePicker();
}

function wireEvents() {
  el("btn-save-all")?.addEventListener("click", () => saveToAgent());
  el("btn-apply-all")?.addEventListener("click", () => applyVpk());

  el("btn-open-gallery")?.addEventListener("click", () => {
    const section = el("gallery-section");
    if (section) {
      section.hidden = !section.hidden;
      document.body.style.overflow = section.hidden ? "" : "hidden";
      if (!section.hidden) renderGallery("main-gallery-area", selections, window.t('empty_gallery'));
    }
  });

  el("btn-open-presets")?.addEventListener("click", () => {
    const section = el("presets-section");
    if (section) {
      section.hidden = !section.hidden;
      if (!section.hidden) renderPresetPreview(el("preset-select")?.value);
    }
  });

  el("presets-section")?.addEventListener("click", (e) => { if (e.target === el("presets-section")) el("presets-section").hidden = true; });

  el("btn-preset-save")?.addEventListener("click", savePresetFromInput);
  el("btn-preset-load")?.addEventListener("click", loadSelectedPreset);
  el("btn-preset-delete")?.addEventListener("click", deleteSelectedPreset);
  el("btn-reset-all")?.addEventListener("click", resetSelectionsToDefault);
  el("preset-select")?.addEventListener("change", (e) => renderPresetPreview(e.target.value));

  el("btn-preset-export")?.addEventListener("click", exportSelectedPreset);
  el("btn-export-gallery")?.addEventListener("click", () => void exportGalleryImages());
  setupDragAndDrop();

  el("btn-toggle-hero")?.addEventListener("click", () => {
    const open = el("hero-drop-list")?.hidden ?? true;
    setHeroListOpen(open);
    if (open) renderHeroGrid();
  });
  el("hero-search")?.addEventListener("input", renderHeroGrid);

  el("global-grid")?.addEventListener("click", (e) => {
    const toggler = e.target.closest("[data-toggle-global-section]");
    if (toggler) {
      const key = toggler.dataset.toggleGlobalSection;
      collapsedGlobalSections[key] = !collapsedGlobalSections[key];
      saveGlobalSectionState(); renderGlobalGrid(); updateGlobalTiles(); return;
    }
    const btn = e.target.closest("[data-open-picker]");
    if (btn) openGlobalPicker(btn.dataset.openPicker);
  });

  el("hero-grid")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-hero]");
    if (!chip) return;
    selections.current_hero = chip.dataset.hero;
    saveSelectionsLocal(); setHeroListOpen(false); updateUI(); clearActivePreset();
  });

  el("hero-slots-area")?.addEventListener("click", (e) => {
    const btnEff = e.target.closest("[data-open-effect-picker]");
    if (btnEff) {
        const hero = btnEff.dataset.hero;
        const slot = btnEff.dataset.slot;
        pickerContext = { type: "effect", hero, slot };
        return showPickerModal(`Эффект: ${slot}`, getEffectsList(), selections[`${hero}_${slot}_effect`], window.t('effect_none'));
    }

    const btn = e.target.closest("[data-open-hero-picker]");
    if (btn) openHeroPicker(btn.dataset.hero, btn.dataset.slot);
  });

  el("modal-item-list")?.addEventListener("click", (e) => {
    const opt = e.target.closest("[data-pick-id]");
    if (opt) applyPick(opt.dataset.pickId || "");
  });

  el("btn-close-picker")?.addEventListener("click", closePicker);

  document.addEventListener("keydown", onDocumentKeydown);
  el("picker-modal")?.addEventListener("click", onModalBackdropClick);
}

async function exportGalleryImages() {
  if (typeof html2canvas === "undefined") {
    alert(window.t('html2canvas_miss'));
    return;
  }

  const btn = el("btn-export-gallery");
  if (!btn) return;

  const originalText = btn.textContent;
  btn.textContent = window.t('generating');
  btn.disabled = true;

  try {
    const { globals, heroesData } = buildGalleryData(selections);
    const heroKeys = Object.keys(heroesData).sort();

    if (globals.length === 0 && heroKeys.length === 0) {
      alert(window.t('export_empty'));
      return;
    }

    const ITEMS_PER_PAGE = 8;
    const pages = [];
    let currentPage = [];

    if (globals.length > 0) {
      currentPage.push({ title: window.t('global_items'), data: globals, isGlobal: true });
    }

    for (const h of heroKeys) {
      if (currentPage.length >= ITEMS_PER_PAGE) {
        pages.push(currentPage);
        currentPage = [];
      }
      currentPage.push({ title: h.replace(/_/g, " "), data: heroesData[h], isGlobal: false });
    }
    if (currentPage.length > 0) pages.push(currentPage);

    for (let i = 0; i < pages.length; i++) {
      const pageData = pages[i];
      const exportContainer = document.createElement("div");

      exportContainer.style.position = "absolute";
      exportContainer.style.top = "-9999px";
      exportContainer.style.left = "0";
      exportContainer.style.width = "3840px";
      exportContainer.style.background = "#0a0a0a";
      exportContainer.style.padding = "2rem";
      exportContainer.style.display = "flex";
      exportContainer.style.flexDirection = "column";

      const styleTag = document.createElement("style");
      styleTag.textContent = `
        .export-row { background: #1a1a1a; border-bottom: 4px solid #000; width: 100%; display: flex; flex-direction: column; margin-bottom: 0; }
        .export-header { background: #333333; padding: 1.2rem 2rem; text-align: center; font-family: 'IBM Plex Sans', sans-serif; font-weight: 700; font-size: 2.2rem; color: #ffffff; text-transform: uppercase; letter-spacing: 0.08em; border-top: 2px solid #4a4a4a; border-bottom: 2px solid #111; box-shadow: inset 0 0 10px rgba(0,0,0,0.3); }
        .export-header.global { color: #3fb950; background: #223322; border-top-color: #2a4a2a; }
        .export-items { display: flex; flex-wrap: wrap; justify-content: center; gap: 2rem; padding: 3rem 1rem; }
        .export-card { width: 320px; display: flex; flex-direction: column; align-items: center; gap: 1rem; flex-shrink: 0; }
        .export-img-wrap { width: 320px; height: 213px; background: #0a0a0a; border: 3px solid #555; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; position: relative; box-shadow: 0 6px 16px rgba(0,0,0,0.4); }
        .export-img { width: 100%; height: 100%; object-fit: cover; }
        .export-label { font-family: 'IBM Plex Sans', sans-serif; font-size: 1.6rem; font-weight: 600; color: #b0b0b0; text-transform: uppercase; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
        .export-watermark { text-align: center; padding: 2.5rem 0; font-family: 'IBM Plex Mono', monospace; color: #555; font-size: 2rem; background: #0a0a0a; font-weight: 600; }
      `;
      exportContainer.appendChild(styleTag);

      const watermark = document.createElement("div");
      watermark.className = "export-watermark";
      watermark.textContent = `@DeadSouls_VPK | ItemSettings (${i + 1} / ${pages.length})`;
      exportContainer.appendChild(watermark);

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
          imgWrap.className = "export-img-wrap";

          if (item.color) {
            imgWrap.style.borderColor = item.color;
            imgWrap.style.boxShadow = `0 0 20px ${item.color}40`;
          } else if (item.isEffect) {
            imgWrap.style.borderColor = "rgba(63, 185, 80, 0.9)";
            imgWrap.style.boxShadow = "0 0 24px rgba(63, 185, 80, 0.4)";
          }

          if (item.url) {
            const img = document.createElement("img");
            img.className = "export-img";
            img.crossOrigin = "anonymous";
            img.src = item.url + "?v=" + Date.now();

            const promise = new Promise((resolve) => {
              img.onload = resolve;
              img.onerror = () => {
                img.style.display = "none";
                imgWrap.innerHTML = `<span style="font-size:2rem;color:#555;">${window.t('no_photo')}</span>`;
                resolve();
              };
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
      await Promise.all(imagePromises);
      await new Promise(res => setTimeout(res, 300));

      const canvas = await html2canvas(exportContainer, {
        backgroundColor: "#0a0a0a", scale: 2, useCORS: true, allowTaint: false, logging: false
      });

      document.body.removeChild(exportContainer);
      const link = document.createElement("a");
      link.download = `deadsouls_loadout_part_${i + 1}.png`;

      try {
        link.href = canvas.toDataURL("image/png");
        link.click();
      } catch (e) {
        alert(window.t('export_cors'));
      }
      await new Promise(res => setTimeout(res, 800));
    }
  } catch (err) {
    alert(window.t('export_err'));
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function getEffectsList() {
  return schema?.effects?.map((e) => ({ id: e.path, name: e.name })) || [];
}

async function init() {
  setApplyVpkState(false);
  loadSelections();
  loadPresets();
  loadGlobalSectionState();
  wireEvents();

  const fetchedCustomImages = await fetchCachedJson(CUSTOM_IMAGES_URL);
  if (fetchedCustomImages) customImages = fetchedCustomImages;

  const fetchedSchema = await fetchCachedJson(SCHEMA_URL);
  if (fetchedSchema) schema = fetchedSchema;

  renderGlobalGrid();
  renderPresetSelect();
  updateUI();
}

init();