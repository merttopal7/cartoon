import './style.css';
import * as THREE from 'three';
import { AssetLibrary } from './engine/assets';
import { buildFilm, type Film } from './engine/film';
import { exportMp4, webCodecsSupported } from './export/mp4';
import { FORMATS, type FormatPreset } from './formats';
import { Viewport } from './render/viewport';
import { parseScenario } from './schema';
import { ScenarioClient, type ScenarioMeta } from './engine/scenarios';
import { settingsClient } from './engine/settings';
import { SVG_ICONS } from './ui/icons';
import {
  formatCharacterDisplayName,
  getAbilityIconMeta,
} from './ui/ability-icons';
import { ScenarioCodeEditor } from './code-editor';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const ui = {
  // Toolbox Sekmeleri ve Panelleri
  tabScenario: $<HTMLButtonElement>('#tab-scenario'),
  tabScenarios: $<HTMLButtonElement>('#tab-scenarios'),
  tabSettings: $<HTMLButtonElement>('#tab-settings'),
  tabTools: $<HTMLButtonElement>('#tab-tools'),
  panelScenario: $('#panel-scenario'),
  panelScenarios: $('#panel-scenarios'),
  panelSettings: $('#panel-settings'),
  panelTools: $('#panel-tools'),

  // Senaryo Editörü Paneli
  source: $<HTMLTextAreaElement>('#source'),
  codeEditorMount: document.querySelector<HTMLElement>('#code-editor-mount'),
  editorCursorPos: document.querySelector<HTMLElement>('#editor-cursor-pos'),
  messages: $<HTMLUListElement>('#messages'),
  file: $<HTMLInputElement>('#file'),
  scenarioSelect: document.querySelector<HTMLSelectElement>('#scenario-select'),
  optgroupBuiltin: document.querySelector<HTMLOptGroupElement>('#optgroup-builtin'),
  optgroupCustom: document.querySelector<HTMLOptGroupElement>('#optgroup-custom'),
  btnLibrary: document.querySelector<HTMLButtonElement>('#btn-library'),
  btnSaveScenario: $<HTMLButtonElement>('#btn-save-scenario'),
  apply: $<HTMLButtonElement>('#apply'),

  // Toolbox Senaryolar Paneli
  toolboxSearch: $<HTMLInputElement>('#toolbox-search'),
  toolboxScenariosContainer: $('#toolbox-scenarios-container'),
  toolboxSaveTitle: $<HTMLInputElement>('#toolbox-save-title'),
  toolboxSaveDesc: $<HTMLInputElement>('#toolbox-save-desc'),
  toolboxBtnSave: $<HTMLButtonElement>('#toolbox-btn-save'),
  toolboxBtnReloadScenarios: $<HTMLButtonElement>('#toolbox-btn-reload-scenarios'),

  // Toolbox Ayarlar Paneli (SQLite)
  settingsStatusBadge: $<HTMLSpanElement>('#settings-status-badge'),
  settingsSyncLeadIn: $<HTMLInputElement>('#settings-sync-lead-in'),
  settingsSyncLeadInSlider: $<HTMLInputElement>('#settings-sync-lead-in-slider'),
  settingsSyncLeadInVal: $<HTMLSpanElement>('#settings-sync-lead-in-val'),
  settingsSyncLeadOut: $<HTMLInputElement>('#settings-sync-lead-out'),
  settingsSyncLeadOutSlider: $<HTMLInputElement>('#settings-sync-lead-out-slider'),
  settingsSyncLeadOutVal: $<HTMLSpanElement>('#settings-sync-lead-out-val'),
  settingsSyncLink: $<HTMLInputElement>('#settings-sync-link'),
  btnSettingsResetSync: $<HTMLButtonElement>('#btn-settings-reset-sync'),
  btnSettingsResetBuiltins: $<HTMLButtonElement>('#btn-settings-reset-builtins'),

  // Toolbox Araçlar Paneli
  toolFocusSpeaker: $<HTMLButtonElement>('#tool-focus-speaker'),
  toolResetCamera: $<HTMLButtonElement>('#tool-reset-camera'),
  toolJumpStart: $<HTMLButtonElement>('#tool-jump-start'),
  toolJumpSpeech: $<HTMLButtonElement>('#tool-jump-speech'),

  // SQLite Senaryo Kütüphanesi Modalı
  scenarioModal: $('#scenario-modal'),
  modalClose: $<HTMLButtonElement>('#modal-close'),
  modalSearch: $<HTMLInputElement>('#modal-search'),
  modalList: $('#modal-scenario-list'),
  saveTitle: $<HTMLInputElement>('#save-title'),
  saveDesc: $<HTMLInputElement>('#save-desc'),
  btnModalSave: $<HTMLButtonElement>('#btn-modal-save'),

  // Viewport Modları (Preview / Render)
  btnModePreview: $<HTMLButtonElement>('#btn-mode-preview'),
  btnModeRender: $<HTMLButtonElement>('#btn-mode-render'),
  settingsBtnModePreview: $<HTMLButtonElement>('#settings-btn-mode-preview'),
  settingsBtnModeRender: $<HTMLButtonElement>('#settings-btn-mode-render'),
  toolToggleMode: $<HTMLButtonElement>('#tool-toggle-mode'),
  toolToggleModeText: $<HTMLSpanElement>('#tool-toggle-mode-text'),

  // Sahne ve Dışa Aktarma
  format: $<HTMLSelectElement>('#format'),
  safeToggle: $<HTMLInputElement>('#safe-toggle'),
  exportOne: $<HTMLButtonElement>('#export'),
  exportAudio: $<HTMLButtonElement>('#export-audio'),
  exportAll: $<HTMLButtonElement>('#export-all'),

  // Müzik Editörü Paneli
  musicTrackSelect: $<HTMLSelectElement>('#music-track-select'),
  musicEnabledToggle: $<HTMLInputElement>('#music-enabled-toggle'),
  musicLoopToggle: $<HTMLInputElement>('#music-loop-toggle'),
  musicVolumeSlider: $<HTMLInputElement>('#music-volume-slider'),
  musicVolumeVal: $<HTMLSpanElement>('#music-volume-val'),
  musicDuckingSlider: $<HTMLInputElement>('#music-ducking-slider'),
  musicDuckingVal: $<HTMLSpanElement>('#music-ducking-val'),
  musicFadeInSlider: $<HTMLInputElement>('#music-fade-in-slider'),
  musicFadeInVal: $<HTMLSpanElement>('#music-fade-in-val'),
  musicFadeOutSlider: $<HTMLInputElement>('#music-fade-out-slider'),
  musicFadeOutVal: $<HTMLSpanElement>('#music-fade-out-val'),
  btnExportAudioStandalone: $<HTMLButtonElement>('#btn-export-audio-standalone'),
  btnMusicApplyYaml: $<HTMLButtonElement>('#btn-music-apply-yaml'),
  btnMusicSaveSqlite: $<HTMLButtonElement>('#btn-music-save-sqlite'),
  musicStatusBadge: $<HTMLSpanElement>('#music-status-badge'),
  musicPanelWaveformContainer: $('#music-panel-waveform-container'),
  musicPanelWaveformCanvas: $<HTMLCanvasElement>('#music-panel-waveform-canvas'),
  musicPanelDuckingZones: $<HTMLDivElement>('#music-panel-ducking-zones'),
  musicPanelPlayhead: $<HTMLDivElement>('#music-panel-playhead'),
  musicPanelClock: $('#music-panel-clock'),
  musicPanelTrackStatus: $('#music-panel-track-status'),

  // Çok Kanallı Zaman Çizelgesi (Timeline)
  timelineContainer: $('#timeline-container'),
  btnToggleTimeline: $<HTMLButtonElement>('#btn-toggle-timeline'),
  btnTransportTimeline: $<HTMLButtonElement>('#btn-transport-timeline'),
  timelineTracksViewport: $<HTMLDivElement>('#timeline-tracks-viewport'),
  timelineRulerTrack: $<HTMLDivElement>('#timeline-ruler-track'),
  laneShots: $<HTMLDivElement>('#lane-shots'),
  laneDialogues: $<HTMLDivElement>('#lane-dialogues'),
  laneMusic: $<HTMLDivElement>('#lane-music'),
  timelineMusicWaveform: $<HTMLCanvasElement>('#timeline-music-waveform'),
  timelineMusicDuckingZones: $<HTMLDivElement>('#timeline-music-ducking-zones'),
  timelinePlayheadNeedle: $<HTMLDivElement>('#timeline-playhead-needle'),
  timelineMusicTrackName: $<HTMLSpanElement>('#timeline-music-track-name'),

  stage: $('#stage'),
  frame: $('#frame'),
  safe: $('#safe'),
  abilityHud: document.querySelector<HTMLElement>('#ability-hud'),
  abilityActiveBanner: document.querySelector<HTMLElement>('#ability-active-banner'),
  abilityActiveIconBox: document.querySelector<HTMLElement>('#ability-active-icon-box'),
  abilityActiveCaster: document.querySelector<HTMLElement>('#ability-active-caster'),
  abilityActivePhase: document.querySelector<HTMLElement>('#ability-active-phase'),
  abilityActiveTitle: document.querySelector<HTMLElement>('#ability-active-title'),
  abilityActiveProgressFill: document.querySelector<HTMLElement>('#ability-active-progress-fill'),
  loadingOverlay: $('#loading-overlay'),
  loadingStatus: $('#loading-status'),
  loadingBarFill: $<HTMLDivElement>('#loading-bar-fill'),
  overlay: $('#export-overlay'),
  exportLabel: $('#export-label'),
  exportProgress: $<HTMLProgressElement>('#export-progress'),
  exportCancel: $<HTMLButtonElement>('#export-cancel'),

  // Transport Bar (Oynatıcı Çubuğu)
  play: $<HTMLButtonElement>('#play'),
  scrub: $<HTMLInputElement>('#scrub'),
  clock: $('#clock'),
  muteBtn: $<HTMLButtonElement>('#mute-btn'),
  volumeSlider: $<HTMLInputElement>('#volume-slider'),
  volumeLabel: $('#volume-label'),
  syncGroup: $<HTMLDivElement>('#sync-group'),
  syncPopoverBtn: $<HTMLButtonElement>('#sync-popover-btn'),
  syncSlider: $<HTMLInputElement>('#sync-slider'),
  syncVal: $<HTMLSpanElement>('#sync-val'),
  syncPopover: $<HTMLDivElement>('#sync-popover'),
  syncPopoverClose: $<HTMLButtonElement>('#sync-popover-close'),
  syncLeadIn: $<HTMLInputElement>('#sync-lead-in'),
  syncLeadOut: $<HTMLInputElement>('#sync-lead-out'),
  syncLinkCheckbox: $<HTMLInputElement>('#sync-link-checkbox'),
  where: $('#where'),
};

const scenarioClient = new ScenarioClient();
let allScenarios: ScenarioMeta[] = [];
let currentCategoryFilter = 'all';

const STORAGE_KEY = 'cartoon-engine.scenario';
const VOLUME_STORAGE_KEY = 'cartoon-engine.volume';
const MUTED_STORAGE_KEY = 'cartoon-engine.muted';
const SYNC_LEAD_IN_STORAGE_KEY = 'cartoon-engine.sync_lead_in';
const SYNC_LEAD_OUT_STORAGE_KEY = 'cartoon-engine.sync_lead_out';
const SYNC_LINKED_STORAGE_KEY = 'cartoon-engine.sync_linked';
const VIEWPORT_MODE_STORAGE_KEY = 'cartoon-engine.viewport_mode';

let currentVolume = 1.0;
let currentMuted = false;
let currentLeadInMs = 700;
let currentLeadOutMs = 700;
let currentRenderMode: 'preview' | 'render' = 'render';

try {
  const v = localStorage.getItem(VOLUME_STORAGE_KEY);
  if (v !== null) currentVolume = Math.max(0, Math.min(1, parseFloat(v)));
  const m = localStorage.getItem(MUTED_STORAGE_KEY);
  if (m !== null) currentMuted = m === 'true';

  const inVal = localStorage.getItem(SYNC_LEAD_IN_STORAGE_KEY);
  if (inVal !== null) currentLeadInMs = Math.max(0, Math.min(2000, parseInt(inVal, 10)));
  const outVal = localStorage.getItem(SYNC_LEAD_OUT_STORAGE_KEY);
  if (outVal !== null) currentLeadOutMs = Math.max(0, Math.min(2000, parseInt(outVal, 10)));

  const modeVal = localStorage.getItem(VIEWPORT_MODE_STORAGE_KEY);
  if (modeVal === 'render' || modeVal === 'preview') currentRenderMode = modeVal;
} catch {}

const viewport = new Viewport($<HTMLCanvasElement>('#canvas'));
const library = new AssetLibrary();

let film: Film | null = null;
let format: FormatPreset = FORMATS[0];
let time = 0;
let playing = false;
let exporting = false;
/** Shader ısıtması sürerken önizleme döngüsü sahneyi çizmez (ısıtma görünürlükleri geçici olarak değiştirir). */
let warmingUp = false;
let buildToken = 0;

let codeEditor: ScenarioCodeEditor | null = null;

function getEditorSource(): string {
  return codeEditor ? codeEditor.getValue() : (ui.source?.value ?? '');
}

function setEditorSource(text: string): void {
  if (ui.source) {
    ui.source.value = text;
  }
  if (codeEditor) {
    codeEditor.setValue(text);
  }
}

function isEditorFocused(target: EventTarget | null): boolean {
  if (!target) return false;
  if (target === ui.source) return true;
  if (ui.codeEditorMount && target instanceof Node && ui.codeEditorMount.contains(target)) return true;
  if (target instanceof Element) {
    if (target.closest('.cm-editor')) return true;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  }
  return false;
}

if (ui.codeEditorMount) {
  codeEditor = new ScenarioCodeEditor({
    parent: ui.codeEditorMount,
    initialValue: ui.source.value,
    onApply: () => {
      applySource();
    },
    onSave: () => {
      ui.btnSaveScenario.click();
    },
    onChange: (value) => {
      if (ui.source) ui.source.value = value;
      try {
        localStorage.setItem(STORAGE_KEY, value);
      } catch {}
    },
    onCursorChange: (line, col, selLen) => {
      if (ui.editorCursorPos) {
        const selText = selLen > 0 ? ` (${selLen} seçili)` : '';
        ui.editorCursorPos.textContent = `Satır ${line}, Sütun ${col}${selText}`;
      }
    },
  });
}

// ---------------------------------------------------------------- toolbox sekme yönetimi
function switchToolboxTab(tabName: string) {
  document.querySelectorAll('.toolbox-tab').forEach((tab) => {
    const btn = tab as HTMLButtonElement;
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.toolbox-panel').forEach((panel) => {
    const p = panel as HTMLElement;
    const match = p.id === `panel-${tabName}`;
    p.hidden = !match;
    p.classList.toggle('active', match);
  });
  if (tabName === 'scenarios') {
    renderScenarioCards();
  } else if (tabName === 'scenario') {
    codeEditor?.focus();
  }
}

document.querySelectorAll('.toolbox-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tabName = (btn as HTMLElement).dataset.tab;
    if (tabName) switchToolboxTab(tabName);
  });
});

// ---------------------------------------------------------------- mesajlar
type Level = 'error' | 'warn' | 'ok';
function showMessages(items: { level: Level; text: string }[]) {
  ui.messages.replaceChildren(
    ...items.map(({ level, text }) => {
      const li = document.createElement('li');
      li.className = level;
      li.textContent = text;
      return li;
    }),
  );
}

// ---------------------------------------------------------------- senaryo derleme
async function applySource() {
  const text = getEditorSource();
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    /* depolama yoksa önemli değil */
  }

  const parsed = parseScenario(text);
  if (!parsed.ok) {
    showMessages(parsed.errors.map((text) => ({ level: 'error', text })));
    return;
  }

  const token = ++buildToken;
  ui.loadingOverlay.hidden = false;
  ui.loadingStatus.textContent = 'Senaryo hazırlanıyor…';
  ui.loadingBarFill.style.width = '5%';
  ui.apply.disabled = true;

  try {
    const { film: next, warnings } = await buildFilm(parsed.scenario, library, (status, percent) => {
      if (token !== buildToken) return;
      ui.loadingStatus.textContent = status;
      ui.loadingBarFill.style.width = `${Math.round(percent * 100)}%`;
    });
    if (token !== buildToken) {
      next.dispose();
      return;
    }
    // Shader'lar ve dokular oynatmadan önce derlenir; yoksa her yeteneğin ilk karesinde önizleme donar
    next.setRenderMode(currentRenderMode);
    ui.loadingStatus.textContent = 'Shader\'lar hazırlanıyor…';
    ui.loadingBarFill.style.width = '95%';
    await next.warmup(viewport.renderer);
    await viewport.warmupOverlays();
    if (token !== buildToken) {
      next.dispose();
      return;
    }
    film?.dispose();
    film = next;
    film.setRenderMode(currentRenderMode);
    film.audio.setVolume(currentVolume);
    film.audio.setMuted(currentMuted);
    film.audio.setSyncTiming(currentLeadInMs, currentLeadOutMs);
    updateMusicUIFromFilm();
    renderTimeline();
    viewport.render(film);
    time = Math.min(time, next.duration);
    ui.scrub.max = String(next.duration);
    ui.scrub.step = String(1 / next.fps);
    updateTimelinePlayhead(time);
    updateAbilityHUD();
    showMessages([
      ...warnings.map((text) => ({ level: 'warn' as const, text })),
      {
        level: 'ok',
        text: `Hazır: ${next.scenes.length} sahne, ${next.duration.toFixed(2)} sn, ${next.fps} fps (${next.frameCount} kare)`,
      },
    ]);
  } catch (e) {
    showMessages([{ level: 'error', text: `Sahne kurulamadı: ${e instanceof Error ? e.message : String(e)}` }]);
  } finally {
    if (token === buildToken) {
      ui.apply.disabled = false;
      setTimeout(() => {
        if (token === buildToken) {
          ui.loadingOverlay.hidden = true;
          ui.loadingBarFill.style.width = '0%';
        }
      }, 150);
    }
  }
}

async function loadScenario(id: string) {
  try {
    const content = await scenarioClient.getContent(id);
    setEditorSource(content);
    if (ui.scenarioSelect) ui.scenarioSelect.value = id;
    time = 0;
    await applySource();
    showMessages([{ level: 'ok', text: `Senaryo yüklendi: ${id}` }]);
    renderScenarioCards();
  } catch (err) {
    showMessages([{ level: 'error', text: `Senaryo yüklenemedi: ${err instanceof Error ? err.message : String(err)}` }]);
  }
}

// ---------------------------------------------------------------- senaryo kartları oluşturucu
function createScenarioCard(s: ScenarioMeta, isToolbox = false): HTMLElement {
  const activeId = scenarioClient.getActiveId();
  const card = document.createElement('div');
  card.className = `scenario-card ${s.id === activeId ? 'active-card' : ''}`;

  const header = document.createElement('div');
  header.className = 'card-header';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = s.title;

  const badge = document.createElement('span');
  badge.className = `badge ${s.category}`;
  badge.textContent = s.category === 'builtin' ? 'Bölüm' : 'SQLite';

  header.appendChild(title);
  header.appendChild(badge);
  card.appendChild(header);

  if (s.description) {
    const desc = document.createElement('div');
    desc.className = 'card-desc';
    desc.textContent = s.description;
    card.appendChild(desc);
  }

  if (s.tags) {
    const tags = document.createElement('div');
    tags.className = 'card-tags';
    tags.style.display = 'flex';
    tags.style.alignItems = 'center';
    tags.style.gap = '5px';
    tags.innerHTML = `${SVG_ICONS.tag} <span>${s.tags}</span>`;
    card.appendChild(tags);
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const loadBtn = document.createElement('button');
  loadBtn.className = 'btn primary has-icon';
  loadBtn.innerHTML = `${SVG_ICONS.play} <span>Yükle</span>`;
  loadBtn.addEventListener('click', async () => {
    if (!isToolbox) ui.scenarioModal.hidden = true;
    await loadScenario(s.id);
    if (isToolbox) {
      switchToolboxTab('scenario');
    }
  });
  actions.appendChild(loadBtn);

  if (s.category === 'custom') {
    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger icon';
    delBtn.title = 'Senaryoyu Sil';
    delBtn.innerHTML = SVG_ICONS.trash;
    delBtn.addEventListener('click', async () => {
      if (confirm(`"${s.title}" senaryosunu SQLite veritabanından silmek istediğinize emin misiniz?`)) {
        await scenarioClient.delete(s.id);
        await refreshScenarios();
      }
    });
    actions.appendChild(delBtn);
  }

  card.appendChild(actions);
  return card;
}

function renderScenarioCards() {
  const queryModal = ui.modalSearch ? ui.modalSearch.value.trim().toLowerCase() : '';
  const queryToolbox = ui.toolboxSearch ? ui.toolboxSearch.value.trim().toLowerCase() : '';

  // 1. Modal listesini güncelle
  if (ui.modalList) {
    ui.modalList.replaceChildren();
    const filteredModal = allScenarios.filter((s) => {
      if (currentCategoryFilter !== 'all' && s.category !== currentCategoryFilter) return false;
      if (!queryModal) return true;
      return (
        s.title.toLowerCase().includes(queryModal) ||
        s.description.toLowerCase().includes(queryModal) ||
        s.tags.toLowerCase().includes(queryModal) ||
        s.id.toLowerCase().includes(queryModal)
      );
    });

    if (filteredModal.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mono muted';
      empty.style.padding = '20px';
      empty.style.gridColumn = '1 / -1';
      empty.style.textAlign = 'center';
      empty.textContent = 'Eşleşen senaryo bulunamadı.';
      ui.modalList.appendChild(empty);
    } else {
      for (const s of filteredModal) {
        ui.modalList.appendChild(createScenarioCard(s, false));
      }
    }
  }

  // 2. Toolbox Senaryolar listesini güncelle
  if (ui.toolboxScenariosContainer) {
    ui.toolboxScenariosContainer.replaceChildren();
    const filteredToolbox = allScenarios.filter((s) => {
      if (currentCategoryFilter !== 'all' && s.category !== currentCategoryFilter) return false;
      if (!queryToolbox) return true;
      return (
        s.title.toLowerCase().includes(queryToolbox) ||
        s.description.toLowerCase().includes(queryToolbox) ||
        s.tags.toLowerCase().includes(queryToolbox) ||
        s.id.toLowerCase().includes(queryToolbox)
      );
    });

    if (filteredToolbox.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mono muted';
      empty.style.padding = '16px';
      empty.style.textAlign = 'center';
      empty.textContent = 'Eşleşen senaryo bulunamadı.';
      ui.toolboxScenariosContainer.appendChild(empty);
    } else {
      for (const s of filteredToolbox) {
        ui.toolboxScenariosContainer.appendChild(createScenarioCard(s, true));
      }
    }
  }
}

async function refreshScenarios() {
  allScenarios = await scenarioClient.list();

  // Populate Dropdown (eğer DOM'da varsa)
  if (ui.optgroupBuiltin && ui.optgroupCustom) {
    ui.optgroupBuiltin.replaceChildren();
    ui.optgroupCustom.replaceChildren();

    const activeId = scenarioClient.getActiveId();

    for (const s of allScenarios) {
      const opt = new Option(s.title, s.id);
      if (s.id === activeId) opt.selected = true;
      if (s.category === 'builtin') {
        ui.optgroupBuiltin.appendChild(opt);
      } else {
        ui.optgroupCustom.appendChild(opt);
      }
    }
  }

  renderScenarioCards();
}

// ---------------------------------------------------------------- SQLite ayar yönetimi
let saveSettingsTimer: number | null = null;
function debounceSaveSettings() {
  if (ui.settingsStatusBadge) {
    ui.settingsStatusBadge.textContent = 'SQLite Kaydediliyor...';
    ui.settingsStatusBadge.style.color = 'var(--warn)';
  }
  if (saveSettingsTimer) window.clearTimeout(saveSettingsTimer);
  saveSettingsTimer = window.setTimeout(async () => {
    try {
      await settingsClient.save({
        sync_lead_in: currentLeadInMs,
        sync_lead_out: currentLeadOutMs,
        sync_linked: ui.syncLinkCheckbox.checked,
      });
      if (ui.settingsStatusBadge) {
        ui.settingsStatusBadge.textContent = 'SQLite Kaydedildi';
        ui.settingsStatusBadge.style.color = 'var(--ok)';
      }
    } catch {
      if (ui.settingsStatusBadge) {
        ui.settingsStatusBadge.textContent = 'SQLite Hata';
        ui.settingsStatusBadge.style.color = 'var(--error)';
      }
    }
  }, 120);
}

function flushSaveSettings() {
  if (saveSettingsTimer) {
    window.clearTimeout(saveSettingsTimer);
    saveSettingsTimer = null;
  }
  settingsClient.save({
    sync_lead_in: currentLeadInMs,
    sync_lead_out: currentLeadOutMs,
    sync_linked: ui.syncLinkCheckbox.checked,
  }).then(() => {
    if (ui.settingsStatusBadge) {
      ui.settingsStatusBadge.textContent = 'SQLite Kaydedildi';
      ui.settingsStatusBadge.style.color = 'var(--ok)';
    }
  }).catch(() => {
    if (ui.settingsStatusBadge) {
      ui.settingsStatusBadge.textContent = 'SQLite Hata';
      ui.settingsStatusBadge.style.color = 'var(--error)';
    }
  });
}

function updateSyncUI(leadInMs: number, leadOutMs: number, saveToSQLite = true) {
  currentLeadInMs = Math.max(0, Math.min(2000, Math.round(leadInMs)));
  currentLeadOutMs = Math.max(0, Math.min(2000, Math.round(leadOutMs)));

  // Anında istemci deposuna (localStorage) yazılır; sayfa o mikrosaniyede yenilense dahi asla 700'e dönmez
  try {
    localStorage.setItem(SYNC_LEAD_IN_STORAGE_KEY, String(currentLeadInMs));
    localStorage.setItem(SYNC_LEAD_OUT_STORAGE_KEY, String(currentLeadOutMs));
  } catch {}

  // Transport Bar Elements
  ui.syncSlider.value = String(currentLeadInMs);
  ui.syncVal.textContent = `${currentLeadInMs}ms`;
  ui.syncLeadIn.value = String(currentLeadInMs);
  ui.syncLeadOut.value = String(currentLeadOutMs);

  // Toolbox Settings Panel Elements
  if (ui.settingsSyncLeadInSlider) ui.settingsSyncLeadInSlider.value = String(currentLeadInMs);
  if (ui.settingsSyncLeadIn) ui.settingsSyncLeadIn.value = String(currentLeadInMs);
  if (ui.settingsSyncLeadInVal) ui.settingsSyncLeadInVal.textContent = `${currentLeadInMs}ms`;

  if (ui.settingsSyncLeadOutSlider) ui.settingsSyncLeadOutSlider.value = String(currentLeadOutMs);
  if (ui.settingsSyncLeadOut) ui.settingsSyncLeadOut.value = String(currentLeadOutMs);
  if (ui.settingsSyncLeadOutVal) ui.settingsSyncLeadOutVal.textContent = `${currentLeadOutMs}ms`;

  film?.audio.setSyncTiming(currentLeadInMs, currentLeadOutMs);

  if (saveToSQLite) {
    debounceSaveSettings();
  }
}

function setRenderMode(mode: 'preview' | 'render', saveToDb = true) {
  currentRenderMode = mode;
  try {
    localStorage.setItem(VIEWPORT_MODE_STORAGE_KEY, mode);
  } catch {}
  viewport.setRenderMode(mode);
  film?.setRenderMode(mode);

  if (ui.btnModePreview) ui.btnModePreview.classList.toggle('active', mode === 'preview');
  if (ui.btnModeRender) ui.btnModeRender.classList.toggle('active', mode === 'render');

  if (ui.settingsBtnModePreview) ui.settingsBtnModePreview.classList.toggle('active', mode === 'preview');
  if (ui.settingsBtnModeRender) ui.settingsBtnModeRender.classList.toggle('active', mode === 'render');

  if (ui.toolToggleModeText) {
    ui.toolToggleModeText.textContent = mode === 'preview' ? 'Mod Değiştir (Render)' : 'Mod Değiştir (Önizleme)';
  }

  layout();
  if (film) {
    // Gölgeler açılıp kapanınca malzemeler yeni shader ister; oynatma sırasında derlenmesin diye önceden hazırla
    const warming = film;
    warmingUp = true;
    void warming
      .warmup(viewport.renderer)
      .catch(() => {})
      .finally(() => {
        warmingUp = false;
        if (film === warming) viewport.render(warming);
      });
  }

  if (saveToDb) {
    settingsClient.save({ viewport_mode: mode });
    showMessages([{ level: 'ok', text: `Çalışma modu değiştirildi: ${mode === 'preview' ? 'Önizleme Modu (Optimize)' : 'Render Modu (Tam Kalite)'}` }]);
  }
}

async function initSQLiteSettings() {
  try {
    const s = await settingsClient.load();
    const localLeadIn = localStorage.getItem(SYNC_LEAD_IN_STORAGE_KEY);
    // Eğer SQLite'ta kayıtlı özel değer varsa ve (700'den farklıysa veya localStorage boşsa) al:
    if (s.sync_lead_in !== undefined && (s.sync_lead_in !== 700 || localLeadIn === null)) {
      currentLeadInMs = s.sync_lead_in;
      currentLeadOutMs = s.sync_lead_out;
    } else if (localLeadIn !== null) {
      currentLeadInMs = Math.max(0, Math.min(2000, parseInt(localLeadIn, 10)));
      const localLeadOut = localStorage.getItem(SYNC_LEAD_OUT_STORAGE_KEY);
      currentLeadOutMs = localLeadOut !== null ? Math.max(0, Math.min(2000, parseInt(localLeadOut, 10))) : currentLeadInMs;
      flushSaveSettings();
    }
    const linked = s.sync_linked ?? true;
    ui.syncLinkCheckbox.checked = linked;
    if (ui.settingsSyncLink) ui.settingsSyncLink.checked = linked;
    updateSyncUI(currentLeadInMs, currentLeadOutMs, false);

    if (s.viewport_mode) {
      setRenderMode(s.viewport_mode, false);
    } else {
      setRenderMode(currentRenderMode, false);
    }

    if (s.music_track && ui.musicTrackSelect) ui.musicTrackSelect.value = s.music_track;
    if (s.music_enabled !== undefined && ui.musicEnabledToggle) ui.musicEnabledToggle.checked = s.music_enabled;
    if (s.music_loop !== undefined && ui.musicLoopToggle) ui.musicLoopToggle.checked = s.music_loop;
    if (s.music_volume !== undefined && ui.musicVolumeSlider) {
      ui.musicVolumeSlider.value = String(s.music_volume);
      if (ui.musicVolumeVal) ui.musicVolumeVal.textContent = `${Math.round(s.music_volume * 100)}%`;
    }
    if (s.music_ducking !== undefined && ui.musicDuckingSlider) {
      ui.musicDuckingSlider.value = String(s.music_ducking);
      if (ui.musicDuckingVal) ui.musicDuckingVal.textContent = `${Math.round(s.music_ducking * 100)}%`;
    }
    if (s.music_fade_in !== undefined && ui.musicFadeInSlider) {
      ui.musicFadeInSlider.value = String(s.music_fade_in);
      if (ui.musicFadeInVal) ui.musicFadeInVal.textContent = `${s.music_fade_in.toFixed(1)}s`;
    }
    if (s.music_fade_out !== undefined && ui.musicFadeOutSlider) {
      ui.musicFadeOutSlider.value = String(s.music_fade_out);
      if (ui.musicFadeOutVal) ui.musicFadeOutVal.textContent = `${s.music_fade_out.toFixed(1)}s`;
    }

    if (ui.settingsStatusBadge) {
      ui.settingsStatusBadge.textContent = 'SQLite Aktif';
      ui.settingsStatusBadge.style.color = 'var(--ok)';
    }
  } catch (err) {
    console.warn('SQLite ayarları yüklenemedi:', err);
    updateSyncUI(currentLeadInMs, currentLeadOutMs, false);
    setRenderMode(currentRenderMode, false);
  }
}

// ---------------------------------------------------------------- müzik editörü ve ses mikseri
function updateMusicUIFromFilm() {
  if (!film) return;
  const cfg = film.audio.getMusicConfig();
  if (ui.musicTrackSelect) ui.musicTrackSelect.value = cfg.src;
  if (ui.musicEnabledToggle) ui.musicEnabledToggle.checked = cfg.enabled;
  if (ui.musicLoopToggle) ui.musicLoopToggle.checked = cfg.loop;
  if (ui.musicVolumeSlider) ui.musicVolumeSlider.value = String(cfg.volume);
  if (ui.musicVolumeVal) ui.musicVolumeVal.textContent = `${Math.round(cfg.volume * 100)}%`;
  if (ui.musicDuckingSlider) ui.musicDuckingSlider.value = String(cfg.ducking);
  if (ui.musicDuckingVal) ui.musicDuckingVal.textContent = `${Math.round(cfg.ducking * 100)}%`;
  if (ui.musicFadeInSlider) ui.musicFadeInSlider.value = String(cfg.fadeIn);
  if (ui.musicFadeInVal) ui.musicFadeInVal.textContent = `${cfg.fadeIn.toFixed(1)}s`;
  if (ui.musicFadeOutSlider) ui.musicFadeOutSlider.value = String(cfg.fadeOut);
  if (ui.musicFadeOutVal) ui.musicFadeOutVal.textContent = `${cfg.fadeOut.toFixed(1)}s`;
}

let saveMusicTimeout: ReturnType<typeof setTimeout> | null = null;
function debounceSaveMusicSettings() {
  if (ui.musicStatusBadge) {
    ui.musicStatusBadge.textContent = 'SQLite Kaydediliyor...';
    ui.musicStatusBadge.style.color = 'var(--warn)';
  }
  if (saveMusicTimeout) clearTimeout(saveMusicTimeout);
  saveMusicTimeout = setTimeout(() => {
    saveMusicSettingsToSQLite();
  }, 250);
}

async function saveMusicSettingsToSQLite() {
  try {
    const src = ui.musicTrackSelect?.value || '/audio/main-theme/jyproject-carousel-dreams-396029.mp3';
    const volume = Number(ui.musicVolumeSlider?.value ?? 0.35);
    const ducking = Number(ui.musicDuckingSlider?.value ?? 0.25);
    const loop = ui.musicLoopToggle?.checked ?? true;
    const enabled = ui.musicEnabledToggle?.checked ?? true;
    const fadeIn = Number(ui.musicFadeInSlider?.value ?? 1.0);
    const fadeOut = Number(ui.musicFadeOutSlider?.value ?? 1.5);

    await settingsClient.save({
      music_enabled: enabled,
      music_track: src,
      music_volume: volume,
      music_ducking: ducking,
      music_loop: loop,
      music_fade_in: fadeIn,
      music_fade_out: fadeOut,
    });
    if (ui.musicStatusBadge) {
      ui.musicStatusBadge.textContent = 'SQLite Kaydedildi';
      ui.musicStatusBadge.style.color = 'var(--ok)';
    }
  } catch {
    if (ui.musicStatusBadge) {
      ui.musicStatusBadge.textContent = 'SQLite Hata';
      ui.musicStatusBadge.style.color = 'var(--error)';
    }
  }
}

function applyMusicSettingsToYAML() {
  let text = getEditorSource();
  const src = ui.musicTrackSelect?.value || '/audio/main-theme/jyproject-carousel-dreams-396029.mp3';
  const volume = Number(ui.musicVolumeSlider?.value ?? 0.35);
  const ducking = Number(ui.musicDuckingSlider?.value ?? 0.25);
  const loop = ui.musicLoopToggle?.checked ?? true;
  const fadeIn = Number(ui.musicFadeInSlider?.value ?? 1.0);
  const fadeOut = Number(ui.musicFadeOutSlider?.value ?? 1.5);

  const musicYamlBlock = `  music:\n    src: ${src}\n    volume: ${volume}\n    ducking: ${ducking}\n    loop: ${loop}\n    fade_in: ${fadeIn}\n    fade_out: ${fadeOut}`;

  if (/^(\s*)music:\s*\n(\s+[\w_]+:[^\n]*\n*)+/m.test(text)) {
    text = text.replace(/^(\s*)music:\s*\n(\s+[\w_]+:[^\n]*\n*)+/m, `${musicYamlBlock}\n`);
  } else if (/^film:\s*\n/m.test(text)) {
    text = text.replace(/^film:\s*\n/m, `film:\n${musicYamlBlock}\n`);
  } else {
    text = `film:\n${musicYamlBlock}\n\n` + text;
  }

  setEditorSource(text);
  applySource();
  showMessages([{ level: 'ok', text: 'Müzik ayarları YAML senaryosuna uygulandı ve derlendi.' }]);
}

function initMusicUI() {
  if (ui.musicTrackSelect) {
    ui.musicTrackSelect.addEventListener('change', async () => {
      const src = ui.musicTrackSelect.value;
      await film?.audio.loadMusic({ src });
      debounceSaveMusicSettings();
      renderTimeline();
    });
  }

  if (ui.musicEnabledToggle) {
    ui.musicEnabledToggle.addEventListener('change', () => {
      const enabled = ui.musicEnabledToggle.checked;
      film?.audio.setMusicConfig({ enabled });
      debounceSaveMusicSettings();
      renderTimeline();
    });
  }

  if (ui.musicLoopToggle) {
    ui.musicLoopToggle.addEventListener('change', () => {
      const loop = ui.musicLoopToggle.checked;
      film?.audio.setMusicConfig({ loop });
      debounceSaveMusicSettings();
      renderTimeline();
    });
  }

  if (ui.musicVolumeSlider) {
    ui.musicVolumeSlider.addEventListener('input', () => {
      const volume = Number(ui.musicVolumeSlider.value);
      if (ui.musicVolumeVal) ui.musicVolumeVal.textContent = `${Math.round(volume * 100)}%`;
      film?.audio.setMusicConfig({ volume });
      debounceSaveMusicSettings();
      renderTimeline();
    });
  }

  if (ui.musicDuckingSlider) {
    ui.musicDuckingSlider.addEventListener('input', () => {
      const ducking = Number(ui.musicDuckingSlider.value);
      if (ui.musicDuckingVal) ui.musicDuckingVal.textContent = `${Math.round(ducking * 100)}%`;
      film?.audio.setMusicConfig({ ducking });
      debounceSaveMusicSettings();
      renderTimeline();
    });
  }

  if (ui.musicFadeInSlider) {
    ui.musicFadeInSlider.addEventListener('input', () => {
      const fadeIn = Number(ui.musicFadeInSlider.value);
      if (ui.musicFadeInVal) ui.musicFadeInVal.textContent = `${fadeIn.toFixed(1)}s`;
      film?.audio.setMusicConfig({ fadeIn });
      debounceSaveMusicSettings();
      renderTimeline();
    });
  }

  if (ui.musicFadeOutSlider) {
    ui.musicFadeOutSlider.addEventListener('input', () => {
      const fadeOut = Number(ui.musicFadeOutSlider.value);
      if (ui.musicFadeOutVal) ui.musicFadeOutVal.textContent = `${fadeOut.toFixed(1)}s`;
      film?.audio.setMusicConfig({ fadeOut });
      debounceSaveMusicSettings();
      renderTimeline();
    });
  }

  if (ui.btnExportAudioStandalone) {
    ui.btnExportAudioStandalone.addEventListener('click', () => runExportAudio());
  }

  if (ui.exportAudio) {
    ui.exportAudio.addEventListener('click', () => runExportAudio());
  }

  if (ui.btnMusicSaveSqlite) {
    ui.btnMusicSaveSqlite.addEventListener('click', async () => {
      await saveMusicSettingsToSQLite();
      showMessages([{ level: 'ok', text: 'Müzik ayarları SQLite veritabanına başarıyla kaydedildi.' }]);
    });
  }

  if (ui.btnMusicApplyYaml) {
    ui.btnMusicApplyYaml.addEventListener('click', () => {
      applyMusicSettingsToYAML();
    });
  }
}

// ---------------------------------------------------------------- çok kanallı zaman çizelgesi (timeline)
function seekTo(targetTime: number) {
  if (!film) return;
  setPlaying(false);
  time = Math.max(0, Math.min(film.duration, targetTime));
  ui.scrub.value = String(time);
  film.audio.update(time, false);
  const { scene, shot } = film.evaluate(time, format);
  viewport.render(film);
  ui.clock.textContent = `${fmtTime(time)} / ${fmtTime(film.duration)}`;
  ui.where.textContent = `${scene.id} · çekim ${shot.index + 1}/${scene.shots.length}`;
  updateTimelinePlayhead(time);
  updateAbilityHUD();
}

function drawWaveformToCanvas(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer | null,
  strokeColor = '#38bdf8',
  fillColor = 'rgba(56, 189, 248, 0.28)',
) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(200, Math.round(rect.width || 800));
  const height = Math.max(24, Math.round(rect.height || 34));

  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  if (!buffer) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const midY = height / 2;
    for (let x = 0; x < width; x += 4) {
      const y = midY + Math.sin(x * 0.05) * 3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    return;
  }

  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / width);
  const midY = height / 2;
  const amp = height * 0.44;

  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(0, midY);

  const peaks: [number, number][] = [];
  for (let x = 0; x < width; x++) {
    const startIdx = x * step;
    const endIdx = Math.min(data.length, startIdx + step);
    let min = 0;
    let max = 0;
    for (let i = startIdx; i < endIdx; i++) {
      const val = data[i];
      if (val < min) min = val;
      if (val > max) max = val;
    }
    peaks.push([min, max]);
    ctx.lineTo(x, midY - max * amp);
  }

  for (let x = width - 1; x >= 0; x--) {
    const [min] = peaks[x];
    ctx.lineTo(x, midY - min * amp);
  }

  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function renderTimeline() {
  if (!film || film.duration <= 0) return;

  const totalDur = film.duration;

  // 1. Cetvel (Ruler) işaretleri
  if (ui.timelineRulerTrack) {
    ui.timelineRulerTrack.innerHTML = '';
    let step = 1;
    if (totalDur > 120) step = 20;
    else if (totalDur > 60) step = 10;
    else if (totalDur > 20) step = 5;
    else if (totalDur > 10) step = 2;

    for (let t = 0; t <= totalDur + 0.001; t += step) {
      const pct = (t / totalDur) * 100;
      const tick = document.createElement('div');
      tick.className = 'timeline-ruler-tick';
      tick.style.left = `${pct}%`;
      tick.textContent = fmtTime(t);
      ui.timelineRulerTrack.appendChild(tick);
    }
  }

  // 2. Çekim Kanalları (Lane Shots)
  if (ui.laneShots) {
    ui.laneShots.innerHTML = '';
    let shotTime = 0;
    for (let sIdx = 0; sIdx < film.scenes.length; sIdx++) {
      const scene = film.scenes[sIdx];
      for (let shIdx = 0; shIdx < scene.shots.length; shIdx++) {
        const shot = scene.shots[shIdx];
        const leftPct = (shotTime / totalDur) * 100;
        const widthPct = (shot.duration / totalDur) * 100;
        const block = document.createElement('div');
        block.className = 'timeline-block shot-block';
        block.style.left = `${leftPct}%`;
        block.style.width = `${widthPct}%`;
        const camSize = typeof shot.camera.size === 'string'
          ? shot.camera.size.toUpperCase()
          : typeof shot.camera.size === 'object' && shot.camera.size && 'from' in shot.camera.size
          ? `${shot.camera.size.from}→${shot.camera.size.to}`.toUpperCase()
          : 'KAMERA';
        block.textContent = `Ç${shIdx + 1} (${camSize}, ${shot.duration.toFixed(1)}s)`;
        block.title = `Sahne ${scene.id} · Çekim ${shIdx + 1}: ${camSize} (${shotTime.toFixed(1)}s - ${(shotTime + shot.duration).toFixed(1)}s)`;

        const targetSeek = shotTime;
        block.addEventListener('click', (e) => {
          e.stopPropagation();
          seekTo(targetSeek);
        });
        ui.laneShots.appendChild(block);
        shotTime += shot.duration;
      }
    }
  }

  // 3. Diyalog Kanalları (Lane Dialogues)
  const cues = film.audio.getCues();
  if (ui.laneDialogues) {
    ui.laneDialogues.innerHTML = '';
    for (const cue of cues) {
      const leftPct = (cue.start / totalDur) * 100;
      const widthPct = Math.max(0.6, (cue.duration / totalDur) * 100);
      const block = document.createElement('div');
      block.className = 'timeline-block dialogue-block';
      block.style.left = `${leftPct}%`;
      block.style.width = `${widthPct}%`;
      const shortText = cue.text ? `"${cue.text.slice(0, 18)}${cue.text.length > 18 ? '…' : ''}"` : '';
      block.textContent = `${cue.who}: ${shortText}`;
      block.title = `${cue.who} (${cue.start.toFixed(2)}s - ${(cue.start + cue.duration).toFixed(2)}s): "${cue.text || ''}"`;

      const targetSeek = Math.max(0, cue.start - (currentLeadInMs / 1000));
      block.addEventListener('click', (e) => {
        e.stopPropagation();
        seekTo(targetSeek);
      });
      ui.laneDialogues.appendChild(block);
    }
  }

  // 4. Müzik Kanalı (Lane Music) & Dalga Formu & Ducking Alanları
  const musicCfg = film.audio.getMusicConfig();
  const musicBuffer = film.audio.getMusicBuffer();
  const trackFilename = musicCfg.src ? musicCfg.src.split('/').pop()?.replace(/\.[^/.]+$/, '') : 'Arkaplan Müziği';

  if (ui.timelineMusicTrackName) {
    ui.timelineMusicTrackName.textContent = musicCfg.enabled
      ? `${trackFilename} (Ses: %${Math.round(musicCfg.volume * 100)} · Ducking: %${Math.round(musicCfg.ducking * 100)})`
      : 'Müzik Devre Dışı';
  }
  if (ui.musicPanelTrackStatus) {
    ui.musicPanelTrackStatus.textContent = musicCfg.enabled
      ? `${trackFilename} · ${musicBuffer ? `${musicBuffer.duration.toFixed(1)} sn` : 'Yüklendi'}`
      : 'Müzik Kapalı';
  }

  // Dalga formunu çiz
  if (ui.timelineMusicWaveform) {
    drawWaveformToCanvas(ui.timelineMusicWaveform, musicBuffer, '#38bdf8', 'rgba(56, 189, 248, 0.28)');
  }
  if (ui.musicPanelWaveformCanvas) {
    drawWaveformToCanvas(ui.musicPanelWaveformCanvas, musicBuffer, '#38bdf8', 'rgba(56, 189, 248, 0.32)');
  }

  // Ducking pencerelerini yerleştir
  const renderDuckingZones = (container: HTMLElement | null) => {
    if (!container) return;
    container.innerHTML = '';
    if (!musicCfg.enabled) return;

    for (const cue of cues) {
      const soundStart = cue.start + (cue.activeStart ?? 0);
      const soundEnd = cue.start + (cue.activeEnd ?? cue.duration);
      const leftPct = (soundStart / totalDur) * 100;
      const widthPct = Math.max(0.4, ((soundEnd - soundStart) / totalDur) * 100);

      const zone = document.createElement('div');
      zone.className = 'timeline-ducking-zone';
      zone.style.left = `${leftPct}%`;
      zone.style.width = `${widthPct}%`;
      zone.title = `Ducking Bölgesi: Karakter konuşurken (${cue.who}) müzik seviyesi %${Math.round(musicCfg.ducking * 100)}'e kısılır`;
      container.appendChild(zone);
    }
  };

  renderDuckingZones(ui.timelineMusicDuckingZones);
  renderDuckingZones(ui.musicPanelDuckingZones);

  // İbreyi güncelle
  updateTimelinePlayhead(time);
}

function updateTimelinePlayhead(t: number) {
  if (!film || film.duration <= 0) return;
  const pct = Math.max(0, Math.min(100, (t / film.duration) * 100));
  if (ui.timelinePlayheadNeedle) {
    ui.timelinePlayheadNeedle.style.left = `${pct}%`;
  }
  if (ui.musicPanelPlayhead) {
    ui.musicPanelPlayhead.style.left = `${pct}%`;
  }
  if (ui.musicPanelClock) {
    ui.musicPanelClock.textContent = `${fmtTime(t)} / ${fmtTime(film.duration)}`;
  }
}

function initTimelineUI() {
  if (ui.btnToggleTimeline) {
    ui.btnToggleTimeline.innerHTML = SVG_ICONS.chevronDown;
  }
  if (ui.btnTransportTimeline) {
    ui.btnTransportTimeline.innerHTML = SVG_ICONS.timeline;
  }

  let isDraggingTimeline = false;

  const handleTimelineScrub = (e: MouseEvent, targetElement: HTMLElement) => {
    if (!film || film.duration <= 0) return;
    const rect = targetElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const ratio = x / rect.width;
    seekTo(ratio * film.duration);
  };

  if (ui.timelineTracksViewport) {
    ui.timelineTracksViewport.addEventListener('mousedown', (e) => {
      isDraggingTimeline = true;
      handleTimelineScrub(e, ui.timelineTracksViewport);
    });
  }

  if (ui.musicPanelWaveformContainer) {
    ui.musicPanelWaveformContainer.addEventListener('mousedown', (e) => {
      isDraggingTimeline = true;
      handleTimelineScrub(e, ui.musicPanelWaveformContainer);
    });
  }

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingTimeline) return;
    if (ui.timelineTracksViewport && ui.timelineTracksViewport.matches(':hover')) {
      handleTimelineScrub(e, ui.timelineTracksViewport);
    } else if (ui.musicPanelWaveformContainer && ui.musicPanelWaveformContainer.matches(':hover')) {
      handleTimelineScrub(e, ui.musicPanelWaveformContainer);
    }
  });

  window.addEventListener('mouseup', () => {
    isDraggingTimeline = false;
  });

  const toggleTimelineCollapse = () => {
    if (!ui.timelineContainer) return;
    const isCollapsed = ui.timelineContainer.classList.toggle('collapsed');
    if (ui.btnToggleTimeline) {
      ui.btnToggleTimeline.innerHTML = isCollapsed ? SVG_ICONS.chevronUp : SVG_ICONS.chevronDown;
      ui.btnToggleTimeline.title = isCollapsed ? 'Zaman Çizelgesini Göster' : 'Zaman Çizelgesini Gizle';
    }
    if (ui.btnTransportTimeline) {
      ui.btnTransportTimeline.classList.toggle('active', !isCollapsed);
    }
    layout();
    renderTimeline();
  };

  if (ui.btnToggleTimeline) {
    ui.btnToggleTimeline.addEventListener('click', toggleTimelineCollapse);
  }
  if (ui.btnTransportTimeline) {
    ui.btnTransportTimeline.addEventListener('click', toggleTimelineCollapse);
  }

  window.addEventListener('resize', () => {
    if (film) renderTimeline();
  });
}

// ---------------------------------------------------------------- yerleşim
function layout() {
  const r = ui.stage.getBoundingClientRect();
  const pad = 24;
  const availW = Math.max(50, r.width - pad * 2);
  const availH = Math.max(50, r.height - pad * 2);
  const aspect = format.width / format.height;
  let w = availW;
  let h = availW / aspect;
  if (h > availH) {
    h = availH;
    w = availH * aspect;
  }
  w = Math.round(w);
  h = Math.round(h);
  ui.frame.style.width = `${w}px`;
  ui.frame.style.height = `${h}px`;
  const pixelRatio = currentRenderMode === 'preview' ? 1.0 : Math.min(window.devicePixelRatio, 2);
  if (!exporting) viewport.setSize(w, h, pixelRatio);

  const s = format.safe;
  ui.safe.hidden = !s || !ui.safeToggle.checked;
  if (s) {
    Object.assign(ui.safe.style, {
      top: `${s.top * 100}%`,
      bottom: `${s.bottom * 100}%`,
      left: `${s.left * 100}%`,
      right: `${s.right * 100}%`,
    });
  }
}

// ---------------------------------------------------------------- oynatma
const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

let lastTickTime = performance.now();
/** Son çizilen önizleme karesi (durdurulmuşken aynı kare tekrar çizilmesin diye). */
let lastDrawnFilm: unknown = null;
let lastDrawnKey = '';

function setPlaying(v: boolean) {
  playing = v;
  ui.play.innerHTML = v ? SVG_ICONS.pause : SVG_ICONS.play;
  lastTickTime = performance.now();
  if (!v) {
    film?.audio.update(time, false);
  }
}

// ---------------------------------------------------------------- yetenek (skill) ikonları ve HUD
function updateAbilityHUD() {
  const activeList = film?.currentActiveAbilities ?? [];
  const banner = ui.abilityActiveBanner;

  if (activeList.length === 0) {
    if (banner) {
      banner.hidden = true;
    }
    return;
  }

  const primary = activeList[activeList.length - 1];
  const meta = getAbilityIconMeta(primary.name);

  if (banner) {
    banner.hidden = false;
    banner.style.setProperty('--skill-bg', meta.bgColor);
    banner.style.setProperty('--skill-accent', meta.accentColor);
  }
  if (ui.abilityActiveIconBox) {
    ui.abilityActiveIconBox.style.backgroundColor = meta.bgColor;
    ui.abilityActiveIconBox.style.setProperty('--skill-accent', meta.accentColor);
    if (ui.abilityActiveIconBox.dataset.skillId !== meta.id) {
      ui.abilityActiveIconBox.dataset.skillId = meta.id;
      ui.abilityActiveIconBox.innerHTML = meta.svg;
    }
  }
  if (ui.abilityActiveCaster) {
    ui.abilityActiveCaster.textContent = formatCharacterDisplayName(primary.who);
  }
  if (ui.abilityActiveTitle) {
    ui.abilityActiveTitle.textContent = meta.title.toUpperCase();
  }
  if (ui.abilityActivePhase) {
    ui.abilityActivePhase.style.backgroundColor =
      primary.phase === 'charge'
        ? '#fde047'
        : primary.phase === 'flight'
          ? '#fb923c'
          : '#4ade80';
    ui.abilityActivePhase.textContent =
      primary.phase === 'charge'
        ? 'GÜÇ TOPLANIYOR!'
        : primary.phase === 'flight'
          ? 'FIRLATILDI!'
          : 'SÜPER ETKİ!';
  }
  if (ui.abilityActiveProgressFill) {
    ui.abilityActiveProgressFill.style.backgroundColor = meta.bgColor;
    ui.abilityActiveProgressFill.style.width = `${Math.round(primary.progress * 100)}%`;
  }
}

function tick(now: number) {
  if (film && !exporting && !warmingUp) {
    if (playing) {
      // Delta time clamp: GPU veya sekme gecikmelerinde zamanın 66ms'den
      // fazla aniden zıplayıp dudak açılış payını (lead-in) atlamasını önler
      const dt = (now - lastTickTime) / 1000;
      const clampedDt = Math.min(0.066, Math.max(0, dt));
      time += clampedDt;
      if (time >= film.duration) {
        time = 0;
        setPlaying(false);
      }
    }
    lastTickTime = now;
    film.audio.update(time, playing);
    // Durdurulmuşken ve hiçbir şey değişmemişken sahneyi her karede yeniden hesaplayıp çizme: açık bir sekme
    // boşta beklerken GPU'yu sürekli meşgul ediyordu. Arama, senaryo ve mod değişiklikleri kendi çizimlerini yapar.
    const frameKey = `${time}|${format.id}|${viewport.canvas.width}x${viewport.canvas.height}|${currentRenderMode}`;
    if (!playing && film === lastDrawnFilm && frameKey === lastDrawnKey) {
      requestAnimationFrame(tick);
      return;
    }
    lastDrawnFilm = film;
    lastDrawnKey = frameKey;
    const { scene, shot } = film.evaluate(time, format);
    viewport.render(film);
    ui.scrub.value = String(time);
    ui.clock.textContent = `${fmtTime(time)} / ${fmtTime(film.duration)}`;
    ui.where.textContent = `${scene.id} · çekim ${shot.index + 1}/${scene.shots.length}`;
    updateTimelinePlayhead(time);
    updateAbilityHUD();
  } else {
    lastTickTime = now;
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- ses dışa aktarım (WAV)
async function runExportAudio() {
  if (!film || exporting) return;
  exporting = true;
  setPlaying(false);
  ui.overlay.hidden = false;
  ui.exportLabel.textContent = 'Film ses ve müzik miksi hazırlanıyor (WAV)…';
  ui.exportProgress.value = 0.5;
  try {
    const { exportMasterAudio } = await import('./export/mp4');
    const blob = await exportMasterAudio(film);
    const name = `${film.title}-master-soundtrack.wav`;
    download(blob, name);
    showMessages([{ level: 'ok', text: `Film sesi başarıyla indirildi: ${name} (${(blob.size / 1e6).toFixed(1)} MB)` }]);
  } catch (err) {
    showMessages([{ level: 'error', text: `Ses dışa aktarma hatası: ${err instanceof Error ? err.message : String(err)}` }]);
  } finally {
    exporting = false;
    ui.overlay.hidden = true;
    ui.exportProgress.value = 0;
  }
}

// ---------------------------------------------------------------- dışa aktarım
let abort: AbortController | null = null;

async function runExport(formats: FormatPreset[]) {
  if (!film || exporting) return;
  if (!webCodecsSupported()) {
    showMessages([{ level: 'error', text: 'Bu tarayıcı WebCodecs desteklemiyor. Güncel Chrome veya Edge kullanın.' }]);
    return;
  }
  const current = film;
  const previousFormat = format;
  exporting = true;
  setPlaying(false);
  abort = new AbortController();
  ui.overlay.hidden = false;
  ui.exportOne.disabled = ui.exportAll.disabled = ui.apply.disabled = false;

  const done: string[] = [];
  try {
    for (const [i, f] of formats.entries()) {
      format = f;
      ui.exportLabel.textContent = `${f.label} (${f.width}×${f.height})${formats.length > 1 ? ` · ${i + 1}/${formats.length}` : ''}`;
      layout();
      const started = performance.now();
      const blob = await exportMp4({
        film: current,
        viewport,
        format: f,
        signal: abort.signal,
        onProgress: (n, total) => (ui.exportProgress.value = n / total),
      });
      const name = `${current.title}-${f.id}.mp4`;
      download(blob, name);
      done.push(`${name} · ${(blob.size / 1e6).toFixed(1)} MB · ${((performance.now() - started) / 1000).toFixed(1)} sn`);
    }
    showMessages(done.map((text) => ({ level: 'ok', text: `İndirildi: ${text}` })));
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    showMessages([
      ...done.map((text) => ({ level: 'ok' as const, text: `İndirildi: ${text}` })),
      { level: aborted ? 'warn' : 'error', text: aborted ? 'Dışa aktarım iptal edildi.' : `Dışa aktarım hatası: ${e instanceof Error ? e.message : e}` },
    ]);
  } finally {
    format = previousFormat;
    exporting = false;
    abort = null;
    ui.overlay.hidden = true;
    ui.exportProgress.value = 0;
    ui.exportOne.disabled = ui.exportAll.disabled = ui.apply.disabled = false;
    layout();
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------- olaylar
for (const f of FORMATS) ui.format.add(new Option(`${f.label} — ${f.width}×${f.height}`, f.id));
ui.format.addEventListener('change', () => {
  format = FORMATS.find((f) => f.id === ui.format.value) ?? FORMATS[0];
  layout();
});
ui.safeToggle.addEventListener('change', layout);
new ResizeObserver(layout).observe(ui.stage);

ui.apply.addEventListener('click', applySource);

if (ui.scenarioSelect) {
  ui.scenarioSelect.addEventListener('change', () => {
    if (ui.scenarioSelect?.value) {
      loadScenario(ui.scenarioSelect.value);
    }
  });
}

if (ui.btnLibrary) {
  ui.btnLibrary.addEventListener('click', () => {
    ui.scenarioModal.hidden = false;
    refreshScenarios();
  });
}

ui.modalClose.addEventListener('click', () => {
  ui.scenarioModal.hidden = true;
});

ui.scenarioModal.addEventListener('click', (e) => {
  if (e.target === ui.scenarioModal) {
    ui.scenarioModal.hidden = true;
  }
});

document.querySelectorAll('.filter-pills .pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.filter-pills .pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    currentCategoryFilter = pill.getAttribute('data-filter') || 'all';
    renderScenarioCards();
  });
});

if (ui.modalSearch) {
  ui.modalSearch.addEventListener('input', () => renderScenarioCards());
}
if (ui.toolboxSearch) {
  ui.toolboxSearch.addEventListener('input', () => renderScenarioCards());
}

ui.btnSaveScenario.addEventListener('click', () => {
  switchToolboxTab('scenarios');
  const text = getEditorSource();
  const match = text.match(/title:\s*([^\r\n#]+)/);
  if (match && !ui.toolboxSaveTitle.value) {
    ui.toolboxSaveTitle.value = match[1].trim();
  }
  ui.toolboxSaveTitle.focus();
});

async function handleSaveScenario(titleInput: HTMLInputElement, descInput: HTMLInputElement) {
  const title = titleInput.value.trim();
  if (!title) {
    alert('Lütfen bir senaryo başlığı girin.');
    titleInput.focus();
    return;
  }
  const desc = descInput.value.trim();
  try {
    const savedItem = await scenarioClient.save({
      title,
      description: desc,
      content: getEditorSource(),
    });
    showMessages([{ level: 'ok', text: `Senaryo SQLite veritabanına kaydedildi: ${savedItem.title}` }]);
    titleInput.value = '';
    descInput.value = '';
    await refreshScenarios();
    if (ui.scenarioSelect) ui.scenarioSelect.value = savedItem.id;
  } catch (err) {
    showMessages([{ level: 'error', text: `Kayıt hatası: ${err instanceof Error ? err.message : String(err)}` }]);
  }
}

if (ui.btnModalSave) {
  ui.btnModalSave.addEventListener('click', () => handleSaveScenario(ui.saveTitle, ui.saveDesc));
}
if (ui.toolboxBtnSave) {
  ui.toolboxBtnSave.addEventListener('click', () => handleSaveScenario(ui.toolboxSaveTitle, ui.toolboxSaveDesc));
}
if (ui.toolboxBtnReloadScenarios) {
  ui.toolboxBtnReloadScenarios.addEventListener('click', () => refreshScenarios());
}

ui.file.addEventListener('change', async () => {
  const file = ui.file.files?.[0];
  if (!file) return;
  const content = await file.text();
  setEditorSource(content);
  ui.file.value = '';
  time = 0;
  await applySource();
});
ui.source.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    applySource();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    ui.source.setRangeText('  ', ui.source.selectionStart, ui.source.selectionEnd, 'end');
  }
});

ui.play.addEventListener('click', () => setPlaying(!playing));
ui.scrub.addEventListener('input', () => {
  setPlaying(false);
  time = Number(ui.scrub.value);
  film?.audio.update(time, false);
  updateTimelinePlayhead(time);
});

function updateVolumeUI(vol: number, muted: boolean) {
  ui.volumeSlider.value = String(vol);
  ui.volumeLabel.textContent = `${Math.round(vol * 100)}%`;
  if (muted || vol === 0) {
    ui.muteBtn.innerHTML = SVG_ICONS.volumeMute;
    ui.muteBtn.title = 'Sesi Aç (M)';
  } else if (vol < 0.35) {
    ui.muteBtn.innerHTML = SVG_ICONS.volumeLow;
    ui.muteBtn.title = 'Sesi Kapat (M)';
  } else if (vol < 0.75) {
    ui.muteBtn.innerHTML = SVG_ICONS.volumeMedium;
    ui.muteBtn.title = 'Sesi Kapat (M)';
  } else {
    ui.muteBtn.innerHTML = SVG_ICONS.volumeHigh;
    ui.muteBtn.title = 'Sesi Kapat (M)';
  }
}

function setVolume(val: number) {
  currentVolume = Math.max(0, Math.min(1, val));
  if (currentVolume > 0 && currentMuted) {
    currentMuted = false;
  }
  film?.audio.setVolume(currentVolume);
  film?.audio.setMuted(currentMuted);
  updateVolumeUI(currentVolume, currentMuted);
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(currentVolume));
    localStorage.setItem(MUTED_STORAGE_KEY, String(currentMuted));
  } catch {}
}

function toggleMute() {
  currentMuted = !currentMuted;
  film?.audio.setMuted(currentMuted);
  updateVolumeUI(currentVolume, currentMuted);
  try {
    localStorage.setItem(MUTED_STORAGE_KEY, String(currentMuted));
  } catch {}
}

ui.volumeSlider.addEventListener('input', () => {
  setVolume(Number(ui.volumeSlider.value));
});

ui.muteBtn.addEventListener('click', () => {
  toggleMute();
});

// ---------------------------------------------------------------- senkron arayüz olayları
ui.syncSlider.addEventListener('input', () => {
  const val = Number(ui.syncSlider.value);
  if (ui.syncLinkCheckbox.checked) {
    updateSyncUI(val, val);
  } else {
    updateSyncUI(val, currentLeadOutMs);
  }
});
ui.syncSlider.addEventListener('change', () => flushSaveSettings());

ui.syncPopoverBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  ui.syncPopover.hidden = !ui.syncPopover.hidden;
});

ui.syncPopoverClose.addEventListener('click', () => {
  ui.syncPopover.hidden = true;
});

ui.syncPopover.addEventListener('click', (e) => {
  e.stopPropagation();
});

document.addEventListener('click', (e) => {
  if (!ui.syncPopover.hidden && !ui.syncGroup.contains(e.target as Node)) {
    ui.syncPopover.hidden = true;
  }
});

ui.syncLeadIn.addEventListener('input', () => {
  const val = Number(ui.syncLeadIn.value) || 0;
  if (ui.syncLinkCheckbox.checked) {
    updateSyncUI(val, val);
  } else {
    updateSyncUI(val, currentLeadOutMs);
  }
});
ui.syncLeadIn.addEventListener('change', () => flushSaveSettings());

ui.syncLeadOut.addEventListener('input', () => {
  const val = Number(ui.syncLeadOut.value) || 0;
  if (ui.syncLinkCheckbox.checked) {
    updateSyncUI(val, val);
  } else {
    updateSyncUI(currentLeadInMs, val);
  }
});
ui.syncLeadOut.addEventListener('change', () => flushSaveSettings());

ui.syncLinkCheckbox.addEventListener('change', () => {
  const linked = ui.syncLinkCheckbox.checked;
  if (ui.settingsSyncLink) ui.settingsSyncLink.checked = linked;
  try {
    localStorage.setItem(SYNC_LINKED_STORAGE_KEY, String(linked));
  } catch {}
  if (linked) {
    updateSyncUI(currentLeadInMs, currentLeadInMs);
  } else {
    flushSaveSettings();
  }
});

// Settings paneli senkron kontrolleri
if (ui.settingsSyncLeadInSlider) {
  ui.settingsSyncLeadInSlider.addEventListener('input', () => {
    const val = Number(ui.settingsSyncLeadInSlider.value);
    if (ui.settingsSyncLink?.checked) {
      updateSyncUI(val, val);
    } else {
      updateSyncUI(val, currentLeadOutMs);
    }
  });
  ui.settingsSyncLeadInSlider.addEventListener('change', () => flushSaveSettings());
}
if (ui.settingsSyncLeadIn) {
  ui.settingsSyncLeadIn.addEventListener('input', () => {
    const val = Number(ui.settingsSyncLeadIn.value) || 0;
    if (ui.settingsSyncLink?.checked) {
      updateSyncUI(val, val);
    } else {
      updateSyncUI(val, currentLeadOutMs);
    }
  });
  ui.settingsSyncLeadIn.addEventListener('change', () => flushSaveSettings());
}
if (ui.settingsSyncLeadOutSlider) {
  ui.settingsSyncLeadOutSlider.addEventListener('input', () => {
    const val = Number(ui.settingsSyncLeadOutSlider.value);
    if (ui.settingsSyncLink?.checked) {
      updateSyncUI(val, val);
    } else {
      updateSyncUI(currentLeadInMs, val);
    }
  });
  ui.settingsSyncLeadOutSlider.addEventListener('change', () => flushSaveSettings());
}
if (ui.settingsSyncLeadOut) {
  ui.settingsSyncLeadOut.addEventListener('input', () => {
    const val = Number(ui.settingsSyncLeadOut.value) || 0;
    if (ui.settingsSyncLink?.checked) {
      updateSyncUI(val, val);
    } else {
      updateSyncUI(currentLeadInMs, val);
    }
  });
  ui.settingsSyncLeadOut.addEventListener('change', () => flushSaveSettings());
}
if (ui.settingsSyncLink) {
  ui.settingsSyncLink.addEventListener('change', () => {
    const linked = ui.settingsSyncLink.checked;
    ui.syncLinkCheckbox.checked = linked;
    try {
      localStorage.setItem(SYNC_LINKED_STORAGE_KEY, String(linked));
    } catch {}
    if (linked) {
      updateSyncUI(currentLeadInMs, currentLeadInMs);
    } else {
      flushSaveSettings();
    }
  });
}

if (ui.btnSettingsResetSync) {
  ui.btnSettingsResetSync.addEventListener('click', () => {
    ui.syncLinkCheckbox.checked = true;
    if (ui.settingsSyncLink) ui.settingsSyncLink.checked = true;
    try {
      localStorage.setItem(SYNC_LEAD_IN_STORAGE_KEY, '700');
      localStorage.setItem(SYNC_LEAD_OUT_STORAGE_KEY, '700');
      localStorage.setItem(SYNC_LINKED_STORAGE_KEY, 'true');
    } catch {}
    updateSyncUI(700, 700, true);
    flushSaveSettings();
    showMessages([{ level: 'ok', text: 'Senkron payı varsayılan 700 ms değerine sıfırlandı ve SQLite kaydedildi.' }]);
  });
}

if (ui.btnSettingsResetBuiltins) {
  ui.btnSettingsResetBuiltins.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/scenarios/reset-builtin', { method: 'POST' });
      if (res.ok) {
        await refreshScenarios();
        showMessages([{ level: 'ok', text: 'Yerleşik senaryolar dosyalardan SQLite veritabanına yeniden aktarıldı.' }]);
      }
    } catch (err) {
      showMessages([{ level: 'error', text: `Yenileme hatası: ${err}` }]);
    }
  });
}

// ---------------------------------------------------------------- toolbox araçları
if (ui.toolFocusSpeaker) {
  ui.toolFocusSpeaker.addEventListener('click', () => {
    if (!film) return;
    const cues = film.audio.getCues();
    let speaker: string | undefined;
    for (const cue of cues) {
      if (time >= cue.start - 0.7 && time <= cue.start + cue.duration + 0.5) {
        speaker = cue.who;
        break;
      }
    }
    if (speaker) {
      const { scene } = film.evaluate(time, format);
      if (scene.characters.has(speaker)) {
        const lt = time - scene.start;
        const head = scene.headOf(speaker, lt);
        const pos = scene.positionOf(speaker, lt);
        film.camera.position.set(pos.x, head.y + 0.2, pos.z + 2.8);
        film.camera.lookAt(head);
        viewport.render(film);
        showMessages([{ level: 'ok', text: `Kamera aktif konuşmacıya odaklandı: ${speaker}` }]);
      }
    } else {
      showMessages([{ level: 'warn', text: 'Şu an sahnede konuşan karakter bulunmuyor.' }]);
    }
  });
}

if (ui.toolResetCamera) {
  ui.toolResetCamera.addEventListener('click', () => {
    if (!film) return;
    film.camera.position.set(0, 1.6, 6);
    film.camera.lookAt(new THREE.Vector3(0, 1.2, 0));
    viewport.render(film);
    showMessages([{ level: 'ok', text: 'Kamera genel görünüme sıfırlandı.' }]);
  });
}

if (ui.toolJumpStart) {
  ui.toolJumpStart.addEventListener('click', () => {
    setPlaying(false);
    time = 0;
    ui.scrub.value = '0';
    film?.audio.update(0, false);
    if (film) viewport.render(film);
  });
}

if (ui.toolJumpSpeech) {
  ui.toolJumpSpeech.addEventListener('click', () => {
    if (!film) return;
    const cues = film.audio.getCues();
    if (cues.length > 0) {
      const firstSpeech = cues[0];
      const targetT = Math.max(0, firstSpeech.start - (currentLeadInMs / 1000));
      setPlaying(false);
      time = targetT;
      ui.scrub.value = String(time);
      film.audio.update(time, false);
      viewport.render(film);
      showMessages([{ level: 'ok', text: `İlk konuşmaya gidildi: ${firstSpeech.who} (${firstSpeech.start.toFixed(2)}s)` }]);
    } else {
      showMessages([{ level: 'warn', text: 'Mevcut senaryoda sesli konuşma bulunamadı.' }]);
    }
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ui.scenarioModal.hidden) {
    e.preventDefault();
    ui.scenarioModal.hidden = true;
    return;
  }
  if (isEditorFocused(e.target) || exporting) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPlaying(!playing);
  } else if (e.code === 'KeyM') {
    e.preventDefault();
    toggleMute();
  } else if (e.code === 'ArrowUp') {
    e.preventDefault();
    setVolume(Math.round((currentVolume + 0.05) * 20) / 20);
  } else if (e.code === 'ArrowDown') {
    e.preventDefault();
    setVolume(Math.round((currentVolume - 0.05) * 20) / 20);
  }
});

ui.exportOne.addEventListener('click', () => runExport([format]));
ui.exportAll.addEventListener('click', () => runExport(FORMATS.filter((f) => f.id !== 'youtube_4k')));
ui.exportCancel.addEventListener('click', () => abort?.abort());

// ---------------------------------------------------------------- başlat
updateVolumeUI(currentVolume, currentMuted);
updateSyncUI(currentLeadInMs, currentLeadOutMs, false);
initSQLiteSettings();
initMusicUI();
initTimelineUI();
refreshScenarios();

window.addEventListener('beforeunload', () => {
  try {
    localStorage.setItem(SYNC_LEAD_IN_STORAGE_KEY, String(currentLeadInMs));
    localStorage.setItem(SYNC_LEAD_OUT_STORAGE_KEY, String(currentLeadOutMs));
    localStorage.setItem(SYNC_LINKED_STORAGE_KEY, String(ui.syncLinkCheckbox.checked));
  } catch {}
  if (saveSettingsTimer) {
    window.clearTimeout(saveSettingsTimer);
    saveSettingsTimer = null;
    try {
      const payload = JSON.stringify({
        settings: {
          sync_lead_in: String(currentLeadInMs),
          sync_lead_out: String(currentLeadOutMs),
          sync_linked: String(ui.syncLinkCheckbox.checked),
        },
      });
      navigator.sendBeacon('/api/settings', new Blob([payload], { type: 'application/json' }));
    } catch {}
  }
});

let saved: string | null = null;
try {
  saved = localStorage.getItem(STORAGE_KEY);
} catch {
  /* yok say */
}
if (saved) {
  setEditorSource(saved);
  applySource();
} else {
  loadScenario('bolum-1-ormanin-bekcileri');
}
layout();
requestAnimationFrame(tick);

// ---------------------------------------------------------------- viewport modu (preview / render)
ui.btnModePreview?.addEventListener('click', () => setRenderMode('preview'));
ui.btnModeRender?.addEventListener('click', () => setRenderMode('render'));
ui.settingsBtnModePreview?.addEventListener('click', () => setRenderMode('preview'));
ui.settingsBtnModeRender?.addEventListener('click', () => setRenderMode('render'));
ui.toolToggleMode?.addEventListener('click', () => {
  setRenderMode(currentRenderMode === 'preview' ? 'render' : 'preview');
});

// Otomasyon ve hata ayıklama için (ör. headless testler).
Object.assign(window, {
  __engine: {
    THREE,
    viewport,
    get film() { return film; },
    evaluate: (t: number) => film?.evaluate(t, format),
    scenarios: scenarioClient,
    settings: settingsClient,
    loadScenario,
    switchToolboxTab,
    setSyncTiming: (inMs: number, outMs: number) => updateSyncUI(inMs, outMs, true),
    getSyncTiming: () => ({ leadInMs: currentLeadInMs, leadOutMs: currentLeadOutMs }),
    setRenderMode: (mode: 'preview' | 'render') => setRenderMode(mode, true),
    getRenderMode: () => currentRenderMode,
    exportAudio: runExportAudio,
    applyMusicSettingsToYAML,
    saveMusicSettingsToSQLite,
    renderTimeline,
    updateTimelinePlayhead,
    seekTo,
  },
});
