
// ==UserScript==
// @name         Vickness Addon Panel - Standalone
// @namespace    Vickness
// @version      1.2.34
// @description  Vickness Addons 1.2.34: przywrócenie natywnych tipów Margonem; bez modyfikacji podpowiedzi kalendarza
// @match        https://riventia.margonem.pl/*
// @match        http://riventia.margonem.pl/*
// @match        https://www.margonem.pl/profile/view,*
// @match        http://www.margonem.pl/profile/view,*
// @match        https://margonem.pl/profile/view,*
// @match        http://margonem.pl/profile/view,*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @updateURL     https://raw.githubusercontent.com/wikibuch1-wq/vickness-addon-panel/main/userscript/vickness-addon-panel.user.js
// @downloadURL   https://raw.githubusercontent.com/wikibuch1-wq/vickness-addon-panel/main/userscript/vickness-addon-panel.user.js
// @connect      discord.com
// @connect      discordapp.com
// @connect      micc.garmory-cdn.cloud
// @connect      api.lootlog.pl
// @connect      lootlog.pl
// @connect      www.margonem.pl
// @connect      staticinfo.margonem.pl
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Izolacja stron profili: jeśli w Tampermonkey pozostała starsza kopia dodatków,
// jej panele nie powinny zasłaniać profilu. Moduły nowej wersji i tak nie uruchamiają się tutaj.
(() => {
  const hostIsProfile = /^(?:www\.)?margonem\.pl$/i.test(location.hostname)
    && /^\/profile(?:\/|$)/i.test(location.pathname);
  if (!hostIsProfile) return;
  const installIsolationStyle = () => {
    if (document.getElementById('__vicknessProfileIsolationStyle')) return;
    const style = document.createElement('style');
    style.id = '__vicknessProfileIsolationStyle';
    style.textContent = `
      #vicknessStandaloneRoot, #vxStandalonePanel, #vxStandaloneMini,
      #margDc221Panel, #margDc221Mini, #tmLootPanel,
      #vickness-lootbar, #rtt-panel, #mlc513-panel, #tc-online-panel,
      #margonem-map-dimmer-panel, #vicknessStandalonePanel,
      #vicknessAddonPanel, #vickness-addon-panel, #vickness-loot-glow-panel {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement)?.appendChild(style);
  };
  installIsolationStyle();
  // Strona może doładowywać elementy dynamicznie; CSS przykrywa także panele
  // tworzone później przez starsze kopie skryptów.
  if (document.documentElement && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(installIsolationStyle);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }
})();

// Stan dodatków gry istnieje wyłącznie na Riventii.
if (location.hostname === 'riventia.margonem.pl') {
    window.__vicknessAddonEnabled = window.__vicknessAddonEnabled || { loot: true, dc: true, lootlog: true, titan: true, lootChance: true, crewOnline: true, profileFinder: true, wnm: true, rankChat: true, itemChat: true };
}

// =============================================================
// GLOBALNA OCHRONA PRZELOGOWANIA — wspólna dla wszystkich dodatków
// Nie blokuje kliknięć ani nawigacji gry; tylko wstrzymuje pracę modułów.
if (location.hostname === 'riventia.margonem.pl' && window.top === window.self) {
  (() => {
    const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const state = window.__vicknessRelogGuard || (window.__vicknessRelogGuard = {
      paused: false,
      awaitingCharacter: false,
      sawLogoff: false,
      stableSince: 0,
      heroKey: ''
    });
    const STABLE_DELAY = 7000;

    const getHeroKey = () => {
      const engine = PAGE.Engine;
      const hero = engine?.hero?.d;
      if (!engine || engine.logOff || !hero) return '';
      const id = hero.id ?? hero.nick ?? hero.name;
      if (id == null) return '';
      return `${String(id)}@${String(engine.world ?? engine.worldName ?? '')}`;
    };

    const beginPause = () => {
      state.paused = true;
      state.awaitingCharacter = true;
      state.sawLogoff = false;
      state.stableSince = 0;
    };

    // Rozpoznaje wyłącznie akcję przelogowania; nie zatrzymuje ani nie anuluje kliknięcia.
    document.addEventListener('click', event => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      let depth = 0;
      for (const node of path) {
        if (!(node instanceof Element)) continue;
        if (++depth > 5) break;
        const rawText = [
          node.getAttribute('aria-label'),
          node.getAttribute('title'),
          node.getAttribute('data-action'),
          node.textContent
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        // Nie analizuj dużych kontenerów (np. całego menu lub strony).
        if (rawText.length <= 120 &&
            /(przeloguj|zmień postać|zmien postac|wybierz postać|wybierz postac)/i.test(rawText)) {
          beginPause();
          break;
        }
        if (node.matches('button,a,[role="button"],input,[onclick]')) break;
      }
    }, true);

    const initialKey = getHeroKey();
    if (initialKey) state.heroKey = initialKey;

    const monitor = () => {
      const engine = PAGE.Engine;
      const key = getHeroKey();

      if (engine?.logOff || !key) {
        if (!state.awaitingCharacter) beginPause();
        state.paused = true;
        state.awaitingCharacter = true;
        state.sawLogoff = true;
        state.stableSince = 0;
        return;
      }

      if (!state.awaitingCharacter) {
        if (state.heroKey && key !== state.heroKey) {
          beginPause();
          state.stableSince = Date.now();
        }
        state.heroKey = key;
        return;
      }

      // Po rozpoczęciu przelogowania czekamy na nową/ponownie załadowaną postać.
      if (!state.sawLogoff && state.heroKey && key === state.heroKey) return;
      if (!state.stableSince || key !== state.heroKey) {
        state.heroKey = key;
        state.stableSince = Date.now();
        return;
      }

      if (Date.now() - state.stableSince >= STABLE_DELAY) {
        state.paused = false;
        state.awaitingCharacter = false;
        state.sawLogoff = false;
        state.stableSince = 0;
      }
    };

    window.__vicknessShouldPauseAddons = () => {
      try {
        if (PAGE.Engine?.logOff) {
          if (!state.awaitingCharacter) beginPause();
          state.sawLogoff = true;
          state.paused = true;
        }
      } catch (_) {}
      return !!state.paused;
    };

    window.setInterval(monitor, 250);
    window.addEventListener('pagehide', () => {
      state.paused = true;
    }, { once: true });
  })();
}

// Wszystkie moduły gry, panel oraz belki działają wyłącznie na Riventii.
if (location.hostname === 'riventia.margonem.pl') {

(function () {
    'use strict';

    if (location.hostname !== 'riventia.margonem.pl') return;
    if (window.top !== window.self) return;

    const VERSION = '2.2.1';
    const STORAGE_KEY = 'marg_dc_riventia_221';
    const OLD_STORAGE_KEYS = [
        'marg_dc_riventia_220',
        'marg_dc_riventia_219',
        'marg_dc_riventia_218',
        'marg_dc_riventia_217',
        'marg_dc_riventia_215',
        'marg_dc_riventia_213'
    ];

    const NPC_ICON_URL = 'https://micc.garmory-cdn.cloud/obrazki/npc/';
    const SPECIAL_NPC_FALLBACK_IMAGE = 'https://micc.garmory-cdn.cloud/obrazki/npc/oev/grzyb_eve_npc1.gif';
    const SCAN_INTERVAL = 3500;

    const SPECIAL_NPCS = new Set([
        'ogromna płomiennica tląca',
        'ogromny bulwiak pospolity',
        'ogromny mroźlarz',
        'ogromna dzwonkówka tarczowata',
        'ogromny szpicak ponury',
        'tropiciel herosów',
        'wtajemniczony tropiciel herosów',
        'doświadczony tropiciel herosów'
    ]);

    let state = {
        webhook: '',
        auto: true,
        panelX: 20,
        panelY: 120,
        miniX: 20,
        miniY: 120,
        minimized: true
    };

    try {
        let saved = GM_getValue(STORAGE_KEY, null);

        if (!saved) {
            for (const oldKey of OLD_STORAGE_KEYS) {
                saved = GM_getValue(oldKey, null);
                if (saved) break;
            }
        }

        if (saved && typeof saved === 'object') {
            state = { ...state, ...saved };

            if (!Object.prototype.hasOwnProperty.call(saved, 'miniX')) {
                state.miniX = Number(saved.panelX) || 20;
            }

            if (!Object.prototype.hasOwnProperty.call(saved, 'miniY')) {
                state.miniY = Number(saved.panelY) || 120;
            }
        }
    } catch (e) {}

    let panel = null;
    let mini = null;
    let webhookInput = null;
    let statusElement = null;
    let modeButton = null;

    let currentDetection = null;
    let activePopup = null;
    let popupTimer = null;
    let npcHooked = false;
    let dragging = false;

    const npcCache = new Map();
    const handled = new Map();
    const sent = new Set();

    // =========================================================
    // POMOCNICZE
    // =========================================================

    function clean(value) {
        return String(value ?? '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function norm(value) {
        return clean(value)
            .toLocaleLowerCase('pl-PL')
            .replace(/\s+/g, ' ');
    }

    function levelOf(value) {
        const match = String(value ?? '').match(/\d+/);
        return match ? Number(match[0]) : null;
    }

    function numberOf(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }

        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function isSpecial(name) {
        return SPECIAL_NPCS.has(norm(name));
    }

    function classifyWT(wt) {
        wt = Number(wt);

        if (!Number.isFinite(wt)) return null;

        if (wt > 99) {
            return { type: 'tytan', label: 'Tytan' };
        }

        if (wt > 79 && wt <= 99) {
            return { type: 'heros', label: 'Heros' };
        }

        return null;
    }

    function saveState() {
        try {
            GM_setValue(STORAGE_KEY, {
                webhook: state.webhook || '',
                auto: !!state.auto,
                panelX: Number(state.panelX) || 20,
                panelY: Number(state.panelY) || 120,
                miniX: Number.isFinite(Number(state.miniX))
                    ? Number(state.miniX)
                    : (Number(state.panelX) || 20),
                miniY: Number.isFinite(Number(state.miniY))
                    ? Number(state.miniY)
                    : (Number(state.panelY) || 120),
                minimized: !!state.minimized
            });
        } catch (e) {}
    }

    function setStatus(message, kind) {
        if (!statusElement) return;

        statusElement.textContent = message;
        statusElement.className = kind || '';
    }

    // =========================================================
    // PANEL I PRZYCISK DC
    // =========================================================

    function addCSS() {
        if (document.getElementById('margDc221CSS')) return;

        const style = document.createElement('style');
        style.id = 'margDc221CSS';

        style.textContent = `
            /* Kompaktowe, mniejsze okno wykrywacza DC */
            #margDc221Panel {
                position:fixed;
                left:20px;
                top:120px;
                width:245px;
                max-width:calc(100vw - 12px);
                box-sizing:border-box;
                z-index:2147483647;
                color:#fff;
                background:rgba(12,12,12,.97);
                border:1px solid #d4af37;
                border-radius:8px;
                box-shadow:0 4px 14px rgba(0,0,0,.6);
                font:11px Arial,sans-serif;
                user-select:none;
            }

            #margDc221Header {
                min-height:27px;
                box-sizing:border-box;
                padding:0 6px;
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:5px;
                background:#191919;
                border-radius:7px 7px 0 0;
                cursor:move;
            }

            #margDc221Title {
                color:#d4af37;
                font-size:12px;
                line-height:1.2;
                font-weight:bold;
            }

            #margDc221Min {
                background:transparent;
                border:0;
                color:#aaa;
                cursor:pointer;
                padding:2px 0 2px 3px;
                font-size:9px;
                white-space:nowrap;
            }

            #margDc221Body {
                padding:6px;
            }

            #margDc221Webhook {
                display:block;
                width:100%;
                height:26px;
                box-sizing:border-box;
                background:#181818;
                color:#fff;
                border:1px solid #444;
                border-radius:4px;
                padding:4px 6px;
                font-size:10px;
            }

            #margDc221Buttons {
                display:flex;
                gap:4px;
                margin-top:5px;
            }

            .margDc221Btn {
                flex:1 1 0;
                min-width:0;
                height:25px;
                padding:2px 3px;
                box-sizing:border-box;
                background:#222;
                color:#fff;
                border:1px solid #555;
                border-radius:4px;
                cursor:pointer;
                font-size:9px;
                white-space:nowrap;
            }

            .margDc221Gold {
                border-color:#d4af37;
                color:#d4af37;
            }

            #margDc221Status {
                margin-top:6px;
                min-height:0;
                padding:5px 6px;
                box-sizing:border-box;
                background:#171717;
                border-radius:4px;
                line-height:1.25;
                font-family:Arial,sans-serif!important;
                font-size:11px!important;
                color:#aaa;
                white-space:pre-wrap;
                overflow-wrap:anywhere;
            }

            #margDc221Status.good { color:#8fdb8f; }
            #margDc221Status.bad { color:#ff8f8f; }
            #margDc221Status.gold { color:#d4af37; }

            #margDc221Mini {
                position:fixed;
                width:38px;
                height:38px;
                display:flex;
                align-items:center;
                justify-content:center;
                z-index:2147483647;
                background:rgba(12,12,12,.97);
                color:#d4af37;
                border:2px solid #d4af37;
                border-radius:8px;
                font:bold 14px Arial,sans-serif;
                cursor:move;
                user-select:none;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function createPanel() {
        if (!document.documentElement) {
            setTimeout(createPanel, 50);
            return;
        }

        if (panel) return;

        addCSS();

        panel = document.createElement('div');
        panel.id = 'margDc221Panel';

        panel.innerHTML = `
            <div id="margDc221Header">
                <div id="margDc221Title">Margonem DC ${VERSION}</div>
                <button id="margDc221Min" type="button">MINIMIZUJ</button>
            </div>

            <div id="margDc221Body">
                <input
                    id="margDc221Webhook"
                    type="text"
                    placeholder="Webhook Discorda..."
                    autocomplete="off"
                >

                <div id="margDc221Buttons">
                    <button id="margDc221Save" class="margDc221Btn" type="button">
                        ZAPISZ
                    </button>

                    <button id="margDc221Mode" class="margDc221Btn" type="button">
                        AUTO
                    </button>

                    <button id="margDc221Send" class="margDc221Btn margDc221Gold" type="button">
                        ZAWOŁAJ
                    </button>
                </div>

                <div id="margDc221Status">
                    Oczekiwanie na Wykrywacz...
                </div>
            </div>
        `;

        document.documentElement.appendChild(panel);

        webhookInput = document.getElementById('margDc221Webhook');
        statusElement = document.getElementById('margDc221Status');
        modeButton = document.getElementById('margDc221Mode');

        webhookInput.value = state.webhook || '';

        document.getElementById('margDc221Save').addEventListener('click', () => {
            state.webhook = clean(webhookInput.value);
            saveState();

            setStatus(
                state.webhook ? 'Webhook zapisany.' : 'Webhook pusty.',
                state.webhook ? 'good' : 'bad'
            );
        });

        document.getElementById('margDc221Min').addEventListener('click', minimize);
        document.getElementById('margDc221Send').addEventListener('click', sendCurrent);

        modeButton.addEventListener('click', () => {
            state.auto = !state.auto;
            saveState();
            updateMode();

            if (state.auto && currentDetection) {
                sendDiscord(currentDetection);
            }
        });

        updateMode();

        setupDrag(
            document.getElementById('margDc221Header'),
            panel,
            'panel'
        );

        createMini();
        minimize();
    }

    function createMini() {
        if (mini) return;

        mini = document.createElement('div');
        mini.id = 'margDc221Mini';
        mini.textContent = 'DC';

        document.documentElement.appendChild(mini);

        mini.addEventListener('click', () => {
            if (!dragging) expand();
        });

        setupDrag(mini, mini, 'mini');

        mini.style.left = `${state.miniX}px`;
        mini.style.top = `${state.miniY}px`;
    }

    function updateMode() {
        if (!modeButton) return;

        modeButton.textContent = state.auto ? 'AUTO' : 'RĘCZNY';
        modeButton.classList.toggle('margDc221Gold', state.auto);
    }

    function minimize() {
        if (!panel || !mini) return;

        const rect = panel.getBoundingClientRect();

        if (Number.isFinite(rect.left)) state.panelX = Math.round(rect.left);
        if (Number.isFinite(rect.top)) state.panelY = Math.round(rect.top);

        state.minimized = true;
        panel.dataset.vicknessPopupOpen = '0';
        mini.dataset.vicknessPopupMini = '1';

        panel.style.display = 'none';
        mini.style.display = 'flex';

        mini.style.left = `${state.miniX}px`;
        mini.style.top = `${state.miniY}px`;

        saveState();
    }

    function expand() {
        if (!panel || !mini) return;

        state.minimized = false;
        panel.dataset.vicknessPopupOpen = '1';
        mini.dataset.vicknessPopupMini = '0';

        mini.style.display = 'none';
        panel.style.display = 'block';

        panel.style.left = `${state.panelX}px`;
        panel.style.top = `${state.panelY}px`;

        saveState();
    }

    // Publiczne metody wyłącznie do sterowania osobnym oknem DC przez panel Vickness.
    window.__vicknessExpandDCPanel = expand;
    window.__vicknessMinimizeDCPanel = minimize;

    function setupDrag(handle, element, target) {
        if (!handle || !element) return;

        handle.addEventListener('mousedown', e => {
            if (e.button !== undefined && e.button !== 0) return;

            const rect = element.getBoundingClientRect();
            const ox = e.clientX - rect.left;
            const oy = e.clientY - rect.top;
            const sx = e.clientX;
            const sy = e.clientY;

            dragging = false;

            function move(ev) {
                if (
                    Math.abs(ev.clientX - sx) > 3 ||
                    Math.abs(ev.clientY - sy) > 3
                ) {
                    dragging = true;
                }

                const x = Math.max(
                    0,
                    Math.min(ev.clientX - ox, window.innerWidth - element.offsetWidth)
                );

                const y = Math.max(
                    0,
                    Math.min(ev.clientY - oy, window.innerHeight - element.offsetHeight)
                );

                element.style.left = `${x}px`;
                element.style.top = `${y}px`;

                if (target === 'mini') {
                    state.miniX = x;
                    state.miniY = y;
                } else {
                    state.panelX = x;
                    state.panelY = y;
                }
            }

            function stop() {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', stop);

                saveState();

                setTimeout(() => {
                    dragging = false;
                }, 50);
            }

            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', stop);
        });
    }

    // =========================================================
    // API NPC
    // =========================================================

    function getAPI() {
        try {
            if (typeof unsafeWindow !== 'undefined') {
                return unsafeWindow.API || null;
            }
        } catch (e) {}

        try {
            return window.API || null;
        } catch (e) {
            return null;
        }
    }

    function registerNPC(npc) {
        if (!npc) return;

        const d = npc.d || npc.data || npc;
        if (!d) return;

        const name = clean(d.nick || d.name || npc.nick || npc.name);
        if (!name) return;

        const special = isSpecial(name);
        const classification = classifyWT(d.wt ?? npc.wt);

        if (!classification && !special) return;

        const record = {
            name,
            level: levelOf(d.lvl ?? d.level ?? npc.lvl ?? npc.level),
            x: numberOf(d.x ?? npc.x),
            y: numberOf(d.y ?? npc.y),
            wt: numberOf(d.wt ?? npc.wt),
            icon: d.icon || npc.icon || '',
            id: d.id ?? npc.id ?? null,

            classification: classification || {
                type: 'special',
                label: 'Grzybek'
            }
        };

        const key = [
            norm(record.name),
            record.level ?? '',
            record.x ?? '',
            record.y ?? ''
        ].join('|');

        npcCache.set(key, record);

        if (currentDetection) {
            resolveDetection(currentDetection);
        }
    }

    function onNpcDeleted(npc) {
        if (!currentDetection || !npc) return;

        const d = npc.d || npc.data || npc;
        const name = d.nick || d.name || npc.nick || npc.name;
        const x = numberOf(d.x ?? npc.x);
        const y = numberOf(d.y ?? npc.y);
        const id = d.id ?? npc.id ?? null;

        if (
            id != null &&
            currentDetection.id != null &&
            String(id) === String(currentDetection.id)
        ) {
            hideAfterDeath();
            return;
        }

        if (
            name &&
            norm(name) === norm(currentDetection.name) &&
            x === numberOf(currentDetection.x) &&
            y === numberOf(currentDetection.y)
        ) {
            hideAfterDeath();
        }
    }

    function hookNPC() {
        if (npcHooked) return;

        let tries = 0;

        const timer = setInterval(() => {
            if (window.__vicknessShouldPauseAddons?.()) return;
            tries++;

            const API = getAPI();

            if (!API) {
                if (tries >= 60) clearInterval(timer);
                return;
            }

            try {
                API.addCallbackToEvent('newNpc', registerNPC);

                try {
                    API.addCallbackToEvent('delNpc', onNpcDeleted);
                } catch (e) {}

                npcHooked = true;
                clearInterval(timer);
            } catch (e) {
                if (tries >= 60) clearInterval(timer);
            }
        }, 500);
    }

    function findNPC(detection) {
        const wanted = norm(detection.name);
        const level = levelOf(detection.level);
        const x = numberOf(detection.x);
        const y = numberOf(detection.y);

        const exact = [
            wanted,
            level ?? '',
            x ?? '',
            y ?? ''
        ].join('|');

        if (npcCache.has(exact)) {
            return npcCache.get(exact);
        }

        for (const npc of npcCache.values()) {
            if (norm(npc.name) !== wanted) continue;

            if (
                level !== null &&
                npc.level !== null &&
                npc.level !== level
            ) continue;

            if (x !== null && npc.x !== null && npc.x !== x) continue;
            if (y !== null && npc.y !== null && npc.y !== y) continue;

            return npc;
        }

        if (isSpecial(detection.name)) {
            for (const npc of npcCache.values()) {
                if (norm(npc.name) === wanted) return npc;
            }
        }

        return null;
    }

    // =========================================================
    // PARSER WYKRYWACZA
    // =========================================================

    function parsePopup(element) {
        if (!element) return null;

        const content = (element.textContent || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r/g, '');

        if (!/Wykrywanie\s+na\s+mapie/i.test(content)) return null;

        const nameMatch = content.match(
            /([^\n]+?)\s*\((\d+)\s*[a-zA-Z]?\)/
        );

        if (!nameMatch) return null;

        const name = clean(nameMatch[1]);
        const level = Number(nameMatch[2]);

        const coords = [
            ...content.matchAll(
                /\(\s*(-?\d+)\s*[,;]\s*(-?\d+)\s*\)/g
            )
        ];

        if (!coords.length) return null;

        const last = coords[coords.length - 1];
        const x = Number(last[1]);
        const y = Number(last[2]);

        let map = content.substring(
            nameMatch.index + nameMatch[0].length
        );

        const coordIndex = map.search(
            /\(\s*-?\d+\s*[,;]\s*-?\d+\s*\)/
        );

        if (coordIndex >= 0) {
            map = map.substring(0, coordIndex);
        }

        map = clean(map)
            .replace(/\bs\.\s*\d+\b/gi, '')
            .replace(/\bPodejdź\b/gi, '')
            .replace(/\bPodejdz\b/gi, '')
            .replace(/\bIdź\b/gi, '')
            .replace(/\bIdz\b/gi, '')
            .replace(/\bPrzejdź\b/gi, '')
            .replace(/\bPrzejdz\b/gi, '')
            .replace(/\bWejdź\b/gi, '')
            .replace(/\bWejdz\b/gi, '')
            .replace(/\bZamknij\b/gi, '')
            .replace(/\bPokaż\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!map) map = 'Nieznana mapa';

        /*
         * Poprawka grafiki:
         * szukamy tytułu Wykrywacza, przechodzimy do .c-window
         * i pobieramy bezpośredni adres img.icon.
         */
        const title = [...document.querySelectorAll('.text')]
            .find(el =>
                /Wykrywanie\s+na\s+mapie/i.test(el.textContent || '')
            );

        const popupRoot = element.closest?.('.c-window') || title?.closest('.c-window') || element;
        const img =
            popupRoot.querySelector('img.icon') ||
            popupRoot.querySelector('img');

        const icon = img
            ? (img.currentSrc || img.src || img.getAttribute('src') || '')
            : '';

        return {
            name,
            level,
            map,
            x,
            y,
            icon,
            popup: popupRoot
        };
    }

    function findDetectorPopup() {
        if (!document.body) return null;

        // Znajdź tytuł Wykrywacza i zwróć całe okno, nie sam nagłówek.
        const titles = [...document.querySelectorAll('.text')];
        const title = titles.find(el =>
            /Wykrywanie\s+na\s+mapie/i.test(el.textContent || '')
        );

        if (title) {
            const win = title.closest('.c-window');
            if (win) return win;
        }

        // Awaryjnie szukaj tytułu jako tekstu i spróbuj znaleźć okno nadrzędne.
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT
        );
        let node;
        while ((node = walker.nextNode())) {
            if (!/Wykrywanie\s+na\s+mapie/i.test(clean(node.nodeValue))) continue;
            const win = node.parentElement?.closest('.c-window');
            if (win) return win;
        }
        return null;
    }

    // =========================================================
    // FILTR NPC
    // =========================================================

    function classifyPopupCandidate(name) {
        if (isSpecial(name)) return true;

        for (const npc of npcCache.values()) {
            if (
                norm(npc.name) === norm(name) &&
                npc.classification &&
                (
                    npc.classification.type === 'heros' ||
                    npc.classification.type === 'tytan'
                )
            ) {
                return true;
            }
        }

        return false;
    }

    function processPopup(popup) {
        if (window.__vicknessAddonEnabled && !window.__vicknessAddonEnabled.dc) return;
        if (!popup) return;

        const detection = parsePopup(popup);
        if (!detection) return;

        if (!classifyPopupCandidate(detection.name)) return;

        const key = [
            norm(detection.name),
            detection.level,
            detection.x,
            detection.y
        ].join('|');

        const old = handled.get(key);

        if (old && old.isConnected) {
            activePopup = old;
            return;
        }

        handled.set(key, popup);
        activePopup = popup;
        currentDetection = detection;

        setStatus(
            `Wykryto: ${detection.name} (${detection.level}) — sprawdzam dane...`,
            'gold'
        );

        resolveDetection(detection);
    }

    function resolveDetection(detection) {
        if (window.__vicknessAddonEnabled && !window.__vicknessAddonEnabled.dc) return;
        if (!detection) return;

        const npc = findNPC(detection);
        const special = isSpecial(detection.name);

        if (!npc && !special) {
            setStatus(
                `Wykryto ${detection.name}, czekam na dane NPC...`,
                'gold'
            );
            return;
        }

        const classification = npc?.classification ||
            (special
                ? { type: 'special', label: 'Grzybek' }
                : null);

        if (!classification) return;

        const record = {
            name: npc?.name || detection.name,
            level: npc?.level ?? detection.level,
            map: detection.map,
            x: npc?.x ?? detection.x,
            y: npc?.y ?? detection.y,
            wt: npc?.wt ?? null,

            // Najpierw grafika z okienka Wykrywacza.
            icon: detection.icon || npc?.icon || (special ? SPECIAL_NPC_FALLBACK_IMAGE : ''),

            classification,
            id: npc?.id ?? null
        };

        currentDetection = record;

        // Po rozpoznaniu NPC pokaż osobne okno DC, bez otwierania całego panelu Vickness.
        if (typeof window.__vicknessOpenDCWindow === 'function') {
            window.__vicknessOpenDCWindow();
        } else {
            // Wykrywanie mogło zakończyć się przed startem menedżera Vickness.
            window.__vicknessPendingOpenDCWindow = true;
        }

        setStatus(
            `${record.classification.label}: ${record.name}\n` +
            `${record.map} | lvl ${record.level} | (${record.x}, ${record.y})`,
            'good'
        );

        if (state.auto) {
            sendDiscord(record);
        }
    }

    // =========================================================
    // DISCORD
    // =========================================================

    function getNpcImage(record) {
        if (!record) return '';
        if (!record.icon && isSpecial(record.name)) return SPECIAL_NPC_FALLBACK_IMAGE;
        if (!record.icon) return '';

        const icon = String(record.icon).trim();
        if (!icon) return '';

        if (/^https?:\/\//i.test(icon)) return icon;

        if (icon.startsWith('//')) {
            return location.protocol + icon;
        }

        const filename = icon
            .replace(/^\/+/, '')
            .replace(/^obrazki\/npc\//i, '')
            .replace(/^npc\//i, '');

        return NPC_ICON_URL + filename;
    }

    function sendDiscord(record) {
        if (window.__vicknessAddonEnabled && !window.__vicknessAddonEnabled.dc) return;
        const webhook = clean(
            webhookInput ? webhookInput.value : state.webhook
        );

        if (!webhook) {
            setStatus(
                'Brak webhooka Discord. Wpisz go i kliknij ZAPISZ.',
                'bad'
            );
            return;
        }

        if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(webhook)) {
            setStatus('Webhook wygląda na nieprawidłowy.', 'bad');
            return;
        }

        state.webhook = webhook;
        saveState();

        const key = [
            norm(record.name),
            record.level ?? '',
            norm(record.map),
            record.x ?? '',
            record.y ?? ''
        ].join('|');

        if (sent.has(key)) {
            setStatus(`Ten wpis został już wysłany: ${record.name}`, 'gold');
            return;
        }

        sent.add(key);

        const npcImage = getNpcImage(record);
        const embed = {
            title: `${record.classification.label}: ${record.name}`,
            description:
                `**Mapa:** ${record.map}\n` +
                `**Poziom:** ${record.level ?? '?'}\n` +
                `**Pozycja:** (${record.x ?? '?'}, ${record.y ?? '?'})`,
            footer: { text: `Margonem Wykrywacz ${VERSION}` },
            timestamp: new Date().toISOString()
        };

        const payload = {
            content: '@here',
            allowed_mentions: { parse: ['everyone'] },
            embeds: [embed]
        };

        setStatus(
            npcImage
                ? `Pobieram grafikę NPC i wysyłam ${record.name}...`
                : `Wysyłam ${record.name} bez grafiki...`,
            'gold'
        );

        // Wysyłamy grafikę jako plik do Discorda. To omija problem,
        // gdy Discord nie potrafi pobrać obrazka bezpośrednio z CDN Margonem.
        function postPayload(imageBlob) {
            const finalPayload = JSON.parse(JSON.stringify(payload));
            const form = new FormData();

            if (imageBlob) {
                finalPayload.embeds[0].image = { url: 'attachment://npc.gif' };
                form.append('files[0]', imageBlob, 'npc.gif');
            }

            form.append('payload_json', JSON.stringify(finalPayload));

            GM_xmlhttpRequest({
                method: 'POST',
                url: webhook,
                data: form,
                timeout: 20000,
                onload(response) {
                    if (response.status >= 200 && response.status < 300) {
                        setStatus(
                            imageBlob
                                ? `✓ Wysłano: ${record.name} (GIF załączony)`
                                : `✓ Wysłano: ${record.name} (bez grafiki — nie udało się pobrać pliku)`,
                            imageBlob ? 'good' : 'gold'
                        );
                    } else {
                        sent.delete(key);
                        setStatus(
                            `Discord HTTP ${response.status}. Sprawdź webhook.`,
                            'bad'
                        );
                    }
                },
                onerror() {
                    sent.delete(key);
                    setStatus('Błąd połączenia z Discordem.', 'bad');
                },
                ontimeout() {
                    sent.delete(key);
                    setStatus('Discord: przekroczono czas oczekiwania.', 'bad');
                }
            });
        }

        if (!npcImage) {
            postPayload(null);
            return;
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url: npcImage,
            responseType: 'blob',
            timeout: 15000,
            onload(response) {
                if (response.status >= 200 && response.status < 300 && response.response) {
                    const blob = response.response instanceof Blob
                        ? response.response
                        : new Blob([response.response], { type: 'image/gif' });
                    postPayload(blob);
                } else {
                    // Gdy pobranie pliku nie powiedzie się, wyślij przynajmniej embed.
                    postPayload(null);
                }
            },
            onerror() {
                postPayload(null);
            },
            ontimeout() {
                postPayload(null);
            }
        });
    }

    function sendCurrent() {
        if (!currentDetection) {
            setStatus(
                'Nie wykryto jeszcze NPC z listy, Herosa ani Tytana.',
                'bad'
            );
            return;
        }

        sendDiscord(currentDetection);
    }

    // =========================================================
    // CHOWANIE PO ZNIKNIĘCIU WPISU
    // =========================================================

    function hideAfterDeath() {
        currentDetection = null;
        activePopup = null;

        if (panel && mini) {
            minimize();
        }

        // Po zniknięciu wykrytego wpisu minimalizujemy tylko okno DC.
        // Główny panel Vickness pozostaje w dotychczasowym stanie.

        if (statusElement) {
            setStatus(
                'Wpis zniknął. Oczekiwanie na kolejnego NPC...',
                'gold'
            );
        }
    }

    // =========================================================
    // LEKKIE SKANOWANIE
    // =========================================================

    function scanForPopup() {
        if (window.__vicknessShouldPauseAddons?.()) return;
        if (window.__vicknessAddonEnabled && !window.__vicknessAddonEnabled.dc) return;
        if (activePopup && activePopup.isConnected) return;

        const popup = findDetectorPopup();
        if (popup) processPopup(popup);
    }

    function startPolling() {
        if (popupTimer) clearInterval(popupTimer);

        setTimeout(scanForPopup, 700);

        popupTimer = setInterval(
            scanForPopup,
            SCAN_INTERVAL
        );

        setInterval(() => {
            if (window.__vicknessShouldPauseAddons?.()) return;
            if (activePopup && !activePopup.isConnected) {
                hideAfterDeath();
            }

            for (const [key, element] of handled) {
                if (!element || !element.isConnected) {
                    handled.delete(key);
                }
            }
        }, 2500);
    }

    // =========================================================
    // START
    // =========================================================

    function start() {
        if (location.hostname !== 'riventia.margonem.pl') return;

        createPanel();
        hookNPC();
        startPolling();
    }

    if (document.documentElement) {
        start();
    } else {
        document.addEventListener(
            'DOMContentLoaded',
            start,
            { once: true }
        );
    }
})();

(() => {
    'use strict';

    const SETTINGS_KEY = 'tm_loot_settings_v8';
    const POSITION_KEY = 'tm_loot_position_v4';
    const OLD_POSITION_KEY = 'tm_loot_position_v3';
    const COLLAPSED_KEY = 'tm_loot_collapsed_v3';

    const RARITIES = [
        'heroic',
        'unique',
        'legendary',
        'common'
    ];

    const DEFAULTS = {
        heroic: true,
        unique: true,
        legendary: true,
        common: true,

        highlightTime: 5000,

        colors: {
            heroic: '#69d9ff',
            unique: '#ffd73c',
            legendary: '#ff4545',
            common: '#a9a9a9'
        },

        intensity: {
            heroic: 100,
            unique: 100,
            legendary: 100,
            common: 100
        }
    };

    // Prawdziwy geometryczny diament
    const diamondSVG = `
        <svg viewBox="0 0 32 32"
             xmlns="http://www.w3.org/2000/svg"
             aria-hidden="true">

            <polygon
                points="16,3 28,11 22,28 10,28 4,11"
                fill="#050505"
                stroke="#d4af37"
                stroke-width="1.8"
                stroke-linejoin="round"
            />

            <polyline
                points="4,11 16,13 28,11"
                fill="none"
                stroke="#f2d16b"
                stroke-width="1.4"
            />

            <polyline
                points="10,28 16,13 22,28"
                fill="none"
                stroke="#b38b20"
                stroke-width="1.2"
            />

            <polyline
                points="16,3 16,13"
                fill="none"
                stroke="#ffe28a"
                stroke-width="1.2"
            />
        </svg>
    `;

    let settings = loadSettings();
    let dragged = false;

    injectStyles();
    createPanel();
    startLootListener();

    // ==========================================
    // USTAWIENIA
    // ==========================================

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function loadSettings() {
        try {
            const saved =
                JSON.parse(
                    localStorage.getItem(SETTINGS_KEY)
                ) ||
                JSON.parse(
                    localStorage.getItem('tm_loot_settings_v7')
                );

            if (!saved) {
                return clone(DEFAULTS);
            }

            return mergeDefaults(saved);

        } catch (e) {
            console.warn(
                'Loot Glow: błąd odczytu ustawień',
                e
            );

            return clone(DEFAULTS);
        }
    }

    function mergeDefaults(saved) {
        const result = clone(DEFAULTS);

        for (const rarity of RARITIES) {
            if (typeof saved[rarity] === 'boolean') {
                result[rarity] = saved[rarity];
            }
        }

        if (
            Number.isFinite(
                Number(saved.highlightTime)
            )
        ) {
            result.highlightTime =
                Number(saved.highlightTime);
        }

        result.colors = {
            ...DEFAULTS.colors,
            ...(saved.colors || {})
        };

        result.intensity = {
            ...DEFAULTS.intensity,
            ...(saved.intensity || {})
        };

        for (const rarity of RARITIES) {
            let value =
                Number(result.intensity[rarity]);

            if (!Number.isFinite(value)) {
                value = 100;
            }

            result.intensity[rarity] =
                Math.max(0, Math.min(200, value));
        }

        return result;
    }

    function saveSettings() {
        localStorage.setItem(
            SETTINGS_KEY,
            JSON.stringify(settings)
        );
    }

    // ==========================================
    // PANEL LOOT
    // ==========================================

    function createPanel() {
        document
            .getElementById('tmLootPanel')
            ?.remove();

        const panel =
            document.createElement('div');

        panel.id = 'tmLootPanel';

        const pos = loadPanelPosition();

        panel.style.left = `${pos.left}px`;
        panel.style.top = `${pos.top}px`;

        panel.innerHTML = `
            <div id="tmLootHeader">

                <span class="tmBrand">

                    <span class="tmDiamondIcon">
                        ${diamondSVG}
                    </span>

                    <span class="tmBrandText">
                        Loot Glow V 2.0 By Vickness
                    </span>

                </span>

                <button id="tmLootCollapse">−</button>

            </div>

            <div id="tmLootBody">

                <div class="tmTabs">
                    <div class="tmTab active">
                        💎 LOOT
                    </div>
                </div>

                <div id="tmTabLoot">

                    ${createRarityRow(
                        'heroic',
                        'Heroiczny'
                    )}

                    ${createRarityRow(
                        'unique',
                        'Unikatowy'
                    )}

                    ${createRarityRow(
                        'legendary',
                        'Legendarny'
                    )}

                    ${createRarityRow(
                        'common',
                        'Pospolity'
                    )}

                    <div class="tmSettingLine">

                        <label>
                            Czas podświetlenia:
                        </label>

                        <select id="tmHighlightTime">

                            <option value="3000">3 sek</option>
                            <option value="5000">5 sek</option>
                            <option value="10000">10 sek</option>
                            <option value="15000">15 sek</option>
                            <option value="30000">30 sek</option>

                        </select>

                    </div>

                </div>

            </div>
        `;

        document.body.appendChild(panel);

        setPanelValues();
        setupControls();
        setupDrag();

        if (
            localStorage.getItem(COLLAPSED_KEY) === '1'
        ) {
            setCollapsed(true);
        }

        setTimeout(
            clampPanelToViewport,
            100
        );
    }

    function createRarityRow(rarity, label) {
        return `
            <div class="tmRarityRow">

                <div class="tmRarityTop">

                    <span class="tmRarityName">
                        ${label}
                    </span>

                    <input
                        type="color"
                        id="tmColor_${rarity}"
                        title="Kolor podświetlenia"
                    >

                    <label class="tmSwitch">

                        <input
                            type="checkbox"
                            id="tmToggle_${rarity}"
                        >

                        <span></span>

                    </label>

                </div>

                <div class="tmIntensityRow">

                    <span>Siła:</span>

                    <input
                        type="range"
                        id="tmIntensity_${rarity}"
                        min="0"
                        max="200"
                        step="5"
                    >

                    <span
                        id="tmIntensityValue_${rarity}"
                        class="tmIntensityValue"
                    >100%</span>

                </div>

            </div>
        `;
    }

    function setPanelValues() {
        for (const rarity of RARITIES) {
            document.getElementById(
                `tmColor_${rarity}`
            ).value = settings.colors[rarity];

            document.getElementById(
                `tmToggle_${rarity}`
            ).checked = !!settings[rarity];

            document.getElementById(
                `tmIntensity_${rarity}`
            ).value = settings.intensity[rarity];

            document.getElementById(
                `tmIntensityValue_${rarity}`
            ).textContent =
                `${settings.intensity[rarity]}%`;
        }

        document.getElementById(
            'tmHighlightTime'
        ).value = settings.highlightTime;
    }

    // ==========================================
    // KONTROLKI PANELU
    // ==========================================

    function setupControls() {
        for (const rarity of RARITIES) {

            document
                .getElementById(`tmColor_${rarity}`)
                .addEventListener('input', e => {
                    settings.colors[rarity] =
                        e.target.value;

                    saveSettings();
                    refreshActiveEffects();
                });

            document
                .getElementById(`tmToggle_${rarity}`)
                .addEventListener('change', e => {
                    settings[rarity] =
                        e.target.checked;

                    saveSettings();
                });

            document
                .getElementById(`tmIntensity_${rarity}`)
                .addEventListener('input', e => {
                    settings.intensity[rarity] =
                        Number(e.target.value);

                    document.getElementById(
                        `tmIntensityValue_${rarity}`
                    ).textContent =
                        `${settings.intensity[rarity]}%`;

                    saveSettings();
                    refreshActiveEffects();
                });
        }

        document
            .getElementById('tmHighlightTime')
            .addEventListener('change', e => {
                settings.highlightTime =
                    Number(e.target.value);

                saveSettings();
            });
    }

    // ==========================================
    // PRZESUWANIE I ZWIJANIE PANELU
    // ==========================================

    function setupDrag() {
        const panel =
            document.getElementById('tmLootPanel');

        const header =
            document.getElementById('tmLootHeader');

        const collapse =
            document.getElementById('tmLootCollapse');

        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;

        header.addEventListener('mousedown', e => {
            if (e.button !== 0) {
                return;
            }

            dragged = false;

            startX = e.clientX;
            startY = e.clientY;

            const rect = panel.getBoundingClientRect();

            startLeft = rect.left;
            startTop = rect.top;

            function onMove(ev) {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;

                if (
                    Math.abs(dx) > 2 ||
                    Math.abs(dy) > 2
                ) {
                    dragged = true;
                }

                panel.style.left =
                    `${startLeft + dx}px`;

                panel.style.top =
                    `${startTop + dy}px`;

                clampPanelToViewport();
            }

            function onUp() {
                document.removeEventListener(
                    'mousemove',
                    onMove
                );

                document.removeEventListener(
                    'mouseup',
                    onUp
                );

                savePanelPosition();
            }

            document.addEventListener(
                'mousemove',
                onMove
            );

            document.addEventListener(
                'mouseup',
                onUp
            );

            e.preventDefault();
        });

        collapse.addEventListener('click', () => {
            if (dragged) {
                dragged = false;
                return;
            }

            setCollapsed(
                !panel.classList.contains('tmCollapsed')
            );
        });
    }

    function setCollapsed(value) {
        const panel =
            document.getElementById('tmLootPanel');

        const body =
            document.getElementById('tmLootBody');

        const button =
            document.getElementById('tmLootCollapse');

        if (value) {
            panel.classList.add('tmCollapsed');

            body.style.display = 'none';

            button.innerHTML = `
                <span class="tmDiamondIcon">
                    ${diamondSVG}
                </span>
            `;

            localStorage.setItem(
                COLLAPSED_KEY,
                '1'
            );

        } else {
            panel.classList.remove('tmCollapsed');

            body.style.display = '';

            button.textContent = '−';

            localStorage.setItem(
                COLLAPSED_KEY,
                '0'
            );
        }
    }

    function loadPanelPosition() {
        try {
            const saved =
                JSON.parse(
                    localStorage.getItem(POSITION_KEY)
                ) ||
                JSON.parse(
                    localStorage.getItem(OLD_POSITION_KEY)
                );

            if (
                saved &&
                Number.isFinite(saved.left) &&
                Number.isFinite(saved.top)
            ) {
                return saved;
            }
        } catch (e) {}

        return {
            left: 20,
            top: 120
        };
    }

    function savePanelPosition() {
        const panel =
            document.getElementById('tmLootPanel');

        if (!panel) {
            return;
        }

        const rect = panel.getBoundingClientRect();

        localStorage.setItem(
            POSITION_KEY,
            JSON.stringify({
                left: rect.left,
                top: rect.top
            })
        );
    }

    function clampPanelToViewport() {
        const panel =
            document.getElementById('tmLootPanel');

        if (!panel) {
            return;
        }

        const rect = panel.getBoundingClientRect();

        const maxLeft =
            Math.max(0, window.innerWidth - rect.width);

        const maxTop =
            Math.max(0, window.innerHeight - rect.height);

        panel.style.left =
            `${Math.max(0, Math.min(rect.left, maxLeft))}px`;

        panel.style.top =
            `${Math.max(0, Math.min(rect.top, maxTop))}px`;
    }

    window.addEventListener('resize', () => {
        clampPanelToViewport();
        savePanelPosition();
    });

    // ==========================================
    // ROZPOZNAWANIE RZADKOŚCI
    // ==========================================

    function getRarity(item) {
        if (!item) {
            return null;
        }

        const type =
            item.dataset?.itemType ||
            item.getAttribute('data-item-type');

        if (
            type === 't-her' ||
            item.classList.contains('t-her')
        ) {
            return 'heroic';
        }

        if (
            type === 't-uniupg' ||
            item.classList.contains('t-uniupg')
        ) {
            return 'unique';
        }

        if (
            type === 't-leg' ||
            item.classList.contains('t-leg')
        ) {
            return 'legendary';
        }

        if (
            type === 't-norm' ||
            item.classList.contains('t-norm')
        ) {
            return 'common';
        }

        return null;
    }

    // ==========================================
    // KOLOR I INTENSYWNOŚĆ GLOW
    // ==========================================

    function hexToRgb(hex) {
        let value = String(hex || '#ffffff')
            .replace('#', '');

        if (value.length === 3) {
            value = value
                .split('')
                .map(x => x + x)
                .join('');
        }

        const num = parseInt(value, 16);

        if (!Number.isFinite(num)) {
            return {
                r: 255,
                g: 255,
                b: 255
            };
        }

        return {
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255
        };
    }

    function setLootColor(container, rarity) {
        // Nie zmieniaj DOM ani stylów podczas przelogowywania.
        if (window.__vicknessShouldPauseAddons?.()) return;
        if (!container) {
            return;
        }

        const color =
            settings.colors[rarity] || '#ffffff';

        const rgb = hexToRgb(color);

        let intensity =
            Number(settings.intensity[rarity]);

        if (!Number.isFinite(intensity)) {
            intensity = 100;
        }

        intensity = Math.max(
            0,
            Math.min(200, intensity)
        );

        const multiplier = intensity / 100;

        container.style.setProperty(
            '--tm-loot-color',
            color
        );

        container.style.setProperty(
            '--tm-loot-color-a',
            `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.min(
                1,
                0.75 * multiplier
            )})`
        );

        container.style.setProperty(
            '--tm-loot-color-b',
            `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.min(
                1,
                0.35 * multiplier
            )})`
        );

        container.style.setProperty(
            '--tm-loot-color-c',
            `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.min(
                1,
                0.22 * multiplier
            )})`
        );
    }

    function refreshActiveEffects() {
        if (window.__vicknessShouldPauseAddons?.()) return;
        const classes = {
            heroic: 'tmHeroicLoot',
            unique: 'tmUniqueLoot',
            legendary: 'tmLegendaryLoot',
            common: 'tmCommonLoot'
        };

        for (const rarity of RARITIES) {
            document
                .querySelectorAll(`.${classes[rarity]}`)
                .forEach(el => {
                    setLootColor(el, rarity);
                });
        }
    }

    // ==========================================
    // PODŚWIETLANIE LOOTU
    // ==========================================

    function highlightLootWindow(item) {
        if (window.__vicknessShouldPauseAddons?.()) return;
        if (window.__vicknessAddonEnabled && !window.__vicknessAddonEnabled.loot) return;
        if (!item) {
            return;
        }

        if (item.classList.contains('inventory-item')) {
            return;
        }

        const rarity = getRarity(item);

        if (!rarity) {
            return;
        }

        if (!settings[rarity]) {
            return;
        }

        let container = item.parentElement;

        for (let i = 0; i < 6 && container; i++) {
            const rect = container.getBoundingClientRect();

            if (
                rect.width > 50 &&
                rect.height > 50 &&
                rect.width < 1000 &&
                rect.height < 1000
            ) {
                break;
            }

            container = container.parentElement;
        }

        if (!container) {
            container = item;
        }

        container.classList.remove(
            'tmHeroicLoot',
            'tmUniqueLoot',
            'tmLegendaryLoot',
            'tmCommonLoot'
        );

        setLootColor(container, rarity);

        const glowClasses = {
            heroic: 'tmHeroicLoot',
            unique: 'tmUniqueLoot',
            legendary: 'tmLegendaryLoot',
            common: 'tmCommonLoot'
        };

        const glowClass = glowClasses[rarity];

        container.classList.add(glowClass);

        setTimeout(() => {
            if (window.__vicknessShouldPauseAddons?.()) return;
            container.classList.remove(glowClass);
        }, settings.highlightTime);
    }

    // ==========================================
    // NASŁUCHIWANIE LOOTU
    // ==========================================

    function getLootAPI() {
        // Margonem API może istnieć w kontekście strony, a nie w sandboxie Tampermonkey.
        try {
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow.API) {
                return unsafeWindow.API;
            }
        } catch (e) {}

        try {
            if (window.API) return window.API;
        } catch (e) {}

        return null;
    }

    function startLootListener() {
        let tries = 0;
        let registered = false;

        const timer = setInterval(() => {
            if (window.__vicknessShouldPauseAddons?.()) return;
            if (registered) {
                clearInterval(timer);
                return;
            }

            tries++;
            const API = getLootAPI();

            if (API && typeof API.addCallbackToEvent === 'function') {
                try {
                    API.addCallbackToEvent('loot_update', data => {
                        if (window.__vicknessShouldPauseAddons?.()) return;
                        if (window.__vicknessAddonEnabled && !window.__vicknessAddonEnabled.loot) return;

                        const states = data && data.states && typeof data.states === 'object'
                            ? data.states
                            : {};
                        const ids = Object.keys(states);

                        if (!ids.length) return;

                        ids.forEach(id => {
                            setTimeout(() => {
                                // Zadanie mogło zostać zaplanowane tuż przed rozpoczęciem przelogowania.
                                if (window.__vicknessShouldPauseAddons?.()) return;
                                if (window.__vicknessAddonEnabled && !window.__vicknessAddonEnabled.loot) return;
                                const value = String(id);
                                let item = null;

                                try {
                                    item = document.querySelector(
                                        `.item.item-id-${CSS.escape(value)}`
                                    );
                                } catch (e) {}

                                // Fallback dla wariantów DOM, w których ID jest atrybutem.
                                if (!item) {
                                    try {
                                        item = Array.from(document.querySelectorAll('[data-item-id]'))
                                            .find(el => el.getAttribute('data-item-id') === value) || null;
                                    } catch (e) {}
                                }

                                if (item) highlightLootWindow(item);
                            }, 100);
                        });
                    });

                    registered = true;
                    clearInterval(timer);
                    console.info('Loot Glow: podłączono listener loot_update.');
                    return;
                } catch (error) {
                    console.warn('Loot Glow: nie udało się podłączyć listenera.', error);
                }
            }

            if (tries >= 120) {
                clearInterval(timer);
                console.warn('Loot Glow: nie znaleziono API.addCallbackToEvent ani w unsafeWindow, ani w window.');
            }
        }, 250);
    }


    // ==========================================
    // CZARNO-ZŁOTY WYGLĄD
    // ==========================================

    function injectStyles() {
        const style = document.createElement('style');

        style.textContent = `

            #tmLootPanel {
                position: fixed;
                z-index: 999999;
                width: 260px;
                background: linear-gradient(
                    145deg,
                    #090909 0%,
                    #181208 100%
                );
                border: 1px solid #d4af37;
                border-radius: 10px;
                color: #ffffff;
                font-family: Arial, sans-serif;
                font-size: 13px;
                box-shadow:
                    0 0 0 1px rgba(255,215,80,.08),
                    0 0 18px rgba(212,175,55,.18),
                    0 10px 35px rgba(0,0,0,.75);
                user-select: none;
            }

            #tmLootPanel.tmCollapsed {
                width: 42px;
                height: 42px;
            }

            #tmLootHeader {
                height: 38px;
                padding: 0 8px 0 10px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: linear-gradient(
                    180deg,
                    #2b2209 0%,
                    #090909 100%
                );
                border-bottom: 1px solid #8f7420;
                border-radius: 10px 10px 0 0;
                cursor: move;
                font-weight: bold;
            }

            .tmBrand {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                color: #f2d16b;
                text-shadow: 0 0 7px rgba(242,209,107,.35);
                min-width: 0;
            }

            .tmBrandText {
                white-space: nowrap;
            }

            /* Diament w czarnej ramce ze złotym obramowaniem */

            .tmDiamondIcon {
                width: 27px;
                height: 27px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                box-sizing: border-box;
                background: #050505;
                border: 2px solid #d4af37;
                border-radius: 7px;
                box-shadow:
                    0 0 5px rgba(212,175,55,.50),
                    inset 0 0 8px rgba(212,175,55,.08);
                flex: 0 0 auto;
            }

            .tmDiamondIcon svg {
                width: 20px;
                height: 20px;
                display: block;
            }

            #tmLootCollapse {
                width: 30px;
                height: 30px;
                border: 0;
                background: transparent;
                color: #f2d16b;
                font-size: 18px;
                border-radius: 6px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }

            #tmLootCollapse:hover {
                background: rgba(212,175,55,.12);
            }

            /* Złożony panel */

            #tmLootPanel.tmCollapsed #tmLootHeader {
                height: 42px;
                padding: 0;
                justify-content: center;
                border-radius: 10px;
                border-bottom: none;
                background: radial-gradient(
                    circle,
                    #382b09 0%,
                    #080808 76%
                );
            }

            #tmLootPanel.tmCollapsed
            #tmLootHeader .tmBrand {
                display: none;
            }

            #tmLootPanel.tmCollapsed #tmLootCollapse {
                width: 42px;
                height: 42px;
                margin: 0;
            }

            #tmLootPanel.tmCollapsed
            #tmLootCollapse .tmDiamondIcon {
                width: 30px;
                height: 30px;
            }

            #tmLootPanel.tmCollapsed
            #tmLootCollapse .tmDiamondIcon svg {
                width: 22px;
                height: 22px;
            }

            #tmLootBody {
                padding: 8px;
            }

            /* Jedyna zakładka: LOOT */

            .tmTabs {
                display: flex;
                gap: 5px;
                margin-bottom: 8px;
                padding-bottom: 6px;
                border-bottom: 1px solid rgba(212,175,55,.22);
            }

            .tmTab {
                flex: 1;
                padding: 7px 5px;
                border-radius: 6px;
                border: 1px solid #c9a227;
                background: linear-gradient(
                    180deg,
                    rgba(212,175,55,.24),
                    #0a0a0a
                );
                color: #f2d16b;
                font-size: 11px;
                font-weight: bold;
                text-align: center;
                box-shadow: inset 0 -1px 0 #d4af37;
            }

            /* Wiersze rzadkości */

            .tmRarityRow {
                padding: 7px;
                margin-bottom: 6px;
                border-radius: 7px;
                background: linear-gradient(
                    145deg,
                    rgba(4,4,4,.94),
                    rgba(23,19,9,.78)
                );
                border: 1px solid rgba(212,175,55,.16);
            }

            .tmRarityRow:hover {
                border-color: rgba(212,175,55,.32);
            }

            .tmRarityTop {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .tmRarityName {
                flex: 1;
                color: #f2d16b;
                font-weight: bold;
            }

            .tmRarityTop input[type="color"] {
                width: 28px;
                height: 24px;
                padding: 0;
                border: none;
                background: none;
                outline: 1px solid rgba(212,175,55,.28);
                border-radius: 4px;
                cursor: pointer;
            }

            /* Przełączniki */

            .tmSwitch {
                position: relative;
                width: 32px;
                height: 18px;
                display: inline-block;
                flex: 0 0 auto;
            }

            .tmSwitch input {
                opacity: 0;
                width: 0;
                height: 0;
            }

            .tmSwitch span {
                position: absolute;
                inset: 0;
                background: #242424;
                border: 1px solid rgba(212,175,55,.24);
                border-radius: 20px;
                cursor: pointer;
            }

            .tmSwitch span::before {
                content: "";
                position: absolute;
                width: 14px;
                height: 14px;
                left: 2px;
                top: 2px;
                background: #ffffff;
                border-radius: 50%;
                transition: .15s;
            }

            .tmSwitch input:checked + span {
                background: #b88a0a;
                box-shadow: 0 0 8px rgba(212,175,55,.35);
            }

            .tmSwitch input:checked + span::before {
                transform: translateX(14px);
            }

            /* Intensywność */

            .tmIntensityRow {
                display: flex;
                align-items: center;
                gap: 5px;
                margin-top: 6px;
                font-size: 11px;
                color: #c5b57e;
            }

            .tmIntensityRow input[type="range"] {
                flex: 1;
                min-width: 0;
                accent-color: #d4af37;
            }

            .tmIntensityValue {
                width: 38px;
                text-align: right;
                color: #f2d16b;
            }

            /* Czas podświetlenia */

            .tmSettingLine {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin-top: 8px;
            }

            .tmSettingLine label {
                color: #c5b57e;
            }

            .tmSettingLine select {
                background: #080808;
                color: #f5f0df;
                border: 1px solid rgba(212,175,55,.35);
                border-radius: 5px;
                padding: 4px 6px;
            }

            .tmSettingLine select:focus {
                border-color: #d4af37;
                outline: none;
            }

            /* Glow lootu */

            .tmHeroicLoot {
                position: relative !important;
                z-index: 99990 !important;
                box-shadow:
                    0 0 8px var(--tm-loot-color-a),
                    0 0 18px var(--tm-loot-color-b),
                    0 0 32px var(--tm-loot-color-c) !important;
                animation: tmHeroicPulse 1.2s ease-in-out infinite;
            }

            .tmUniqueLoot {
                position: relative !important;
                z-index: 99990 !important;
                box-shadow:
                    0 0 6px var(--tm-loot-color-a),
                    0 0 14px var(--tm-loot-color-b) !important;
                animation: tmUniquePulse 1.6s ease-in-out infinite;
            }

            .tmLegendaryLoot {
                position: relative !important;
                z-index: 99990 !important;
                box-shadow:
                    0 0 8px var(--tm-loot-color-a),
                    0 0 18px var(--tm-loot-color-b),
                    0 0 34px var(--tm-loot-color-c) !important;
                animation: tmLegendaryPulse 1.2s ease-in-out infinite;
            }

            .tmCommonLoot {
                position: relative !important;
                z-index: 99990 !important;
                box-shadow:
                    0 0 6px var(--tm-loot-color-a),
                    0 0 14px var(--tm-loot-color-b) !important;
                animation: tmCommonPulse 1.6s ease-in-out infinite;
            }

            @keyframes tmHeroicPulse {
                0%,100% {
                    filter: brightness(1);
                }
                50% {
                    filter: brightness(1.25);
                }
            }

            @keyframes tmUniquePulse {
                0%,100% {
                    filter: brightness(1);
                }
                50% {
                    filter: brightness(1.12);
                }
            }

            @keyframes tmLegendaryPulse {
                0%,100% {
                    filter: brightness(1);
                }
                50% {
                    filter: brightness(1.3);
                }
            }

            @keyframes tmCommonPulse {
                0%,100% {
                    filter: brightness(1);
                }
                50% {
                    filter: brightness(1.10);
                }
            }
        `;

        document.head.appendChild(style);
    }

})();


// =============================================================
// DARMOWE NAGRODY 4.8 — moduł Vickness Addons (wyłącznie Riventia)
// =============================================================
(() => {
  'use strict';
  if (location.hostname !== 'riventia.margonem.pl' || window.top !== window.self) return;
  if (window.__vicknessFreeRewardsModuleStarted) return;
  window.__vicknessFreeRewardsModuleStarted = true;

  const WAIT = ms => new Promise(resolve => setTimeout(resolve, ms));
  const CLICK_WAIT = 250;
  const LOAD_WAIT = 100;
  const CALENDAR_CHECK_INTERVAL = 3 * 60 * 60 * 1000; // sprawdzanie co 3 godziny
  const CALENDAR_LAST_CHECK_KEY = 'vickness_free_rewards_last_check_v1';
  const getLastCheck = () => {
    try {
      const value = Number(localStorage.getItem(CALENDAR_LAST_CHECK_KEY) || 0);
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (_) { return 0; }
  };
  const saveLastCheck = () => {
    try { localStorage.setItem(CALENDAR_LAST_CHECK_KEY, String(Date.now())); } catch (_) {}
  };
  const enabled = window.__vicknessAddonEnabled || (window.__vicknessAddonEnabled = {});
  if (typeof enabled.freeRewards !== 'boolean') enabled.freeRewards = true;
  if (typeof enabled.itemChat !== 'boolean') enabled.itemChat = true;

  let checking = false;
  let finished = false;
  let widget = null;
  let panelStyle = null;
  let hourlyTimer = null;
  let stopped = false;

  // Wycisza wyłącznie element komunikatu kalendarza podczas automatycznego sprawdzania.
  // Nie ukrywa rodziców, kontenerów gry ani elementów tooltipów.
  const INACTIVE_CALENDAR_TEXT = 'obecnie nie trwa żadne wydarzenie czasowe';

  function normalizeNoticeText(value) {
    return String(value || '')
      .replace(/\\u00a0/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('pl-PL');
  }

  function hideInactiveCalendarToast(root = document) {
    if (!root || !root.querySelectorAll) return;
    const nodes = [];
    if (root instanceof HTMLElement) nodes.push(root);
    nodes.push(...root.querySelectorAll('*'));

    for (const el of nodes) {
      if (!(el instanceof HTMLElement) || el.dataset.vxInactiveCalendarToast === '1') continue;
      // Tylko dokładny tekst komunikatu — nigdy element zawierający dodatkową treść.
      if (normalizeNoticeText(el.textContent) !== INACTIVE_CALENDAR_TEXT) continue;
      el.dataset.vxInactiveCalendarToast = '1';
      el.style.setProperty('display', 'none', 'important');
      el.setAttribute('aria-hidden', 'true');
    }
  }

  function beginCalendarToastMute() {
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') {
          const parent = record.target.parentElement;
          if (parent) hideInactiveCalendarToast(parent);
        } else {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement) hideInactiveCalendarToast(node);
          }
          if (record.target instanceof HTMLElement) hideInactiveCalendarToast(record.target);
        }
      }
    });
    if (document.body) observer.observe(document.body, {
      childList: true, subtree: true, characterData: true
    });
    return observer;
  }

  function endCalendarToastMute(observer) {
    observer?.disconnect();
  }

  function hidePanels() {
    if (panelStyle) return;
    panelStyle = document.createElement('style');
    panelStyle.id = 'vx-free-rewards-hide-style';
    panelStyle.textContent = `
      .c-window:has(.rewards-calendar),
      .c-window:has(.news-panel),
      .rewards-calendar,
      .news-panel {
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(panelStyle);
  }

  function showPanels() {
    panelStyle?.remove();
    panelStyle = null;
  }

  function panelSelector(type) {
    return type === 'calendar' ? '.rewards-calendar' : '.news-panel';
  }

  function panelExists(type) {
    return !!document.querySelector(panelSelector(type));
  }

  // Margonem potrafi trzymać panel w DOM nawet wtedy, gdy okno jest zamknięte.
  // Samo querySelector nie może więc oznaczać, że panel jest już otwarty.
  function panelIsOpen(type) {
    const panel = document.querySelector(panelSelector(type));
    if (!panel || panel.getClientRects().length === 0) return false;

    for (let node = panel; node && node !== document.documentElement; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      // visibility/opacity mogą być ustawione przez nasz własny styl tła.
      // O faktycznym otwarciu decyduje istnienie geometrii i display != none.
      if (style.display === 'none') return false;
    }
    return true;
  }

  function findPanelButton(type) {
    return document.querySelector(
      type === 'calendar'
        ? '.widget-rewards-calendar-icon, .widget-button[widget-name="rewards-calendar-icon"]'
        : '.widget-button[widget-name="news-icon"]'
    );
  }

  async function openPanel(type) {
    if (panelIsOpen(type)) return { type, button: null, opened: false };
    const button = findPanelButton(type);
    if (!button) return { type, button: null, opened: false };
    button.click();
    for (let i = 0; i < 25; i++) {
      await WAIT(LOAD_WAIT);
      if (panelIsOpen(type)) {
        await WAIT(100);
        return { type, button, opened: true };
      }
    }
    return { type, button: null, opened: false };
  }

  function closeOpenedPanel(result) {
    if (!result?.opened || !result.button) return;
    if (panelExists(result.type)) result.button.click();
  }

  function calendarHasActiveEvent() {
    // Komunikat gry może być poza .rewards-calendar (np. w osobnym
    // oknie/podpowiedzi), a jego tekst bywa rozdzielony nowymi liniami.
    const normalizeCalendarText = value => String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('pl-PL');

    const inactiveMessages = [
      'obecnie nie trwa żadne wydarzenie czasowe',
      'obecnie nie trwa zadne wydarzenie czasowe'
    ];

    const calendar = document.querySelector('.rewards-calendar');
    const calendarText = normalizeCalendarText(calendar?.textContent);
    const pageText = normalizeCalendarText(document.body?.textContent);

    if (
      inactiveMessages.some(message =>
        calendarText.includes(message) || pageText.includes(message)
      )
    ) {
      return false;
    }

    // Bez aktywnego dnia/nagrody kalendarz nie może zgłaszać nagrody.
    return !!calendar?.querySelector('.day.today .reward');
  }
  // Wylaczono niestandardowe podpowiedzi kalendarza.
  // Vickness nie zmienia title, hover ani mechanizmu tipow Margonem.

  function setCalendarHoverHint(_hasEvent) {
    // Celowo puste: natywne podpowiedzi i atrybuty gry pozostaja nietkniete.
  }

  function findCalendarReward() {
    if (!calendarHasActiveEvent()) return null;

    const reward = document.querySelector('.rewards-calendar .day.today .reward');
    return reward &&
      reward.classList.contains('can-open') &&
      !reward.classList.contains('is-open')
      ? reward
      : null;
  }

  function findFreeNewsOffers() {
    return [...document.querySelectorAll('.news-panel .news-classic-tile')].filter(tile => {
      if (tile.classList.contains('is-used') || tile.classList.contains('news-time-promo-tile')) return false;
      const price = tile.querySelector('.buy-info');
      const button = tile.querySelector('.buy-button-wrapper .button');
      if (!price || !button) return false;
      return price.textContent.replace(/\s/g, '').toUpperCase() === '0SŁ';
    });
  }

  function removeWidget() {
    widget?.remove();
    widget = null;
  }

  function createWidget(calendar, news) {
    removeWidget();
    widget = document.createElement('div');
    widget.id = 'vx-free-rewards-widget';
    Object.assign(widget.style, {
      position: 'fixed', left: '50%', top: '40%', right: 'auto', bottom: 'auto',
      transform: 'translate(-50%, -50%)', zIndex: '999999', width: '205px',
      padding: '12px', boxSizing: 'border-box', background: 'rgba(8, 8, 8, 0.78)',
      color: '#e8c45a', border: '1px solid rgba(196, 155, 54, 0.85)',
      borderRadius: '7px', boxShadow: '0 0 9px rgba(0,0,0,0.45)',
      backdropFilter: 'blur(3px)', fontFamily: 'Arial, sans-serif',
      textAlign: 'center', cursor: 'move', fontSize: '13px'
    });

    const heading = document.createElement('div');
    heading.textContent = 'DARMOWE NAGRODY';
    Object.assign(heading.style, { fontWeight: 'bold', fontSize: '13px', marginBottom: '8px' });

    const info = document.createElement('div');
    info.textContent = (calendar ? 'Kalendarz: 1' : 'Kalendarz: 0') + ' | Oferty: ' + news.length;
    Object.assign(info.style, { fontSize: '12px', marginBottom: '9px' });

    const button = document.createElement('button');
    button.textContent = 'ODBIERZ WSZYSTKO';
    Object.assign(button.style, {
      width: '100%', padding: '8px 4px', background: 'rgba(189, 150, 61, 0.92)',
      color: '#080808', border: '1px solid #f1d27a', borderRadius: '4px',
      fontSize: '12px', fontWeight: 'bold', cursor: 'pointer'
    });

    button.addEventListener('click', async event => {
      event.stopPropagation();
      if (checking || finished || !enabled.freeRewards) return;
      checking = true;
      button.disabled = true;
      button.textContent = 'ODBIERANIE...';
      let calPanel = null;
      let newsPanel = null;
      try {
        if (window.__vicknessShouldPauseAddons?.()) return;
        hidePanels();
        calPanel = await openPanel('calendar');
        newsPanel = await openPanel('news');
        await WAIT(200);

        const hasCalendarEvent = calendarHasActiveEvent();
        setCalendarHoverHint(hasCalendarEvent);
        const calendarReward = hasCalendarEvent ? findCalendarReward() : null;
        const newsOffers = findFreeNewsOffers();

        if (calendarReward) {
          calendarReward.click();
          await WAIT(CLICK_WAIT);
        }

        for (const tile of newsOffers) {
          if (!tile.isConnected || tile.classList.contains('is-used')) continue;
          const price = tile.querySelector('.buy-info');
          const buyButton = tile.querySelector('.buy-button-wrapper .button');
          if (price && price.textContent.replace(/\s/g, '').toUpperCase() === '0SŁ' && buyButton) {
            buyButton.click();
            await WAIT(CLICK_WAIT);
          }
        }
        await WAIT(250);
        finished = true;
        removeWidget();
      } catch (error) {
        console.error('[Nagrody] Błąd odbierania:', error);
        button.disabled = false;
        button.textContent = 'SPRÓBUJ PONOWNIE';
      } finally {
        closeOpenedPanel(newsPanel);
        closeOpenedPanel(calPanel);
        showPanels();
        checking = false;
      }
    });

    const close = document.createElement('span');
    close.textContent = '×';
    Object.assign(close.style, {
      position: 'absolute', top: '2px', right: '7px', cursor: 'pointer',
      color: '#e8c45a', fontSize: '16px'
    });
    close.addEventListener('click', removeWidget);

    widget.append(heading, info, button, close);
    document.body.appendChild(widget);

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    widget.addEventListener('mousedown', event => {
      if (event.target === button || event.target === close) return;
      dragging = true;
      const rect = widget.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      widget.style.transform = 'none';
      widget.style.left = rect.left + 'px';
      widget.style.top = rect.top + 'px';
      event.preventDefault();
    });
    document.addEventListener('mousemove', event => {
      if (!dragging || !widget) return;
      widget.style.left = (event.clientX - offsetX) + 'px';
      widget.style.top = (event.clientY - offsetY) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  async function initialCheck() {
    if (checking || finished || stopped || !enabled.freeRewards) return false;
    checking = true;
    let calPanel = null;
    let newsPanel = null;
    let calendarToastObserver = null;
    try {
      // Krótkie oczekiwanie na interfejs: zamiast blokować skan nawet minutę,
      // sprawdzaj gotowość co 250 ms i zakończ oczekiwanie po 20 sekundach.
      let uiReady = false;
      for (let i = 0; i < 80; i++) {
        if (stopped || !enabled.freeRewards || window.__vicknessShouldPauseAddons?.()) return false;
        if (findPanelButton('calendar') && findPanelButton('news')) {
          uiReady = true;
          break;
        }
        await WAIT(250);
      }
      if (!uiReady) return false;
      if (!enabled.freeRewards || !findPanelButton('calendar') || !findPanelButton('news')) return false;

      calendarToastObserver = beginCalendarToastMute();
      // Ukryj okna PRZED ich otwieraniem, aby nie mignęły na ekranie.
      hidePanels();
      calPanel = await openPanel('calendar');
      newsPanel = await openPanel('news');
      await WAIT(200);
      const hasCalendarEvent = calendarHasActiveEvent();
      setCalendarHoverHint(hasCalendarEvent);
      const calendar = hasCalendarEvent ? findCalendarReward() : null;
      const news = findFreeNewsOffers();

      // Skanowanie ma wyłącznie wykrywać nagrody i pokazać okienko.
      // Odbiór następuje dopiero po ręcznym kliknięciu „ODBIERZ WSZYSTKO”.
      closeOpenedPanel(newsPanel);
      newsPanel = null;
      closeOpenedPanel(calPanel);
      calPanel = null;

      if (calendar || news.length > 0) {
        createWidget(calendar, news);
      } else {
        finished = true;
        removeWidget();
      }
      return true;
    } catch (error) {
      console.error('[Nagrody] Błąd sprawdzania:', error);
      return false;
    } finally {
      closeOpenedPanel(newsPanel);
      closeOpenedPanel(calPanel);
      endCalendarToastMute(calendarToastObserver);
      showPanels();
      checking = false;
    }
  }

  function stop() {
    stopped = true;
    if (hourlyTimer) clearTimeout(hourlyTimer);
    hourlyTimer = null;
    removeWidget();
    showPanels();
  }

  function start() {
    if (!enabled.freeRewards || hourlyTimer || stopped === false && window.__vicknessFreeRewardsActive) return;
    stopped = false;
    window.__vicknessFreeRewardsActive = true;
    const scheduleNextCheck = (initial = false, retry = false) => {
      if (stopped || !enabled.freeRewards) return;
      const elapsed = Date.now() - getLastCheck();
      const remaining = Math.max(0, CALENDAR_CHECK_INTERVAL - elapsed);
      // Pierwsze sprawdzenie po uruchomieniu ma być szybkie. Nie może
      // czekać 3 godzin tylko dlatego, że brak zapisanego znacznika czasu.
      const delay = initial ? 500 : (retry ? 15000 : Math.max(60000, remaining));
      hourlyTimer = setTimeout(async () => {
        hourlyTimer = null;
        if (stopped || !enabled.freeRewards) return;
        if (window.__vicknessShouldPauseAddons?.()) {
          scheduleNextCheck(false, true);
          return;
        }
        finished = false;
        removeWidget();
        const checked = await initialCheck();
        if (checked) saveLastCheck();
        // Jeśli interfejs gry nie był gotowy albo skan przerwano,
        // ponów próbę za minutę; po udanym skanie wróć do cyklu 3 h.
        scheduleNextCheck(false, !checked);
      }, delay);
    };
    scheduleNextCheck(true);
  }

  window.__vicknessFreeRewardsCheckNow = () => {
    if (!enabled.freeRewards || checking || window.__vicknessShouldPauseAddons?.()) return false;
    finished = false;
    removeWidget();
    void initialCheck(true);
    return true;
  };
  window.__vicknessFreeRewardsSetEnabled = value => {
    enabled.freeRewards = !!value;
    if (enabled.freeRewards) {
      if (!window.__vicknessFreeRewardsActive) start();
    } else {
      window.__vicknessFreeRewardsActive = false;
      stop();
    }
  };
  window.__vicknessFreeRewardsSetEnabled(enabled.freeRewards);
  window.addEventListener('pagehide', stop, { once: true });
})();

// =============================================================
// VICKNESS ADDON PANEL 1.1.68 — panel sterowania dodatkami
// =============================================================
(() => {
  'use strict';
  if (location.hostname !== 'riventia.margonem.pl' || window.top !== window.self) return;
  if (window.__vicknessStandaloneManagerStarted) return;
  window.__vicknessStandaloneManagerStarted = true;

  const KEY = 'vickness_addon_panel_layout_v2';
  const FLAGS_KEY = 'vickness_addon_enabled_v1';
  const enabled = window.__vicknessAddonEnabled || (window.__vicknessAddonEnabled = { loot: true, dc: true, lootlog: true, titan: true, lootChance: true, crewOnline: true, profileFinder: true, wnm: true, rankChat: true, freeRewards: true, itemChat: true });
  if (typeof enabled.profileFinder !== 'boolean') enabled.profileFinder = true;
  try {
    const saved = JSON.parse(localStorage.getItem(FLAGS_KEY) || '{}');
    if (typeof saved.loot === 'boolean') enabled.loot = saved.loot;
    if (typeof saved.dc === 'boolean') enabled.dc = saved.dc;
    if (typeof saved.lootlog === 'boolean') enabled.lootlog = saved.lootlog;
    else if (typeof enabled.lootlog !== 'boolean') enabled.lootlog = true;
    if (typeof saved.titan === 'boolean') enabled.titan = saved.titan;
    else if (typeof enabled.titan !== 'boolean') enabled.titan = true;
    if (typeof saved.lootChance === 'boolean') enabled.lootChance = saved.lootChance;
    else if (typeof enabled.lootChance !== 'boolean') enabled.lootChance = true;
    if (typeof saved.crewOnline === 'boolean') enabled.crewOnline = saved.crewOnline;
    else if (typeof enabled.crewOnline !== 'boolean') enabled.crewOnline = true;
    if (typeof saved.wnm === 'boolean') enabled.wnm = saved.wnm;
    if (typeof saved.rankChat === 'boolean') enabled.rankChat = saved.rankChat;
    if (typeof saved.freeRewards === 'boolean') enabled.freeRewards = saved.freeRewards;
    if (typeof saved.itemChat === 'boolean') enabled.itemChat = saved.itemChat;
  } catch (_) { if (typeof enabled.lootlog !== 'boolean') enabled.lootlog = true; if (typeof enabled.titan !== 'boolean') enabled.titan = true; if (typeof enabled.crewOnline !== 'boolean') enabled.crewOnline = true; if (typeof enabled.rankChat !== 'boolean') enabled.rankChat = true; }
  if (typeof enabled.lootlog !== 'boolean') enabled.lootlog = true;
  if (typeof enabled.titan !== 'boolean') enabled.titan = true;
  if (typeof enabled.lootChance !== 'boolean') enabled.lootChance = true;
  if (typeof enabled.crewOnline !== 'boolean') enabled.crewOnline = true;
  if (typeof enabled.profileFinder !== 'boolean') enabled.profileFinder = true;
  if (typeof enabled.wnm !== 'boolean') enabled.wnm = true;
  if (typeof enabled.rankChat !== 'boolean') enabled.rankChat = true;
  if (typeof enabled.freeRewards !== 'boolean') enabled.freeRewards = true;
  const PROFILE_FINDER_GM_KEY = 'vickness_profileFinderEnabled';
  try {
    const storedProfileFinder = GM_getValue(PROFILE_FINDER_GM_KEY, undefined);
    if (typeof storedProfileFinder === 'boolean') enabled.profileFinder = storedProfileFinder;
    else GM_setValue(PROFILE_FINDER_GM_KEY, !!enabled.profileFinder);
  } catch (_) {}
  let layout = {};
  try { layout = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) {}

  const PANEL_BASE_WIDTH = 840;
  const PANEL_BASE_HEIGHT = 560;
  let currentPanelScale = 1;
  const baseFontSizes = new WeakMap();
  // Po wykryciu NPC panel DC odpinamy z widoku ustawień i pokazujemy jako samodzielne okno.
  let dcWindowDetached = false;
  let lastCrewEnabledApplied = null;
  let lastLootlogEnabledApplied = null;
  let lastTitanEnabledApplied = null;

  function saveFlags() { try { localStorage.setItem(FLAGS_KEY, JSON.stringify(enabled)); } catch (_) {} }
  function saveProfileFinderFlag() { try { GM_setValue(PROFILE_FINDER_GM_KEY, !!enabled.profileFinder); } catch (_) {} }
  function saveLayout() { try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch (_) {} }

  // Złote przyciemnienie mapy — rdzeń z przesłanego skryptu v8.0,
  // zintegrowany z zakładką Wygląd (bez tworzenia drugiego, pływającego panelu).
  const PAGE_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const MAP_DIMMER_KEYS = { amount: 'margonemDimAmount', enabled: 'margonemDimEnabled' };
  let mapDimmerAmount = 50;
  let mapDimmerEnabled = true;
  try {
    const storedAmount = localStorage.getItem(MAP_DIMMER_KEYS.amount);
    mapDimmerAmount = storedAmount === null ? 50 : Math.max(0, Math.min(100, Number(storedAmount) || 0));
    mapDimmerEnabled = localStorage.getItem(MAP_DIMMER_KEYS.enabled) !== '0';
  } catch (_) {}

  let lastMapDimmerEngine = null;
  let lastMapDimmerMap = null;
  let lastMapDimmerMapId = null;
  let lastMapDimmerCanvas = null;
  let lastMapDimmerWidth = -1;
  let lastMapDimmerHeight = -1;
  let lastMapDimmerPixelWidth = -1;
  let lastMapDimmerPixelHeight = -1;
  let mapDimmerApplyQueued = false;
  let mapDimmerMonitorStarted = false;
  let mapDimmerResizeObserver = null;
  let mapDimmerReadyTimer = null;
  let mapDimmerMapCheckTimer = null;

  function getMapDimmerGameElements() {
    const canvas = document.querySelector('#GAME_CANVAS');
    const layer = canvas?.closest('.game-layer') || document.querySelector('.game-layer');
    return { canvas, layer };
  }

  function getMapDimmerDimensions() {
    const { canvas, layer } = getMapDimmerGameElements();
    const element = canvas || layer;
    const rect = element?.getBoundingClientRect();
    return {
      canvas,
      width: Math.round(rect?.width || 0),
      height: Math.round(rect?.height || 0),
      pixelWidth: canvas?.width || 0,
      pixelHeight: canvas?.height || 0
    };
  }

  function applyMapDimmer(force = false) {
    const engine = PAGE_WINDOW.Engine || window.Engine;
    if (!engine?.canvasFilter || !engine?.map) return false;

    const dimensions = getMapDimmerDimensions();
    const mapId = engine.map.getId?.() ?? engine.map.d?.id ?? null;
    const changed = engine !== lastMapDimmerEngine || engine.map !== lastMapDimmerMap ||
      mapId !== lastMapDimmerMapId || dimensions.canvas !== lastMapDimmerCanvas ||
      dimensions.width !== lastMapDimmerWidth || dimensions.height !== lastMapDimmerHeight ||
      dimensions.pixelWidth !== lastMapDimmerPixelWidth || dimensions.pixelHeight !== lastMapDimmerPixelHeight;
    if (!force && !changed) return true;

    try {
      const filter = (!mapDimmerEnabled || mapDimmerAmount === 0)
        ? 'none'
        : `brightness(${1 - mapDimmerAmount / 100})`;
      engine.canvasFilter.addObjectsFilter('MAP', null, filter);
      engine.map.updateFilterImage();
      engine.map.updateBackgroundOffsetImage();

      lastMapDimmerEngine = engine;
      lastMapDimmerMap = engine.map;
      lastMapDimmerMapId = mapId;
      lastMapDimmerCanvas = dimensions.canvas;
      lastMapDimmerWidth = dimensions.width;
      lastMapDimmerHeight = dimensions.height;
      lastMapDimmerPixelWidth = dimensions.pixelWidth;
      lastMapDimmerPixelHeight = dimensions.pixelHeight;
      return true;
    } catch (error) {
      console.warn('[Vickness — Złote przyciemnienie mapy v8]', error);
      return false;
    }
  }

  // Łącz wiele zdarzeń (np. przeciąganie suwaka) w jedno zastosowanie na klatkę.
  function scheduleMapDimmerApply() {
    if (mapDimmerApplyQueued) return;
    mapDimmerApplyQueued = true;
    requestAnimationFrame(() => {
      mapDimmerApplyQueued = false;
      applyMapDimmer(true);
    });
  }

  function syncMapDimmerControls() {
    const enabledControl = root.querySelector('#vxMapDimmerEnabled');
    const amountControl = root.querySelector('#vxMapDimmerRange');
    const amountValue = root.querySelector('#vxMapDimmerValue');
    const stateValue = root.querySelector('#vxMapDimmerState');
    const toggleButton = root.querySelector('#vxMapDimmerToggleButton');
    if (enabledControl) enabledControl.checked = mapDimmerEnabled;
    if (toggleButton) {
      toggleButton.textContent = mapDimmerEnabled ? 'WYŁĄCZ ZŁOTE PRZYCIEMNIENIE' : 'WŁĄCZ ZŁOTE PRZYCIEMNIENIE';
      toggleButton.setAttribute('aria-pressed', String(mapDimmerEnabled));
    }
    if (amountControl) {
      amountControl.value = String(mapDimmerAmount);
      amountControl.disabled = !mapDimmerEnabled;
    }
    if (amountValue) amountValue.textContent = `${mapDimmerAmount}%`;
    if (stateValue) stateValue.textContent = mapDimmerEnabled ? 'WŁĄCZONE' : 'WYŁĄCZONE';
  }

  function setMapDimmerAmount(value) {
    mapDimmerAmount = Math.max(0, Math.min(100, Number(value) || 0));
    try { localStorage.setItem(MAP_DIMMER_KEYS.amount, String(mapDimmerAmount)); } catch (_) {}
    syncMapDimmerControls();
    scheduleMapDimmerApply();
  }

  function setMapDimmerEnabled(value) {
    mapDimmerEnabled = Boolean(value);
    try { localStorage.setItem(MAP_DIMMER_KEYS.enabled, mapDimmerEnabled ? '1' : '0'); } catch (_) {}
    syncMapDimmerControls();
    scheduleMapDimmerApply();
  }

  function watchMapDimmerGameSize() {
    const { canvas, layer } = getMapDimmerGameElements();
    if (mapDimmerResizeObserver) mapDimmerResizeObserver.disconnect();
    if (typeof ResizeObserver === 'function') {
      mapDimmerResizeObserver = new ResizeObserver(scheduleMapDimmerApply);
      if (canvas) mapDimmerResizeObserver.observe(canvas);
      if (layer && layer !== canvas) mapDimmerResizeObserver.observe(layer);
    }
    scheduleMapDimmerApply();
  }

  function getReadyMapDimmerEngine() {
    const engine = PAGE_WINDOW.Engine || window.Engine;
    return engine?.canvasFilter && engine?.map ? engine : null;
  }

  function startMapDimmerMapChecks() {
    if (mapDimmerMapCheckTimer) return;

    // Sprawdzaj wyłącznie referencję silnika/mapy i identyfikator mapy.
    // Wymiary canvasu obsługuje ResizeObserver; test zmiany mapy działa co 50 ms.
    mapDimmerMapCheckTimer = setInterval(() => {
      if (window.__vicknessShouldPauseAddons?.()) return;
      if (document.visibilityState === 'hidden') return;
      const engine = getReadyMapDimmerEngine();
      if (!engine) return;

      const map = engine.map;
      let mapId = null;
      try { mapId = map.getId?.() ?? map.d?.id ?? null; } catch (_) {}
      const canvas = document.getElementById('GAME_CANVAS');

      if (engine !== lastMapDimmerEngine || map !== lastMapDimmerMap ||
          mapId !== lastMapDimmerMapId || canvas !== lastMapDimmerCanvas) {
        if (canvas !== lastMapDimmerCanvas) watchMapDimmerGameSize();
        else scheduleMapDimmerApply();
      }
    }, 50);
  }

  function startMapDimmerMonitor() {
    if (mapDimmerMonitorStarted) return;
    mapDimmerMonitorStarted = true;

    // Reaguj od razu na zmianę rozmiaru, pełny ekran i powrót do karty.
    window.addEventListener('resize', watchMapDimmerGameSize, { passive: true });
    document.addEventListener('fullscreenchange', watchMapDimmerGameSize);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') {
        watchMapDimmerGameSize();
        applyMapDimmer(true);
      }
    }, { passive: true });

    // Najpierw próbuj natychmiast. Jeśli Engine jeszcze się ładuje,
    // sprawdzaj gotowość co 25 ms i zakończ polling zaraz po starcie.
    const tryInitialApply = () => {
      const engine = getReadyMapDimmerEngine();
      if (!engine) return false;
      if (mapDimmerReadyTimer) {
        clearInterval(mapDimmerReadyTimer);
        mapDimmerReadyTimer = null;
      }
      watchMapDimmerGameSize();
      applyMapDimmer(true);
      startMapDimmerMapChecks();
      return true;
    };

    if (tryInitialApply()) return;
    mapDimmerReadyTimer = setInterval(tryInitialApply, 25);
  }

  // Zmiana rozmiaru okna skaluje proporcjonalnie tekst i odstępy wizualne;
  // bazowe rozmiary zapisywane są tylko raz, aby wielokrotne przeciąganie
  // uchwytu nie kumulowało błędu skalowania.
  function applyPanelScale(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const raw = Math.sqrt((rect.width / PANEL_BASE_WIDTH) * (rect.height / PANEL_BASE_HEIGHT));
    const scale = Math.max(0.72, Math.min(1.28, raw));
    const nodes = [el, ...el.querySelectorAll('*')];
    for (const node of nodes) {
      let base = baseFontSizes.get(node);
      if (!base) {
        const computed = parseFloat(getComputedStyle(node).fontSize) || 12;
        base = computed / currentPanelScale;
        baseFontSizes.set(node, base);
      }
      node.style.setProperty('font-size', `${Math.max(7, base * scale).toFixed(2)}px`, 'important');
    }
    currentPanelScale = scale;
    const home = el.querySelector('#vxHomeView');
    if (home) {
      home.classList.toggle('vxNarrow', rect.width < 470);
    }
  }

  function clamp(el, key, fx = 20, fy = 100) {
    const pos = layout[key] || {};
    if (key === 'main') {
      const maxW = Math.max(1, innerWidth - 12);
      const maxH = Math.max(1, innerHeight - 12);
      const minW = Math.min(390, maxW);
      const minH = Math.min(300, maxH);
      const savedW = Number(pos.width) > 0 ? Number(pos.width) : Math.min(PANEL_BASE_WIDTH, maxW);
      const savedH = Number(pos.height) > 0 ? Number(pos.height) : Math.min(PANEL_BASE_HEIGHT, maxH);
      el.style.width = Math.max(minW, Math.min(savedW, maxW)) + 'px';
      el.style.height = Math.max(minH, Math.min(savedH, maxH)) + 'px';
    }
    const x = Number.isFinite(Number(pos.left)) ? Number(pos.left) : fx;
    const y = Number.isFinite(Number(pos.top)) ? Number(pos.top) : fy;
    el.style.left = Math.max(0, Math.min(x, innerWidth - el.offsetWidth)) + 'px';
    el.style.top = Math.max(0, Math.min(y, innerHeight - el.offsetHeight)) + 'px';
  }
  function savePos(el, key) {
    const r = el.getBoundingClientRect();
    const prior = layout[key] || {};
    layout[key] = { ...prior, left: Math.round(r.left), top: Math.round(r.top) };
    if (key === 'main') {
      layout[key].width = Math.round(r.width);
      layout[key].height = Math.round(r.height);
    }
    saveLayout();
  }

  const root = document.createElement('div');
  root.id = 'vicknessStandaloneRoot';
  root.innerHTML = `
  <style>
    #vicknessStandaloneRoot { all:initial; font-family:Arial,sans-serif; --vx-accent:#dfb943; --vx-accent-line:rgba(201,162,39,.72); --vx-accent-soft:rgba(46,35,8,.62); }
    #vxStandalonePanel { position:fixed; z-index:2147483646; left:20px; top:20px; display:flex; flex-direction:column; width:min(840px,calc(100vw - 20px)); height:min(560px,calc(100vh - 16px)); min-width:650px; min-height:360px; max-width:calc(100vw - 12px); max-height:calc(100vh - 12px); resize:both; overflow:hidden; background:rgba(8,8,8,.88); color:#eee; border:1px solid #c9a227; border-radius:8px; box-shadow:0 8px 26px #000b; font:12px Arial,sans-serif; backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }
    #vxStandalonePanel * { box-sizing:border-box; }
    #vxStandaloneHeader { position:relative; flex:0 0 auto; padding:9px 35px 8px 10px; text-align:center; background:rgba(16,16,16,.92); border-bottom:1px solid #765b20; cursor:move; user-select:none; }
    #vxStandaloneBrand { color:#dfb943; font-size:16px; font-weight:bold; letter-spacing:2px; }
    #vxStandaloneMin { position:absolute; right:7px; top:7px; width:25px; height:30px; padding:0; border:1px solid var(--vx-accent-line); border-radius:5px; background:rgba(10,10,10,.88) url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACIAAAAwCAYAAAB0WahSAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAs9SURBVFhHhZjPk13HVcc/p+/7Nb9/WRONRlIpHtkaRQJsE9uBGFOhUiSUqyjkgoUDGzbhx44NsEgV4j8gFdYsoAooKqmkWECVExzsGCqxYsc4jhRZFpY91mhGmd8zb95793b3YXG673uTDf2q693bt/v093z7/OhuubRyVgFAAHtU1fpdEWsWaxcBTSPqMSog9u1E0RGZACIIiqrYSMljwdWd8my5imKS86wZRI2iLnIChKJqFTSJkyRr2KQjclE1IDZpqmRFxQTWyJOQJNA0NKmKsWRzD5VRkdSmSO6Q+g8fTJ4bPibEGXgGlYrmX8KUufp5gk681ugSybm/aJ6mZsYYyX01GUCqI7olemuZCOASzZmuum8NR8FZS2ZD8jw1kgQkr7mxn9St37NWgqgiasaWJJzQPsvNz5JsSoggcaRPAprnTdS62oZqGq1D7S15ygRUa61zryHNxpzNKJhdiCbmJLEsQw+zcYKSjTUDkCTaqKjVNGfLwMxOrD39Z6ECoopDESc4keG/Supn4K0MDdiZZ2RJGVBCnvnRaJOIpGr9hOy6Vh1K4QQnGBgUp4m12sUTgzpcLlFwWd+Mc3QA2NqJS9RKFgpOrM0mtHerOqwu98uspSUYYTR/M5vOEyAp6pnmzoFzIOKGg0hU5+oczgnOOVxhz4Vzw1okOYl0EWNMXKIioZJLK8sWiDW5qCpBFY3Z3aw924Ct3nBta+FpMjO6ocZ5rIoQI0S1LwpEzfYmyOrF5VGvZXqqwy9ePcfC/AQaY9LAjE5y+NPkP5qX08Y653DOIRiDUSOHB0esrf2MtY936B5XOGfOEJI+MeUjubSyrJCMU2F8rMkzn36Uay98mqefOM9Ep6ARPRBtQsnrVYBrgDTtOTEHhfVRhRgIZcnW7i7ff/MOX//WDf7n5seAsZPJjUBxamHmulFnWpWV5/adDV59/Rbv33nAeNMxP9XCRU/V6xMGJaH0qAcNqVYRrbzVskQHPUK/iw66ON9nquO4tLLIL1xeYuPhHnfvbVE4B3VQFIpH5qauZ3qtOlqtJiEqt+9u8tobd/lwfY/JyQnGJicpo2MQHH0v9EqlXwX6VWRQKf1UBzFCQ2mIR2Ig+orQ7zE32eDs8iw372yyuXVEs1EYK4CsriyrigxDfDJITbnGh8Cg9MxOj3H2zDytVsO0UHPPonA0HBSmIACddpPVi6f5wvOPsXphDgnejB/oVZFvvHyTr/7d6wiCj0rQBASxlJ89oTbeFJrFCRojvgpGpLmZxZHkxgm9GWKIRIVfunKGv/jjX+Opy2coBwExn+VHtze5/tVvc39jH+cKfDQ5Q1VGQFjEzbkFGkXB2FiLsfEW42MtJibaTIx3aHdaNFsNmq0mrXaLdqfF1FSHmakO99d3+c7rtykrY8R7j/cV7QZMjLXw3iI2KZOjKQSnoJC/pZ2W/c9Mj/OrTz/Gl178FX7/9z7DlUtLDMqKECLeR3yI+BCIMaIKhRMaDcfhQZ/jbg8fKsr+MWXvkMFxl0HpLV6lxOVItoAFWAtSIjhnSQqBlQun+MqffYG/+etr/Pmffp4Xf+dZ5mYm8D5QFDmZGaUKxKj4EIlR6bQLNAzodQ8pe4f0jw/Z2tpjd/8Y51y9pXQGwgTkZUCgSMHp1PwEX7r2JL/53DnobnO8vcH777zHm2/fo9ksELAwnkI3CkEjpQ+0mo6Vs1Pg+wy6XXxV0e0OuH1vh92DPq1mAmJJz+jI7ms0WbhuFAXnl2d59lOL+MMuMZT0jru8c3ONze0jnDhisBxVuGFFodFwPHV5gadXZ+h1jwkxEgKsb/X4wbubxl+mXARXzw6W7BIzISrNhvDo8iyfmJvAV8bX1k6Xt289oKo8IUSqtASIWtAthJnJFp9/domXvniBThEZlBVoYGu3y7+9fo+f3tul3SpsXLbR1ZUzatE9r7KVECNz023+5KVf5qXfukL3uEQk8sY76/zV115la6fL8uIEF5anaDYdzYaj1RRmp9pcuTDD1UenaDjF+4iIY32rz79+7z7ffWsDVIgqeAVVyz2yevFMju51GEGEECOfXJ7hK19+hicuztEfeEof+cZ3/pev/eNbrJyd4MsvXuQzVxeovAU21UgMnlhVHPUqBqWyd1Ty4/f3eeXNLT5YP6bZdEQEHyDUQBS5fNGSXr0m2AfnhM8+scRf/uGTTLTMlLb2+/ztv7zLqzc+5trnlvmjayv4oISoECMHB32+/+Nt3lvbR1AOjyMPtgZs7gwICs2mw0eLpjFCSGyoHbBs7fPWiLQn7bQKLp6bZHK8wSAoXuHhbo8PH3SRouCt23t8+wfrxOAJvsRXJWOtyMrZMY56yitv7vD2+3vsHpV02o5OuyBGsVBfH8JSEaF4ZH7quplpakvG88hMmy8+e5rzi+MMBp5QVbzz3kNe+eE6qrC9X3LzgwPGO/DJ022Cr1BVHplt8dTjs3Rajs3tAU5s1+eDEpNtBNUTGyTVFEcksZCDa+Ecp2ZbnJkXuvs7lN099nZ3+MndbfaPStBIw8H+oeefXn7Ad3+0Q9FwqDgGXmm1HS88t8gLn12k1SzwKUBFhWg+giJph2bvTmuaDImK0GoWnFtsM90JHB0dUPYP2Nza49YH+3gPIZo2rWbBYTfwzf/c4I1bezQaFlXLygPK80/O8dvPLdBpCoMq5S4lcW6ui73a5lnTdQMiaIROCy4stSjEU/mKQVXx0cYxa5s9mg0z5ohpKM7xs93AP7+8wY2bO4h6fDlg0D8mVD2eudzmd399hpkJRxVS3Ej5xQgwEpxKCqMJmogyM+k4f8oRQgCBvcOKGz89oNsPtBpixqYW9HyIBI2sPSz5+39/wI1bWxBLfOUpK0/lA0891uEPfmOGpbmCEPO2dDgnomasdgwE1Hbjq+faPH91EkTZ2R/wrf/e43vvHtEonF01JK0U8wJjVDjoBtY2B5yed3xiNkdO+740J5ydL1jb8mwfWniwJTIsxan56euSrgmiQqftePrxMT51rsNHGz2+/toOr717TFFkn8812VWiWFAK5zjsKRs7FedOFZyadvgQUI2EEFmYFi4sFjzcj2zuj9gIQrG4MH3dro9sorlJx3NXx+kPPP/wH7v88L0B7abZzgnfHzW2tNUUsSPnwbHyYLtiaU6ZmyS5ruIjTI87VpYadPvK/e3hjq+OI5pM5dxik+WFJt/8r31+8uGA8bb5vvm93X8NbS2l7LQ0IoJLzXtHkfWtkoVJmJ1w9fk4okyOweqywxH5aCsSIhbibb1tA3x6rkHhhLvrAzqtnAvkxLYRtRslId0Q1Ce+xIqkM7MoM+Pw+JmCpXlHu2XAJe0Ce/3IG3c8t+/HdNIbuSOL0Xy9WVjAsSVL/i85PA8nHy2SDmp2CIcinbtKP7zyMqWEEM3rCmciLdeMuHXhhEaRlqIGkWvyGMn7WRtYG3B6TjkQ7+2/WUCrYf/NhlIUmp6zcvlaIrFhlNtk1JNhybDeQOVkbcFI7SX1t4N1VEvxIUIVlTIIZRCqIFTBjDdvnLMSKfsOy+hHHVmJYbEGsxg7uA4Bj7JigDI7thR26B6VnydwaBKUhJ/IAUNzSMW0l8SoMZg/DZFkFiNCjDm5DUEOp5D6pb7Asde8HRi+5RbBbAZNgEWSraTJazlJqaxg+pZLHZFro8+MpFnSMg+h1NDrRfh5WAYCsyt7SN/yzDULycjJtma0jYJM96wj5Of3lH8EGF695E2tlQy+RpRdOuPKL/k/G+iokDTUKUnQiDvmHqk50R1PGmVtV7mP1ZjbkhQRexpan8FPCbyWKVcunc896zIKxxpOmHBuSiUx9f8Wc/XcO698lvx/VL/6n++r+SAAAAAASUVORK5CYII=") center/20px 27px no-repeat; color:transparent; cursor:pointer; }
    .vxView { padding:8px; }
    #vxWorkspace { display:flex; flex:1 1 0%; min-height:0; min-width:0; overflow:hidden; }
    #vxSidebar { flex:0 0 102px; width:102px; display:flex; flex-direction:column; gap:5px; padding:7px 5px; border-right:1px solid rgba(201,162,39,.24); background:rgba(4,4,4,.30); min-height:0; }
    .vxSideTab { position:relative; display:flex; align-items:center; gap:6px; width:100%; min-height:35px; padding:7px 6px; border:1px solid rgba(201,162,39,.24); border-radius:4px; background:rgba(16,16,16,.58); color:#bcb6a3; text-align:left; font:inherit; cursor:pointer; }
    .vxSideTab:hover { border-color:var(--vx-accent); color:#f3df9b; background:rgba(33,27,16,.78); }
    .vxSideTab.active { border-color:var(--vx-accent); color:var(--vx-accent); background:var(--vx-accent-soft); box-shadow:inset 2px 0 0 var(--vx-accent); }
    .vxSideTab .vxTabIcon { width:14px; flex:0 0 14px; text-align:center; }
    #vxContentArea { display:flex; flex:1 1 auto; flex-direction:column; min-width:0; min-height:0; overflow:hidden; background:rgba(6,6,6,.12); }
    .vxExtraView { display:none; flex:1 1 0%; flex-direction:column; gap:8px; min-width:0; min-height:0; padding:9px; overflow:auto; background:rgba(8,8,8,.24); }
    .vxPageCard { border:1px solid rgba(95,75,32,.68); border-radius:5px; padding:10px; background:rgba(20,20,20,.48); color:#c8c3b5; line-height:1.45; }
    .vxPageTitle { display:block; margin-bottom:6px; color:var(--vx-accent); font-weight:bold; }
    .vxUpdateSteps { margin:7px 0 8px 18px; padding:0; color:#c8c3b5; font-size:11px; line-height:1.5; }
    .vxUpdateSteps li { margin:4px 0; padding-left:2px; }
    .vxUpdateSteps strong { color:#e7d6ad; }
    #vxMapDimmerCard { padding:8px 9px; border-color:var(--vx-accent-line); }
    #vxMapDimmerCard .vxAppearanceControl { margin:6px 0; }
    #vxMapDimmerCard .vxPageNote { line-height:1.35; }
    .vxChangelogEntry { padding:8px 0; border-top:1px solid rgba(201,162,39,.16); }
    .vxChangelogEntry:first-of-type { border-top:0; }
    .vxChangelogVersion { color:var(--vx-accent); font-weight:bold; }
    .vxChangelogDate { margin-left:6px; color:#777; font-size:9px; }

    .vxInfoBtn { flex:0 0 15px; width:15px; height:15px; padding:0; border:1px solid var(--vx-accent-line); border-radius:50%; background:rgba(10,10,10,.72); color:var(--vx-accent); font: bold 10px Arial,sans-serif; line-height:13px; cursor:pointer; }
    .vxInfoBtn:hover { background:var(--vx-accent-soft); filter:brightness(1.25); }
    .vxUpdateTile { border-style:dashed; }
    .vxUpdateTileIcon { flex:0 0 auto; align-self:center; color:var(--vx-accent); font-size:23px; font-weight:bold; padding:0 5px; }
    .vxInfoModal[hidden] { display:none!important; }
    .vxInfoModal { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; padding:18px; background:rgba(0,0,0,.72); }
    .vxInfoDialog { width:min(390px,100%); padding:12px; border:1px solid var(--vx-accent); border-radius:7px; background:linear-gradient(145deg,rgba(30,28,22,.99),rgba(8,8,8,.99)); color:#eee; box-shadow:0 10px 35px #000c; font:12px Arial,Helvetica,sans-serif; }
    .vxInfoDialogHead { display:flex; align-items:center; justify-content:space-between; gap:10px; color:var(--vx-accent); font-size:13px; margin-bottom:10px; }
    .vxInfoDialogHead button { width:23px; height:23px; border:1px solid var(--vx-accent-line); border-radius:4px; background:#17130a; color:var(--vx-accent); font-size:18px; cursor:pointer; }
    .vxInfoDialogText { color:#ddd; line-height:1.55; margin:0 0 12px; }
    .vxInfoDialog .vxActionBtn { width:100%; padding:7px; }
    .vxActionBtn { padding:6px 8px; border:1px solid var(--vx-accent); border-radius:4px; background:var(--vx-accent-soft); color:var(--vx-accent); font:inherit; font-size:10px; cursor:pointer; }
    .vxActionBtn:hover { filter:brightness(1.18); }
    .vxAppearanceControl { display:block; margin:9px 0; }
    .vxAppearanceControl > span { display:flex; justify-content:space-between; gap:8px; margin-bottom:5px; }
    .vxAppearanceControl output { color:var(--vx-accent); }
    .vxAppearanceControl input[type="range"] { width:100%; accent-color:var(--vx-accent); }
    .vxAppearanceControl select { width:100%; padding:7px; background:#151515; color:#eee; border:1px solid var(--vx-accent-line); border-radius:4px; }
    .vxPageNote { color:#888; font-size:10px; line-height:1.45; }
    .vxStandaloneRow { display:flex; align-items:flex-start; justify-content:space-between; gap:5px; margin:0; padding:7px; min-height:78px; height:auto; min-width:0; max-width:100%; overflow:hidden; border:1px solid rgba(95,75,32,.85); border-radius:5px; background:rgba(20,20,20,.76); line-height:1.12; }
    .vxStandaloneRow > div:first-child { flex:1 1 0%; width:0; min-width:0; max-width:100%; overflow-wrap:anywhere; word-break:normal; }
    .vxStandaloneRow .vxStandaloneName,.vxStandaloneRow .vxStandaloneDesc { max-width:100%; min-width:0; }
    .vxStandaloneName { display:flex; align-items:center; gap:5px; max-width:100%; color:#e0bd53; font-family:Arial,Helvetica,sans-serif; font-size:10px; line-height:1.2; font-weight:bold; overflow-wrap:anywhere; word-break:normal; }
    .vxStandaloneDesc { display:block; margin-top:3px; color:#999; font-family:Arial,Helvetica,sans-serif; font-size:9px; line-height:1.25; overflow-wrap:anywhere; word-break:normal; }
    .vxStandaloneState { margin-top:3px; color:#aaa; font-family:Arial,Helvetica,sans-serif; font-size:8px; line-height:1.15; overflow-wrap:anywhere; }
    .vxOpenSettings,.vxNavBtn { margin-top:3px; padding:3px 5px; max-width:100%; border:1px solid #806321; border-radius:4px; background:rgba(23,20,12,.88); color:#dfb943; font-size:8px; line-height:1.1; cursor:pointer; white-space:normal; }
    .vxOpenSettings:hover,.vxNavBtn:hover { background:rgba(48,37,11,.92); border-color:#d4af37; color:#ffe28a; }
    .vxToggle { position:relative; width:29px; height:16px; flex:0 0 29px; margin-top:1px; margin-left:1px; }
    .vxToggle input { position:absolute; opacity:0; width:1px; height:1px; }
    .vxToggle span { position:absolute; inset:0; border-radius:20px; background:#4b2929; border:1px solid #8b4545; cursor:pointer; transition:.15s; }
    .vxToggle span:before { content:''; position:absolute; left:1px; top:1px; width:12px; height:12px; border-radius:50%; background:#eee; transition:.15s; }
    .vxToggle input:checked + span { background:#315b36; border-color:#69b875; }
    .vxToggle input:checked + span:before { transform:translateX(13px); background:#dfffe2; }
    #vxStandaloneFooter { flex:0 0 auto; padding:7px; text-align:center; border-top:1px solid #3b3018; background:rgba(10,10,10,.86); color:#777; font-size:9px; }
    #vxSettingsView { display:none; flex:1 1 0%; flex-direction:column; min-height:0; max-height:none; overflow:auto; background:rgba(8,8,8,.36); }
    #vxSettingsToolbar { display:flex; gap:6px; align-items:center; padding:7px 8px; border-bottom:1px solid #4b3b17; background:rgba(17,17,17,.9); }
    #vxSettingsToolbar .vxNavBtn { margin:0; }
    #vxCurrentSetting { color:#e0bd53; font-weight:bold; flex:1; text-align:center; }
    .vxSettingsSlot { min-width:0; padding:7px; }
    .vxSettingsSlot[hidden] { display:none!important; }
    #vxStandaloneMini { position:fixed; z-index:2147483646; display:none; align-items:center; gap:8px; padding:10px 14px; background:rgba(11,11,11,.9); color:#dfb943; border:1px solid #c9a227; border-radius:5px; font:bold 12px Arial,sans-serif; cursor:pointer; user-select:none; box-shadow:0 4px 16px #0008; backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }
    #vxStandaloneMini .diamond { display:inline-block; width:22px; height:27px; border:1px solid var(--vx-accent-line); border-radius:4px; background:rgba(10,10,10,.7) url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACIAAAAwCAYAAAB0WahSAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAs9SURBVFhHhZjPk13HVcc/p+/7Nb9/WRONRlIpHtkaRQJsE9uBGFOhUiSUqyjkgoUDGzbhx44NsEgV4j8gFdYsoAooKqmkWECVExzsGCqxYsc4jhRZFpY91mhGmd8zb95793b3YXG673uTDf2q693bt/v093z7/OhuubRyVgFAAHtU1fpdEWsWaxcBTSPqMSog9u1E0RGZACIIiqrYSMljwdWd8my5imKS86wZRI2iLnIChKJqFTSJkyRr2KQjclE1IDZpqmRFxQTWyJOQJNA0NKmKsWRzD5VRkdSmSO6Q+g8fTJ4bPibEGXgGlYrmX8KUufp5gk681ugSybm/aJ6mZsYYyX01GUCqI7olemuZCOASzZmuum8NR8FZS2ZD8jw1kgQkr7mxn9St37NWgqgiasaWJJzQPsvNz5JsSoggcaRPAprnTdS62oZqGq1D7S15ygRUa61zryHNxpzNKJhdiCbmJLEsQw+zcYKSjTUDkCTaqKjVNGfLwMxOrD39Z6ECoopDESc4keG/Supn4K0MDdiZZ2RJGVBCnvnRaJOIpGr9hOy6Vh1K4QQnGBgUp4m12sUTgzpcLlFwWd+Mc3QA2NqJS9RKFgpOrM0mtHerOqwu98uspSUYYTR/M5vOEyAp6pnmzoFzIOKGg0hU5+oczgnOOVxhz4Vzw1okOYl0EWNMXKIioZJLK8sWiDW5qCpBFY3Z3aw924Ct3nBta+FpMjO6ocZ5rIoQI0S1LwpEzfYmyOrF5VGvZXqqwy9ePcfC/AQaY9LAjE5y+NPkP5qX08Y653DOIRiDUSOHB0esrf2MtY936B5XOGfOEJI+MeUjubSyrJCMU2F8rMkzn36Uay98mqefOM9Ep6ARPRBtQsnrVYBrgDTtOTEHhfVRhRgIZcnW7i7ff/MOX//WDf7n5seAsZPJjUBxamHmulFnWpWV5/adDV59/Rbv33nAeNMxP9XCRU/V6xMGJaH0qAcNqVYRrbzVskQHPUK/iw66ON9nquO4tLLIL1xeYuPhHnfvbVE4B3VQFIpH5qauZ3qtOlqtJiEqt+9u8tobd/lwfY/JyQnGJicpo2MQHH0v9EqlXwX6VWRQKf1UBzFCQ2mIR2Ig+orQ7zE32eDs8iw372yyuXVEs1EYK4CsriyrigxDfDJITbnGh8Cg9MxOj3H2zDytVsO0UHPPonA0HBSmIACddpPVi6f5wvOPsXphDgnejB/oVZFvvHyTr/7d6wiCj0rQBASxlJ89oTbeFJrFCRojvgpGpLmZxZHkxgm9GWKIRIVfunKGv/jjX+Opy2coBwExn+VHtze5/tVvc39jH+cKfDQ5Q1VGQFjEzbkFGkXB2FiLsfEW42MtJibaTIx3aHdaNFsNmq0mrXaLdqfF1FSHmakO99d3+c7rtykrY8R7j/cV7QZMjLXw3iI2KZOjKQSnoJC/pZ2W/c9Mj/OrTz/Gl178FX7/9z7DlUtLDMqKECLeR3yI+BCIMaIKhRMaDcfhQZ/jbg8fKsr+MWXvkMFxl0HpLV6lxOVItoAFWAtSIjhnSQqBlQun+MqffYG/+etr/Pmffp4Xf+dZ5mYm8D5QFDmZGaUKxKj4EIlR6bQLNAzodQ8pe4f0jw/Z2tpjd/8Y51y9pXQGwgTkZUCgSMHp1PwEX7r2JL/53DnobnO8vcH777zHm2/fo9ksELAwnkI3CkEjpQ+0mo6Vs1Pg+wy6XXxV0e0OuH1vh92DPq1mAmJJz+jI7ms0WbhuFAXnl2d59lOL+MMuMZT0jru8c3ONze0jnDhisBxVuGFFodFwPHV5gadXZ+h1jwkxEgKsb/X4wbubxl+mXARXzw6W7BIzISrNhvDo8iyfmJvAV8bX1k6Xt289oKo8IUSqtASIWtAthJnJFp9/domXvniBThEZlBVoYGu3y7+9fo+f3tul3SpsXLbR1ZUzatE9r7KVECNz023+5KVf5qXfukL3uEQk8sY76/zV115la6fL8uIEF5anaDYdzYaj1RRmp9pcuTDD1UenaDjF+4iIY32rz79+7z7ffWsDVIgqeAVVyz2yevFMju51GEGEECOfXJ7hK19+hicuztEfeEof+cZ3/pev/eNbrJyd4MsvXuQzVxeovAU21UgMnlhVHPUqBqWyd1Ty4/f3eeXNLT5YP6bZdEQEHyDUQBS5fNGSXr0m2AfnhM8+scRf/uGTTLTMlLb2+/ztv7zLqzc+5trnlvmjayv4oISoECMHB32+/+Nt3lvbR1AOjyMPtgZs7gwICs2mw0eLpjFCSGyoHbBs7fPWiLQn7bQKLp6bZHK8wSAoXuHhbo8PH3SRouCt23t8+wfrxOAJvsRXJWOtyMrZMY56yitv7vD2+3vsHpV02o5OuyBGsVBfH8JSEaF4ZH7quplpakvG88hMmy8+e5rzi+MMBp5QVbzz3kNe+eE6qrC9X3LzgwPGO/DJ022Cr1BVHplt8dTjs3Rajs3tAU5s1+eDEpNtBNUTGyTVFEcksZCDa+Ecp2ZbnJkXuvs7lN099nZ3+MndbfaPStBIw8H+oeefXn7Ad3+0Q9FwqDgGXmm1HS88t8gLn12k1SzwKUBFhWg+giJph2bvTmuaDImK0GoWnFtsM90JHB0dUPYP2Nza49YH+3gPIZo2rWbBYTfwzf/c4I1bezQaFlXLygPK80/O8dvPLdBpCoMq5S4lcW6ui73a5lnTdQMiaIROCy4stSjEU/mKQVXx0cYxa5s9mg0z5ohpKM7xs93AP7+8wY2bO4h6fDlg0D8mVD2eudzmd399hpkJRxVS3Ej5xQgwEpxKCqMJmogyM+k4f8oRQgCBvcOKGz89oNsPtBpixqYW9HyIBI2sPSz5+39/wI1bWxBLfOUpK0/lA0891uEPfmOGpbmCEPO2dDgnomasdgwE1Hbjq+faPH91EkTZ2R/wrf/e43vvHtEonF01JK0U8wJjVDjoBtY2B5yed3xiNkdO+740J5ydL1jb8mwfWniwJTIsxan56euSrgmiQqftePrxMT51rsNHGz2+/toOr717TFFkn8812VWiWFAK5zjsKRs7FedOFZyadvgQUI2EEFmYFi4sFjzcj2zuj9gIQrG4MH3dro9sorlJx3NXx+kPPP/wH7v88L0B7abZzgnfHzW2tNUUsSPnwbHyYLtiaU6ZmyS5ruIjTI87VpYadPvK/e3hjq+OI5pM5dxik+WFJt/8r31+8uGA8bb5vvm93X8NbS2l7LQ0IoJLzXtHkfWtkoVJmJ1w9fk4okyOweqywxH5aCsSIhbibb1tA3x6rkHhhLvrAzqtnAvkxLYRtRslId0Q1Ce+xIqkM7MoM+Pw+JmCpXlHu2XAJe0Ce/3IG3c8t+/HdNIbuSOL0Xy9WVjAsSVL/i85PA8nHy2SDmp2CIcinbtKP7zyMqWEEM3rCmciLdeMuHXhhEaRlqIGkWvyGMn7WRtYG3B6TjkQ7+2/WUCrYf/NhlIUmp6zcvlaIrFhlNtk1JNhybDeQOVkbcFI7SX1t4N1VEvxIUIVlTIIZRCqIFTBjDdvnLMSKfsOy+hHHVmJYbEGsxg7uA4Bj7JigDI7thR26B6VnydwaBKUhJ/IAUNzSMW0l8SoMZg/DZFkFiNCjDm5DUEOp5D6pb7Asde8HRi+5RbBbAZNgEWSraTJazlJqaxg+pZLHZFro8+MpFnSMg+h1NDrRfh5WAYCsyt7SN/yzDULycjJtma0jYJM96wj5Of3lH8EGF695E2tlQy+RpRdOuPKL/k/G+iokDTUKUnQiDvmHqk50R1PGmVtV7mP1ZjbkhQRexpan8FPCbyWKVcunc896zIKxxpOmHBuSiUx9f8Wc/XcO698lvx/VL/6n++r+SAAAAAASUVORK5CYII=") center/18px 25px no-repeat; color:transparent; font-size:0; }
    #vxStandalonePanel { border-color:var(--vx-accent-line); }
    #vxStandaloneBrand,#vxStandaloneMin,.vxStandaloneName,#vxCurrentSetting,.vxChangelogVersion { color:var(--vx-accent); }
    #vxStandaloneMin,.vxOpenSettings,.vxNavBtn,.vxActionBtn { border-color:var(--vx-accent-line); }
    .vxStandaloneRow { border-color:var(--vx-accent-line); }
    #vxStandaloneFooter { border-top-color:var(--vx-accent-line); }
    #vxStandaloneMini { border-color:var(--vx-accent-line); }
    #vxSettingsToolbar { border-bottom-color:var(--vx-accent-line); }
    /* Widok główny jest przewijany wewnątrz okna; stopka zostaje na dole. */
    #vxHomeView { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:repeat(2,minmax(86px,auto)); grid-auto-rows:minmax(86px,auto); align-content:start; align-items:stretch; gap:4px; padding:5px; flex:1 1 0%; height:0; min-height:0; max-height:none; overflow-y:auto; overflow-x:hidden; }
    #vxHomeView.vxNarrow { grid-template-columns:minmax(0,1fr); grid-template-rows:none; grid-auto-rows:minmax(68px,auto); }
    #vxHomeView, #vxSettingsView, #vxChangelogView, #vxAppearanceView { scrollbar-width:thin; scrollbar-color:rgba(201,162,39,.25) transparent; overscroll-behavior:contain; }
    #vxSettingsWnm .vxWnmControl { width:100%; box-sizing:border-box; padding:6px 8px; border:1px solid var(--vx-accent-line); border-radius:5px; color:#f3e7c5; background:#171717; font:12px Arial,sans-serif; }
    #vxSettingsWnm input[type="checkbox"] { accent-color:var(--vx-accent); }
    #vxHomeView::-webkit-scrollbar, #vxSettingsView::-webkit-scrollbar, #vxChangelogView::-webkit-scrollbar, #vxAppearanceView::-webkit-scrollbar { width:4px; }
    #vxHomeView::-webkit-scrollbar-track, #vxSettingsView::-webkit-scrollbar-track, #vxChangelogView::-webkit-scrollbar-track, #vxAppearanceView::-webkit-scrollbar-track { background:transparent; }
    #vxHomeView::-webkit-scrollbar-thumb, #vxSettingsView::-webkit-scrollbar-thumb, #vxChangelogView::-webkit-scrollbar-thumb, #vxAppearanceView::-webkit-scrollbar-thumb { background:rgba(201,162,39,.22); border-radius:8px; }
    #vxHomeView::-webkit-scrollbar-thumb:hover, #vxSettingsView::-webkit-scrollbar-thumb:hover, #vxChangelogView::-webkit-scrollbar-thumb:hover, #vxAppearanceView::-webkit-scrollbar-thumb:hover { background:rgba(201,162,39,.42); }
    @media (max-width:560px) { #vxStandalonePanel { max-width:calc(100vw - 12px); max-height:calc(100vh - 12px); left:6px; top:6px; } #vxSidebar { flex-basis:86px; width:86px; padding:6px 4px; } .vxSideTab { padding:6px 4px; gap:4px; } #vxHomeView { grid-template-columns:minmax(0,1fr); grid-auto-rows:minmax(68px,auto); } #vxSettingsView { max-height:none; } .vxStandaloneRow { min-height:68px; padding:5px; } .vxStandaloneName { font-size:9px; } .vxStandaloneDesc { font-size:7.5px; } .vxStandaloneState { font-size:6.8px; } .vxOpenSettings { font-size:7.5px; padding:3px 5px; } }
    #vxSettingsLootChance #mlc513-panel { position:relative!important; left:auto!important; top:auto!important; right:auto!important; bottom:auto!important; width:100%!important; max-width:100%!important; margin:0!important; padding:3px!important; z-index:1!important; box-shadow:none!important; border:0!important; border-radius:0!important; background:transparent!important; display:block!important; }
    #mlc513-panel { display:none!important; }
    #vxSettingsLootChance #mlc513-panel .heading { display:none!important; }
    #vxSettingsLootChance #mlc513-panel > div:not(.heading) { display:block!important; }
    #vxSettingsLootChance #mlc513-panel label { color:#f5f0d5; }
    #vxSettingsLootChance #mlc513-panel .status { overflow-wrap:anywhere; }
    #vxSettingsLoot #tmLootPanel { position:relative!important; left:auto!important; top:auto!important; right:auto!important; bottom:auto!important; width:100%!important; max-width:100%!important; height:auto!important; margin:0!important; z-index:1!important; box-shadow:none!important; border:0!important; border-radius:0!important; background:transparent!important; }
    #vxSettingsLoot #tmLootHeader { display:none!important; }
    #vxSettingsLoot #tmLootBody { display:block!important; padding:3px!important; }
    #vxSettingsLoot #tmLootPanel.tmCollapsed { width:100%!important; height:auto!important; }
    #vxSettingsDc #margDc221Panel { position:relative!important; left:auto!important; top:auto!important; right:auto!important; bottom:auto!important; width:100%!important; max-width:100%!important; margin:0!important; z-index:1!important; box-shadow:none!important; }
    #vxSettingsDc #margDc221Header { display:none!important; }
    #vxSettingsDc #margDc221Body { padding:4px!important; }
    .vxLootlogInfo { padding:8px; color:#b9ad84; font-size:11px; line-height:1.45; border:1px solid #5f4b20; border-radius:5px; background:rgba(17,17,17,.72); margin-bottom:8px; }
    .vxLootlogActions { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
    .vxLootlogActions button { min-width:0; padding:8px 5px; border:1px solid #806321; border-radius:4px; background:rgba(23,20,12,.86); color:#dfb943; font-size:10px; cursor:pointer; }
    .vxLootlogActions button:hover { background:rgba(48,37,11,.92); border-color:#d4af37; color:#ffe28a; }
    /* Sterowanie belką jest dostępne w panelu Vickness, bez osobnego pływającego menu. */
    #vickness-lootbar .vl-controls { display:none!important; }

    /* Spójna, czytelna typografia we wszystkich trzech zakładkach. */
    #vxStandalonePanel { font-family:Arial,sans-serif; }
    #vxStandalonePanel .vxView,
    #vxStandalonePanel .vxExtraView,
    #vxStandalonePanel .vxPageCard,
    #vxStandalonePanel .vxStandaloneRow { font-family:Arial,sans-serif; font-size:12px; line-height:1.35; }
    #vxHomeView { grid-auto-rows:minmax(76px,auto); gap:5px; padding:6px; }
    #vxHomeView.vxNarrow { grid-auto-rows:minmax(76px,auto); }
    .vxStandaloneRow { min-height:76px; padding:6px; gap:6px; align-items:flex-start; }
    .vxStandaloneRow > div:first-child { min-width:0; overflow-wrap:anywhere; }
    .vxStandaloneName { font-size:12px; line-height:1.16; }
    .vxStandaloneDesc { font-size:10px; line-height:1.24; margin-top:3px; }
    .vxStandaloneState { font-size:9px; line-height:1.15; margin-top:3px; }
    .vxOpenSettings,.vxNavBtn { font-size:10px; line-height:1.15; padding:4px 6px; margin-top:4px; }
    .vxPageCard { font-size:12px; line-height:1.38; padding:10px; }
    .vxPageTitle { font-size:15px; line-height:1.25; margin-bottom:6px; }
    .vxChangelogEntry { font-size:12px; line-height:1.38; padding:7px 0; }
    .vxChangelogEntry > div { font-size:12px; line-height:1.4; margin-top:4px; }
    .vxChangelogVersion { font-size:13px; }
    .vxChangelogDate { font-size:9px; }
    .vxPageNote { font-size:10px; line-height:1.4; }
    .vxAppearanceControl { font-size:12px; line-height:1.35; margin:8px 0; }
    .vxAppearanceControl output { font-size:12px; }
    .vxActionBtn,.vxLootlogActions button { font-size:10px; line-height:1.2; }
    .vxLootlogInfo { font-size:11px; line-height:1.4; }
    #vxSettingsToolbar { font-size:11px; }
    #vxCurrentSetting { font-size:12px; }
    @media (max-width:560px) {
      .vxStandaloneName { font-size:11px; }
      .vxStandaloneDesc { font-size:9px; }
      .vxStandaloneState { font-size:8px; }
      .vxOpenSettings,.vxNavBtn { font-size:9px; }
      .vxPageCard,.vxChangelogEntry,.vxChangelogEntry > div { font-size:11px; }
      .vxPageTitle { font-size:14px; }
      #vxHomeView { grid-auto-rows:minmax(76px,auto); }
    }
    /* Wymuś czytelną, spójną czcionkę w bocznych kafelkach niezależnie od CSS gry. */
    #vicknessStandaloneRoot #vxStandalonePanel #vxSidebar .vxSideTab {
      font-family:Arial,Helvetica,sans-serif!important;
      font-size:12px!important;
      font-weight:600!important;
      font-style:normal!important;
      line-height:1.2!important;
      letter-spacing:0!important;
      text-transform:none!important;
      text-decoration:none!important;
      white-space:normal!important;
      -webkit-font-smoothing:antialiased;
    }
    #vicknessStandaloneRoot #vxStandalonePanel #vxSidebar .vxSideTab > span:not(.vxTabIcon) {
      font-family:Arial,Helvetica,sans-serif!important;
      font-size:12px!important;
      font-weight:600!important;
      font-style:normal!important;
      line-height:1.2!important;
      letter-spacing:0!important;
      text-transform:none!important;
    }
    #vicknessStandaloneRoot #vxStandalonePanel #vxSidebar .vxSideTab .vxTabIcon {
      font-family:Arial,Helvetica,sans-serif!important;
      font-size:14px!important;
      font-weight:400!important;
      font-style:normal!important;
      line-height:1!important;
      letter-spacing:0!important;
    }

    /* 1.1.74 – izolacja panelu od globalnych styli Margonem */
    #vicknessStandaloneRoot #vxStandalonePanel,
    #vicknessStandaloneRoot #vxStandalonePanel *,
    #vicknessStandaloneRoot #vxStandalonePanel *::before,
    #vicknessStandaloneRoot #vxStandalonePanel *::after {
      box-sizing:border-box!important;
      font-family:Arial,Helvetica,sans-serif!important;
      letter-spacing:normal!important;
      text-transform:none!important;
      font-style:normal!important;
      text-shadow:none!important;
    }
    #vicknessStandaloneRoot #vxStandalonePanel {
      width:min(620px,calc(100vw - 16px))!important;
      height:min(410px,calc(100vh - 16px))!important;
      min-width:min(560px,calc(100vw - 16px))!important;
      min-height:min(330px,calc(100vh - 16px))!important;
      max-width:calc(100vw - 16px)!important;
      max-height:calc(100vh - 16px)!important;
      display:flex;
      flex-direction:column!important;
      overflow:hidden!important;
      border:1px solid rgba(191,151,57,.82)!important;
      border-radius:9px!important;
      background:
        radial-gradient(ellipse at 80% 100%,rgba(174,126,39,.13),transparent 42%),
        linear-gradient(145deg,rgba(13,14,15,.985),rgba(20,19,17,.985) 55%,rgba(8,9,10,.99))!important;
      color:#e5e1d7!important;
      line-height:1.25!important;
      box-shadow:0 8px 30px rgba(0,0,0,.82),inset 0 0 28px rgba(190,150,62,.045)!important;
    }
    #vicknessStandaloneRoot #vxStandaloneHeader {
      position:relative!important;
      flex:0 0 58px!important;
      height:58px!important;
      min-height:58px!important;
      display:flex!important;
      flex-direction:column!important;
      align-items:center!important;
      justify-content:center!important;
      gap:2px!important;
      padding:5px 42px!important;
      border-bottom:1px solid rgba(191,151,57,.48)!important;
      background:linear-gradient(90deg,#0b0c0d,#171613 50%,#0b0c0d)!important;
      text-align:center!important;
    }
    #vicknessStandaloneRoot #vxBrandMark { display:none!important; }
    #vicknessStandaloneRoot #vxBrandText {
      display:flex!important; flex-direction:column!important; align-items:center!important;
      justify-content:center!important; gap:2px!important; width:auto!important;
    }
    #vicknessStandaloneRoot #vxStandaloneBrand {
      display:block!important; margin:0!important; padding:0!important;
      color:#d9ad50!important; font-size:15px!important; font-weight:700!important;
      line-height:17px!important;
    }
    #vicknessStandaloneRoot #vxBrandSub {
      display:block!important; margin:0!important; padding:0!important;
      color:#e3e0d9!important; font-size:13px!important; line-height:15px!important;
    }
    #vicknessStandaloneRoot #vxBrandSub span {
      display:inline-block!important; margin-left:4px!important; padding:1px 4px!important;
      color:#d6bd80!important; font-size:8px!important; line-height:10px!important;
      border:1px solid rgba(191,151,57,.5)!important; border-radius:7px!important;
    }
    #vicknessStandaloneRoot #vxStandaloneMin {
      position:absolute!important; right:8px!important; top:7px!important;
      width:25px!important; height:28px!important; min-width:25px!important;
      padding:0!important; border:1px solid rgba(191,151,57,.8)!important;
      border-radius:5px!important; background-color:#15130e!important;
      background-position:center!important; background-repeat:no-repeat!important;
      background-size:18px 24px!important; color:transparent!important;
    }
    #vicknessStandaloneRoot #vxWorkspace {
      display:flex!important; flex:1 1 auto!important; flex-direction:row!important;
      min-width:0!important; min-height:0!important; overflow:hidden!important;
    }
    #vicknessStandaloneRoot #vxSidebar {
      display:flex!important; flex:0 0 100px!important; width:100px!important;
      min-width:100px!important; flex-direction:column!important; gap:5px!important;
      padding:8px 6px!important; margin:0!important;
      border-right:1px solid rgba(191,151,57,.27)!important;
      background:rgba(5,6,7,.72)!important; overflow:hidden!important;
    }
    #vicknessStandaloneRoot #vxSidebar .vxSideTab {
      display:flex!important; align-items:center!important; justify-content:flex-start!important;
      gap:7px!important; width:100%!important; min-width:0!important; min-height:34px!important;
      height:34px!important; margin:0!important; padding:6px 7px!important;
      border:1px solid rgba(164,139,82,.27)!important; border-radius:6px!important;
      background:linear-gradient(100deg,rgba(42,41,37,.88),rgba(17,17,16,.92))!important;
      color:#c9c5bb!important; font-size:10px!important; font-weight:600!important;
      line-height:13px!important; text-align:left!important; cursor:pointer!important;
    }
    #vicknessStandaloneRoot #vxSidebar .vxSideTab.active {
      border-color:#c29a43!important; color:#f0ca70!important;
      background:linear-gradient(100deg,rgba(104,76,25,.58),rgba(35,29,18,.9))!important;
      box-shadow:inset 2px 0 #d2a84d!important;
    }
    #vicknessStandaloneRoot #vxSidebar .vxTabIcon {
      display:inline-flex!important; align-items:center!important; justify-content:center!important;
      flex:0 0 15px!important; width:15px!important; height:15px!important;
      color:#d6ad53!important; font-size:14px!important; line-height:15px!important;
    }
    #vicknessStandaloneRoot #vxContentArea {
      display:flex!important; flex:1 1 auto!important; flex-direction:column!important;
      width:auto!important; min-width:0!important; min-height:0!important;
      overflow:hidden!important; background:rgba(8,8,8,.16)!important;
    }
    #vicknessStandaloneRoot #vxContentHeading {
      display:flex!important; flex:0 0 53px!important; height:53px!important; min-height:53px!important;
      align-items:center!important; justify-content:space-between!important; gap:10px!important;
      width:100%!important; margin:0!important; padding:7px 11px!important;
      border-bottom:1px solid rgba(191,151,57,.2)!important;
      background:linear-gradient(90deg,rgba(30,28,23,.68),rgba(12,12,12,.3))!important;
    }
    #vicknessStandaloneRoot #vxContentHeading > div {
      display:flex!important; flex:1 1 auto!important; flex-direction:row!important;
      align-items:center!important; justify-content:flex-start!important; gap:9px!important;
      min-width:0!important; width:auto!important;
    }
    #vicknessStandaloneRoot .vxHeadingIcon {
      display:inline-flex!important; flex:0 0 20px!important; width:20px!important;
      align-items:center!important; justify-content:center!important;
      color:#d8ae52!important; font-size:19px!important; line-height:22px!important;
    }
    #vicknessStandaloneRoot #vxContentTitle {
      display:block!important; margin:0!important; padding:0!important;
      color:#e8e5dd!important; font-size:16px!important; font-weight:700!important;
      line-height:19px!important; white-space:nowrap!important;
    }
    #vicknessStandaloneRoot #vxContentSubtitle {
      display:block!important; margin:2px 0 0!important; padding:0!important;
      color:#aaa69d!important; font-size:9px!important; font-weight:400!important;
      line-height:12px!important; white-space:normal!important;
    }
    #vicknessStandaloneRoot #vxAddonCount {
      display:inline-block!important; flex:0 0 auto!important; margin:0!important;
      padding:4px 8px!important; border:1px solid rgba(191,151,57,.58)!important;
      border-radius:12px!important; background:rgba(55,42,15,.48)!important;
      color:#e6c879!important; font-size:9px!important; line-height:11px!important;
      white-space:nowrap!important;
    }
    #vicknessStandaloneRoot #vxHomeView {
      display:grid; flex:1 1 0%!important; width:100%!important;
      min-width:0!important; min-height:0!important; height:0!important;
      grid-template-columns:repeat(2,minmax(0,1fr))!important;
      grid-template-rows:repeat(2,minmax(70px,auto))!important;
      grid-auto-rows:minmax(70px,auto)!important;
      align-content:start!important; align-items:stretch!important;
      gap:5px!important; margin:0!important; padding:7px!important;
      overflow-y:auto!important; overflow-x:hidden!important;
      background:transparent!important;
    }
    #vicknessStandaloneRoot #vxHomeView.vxNarrow {
      grid-template-columns:minmax(0,1fr)!important; grid-template-rows:none!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneRow {
      display:flex!important; position:relative!important; flex-direction:row!important;
      align-items:center!important; justify-content:space-between!important;
      gap:6px!important; width:auto!important; min-width:0!important; max-width:100%!important;
      min-height:70px!important; height:auto!important; margin:0!important; padding:7px 8px!important;
      overflow:hidden!important; border:1px solid rgba(150,123,67,.45)!important;
      border-radius:6px!important;
      background:linear-gradient(110deg,rgba(44,43,39,.93),rgba(20,20,19,.96))!important;
      color:#e1ddd4!important; line-height:1.2!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneRow:hover {
      border-color:rgba(207,169,83,.8)!important;
      background:linear-gradient(110deg,rgba(55,49,37,.96),rgba(24,23,21,.97))!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneRow > div:first-child {
      display:block!important; flex:1 1 auto!important; width:auto!important;
      min-width:0!important; max-width:100%!important; overflow:hidden!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneName {
      display:flex!important; align-items:center!important; gap:4px!important;
      width:100%!important; max-width:100%!important; min-width:0!important;
      margin:0!important; padding:0!important; color:#e6e0d4!important;
      font-size:10px!important; font-weight:700!important; line-height:13px!important;
      white-space:normal!important; overflow-wrap:anywhere!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxCardIcon {
      display:inline-flex!important; flex:0 0 18px!important; width:18px!important;
      height:18px!important; align-items:center!important; justify-content:center!important;
      margin:0 2px 0 0!important; color:#d7ad50!important;
      font-size:14px!important; line-height:18px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneDesc {
      display:block!important; margin:3px 0 0!important; padding:0!important;
      color:#aaa69d!important; font-size:9px!important; font-weight:400!important;
      line-height:12px!important; white-space:normal!important; overflow-wrap:anywhere!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneState {
      display:block!important; margin:2px 0 0!important; padding:0!important;
      color:#9b978e!important; font-size:8px!important; line-height:10px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxOpenSettings {
      display:inline-flex!important; align-items:center!important; justify-content:center!important;
      flex:0 0 24px!important; width:24px!important; height:22px!important; min-width:24px!important;
      margin:4px 0 0!important; padding:0!important; border:1px solid rgba(191,151,57,.65)!important;
      border-radius:5px!important; background:rgba(25,22,15,.92)!important; color:#e2bd67!important;
      font-size:15px!important; line-height:18px!important; cursor:pointer!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxInfoBtn {
      display:inline-flex!important; flex:0 0 14px!important; align-items:center!important;
      justify-content:center!important; width:14px!important; height:14px!important;
      min-width:14px!important; margin:0 0 0 2px!important; padding:0!important;
      border:1px solid rgba(191,151,57,.7)!important; border-radius:50%!important;
      background:rgba(8,8,8,.65)!important; color:#e2bd67!important;
      font-size:9px!important; line-height:11px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxToggle {
      display:block!important; position:relative!important; flex:0 0 28px!important;
      width:28px!important; height:15px!important; min-width:28px!important;
      margin:0 0 0 3px!important;
    }
    #vicknessStandaloneRoot #vxStandaloneFooter {
      display:block!important; flex:0 0 18px!important; height:18px!important;
      margin:0!important; padding:3px 7px!important; border-top:1px solid rgba(191,151,57,.2)!important;
      background:rgba(6,7,8,.88)!important; color:#77736a!important;
      font-size:8px!important; line-height:10px!important; text-align:center!important;
    }
    #vicknessStandaloneRoot #vxUpdateInfoView,
    #vicknessStandaloneRoot #vxSettingsView,
    #vicknessStandaloneRoot #vxChangelogView,
    #vicknessStandaloneRoot #vxAppearanceView {
      min-width:0!important; min-height:0!important; overflow:auto!important;
      font-size:11px!important; line-height:1.4!important;
    }
    #vicknessStandaloneRoot #vxInfoModal,
    #vicknessStandaloneRoot .vxInfoModal { font-size:12px!important; }
    @media(max-width:600px) {
      #vicknessStandaloneRoot #vxStandalonePanel { min-width:0!important; }
      #vicknessStandaloneRoot #vxSidebar { flex-basis:86px!important; width:86px!important; min-width:86px!important; }
      #vicknessStandaloneRoot #vxHomeView { grid-template-columns:minmax(0,1fr)!important; grid-template-rows:none!important; }
    }


    /* 1.1.77 – nieco większy panel i czytelniejszy tekst */
    #vicknessStandaloneRoot #vxStandalonePanel {
      width:min(760px,calc(100vw - 28px))!important;
      height:min(510px,calc(100vh - 24px))!important;
      min-width:min(620px,calc(100vw - 28px))!important;
      min-height:min(390px,calc(100vh - 24px))!important;
    }
    #vicknessStandaloneRoot #vxStandaloneHeader {
      flex-basis:66px!important;
      height:66px!important;
      min-height:66px!important;
    }
    #vicknessStandaloneRoot #vxStandaloneBrand {
      font-size:17px!important;
      line-height:20px!important;
    }
    #vicknessStandaloneRoot #vxBrandSub {
      font-size:14px!important;
      line-height:17px!important;
    }
    #vicknessStandaloneRoot #vxSidebar {
      flex-basis:116px!important;
      width:116px!important;
      min-width:116px!important;
      padding:10px 7px!important;
      gap:7px!important;
    }
    #vicknessStandaloneRoot #vxSidebar .vxSideTab {
      min-height:38px!important;
      height:38px!important;
      padding:7px 8px!important;
      font-size:11px!important;
      line-height:15px!important;
    }
    #vicknessStandaloneRoot #vxSidebar .vxTabIcon {
      font-size:15px!important;
    }
    #vicknessStandaloneRoot #vxContentHeading {
      flex-basis:60px!important;
      height:60px!important;
      min-height:60px!important;
      padding:8px 13px!important;
    }
    #vicknessStandaloneRoot #vxContentTitle {
      font-size:18px!important;
      line-height:22px!important;
    }
    #vicknessStandaloneRoot #vxContentSubtitle {
      font-size:10px!important;
      line-height:14px!important;
    }
    #vicknessStandaloneRoot #vxAddonCount {
      font-size:10px!important;
      line-height:13px!important;
      padding:5px 9px!important;
    }
    #vicknessStandaloneRoot #vxHomeView {
      gap:7px!important;
      padding:9px!important;
      grid-template-rows:repeat(2,minmax(82px,auto))!important;
      grid-auto-rows:minmax(82px,auto)!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneRow {
      min-height:82px!important;
      padding:9px 10px!important;
      gap:8px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneName {
      font-size:11px!important;
      line-height:15px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxCardIcon {
      flex-basis:20px!important;
      width:20px!important;
      height:20px!important;
      font-size:16px!important;
      line-height:20px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneDesc {
      font-size:10px!important;
      line-height:14px!important;
      margin-top:4px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneState {
      font-size:9px!important;
      line-height:12px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxInfoBtn {
      flex-basis:16px!important;
      width:16px!important;
      height:16px!important;
      min-width:16px!important;
      font-size:10px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxToggle {
      flex-basis:31px!important;
      width:31px!important;
      min-width:31px!important;
    }
    #vicknessStandaloneRoot #vxStandaloneFooter {
      flex-basis:20px!important;
      height:20px!important;
      font-size:9px!important;
      line-height:12px!important;
    }
    #vicknessStandaloneRoot #vxUpdateInfoView,
    #vicknessStandaloneRoot #vxSettingsView,
    #vicknessStandaloneRoot #vxChangelogView,
    #vicknessStandaloneRoot #vxAppearanceView {
      font-size:12px!important;
      line-height:1.5!important;
    }
    #vicknessStandaloneRoot .vxPageCard,
    #vicknessStandaloneRoot .vxPageNote {
      font-size:12px!important;
      line-height:1.5!important;
    }
    @media(max-width:660px) {
      #vicknessStandaloneRoot #vxStandalonePanel {
        width:calc(100vw - 12px)!important;
        min-width:0!important;
        height:min(510px,calc(100vh - 12px))!important;
      }
      #vicknessStandaloneRoot #vxSidebar {
        flex-basis:94px!important;
        width:94px!important;
        min-width:94px!important;
      }
      #vicknessStandaloneRoot #vxHomeView {
        grid-template-columns:minmax(0,1fr)!important;
        grid-template-rows:none!important;
      }
    }


    /* 1.1.79 – widoczne ustawienia, chowanie panelu i działające krycie */
    #vicknessStandaloneRoot #vxStandalonePanel {
      background:rgba(8,8,8,var(--vx-panel-alpha,.88))!important;
      backdrop-filter:blur(var(--vx-panel-blur,4px))!important;
      -webkit-backdrop-filter:blur(var(--vx-panel-blur,4px))!important;
    }
    #vicknessStandaloneRoot #vxStandaloneHeader {
      background:rgba(16,16,16,var(--vx-header-alpha,.92))!important;
    }
    #vicknessStandaloneRoot #vxStandaloneFooter {
      background:rgba(10,10,10,var(--vx-footer-alpha,.86))!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneRow,
    #vicknessStandaloneRoot .vxPageCard {
      background:rgba(20,20,20,var(--vx-card-alpha,.76))!important;
    }
    #vicknessStandaloneRoot #vxStandaloneHide {
      position:absolute!important; right:39px!important; top:7px!important;
      display:flex!important; align-items:center!important; justify-content:center!important;
      width:25px!important; height:28px!important; min-width:25px!important;
      margin:0!important; padding:0!important; border:1px solid rgba(191,151,57,.7)!important;
      border-radius:5px!important; background:rgba(10,10,10,.9)!important;
      color:#e4c36f!important; font:18px/20px Arial,sans-serif!important; cursor:pointer!important;
    }
    #vicknessStandaloneRoot #vxStandaloneHide:hover {
      background:rgba(80,35,25,.95)!important; border-color:#d88b65!important; color:#fff!important;
    }
    #vicknessStandaloneRoot #vxStandaloneMin { right:7px!important; }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneRow > div:first-child {
      display:flex!important; flex-direction:column!important; align-items:flex-start!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneName {
      display:flex!important; flex-wrap:wrap!important; align-items:center!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxOpenSettings {
      display:inline-flex!important; align-self:flex-start!important;
      margin-top:5px!important;
    }


    /* 1.1.80 – mini-belka w pełnym motywie, samo logo R bez ramki */
    #vicknessStandaloneRoot #vxStandaloneMini {
      background:var(--vx-widget-header)!important;
      color:var(--vx-widget-light)!important;
      border:1px solid var(--vx-widget-accent)!important;
      box-shadow:0 4px 16px var(--vx-widget-glow)!important;
      border-radius:6px!important;
    }
    #vicknessStandaloneRoot #vxStandaloneMini .diamond {
      display:inline-block!important;
      width:24px!important;height:28px!important;flex:0 0 24px!important;
      border:0!important;border-radius:0!important;
      background-color:transparent!important;
      box-shadow:none!important;
      background-position:center!important;background-repeat:no-repeat!important;
      background-size:contain!important;
    }
    #vicknessStandaloneRoot #vxStandaloneMini #vxMiniAddonCount {
      display:inline-flex!important;align-items:center!important;justify-content:center!important;
      min-width:30px!important;height:20px!important;padding:0 6px!important;
      border:1px solid var(--vx-widget-line)!important;border-radius:10px!important;
      background:var(--vx-widget-soft)!important;color:var(--vx-widget-light)!important;
      font:700 10px Arial,sans-serif!important;line-height:18px!important;
    }


    /* 1.1.81 – cała powierzchnia panelu dziedziczy wybrany motyw */
    #vicknessStandaloneRoot #vxStandalonePanel {
      background:var(--vx-widget-row-alt,#15120c)!important;
      border-color:var(--vx-widget-accent)!important;
    }
    #vicknessStandaloneRoot #vxStandaloneHeader,
    #vicknessStandaloneRoot #vxSettingsToolbar,
    #vicknessStandaloneRoot #vxContentHeading {
      background:var(--vx-widget-header)!important;
      border-color:var(--vx-widget-line)!important;
    }
    #vicknessStandaloneRoot #vxWorkspace,
    #vicknessStandaloneRoot #vxContent,
    #vicknessStandaloneRoot #vxSidebar,
    #vicknessStandaloneRoot #vxHomeView,
    #vicknessStandaloneRoot #vxSettingsView,
    #vicknessStandaloneRoot .vxExtraView {
      background:var(--vx-widget-row-alt)!important;
    }
    #vicknessStandaloneRoot #vxSidebar .vxSideTab {
      background:var(--vx-widget-soft)!important;
      border-color:var(--vx-widget-line)!important;
      color:var(--vx-widget-secondary)!important;
    }
    #vicknessStandaloneRoot #vxSidebar .vxSideTab.active,
    #vicknessStandaloneRoot #vxSidebar .vxSideTab:hover {
      background:var(--vx-widget-hover)!important;
      border-color:var(--vx-widget-accent)!important;
      color:var(--vx-widget-light)!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneRow,
    #vicknessStandaloneRoot .vxPageCard {
      background:var(--vx-widget-row)!important;
      border-color:var(--vx-widget-line)!important;
    }
    #vicknessStandaloneRoot #vxStandaloneFooter {
      background:var(--vx-widget-header)!important;
      border-color:var(--vx-widget-line)!important;
      color:var(--vx-widget-secondary)!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneName {
      display:flex!important; flex-direction:row!important;
      flex-wrap:wrap!important; align-items:center!important; gap:4px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxOpenSettings {
      display:inline-flex!important; position:static!important;
      flex:0 0 17px!important; width:17px!important; min-width:17px!important;
      height:17px!important; margin:0 0 0 1px!important; padding:0!important;
      border:1px solid var(--vx-widget-line)!important; border-radius:50%!important;
      background:var(--vx-widget-soft)!important; color:var(--vx-widget-light)!important;
      font-size:11px!important; line-height:15px!important;
    }


    /* 1.1.83 – kontrastowe nagłówki oraz mały przycisk samego logo R */
    #vicknessStandaloneRoot #vxContentTitle,
    #vicknessStandaloneRoot .vxPageTitle,
    #vicknessStandaloneRoot #vxAddonInfoTitle,
    #vicknessStandaloneRoot .vxChangelogVersion,
    #vicknessStandaloneRoot #vxMapDimmerCard .vxPageTitle {
      color:#fff0b8!important;
      text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 7px rgba(0,0,0,.7)!important;
    }
    #vicknessStandaloneRoot #vxContentHeading {
      background:linear-gradient(90deg,rgba(8,8,8,.94),rgba(24,20,12,.88))!important;
      border-bottom:1px solid var(--vx-accent-line)!important;
    }
    #vicknessStandaloneRoot #vxStandaloneMini {
      display:none;
      width:38px!important;height:38px!important;min-width:38px!important;
      padding:4px!important;margin:0!important;gap:0!important;
      align-items:center!important;justify-content:center!important;
      border:1px solid var(--vx-accent-line)!important;border-radius:7px!important;
      background:var(--vx-widget-header)!important;
      box-shadow:0 3px 12px var(--vx-widget-glow)!important;
    }
    #vicknessStandaloneRoot #vxStandaloneMini .diamond {
      display:block!important;flex:0 0 28px!important;
      width:28px!important;height:30px!important;min-width:28px!important;
      border:0!important;border-radius:0!important;
      background-color:transparent!important;box-shadow:none!important;
      background-position:center!important;background-repeat:no-repeat!important;
      background-size:contain!important;
    }
    #vicknessStandaloneRoot #vxStandaloneMini > span:not(.diamond) {
      display:none!important;
    }


    /* 1.1.84 – jednolita paleta motywu na każdej zakładce */
    #vicknessStandaloneRoot #vxContentHeading {
      background:var(--vx-widget-header)!important;
      border-bottom:1px solid var(--vx-widget-line)!important;
    }
    #vicknessStandaloneRoot #vxWorkspace,
    #vicknessStandaloneRoot #vxContentArea,
    #vicknessStandaloneRoot #vxContent,
    #vicknessStandaloneRoot #vxSidebar,
    #vicknessStandaloneRoot #vxHomeView,
    #vicknessStandaloneRoot #vxSettingsView,
    #vicknessStandaloneRoot #vxUpdateInfoView,
    #vicknessStandaloneRoot #vxChangelogView,
    #vicknessStandaloneRoot #vxAppearanceView,
    #vicknessStandaloneRoot .vxExtraView {
      background:var(--vx-widget-row-alt)!important;
    }
    #vicknessStandaloneRoot .vxPageCard,
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneRow,
    #vicknessStandaloneRoot .vxLootlogInfo,
    #vicknessStandaloneRoot .vxSettingsSlot,
    #vicknessStandaloneRoot .vxLootlogActions {
      background:var(--vx-widget-row)!important;
      border-color:var(--vx-widget-line)!important;
    }
    #vicknessStandaloneRoot #vxSettingsToolbar {
      background:var(--vx-widget-header)!important;
      border-color:var(--vx-widget-line)!important;
      color:var(--vx-widget-light)!important;
    }
    #vicknessStandaloneRoot .vxPageTitle,
    #vicknessStandaloneRoot #vxContentTitle,
    #vicknessStandaloneRoot #vxCurrentSetting,
    #vicknessStandaloneRoot .vxChangelogVersion {
      color:var(--vx-widget-light)!important;
    }
    #vicknessStandaloneRoot #vxContentSubtitle,
    #vicknessStandaloneRoot .vxPageNote,
    #vicknessStandaloneRoot .vxStandaloneDesc,
    #vicknessStandaloneRoot .vxStandaloneState,
    #vicknessStandaloneRoot .vxChangelogEntry {
      color:var(--vx-widget-secondary)!important;
    }
    #vicknessStandaloneRoot .vxChangelogEntry {
      border-top-color:var(--vx-widget-line)!important;
    }
    #vicknessStandaloneRoot .vxAppearanceControl select,
    #vicknessStandaloneRoot .vxAppearanceControl input:not([type="range"]) {
      background:var(--vx-widget-row-alt)!important;
      border-color:var(--vx-widget-line)!important;
      color:var(--vx-widget-table-text)!important;
    }


    /* 1.1.85 – kafelki wypełniają cały obszar siatki, lekko większa typografia */
    #vicknessStandaloneRoot #vxHomeView {
      align-content:stretch!important;
      align-items:stretch!important;
      grid-auto-rows:minmax(92px,1fr)!important;
      grid-template-rows:repeat(2,minmax(92px,1fr))!important;
      gap:6px!important;
      padding:6px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneRow {
      display:flex!important;
      align-self:stretch!important;
      width:100%!important;
      height:100%!important;
      min-height:92px!important;
      box-sizing:border-box!important;
      padding:9px 10px!important;
      background:var(--vx-widget-row)!important;
      border:1px solid var(--vx-widget-line)!important;
      border-radius:6px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneRow > div:first-child {
      display:flex!important;
      flex:1 1 auto!important;
      flex-direction:column!important;
      align-items:flex-start!important;
      width:auto!important;
      min-width:0!important;
      height:100%!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneName {
      font-size:13px!important;
      line-height:1.3!important;
      gap:6px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneDesc {
      font-size:11px!important;
      line-height:1.4!important;
      margin-top:5px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneState {
      font-size:10px!important;
      line-height:1.3!important;
      margin-top:auto!important;
      padding-top:5px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxInfoBtn,
    #vicknessStandaloneRoot #vxHomeView .vxOpenSettings {
      font-size:12px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxOpenSettings {
      margin-top:5px!important;
    }
    @media(max-width:660px) {
      #vicknessStandaloneRoot #vxHomeView {
        grid-template-columns:minmax(0,1fr)!important;
        grid-template-rows:none!important;
        grid-auto-rows:minmax(88px,auto)!important;
      }
      #vicknessStandaloneRoot #vxHomeView .vxStandaloneRow {
        height:auto!important;
        min-height:88px!important;
      }
    }


    /* 1.1.86 – znak zapytania i zębatka w jednej linii przy nazwie dodatku */
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneName {
      display:flex!important;
      flex-direction:row!important;
      flex-wrap:wrap!important;
      align-items:center!important;
      column-gap:5px!important;
      row-gap:2px!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneName .vxInfoBtn {
      display:inline-flex!important;
      flex:0 0 16px!important;
      align-items:center!important;
      justify-content:center!important;
      width:16px!important;height:16px!important;min-width:16px!important;
      margin:0!important;
      vertical-align:middle!important;
    }
    #vicknessStandaloneRoot #vxHomeView .vxStandaloneName .vxOpenSettings {
      display:inline-flex!important;
      flex:0 0 18px!important;
      align-self:center!important;
      align-items:center!important;
      justify-content:center!important;
      width:18px!important;height:18px!important;min-width:18px!important;
      margin:0!important;padding:0!important;
      font-size:12px!important;line-height:16px!important;
      vertical-align:middle!important;
    }


    /* 1.1.87 – nagłówki we wszystkich widokach w stylu „Złote przyciemnienie mapy” */
    #vicknessStandaloneRoot .vxPageTitle,
    #vicknessStandaloneRoot .vxPageCard > strong.vxPageTitle,
    #vicknessStandaloneRoot #vxContentTitle,
    #vicknessStandaloneRoot .vxStandaloneName,
    #vicknessStandaloneRoot .vxChangelogVersion {
      color:var(--vx-accent)!important;
      font-weight:700!important;
      text-shadow:0 0 5px color-mix(in srgb,var(--vx-accent) 22%,transparent)!important;
    }
    #vicknessStandaloneRoot .vxPageTitle {
      display:block!important;
      font-size:14px!important;
      line-height:1.35!important;
      margin:0 0 6px!important;
    }
    #vicknessStandaloneRoot #vxContentTitle {
      font-size:16px!important;
      line-height:1.3!important;
    }
    #vicknessStandaloneRoot .vxStandaloneName {
      font-size:13px!important;
      line-height:1.35!important;
    }
    #vicknessStandaloneRoot .vxChangelogVersion {
      font-size:12px!important;
    }
    #vicknessStandaloneRoot #vxBrandSub > span {
      display:none!important;
    }

  </style>
  <div id="vxStandalonePanel">
    <div id="vxStandaloneHeader"><div id="vxBrandMark"></div><div id="vxBrandText"><div id="vxStandaloneBrand">Riventia</div><div id="vxBrandSub">Addons Pack</div></div><button id="vxStandaloneHide" type="button" title="Schowaj panel" aria-label="Schowaj panel">×</button><button id="vxStandaloneMin" type="button" title="Zwiń panel" aria-label="Zwiń panel"></button></div>
    <div id="vxWorkspace">
      <nav id="vxSidebar" aria-label="Nawigacja panelu">
        <button type="button" class="vxSideTab active" data-vx-tab="addons"><span class="vxTabIcon">♧</span><span>Dodatki</span></button>
        <button type="button" class="vxSideTab" data-vx-tab="appearance"><span class="vxTabIcon">◩</span><span>Wygląd</span></button>
        <button type="button" class="vxSideTab" data-vx-tab="update"><span class="vxTabIcon">↻</span><span>Aktualizacja</span></button>
        <button type="button" class="vxSideTab" data-vx-tab="changelog"><span class="vxTabIcon">▤</span><span>Log zmian</span></button>
      </nav>
      <div id="vxContentArea">
    <div id="vxContentHeading"><div><span class="vxHeadingIcon">♧</span><div><strong id="vxContentTitle">Dodatki</strong><small id="vxContentSubtitle">Zarządzaj rozszerzeniami (dodatkami) pakietu Riventia.</small></div></div><span id="vxAddonCount">10 / 10 dodatków</span></div>
    <div id="vxUpdateInfoView" class="vxExtraView" style="display:none">
      <div class="vxPageCard"><strong class="vxPageTitle">Aktualizowanie skryptu</strong>Aktualizacje panelu instalujesz przez Tampermonkey. Po opublikowaniu nowej wersji na GitHubie:</div>
      <div class="vxPageCard"><ol class="vxUpdateSteps"><li>Otwórz ikonę Tampermonkey w przeglądarce.</li><li>Przejdź do panelu zarządzania dodatkami.</li><li>Wybierz Vickness Addons i sprawdź dostępność aktualizacji.</li><li>Użyj opcji aktualizacji, aby pobrać najnowszą wersję.</li><li>Odśwież kartę Margonem, jeśli Tampermonkey tego wymaga.</li></ol><p class="vxPageNote">Nie instaluj kolejnej kopii skryptu — aktualizuj istniejący wpis, aby uniknąć duplikatów.</p></div>
    </div>
    <div id="vxHomeView" class="vxView">
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName"><span class="vxCardIcon">▣</span>Loot Glow<button type="button" class="vxInfoBtn" data-vx-info="Loot Glow" aria-label="Informacje: Loot Glow" title="Informacje">?</button><button type="button" class="vxOpenSettings" id="vxLootOpen">⚙</button></span><span class="vxStandaloneDesc">Podświetlanie lootu • kolor i intensywność</span><div class="vxStandaloneState" id="vxLootState"></div></div><label class="vxToggle"><input id="vxLootSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName"><span class="vxCardIcon">▣</span>DC Wykrywacz<button type="button" class="vxInfoBtn" data-vx-info="DC Wykrywacz" aria-label="Informacje: DC Wykrywacz" title="Informacje">?</button><button type="button" class="vxOpenSettings" id="vxDcOpen">⚙</button></span><span class="vxStandaloneDesc">Herosi, tytani, grzybki i Discord</span><div class="vxStandaloneState" id="vxDcState"></div></div><label class="vxToggle"><input id="vxDcSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName"><span class="vxCardIcon">▤</span>Belka lootów zintegrowana z Lootlogiem<button type="button" class="vxInfoBtn" data-vx-info="Belka lootów zintegrowana z Lootlogiem" aria-label="Informacje: Belka lootów zintegrowana z Lootlogiem" title="Informacje">?</button><button type="button" class="vxOpenSettings" id="vxLootlogOpen">⚙</button></span><span class="vxStandaloneDesc">Ostatnie herosy i legendarne łupy TheCrew</span><div class="vxStandaloneState" id="vxLootlogState"></div></div><label class="vxToggle"><input id="vxLootlogSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName"><span class="vxCardIcon">♜</span>Titan Tracker Gold<button type="button" class="vxInfoBtn" data-vx-info="Titan Tracker Gold" aria-label="Informacje: Titan Tracker Gold" title="Informacje">?</button><button type="button" class="vxOpenSettings" id="vxTitanOpen">⚙</button></span><span class="vxStandaloneDesc">Tytani i lista do 15 graczy na wybranych mapach</span><div class="vxStandaloneState" id="vxTitanState"></div></div><label class="vxToggle"><input id="vxTitanSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName"><span class="vxCardIcon">♙</span>Procent łupu<button type="button" class="vxInfoBtn" data-vx-info="Procent łupu" aria-label="Informacje: Procent łupu" title="Informacje">?</button><button type="button" class="vxOpenSettings" id="vxLootChanceOpen">⚙</button></span><span class="vxStandaloneDesc">Szansa według profesji i uprawnionych graczy</span><div class="vxStandaloneState" id="vxLootChanceState"></div></div><label class="vxToggle"><input id="vxLootChanceSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName"><span class="vxCardIcon">♧</span>The Crew Online<button type="button" class="vxInfoBtn" data-vx-info="The Crew Online" aria-label="Informacje: The Crew Online" title="Informacje">?</button><button type="button" class="vxOpenSettings" id="vxCrewOnlineOpen">⚙</button></span><span class="vxStandaloneDesc">Lista klanowiczów online bezpośrednio z Margonem</span><div class="vxStandaloneState" id="vxCrewOnlineState"></div></div><label class="vxToggle"><input id="vxCrewOnlineSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName"><span class="vxCardIcon">♙</span>Postacie online na profilach<button type="button" class="vxInfoBtn" data-vx-info="Postacie online na profilach" aria-label="Informacje: Postacie online na profilach" title="Informacje">?</button><button type="button" class="vxOpenSettings" id="vxProfileFinderOpen">⚙</button></span><span class="vxStandaloneDesc">Wyszukuje postacie konta na światach i podświetla znaleziony profil</span><div class="vxStandaloneState" id="vxProfileFinderState"></div></div><label class="vxToggle"><input id="vxProfileFinderSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName"><span class="vxCardIcon">⌖</span>Wróg na mapie<button type="button" class="vxInfoBtn" data-vx-info="Wróg na mapie" aria-label="Informacje: Wróg na mapie" title="Informacje">?</button><button type="button" class="vxOpenSettings" id="vxWnmOpen">⚙</button></span><span class="vxStandaloneDesc">Alarm dźwiękowy o wrogach i graczach bez klanu</span><div class="vxStandaloneState" id="vxWnmState"></div></div><label class="vxToggle"><input id="vxWnmSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName"><span class="vxCardIcon">▤</span>Kolory rang Lootloga na czacie<button type="button" class="vxInfoBtn" data-vx-info="Kolory rang Lootloga na czacie" aria-label="Informacje: Kolory rang Lootloga na czacie" title="Informacje">?</button><button type="button" class="vxOpenSettings" id="vxRankChatOpen">⚙</button></span><span class="vxStandaloneDesc">Koloruje nicki nadawców według rang The Crew na Lootlogu</span><div class="vxStandaloneState" id="vxRankChatState"></div></div><label class="vxToggle"><input id="vxRankChatSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName"><span class="vxCardIcon">✧</span>Darmowe Nagrody<button type="button" class="vxInfoBtn" data-vx-info="Darmowe Nagrody" aria-label="Informacje: Darmowe Nagrody" title="Informacje">?</button><button type="button" class="vxOpenSettings" id="vxFreeRewardsOpen">⚙</button></span><span class="vxStandaloneDesc">Automatyczne wykrywanie darmowych nagród z kalendarza i ofert</span><div class="vxStandaloneState" id="vxFreeRewardsState"></div></div><label class="vxToggle"><input id="vxFreeRewardsSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName"><span class="vxCardIcon">✧</span>Kolorowanie przedmiotów na czacie<button type="button" class="vxInfoBtn" data-vx-info="Kolorowanie przedmiotów na czacie" aria-label="Informacje: Kolorowanie przedmiotów na czacie" title="Informacje">?</button><button type="button" class="vxOpenSettings" id="vxItemChatOpen">⚙</button></span><span class="vxStandaloneDesc">Koloruje nazwy połączonych przedmiotów według rzadkości i dodaje delikatną poświatę</span><div class="vxStandaloneState" id="vxItemChatState"></div></div><label class="vxToggle"><input id="vxItemChatSwitch" type="checkbox"><span></span></label></div>
    </div>
    <div id="vxSettingsView">
      <div id="vxSettingsToolbar"><button class="vxNavBtn" id="vxBackHome" type="button">← WSTECZ</button><span id="vxCurrentSetting">USTAWIENIA</span><button class="vxNavBtn" id="vxSwitchAddon" type="button">DRUGI DODATEK →</button></div>
      <div id="vxSettingsLoot" class="vxSettingsSlot" hidden></div>
      <div id="vxSettingsDc" class="vxSettingsSlot" hidden>
        <div class="vxLootlogInfo">DC Wykrywacz otwiera się w osobnym oknie po wykryciu herosa, tytana lub grzybka. Okno możesz przesuwać i minimalizować niezależnie od panelu Vickness.</div>
        <div class="vxLootlogActions"><button type="button" id="vxDcShowWindow">POKAŻ OSOBNE OKNO DC</button></div>
      </div>
      <div id="vxSettingsLootlog" class="vxSettingsSlot" hidden>
        <div class="vxLootlogInfo">Belka pokazuje ostatnie zdobycze z Lootlog TheCrew. Sama belka pozostaje na ekranie gry, a jej obsługę znajdziesz tutaj. Przeciągnij belkę, aby zmienić jej położenie.</div>
        <div class="vxLootlogActions">
          <button type="button" id="vxLootlogRefresh">↻ ODŚWIEŻ TERAZ</button>
          <button type="button" id="vxLootlogLayout">↕ ORIENTACJA</button>
          <button type="button" id="vxLootlogScaleDown">− ZMNIEJSZ</button>
          <button type="button" id="vxLootlogScaleUp">+ POWIĘKSZ</button>
        </div>
      </div>
      <div id="vxSettingsLootChance" class="vxSettingsSlot" hidden></div>
      <div id="vxSettingsTitan" class="vxSettingsSlot" hidden>
        <div class="vxLootlogInfo">Titan Tracker Gold 5.0.2 działa na wybranych mapach. Zapisuje kolejność wejścia graczy, automatycznie rozwija się po wykryciu tytana i wysyła Top 10 na Discord przez webhook. Panel trackera pozostaje osobnym oknem na ekranie gry.</div>
        <div class="vxLootlogActions">
          <button type="button" id="vxTitanShow">POKAŻ TRACKER</button>
          <button type="button" id="vxTitanDiscord">USTAWIENIA DISCORDA</button>
        </div>
      </div>
      <div id="vxSettingsCrewOnline" class="vxSettingsSlot" hidden>
        <div class="vxLootlogInfo">The Crew Online pobiera listę członków bezpośrednio z odpowiedzi klanu Margonem (clan&amp;a=members) co 5 sekund. Nicki i status online pochodzą z danych klanu, a nie z Lootloga. Odpowiedź jest odczytywana przez dispatcher.on_members; dodatek nie podaje callbacku do _g i nie otwiera ręcznie zakładki klanu. Lootlog nie jest używany do pobierania ani uzupełniania listy. Panel pozostaje osobnym oknem na ekranie gry.</div>
        <div class="vxLootlogActions">
          <button type="button" id="vxCrewOnlineShow">POKAŻ PANEL</button>
          <button type="button" id="vxCrewOnlineRefresh">ODŚWIEŻ LISTĘ</button>
          <button type="button" id="vxCrewOnlineCollapse">ZWIŃ / ROZWIŃ</button>
        </div>
      </div>
      <div id="vxSettingsProfileFinder" class="vxSettingsSlot" hidden>
        <div class="vxLootlogInfo">Dodatek działa na stronach profilu Margonem (www.margonem.pl/profile/view,...). Sprawdza listy postaci online na znanych światach, pokazuje znalezioną postać i podświetla jej kartę na profilu. Wyszukiwanie odświeża się co 30 sekund. Przełącznik w kafelku włącza lub wyłącza dodatek także na profilach otwartych w innych kartach.</div>
      </div>
      <div id="vxSettingsWnm" class="vxSettingsSlot" hidden>
        <div class="vxLootlogInfo">Wróg na mapie 2.8 wykrywa wrogów i graczy bez klanu w pobliżu na Riventii. Alarm pojawia się na środku ekranu, kolejkuje nowe wykrycia i znika po wybranym czasie. Dostępnych jest 5 oryginalnych dźwięków z przesłanego skryptu Wróg na mapie 2.7. Kliknięcie alarmu zamyka go natychmiast.</div>
        <div class="vxLootlogInfo" style="margin-top:8px">
          <label style="display:flex;align-items:center;gap:8px;margin:7px 0"><input id="vxWnmNoClan" type="checkbox"> Gracze bez klanu</label>
          <label style="display:flex;align-items:center;gap:8px;margin:7px 0"><input id="vxWnmEnemies" type="checkbox"> Wrogowie i wrogowie klanowi</label>
          <label style="display:block;margin:8px 0 4px">Dźwięk alarmu</label>
          <select id="vxWnmSound" class="vxWnmControl"><option value="1">Dzwonek 1</option><option value="2">Dzwonek 2</option><option value="3">Dzwonek 3</option><option value="4">Dzwonek 4</option><option value="5">Dzwonek 5</option><option value="none">Bez dźwięku</option></select>
          <label style="display:block;margin:8px 0 4px">Kolor powiadomienia</label>
          <input id="vxWnmColor" class="vxWnmControl" type="color" style="height:34px;padding:3px">
          <label style="display:block;margin:8px 0 4px">Czas wyświetlania</label>
          <select id="vxWnmDuration" class="vxWnmControl"><option value="3000">3 sekundy</option><option value="5000">5 sekund</option><option value="8000">8 sekund</option><option value="12000">12 sekund</option></select>
        </div>
        <div class="vxLootlogInfo" id="vxWnmRuntimeStatus" role="status" aria-live="polite" style="margin-top:8px">Oczekiwanie na silnik gry…</div>
        <div class="vxLootlogActions"><button type="button" id="vxWnmTestSound">TESTUJ DŹWIĘK</button><button type="button" id="vxWnmTestAlert">TESTUJ POWIADOMIENIE</button></div>
        <div class="vxLootlogInfo" id="vxWnmTestStatus" role="status" aria-live="polite" style="margin-top:8px">Testy możesz uruchomić niezależnie od automatycznego wykrywania.</div>
      </div>
      <div id="vxSettingsFreeRewards" class="vxSettingsSlot" hidden>
        <div class="vxLootlogInfo">Darmowe Nagrody 4.8 sprawdzają kalendarz nagród i darmowe oferty na Riventii. Jeśli dostępne są nagrody, pojawia się okienko „ODBIERZ WSZYSTKO”. Moduł ponawia sprawdzanie co godzinę.</div>
        <div class="vxLootlogActions"><button type="button" id="vxFreeRewardsCheck">SPRAWDŹ TERAZ</button></div>
        <div class="vxLootlogInfo" id="vxFreeRewardsStatus" role="status" aria-live="polite" style="margin-top:8px">Sprawdzanie uruchamia się automatycznie po wejściu do gry.</div>
      </div>
      <div id="vxSettingsItemChat" class="vxSettingsSlot" hidden>
        <div class="vxLootlogInfo">Kolorowanie przedmiotów na czacie rozpoznaje rzadkość połączonych przedmiotów i koloruje wyłącznie ich nazwy: legendarne na czerwono, heroiczne na niebiesko, unikatowe na złoto, ulepszone na turkusowo, a pospolite na szaro. Dodaje subtelną poświatę i nie zmienia koloru pozostałej treści wiadomości.</div>
      </div>
      <div id="vxSettingsRankChat" class="vxSettingsSlot" hidden>
        <div class="vxLootlogInfo">Kolory rang są pobierane z API Lootloga dla The Crew, konta online przez Lootlog Game Client API, a postacie kont z profili Margonem. Moduł 2.7.0 używa cache v24, obsługuje ręcznie wskazane konto offline (7239525), ponawia próby po błędach gateway i koloruje nicki nadawców oraz nazwy postaci. Rangi odświeżają się maksymalnie raz na 24 godziny, konta online co 5 minut. Profile są zapisywane w pamięci Tampermonkey.</div>
        <div class="vxLootlogActions"><button type="button" id="vxRankChatRefresh">SYNCHRONIZUJ TERAZ</button></div>
        <div class="vxLootlogInfo" id="vxRankChatStatus" role="status" aria-live="polite" style="margin-top:8px">Oczekiwanie na uruchomienie synchronizacji…</div>
      </div>
    </div>
    <div id="vxChangelogView" class="vxExtraView">
      <div class="vxPageCard">
        <span class="vxPageTitle">Dziennik zmian Vickness Addons</span>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.2.07</span><div>Poprawiono dostęp dodatku kolorowania do jQuery strony w sandboxie userscriptu.</div></div>\n      <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.78</span><div>Usunięto kafelek instrukcji aktualizacji z zakładki Dodatki. Uzupełniono opisy dodatków zgodnie z przekazanymi treściami. Dziennik zmian zawiera wyłącznie informacje o zmianach.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.77</span><div>Powiększono panel oraz czcionki w nagłówku, menu, kafelkach i opisach dodatków. Zwiększono również ikony i przełączniki.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.76</span><div>Naprawiono przełączanie zakładek, aby zawartość Dodatków, Wyglądu, Aktualizacji i Logu zmian nie wyświetlała się jednocześnie.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.75</span><div>Poprawiono układ zawartości zakładek i przewijanie panelu.</div></div>
      </div>
    </div>
    <div id="vxAppearanceView" class="vxExtraView">
      <div class="vxPageCard" id="vxMapDimmerCard">
        <span class="vxPageTitle">Złote przyciemnienie mapy <button type="button" class="vxInfoBtn" data-vx-info="Przyciemnianie mapek" aria-label="Informacje: Przyciemnianie mapek" title="Informacje">?</button></span>
        <div class="vxPageNote">Filtr mapy zapisywany lokalnie. Użyj przycisku, by natychmiast włączyć lub wyłączyć filtr. Suwak ustawia siłę przyciemnienia, a przywracanie jasności zeruje jego wartość.</div>
        <div class="vxLootlogActions" style="margin:8px 0"><button type="button" id="vxMapDimmerToggleButton" class="vxActionBtn" style="width:100%;padding:8px 10px;font-weight:bold">WYŁĄCZ ZŁOTE PRZYCIEMNIENIE</button></div>
        <label class="vxAppearanceControl"><span><span>Aktywność filtra</span><output id="vxMapDimmerState">WŁĄCZONE</output></span><span style="display:flex;align-items:center;justify-content:flex-start;gap:8px"><input id="vxMapDimmerEnabled" type="checkbox" checked style="accent-color:var(--vx-accent)"> Włącz złote przyciemnienie</span></label>
        <label class="vxAppearanceControl"><span><span>Przyciemnienie mapy</span><output id="vxMapDimmerValue">50%</output></span><input id="vxMapDimmerRange" type="range" min="0" max="100" step="1" value="50"></label>
        <div class="vxLootlogActions"><button type="button" id="vxMapDimmerRestore" class="vxActionBtn">☀ PRZYWRÓĆ JASNOŚĆ</button><button type="button" id="vxMapDimmerApply" class="vxActionBtn">↻ ZASTOSUJ FILTR</button></div>
        <div class="vxPageNote" style="margin-top:7px">0% = pełna jasność. 100% = maksymalne przyciemnienie. Filtr jest ponownie nakładany po zmianie mapy.</div>
      </div>
      <div class="vxPageCard">
        <span class="vxPageTitle">Wygląd panelu</span>
        <div class="vxPageNote">Zmiany zapisują się lokalnie w tej przeglądarce. Rozmiar panelu zmienisz, przeciągając jego prawy dolny róg; czcionka skaluje się proporcjonalnie.</div>
        <label class="vxAppearanceControl"><span><span>Krycie tła</span><output id="vxOpacityValue">88%</output></span><input id="vxOpacityRange" type="range" min="55" max="98" step="1" value="88"></label>
        <label class="vxAppearanceControl"><span><span>Rozmycie tła</span><output id="vxBlurValue">4 px</output></span><input id="vxBlurRange" type="range" min="0" max="12" step="1" value="4"></label>
        <label class="vxAppearanceControl"><span><span>Motyw kolorystyczny</span></span><select id="vxThemeSelect"><option value="gold">Czarno-złoty</option><option value="turquoise">Czarno-turkusowy</option><option value="purple">Czarno-fioletowy</option><option value="redblack">Czarno-czerwony</option><option value="blue">Czarno-niebieski</option><option value="green">Czarno-zielony</option><option value="pink">Czarno-różowy</option></select></label>
        <div class="vxLootlogActions"><button type="button" id="vxAppearanceReset" class="vxActionBtn">DOMYŚLNY WYGLĄD</button><button type="button" id="vxLayoutReset" class="vxActionBtn">RESETUJ ROZMIAR I POZYCJĘ</button></div>
      </div>

    </div>
      </div>
    </div>
    <div id="vxAddonInfoModal" class="vxInfoModal" hidden role="dialog" aria-modal="true" aria-labelledby="vxAddonInfoTitle">
      <div class="vxInfoDialog">
        <div class="vxInfoDialogHead"><strong id="vxAddonInfoTitle">Informacje o dodatku</strong><button type="button" id="vxAddonInfoClose" aria-label="Zamknij">×</button></div>
        <div id="vxAddonInfoText" class="vxInfoDialogText"></div>
        <button type="button" id="vxAddonInfoOk" class="vxActionBtn">ROZUMIEM</button>
      </div>
    </div>
    <div id="vxStandaloneFooter">Addons by Vickness</div>
  </div>
  <button id="vxStandaloneMini" type="button" title="Otwórz panel" aria-label="Otwórz panel Riventia"><span class="diamond" aria-label="Riventia"></span></button>`;

  function getPanel(id) { return document.getElementById(id); }
  function dockWidgets() {
    const loot = getPanel('tmLootPanel');
    const dc = getPanel('margDc221Panel');
    const dcMini = getPanel('margDc221Mini');
    const lootSlot = root.querySelector('#vxSettingsLoot');
    const dcSlot = root.querySelector('#vxSettingsDc');
    if (loot && lootSlot && !lootSlot.contains(loot)) lootSlot.appendChild(loot);
    if (dc && dcSlot && !dcWindowDetached && !dcSlot.contains(dc)) dcSlot.appendChild(dc);
    if (loot && lootSlot.contains(loot)) {
      loot.style.setProperty('display', enabled.loot ? 'block' : 'none', 'important');
      loot.classList.remove('tmCollapsed');
      const body = loot.querySelector('#tmLootBody');
      if (body) body.style.setProperty('display', 'block', 'important');
    }
    if (dcWindowDetached && dc) {
      // Okno DC jest poza głównym panelu; nie dokuj go ponownie podczas odświeżania przełączników.
      if (dc.parentElement !== document.body) document.body.appendChild(dc);
      if (dcMini && dcMini.parentElement !== document.body) document.body.appendChild(dcMini);
      const popupOpen = dc.dataset.vicknessPopupOpen !== '0';
      dc.style.setProperty('display', enabled.dc && popupOpen ? 'block' : 'none', 'important');
      if (dcMini) dcMini.style.setProperty('display', enabled.dc && !popupOpen ? 'flex' : 'none', 'important');
    } else {
      if (dcMini) dcMini.style.setProperty('display', 'none', 'important');
      if (dc && dcSlot.contains(dc)) dc.style.setProperty('display', enabled.dc ? 'block' : 'none', 'important');
    }
    const lootbar = getPanel('vickness-lootbar');
    if (lootbar) lootbar.style.setProperty('display', enabled.lootlog ? 'flex' : 'none', 'important');
    if (typeof window.__vicknessSetLootBarEnabled === 'function' && lastLootlogEnabledApplied !== !!enabled.lootlog) {
      lastLootlogEnabledApplied = !!enabled.lootlog;
      window.__vicknessSetLootBarEnabled(!!enabled.lootlog);
    }
    const titanPanel = getPanel('rtt-panel');
    if (titanPanel) titanPanel.style.setProperty('display', enabled.titan ? 'block' : 'none', 'important');
    if (typeof window.__vicknessSetTitanEnabled === 'function' && lastTitanEnabledApplied !== !!enabled.titan) {
      lastTitanEnabledApplied = !!enabled.titan;
      window.__vicknessSetTitanEnabled(!!enabled.titan);
    }
    const lootChancePanel = getPanel('mlc513-panel');
    const lootChanceSlot = root.querySelector('#vxSettingsLootChance');
    if (lootChancePanel && lootChanceSlot && !lootChanceSlot.contains(lootChancePanel)) lootChanceSlot.appendChild(lootChancePanel);
    if (lootChancePanel && lootChanceSlot.contains(lootChancePanel)) {
      lootChancePanel.style.setProperty('display', enabled.lootChance ? 'block' : 'none', 'important');
      const body = Array.from(lootChancePanel.children).find(child => !child.classList.contains('heading'));
      if (body) body.style.setProperty('display', 'block', 'important');
    }
    if (!enabled.lootChance && document.querySelector('.mlc513-label')) {
      document.querySelectorAll('.mlc513-label').forEach(label => label.remove());
    }
    if (!enabled.lootlog && document.querySelector('.vl-tip')) {
      document.querySelectorAll('.vl-tip').forEach(tip => { tip.style.display = 'none'; });
    }
    if (typeof window.__vicknessApplyCrewOnline === 'function' && lastCrewEnabledApplied !== !!enabled.crewOnline) {
      lastCrewEnabledApplied = !!enabled.crewOnline;
      window.__vicknessApplyCrewOnline();
    }
  }

  function openDCWindow() {
    const dc = getPanel('margDc221Panel');
    const dcMini = getPanel('margDc221Mini');
    if (!dc || !dcMini) {
      window.__vicknessPendingOpenDCWindow = true;
      return;
    }

    dcWindowDetached = true;
    enabled.dc = true;
    saveFlags();

    // Odłącz istniejące elementy (bez klonowania), aby zachować jeden stan webhooka i wykrywania.
    document.body.appendChild(dc);
    document.body.appendChild(dcMini);
    dc.style.removeProperty('display');
    dcMini.style.removeProperty('display');

    if (typeof window.__vicknessExpandDCPanel === 'function') {
      window.__vicknessExpandDCPanel();
    } else {
      dc.dataset.vicknessPopupOpen = '1';
      dcMini.dataset.vicknessPopupMini = '0';
      dc.style.setProperty('display', 'block');
      dcMini.style.setProperty('display', 'none');
    }

    // Utrzymaj okno w granicach widocznego ekranu.
    const rect = dc.getBoundingClientRect();
    dc.style.left = Math.max(0, Math.min(rect.left, innerWidth - dc.offsetWidth)) + 'px';
    dc.style.top = Math.max(0, Math.min(rect.top, innerHeight - dc.offsetHeight)) + 'px';
    applyToggles();
  }

  function applyToggles() {
    root.querySelector('#vxLootSwitch').checked = !!enabled.loot;
    root.querySelector('#vxDcSwitch').checked = !!enabled.dc;
    root.querySelector('#vxLootlogSwitch').checked = !!enabled.lootlog;
    root.querySelector('#vxTitanSwitch').checked = !!enabled.titan;
    root.querySelector('#vxLootChanceSwitch').checked = !!enabled.lootChance;
    root.querySelector('#vxCrewOnlineSwitch').checked = !!enabled.crewOnline;
    root.querySelector('#vxProfileFinderSwitch').checked = !!enabled.profileFinder;
    root.querySelector('#vxProfileFinderState').textContent = enabled.profileFinder ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxWnmSwitch').checked = !!enabled.wnm;
    root.querySelector('#vxWnmState').textContent = enabled.wnm ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxRankChatSwitch').checked = !!enabled.rankChat;
    root.querySelector('#vxRankChatState').textContent = enabled.rankChat ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxFreeRewardsSwitch').checked = !!enabled.freeRewards;
    root.querySelector('#vxFreeRewardsState').textContent = enabled.freeRewards ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxItemChatSwitch').checked = !!enabled.itemChat;
    root.querySelector('#vxItemChatState').textContent = enabled.itemChat ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    if (typeof window.__vicknessItemChatSetEnabled === 'function') window.__vicknessItemChatSetEnabled(!!enabled.itemChat);
    if (typeof window.__vicknessFreeRewardsSetEnabled === 'function') window.__vicknessFreeRewardsSetEnabled(!!enabled.freeRewards);
    if (typeof window.__vicknessRankChatSetEnabled === 'function') window.__vicknessRankChatSetEnabled(!!enabled.rankChat);
    if (typeof window.__vicknessSetWnmEnabled === 'function') window.__vicknessSetWnmEnabled(!!enabled.wnm);
    root.querySelector('#vxTitanState').textContent = enabled.titan ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxLootChanceState').textContent = enabled.lootChance ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxCrewOnlineState').textContent = enabled.crewOnline ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxLootState').textContent = enabled.loot ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxDcState').textContent = enabled.dc ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxLootlogState').textContent = enabled.lootlog ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    const addonKeys = ['loot', 'dc', 'lootlog', 'titan', 'lootChance', 'crewOnline', 'profileFinder', 'wnm', 'rankChat', 'freeRewards', 'itemChat'];
    const enabledCount = addonKeys.reduce((sum, key) => sum + (enabled[key] ? 1 : 0), 0);
    const countLabel = root.querySelector('#vxAddonCount');
    if (countLabel) countLabel.textContent = `${enabledCount} / ${addonKeys.length} dodatków`;
    const miniCount = root.querySelector('#vxMiniAddonCount');
    if (miniCount) miniCount.textContent = `${enabledCount}/11`;
    dockWidgets();
  }
  function setActiveTab(tab) {
    root.querySelectorAll('[data-vx-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.vxTab === tab);
    });
  }
  function setMainTab(tab) {
    const updateView = root.querySelector('#vxUpdateInfoView');
    if (updateView) updateView.style.display = 'none';
    const title = root.querySelector('#vxContentTitle');
    const subtitle = root.querySelector('#vxContentSubtitle');
    const headingIcon = root.querySelector('.vxHeadingIcon');
    if (title && subtitle && headingIcon) {
      title.textContent = tab === 'addons' ? 'Dodatki' : (tab === 'appearance' ? 'Wygląd' : 'Log zmian');
      subtitle.textContent = tab === 'addons' ? 'Zarządzaj rozszerzeniami (dodatkami) pakietu Riventia.' : (tab === 'appearance' ? 'Dostosuj wygląd panelu do własnych preferencji.' : 'Historia ostatnich aktualizacji pakietu.');
      headingIcon.textContent = tab === 'addons' ? '♧' : (tab === 'appearance' ? '◩' : '▤');
    }

    const home = root.querySelector('#vxHomeView');
    const settings = root.querySelector('#vxSettingsView');
    const changelog = root.querySelector('#vxChangelogView');
    const appearance = root.querySelector('#vxAppearanceView');
    const update = root.querySelector('#vxUpdateInfoView');
    home.style.display = tab === 'addons' ? 'grid' : 'none';
    settings.style.display = 'none';
    changelog.style.display = tab === 'changelog' ? 'flex' : 'none';
    appearance.style.display = tab === 'appearance' ? 'flex' : 'none';
    if (update) update.style.display = tab === 'update' ? 'flex' : 'none';
    setActiveTab(tab);
    if (tab === 'appearance') syncAppearanceControls();
  }
  function openSettings(which) {
    if (!['loot', 'dc', 'lootlog', 'titan', 'lootChance', 'crewOnline', 'profileFinder', 'wnm', 'rankChat', 'freeRewards', 'itemChat'].includes(which)) which = 'dc';
    setActiveTab('addons');
    root.querySelector('#vxHomeView').style.display = 'none';
    root.querySelector('#vxChangelogView').style.display = 'none';
    root.querySelector('#vxAppearanceView').style.display = 'none';
    enabled[which] = true;
    saveFlags();
    if (which === 'profileFinder') saveProfileFinderFlag();
    root.querySelector('#vxHomeView').style.display = 'none';
    root.querySelector('#vxSettingsView').style.display = 'flex';
    root.querySelector('#vxSettingsLoot').hidden = which !== 'loot';
    root.querySelector('#vxSettingsDc').hidden = which !== 'dc';
    root.querySelector('#vxSettingsLootlog').hidden = which !== 'lootlog';
    root.querySelector('#vxSettingsTitan').hidden = which !== 'titan';
    root.querySelector('#vxSettingsLootChance').hidden = which !== 'lootChance';
    root.querySelector('#vxSettingsCrewOnline').hidden = which !== 'crewOnline';
    root.querySelector('#vxSettingsProfileFinder').hidden = which !== 'profileFinder';
    root.querySelector('#vxSettingsWnm').hidden = which !== 'wnm';
    root.querySelector('#vxSettingsRankChat').hidden = which !== 'rankChat';
    root.querySelector('#vxSettingsFreeRewards').hidden = which !== 'freeRewards';
    root.querySelector('#vxSettingsItemChat').hidden = which !== 'itemChat';
    root.querySelector('#vxCurrentSetting').textContent = which === 'loot' ? 'LOOT GLOW' : which === 'dc' ? 'DC WYKRYWACZ' : which === 'lootlog' ? 'BELKA LOOTÓW' : which === 'titan' ? 'TITAN TRACKER GOLD' : which === 'lootChance' ? 'PROCENT ŁUPU' : which === 'crewOnline' ? 'THE CREW ONLINE' : which === 'profileFinder' ? 'POSTACIE ONLINE NA PROFILACH' : which === 'rankChat' ? 'KOLORY RANG NA CZACIE' : which === 'freeRewards' ? 'DARMOWE NAGRODY' : which === 'itemChat' ? 'KOLOROWANIE PRZEDMIOTÓW NA CZACIE' : 'WRÓG NA MAPIE';
    const order = ['loot', 'dc', 'lootlog', 'titan', 'lootChance', 'crewOnline', 'profileFinder', 'wnm', 'rankChat', 'freeRewards', 'itemChat'];
    const next = order[(order.indexOf(which) + 1) % order.length];
    root.querySelector('#vxSwitchAddon').textContent = next === 'loot' ? 'LOOT GLOW →' : next === 'dc' ? 'DC WYKRYWACZ →' : next === 'lootlog' ? 'BELKA LOOTÓW →' : next === 'titan' ? 'TITAN TRACKER →' : next === 'lootChance' ? 'PROCENT ŁUPU →' : next === 'crewOnline' ? 'THE CREW ONLINE →' : next === 'profileFinder' ? 'POSTACIE ONLINE →' : next === 'wnm' ? 'WRÓG NA MAPIE →' : next === 'rankChat' ? 'KOLORY RANG →' : 'DARMOWE NAGRODY →';
    applyToggles();
    setTimeout(dockWidgets, 100);
    setTimeout(dockWidgets, 600);
  }
  function backHome() { setMainTab('addons'); }

  const THEME_SETTINGS = {
    gold: {
      accent: '#dfb943', light: '#f5d778', line: 'rgba(201,162,39,.78)',
      soft: 'rgba(46,35,8,.72)', header: '#211b10', hover: '#30240b',
      row: 'rgba(73,55,12,.94)', rowAlt: 'rgba(25,20,10,.96)',
      tableFirst: 'rgba(65,48,9,.98)', tableOther: 'rgba(39,20,12,.98)',
      tableText: '#fff0c2', secondary: '#e4d29b', glow: 'rgba(212,175,55,.26)'
    },
    turquoise: {
      accent: '#50d6c8', light: '#a7fff7', line: 'rgba(80,214,200,.76)',
      soft: 'rgba(8,48,45,.74)', header: '#0d2423', hover: '#17423e',
      row: 'rgba(12,66,61,.96)', rowAlt: 'rgba(10,28,29,.96)',
      tableFirst: 'rgba(10,65,60,.98)', tableOther: 'rgba(13,32,36,.98)',
      tableText: '#e2fffd', secondary: '#a7eee7', glow: 'rgba(80,214,200,.25)'
    },
    purple: {
      accent: '#bf96ff', light: '#ead8ff', line: 'rgba(191,150,255,.76)',
      soft: 'rgba(41,24,61,.76)', header: '#21172f', hover: '#38234d',
      row: 'rgba(57,35,86,.96)', rowAlt: 'rgba(27,17,37,.96)',
      tableFirst: 'rgba(57,35,86,.98)', tableOther: 'rgba(35,19,42,.98)',
      tableText: '#f4eaff', secondary: '#d6c0f5', glow: 'rgba(191,150,255,.25)'
    },
    redblack: {
      accent: '#ff4545', light: '#ffaaaa', line: 'rgba(235,48,48,.8)',
      soft: 'rgba(58,8,8,.76)', header: '#2a0c0c', hover: '#4a1717',
      row: 'rgba(82,15,15,.96)', rowAlt: 'rgba(28,8,9,.96)',
      tableFirst: 'rgba(91,13,13,.98)', tableOther: 'rgba(39,8,10,.98)',
      tableText: '#ffe1e1', secondary: '#ffb6b6', glow: 'rgba(255,50,50,.25)'
    },
    blue: {
      accent: '#4da3ff', light: '#b5d9ff', line: 'rgba(77,163,255,.8)',
      soft: 'rgba(8,31,59,.76)', header: '#0c1928', hover: '#143653',
      row: 'rgba(20,57,94,.94)', rowAlt: 'rgba(10,20,32,.96)',
      tableFirst: 'rgba(12,54,101,.98)', tableOther: 'rgba(12,30,48,.98)',
      tableText: '#e4f2ff', secondary: '#b9d7f4', glow: 'rgba(77,163,255,.25)'
    },
    green: {
      accent: '#55d98e', light: '#b9ffd5', line: 'rgba(75,214,132,.8)',
      soft: 'rgba(8,48,28,.76)', header: '#0d2115', hover: '#153b24',
      row: 'rgba(14,75,39,.94)', rowAlt: 'rgba(10,27,16,.96)',
      tableFirst: 'rgba(8,75,34,.98)', tableOther: 'rgba(13,39,24,.98)',
      tableText: '#e0ffeb', secondary: '#a6efc1', glow: 'rgba(65,220,126,.24)'
    },
    pink: {
      accent: '#ff69b4', light: '#ffc5e2', line: 'rgba(255,105,180,.78)',
      soft: 'rgba(63,14,42,.78)', header: '#28101f', hover: '#47172f',
      row: 'rgba(78,17,50,.94)', rowAlt: 'rgba(28,10,23,.96)',
      tableFirst: 'rgba(87,14,49,.98)', tableOther: 'rgba(38,13,29,.98)',
      tableText: '#ffe6f2', secondary: '#ffd0e7', glow: 'rgba(255,105,180,.25)'
    }
  };

  function installCrossAddonThemeStyles() {
    if (document.getElementById('vickness-cross-addon-theme')) return;
    const style = document.createElement('style');
    style.id = 'vickness-cross-addon-theme';
    style.textContent = `
      /* Motyw ustawiony w Vickness dotyczy również samodzielnych okien dodatków. */
      #margDc221Panel, #margDc221Mini {
        border-color:var(--vx-widget-accent)!important;
        box-shadow:0 5px 20px var(--vx-widget-glow)!important;
      }
      #margDc221Header { background:var(--vx-widget-header)!important; border-bottom:1px solid var(--vx-widget-line)!important; }
      #margDc221Title, #margDc221Mini, .margDc221Gold, #margDc221Status.gold { color:var(--vx-widget-light)!important; }
      .margDc221Btn { border-color:var(--vx-widget-line)!important; }
      .margDc221Btn.margDc221Gold { border-color:var(--vx-widget-accent)!important; color:var(--vx-widget-light)!important; background:var(--vx-widget-soft)!important; }
      #margDc221Webhook { border-color:var(--vx-widget-line)!important; }

      #tmLootPanel { border-color:var(--vx-widget-accent)!important; box-shadow:0 0 0 1px #000,0 0 18px var(--vx-widget-glow),0 10px 35px #000b!important; }
      #tmLootHeader { background:linear-gradient(180deg,var(--vx-widget-header),#090909)!important; border-bottom-color:var(--vx-widget-line)!important; }
      #tmLootPanel .tmBrand, #tmLootCollapse { color:var(--vx-widget-light)!important; }
      #tmLootPanel .tmDiamondIcon { border-color:var(--vx-widget-accent)!important; box-shadow:0 0 5px var(--vx-widget-glow),inset 0 0 8px var(--vx-widget-soft)!important; }
      #tmLootPanel .tmTab, #tmLootPanel .tmRarityRow { border-color:var(--vx-widget-line)!important; }
      #tmLootPanel .tmTab.active { color:var(--vx-widget-light)!important; border-color:var(--vx-widget-accent)!important; background:var(--vx-widget-soft)!important; }
      #tmLootPanel #tmLootCollapse:hover { background:var(--vx-widget-soft)!important; }

      /* Belka Lootlog celowo zachowuje własną, niezależną kolorystykę. */

      #rtt-panel { border-color:var(--vx-widget-accent)!important; box-shadow:0 0 12px var(--vx-widget-glow),0 4px 16px #000b!important; }
      #rtt-head { background:var(--vx-widget-header)!important; border-bottom-color:var(--vx-widget-accent)!important; }
      #rtt-head > span:first-child, #rtt-titan-level, .rtt-titan b, .rtt-count { color:var(--vx-widget-light)!important; }
      #rtt-head button, #rtt-panel button { border-color:var(--vx-widget-line)!important; color:var(--vx-widget-light)!important; background:var(--vx-widget-panel)!important; }
      #rtt-panel button:hover { border-color:var(--vx-widget-accent)!important; background:var(--vx-widget-hover)!important; }
      #rtt-panel th { background:var(--vx-widget-header)!important; color:var(--vx-widget-light)!important; border-color:var(--vx-widget-accent)!important; }
      #rtt-panel td { border-color:var(--vx-widget-line)!important; }
      #rtt-panel tbody tr:nth-child(-n+10), #rtt-panel tbody tr:nth-child(-n+10) td { background:var(--vx-widget-table-first)!important; color:var(--vx-widget-table-text)!important; border-color:var(--vx-widget-line)!important; }
      #rtt-panel tbody tr:nth-child(n+11), #rtt-panel tbody tr:nth-child(n+11) td { background:var(--vx-widget-table-other)!important; color:var(--vx-widget-table-text)!important; border-color:var(--vx-widget-line)!important; }
      #rtt-panel tbody tr[style] { outline-color:var(--vx-widget-light)!important; }
      #rtt-settings-panel { border-top-color:var(--vx-widget-accent)!important; }
      #rtt-webhook { border-color:var(--vx-widget-line)!important; }

      #tc-online-panel { border-color:var(--vx-widget-accent)!important; box-shadow:0 4px 18px var(--vx-widget-glow)!important; }
      #tc-head { background:var(--vx-widget-header)!important; color:var(--vx-widget-light)!important; border-bottom-color:var(--vx-widget-line)!important; }
      #tc-title, .tc-name, .tc-summary .tc-summary-level { color:var(--vx-widget-light)!important; }
      .tc-btn, #tc-open { color:var(--vx-widget-light)!important; background:var(--vx-widget-panel)!important; border-color:var(--vx-widget-accent)!important; }
      .tc-btn:hover, #tc-open:hover { background:var(--vx-widget-hover)!important; border-color:var(--vx-widget-light)!important; }
      #tc-online-panel .tc-player:nth-child(even) { background:var(--vx-widget-row-alt)!important; }
      #tc-online-panel .tc-player.tc-in-group { background:var(--vx-widget-row)!important; box-shadow:inset 3px 0 0 var(--vx-widget-accent)!important; }
      #tc-online-panel .tc-player.tc-in-group .tc-name { color:var(--vx-widget-light)!important; }
      .tc-summary .tc-summary-location { color:var(--vx-widget-secondary)!important; }
      #tc-list { scrollbar-color:var(--vx-widget-line) transparent!important; }
      #tc-list::-webkit-scrollbar-thumb { background:var(--vx-widget-line)!important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
  function getAppearance() {
    if (!layout.appearance || typeof layout.appearance !== 'object') layout.appearance = {};
    return {
      opacity: Math.max(55, Math.min(98, Number(layout.appearance.opacity ?? 88) || 88)),
      blur: Math.max(0, Math.min(12, Number(layout.appearance.blur ?? 4) || 0)),
      theme: THEME_SETTINGS[layout.appearance.theme] ? layout.appearance.theme : 'gold'
    };
  }
  function applyAppearance() {
    const panel = root.querySelector('#vxStandalonePanel');
    const header = root.querySelector('#vxStandaloneHeader');
    const footer = root.querySelector('#vxStandaloneFooter');
    const mini = root.querySelector('#vxStandaloneMini');
    if (!panel) return;
    const appearance = getAppearance();
    const alpha = appearance.opacity / 100;
    root.style.setProperty('--vx-panel-alpha', String(alpha));
    root.style.setProperty('--vx-panel-blur', `${appearance.blur}px`);
    root.style.setProperty('--vx-card-alpha', String(Math.max(.25, alpha - .12)));
    root.style.setProperty('--vx-header-alpha', String(Math.min(.99, alpha + .04)));
    root.style.setProperty('--vx-footer-alpha', String(Math.max(.55, alpha - .02)));
    const theme = THEME_SETTINGS[appearance.theme];
    if (mini) {
      mini.style.setProperty('background', theme.header, 'important');
      mini.style.setProperty('color', theme.light, 'important');
      mini.style.setProperty('border-color', theme.accent, 'important');
      mini.style.setProperty('box-shadow', `0 4px 16px ${theme.glow}`, 'important');
    }
    root.style.setProperty('--vx-accent', theme.accent);
    root.style.setProperty('--vx-accent-line', theme.line);
    root.style.setProperty('--vx-accent-soft', theme.soft);
    installCrossAddonThemeStyles();
    const html = document.documentElement;
    html.dataset.vicknessTheme = appearance.theme;
    const widgetVars = {
      accent: theme.accent, light: theme.light, line: theme.line, soft: theme.soft,
      header: theme.header, hover: theme.hover, row: theme.row, rowAlt: theme.rowAlt,
      tableFirst: theme.tableFirst, tableOther: theme.tableOther, tableText: theme.tableText,
      secondary: theme.secondary, glow: theme.glow,
      panel: 'rgba(12,12,12,.96)'
    };
    Object.entries(widgetVars).forEach(([key, value]) => html.style.setProperty(`--vx-widget-${key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`, value));
    window.dispatchEvent(new CustomEvent('vickness-theme-change', { detail: { theme: appearance.theme, ...widgetVars } }));
    panel.style.background = `rgba(8,8,8,${alpha})`;
    panel.style.backdropFilter = `blur(${appearance.blur}px)`;
    panel.style.webkitBackdropFilter = `blur(${appearance.blur}px)`;
    if (header) header.style.background = `rgba(16,16,16,${Math.min(.99, alpha + .04)})`;
    if (footer) footer.style.background = `rgba(10,10,10,${Math.max(.55, alpha - .02)})`;
    root.querySelectorAll('.vxStandaloneRow,.vxPageCard').forEach(card => {
      card.style.background = `rgba(20,20,20,${Math.max(.25, alpha - .12)})`;
    });
    root.querySelector('#vxOpacityValue').textContent = `${appearance.opacity}%`;
    root.querySelector('#vxBlurValue').textContent = `${appearance.blur} px`;
  }
  function syncAppearanceControls() {
    const a = getAppearance();
    const opacity = root.querySelector('#vxOpacityRange');
    const blur = root.querySelector('#vxBlurRange');
    const theme = root.querySelector('#vxThemeSelect');
    if (opacity) opacity.value = String(a.opacity);
    if (blur) blur.value = String(a.blur);
    if (theme) theme.value = a.theme;
    root.querySelector('#vxOpacityValue').textContent = `${a.opacity}%`;
    root.querySelector('#vxBlurValue').textContent = `${a.blur} px`;
  }
  function saveAppearanceField(key, value) {
    const appearance = getAppearance();
    layout.appearance = { ...appearance, [key]: value };
    saveLayout();
    applyAppearance();
    syncAppearanceControls();
  }
  function resetPanelLayout() {
    layout.main = {
      left: Math.max(8, Math.round((innerWidth - PANEL_BASE_WIDTH) / 2)),
      top: Math.max(8, Math.round((innerHeight - PANEL_BASE_HEIGHT) / 2)),
      width: Math.min(PANEL_BASE_WIDTH, innerWidth - 12),
      height: Math.min(PANEL_BASE_HEIGHT, innerHeight - 12)
    };
    layout.mini = { left: 20, top: 100 };
    const panel = root.querySelector('#vxStandalonePanel');
    const mini = root.querySelector('#vxStandaloneMini');
    clamp(panel, 'main');
    clamp(mini, 'mini', 20, 100);
    applyPanelScale(panel);
    savePos(panel, 'main');
    savePos(mini, 'mini');
  }
  function showMini() {
    const panel = root.querySelector('#vxStandalonePanel');
    const mini = root.querySelector('#vxStandaloneMini');
    if (getComputedStyle(panel).display !== 'none') savePos(panel, 'main');
    // Pozycja skrótu Addons jest niezależna od położenia rozwiniętego okna.
    // Zapis pozycji mini jest robiony przy starcie i po przeciągnięciu skrótu.
    panel.style.setProperty('display', 'none', 'important');
    mini.style.setProperty('display', 'flex', 'important');
    layout.minimized = true;
    saveLayout();
  }
  function restore() {
    const panel = root.querySelector('#vxStandalonePanel');
    const mini = root.querySelector('#vxStandaloneMini');
    panel.style.setProperty('display', 'flex', 'important');
    mini.style.setProperty('display', 'none', 'important');
    // Pozycja rozwiniętego panelu jest zapisywana niezależnie od pozycji skrótu.
    clamp(panel, 'main', Math.max(8, Math.round((innerWidth - panel.offsetWidth) / 2)), Math.max(8, Math.round((innerHeight - panel.offsetHeight) / 2)));
    applyPanelScale(panel);
    layout.minimized = false;
    saveLayout();
    applyToggles();
  }
  function boot() {
    if (!document.body) { setTimeout(boot, 50); return; }
    if (!root.isConnected) document.body.appendChild(root);
    const panel = root.querySelector('#vxStandalonePanel');
    const mini = root.querySelector('#vxStandaloneMini');
    const header = root.querySelector('#vxStandaloneHeader');
    panel.style.setProperty('display', 'none', 'important');
    mini.style.setProperty('display', 'flex', 'important');
    layout.minimized = true;
    saveLayout();
    clamp(panel, 'main', Math.max(8, Math.round((innerWidth - panel.offsetWidth) / 2)), Math.max(8, Math.round((innerHeight - panel.offsetHeight) / 2)));
    clamp(mini, 'mini', 20, 100);
    if (!layout.main || !(Number(layout.main.width) > 0) || !(Number(layout.main.height) > 0)) savePos(panel, 'main');
    if (!layout.mini) savePos(mini, 'mini');
    applyAppearance();
    syncAppearanceControls();
    syncMapDimmerControls();
    startMapDimmerMonitor();
    setMainTab('addons');

    let panelResizeSaveTimer = null;
    const panelResizeObserver = new ResizeObserver(() => {
      if (!panel.isConnected || getComputedStyle(panel).display === 'none') return;
      applyPanelScale(panel);
      clearTimeout(panelResizeSaveTimer);
      panelResizeSaveTimer = setTimeout(() => savePos(panel, 'main'), 220);
    });
    panelResizeObserver.observe(panel);
    // Oczyść podtytuł ze starszych wariantów, jeśli został pozostawiony przez wcześniejszy panel.
    root.querySelectorAll('#vxStandaloneHeader [data-vickness-subtitle], #vxStandaloneHeader .vxStandaloneSubtitle').forEach(el => el.remove());

    root.addEventListener('wheel', event => {
      const candidates = ['#vxHomeView', '#vxSettingsView', '#vxChangelogView', '#vxAppearanceView', '#vxUpdateInfoView'];
      const activeView = candidates.map(selector => root.querySelector(selector)).find(view => view && getComputedStyle(view).display !== 'none');
      if (!activeView || activeView.scrollHeight <= activeView.clientHeight) return;
      // Przewijaj aktywną zakładkę kółkiem nad jej tłem i tekstem.
      // Nie przechwytuj kółka nad suwakami, polami wyboru ani przyciskami.
      if (event.target.closest('input, select, button, textarea')) return;
      event.preventDefault();
      activeView.scrollTop += event.deltaY;
    }, { passive: false });


    // Ustawienia Wróg na mapie są przechowywane we wspólnym localStorage dodatku.
    const WNM_STORAGE_KEY = 'wnm_settings_v25';
    const readWnmSettings = () => {
      const defaults = { enabled: true, noClan: true, enemies: true, soundChoice: '1', textColor: '#ff3333', alertDuration: 5000 };
      try { return { ...defaults, ...JSON.parse(localStorage.getItem(WNM_STORAGE_KEY) || '{}') }; }
      catch (_) { return defaults; }
    };
    const writeWnmSetting = (key, value) => {
      const settings = readWnmSettings();
      settings[key] = value;
      settings.enabled = !!enabled.wnm;
      try { localStorage.setItem(WNM_STORAGE_KEY, JSON.stringify(settings)); } catch (_) {}
      window.dispatchEvent(new CustomEvent('vickness-wnm-settings-change'));
    };
    const wnmInitial = readWnmSettings();
    if (!['1', '2', '3', '4', '5', 'none'].includes(String(wnmInitial.soundChoice))) {
      wnmInitial.soundChoice = '1';
      try { localStorage.setItem(WNM_STORAGE_KEY, JSON.stringify({ ...wnmInitial, enabled: !!enabled.wnm })); } catch (_) {}
    }
    root.querySelector('#vxWnmNoClan').checked = !!wnmInitial.noClan;
    root.querySelector('#vxWnmEnemies').checked = !!wnmInitial.enemies;
    root.querySelector('#vxWnmSound').value = String(wnmInitial.soundChoice || '1');
    root.querySelector('#vxWnmColor').value = /^#[0-9a-f]{6}$/i.test(wnmInitial.textColor) ? wnmInitial.textColor : '#ff3333';
    root.querySelector('#vxWnmDuration').value = String(wnmInitial.alertDuration || 5000);
    root.querySelector('#vxWnmNoClan').addEventListener('change', e => writeWnmSetting('noClan', e.target.checked));
    root.querySelector('#vxWnmEnemies').addEventListener('change', e => writeWnmSetting('enemies', e.target.checked));
    root.querySelector('#vxWnmSound').addEventListener('change', e => writeWnmSetting('soundChoice', e.target.value));
    root.querySelector('#vxWnmColor').addEventListener('input', e => writeWnmSetting('textColor', e.target.value));
    root.querySelector('#vxWnmDuration').addEventListener('change', e => writeWnmSetting('alertDuration', Number(e.target.value)));
    const wnmTestStatus = root.querySelector('#vxWnmTestStatus');
    const wnmRuntimeStatus = root.querySelector('#vxWnmRuntimeStatus');
    const updateWnmRuntimeStatus = detail => {
      if (!detail) return;
      wnmRuntimeStatus.textContent = detail.message || (detail.engineReady ? 'Skan aktywny.' : 'Oczekiwanie na silnik gry…');
    };
    window.addEventListener('vickness-wnm-status', event => updateWnmRuntimeStatus(event.detail));
    if (typeof window.__vicknessWnmAPI?.getDiagnostics === 'function') updateWnmRuntimeStatus(window.__vicknessWnmAPI.getDiagnostics());
    root.querySelector('#vxWnmTestSound').addEventListener('click', async () => {
      const api = window.__vicknessWnmAPI;
      if (!api || typeof api.testSound !== 'function') {
        wnmTestStatus.textContent = 'Moduł Wróg na mapie jeszcze się uruchamia. Spróbuj ponownie za chwilę.';
        return;
      }
      wnmTestStatus.textContent = 'Odtwarzam wybrany dźwięk…';
      try {
        const result = await api.testSound();
        if (result?.status === 'played') wnmTestStatus.textContent = 'Odtwarzanie oryginalnego dźwięku testowego rozpoczęte.';
        else if (result?.status === 'muted') wnmTestStatus.textContent = 'Wybrano „Bez dźwięku”. Wybierz Dzwonek 1–5, aby przetestować alarm.';
        else wnmTestStatus.textContent = `Nie udało się uruchomić dźwięku: ${result?.reason || 'sprawdź głośność i obsługę audio przeglądarki.'}`;
      } catch (error) {
        console.warn('[Vickness] Test dźwięku WNM:', error);
        wnmTestStatus.textContent = 'Test dźwięku nie powiódł się. Sprawdź konsolę przeglądarki.';
      }
    });
    root.querySelector('#vxWnmTestAlert').addEventListener('click', () => {
      const api = window.__vicknessWnmAPI;
      if (!api || typeof api.testAlert !== 'function') {
        wnmTestStatus.textContent = 'Moduł Wróg na mapie jeszcze się uruchamia. Spróbuj ponownie za chwilę.';
        return;
      }
      const shown = api.testAlert();
      wnmTestStatus.textContent = shown
        ? 'Wyświetlono testowe powiadomienie. Test działa niezależnie od przełącznika wykrywania.'
        : 'Nie udało się wyświetlić testowego powiadomienia.';
    });
    root.querySelector('#vxLootSwitch').addEventListener('change', e => { enabled.loot = e.target.checked; saveFlags(); applyToggles(); });
    root.querySelector('#vxDcSwitch').addEventListener('change', e => { enabled.dc = e.target.checked; saveFlags(); applyToggles(); });
    root.querySelector('#vxLootlogSwitch').addEventListener('change', e => {
      enabled.lootlog = e.target.checked; saveFlags(); applyToggles();
      if (enabled.lootlog) setTimeout(() => getPanel('vickness-lootbar')?.querySelector('.vl-refresh')?.click(), 100);
    });
    root.querySelector('#vxTitanSwitch').addEventListener('change', e => { enabled.titan = e.target.checked; saveFlags(); applyToggles(); });
    root.querySelector('#vxLootChanceSwitch').addEventListener('change', e => { enabled.lootChance = e.target.checked; saveFlags(); applyToggles(); });
    root.querySelector('#vxCrewOnlineSwitch').addEventListener('change', e => { enabled.crewOnline = e.target.checked; saveFlags(); applyToggles(); });
    root.querySelector('#vxProfileFinderSwitch').addEventListener('change', e => { enabled.profileFinder = e.target.checked; saveFlags(); saveProfileFinderFlag(); applyToggles(); });
    root.querySelector('#vxWnmSwitch').addEventListener('change', e => { enabled.wnm = e.target.checked; saveFlags(); applyToggles(); });
    root.querySelector('#vxRankChatSwitch').addEventListener('change', e => { enabled.rankChat = e.target.checked; saveFlags(); applyToggles(); });
    root.querySelector('#vxFreeRewardsSwitch').addEventListener('change', e => {
      enabled.freeRewards = e.target.checked; saveFlags(); applyToggles();
    });
    root.querySelector('#vxItemChatSwitch').addEventListener('change', e => {
      enabled.itemChat = e.target.checked; saveFlags(); applyToggles();
    });
    root.querySelector('#vxItemChatOpen').addEventListener('click', () => openSettings('itemChat'));
    root.querySelector('#vxFreeRewardsOpen').addEventListener('click', () => openSettings('freeRewards'));
    root.querySelector('#vxFreeRewardsCheck').addEventListener('click', () => {
      const status = root.querySelector('#vxFreeRewardsStatus');
      if (!enabled.freeRewards) {
        status.textContent = 'Najpierw włącz dodatek przełącznikiem na liście.';
        return;
      }
      if (typeof window.__vicknessFreeRewardsCheckNow === 'function') {
        const started = window.__vicknessFreeRewardsCheckNow();
        status.textContent = started ? 'Rozpoczęto sprawdzanie nagród…' : 'Sprawdzanie już trwa.';
      } else {
        status.textContent = 'Moduł jeszcze się uruchamia. Odśwież stronę, jeśli problem nie ustąpi.';
      }
    });
    root.querySelector('#vxRankChatOpen').addEventListener('click', () => openSettings('rankChat'));
    root.querySelector('#vxRankChatRefresh').addEventListener('click', async () => {
      const status = root.querySelector('#vxRankChatStatus');
      if (typeof window.__vicknessRankChatAPI?.refreshNow === 'function') {
        status.textContent = 'Synchronizuję kolory rang i postacie…';
        await window.__vicknessRankChatAPI.refreshNow();
      } else {
        window.__vicknessPendingRankChatRefresh = true;
        status.textContent = 'Moduł jeszcze się uruchamia. Spróbuj ponownie za chwilę.';
      }
    });
    root.querySelector('#vxLootOpen').addEventListener('click', () => openSettings('loot'));
    root.querySelector('#vxDcOpen').addEventListener('click', () => {
      if (dcWindowDetached) openDCWindow();
      else openSettings('dc');
    });
    root.querySelector('#vxDcShowWindow').addEventListener('click', openDCWindow);
    root.querySelector('#vxLootlogOpen').addEventListener('click', () => openSettings('lootlog'));
    root.querySelector('#vxTitanOpen').addEventListener('click', () => openSettings('titan'));
    root.querySelector('#vxLootChanceOpen').addEventListener('click', () => openSettings('lootChance'));
    root.querySelector('#vxCrewOnlineOpen').addEventListener('click', () => openSettings('crewOnline'));
    root.querySelector('#vxProfileFinderOpen').addEventListener('click', () => openSettings('profileFinder'));
    root.querySelector('#vxWnmOpen').addEventListener('click', () => openSettings('wnm'));
    root.querySelector('#vxTitanShow').addEventListener('click', () => { enabled.titan = true; saveFlags(); applyToggles(); const p = getPanel('rtt-panel'); if (p) p.style.setProperty('display', 'block', 'important'); });
    root.querySelector('#vxTitanDiscord').addEventListener('click', () => { enabled.titan = true; saveFlags(); applyToggles(); const p = getPanel('rtt-panel'); if (p) p.style.setProperty('display', 'block', 'important'); const settings = getPanel('rtt-settings-panel'); if (settings && settings.style.display === 'none') getPanel('rtt-settings')?.click(); });
    const crewAction = action => { if (typeof window.__vicknessCrewOnlineAction === 'function') window.__vicknessCrewOnlineAction(action); else window.__vicknessPendingCrewOnlineAction = action; };
    root.querySelector('#vxCrewOnlineShow').addEventListener('click', () => { enabled.crewOnline = true; saveFlags(); applyToggles(); crewAction('show'); });
    root.querySelector('#vxCrewOnlineRefresh').addEventListener('click', () => crewAction('refresh'));
    root.querySelector('#vxCrewOnlineCollapse').addEventListener('click', () => crewAction('collapse'));
    root.querySelector('#vxBackHome').addEventListener('click', backHome);
    root.querySelector('[data-vx-tab="addons"]').addEventListener('click', () => setMainTab('addons'));
    root.querySelector('[data-vx-tab="changelog"]').addEventListener('click', () => setMainTab('changelog'));
    root.querySelector('[data-vx-tab="appearance"]').addEventListener('click', () => setMainTab('appearance'));
    root.querySelector('[data-vx-tab="update"]')?.addEventListener('click', () => {
      setMainTab('update');
      root.querySelector('#vxContentTitle').textContent = 'Aktualizacja';
      root.querySelector('#vxContentSubtitle').textContent = 'Jak pobierać najnowsze wersje panelu.';
      root.querySelector('.vxHeadingIcon').textContent = '↻';
    });
    root.querySelector('#vxOpacityRange').addEventListener('input', e => saveAppearanceField('opacity', Number(e.target.value)));
    root.querySelector('#vxBlurRange').addEventListener('input', e => saveAppearanceField('blur', Number(e.target.value)));
    root.querySelector('#vxThemeSelect').addEventListener('change', e => saveAppearanceField('theme', e.target.value));
    root.querySelector('#vxMapDimmerEnabled').addEventListener('change', e => setMapDimmerEnabled(e.target.checked));
    root.querySelector('#vxMapDimmerToggleButton').addEventListener('click', () => setMapDimmerEnabled(!mapDimmerEnabled));
    root.querySelector('#vxMapDimmerRange').addEventListener('input', e => setMapDimmerAmount(Number(e.target.value)));
    root.querySelector('#vxMapDimmerRestore').addEventListener('click', () => setMapDimmerAmount(0));
    root.querySelector('#vxMapDimmerApply').addEventListener('click', () => applyMapDimmer(true));
    root.querySelector('#vxAppearanceReset').addEventListener('click', () => {
      layout.appearance = { opacity: 88, blur: 4, theme: 'gold' };
      saveLayout(); applyAppearance(); syncAppearanceControls();
    });
    root.querySelector('#vxLayoutReset').addEventListener('click', resetPanelLayout);
    root.querySelector('#vxSwitchAddon').addEventListener('click', () => {
      const current = !root.querySelector('#vxSettingsLoot').hidden ? 'loot' : !root.querySelector('#vxSettingsDc').hidden ? 'dc' : !root.querySelector('#vxSettingsLootlog').hidden ? 'lootlog' : !root.querySelector('#vxSettingsTitan').hidden ? 'titan' : !root.querySelector('#vxSettingsLootChance').hidden ? 'lootChance' : !root.querySelector('#vxSettingsCrewOnline').hidden ? 'crewOnline' : !root.querySelector('#vxSettingsProfileFinder').hidden ? 'profileFinder' : !root.querySelector('#vxSettingsWnm').hidden ? 'wnm' : 'rankChat';
      const order = ['loot', 'dc', 'lootlog', 'titan', 'lootChance', 'crewOnline', 'profileFinder', 'wnm', 'rankChat'];
      openSettings(order[(order.indexOf(current) + 1) % order.length]);
    });
    root.querySelector('#vxLootlogRefresh').addEventListener('click', () => getPanel('vickness-lootbar')?.querySelector('.vl-refresh')?.click());
    root.querySelector('#vxLootlogLayout').addEventListener('click', () => getPanel('vickness-lootbar')?.querySelector('.vl-layout')?.click());
    root.querySelector('#vxLootlogScaleDown').addEventListener('click', () => getPanel('vickness-lootbar')?.querySelector('.vl-minus')?.click());
    root.querySelector('#vxLootlogScaleUp').addEventListener('click', () => getPanel('vickness-lootbar')?.querySelector('.vl-plus')?.click());

    // Dziennik zmian pokazuje tylko cztery najnowsze wpisy.
    const changelogEntries = root.querySelectorAll('#vxChangelogView .vxChangelogEntry');
    changelogEntries.forEach((entry, index) => { if (index >= 4) entry.remove(); });

    const addonDescriptions = {
      'Loot Glow': 'Daje możliwość podświetlenia lootu: pospolitego, unikatowego, heroicznego oraz legendarnego. Możliwość dopasowania koloru pod użytkownika.',
      'DC Wykrywacz': 'Wykrywa herosa/grzyba/tropiciela herosów i po kliknięciu(lub automatycznie) wysyła informację o nim na dedykowany kanał Discord (Riventii)',
      'Belka lootów zintegrowana z Lootlogiem': 'Dodatek pokazuje ostatnie looty legendarne oraz heroiczne. Dodatek połączony jest z Lootlogiem The Crew Riventia. Nie wyświetla przedmiotów heroicznych z tytanów i kolosów.',
      'Titan Tracker Gold': 'Dodatek głównie dla tych, który organizują grupy na Tytanach. Pokazuje pierwszą 10-tkę Graczy na Tytanie i po naciśnięciu przycisku wysyła listę pierwszej “dychy” na dedykowany kanał Discord. (Dodatek najlepiej działa w momencie gdy na mapie stoi już ktoś z dodatkiem)',
      'Procent łupu': 'Pokazuje szansę na łup z uwzględnieniem profesji i uprawnionych graczy.',
      'The Crew Online': 'Dodatek odczytuje informację tylko i wyłącznie z klanu The Crew na Riventii.',
      'Postacie online na profilach': 'Dodatek wyświetla Gracza na danym Świecie oraz na danej Postaci. Dodatek odświeża się co 30 sekund. Możliwe błędne działanie dodatku przez przerwy w działaniu Forum.',
      'Wróg na mapie': 'Pokazuję na mapce oraz sygnalizuje dźwiękiem Gracza bez klanu lub z wrogiego klanu. Wskazuję również liczbę kratek.',
      'Kolory rang Lootloga na czacie': 'Dodatek pobiera dane z Lootloga The Crew i jest połączony z rangami na Discordzie. Kolor rangi na Discord = kolorowi na Czacie.',
      'Darmowe Nagrody': 'Wykrywa dostępne darmowe nagrody z kalendarza i ofert oraz pomaga je odebrać.',
      'Kolorowanie przedmiotów na czacie': 'Koloruje nazwy przedmiotów połączonych w wiadomościach czatu według ich rzadkości i dodaje delikatną poświatę.',
      'Przyciemnianie mapek': 'Przyciemnia mapki na wybrany procent, przyciemnienie nie ingeruje w warstwy mapy przez co npc/mobki/światełka są podświetlone a pozostałe elementy mapy zostaną przyciemnione (BETA)'
    }

    // Ustaw zębatkę bezpośrednio obok znaku zapytania w nagłówku kafelka.
    root.querySelectorAll('#vxHomeView .vxStandaloneRow').forEach(card => {
      const info = card.querySelector('.vxInfoBtn');
      const gear = card.querySelector('.vxOpenSettings');
      if (info && gear) {
        info.insertAdjacentElement('afterend', gear);
        gear.setAttribute('title', 'Ustawienia dodatku');
        gear.setAttribute('aria-label', 'Ustawienia dodatku');
      }
    });
    const infoModal = root.querySelector('#vxAddonInfoModal');
    const closeInfoModal = () => { if (infoModal) infoModal.hidden = true; };
    root.querySelectorAll('.vxInfoBtn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        const addonName = button.getAttribute('data-vx-info') || '';
        root.querySelector('#vxAddonInfoTitle').textContent = addonName;
        root.querySelector('#vxAddonInfoText').textContent = addonDescriptions[addonName] || 'Brak dodatkowych informacji.';
        infoModal.hidden = false;
      });
    });
    root.querySelector('#vxAddonInfoClose')?.addEventListener('click', closeInfoModal);
    root.querySelector('#vxAddonInfoOk')?.addEventListener('click', closeInfoModal);
    infoModal?.addEventListener('click', event => { if (event.target === infoModal) closeInfoModal(); });
    const minimizePanel = event => {
      event?.preventDefault();
      event?.stopPropagation();
      showMini();
    };
    root.querySelector('#vxStandaloneMin')?.addEventListener('click', minimizePanel);
    root.querySelector('#vxStandaloneHide')?.addEventListener('click', minimizePanel);
    let miniDragged = false;
    mini.addEventListener('click', () => { if (!miniDragged) restore(); miniDragged = false; });

    function draggable(handle, el, key, ignoreButtons) {
      let drag = null;
      handle.addEventListener('pointerdown', e => {
        if (e.button !== 0 || (ignoreButtons && e.target.closest('button'))) return;
        const r = el.getBoundingClientRect();
        drag = { id:e.pointerId, x:e.clientX, y:e.clientY, left:r.left, top:r.top, moved:false };
      });
      document.addEventListener('pointermove', e => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
        if (Math.abs(dx)>3 || Math.abs(dy)>3) { drag.moved=true; if(key==='mini') miniDragged=true; }
        el.style.left=Math.max(0,Math.min(drag.left+dx,innerWidth-el.offsetWidth))+'px';
        el.style.top=Math.max(0,Math.min(drag.top+dy,innerHeight-el.offsetHeight))+'px';
      });
      document.addEventListener('pointerup', e => { if(!drag || e.pointerId!==drag.id)return; if(drag.moved)savePos(el,key); drag=null; });
      document.addEventListener('pointercancel', () => { if(drag?.moved)savePos(el,key); drag=null; });
    }
    draggable(header, panel, 'main', true);
    draggable(mini, mini, 'mini', false);

    // Najpierw osadź wszystkie dodatki i skalibruj ich bazowe czcionki,
    // a następnie pokaż wyłącznie mały skrót Addons (bez migania panelu).
    applyToggles();
    applyPanelScale(panel);
    panel.style.setProperty('display', 'none', 'important');
    mini.style.setProperty('display', 'flex', 'important');
    layout.minimized = true;
    saveLayout();

    // DC działa niezależnie od głównego panelu: wykrycie otwiera własne okno.
    window.__vicknessOpenDCWindow = openDCWindow;
    // Zachowaj dotychczasową nawigację ustawień, ale nie używaj jej przy samym wykryciu.
    window.__vicknessOpenAddonSettings = function(which) {
      restore();
      openSettings(['loot', 'dc', 'lootlog', 'titan', 'lootChance', 'crewOnline', 'profileFinder', 'wnm', 'rankChat'].includes(which) ? which : 'dc');
    };

    // Obsłuż wykrycie, które nastąpiło przed uruchomieniem menedżera Vickness.
    if (window.__vicknessPendingOpenDCWindow) {
      window.__vicknessPendingOpenDCWindow = false;
      openDCWindow();
    }

    // Zmiany przełączników i tak stosują się natychmiast; ten timer jest tylko zabezpieczeniem dla paneli ładowanych później.
    // Kontrola awaryjna co 15 s; zwykłe zmiany przełączników nadal działają natychmiast.
    setInterval(() => { if (document.visibilityState !== 'hidden') applyToggles(); }, 15000);
    window.addEventListener('resize', () => {
      // Nie zapisuj pozycji elementu ukrytego (getBoundingClientRect zwróci wtedy 0,0).
      if (getComputedStyle(panel).display !== 'none') {
        clamp(panel, 'main', Math.max(8, Math.round((innerWidth - panel.offsetWidth) / 2)), Math.max(8, Math.round((innerHeight - panel.offsetHeight) / 2)));
        savePos(panel, 'main');
        applyPanelScale(panel);
      }
      if (getComputedStyle(mini).display !== 'none') {
        clamp(mini, 'mini');
        savePos(mini, 'mini');
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true }); else boot();
})();

// =============================================================
// LOOT BAR — podmieniony na przesłany skrypt 4.5.21
// =============================================================
// ==UserScript==
// @name         Loot Bar by Vickness - Riventia
// @namespace    vickness.riventia.lootbar
// @version      4.5.21
// @description  Loot Bar Riventia - pełniejsze opisy i metadane tooltipów
// @match        https://riventia.margonem.pl/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      api.lootlog.pl
// @connect      search.lootlog.pl
// @connect      lootlog.pl
// @connect      micc.garmory-cdn.cloud
// @connect      www.margonem.pl
// ==/UserScript==

(() => {
  'use strict';

  const API =
    'https://api.lootlog.pl/guilds/thecrew/loots?limit=100&world=riventia';
  // Osobne zapytanie z filtrem rzadkości, aby starsze legendy nie ginęły
  // poza pierwszymi 100 najnowszymi wpisami.
  const LEGENDARY_API =
    'https://api.lootlog.pl/guilds/thecrew/loots?limit=100&world=riventia&rarities=LEGENDARY';
  // Publiczny katalog Lootloga: pełne dane gry, bez klucza API.
  const ITEM_CATALOG_API = 'https://search.lootlog.pl/public/catalog/items';
  const GUILD_URL = 'https://lootlog.pl/thecrew';
  const LEGENDARY_URL =
    'https://lootlog.pl/thecrew?lootbarFilter=legendary&rarities=LEGENDARY';
  const REFRESH_MS = 10 * 60 * 1000;
  const STORAGE_KEY = 'vicknessRiventiaLootBar';

  document.querySelector('#vickness-lootbar')?.remove();
  document.querySelector('#vickness-lootbar-style')?.remove();
  document.querySelector('.vl-tip')?.remove();

  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  })();

  let x = Number.isFinite(saved.x) ? saved.x : 180;
  let y = Number.isFinite(saved.y) ? saved.y : 30;
  let scale = Number(saved.scale) || 1;
  let vertical = Boolean(saved.vertical);
  let busy = false;
  let lootbarEnabled = window.__vicknessSetLootBarEnabled
    ? (document.querySelector('#vickness-lootbar')?.style.display !== 'none')
    : true;
  let refreshTimer = null;

  const css = document.createElement('style');
  css.id = 'vickness-lootbar-style';
  css.textContent = `
    #vickness-lootbar,
    #vickness-lootbar * {
      box-sizing: border-box;
    }

    #vickness-lootbar {
      position: fixed;
      z-index: 2147483000;
      left: ${x}px;
      top: ${y}px;
      display: flex;
      flex-direction: row;
      align-items: stretch;
      gap: 5px;
      width: max-content;
      max-width: calc(100vw - 10px);
      padding: 5px;
      color: #f5e5a5;
      background: linear-gradient(180deg,#191919 0%,#090909 100%);
      border: 1px solid #b58a20;
      border-radius: 8px;
      box-shadow: 0 0 0 1px #000,0 4px 16px #000b;
      font: 12px Arial,sans-serif;
      user-select: none;
      transform: scale(${scale});
      transform-origin: top left;
      overflow: visible;
    }

    #vickness-lootbar .vl-items {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 5px;
      min-width: 0;
      overflow: visible;
    }

    #vickness-lootbar .vl-item {
      position: relative;
      display: grid;
      place-items: center;
      width: 42px;
      height: 42px;
      flex: 0 0 42px;
      border: 2px solid;
      border-radius: 5px;
      background: linear-gradient(145deg,#252525,#101010);
      box-shadow: inset 0 0 5px #000;
      cursor: pointer;
      overflow: visible;
    }

    #vickness-lootbar .vl-item:hover {
      filter: brightness(1.2);
    }

    #vickness-lootbar .vl-item.heroic {
      border-color: #27a8ff;
      box-shadow: inset 0 0 6px #147cc233;
    }

    #vickness-lootbar .vl-item.legendary {
      border-color: #d7a923;
      box-shadow: inset 0 0 7px #d7a92330;
    }

    #vickness-lootbar .vl-item img {
      display: block;
      width: 32px;
      height: 32px;
      object-fit: contain;
      image-rendering: pixelated;
      pointer-events: none;
    }

    #vickness-lootbar .vl-letter {
      color: #27a8ff;
      font-size: 18px;
      font-weight: bold;
      pointer-events: none;
    }

    #vickness-lootbar .vl-item.legendary .vl-letter {
      color: #f4d36c;
    }

    #vickness-lootbar .vl-controls {
      position: relative;
      display: flex;
      flex-direction: row;
      align-items: stretch;
      align-self: stretch;
      gap: 4px;
      margin: 0;
      padding: 0;
      background: transparent;
      border: 0;
      z-index: 10;
      flex-shrink: 0;
    }

    #vickness-lootbar .vl-control-buttons {
      display: flex;
      flex-direction: row;
      align-items: stretch;
      gap: 4px;
    }

    #vickness-lootbar .vl-settings-toggle,
    #vickness-lootbar .vl-refresh,
    #vickness-lootbar .vl-settings-panel button {
      display: grid;
      place-items: center;
      width: 42px;
      height: 42px;
      min-width: 42px;
      min-height: 42px;
      padding: 0;
      color: #e9c65d;
      background: #111;
      border: 1px solid #b58a20;
      border-radius: 5px;
      cursor: pointer;
      font: 18px Arial,sans-serif;
    }

    #vickness-lootbar .vl-settings-toggle:hover,
    #vickness-lootbar .vl-refresh:hover,
    #vickness-lootbar .vl-settings-panel button:hover {
      color: #fff0b5;
      background: #302714;
      border-color: #e1b83f;
    }

    #vickness-lootbar .vl-settings-panel {
      display: none;
      flex-direction: row;
      align-items: stretch;
      gap: 4px;
    }

    #vickness-lootbar.vl-settings-open .vl-settings-panel {
      display: flex;
    }

    #vickness-lootbar.vl-vertical {
      flex-direction: column;
      align-items: stretch;
      width: max-content;
      max-width: calc(100vw - 10px);
    }

    #vickness-lootbar.vl-vertical .vl-items {
      flex-direction: column;
      align-items: center;
      gap: 5px;
    }

    #vickness-lootbar.vl-vertical .vl-controls {
      flex-direction: column;
      align-items: stretch;
      width: 42px;
      align-self: center;
    }

    #vickness-lootbar.vl-vertical .vl-control-buttons {
      flex-direction: column;
      gap: 4px;
    }

    #vickness-lootbar.vl-vertical .vl-settings-panel {
      flex-direction: column;
      width: 42px;
    }

    #vickness-lootbar .vl-tip-source {
      display: none !important;
    }

    .vl-tip {
      display: none;
      position: fixed;
      z-index: 2147483647;
      width: 276px;
      max-width: min(300px,calc(100vw - 16px));
      padding: 10px;
      color: #c8cbd0;
      background: #191b1d;
      border: 1px solid var(--vl-rarity,#53677d);
      border-radius: 8px;
      box-shadow: 0 5px 18px #000d;
      white-space: normal;
      overflow-wrap: anywhere;
      line-height: 1.45;
      font: 12px Arial,sans-serif;
      pointer-events: none;
      user-select: none;
    }
    .vl-tip .vl-head { display:flex; align-items:center; gap:9px; padding-bottom:8px; }
    .vl-tip .vl-icon { width:36px; height:36px; flex:0 0 36px; object-fit:contain; image-rendering:pixelated; border:1px solid var(--vl-rarity,#64788d); border-radius:4px; background:#101214; }
    .vl-tip .vl-head-text { min-width:0; }
    .vl-tip .vl-name { color:#e0e3e7; font-weight:bold; font-size:13px; }
    .vl-tip .vl-subtitle { color:#9ba9b8; font-size:11px; margin-top:2px; }
    .vl-tip .vl-rarity-line { height:1px; margin:0 0 7px; background:linear-gradient(90deg,#53677d,#263746); position:relative; }
    .vl-tip .vl-rarity-line:after { content:'◆ ◆'; position:absolute; left:50%; top:-7px; transform:translateX(-50%); padding:0 5px; background:#191b1d; color:var(--vl-rarity,#2799ed); font-size:9px; letter-spacing:2px; }
    .vl-tip .vl-tip-stats { padding-top:4px; color:#c5c8cc; line-height:1.48; }
    .vl-tip .vl-tip-stat { margin:2px 0; }
    .vl-tip .vl-tip-stat .vl-value { color:#9bc99b; font-weight:bold; }
    .vl-tip .vl-special-bonus { white-space:pre-line; margin-top:8px; padding:8px; color:#b7d6cb; background:#202927; border:1px solid #35453f; border-radius:4px; }
    .vl-tip .vl-special-bonus strong { display:block; color:#c8e5d8; margin-bottom:3px; font-weight:normal; }
    .vl-tip .vl-description { white-space:pre-line; margin-top:8px; padding:8px; color:#aeb3b8; background:#191b1d; border:1px solid #34383c; border-radius:4px; font-style:italic; text-align:center; }
    .vl-tip .vl-meta-note { white-space:pre-line; margin-top:7px; padding-top:6px; border-top:1px solid #34383c; color:#aeb3b8; }
    .vl-tip .vl-requirements { margin-top:8px; padding-top:7px; border-top:1px solid #34383c; color:#aeb3b8; white-space:pre-line; }
    .vl-tip .vl-context { margin-top:7px; padding-top:6px; border-top:1px solid #34383c; color:#8f969d; font-size:11px; }

    #vickness-lootbar .vl-empty {
      color: #d5cba9;
      padding: 8px;
      white-space: nowrap;
    }

    @media(max-width:700px) {
      #vickness-lootbar {
        padding: 4px;
        gap: 4px;
      }

      #vickness-lootbar .vl-items {
        gap: 4px;
      }

      #vickness-lootbar .vl-item {
        width: 36px;
        height: 36px;
        flex-basis: 36px;
      }

      #vickness-lootbar .vl-item img {
        width: 28px;
        height: 28px;
      }

      #vickness-lootbar .vl-settings-toggle,
      #vickness-lootbar .vl-refresh,
      #vickness-lootbar .vl-settings-panel button {
        width: 36px;
        height: 36px;
        min-width: 36px;
        min-height: 36px;
      }

      #vickness-lootbar.vl-vertical .vl-controls,
      #vickness-lootbar.vl-vertical .vl-settings-panel {
        width: 36px;
      }
    }
  `;
  document.head.appendChild(css);

  const bar = document.createElement('div');
  bar.id = 'vickness-lootbar';
  bar.innerHTML = `
    <div class="vl-items"></div>
    <div class="vl-controls">
      <div class="vl-control-buttons">
        <button class="vl-settings-toggle"
          title="Ustawienia" aria-label="Ustawienia">⚙</button>
        <button class="vl-refresh"
          title="Odśwież teraz" aria-label="Odśwież teraz">↻</button>
      </div>
      <div class="vl-settings-panel">
        <button class="vl-layout" title="Zmień orientację">↕</button>
        <button class="vl-minus" title="Zmniejsz skalę">−</button>
        <button class="vl-plus" title="Powiększ skalę">+</button>
      </div>
    </div>
  `;
  document.body.appendChild(bar);

  const itemsBox = bar.querySelector('.vl-items');

  const tooltip = document.createElement('div');
  tooltip.className = 'vl-tip';
  document.body.appendChild(tooltip);

  function save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ x, y, scale, vertical })
      );
    } catch {}
  }

  function setScale(value) {
    scale = Math.max(0.65, Math.min(1.8, value));
    bar.style.transform = `scale(${scale})`;
    save();
  }

  function applyLayout() {
    bar.classList.toggle('vl-vertical', vertical);
    const button = bar.querySelector('.vl-layout');
    button.textContent = vertical ? '↔' : '↕';
    button.title = vertical ? 'Zmień na poziomy' : 'Zmień na pionowy';
    save();
  }

  bar.querySelector('.vl-settings-toggle').addEventListener('click', event => {
    event.stopPropagation();
    bar.classList.toggle('vl-settings-open');
  });

  bar.querySelector('.vl-layout').addEventListener('click', event => {
    event.stopPropagation();
    vertical = !vertical;
    hideTooltip();
    applyLayout();
  });

  bar.querySelector('.vl-minus').addEventListener('click', event => {
    event.stopPropagation();
    setScale(scale - 0.1);
  });

  bar.querySelector('.vl-plus').addEventListener('click', event => {
    event.stopPropagation();
    setScale(scale + 0.1);
  });

  bar.querySelector('.vl-refresh').addEventListener('click', event => {
    event.stopPropagation();
    loadLoots();
  });

  bar.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    if (event.target.closest('.vl-item,button')) return;

    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const originalX = x;
    const originalY = y;

    function move(e) {
      x = Math.max(0, originalX + (e.clientX - startX) / scale);
      y = Math.max(0, originalY + (e.clientY - startY) / scale);

      const maxX = Math.max(0, window.innerWidth - bar.offsetWidth * scale);
      const maxY = Math.max(0, window.innerHeight - bar.offsetHeight * scale);

      x = Math.min(x, maxX / scale);
      y = Math.min(y, maxY / scale);

      bar.style.left = `${x}px`;
      bar.style.top = `${y}px`;
      hideTooltip();
    }

    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      save();
    }

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  function fetchJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { Accept: 'application/json' },
        timeout: 20000,
        onload: response => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status}: ${(response.responseText || '').slice(0, 500)}`));
            return;
          }

          try {
            resolve(JSON.parse(response.responseText));
          } catch {
            reject(new Error('Nieprawidłowa odpowiedź JSON'));
          }
        },
        onerror: () => reject(new Error('Błąd połączenia z API')),
        ontimeout: () => reject(new Error('Przekroczono czas oczekiwania'))
      });
    });
  }

  function getLoots(data) {
    if (Array.isArray(data)) return data;

    for (const key of ['loots', 'data', 'results', 'items']) {
      if (Array.isArray(data?.[key])) return data[key];
      if (Array.isArray(data?.[key]?.loots)) return data[key].loots;
    }

    return [];
  }

  function getNpcs(loot) {
    if (Array.isArray(loot?.npcs)) return loot.npcs;
    return loot?.npc ? [loot.npc] : [];
  }

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[\s_-]+/g, '');
  }

  function isElite2Value(value) {
    const text = normalizeText(value);
    return text === 'ELITE2' ||
      text === 'ELITAII' ||
      text === 'ELITA2' ||
      text === 'ELITEII';
  }

  function hasElite2(loot) {
    const npcs = getNpcs(loot);
    return npcs.some(npc =>
      [npc?.type, npc?.rank, npc?.rarity, npc?.kind, npc?.npcType, npc?.npc_type]
        .some(isElite2Value)
    );
  }

  function hasHero(loot) {
    const npcs = getNpcs(loot);
    return npcs.some(npc =>
      [npc?.type, npc?.rank, npc?.rarity, npc?.kind, npc?.npcType, npc?.npc_type]
        .some(value => {
          const text = normalizeText(value);
          return text === 'HERO' || text === 'HEROS' || text === 'HEROSIC';
        })
    );
  }

  function getNpc(loot) {
    const npcs = getNpcs(loot);
    if (!npcs.length) return { name: 'Nieznany NPC', level: '?' };

    const npc = npcs.find(candidate =>
      String(candidate?.type || candidate?.rank || '').toUpperCase() === 'ELITE2'
    );

    if (!npc) {
      if (npcs.length === 1) {
        return {
          name: npcs[0]?.name || npcs[0]?.nick || 'Nieznany NPC',
          level: npcs[0]?.lvl ?? npcs[0]?.level ?? '?'
        };
      }
      return { name: 'Nieustalony potwór', level: '?' };
    }

    return {
      name: npc.name || npc.nick || 'Nieznany NPC',
      level: npc.lvl ?? npc.level ?? '?'
    };
  }

  function getPlayer(loot, targetItem = null) {
    const players = Array.isArray(loot?.players)
      ? loot.players
      : loot?.player
        ? [loot.player]
        : [];
    const items = Array.isArray(loot?.items)
      ? loot.items
      : loot?.item
        ? [loot.item]
        : [];
    const lootShare = loot?.lootShare ?? loot?.loot_share;

    const playerName = player =>
      player?.name || player?.nick || player?.characterName ||
      player?.character_name || player?.username || null;
    const idsOf = value => [
      value?.hid, value?.itemHid, value?.itemId, value?.item_id,
      value?.uniqueId, value?.unique_id, value?.id
    ].filter(value => value != null).map(String);
    // Match only the item displayed on this tile, not any item in the same loot entry.
    const itemIds = new Set(idsOf(targetItem || (items.length === 1 ? items[0] : null)));
    if (!itemIds.size) {
      for (const value of items) idsOf(value).forEach(id => itemIds.add(id));
    }

    // Lootlog's detail view lists each item underneath the player who got it.
    // Some API responses expose that same relationship directly on player.items.
    for (const player of players) {
      const attached = [player?.items, player?.loots, player?.loot,
        player?.item, player?.drops, player?.itemIds, player?.item_ids]
        .flatMap(value => Array.isArray(value) ? value : value ? [value] : []);
      if (attached.some(value => {
        if (value && typeof value === 'object') {
          return idsOf(value).some(id => itemIds.has(id)) ||
            items.some(item => item?.name && value?.name === item.name);
        }
        return itemIds.has(String(value));
      })) {
        const name = playerName(player);
        if (name) return name;
      }
    }

    // In lootShare, the key is usually the player ID and the values are item IDs.
    if (lootShare && typeof lootShare === 'object') {
      for (const [playerId, itemHids] of Object.entries(lootShare)) {
        const values = Array.isArray(itemHids) ? itemHids : [itemHids];
        const matches = values.some(value => {
          if (value && typeof value === 'object') {
            return idsOf(value).some(id => itemIds.has(id));
          }
          return itemIds.has(String(value));
        });
        if (!matches) continue;
        const player = players.find(candidate =>
          [candidate?.id, candidate?.characterId, candidate?.character_id,
            candidate?.accountId, candidate?.account_id]
            .some(id => id != null && String(id) === String(playerId))
        );
        const name = player && playerName(player);
        if (name) return name;
      }
    }

    // A single listed player is unambiguous; with multiple players, do not guess.
    if (players.length === 1) return playerName(players[0]) || 'Nieznany gracz';
    return players.length > 1 ? 'Nieustalony zdobywca' : 'Nieznany gracz';
  }

  function iconCandidates(item) {
    const fields = [
      item?.icon, item?.image, item?.iconUrl, item?.icon_url,
      item?.iconURL, item?.imageUrl, item?.image_url,
      item?.img, item?.imgUrl, item?.img_url
    ];
    const candidates = [];
    for (const field of fields) {
      if (typeof field !== 'string' || !field.trim()) continue;
      const raw = field.trim();
      if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) {
        candidates.push(raw);
        continue;
      }
      const path = raw.replace(/^\/+/, '').replace(/^obrazki\/itemy\//i, '');
      // Lootlog/Margonem images are stored in three-letter folders (hel/helm1602.gif).
      const file = path.split('/').pop();
      const folder = /^[a-z]{3}/i.test(file) ? file.slice(0, 3).toLowerCase() : '';
      if (path.includes('/')) {
        candidates.push(`https://micc.garmory-cdn.cloud/obrazki/itemy/${path}`);
      } else if (folder) {
        candidates.push(
          `https://micc.garmory-cdn.cloud/obrazki/itemy/${folder}/${file}`,
          `https://www.margonem.pl/obrazki/itemy/${folder}/${file}`,
          `https://micc.garmory-cdn.cloud/obrazki/itemy/${file}`,
          `https://www.margonem.pl/obrazki/itemy/${file}`
        );
      }
      candidates.push(
        `https://micc.garmory-cdn.cloud/obrazki/itemy/${path}`,
        `https://micc.garmory-cdn.cloud/obrazki/${path}`,
        `https://www.margonem.pl/obrazki/itemy/${path}`,
        `https://www.margonem.pl/obrazki/${path}`,
        `https://lootlog.pl/${path}`
      );
    }
    return [...new Set(candidates.map(value => value.startsWith('//') ? `https:${value}` : value))];
  }

  function hideTooltip() {
    tooltip.style.display = 'none';
  }

  function showTooltip(tile) {
    const source = tile.querySelector('.vl-tip-source');
    if (!source) return;
    tooltip.replaceChildren();
    tooltip.style.setProperty('--vl-rarity', source.dataset.rarity === 'legendary' ? '#d88b32' : '#278fe0');

    const head = document.createElement('div'); head.className = 'vl-head';
    if (source.dataset.icon) { const icon = document.createElement('img'); icon.className = 'vl-icon'; icon.src = source.dataset.icon; icon.alt = ''; head.appendChild(icon); }
    const headText = document.createElement('div'); headText.className = 'vl-head-text';
    const name = document.createElement('div'); name.className = 'vl-name'; name.textContent = source.dataset.item || 'Nieznany przedmiot'; headText.appendChild(name);
    const subtitle = document.createElement('div'); subtitle.className = 'vl-subtitle';
    subtitle.textContent = `${source.dataset.rarityLabel || 'Przedmiot'}${source.dataset.type ? ' · ' + source.dataset.type : ''}`;
    headText.appendChild(subtitle); head.appendChild(headText); tooltip.appendChild(head);
    const divider = document.createElement('div'); divider.className = 'vl-rarity-line'; tooltip.appendChild(divider);

    const stats = safeParseStats(source.dataset.stats || '[]');
    const statsBox = document.createElement('div'); statsBox.className = 'vl-tip-stats';
    if (stats.length) {
      for (const stat of stats) {
        const line = document.createElement('div'); line.className = 'vl-tip-stat';
        const split = String(stat).match(/^([^:]+):\s*(.*)$/);
        if (split) { line.append(document.createTextNode(split[1] + ' ')); const value = document.createElement('span'); value.className = 'vl-value'; value.textContent = split[2]; line.appendChild(value); }
        else line.textContent = stat;
        statsBox.appendChild(line);
      }
    } else { statsBox.textContent = 'Brak statystyk w danych Lootlog dla tego przedmiotu.'; }
    tooltip.appendChild(statsBox);

    const specialBonuses = safeParseStats(source.dataset.specialBonuses || '[]');
    for (const bonus of specialBonuses) {
      const special = document.createElement('div'); special.className = 'vl-special-bonus';
      const specialTitle = document.createElement('strong'); specialTitle.textContent = bonus.title || 'Bonus legendarny';
      special.appendChild(specialTitle);
      if (bonus.text) special.appendChild(document.createTextNode(bonus.text));
      tooltip.appendChild(special);
    }
    if (source.dataset.description) {
      const desc = document.createElement('div');
      desc.className = 'vl-description';
      desc.textContent = source.dataset.description;
      tooltip.appendChild(desc);
    }
    if (source.dataset.availability) {
      const availability = document.createElement('div');
      availability.className = 'vl-meta-note';
      availability.textContent = `Ostatnio dostępny podczas:\n${source.dataset.availability}`;
      tooltip.appendChild(availability);
    }
    if (source.dataset.binding) {
      const binding = document.createElement('div');
      binding.className = 'vl-meta-note';
      binding.textContent = source.dataset.binding;
      tooltip.appendChild(binding);
    }
    const req = [];
    if (source.dataset.profession) req.push(`Wymagana profesja: ${source.dataset.profession}`);
    if (source.dataset.level) req.push(`Wymagany poziom: ${source.dataset.level}`);
    if (req.length) { const box = document.createElement('div'); box.className = 'vl-requirements'; box.textContent = req.join('\n'); tooltip.appendChild(box); }
    const context = document.createElement('div'); context.className = 'vl-context';
    context.textContent = `${source.dataset.npc || 'Nieznany NPC'} · Zdobył: ${source.dataset.player || 'Nieznany gracz'}`;
    tooltip.appendChild(context);

    tooltip.style.display = 'block'; tooltip.style.visibility = 'hidden'; tooltip.style.left = '0px'; tooltip.style.top = '0px';
    const itemRect = tile.getBoundingClientRect(); const tipRect = tooltip.getBoundingClientRect();
    let left = itemRect.right + 8;
    if (left + tipRect.width > window.innerWidth - 8) left = itemRect.left - tipRect.width - 8;
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
    let top = itemRect.top; top = Math.max(8, Math.min(top, window.innerHeight - tipRect.height - 8));
    tooltip.style.left = `${left}px`; tooltip.style.top = `${top}px`; tooltip.style.visibility = 'visible';
  }

  function safeParseStats(value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  // Tłumaczenia nazw pól i typów spotykanych w odpowiedziach Lootloga.
  function translateLootLabel(value) {
    const raw = String(value ?? '').trim();
    const key = raw.toLowerCase().replace(/[ _-]+/g, '');
    const translations = {
      helmet:'Hełm', helmety:'Hełm', helm:'Hełm', weapon:'Broń', onehanded:'Broń jednoręczna',
      onehandweapon:'Broń jednoręczna', one_hand_weapon:'Broń jednoręczna', oneandhalfhandweapon:'Broń półtoraręczna', onehandhandweapon:'Broń półtoraręczna', onehalfhandweapon:'Broń półtoraręczna', twohandweapon:'Broń dwuręczna', two_hand_weapon:'Broń dwuręczna', distanceweapon:'Broń dystansowa', distance_weapon:'Broń dystansowa', rangedweapon:'Broń dystansowa',
      meleeweapon:'Broń do walki wręcz', offhand:'Broń pomocnicza',
      boots:'Buty', belt:'Pas', necklace:'Naszyjnik', earrings:'Kolczyki', bracelet:'Bransoleta', quiver:'Strzały', arrows:'Strzały', arrow:'Strzała', talisman:'Talizman',
      twohanded:'Broń dwuręczna', bow:'Łuk', wand:'Różdżka', armor:'Zbroja', chest:'Zbroja',
      onehand:'Broń jednoręczna', distance:'Broń dystansowa', distanceweapon:'Broń dystansowa',
      gloves:'Rękawice', boots:'Buty', ring:'Pierścień', amulet:'Naszyjnik', shield:'Tarcza',
      legendary:'Legendarny', heroic:'Heroiczny', mage:'Mag', warrior:'Wojownik', paladin:'Paladyn',
      tracker:'Tropiciel', hunter:'Łowca', 'blade dancer':'Tancerz ostrzy', bladedancer:'Tancerz ostrzy',
      m:'Mag', w:'Wojownik', p:'Paladyn', t:'Tropiciel', h:'Łowca', b:'Tancerz ostrzy',
      cleanse:'Oczyszczenie', fire:'Ogień', frost:'Zimno', lightning:'Błyskawice', dark:'Mrok',
      poison:'Trucizna', cold:'Zimno', physical:'Fizyczne', magical:'Magiczne',
      boots:'Buty', belt:'Pas', necklace:'Naszyjnik', earrings:'Kolczyki',
      warrior:'Wojownik', mage:'Mag', paladin:'Paladyn', tracker:'Tropiciel', hunter:'Łowca',
      'blade dancer':'Tancerz ostrzy', bladedancer:'Tancerz ostrzy',
      strength:'Siła', agility:'Zręczność', intelligence:'Intelekt', energy:'Energia', mana:'Mana',
      life:'Życie', speed:'Szybkość', critical:'Krytyczny', resistance:'Odporność', armorpenetration:'Przebicie pancerza',
      allstats:'Wszystkie cechy', da:'Wszystkie cechy', slow:'Spowolnienie ataku przeciwnika', physicaldamage:'Obrażenia fizyczne', magicdamage:'Obrażenia magiczne', damage:'Obrażenia fizyczne', attackdamage:'Obrażenia fizyczne',
      da:'Wszystkie cechy', dmg:'Obrażenia fizyczne', mindmg:'Minimalne obrażenia fizyczne', maxdmg:'Maksymalne obrażenia fizyczne',
      onehandweapon:'Broń jednoręczna', distanceweapon:'Broń dystansowa',
      firedamage:'Obrażenia od ognia', colddamage:'Obrażenia od zimna', lightningdamage:'Obrażenia od błyskawic',
      requiredlevel:'Wymagany poziom', requiredprofession:'Wymagana profesja', profession:'Profesja',
      criticalchance:'Szansa na cios krytyczny', criticaldamage:'Moc ciosu krytycznego',
      armorclass:'Pancerz', absorbphysical:'Absorpcja obrażeń fizycznych', absorbmagic:'Absorpcja obrażeń magicznych'
    };
    return translations[key] || raw;
  }

  // Lootlog API versions may expose item parameters under different keys.
  // Only display fields present on the item object; never invent values.
  function formatAttackSpeed(value) {
    const n = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(n)) return value;
    return (n / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function formatDamageRange(value) {
    const parts = String(value).split(',').map(part => part.trim());
    if (parts.length === 2 && parts.every(part => /^\d+(?:\.\d+)?$/.test(part))) {
      return `${Number(parts[0]).toLocaleString('pl-PL')} - ${Number(parts[1]).toLocaleString('pl-PL')}`;
    }
    return value;
  }

  function extractItemStats(item) {
    if (!item || typeof item !== 'object') return [];
    const result = [];
    const seenLines = new Set();
    const raw = [item.stat, item.stats, item.statistics, item.attributes]
      .filter(value => typeof value === 'string')
      .join(';');

    const numberPL = value => {
      const n = Number(String(value).trim().replace(',', '.'));
      return Number.isFinite(n) ? n.toLocaleString('pl-PL') : String(value).trim();
    };
    const speedPL = value => {
      const n = Number(String(value).trim().replace(',', '.'));
      return Number.isFinite(n) ? (n / 100).toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : String(value).trim();
    };
    const add = line => {
      if (line && !seenLines.has(line) && result.length < 40) {
        seenLines.add(line);
        result.push(line);
      }
    };
    const profNames = { p:'Paladyn', w:'Wojownik', h:'Łowca', m:'Mag', b:'Tancerz ostrzy', t:'Tropiciel' };
    const labels = {
      ac: v => `Pancerz: ${numberPL(v)}`,
      dmg: v => `Obrażenia fizyczne: ${String(v).split(',').map(numberPL).join(' - ')}`,
      act: v => `Odporność na truciznę: ${numberPL(v)}%`,
      resfire: v => `Odporność na ogień: ${numberPL(v)}%`,
      resfrost: v => `Odporność na zimno: ${numberPL(v)}%`,
      reslight: v => `Odporność na błyskawice: ${numberPL(v)}%`,
      fire: v => `Obrażenia od ognia: +${numberPL(v)}`,
      light: v => `Obrażenia od błyskawic: +${numberPL(v)}`,
      poison: v => `Obrażenia od trucizny: +${numberPL(v)}`,
      absorb: v => `Absorbuje do ${numberPL(v)} obrażeń fizycznych`,
      absorbm: v => `Absorbuje do ${numberPL(v)} obrażeń magicznych`,
      acdmg: v => `Niszczy ${numberPL(v)} punktów pancerza podczas ciosu`,
      abdest: v => `Niszczy ${numberPL(v)} absorpcji przed atakiem`,
      adest: v => `Obniża właścicielowi ${numberPL(v)} punktów przywracania życia podczas walki`,
      afterheal: v => `Szansa na wyleczenie po walce: ${numberPL(v)}%`,
      blok: v => `Blok: +${numberPL(v)}`,
      contra: v => `+${numberPL(v)}% szans na kontratak po ciosie krytycznym`,
      crit: v => `Cios krytyczny: +${numberPL(v)}%`,
      critmval: v => `Moc ciosu krytycznego magicznego: +${numberPL(v)}%`,
      critval: v => `Moc ciosu krytycznego fizycznego: +${numberPL(v)}%`,
      da: v => `Wszystkie cechy: +${numberPL(v)}`,
      di: v => `Intelekt: +${numberPL(v)}`,
      ds: v => `Siła: +${numberPL(v)}`,
      dz: v => `Zręczność: +${numberPL(v)}`,
      dmgmul: v => `Wszystkie obrażenia: ${numberPL(v)}%`,
      dmgmulabsolute: v => `Obrażenia nieuchronne: ${numberPL(v)}%`,
      dmgmulfire: v => `Obrażenia od ognia: ${numberPL(v)}%`,
      dmgmulfrost: v => `Obrażenia od zimna: ${numberPL(v)}%`,
      dmgmullight: v => `Obrażenia od błyskawic: ${numberPL(v)}%`,
      dmgmulphysical: v => `Obrażenia fizyczne: ${numberPL(v)}%`,
      dmgmulpoison: v => `Obrażenia od trucizny: ${numberPL(v)}%`,
      dmgmulwound: v => `Obrażenia od głębokiej rany: ${numberPL(v)}%`,
      energybon: v => `Energia: +${numberPL(v)}`,
      endest: v => `Podczas obrony niszczy ${numberPL(v)} energii`,
      evade: v => `Unik: +${numberPL(v)}`,
      heal: v => `Przywraca ${numberPL(v)} punktów życia podczas walki`,
      hp: v => `Życie: +${numberPL(v)}`,
      hpbon: v => `Życie: +${numberPL(v)} za 1 pkt siły`,
      lowcrit: v => `Podczas obrony szansa na cios krytyczny przeciwnika jest mniejsza o ${numberPL(v)} punktów procentowych`,
      lowevade: v => `Podczas ataku unik przeciwnika jest mniejszy o ${numberPL(v)}`,
      manabon: v => `Mana: +${numberPL(v)}`,
      manadest: v => `Podczas obrony niszczy ${numberPL(v)} many`,
      pierce: v => `Przebicie pancerza: +${numberPL(v)}%`,
      pierceb: v => `Szansa na zablokowanie przebicia: ${numberPL(v)}%`,
      resdmg: v => `Niszczenie odporności magicznych o ${numberPL(v)}% podczas ciosu`,
      respred: v => `Przyśpiesza wracanie do siebie o ${numberPL(v)}%`,
      sa: v => `Szybkość ataku: +${speedPL(v)}`,
      slow: v => `Zmniejsza o ${speedPL(v)} szybkość ataku celu`,
      wound: v => `Głęboka rana: ${numberPL(v)}% szans na dodatkowe obrażenia`,
      reqp: v => `Wymagana profesja: ${String(v).split(',').map(p => profNames[p.trim().toLowerCase()] || normalizeProfession(p)).join(', ')}`,
      prof: v => `Wymagana profesja: ${String(v).split(',').map(p => profNames[p.trim().toLowerCase()] || normalizeProfession(p)).join(', ')}`
    };

    // Lootlog używa kluczy statystyk z gry. Zachowujemy ich semantykę i kolejność.
    if (raw) {
      for (const part of raw.split(/[;|]/)) {
        const match = part.trim().match(/^([a-zA-Z_]+)\s*=\s*(.*?)\s*$/);
        if (!match) continue;
        const key = match[1].toLowerCase();
        const value = match[2];
        if (!value || /^(binds?|etiquette|legbon|lvl|rarity|reqp|prof|type|id|hid|cleanse)$/i.test(key)) continue;
        if (key === 'frost' || key === 'poison') {
          const pair = value.split(',').map(v => v.trim());
          if (pair.length === 2 && pair.every(v => /^-?\d+(?:\.\d+)?$/.test(v))) {
            add(key === 'frost'
              ? `Zmniejsza o ${speedPL(pair[0])} szybkość ataku celu`
              : `Spowalnia cel o ${speedPL(pair[0])}`);
            add(key === 'frost'
              ? `Obrażenia od zimna: +${numberPL(pair[1])}`
              : `Obrażenia od trucizny: +${numberPL(pair[1])}`);
            continue;
          }
        }
        if (key === 'dmg') {
          add(labels.dmg(value));
          continue;
        }
        if (labels[key]) add(labels[key](value));
      }
    }

    // Dane z API bywają także przekazywane jako obiekt/lista statystyk.
    const containers = [item.stats, item.statistics, item.attributes, item.parameters];
    for (const container of containers) {
      if (!container || typeof container !== 'object') continue;
      const entries = Array.isArray(container) ? container : Object.entries(container).map(([key, value]) => ({ key, value }));
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const key = String(entry.key ?? entry.code ?? entry.stat ?? entry.name ?? '').toLowerCase();
        const value = entry.value ?? entry.amount ?? entry.total;
        if (labels[key] && value != null) add(labels[key](String(value)));
      }
    }
    // Lootlog pokazuje zakres obrażeń fizycznych na początku sekcji statystyk,
    // niezależnie od kolejności pól w surowym ciągu stat.
    const physicalDamageIndex = result.findIndex(line => /^Obrażenia fizyczne:\s*\d/.test(line));
    if (physicalDamageIndex > 0) {
      const [physicalDamage] = result.splice(physicalDamageIndex, 1);
      result.unshift(physicalDamage);
    }
    return result;
  }

  // Zbieramy bonusy legendarne z różnych wariantów struktury API.
  // Znane kody mają pełny polski opis; nieznane pokazujemy jako polską nazwę kodu,
  // zamiast pomijać bonus lub wyświetlać surowy angielski identyfikator.
  function extractSpecialBonuses(item) {
    if (!item || typeof item !== 'object') return [];
    const known = {
      cleanse: { title: 'Płomienne oczyszczenie', text: 'Podczas otrzymywania celnego ataku 12% szans na usunięcie z postaci efektów obezwładnienia, spowolnienia i obrażeń warunkowych.' },
      holytouch: { title: 'Dotyk anioła', text: 'Podczas ataku 7% szansy na regenerację 6% życia przez trzy najbliższe tury.' },
      lastheal: { title: 'Ostatni ratunek', text: 'Jednorazowe zregenerowanie znacznej ilości punktów życia, gdy po otrzymaniu obrażeń życie spadnie poniżej 18%.' },
      verycrit: { title: 'Cios bardzo krytyczny', text: '17% szansy na zwiększenie mocy ciosu krytycznego o 75%.' },
      anguish: { title: 'Krwawa udręka', text: 'Trafiony atak ma 8% szansy na wywołanie u przeciwnika krwawienia na pięć tur.' },
      glare: { title: 'Oślepienie', text: 'Podczas przyjmowania ataku 9% szansy na oślepienie przeciwnika i zablokowanie jego najbliższej akcji.' },
      puncture: { title: 'Przeszywająca skuteczność', text: 'Cel ataku ma obniżone o 12% zdolności defensywne.' },
      facade: { title: 'Fasada opieki', text: 'Przyjmowane ciosy są o 13% słabsze.' },
      carefacade: { title: 'Fasada opieki', text: 'Przyjmowane ciosy są o 13% słabsze.' },
      fasadaopieki: { title: 'Fasada opieki', text: 'Przyjmowane ciosy są o 13% słabsze.' },
      facadeofcare: { title: 'Fasada opieki', text: 'Przyjmowane ciosy są o 13% słabsze.' },
      piercingeffectiveness: { title: 'Przeszywająca skuteczność', text: 'Cel ataku ma obniżone o 12% zdolności defensywne.' },
      przeszywajacaskutecznosc: { title: 'Przeszywająca skuteczność', text: 'Cel ataku ma obniżone o 12% zdolności defensywne.' },
      blinding: { title: 'Oślepienie', text: 'Podczas przyjmowania ataku 9% szansy na oślepienie przeciwnika i zablokowanie jego najbliższej akcji.' },
      blind: { title: 'Oślepienie', text: 'Podczas przyjmowania ataku 9% szansy na oślepienie przeciwnika i zablokowanie jego najbliższej akcji.' },
      oslepienie: { title: 'Oślepienie', text: 'Podczas przyjmowania ataku 9% szansy na oślepienie przeciwnika i zablokowanie jego najbliższej akcji.' },
      angelstouch: { title: 'Dotyk anioła', text: 'Podczas ataku 7% szansy na regenerację 6% życia przez trzy najbliższe tury.' },
      dotykaniola: { title: 'Dotyk anioła', text: 'Podczas ataku 7% szansy na regenerację 6% życia przez trzy najbliższe tury.' },
      curse: { title: 'Klątwa', text: 'Podczas udanego ataku 9% szans na aktywację klątwy, która zablokuje najbliższą wykonywaną przez przeciwnika akcję.' },
      klatwa: { title: 'Klątwa', text: 'Podczas udanego ataku 9% szans na aktywację klątwy, która zablokuje najbliższą wykonywaną przez przeciwnika akcję.' },
      lastresort: { title: 'Ostatni ratunek', text: 'Jednorazowe zregenerowanie znacznej ilości punktów życia, gdy po otrzymaniu obrażeń życie spadnie poniżej 18%.' },
      ostatniratunek: { title: 'Ostatni ratunek', text: 'Jednorazowe zregenerowanie znacznej ilości punktów życia, gdy po otrzymaniu obrażeń życie spadnie poniżej 18%.' },
      verycriticalhit: { title: 'Cios bardzo krytyczny', text: '17% szansy na zwiększenie mocy ciosu krytycznego o 75%.' },
      ciosbardzokrytyczny: { title: 'Cios bardzo krytyczny', text: '17% szansy na zwiększenie mocy ciosu krytycznego o 75%.' },
      bloodtorment: { title: 'Krwawa udręka', text: 'Trafiony atak ma 8% szansy na wywołanie u przeciwnika krwawienia na pięć tur.' },
      critshield: { title: 'Krytyczna osłona', text: '' },
      frenzy: { title: 'Eskalacja szału', text: '' },
      retaliation: { title: 'Aura odwetu', text: '' },
      krwawaudreka: { title: 'Krwawa udręka', text: 'Trafiony atak ma 8% szansy na wywołanie u przeciwnika krwawienia na pięć tur.' }
    };
    const codeNames = {
      cleanse:'Oczyszczenie', vampirism:'Wampiryzm', lifesteal:'Kradzież życia', manasteal:'Kradzież many',
      poison:'Zatrucie', burn:'Podpalenie', burning:'Podpalenie', freeze:'Zamrożenie', stun:'Ogłuszenie',
      slow:'Spowolnienie', silence:'Wyciszenie', bleed:'Krwawienie', reflect:'Odbicie obrażeń',
      execute:'Dobijanie', weaken:'Osłabienie', armorbreak:'Przebicie pancerza', penetration:'Przebicie odporności',
      critical:'Cios krytyczny', crit:'Cios krytyczny', dodge:'Unik', block:'Blok', shield:'Tarcza',
      fire:'Ogień', frost:'Zimno', lightning:'Błyskawice', dark:'Mrok',
      care:'Opieka', facade:'Fasada', piercing:'Przeszywający', effectiveness:'Skuteczność',
      angel:'Anioł', touch:'Dotyk', last:'Ostatni', resort:'Ratunek', very:'Bardzo',
      blood:'Krwawy', torment:'Udręka', blinding:'Oślepienie',
      holytouch:'Dotyk anioła', lastheal:'Ostatni ratunek', verycrit:'Cios bardzo krytyczny',
      anguish:'Krwawa udręka', critshield:'Krytyczna osłona', frenzy:'Eskalacja szału',
      glare:'Oślepienie', puncture:'Przeszywająca skuteczność', retaliation:'Aura odwetu', facade:'Fasada opieki'
    };
    const candidates = [];
    const seen = new Set();
    const add = value => {
      if (value == null) return;
      if (typeof value === 'object') {
        const code = value.code ?? value.key ?? value.id ?? value.name ?? value.value ?? value.bonus;
        const title = value.title ?? value.label ?? value.displayName ?? value.name;
        const text = value.description ?? value.desc ?? value.text ?? value.effect ?? value.tooltip;
        if (code != null) candidates.push({ code: String(code), title, text });
        else if (text || title) candidates.push({ code: '', title, text });
      } else {
        const str = String(value).trim();
        if (str) candidates.push({ code: str, title: '', text: '' });
      }
    };
    function scan(value, depth = 0) {
      if (value == null || depth > 6) return;
      if (typeof value === 'string') {
        const re = /(?:^|[;|,\s])(?:legbon|legendaryBonus|legendaryBonuses|legendary_bonus|legendary_bonuses|specialBonus|specialBonuses|special_bonus|bonusCode|bonus_code|legendaryEffect|legendary_effect)\s*(?:[=:]\s*|\s+)([a-z0-9_-]+)/ig;
        let m; while ((m = re.exec(value))) add(m[1]);
        return;
      }
      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) { value.forEach(v => scan(v, depth + 1)); return; }
      for (const [key, child] of Object.entries(value)) {
        if (/^(legbon|legendaryBonus|legendaryBonuses|legendary_bonus|legendary_bonuses|specialBonus|specialBonuses|special_bonus|bonusCode|bonus_code|legendaryEffect|legendary_effect)$/i.test(key)) {
          if (Array.isArray(child)) child.forEach(add); else add(child);
        }
        scan(child, depth + 1);
      }
    }
    scan(item);
    const out = [];
    const used = new Set();
    for (const candidate of candidates) {
      const code = String(candidate.code || '').trim().toLowerCase().replace(/^legbon[=: ]*/,'').replace(/[\s_-]+/g, '');
      const titleKey = String(candidate.title || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
      const id = code || titleKey || String(candidate.text || '');
      if (!id || used.has(id)) continue;
      used.add(id);
      if (known[code] || known[titleKey]) {
        const matched = known[code] || known[titleKey];
        // Nie dopisujemy opisu, którego nie ma w danych ani w słowniku.
        out.push({ title: matched.title, text: matched.text || candidate.text || '' });
      }
      else if (candidate.text) out.push({ title: translateLootLabel(candidate.title || 'Bonus legendarny'), text: String(candidate.text) });
      else {
        const pretty = code.split(/[_-]+/).filter(Boolean).map(part => codeNames[part] || translateLootLabel(part)).join(' ');
        out.push({ title: 'Bonus legendarny', text: pretty || translateLootLabel(candidate.title || code) });
      }
    }
    return out;
  }

  function getItemProfession(item) {
    const direct = item?.professionName ?? item?.profession ?? item?.requiredProfession ?? item?.required_profession ?? item?.reqp ?? item?.prof;
    if (direct != null && String(direct).trim()) return normalizeProfession(direct);
    const rawStats = [item?.stat, item?.stats, item?.statistics].filter(value => typeof value === 'string').join(';');
    const match = rawStats.match(/(?:^|[;|\s])(?:prof|reqp)\s*[=:]?\s*([a-z ]+?)(?=\s*(?:[;|]|$))/i);
    return match ? normalizeProfession(match[1]) : '';
  }

  function normalizeProfession(value) {
    const names = {
      mage: 'Mag', m: 'Mag',
      paladin: 'Paladyn', p: 'Paladyn',
      tracker: 'Tropiciel', t: 'Tropiciel',
      hunter: 'Łowca', h: 'Łowca',
      warrior: 'Wojownik', w: 'Wojownik',
      'blade dancer': 'Tancerz ostrzy', bladedancer: 'Tancerz ostrzy', b: 'Tancerz ostrzy'
    };
    const rawValue = String(value ?? '').trim();
    const compact = rawValue.toLowerCase().replace(/[\s,_;|/+-]+/g, '');
    // Skróty wymagań profesji używane przez Lootlog/Margonem.
    const professionGroups = {
      mt: 'Mag, Tropiciel',
      pt: 'Paladyn, Tropiciel',
      mpt: 'Mag, Paladyn, Tropiciel',
      ht: 'Łowca, Tropiciel',
      mp: 'Mag, Paladyn',
      bhw: 'Tancerz ostrzy, Łowca, Wojownik'
    };
    if (professionGroups[compact]) return professionGroups[compact];

    return rawValue.split(/[,;|/]+/).map(part => {
      const raw = part.trim();
      const key = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
      return names[key] || translateLootLabel(raw);
    }).filter(Boolean).join(', ');
  }

  // Wczytuje pełne teksty opisowe także z zagnieżdżonych struktur katalogu Lootloga.
  // Nie tworzymy treści na podstawie zgadywanych wartości — pokazujemy tylko dane z API.
  function findItemText(item, keys, depth = 0, seen = new Set()) {
    if (!item || typeof item !== 'object' || depth > 4 || seen.has(item)) return '';
    seen.add(item);
    const wanted = new Set(keys.map(key => key.toLowerCase()));
    for (const [key, value] of Object.entries(item)) {
      if (wanted.has(key.toLowerCase()) && (typeof value === 'string' || typeof value === 'number')) {
        const text = String(value).trim();
        if (text) return text;
      }
    }
    for (const value of Object.values(item)) {
      if (value && typeof value === 'object') {
        const found = findItemText(value, keys, depth + 1, seen);
        if (found) return found;
      }
    }
    return '';
  }

  function cleanItemDescription(value) {
    return String(value || '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/\[br\]/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function makeTile(entry) {
    const loot = entry.loot;
    const rawItem = entry.item || getItem(loot);
    const catalogItem = entry.catalogItem || {};
    const item = { ...catalogItem, ...rawItem };
    // Catalog provides canonical item stats/bonus metadata; the loot's own stat
    // takes precedence when it contains instance-specific values.
    if (rawItem.stat == null && catalogItem.stat != null) item.stat = catalogItem.stat;
    if (rawItem.stats == null && catalogItem.stats != null) item.stats = catalogItem.stats;
    if (rawItem.legendaryBonuses == null && catalogItem.legendaryBonuses != null) item.legendaryBonuses = catalogItem.legendaryBonuses;
    if (rawItem.description == null && catalogItem.description != null) item.description = catalogItem.description;
    const npc = getNpc(loot);
    const player = getPlayer(loot, item);

    const tile = document.createElement('div');
    tile.className = `vl-item ${entry.rarity}`;
    // Bez natywnego title — przeglądarka nie wyświetla już dymka zasłaniającego łup.

    const tipSource = document.createElement('div');
    tipSource.className = 'vl-tip-source';
    tipSource.dataset.npc = `${npc.name} - lvl ${npc.level}`;
    tipSource.dataset.player = player;
    tipSource.dataset.item = item?.name || 'Nieznany przedmiot';
    tipSource.dataset.stats = JSON.stringify(extractItemStats(item));
    tipSource.dataset.rarity = entry.rarity;
    tipSource.dataset.rarityLabel = entry.rarity === 'legendary' ? 'Legendarny' : 'Heroiczny';
    tipSource.dataset.type = translateLootLabel(item?.typeName || item?.itemType || item?.category || item?.type || '');
    tipSource.dataset.icon = iconCandidates(item)[0] || '';
    tipSource.dataset.description = cleanItemDescription(findItemText(item, [
      'description', 'desc', 'opis', 'flavorText', 'flavor_text', 'lore',
      'loreText', 'lore_text', 'story', 'itemDescription', 'item_description',
      'longDescription', 'long_description', 'textDescription', 'text_description'
    ]));
    tipSource.dataset.availability = cleanItemDescription(findItemText(item, [
      'lastAvailable', 'last_available', 'lastSeen', 'last_seen',
      'availableDuring', 'available_during', 'availability', 'eventName',
      'event_name', 'lastEvent', 'last_event'
    ]));
    const statText = typeof item?.stat === 'string' ? item.stat : '';
    const bindingText = cleanItemDescription(findItemText(item, [
      'bindingText', 'binding_text', 'bindText', 'bind_text', 'bindingDescription',
      'binding_description', 'bindDescription', 'bind_description'
    ]));
    const hasBindFlag = /(?:^|[;|])\s*binds?\s*(?:=\s*(?:1|true|yes))?\s*(?=[;|]|$)/i.test(statText);
    tipSource.dataset.binding = bindingText || (hasBindFlag ? 'Wiąże po założeniu' : '');
    tipSource.dataset.specialBonuses = JSON.stringify(entry.rarity === 'legendary' ? extractSpecialBonuses(item) : []);
    const statReqp = statText.match(/(?:^|[;|])(?:reqp|prof)=([^;|]+)/i)?.[1] || '';
    const statLevel = statText.match(/(?:^|[;|])(?:lvl|level)=([^;|]+)/i)?.[1] || '';
    const rawProfession = item?.professionName || item?.profession || item?.reqp || item?.requiredProfession || statReqp;
    tipSource.dataset.profession = normalizeProfession(rawProfession);
    tipSource.dataset.level = item?.requiredLevel ?? item?.required_level ?? item?.req ?? item?.levelRequirement ?? statLevel;
    tile.appendChild(tipSource);

    tile.addEventListener('mouseenter', () => showTooltip(tile));
    tile.addEventListener('mouseleave', hideTooltip);

    tile.addEventListener('click', event => {
      event.stopPropagation();
      hideTooltip();

      window.open(
        entry.rarity === 'legendary' ? LEGENDARY_URL : GUILD_URL,
        '_blank',
        'noopener'
      );
    });

    const fallback = document.createElement('span');
    fallback.className = 'vl-letter';
    fallback.textContent = entry.rarity === 'heroic' ? 'H' : 'L';

    const candidates = iconCandidates(item);

    if (!candidates.length) {
      tile.appendChild(fallback);
      return tile;
    }

    const img = document.createElement('img');
    img.alt = item?.name || 'Łup';

    let index = 0;

    function tryNext() {
      if (index >= candidates.length) {
        img.remove();

        if (!tile.contains(fallback)) {
          tile.appendChild(fallback);
        }
        return;
      }

      img.src = candidates[index++];
    }

    img.onerror = tryNext;
    img.onload = () => fallback.remove();

    tile.appendChild(fallback);
    tile.appendChild(img);
    tryNext();

    return tile;
  }

  // Zgodność z wcześniejszą wersją 4.2.0:
  // Lootlog może podawać rzadkość na wpisie łupu, na loot.item
  // albo na jednym z elementów loot.items.
  function rarityOf(loot) {
    const values = [
      loot?.rarity,
      loot?.item?.rarity,
      ...(Array.isArray(loot?.items)
        ? loot.items.map(item => item?.rarity)
        : [])
    ].filter(value => value != null).map(value => {
      if (typeof value === 'object') {
        return String(value.name ?? value.label ?? value.title ?? value.value ?? value.type ?? value.code ?? '');
      }
      return String(value);
    }).map(normalizeText);

    if (values.some(value => value.includes('LEGEND'))) return 'legendary';
    if (values.some(value => value.includes('HERO'))) return 'heroic';
    return null;
  }

  function getItem(loot) {
    const rarity = rarityOf(loot);
    if (Array.isArray(loot?.items) && loot.items.length) {
      return (
        loot.items.find(item => {
          const itemRarity = getRarity(item);
          return itemRarity && itemRarity === rarity;
        }) ||
        loot.items.find(item => item?.rarity != null) ||
        loot.items[0]
      );
    }
    return loot?.item || loot;
  }

  function getRarity(item) {
    // Rzadkość odczytujemy wyłącznie z danych samego przedmiotu.
    // Nie skanujemy całego wpisu łupu, bo NPC/gracz/opis może zawierać
    // słowa "heroic" lub "legendary" i błędnie oznaczyć każdy przedmiot.
    const rarityKeys = /^(rarity|quality|grade|tier|rarityName|rarity_name|itemRarity|item_rarity)$/i;
    const values = [];
    const seen = new Set();

    function readRarity(value, depth = 0) {
      if (value == null || depth > 5) return;
      if (typeof value === 'string' || typeof value === 'number') {
        values.push(String(value));
        return;
      }
      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);

      if (Array.isArray(value)) {
        for (const child of value) readRarity(child, depth + 1);
        return;
      }

      for (const [key, child] of Object.entries(value)) {
        if (rarityKeys.test(key)) {
          readRarity(child, depth + 1);
        } else if (depth > 0 && /^(name|label|title|value|type|code)$/i.test(key)) {
          // Obsługa np. rarity: { name: "LEGENDARY" }.
          readRarity(child, depth + 1);
        }
      }
    }

    if (!item || typeof item !== 'object') return null;

    for (const [key, value] of Object.entries(item)) {
      if (rarityKeys.test(key)) readRarity(value);
    }

    for (const value of values) {
      const text = normalizeText(value);
      if (text.includes('LEGEND')) return 'legendary';
      if (text.includes('HERO')) return 'heroic';
    }
    return null;
  }

  function lootTimestamp(loot) {
    const raw = loot?.createdAt ?? loot?.created_at ?? loot?.date ?? loot?.timestamp;
    if (typeof raw === 'number') return raw < 1e12 ? raw * 1000 : raw;
    const parsed = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async function render(loots) {
    // Sortujemy po czasie utworzenia wpisu Lootlog, a nie po kolejności odpowiedzi API.
    const sorted = [...loots].sort((a, b) => lootTimestamp(b) - lootTimestamp(a));

    // Legendy mogą pochodzić z dowolnego źródła (heros, tytan, kolos, elita itd.).
    // Heroiki nadal ograniczamy do Elity II.
    const legendary = [];
    const heroic = [];
    const seenLegendary = new Set();
    const seenHeroic = new Set();

    for (const loot of sorted) {
      const items = Array.isArray(loot?.items)
        ? loot.items
        : loot?.item
          ? [loot.item]
          : [];

      for (const item of items) {
        const rarityText = String(item?.rarity ?? '').trim().toUpperCase();
        const rarity = rarityText.includes('LEGEND') ? 'legendary'
          : rarityText.includes('HERO') ? 'heroic' : null;
        if (!rarity) continue;

        const itemKey = `${loot?.id ?? loot?.uniqueId ?? lootTimestamp(loot)}:${item?.hid ?? item?.id ?? item?.name ?? ''}`;
        if (rarity === 'legendary') {
          if (!seenLegendary.has(itemKey)) {
            seenLegendary.add(itemKey);
            legendary.push({ loot, item, rarity });
          }
        } else if ((hasElite2(loot) || hasHero(loot)) && !seenHeroic.has(itemKey)) {
          seenHeroic.add(itemKey);
          heroic.push({ loot, item, rarity });
        }
      }
    }

    const newestLegendary = legendary.slice(0, 5);
    const newestHeroic = heroic.slice(0, 10);

    console.debug(
      '[Loot Bar] wpisy API:', loots.length,
      '| wpisy Elity II:', sorted.filter(hasElite2).length,
      '| legendarne ze wszystkich źródeł:', legendary.length,
      '| heroiczne z Elity II/herosów:', heroic.length
    );

    itemsBox.replaceChildren();
    hideTooltip();

    // Heroiki po lewej, a 5 najnowszych legend po prawej.
    const chosen = [...newestHeroic, ...newestLegendary];

    if (!chosen.length) {
      const empty = document.createElement('div');
      empty.className = 'vl-empty';
      empty.textContent = 'Brak łupów w pobranych danych';
      itemsBox.appendChild(empty);
      return;
    }

    // Wzbogacamy kafelki danymi katalogowymi. Błąd katalogu nie blokuje belki:
    // w takim przypadku zostają dane zapisane bezpośrednio w łupie.
    try {
      await enrichEntriesFromCatalog(chosen);
    } catch (catalogError) {
      console.warn('[Loot Bar] Katalog przedmiotów Lootloga niedostępny:', catalogError);
    }
    chosen.forEach(entry => itemsBox.appendChild(makeTile(entry)));
  }

  function getCatalogItems(data) {
    if (Array.isArray(data)) return data;
    for (const key of ['items', 'data', 'results']) {
      if (Array.isArray(data?.[key])) return data[key];
      if (Array.isArray(data?.[key]?.items)) return data[key].items;
    }
    return [];
  }

  async function enrichEntriesFromCatalog(entries) {
    const ids = [...new Set(entries.map(entry => Number(entry.item?.id ?? entry.item?.itemId ?? entry.item?.templateId)).filter(id => Number.isInteger(id) && id > 0))];
    if (!ids.length) return;
    const params = new URLSearchParams();
    for (const id of ids) params.append('ids', String(id));
    params.set('gameVersion', 'pl');
    params.set('limit', '96');
    const catalogData = await fetchJson(`${ITEM_CATALOG_API}?${params.toString()}`);
    const catalogItems = getCatalogItems(catalogData);
    const byId = new Map(catalogItems.map(item => [String(item.id), item]));
    const byName = new Map(catalogItems.filter(item => item.name).map(item => [String(item.name).trim().toLowerCase(), item]));
    for (const entry of entries) {
      const item = entry.item || {};
      const match = byId.get(String(item.id ?? item.itemId ?? item.templateId)) || byName.get(String(item.name || '').trim().toLowerCase());
      if (match) entry.catalogItem = match;
    }
    console.debug('[Loot Bar] Katalog Lootloga:', catalogItems.length, 'pozycji dla', ids.length, 'ID');
  }

  async function loadLoots() {
    if (busy || !lootbarEnabled || window.__vicknessShouldPauseAddons?.()) return;
    busy = true;

    try {
      const data = await fetchJson(API);
      if (!lootbarEnabled || window.__vicknessShouldPauseAddons?.()) return;
      const recentLoots = getLoots(data);
      let legendaryLoots = [];

      // Pobieramy też osobno legendy, aby dotrzeć do nich poza pierwszymi
      // 100 najnowszymi łupami. Jeśli filtr nie jest obsługiwany, zachowujemy
      // działanie podstawowego źródła zamiast wyłączać cały pasek.
      try {
        const legendaryData = await fetchJson(LEGENDARY_API);
        if (!lootbarEnabled || window.__vicknessShouldPauseAddons?.()) return;
        legendaryLoots = getLoots(legendaryData);
      } catch (legendaryError) {
        console.warn('[Loot Bar] Osobne pobieranie legend nie powiodło się:', legendaryError);
      }

      const byId = new Map();
      for (const loot of [...recentLoots, ...legendaryLoots]) {
        const key = loot?.id ?? loot?.uniqueId;
        if (key != null) byId.set(String(key), loot);
      }
      const loots = byId.size
        ? [...byId.values()]
        : [...recentLoots, ...legendaryLoots];

      console.debug(
        '[Loot Bar] Wpisy zwykłego zapytania:', recentLoots.length,
        '| wpisy zapytania LEGENDARY:', legendaryLoots.length,
        '| unikalne wpisy razem:', loots.length
      );
      if (!lootbarEnabled || window.__vicknessShouldPauseAddons?.()) return;
      await render(loots);

      if (!loots.length) {
        console.warn('[Loot Bar] Nieznany format API:', data);
      }
    } catch (error) {
      console.error('[Loot Bar]', error);
    } finally {
      busy = false;
    }
  }

  applyLayout();
  setScale(scale);
  bar.style.left = `${x}px`;
  bar.style.top = `${y}px`;

  // Integracja z głównym przełącznikiem Lootloga w panelu Vickness.
  window.__vicknessSetLootBarEnabled = function(enabled) {
    lootbarEnabled = !!enabled;
    bar.style.setProperty('display', lootbarEnabled ? 'flex' : 'none', 'important');
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (lootbarEnabled) {
      loadLoots();
      refreshTimer = setInterval(() => {
        if (!window.__vicknessShouldPauseAddons?.()) loadLoots();
      }, REFRESH_MS);
    }
  };

  bar.style.setProperty('display', lootbarEnabled ? 'flex' : 'none', 'important');
  // Po utworzeniu belki zsynchronizuj ją z przełącznikiem panelu,
  // który mógł zostać uruchomiony wcześniej niż sam moduł Loot Bar.
  const panelLootlogSwitch = document.querySelector('#vxLootlogSwitch');
  if (panelLootlogSwitch) {
    lootbarEnabled = !!panelLootlogSwitch.checked;
    bar.style.setProperty('display', lootbarEnabled ? 'flex' : 'none', 'important');
  }
  if (lootbarEnabled) {
    loadLoots();
    refreshTimer = setInterval(() => {
      if (!window.__vicknessShouldPauseAddons?.()) loadLoots();
    }, REFRESH_MS);
  }

  window.addEventListener('resize', () => {
    const maxX = Math.max(0, window.innerWidth - bar.offsetWidth * scale);
    const maxY = Math.max(0, window.innerHeight - bar.offsetHeight * scale);

    x = Math.min(x, maxX / scale);
    y = Math.min(y, maxY / scale);

    bar.style.left = `${x}px`;
    bar.style.top = `${y}px`;
    hideTooltip();
    save();
  });

  window.addEventListener('scroll', hideTooltip, true);
})();


// =============================================================
// TITAN TRACKER GOLD 5.0.2 — zintegrowany z panelem Vickness
(() => {
    'use strict';

    const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const MAX_PLAYERS = 15;
    const STORAGE_WEBHOOK = 'rtt_webhook_v2';
    const STORAGE_POSITION = 'rtt_position_v2';

    // Tracker działa wyłącznie na tych mapach.
    const ALLOWED_MAPS = new Set([
        1800, // Migotliwa Pieczara
        1745, // Grota Caerbannoga - leże bestii
        6950, // Bandyckie Chowisko - skarbiec
        7061, // Wulkan Politraki - Piekielne Czeluście
        7478, // Lokum Złych Goblinów - pracownia
        6058, // Źródło Wspomnień
        5947, // Komnata Krwawych Obrzędów
        7849, // Nora Jaszczurzych Koszmarów - źródło
        5710, // Teotihuacan
        3313, // Sala Zrujnowanej Świątyni
        2758, // Sala Tronowa
    ]);

    const GOLD = '#d4af37';
    const GOLD_LIGHT = '#f5d778';
    const BLACK = '#080808';

    const state = {
        players: new Map(),
        titan: null,
        titanKey: '',
        collapsed: true,
        settingsOpen: false,
        webhook: localStorage.getItem(STORAGE_WEBHOOK) || '',
        hookedManager: null,
        seededManager: null,
        currentMap: null,
        mapAllowed: false,
        nextJoinOrder: 1
    };

    const professions = {
        w: 'w', m: 'm', b: 'b', t: 't', h: 'h', p: 'p'
    };

    const $ = (selector, root = document) => root.querySelector(selector);

    function engine() {
        return W.Engine || window.Engine;
    }

    function timeNow() {
        return new Date().toLocaleTimeString('pl-PL', { hour12: false });
    }

    // Odczytuje identyfikator aktualnej mapy z dostępnych pól silnika.
    function getCurrentMapId() {
        const E = engine();

        const candidates = [
            E?.map?.d?.id,
            E?.map?.id,
            E?.map?.d?.map,
            E?.map?.mapId,
            W.map?.id,
            W.g?.world?.map?.id
        ];

        for (const value of candidates) {
            if (value !== undefined && value !== null && value !== '') {
                const id = Number(value);
                if (Number.isFinite(id)) return id;
            }
        }

        return null;
    }

    function checkMap() {
        const mapId = getCurrentMapId();

        if (mapId !== state.currentMap) {
            state.currentMap = mapId;
            state.mapAllowed = mapId !== null && ALLOWED_MAPS.has(mapId);

            // Zmiana mapy zawsze czyści listę poprzedniej lokacji.
            state.players.clear();
            state.nextJoinOrder = 1;
            state.titan = null;
            state.titanKey = '';
            state.seededManager = null;

            if (state.mapAllowed) {
                saveHero();
            }

            updateTable();
        }

        return state.mapAllowed;
    }

    // -------------------- TYTAN --------------------

    function findTitan() {
        const npcs = engine()?.npcs?.getDrawableList?.() || [];

        const candidates = npcs.filter(npc => {
            const d = npc?.d;
            if (!d?.nick) return false;

            const icon = String(d.icon || '').toLowerCase();
            const nick = String(d.nick).toLowerCase();

            return icon.includes('tyt/') ||
                nick.includes('baulus') ||
                (Number(d.wt) > 99 && Number(d.type) === 2);
        });

        candidates.sort((a, b) => {
            const aTitan = String(a?.d?.icon || '').toLowerCase().includes('tyt/');
            const bTitan = String(b?.d?.icon || '').toLowerCase().includes('tyt/');
            return Number(bTitan) - Number(aTitan);
        });

        const npc = candidates[0];
        if (!npc?.d) return null;

        return {
            id: String(npc.d.id ?? npc.d.tpl ?? npc.d.nick),
            nick: npc.d.nick,
            level: npc.d.lvl ?? npc.d.wt ?? '?'
        };
    }

    function scanTitan() {
        if (!state.mapAllowed) {
            state.titan = null;
            state.titanKey = '';
            return;
        }

        const found = findTitan();

        if (!found) {
            state.titan = null;
            state.titanKey = '';
            return;
        }

        const key = `${found.id}|${found.nick}|${found.level}`;

        if (key !== state.titanKey) {
            state.titanKey = key;
            state.titan = { ...found, detectedAt: timeNow() };

            // Automatycznie rozwiń tracker po wykryciu tytana.
            state.collapsed = false;
            const panel = $('#rtt-panel');
            if (panel) {
                $('#rtt-body', panel).style.display = 'block';
                $('#rtt-settings-panel', panel).style.display =
                    state.settingsOpen ? 'block' : 'none';
                $('#rtt-collapse', panel).textContent = '−';
            }
        }
    }

    // -------------------- GRACZE --------------------

    function getHeroId() {
        const id = engine()?.hero?.d?.id;
        return id == null ? '' : String(id);
    }

    function savePlayer(id, input, character, redraw = true) {
        if (!state.mapAllowed) return;

        const d = character?.d || {};
        const source = input?.d || input || {};
        const nick = d.nick || source.nick;

        if (!nick) return;

        const playerId = String(d.id ?? source.id ?? id ?? '');
        if (!playerId) return;

        if (playerId === getHeroId()) {
            if (redraw) updateTable();
            return;
        }

        if (character && character.isPlayer !== true) return;

        if (state.players.has(playerId)) {
            const old = state.players.get(playerId);
            old.nick = nick;
            old.level = d.lvl ?? source.lvl ?? old.level;
            old.prof = professions[d.prof] || d.prof || old.prof || '?';
            if (redraw) updateTable();
            return;
        }

        if (state.players.size >= MAX_PLAYERS) return;

        state.players.set(playerId, {
            id: playerId,
            nick,
            level: d.lvl ?? source.lvl ?? '?',
            prof: professions[d.prof] || d.prof || '?',
            time: timeNow(),
            joinOrder: state.nextJoinOrder++,
            isHero: false
        });

        if (redraw) updateTable();
    }

    function saveHero() {
        if (!state.mapAllowed) return;

        const d = engine()?.hero?.d;
        if (!d?.nick || d.id == null) return;

        const id = String(d.id);

        if (state.players.has(id)) {
            const player = state.players.get(id);
            player.nick = d.nick;
            player.level = d.lvl ?? player.level;
            player.prof = professions[d.prof] || d.prof || player.prof || '?';
            player.isHero = true;
            return;
        }

        if (state.players.size >= MAX_PLAYERS) {
            const lastOther = [...state.players.entries()]
                .reverse()
                .find(([, player]) => !player.isHero);

            if (lastOther) state.players.delete(lastOther[0]);
            else return;
        }

        state.players.set(id, {
            id,
            nick: d.nick,
            level: d.lvl ?? '?',
            prof: professions[d.prof] || d.prof || '?',
            time: timeNow(),
            joinOrder: state.nextJoinOrder++,
            isHero: true
        });
    }

    function removePlayer(id) {
        if (id == null || String(id) === getHeroId()) return;
        state.players.delete(String(id));
    }

    function seedExistingPlayers(manager) {
        if (!state.mapAllowed || state.seededManager === manager) return;
        state.seededManager = manager;

        try {
            const known = manager.check?.();
            const ids = known instanceof Map
                ? [...known.keys()]
                : known && typeof known === 'object'
                    ? Object.keys(known)
                    : [];

            for (const id of ids) {
                const character = manager.getById(String(id));
                if (character?.isPlayer && character.d?.nick) {
                    savePlayer(id, character.d, character, false);
                }
            }

            updateTable();
        } catch (error) {
            console.warn('[Titan Tracker] Odczyt graczy:', error);
        }
    }

    function hookPlayers() {
        const manager = engine()?.others;
        if (!manager || typeof manager.updateData !== 'function') return;

        if (state.hookedManager !== manager) {
            const original = manager.updateData;

            manager.updateData = function (data) {
                const result = original.apply(this, arguments);

                try {
                    for (const id of Object.keys(data || {})) {
                        const input = data[id];
                        if (!input) continue;

                        const source = input.d || input;
                        const playerId = String(source.id ?? input.id ?? id);

                        if (input.del || source.del) {
                            removePlayer(playerId);
                            continue;
                        }

                        if (!state.mapAllowed) continue;

                        const character = this.getById(String(id));
                        if (character?.isPlayer === true) {
                            savePlayer(playerId, input, character, false);
                        }
                    }

                    updateTable();
                } catch (error) {
                    console.error('[Titan Tracker] Błąd odczytu graczy:', error);
                }

                return result;
            };

            state.hookedManager = manager;
        }

        seedExistingPlayers(manager);
    }

    function cleanMissingPlayers() {
        if (!state.mapAllowed) {
            state.players.clear();
            return;
        }

        const manager = engine()?.others;
        if (!manager || typeof manager.getById !== 'function') return;

        for (const [id, player] of state.players) {
            if (player.isHero || id === getHeroId()) continue;

            try {
                const character = manager.getById(id);

                if (!character || character.isPlayer !== true) {
                    state.players.delete(id);
                }
            } catch (error) {
                console.warn('[Titan Tracker] Sprawdzanie gracza:', error);
            }
        }
    }

    // -------------------- WYGLĄD --------------------

    function installStyles() {
        if ($('#rtt-styles')) return;

        const style = document.createElement('style');
        style.id = 'rtt-styles';
        style.textContent = `
            #rtt-panel {
                position:fixed;z-index:2147483647;top:100px;left:15px;
                width:280px;min-width:280px;max-width:280px;
                height:auto;min-height:0;max-height:calc(100vh - 8px);
                box-sizing:border-box;background:${BLACK};color:#f4e8bd;
                border:1px solid ${GOLD};border-radius:5px;
                box-shadow:0 0 12px #d4af3738,0 4px 16px #000b;
                font:11px Arial,sans-serif;resize:none;overflow:auto;
            }
            #rtt-head {
                display:flex;justify-content:space-between;align-items:center;
                gap:6px;background:#111;padding:4px 7px;cursor:move;
                border-bottom:1px solid ${GOLD};font-weight:bold;font-size:11px;
                line-height:16px;user-select:none;position:sticky;top:0;z-index:2;
            }
            #rtt-head > span:first-child {color:${GOLD_LIGHT}}
            #rtt-head button,#rtt-panel button {
                cursor:pointer;border:1px solid ${GOLD};border-radius:3px;
                padding:4px 6px;background:#17130a;color:${GOLD_LIGHT};
                font-size:11px;
            }
            #rtt-head button {padding:1px 5px;line-height:15px}
            #rtt-panel button:hover {background:#30240b;color:#fff0b3}
            #rtt-body {padding:7px;overflow:auto}
            .rtt-titan {display:flex;justify-content:space-between;gap:6px;margin-bottom:6px}
            .rtt-titan b {color:${GOLD_LIGHT};overflow-wrap:anywhere}
            #rtt-titan-level {color:#e4d29b}
            .rtt-count {margin-bottom:5px;color:#d2c69c}
            #rtt-panel table {width:100%;border-collapse:collapse;table-layout:auto}
            #rtt-panel th {
                background:#18140a;color:${GOLD_LIGHT};padding:5px 3px;
                border:1px solid ${GOLD};
            }
            #rtt-panel td {
                padding:4px 3px;border:1px solid #6d5a20;text-align:center;
            }
            #rtt-panel td:nth-child(2) {text-align:left;overflow-wrap:anywhere}
            .rtt-actions {display:flex;gap:5px;margin-top:7px;flex-wrap:wrap}
            .rtt-actions button {flex:1;min-width:120px}
            #rtt-settings-panel {
                padding:9px;background:#080808;border-top:1px solid ${GOLD};
            }
            #rtt-settings-panel label {display:block;margin-bottom:5px;color:${GOLD_LIGHT}}
            #rtt-webhook {
                display:block;box-sizing:border-box;width:100%;margin-bottom:7px;
                padding:7px;background:#151515;color:#fff0b3;
                border:1px solid ${GOLD};border-radius:3px;
                user-select:text;pointer-events:auto;
            }
            #rtt-webhook:focus {outline:1px solid ${GOLD_LIGHT}}
            .rtt-setting-buttons {display:flex;gap:6px;flex-wrap:wrap}
            #rtt-settings-panel p {color:#c9b979;font-size:10px}
        `;
        document.head.appendChild(style);
    }

    function loadPosition(panel) {
        try {
            const pos = JSON.parse(localStorage.getItem(STORAGE_POSITION) || '{}');
            if (pos.left) panel.style.left = pos.left;
            if (pos.top) panel.style.top = pos.top;
        } catch (_) {}
    }

    function savePosition(panel) {
        localStorage.setItem(STORAGE_POSITION, JSON.stringify({
            left: panel.style.left,
            top: panel.style.top
        }));
    }

    function makeDraggable(panel) {
        const head = $('#rtt-head', panel);
        if (!head) return;

        head.onpointerdown = event => {
            if (event.target.closest('button')) return;

            const rect = panel.getBoundingClientRect();
            const x = event.clientX;
            const y = event.clientY;
            const left = rect.left;
            const top = rect.top;

            function move(e) {
                panel.style.left = Math.max(
                    0, Math.min(innerWidth - panel.offsetWidth, left + e.clientX - x)
                ) + 'px';
                panel.style.top = Math.max(
                    0, Math.min(innerHeight - 35, top + e.clientY - y)
                ) + 'px';
                panel.style.right = 'auto';
            }

            function up() {
                document.removeEventListener('pointermove', move);
                document.removeEventListener('pointerup', up);
                savePosition(panel);
            }

            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', up);
        };
    }

    function createPanel() {
        if ($('#rtt-panel')) return;

        installStyles();

        const panel = document.createElement('section');
        panel.id = 'rtt-panel';
        panel.innerHTML = `
            <div id="rtt-head">
                <span>💎Pierwsza dyszka</span>
                <span>
                    <button id="rtt-settings" title="Ustawienia Discord">⚙</button>
                    <button id="rtt-collapse" title="Zwiń/rozwiń">−</button>
                </span>
            </div>
            <div id="rtt-body">
                <div class="rtt-titan">
                    <b id="rtt-titan-name">Wyszukiwanie tytana…</b>
                    <span id="rtt-titan-level"></span>
                </div>
                <div class="rtt-count" id="rtt-count">Gracze: 0/15</div>
                <table>
                    <thead><tr>
                        <th>#</th><th>Nick</th><th>Lvl</th><th>Prof.</th><th>Wejście</th>
                    </tr></thead>
                    <tbody id="rtt-rows"></tbody>
                </table>
                <div class="rtt-actions">
                    <button id="rtt-send">Wyślij top 10</button>
                    <button id="rtt-reset">Wyczyść listę</button>
                </div>
                <div id="rtt-send-status" role="status" aria-live="polite"
                    style="display:none;margin-top:6px;padding:5px;border:1px solid #6d5a20;border-radius:3px;color:#f5d778;overflow-wrap:anywhere"></div>
            </div>
            <div id="rtt-settings-panel" style="display:none">
                <label for="rtt-webhook">Discord webhook URL</label>
                <input id="rtt-webhook" type="text" autocomplete="off"
                    spellcheck="false" placeholder="https://discord.com/api/webhooks/…">
                <div class="rtt-setting-buttons">
                    <button id="rtt-save-webhook">Zapisz webhook</button>
                    <button id="rtt-test-webhook">Test</button>
                </div>
                <p>Webhook zapisany lokalnie w przeglądarce.</p>
            </div>`;

        document.body.appendChild(panel);
        loadPosition(panel);
        bindPanel(panel);

        // Po każdym odświeżeniu gry tracker startuje zwinięty.
        $('#rtt-body', panel).style.display = state.collapsed ? 'none' : 'block';
        $('#rtt-settings-panel', panel).style.display =
            !state.collapsed && state.settingsOpen ? 'block' : 'none';
        $('#rtt-collapse', panel).textContent = state.collapsed ? '+' : '−';

        updateTable();
    }

    function bindPanel(panel) {
        $('#rtt-settings', panel).addEventListener('click', event => {
            event.stopPropagation();
            state.settingsOpen = !state.settingsOpen;
            $('#rtt-settings-panel', panel).style.display =
                state.settingsOpen ? 'block' : 'none';

            if (state.settingsOpen) {
                $('#rtt-webhook', panel).value = state.webhook;
            }
        });

        $('#rtt-collapse', panel).addEventListener('click', event => {
            event.stopPropagation();
            state.collapsed = !state.collapsed;
            $('#rtt-body', panel).style.display = state.collapsed ? 'none' : 'block';
            $('#rtt-settings-panel', panel).style.display =
                !state.collapsed && state.settingsOpen ? 'block' : 'none';
            $('#rtt-collapse', panel).textContent = state.collapsed ? '+' : '−';
        });

        const input = $('#rtt-webhook', panel);
        for (const name of ['pointerdown', 'mousedown', 'click', 'keydown']) {
            input.addEventListener(name, event => event.stopPropagation());
        }

        $('#rtt-save-webhook', panel).addEventListener('click', event => {
            event.stopPropagation();
            state.webhook = input.value.trim();
            localStorage.setItem(STORAGE_WEBHOOK, state.webhook);
            setSendStatus('Webhook zapisany lokalnie.', true);
        });

        $('#rtt-test-webhook', panel).addEventListener('click', async event => {
            event.stopPropagation();
            state.webhook = input.value.trim();
            localStorage.setItem(STORAGE_WEBHOOK, state.webhook);
            await sendDiscord(true);
        });

        $('#rtt-send', panel).addEventListener('click', () => sendDiscord(false));

        $('#rtt-reset', panel).addEventListener('click', () => {
            if (!confirm('Wyczyścić listę graczy?')) return;
            state.players.clear();
            saveHero();
            updateTable();
        });

        makeDraggable(panel);
    }

    function updateTable() {
        const panel = $('#rtt-panel');
        if (!panel) return;

        if (!state.mapAllowed) {
            $('#rtt-titan-name', panel).textContent =
                'Mapa poza listą';
            $('#rtt-titan-level', panel).textContent = '';
            $('#rtt-count', panel).textContent = 'Gracze: 0/15';
        } else if (state.titan) {
            $('#rtt-titan-name', panel).textContent = state.titan.nick;
            $('#rtt-titan-level', panel).textContent =
                `Poziom ${state.titan.level}`;
            $('#rtt-count', panel).textContent =
                `Gracze: ${state.players.size}/${MAX_PLAYERS}`;
        } else {
            $('#rtt-titan-name', panel).textContent = 'Nie wykryto tytana';
            $('#rtt-titan-level', panel).textContent = '';
            $('#rtt-count', panel).textContent =
                `Gracze: ${state.players.size}/${MAX_PLAYERS}`;
        }

        const tbody = $('#rtt-rows', panel);
        tbody.replaceChildren();

        if (!state.mapAllowed) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 5;
            cell.textContent = 'Tracker działa tylko na wybranych mapach.';
            row.appendChild(cell);
            tbody.appendChild(row);
            return;
        }

        const players = [...state.players.values()].sort((a, b) => a.joinOrder - b.joinOrder);

        if (!players.length) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 5;
            cell.textContent = 'Oczekiwanie na graczy…';
            row.appendChild(cell);
            tbody.appendChild(row);
            return;
        }

        players.forEach((p, i) => {
            const row = document.createElement('tr');
            row.style.background = i < 10 ? '#164c24' : '#5b1717';
            row.style.color = i < 10 ? '#d9ffdf' : '#ffe1e1';

            if (p.isHero) row.style.outline = '1px solid #f5d778';

            for (const value of [i + 1, p.nick, p.level, p.prof, p.time]) {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            }

            tbody.appendChild(row);
        });
    }

    // Komunikaty pod przyciskiem zamiast blokujących alertów.
    function setSendStatus(message, success = false) {
        const status = $('#rtt-send-status');
        if (!status) return;
        status.textContent = message;
        status.style.display = 'block';
        status.style.color = success ? '#b8f5c1' : '#ffb3a7';
        status.style.borderColor = success ? '#347a42' : '#8a3b31';
    }

    // -------------------- DISCORD --------------------

    async function sendDiscord(testOnly = false) {
        const webhook = state.webhook.trim();

        if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(webhook)) {
            setSendStatus('Wpisz poprawny adres webhooka Discord w ustawieniach.');
            return;
        }

        if (!testOnly && !state.mapAllowed) {
            setSendStatus('Wysyłanie listy jest dostępne tylko na wybranych mapach.');
            return;
        }

        setSendStatus(testOnly ? 'Wysyłanie wiadomości testowej…' : 'Wysyłanie listy na Discord…', true);

        const players = [...state.players.values()].sort((a, b) => a.joinOrder - b.joinOrder).slice(0, 10);
        const titan = state.titan;

        const content = testOnly
            ? 'Test Titan Tracker — webhook działa.'
            : [
                `**Mapa ID:** ${state.currentMap ?? '?'}`,
                `**Tytan:** ${titan?.nick || 'Nie wykryto'}`,
                `**Poziom:** ${titan?.level ?? '?'}`,
                `**Czas wykrycia:** ${titan?.detectedAt || '?'}`,
                '',
                '**Top 10 graczy:**',
                ...(players.length
                    ? players.map((p, i) =>
                        `${i + 1}. **${p.nick}** — ${p.level} lvl, ${p.prof}, ${p.time}`
                    )
                    : ['Brak zapisanych graczy.'])
            ].join('\n');

        try {
            const response = await fetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: 'Titan Tracker',
                    content: content.slice(0, 1900)
                })
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            setSendStatus(testOnly
                ? '✓ Wiadomość testowa wysłana na Discord.'
                : '✓ Lista graczy wysłana na Discord.', true);
        } catch (error) {
            console.error('[Titan Tracker] Discord:', error);
            setSendStatus('✕ Wysyłka nie powiodła się. Sprawdź webhook i konsolę F12.');
        }
    }

    // -------------------- GŁÓWNA PĘTLA --------------------

    function tick() {
        // Integracja z głównym przełącznikiem Vickness Addons.
        const addonFlags = window.__vicknessAddonEnabled;
        const trackerPanel = $('#rtt-panel');
        if (addonFlags && addonFlags.titan === false) {
            if (trackerPanel) trackerPanel.style.setProperty('display', 'none', 'important');
            return;
        }
        if (trackerPanel) trackerPanel.style.removeProperty('display');

        checkMap();
        hookPlayers();

        if (state.mapAllowed) {
            saveHero();
            scanTitan();
            cleanMissingPlayers();
        }

        updateTable();
    }

    let titanTickTimer = null;

    function syncTitanTimer() {
        const shouldRun = window.__vicknessAddonEnabled?.titan !== false &&
            document.visibilityState !== 'hidden';
        if (!shouldRun) {
            if (titanTickTimer !== null) clearInterval(titanTickTimer);
            titanTickTimer = null;
            return;
        }
        if (titanTickTimer === null) {
            tick();
            titanTickTimer = window.setInterval(tick, 2000);
        }
    }

    window.__vicknessSetTitanEnabled = value => {
        if (window.__vicknessAddonEnabled) window.__vicknessAddonEnabled.titan = !!value;
        syncTitanTimer();
    };
    document.addEventListener('visibilitychange', syncTitanTimer);
    window.addEventListener('pagehide', () => {
        if (titanTickTimer !== null) clearInterval(titanTickTimer);
        titanTickTimer = null;
        document.removeEventListener('visibilitychange', syncTitanTimer);
        delete window.__vicknessSetTitanEnabled;
    }, { once: true });

    function start() {
        if (!document.body) {
            setTimeout(start, 500);
            return;
        }
        createPanel();
        syncTitanTimer();
    }

    start();
})();

// =============================================================
// PROCENT ŁUPU 5.11.0 (wewnętrzny moduł v513) — zintegrowany z panelem Vickness
// =============================================================
(() => {
   'use strict';

   // API Margonem odczytujemy z kontekstu strony gry, poza sandboxem userscriptu.
   const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
   function getGameEngine() {
     try {
       if (typeof PAGE.getEngine === 'function') {
         const engine = PAGE.getEngine();
         if (engine) return engine;
       }
     } catch (_) {}
     try {
       return PAGE.Engine || PAGE.engine || PAGE.g?.Engine || PAGE.g?.engine || window.Engine || null;
     } catch (_) { return null; }
   }

   if (window.__margonemLootChanceV513) return;
   window.__margonemLootChanceV513 = true;

   const STORE = 'mlcSettingsV513';
   const PROFESSIONS = {
     b: 'Tancerz ostrzy', h: 'Łowca', w: 'Wojownik',
     t: 'Tropiciel', p: 'Paladyn', m: 'Mag'
   };
   const RARITIES = {
     't-norm': 'common', 't-uni': 'unique',
     't-her': 'heroic', 't-leg': 'legendary'
   };
   const RARITY_NAMES = {
     common: 'Pospolity', unique: 'Unikatowy',
     heroic: 'Heroiczny', legendary: 'Legendarny'
   };
   const DEFAULTS = {
     enabled: true,
     profession: 'p',
     rarities: { common: false, unique: false, heroic: true, legendary: true }
   };

   let settings;
   try {
     const saved = JSON.parse(localStorage.getItem(STORE) || 'null') || {};
     settings = {
       ...DEFAULTS, ...saved,
       rarities: { ...DEFAULTS.rarities, ...(saved.rarities || {}) }
     };
   } catch (_) {
     settings = JSON.parse(JSON.stringify(DEFAULTS));
   }

   const requirements = new Map();
   const labels = new Map();
   const pendingReads = new WeakSet();
   let panel = null;
   let status = null;
   let observer = null;
   let scanTimer = null;
   let lastWindowOpen = false;

   const norm = s => String(s || '').normalize('NFD')
     .replace(/[\u0300-\u036f]/g, '')
     .toLowerCase().replace(/\s+/g, ' ').trim();

   function save() {
     try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (_) {}
   }

   function getCurrentProfession() {
     // Kod profesji własnej postaci udostępniany przez Margonem.
     try {
       if (typeof PAGE.getHeroProf === 'function') {
         const code = String(PAGE.getHeroProf() || '').toLowerCase();
         if (PROFESSIONS[code]) return code;
       }
     } catch (_) {}
     return null;
   }

   function getItem(wrapper) {
     if (!wrapper) return null;
     if (wrapper.matches?.('.item[data-tip-type="t_item"], .item[data-item-type]')) return wrapper;
     return wrapper.querySelector('.item[data-tip-type="t_item"], .item[data-item-type]');
   }

   function itemKey(item) {
     const c = String(item?.className || '');
     const tpl = c.match(/\bitem-tpl-(\d+)\b/);
     const id = c.match(/\bitem-id-(\d+)\b/);
     if (tpl) return 'tpl:' + tpl[1];
     if (id) return 'id:' + id[1];
     return item?.getAttribute('title') || null;
   }

   function getRarity(item) {
     const els = [item, item?.parentElement, item?.closest('.slot'),
       item?.closest('.loot-item-wrapper')].filter(Boolean);

     for (const el of els) {
       const type = el.getAttribute?.('data-item-type');
       if (type && RARITIES[type]) return RARITIES[type];

       const m = String(el.className || '').match(/\bt-(?:norm|uni|her|leg)\b/);
       if (m && RARITIES[m[0]]) return RARITIES[m[0]];
     }
     return null;
   }

   function lootItems() {
     const found = new Set();

     document.querySelectorAll(
       '.loot-wnd .loot-item-wrapper, .loot-window .loot-item-wrapper'
     ).forEach(wrapper => {
       const item = getItem(wrapper);
       if (item) found.add(item);
     });

     if (!found.size) {
       document.querySelectorAll(
         '.loot-wnd .item[data-tip-type="t_item"], ' +
         '.loot-window .item[data-tip-type="t_item"]'
       ).forEach(item => found.add(item));
     }
     return [...found];
   }

   function isWindowVisible(el) {
     if (!el || !el.isConnected || !el.getClientRects().length) return false;
     const s = getComputedStyle(el);
     return s.display !== 'none' && s.visibility !== 'hidden' &&
       Number(s.opacity || 1) > 0;
   }

   function isLootWindowOpen() {
     const candidates = document.querySelectorAll(
       '.loot-wnd, .loot-window, .c-window.loot-wnd'
     );
     return [...candidates].some(isWindowVisible);
   }

   function getTeam() {
     try {
       const engine = getGameEngine();
       const members = engine?.party?.getMembers?.();
       if (members instanceof Map) {
         const team = [];
         for (const member of members.values()) {
           const code = String(member?.profession || '').toLowerCase();
           if (!PROFESSIONS[code]) continue;
           team.push({ code, name: String(member?.id ?? ''), isHero: !!member?.isHero });
         }
         if (team.length) return team.slice(0, 20);
       }
     } catch (_) {}

     // Awaryjny odczyt z interfejsu drużyny, jeśli API silnika chwilowo nie jest dostępne.
     const team = [], seen = new Set();
     document.querySelectorAll('.party-member .character-info[prof]').forEach(el => {
       const code = String(el.getAttribute('prof') || '').toLowerCase();
       if (!PROFESSIONS[code]) return;
       const member = el.closest('.party-member');
       if (!member) return;
       const nameEl = member.querySelector('.party-member-name, .character-name, [class*="name"]');
       const name = norm(nameEl?.textContent || member.textContent || '');
       const key = name + ':' + code;
       if (seen.has(key)) return;
       seen.add(key);
       team.push({ code, name });
     });
     return team.slice(0, 20);
   }







   function readRequirements(item) {
     const key = itemKey(item);
     if (!key) return false;
     if (requirements.has(key)) return true;

     try {
       const engine = getGameEngine();
       const id = String(item.className || '').match(/\bitem-id-(\d+)\b/)?.[1];
       const gameItem = id && engine?.items?.getItemById?.(id);
       const stats = gameItem?._cachedStats;
       if (!stats) return false;

       const raw = String(stats.reqp || '').toLowerCase().trim();
       const parsed = raw
         ? [...new Set([...raw].filter(code => Object.prototype.hasOwnProperty.call(PROFESSIONS, code)))]
         : [];

       // Brak reqp oznacza brak wymogu konkretnej profesji.
       requirements.set(key, parsed);
       return true;
     } catch (_) {
       return false;
     }
   }

   function removeLabel(item) {
     const label = labels.get(item);
     if (label) label.remove();
     labels.delete(item);
   }

   function clearLootLabels() {
     labels.forEach(label => label.remove());
     labels.clear();

     document.querySelectorAll(
       '.mlc41-label, .mlc42-label, .mlc43-label, ' +
       '.mlc44-label, .mlc45-label, .mlc46-label, .mlc513-label'
     ).forEach(el => el.remove());
   }

   function makeLabel(item) {
     let label = labels.get(item);

     if (!label || !label.isConnected) {
       label = document.createElement('span');
       label.className = 'mlc513-label';
       label.style.cssText =
         'position:fixed;z-index:2147483647;display:none;pointer-events:none;' +
         'margin:0;padding:0;background:transparent;border:0;white-space:nowrap;' +
         'font:bold 12px/14px Arial,sans-serif;text-align:center;' +
         'text-shadow:-1px -1px 2px #000,1px -1px 2px #000,-1px 1px 2px #000,1px 1px 2px #000;';
       document.body.appendChild(label);
       labels.set(item, label);
     }
     return label;
   }

   function updateItem(item, team, lootWindowOpen, myProfession) {
     const r = getRarity(item);

     if (!settings.enabled || (window.__vicknessAddonEnabled && !window.__vicknessAddonEnabled.lootChance) || !r || !settings.rarities[r] ||
          !item.isConnected || !lootWindowOpen) {
       removeLabel(item);
       return false;
     }

     const key = itemKey(item);
     const req = key ? requirements.get(key) : undefined;

     // Nie pokazuj znaku zapytania podczas odczytu. Etykieta pojawi się,
     // gdy skrypt faktycznie pozna wymagania tego przedmiotu.
     if (req === undefined) {
       removeLabel(item);
       return false;
     }

     let text = '';
     let color = '#fff';
     let title = 'Oczekiwanie na odczyt wymagań przedmiotu.';

     if (req !== undefined) {
       if (!myProfession) {
         text = '?';
         color = '#fff';
         title = 'Nie udało się odczytać Twojej profesji z Margonem.';
       } else {
         const isSolo = team.length === 0;
         const roster = isSolo ? [{ code: myProfession }] : team;
         // Solo: każdy łup ma 100%, niezależnie od wymagań profesji.
         // W grupie: jeśli są gracze spełniający wymagania, dzielimy szansę
         // równo tylko między nich. Jeśli wymaganej profesji nie ma w grupie,
         // szansa rozkłada się równo na wszystkich członków drużyny.
         const matching = req.length
           ? roster.filter(player => req.includes(player.code))
           : roster;
         const eligible = (!isSolo && req.length > 0 && matching.length === 0)
           ? roster
           : matching;
         const myProfessionEligible = isSolo ||
           eligible.some(player => player.code === myProfession);
         const pct = myProfessionEligible && eligible.length
           ? Math.round(100 / eligible.length)
           : 0;

         text = pct + '%';
         color = pct === 100 ? '#76ff8b' :
           pct === 0 ? '#ff7777' : '#ffd66b';

         title = 'Twoja profesja: ' + PROFESSIONS[myProfession] +
           '\\nWymagania: ' +
           (req.length ? req.map(code => PROFESSIONS[code]).join(' lub ') : 'dowolna profesja') +
           '\\nUprawnieni: ' + eligible.length;
       }
     }

     const label = makeLabel(item);
     label.textContent = text;
     label.style.color = color;
     label.title = title;

     const rect = item.getBoundingClientRect();
     if (!rect.width || !rect.height) {
       label.style.display = 'none';
       return true;
     }

     label.style.left = (rect.left + rect.width / 2) + 'px';
     label.style.top = (rect.top - 15) + 'px';
     label.style.transform = 'translateX(-50%)';
     label.style.display = 'block';
     return true;
   }

   function autoRead(item) {
     const key = itemKey(item);
     if (!key || requirements.has(key) || pendingReads.has(item)) return;

     pendingReads.add(item);
     let attempts = 0;

     function retry() {
       if (!settings.enabled || (window.__vicknessAddonEnabled && !window.__vicknessAddonEnabled.lootChance) || !isLootWindowOpen() || !item.isConnected) {
         pendingReads.delete(item);
         return;
       }

       // Celowo NIE symulujemy pointerover/mouseover/mousemove.
       // Takie zdarzenia powodowały otwieranie tooltipa w interfejsie gry.
       // Odczytujemy wyłącznie tooltip już utworzony przez samą grę.
       if (readRequirements(item)) {
         pendingReads.delete(item);
         scheduleScan(0);
         return;
       }

       attempts++;
       if (attempts < 5) {
         setTimeout(retry, 300);
       } else {
         pendingReads.delete(item);
       }
     }

     setTimeout(retry, 80);
   }

   function scan() {
     scanTimer = null;

     const open = isLootWindowOpen();

     // Gdy okno się zamknie, etykiety znikają natychmiast.
     if (!settings.enabled || (window.__vicknessAddonEnabled && !window.__vicknessAddonEnabled.lootChance) || !open) {
       clearLootLabels();
       lastWindowOpen = false;
       updateStatus(0, 0, getTeam().length);
       return;
     }

     lastWindowOpen = true;
     const items = lootItems();
     const itemsSet = new Set(items);
     const team = getTeam();
     // Odczyt profesji i widoczności raz na skan zamiast ponownie dla każdego przedmiotu.
     const myProfession = getCurrentProfession();
     let shown = 0;

     items.forEach(item => {
       if (updateItem(item, team, open, myProfession)) shown++;
       autoRead(item);
     });

     for (const [item, label] of labels) {
       if (!item.isConnected || !itemsSet.has(item)) {
         label.remove();
         labels.delete(item);
       }
     }

     updateStatus(items.length, shown, team.length || 1);
   }

   function scheduleScan(delay = 250) {
     // Skany opóźnione są scalane: seria zmian DOM wywoła jeden skan, nie dziesiątki.
     if (scanTimer) {
       if (delay !== 0) return;
       clearTimeout(scanTimer);
     }
     scanTimer = setTimeout(scan, delay);
   }



   function updateStatus(items, count, members) {
     if (status) {
       status.textContent =
         'Przedmioty: ' + items +
         ' | Etykiety: ' + count +
         ' | Drużyna: ' + members;
     }
   }

   function addStyles() {
     if (document.getElementById('mlc513-style')) return;

     const style = document.createElement('style');
     style.id = 'mlc513-style';
     style.textContent = `
       #mlc513-panel {
         position:fixed;z-index:2147483646;left:auto;top:auto;right:12px;bottom:12px;
         width:190px;max-width:calc(100vw - 24px);padding:8px;color:#f5f0d5;
         background:rgba(8,8,8,.97);border:1px solid #e4bd28;border-radius:5px;
         box-shadow:0 2px 10px #000b;font:11px/1.35 Arial,sans-serif;
       }
       #mlc513-panel .heading {
         display:flex;justify-content:space-between;align-items:center;
         margin:-2px -2px 6px;padding:4px 5px;background:#17140a;
         border-bottom:1px solid #8f751a;font-weight:bold;cursor:move;
         user-select:none;touch-action:none;
       }
       #mlc513-panel .heading button {
         width:25px;min-width:25px;margin:0;padding:1px 4px;
         color:#f8e7a0;background:#171717;border:1px solid #c8a51e;border-radius:3px;
         cursor:pointer;
       }
       #mlc513-panel label {display:block;margin:3px 0;cursor:pointer}
       #mlc513-panel input[type="checkbox"] {accent-color:#e4bd28;transform:scale(.9);transform-origin:left center}
       #mlc513-panel button:not(.heading button) {
         width:100%;margin-top:5px;padding:5px 4px;color:#f8e7a0;
         background:#19160a;border:1px solid #c8a51e;border-radius:3px;cursor:pointer;
       }
       #mlc513-panel button:hover {filter:brightness(1.2)}
       #mlc513-panel .status {margin-top:6px;padding-top:5px;border-top:1px solid #574718;color:#cfc8a9;font-size:10px;overflow-wrap:anywhere}
       #mlc513-panel .rarity-title {font-weight:bold;margin-top:6px}
       #mlc513-panel .profession-info {margin:4px 0;color:#cfc8a9}
     `;
     document.head.appendChild(style);
   }

   function buildPanel() {
     if (panel || !document.body) return;

     panel = document.createElement('div');
     panel.id = 'mlc513-panel';

     const heading = document.createElement('div');
     heading.className = 'heading';

     const title = document.createElement('span');
     title.textContent = 'Procent łupu';

     const collapse = document.createElement('button');
     collapse.style.width = '35px';
     collapse.textContent = '—';

     const content = document.createElement('div');
     collapse.addEventListener('click', () => {
       const hide = content.style.display !== 'none';
       content.style.display = hide ? 'none' : '';
       collapse.textContent = hide ? '+' : '—';
     });

     heading.append(title, collapse);
     panel.append(heading, content);

     // Panel ma być zwinięty po każdym uruchomieniu skryptu.
     content.style.display = 'none';
     collapse.textContent = '+';

     // Przeciąganie panelu za pasek tytułu; nie przeciągaj po kliknięciu przycisku zwijania.
     let drag = null;
     heading.addEventListener('pointerdown', event => {
       if (event.target.closest('button')) return;
       const rect = panel.getBoundingClientRect();
       drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
       panel.style.left = rect.left + 'px';
       panel.style.top = rect.top + 'px';
       panel.style.right = 'auto';
       panel.style.bottom = 'auto';
       heading.setPointerCapture?.(event.pointerId);
       event.preventDefault();
     });
     heading.addEventListener('pointermove', event => {
       if (!drag) return;
       const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
       const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
       panel.style.left = Math.min(maxLeft, Math.max(0, drag.left + event.clientX - drag.x)) + 'px';
       panel.style.top = Math.min(maxTop, Math.max(0, drag.top + event.clientY - drag.y)) + 'px';
     });
     const stopDrag = () => { drag = null; };
     heading.addEventListener('pointerup', stopDrag);
     heading.addEventListener('pointercancel', stopDrag);

     const enabledLabel = document.createElement('label');
     const enabled = document.createElement('input');
     enabled.type = 'checkbox';
     enabled.checked = settings.enabled;
     enabled.addEventListener('change', () => {
       settings.enabled = enabled.checked;
       save();
       scheduleScan(0);
     });
     enabledLabel.append(enabled, document.createTextNode(' Włącz dodatek'));
     content.appendChild(enabledLabel);

     const professionInfo = document.createElement('div');
     professionInfo.className = 'profession-info';
     professionInfo.style.margin = '4px 0';
     professionInfo.style.color = '#ccc';
     professionInfo.textContent = 'Twoja profesja: wykrywana automatycznie';
     content.appendChild(professionInfo);

     const rarityTitle = document.createElement('div');
     rarityTitle.style.fontWeight = 'bold';
     rarityTitle.className = 'rarity-title';
     rarityTitle.style.marginTop = '6px';
     rarityTitle.textContent = 'Pokazuj rzadkości:';
     content.appendChild(rarityTitle);

     // Panel udostępnia przełączniki tylko dla przedmiotów heroicznych i legendarnych.
     // Pospolite i unikatowe pozostają wyłączone i nie można ich włączyć z panelu.
     settings.rarities.common = false;
     settings.rarities.unique = false;
     ['heroic', 'legendary'].forEach(key => {
       const label = document.createElement('label');
       const checkbox = document.createElement('input');
       checkbox.type = 'checkbox';
       checkbox.checked = !!settings.rarities[key];
       checkbox.addEventListener('change', () => {
         settings.rarities[key] = checkbox.checked;
         save();
         scheduleScan(0);
       });
       label.append(checkbox, document.createTextNode(' ' + RARITY_NAMES[key]));
       content.appendChild(label);
     });

     // Ustawienia dodatku są montowane wewnątrz głównego panelu Vickness.
     const host = document.getElementById('vxSettingsLootChance') || document.body;
     host.appendChild(panel);
   }

   function start() {
     document.querySelectorAll(
       '.mlc41-label, .mlc42-label, .mlc43-label, .mlc44-label, .mlc45-label, .mlc46-label, .mlc47-label, .mlc48-label, .mlc49-label, .mlc50-label, .mlc513-label, .mlc513-label'
     ).forEach(el => el.remove());

     addStyles();
     buildPanel();
     scheduleScan(0);

     const isLootRelevantNode = node => {
       if (!node || node.nodeType !== 1) return false;
       if (node.classList?.contains('mlc513-label')) return false;
       const selector = '.loot-wnd, .loot-window, .c-window.loot-wnd, .loot-item-wrapper, .item[data-tip-type="t_item"], .item[data-item-type]';
       if (node.matches?.(selector) || node.closest?.('.loot-wnd, .loot-window, .c-window.loot-wnd')) return true;
       return !!node.querySelector?.(selector);
     };

     observer = new MutationObserver(records => {
       // Pomijaj zwykłe mutacje interfejsu gry i własnych etykiet procentów.
       for (const record of records) {
         const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
         if (isLootRelevantNode(target)) {
           scheduleScan(80);
           return;
         }
         for (const node of [...record.addedNodes, ...record.removedNodes]) {
           if (isLootRelevantNode(node)) {
             scheduleScan(80);
             return;
           }
         }
       }
     });

     observer.observe(document.body, {
       childList: true,
       subtree: true
     });

     // Zabezpieczenie przed oknem, które gra ukrywa zamiast usuwać z DOM.
     setInterval(() => {
       if (lastWindowOpen && !isLootWindowOpen()) {
         clearLootLabels();
         lastWindowOpen = false;
       }
     }, 1000);
   }

   if (document.readyState === 'loading') {
     document.addEventListener('DOMContentLoaded', start, { once: true });
   } else {
     start();
   }
 })();

// =============================================================
// THE CREW ONLINE 3.4.0 — zaktualizowany moduł z załącznika, zintegrowany z Vickness
(() => {
   'use strict';

   const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

   if (window.top !== window.self) return;
   if (document.getElementById('tc-online-panel')) return;

   const STORAGE_KEY = 'tc_online_panel_v2';
   // Pierwsze pobranie startuje natychmiast po gotowości gry; kolejne co 7 s.
    const REFRESH_MS = 7000;

   const defaults = {
     left: Math.max(10, window.innerWidth - 350),
     top: 90,
     width: 260,
     height: 400,
     collapsed: false,
     hidden: false
   };

   let settings;
   try {
     settings = {
       ...defaults,
       ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
     };
   } catch {
     settings = { ...defaults };
   }

   const save = () => {
     try {
       localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
     } catch {}
   };

   const style = document.createElement('style');
   style.textContent = `
     #tc-online-panel {
       position: fixed;
       z-index: 100;
       display: flex;
       flex-direction: column;
       box-sizing: border-box;
       min-width: 220px;
       min-height: 42px;
       background: #101010;
       color: #eee;
       border: 2px solid #d7ad52;
       border-radius: 5px;
       box-shadow: 0 4px 18px #000b;
       font: 12px Arial, sans-serif;
       resize: both;
       overflow: hidden;
     }

     #tc-online-panel * {
       box-sizing: border-box;
     }

     #tc-head {
       display: flex;
       align-items: center;
       gap: 5px;
       min-height: 35px;
       padding: 5px 7px;
       background: #211b10;
       color: #e7c36e;
       border-bottom: 1px solid #80652e;
       cursor: move;
       user-select: none;
       flex-shrink: 0;
     }

     #tc-title {
       flex: 1;
       font-weight: bold;
     }

     .tc-btn {
       border: 1px solid #8c6b2e;
       border-radius: 3px;
       background: #292216;
       color: #e7c36e;
       cursor: pointer;
       padding: 4px 7px;
     }

     .tc-btn:hover {
       background: #49381b;
     }

     #tc-content {
       flex: 1;
       min-height: 0;
       display: flex;
       flex-direction: column;
     }

     #tc-status {
       padding: 7px;
       color: #c6c6c6;
       border-bottom: 1px solid #393126;
       line-height: 1.5;
       overflow-wrap: anywhere;
       flex-shrink: 0;
     }

     /* Lista z cienkim, złotym paskiem przewijania */
     #tc-list {
       flex: 1;
       min-height: 0;
       overflow-y: auto;
       overflow-x: hidden;
       scrollbar-width: thin;
       scrollbar-color: #80652e #101010;
       overscroll-behavior: contain;
       scrollbar-gutter: stable;
     }

     /* Chrome i Edge */
     #tc-list::-webkit-scrollbar {
       width: 5px;
     }

     #tc-list::-webkit-scrollbar-track {
       background: #101010;
     }

     #tc-list::-webkit-scrollbar-thumb {
       background: #80652e;
       border-radius: 8px;
     }

     #tc-list::-webkit-scrollbar-thumb:hover {
       background: #d7ad52;
     }

     .tc-player {
       display: grid;
       grid-template-columns: minmax(0, 1fr) 20px;
       align-items: center;
       gap: 5px;
       padding: 4px 5px;
       border-bottom: 1px solid #403626;
     }

     .tc-player:nth-child(even) {
       background: #181818;
     }

     .tc-name {
       color: #ffe09a;
       font-size: 11px;
       font-weight: 700;
       overflow-wrap: anywhere;
       line-height: 1.25;
       letter-spacing: .1px;
       text-shadow: 0 1px 1px #000;
     }

     .tc-summary {
       margin-top: 2px;
       color: #dedede;
       font-size: 10px;
       line-height: 1.25;
       overflow-wrap: anywhere;
       white-space: normal;
     }

     .tc-summary .tc-summary-level {
       color: #ffe09a;
       font-weight: 700;
     }

     .tc-summary .tc-summary-location {
       color: #b9e6c5;
     }

     .tc-summary .tc-summary-missing {
       color: #aaa;
       font-style: italic;
     }

     .tc-player.tc-in-group {
       background: #102b2b !important;
       box-shadow: inset 3px 0 0 #35d6c8;
     }

     .tc-player.tc-in-group .tc-name {
       color: #55e7dc;
     }

     .tc-level {
       color: #d7ad52;
       font-weight: bold;
     }

     .tc-info {
       margin-top: 4px;
       color: #e0e0e0;
       line-height: 1.35;
       overflow-wrap: anywhere;
       white-space: normal;
       font-size: 11px;
     }

     .tc-info-line {
       display: flex;
       flex-wrap: wrap;
       align-items: flex-start;
       column-gap: 5px;
       row-gap: 5px;
       min-width: 0;
       width: 100%;
     }

     .tc-info-line span {
       min-width: 0;
     }

     .tc-chip {
       display: inline-flex;
       align-items: center;
       box-sizing: border-box;
       max-width: 100%;
       min-height: 20px;
       padding: 3px 6px;
       border: 1px solid #51442d;
       border-radius: 3px;
       background: #211d16;
       color: #e5e5e5;
       overflow-wrap: anywhere;
     }

     .tc-level {
       color: #ffe09a;
       font-weight: 700;
       border-color: #8c6b2e;
       background: #302515;
     }

     .tc-profession {
       color: #bce9ff;
       border-color: #31566b;
       background: #14232b;
     }

     .tc-map {
       color: #d7d7d7;
       overflow-wrap: anywhere;
     }

     .tc-coords {
       color: #8ee5b0;
       border-color: #31583f;
       background: #13251a;
       white-space: nowrap;
     }

     .tc-missing {
       color: #aaa;
       border-style: dashed;
       background: #171717;
     }

     .tc-invite {
       min-width: 20px;
       min-height: 20px;
       width: 20px;
       height: 20px;
       padding: 1px;
       font-size: 12px;
       font-weight: bold;
     }

     .tc-invite:disabled {
       opacity: .45;
       cursor: wait;
     }

     #tc-open {
       position: fixed;
       left: var(--tc-open-left, calc(100vw - 155px));
       top: var(--tc-open-top, calc(100vh - 100px));
       z-index: 100;
       padding: 6px 9px;
       font: 12px Arial, sans-serif;
       color: #e7c36e;
       background: #101010;
       border: 2px solid #d7ad52;
       border-radius: 5px;
       cursor: move;
       user-select: none;
       touch-action: none;
     }
   `;

   document.head.appendChild(style);

   const make = (tag, text, id) => {
     const node = document.createElement(tag);
     if (text !== undefined) node.textContent = text;
     if (id) node.id = id;
     return node;
   };

   const panel = make('div', undefined, 'tc-online-panel');
   const head = make('div', undefined, 'tc-head');
   const title = make('span', 'Klanowicze online: The Crew', 'tc-title');
   const collapseBtn = make('button', '−');
   const hideBtn = make('button', '×');

   collapseBtn.className = hideBtn.className = 'tc-btn';
   collapseBtn.title = 'Zwiń / rozwiń';
   hideBtn.title = 'Ukryj panel';

   head.append(title, collapseBtn, hideBtn);

   const content = make('div', undefined, 'tc-content');
   const status = make('div', 'Pobieranie listy klanu Margonem…', 'tc-status');
   const list = make('div', undefined, 'tc-list');

   // Przewijanie kółkiem myszy nad listą.
   list.addEventListener('wheel', event => {
     if (list.scrollHeight <= list.clientHeight) return;

     event.preventDefault();
     list.scrollTop += event.deltaY;
   }, { passive: false });

   content.append(status, list);
   panel.append(head, content);
   document.body.appendChild(panel);

   const openBtn = make('button', 'Klanowicze online', 'tc-open');
   document.body.appendChild(openBtn);

   const applySettings = () => {
     settings.width = Math.max(220, Number(settings.width) || defaults.width);
     settings.height = Math.max(42, Number(settings.height) || defaults.height);

     settings.left = Math.max(
       0,
       Math.min(Number(settings.left) || 0, window.innerWidth - 80)
     );

     settings.top = Math.max(
       0,
       Math.min(Number(settings.top) || 0, window.innerHeight - 40)
     );

     panel.style.left = `${settings.left}px`;
     panel.style.top = `${settings.top}px`;
     panel.style.width = `${settings.width}px`;
     panel.style.height = `${settings.height}px`;
     const masterEnabled = !(window.__vicknessAddonEnabled && window.__vicknessAddonEnabled.crewOnline === false);
     panel.style.display = (!masterEnabled || settings.hidden) ? 'none' : 'flex';

     openBtn.style.display = !masterEnabled ? 'none' : settings.hidden ? 'block' : 'none';
     const openLeft = settings.openLeft == null
       ? Math.max(0, window.innerWidth - 155)
       : Number(settings.openLeft);
     const openTop = settings.openTop == null
       ? Math.max(0, window.innerHeight - 100)
       : Number(settings.openTop);
     openBtn.style.left = `${Math.max(0, Math.min(openLeft, window.innerWidth - 80))}px`;
     openBtn.style.top = `${Math.max(0, Math.min(openTop, window.innerHeight - 35))}px`;
     content.style.display = settings.collapsed ? 'none' : 'flex';
     collapseBtn.textContent = settings.collapsed ? '+' : '−';
     syncCrewRefreshTimer();
   };

   const saveGeometry = () => {
     const rect = panel.getBoundingClientRect();

     settings.left = rect.left;
     settings.top = rect.top;
     settings.width = rect.width;
     settings.height = rect.height;

     save();
   };

   collapseBtn.addEventListener('click', () => {
     settings.collapsed = !settings.collapsed;
     applySettings();
     save();
   });

   hideBtn.addEventListener('click', () => {
     settings.hidden = true;
     applySettings();
     save();
   });

   let draggedOpenButton = false;
   openBtn.addEventListener('pointerdown', event => {
     if (event.button !== 0) return;
     const startX = event.clientX;
     const startY = event.clientY;
     const startLeft = openBtn.offsetLeft;
     const startTop = openBtn.offsetTop;
     let moved = false;

     const move = e => {
       const dx = e.clientX - startX;
       const dy = e.clientY - startY;
       if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
       settings.openLeft = Math.max(0, Math.min(window.innerWidth - 80, startLeft + dx));
       settings.openTop = Math.max(0, Math.min(window.innerHeight - 35, startTop + dy));
       openBtn.style.left = `${settings.openLeft}px`;
       openBtn.style.top = `${settings.openTop}px`;
     };
     const up = () => {
       document.removeEventListener('pointermove', move);
       document.removeEventListener('pointerup', up);
       if (moved) {
         draggedOpenButton = true;
         save();
       }
     };
     document.addEventListener('pointermove', move);
     document.addEventListener('pointerup', up);
     event.preventDefault();
   });

   openBtn.addEventListener('click', event => {
     if (draggedOpenButton) {
       draggedOpenButton = false;
       event.preventDefault();
       event.stopPropagation();
       return;
     }
     settings.hidden = false;
     applySettings();
     save();
   });

   // Przeciąganie panelu za pasek tytułu.
   head.addEventListener('pointerdown', event => {
     if (event.target.closest('button') || event.button !== 0) return;

     const startX = event.clientX;
     const startY = event.clientY;
     const startLeft = panel.offsetLeft;
     const startTop = panel.offsetTop;

     const move = e => {
       settings.left = Math.max(
         0,
         Math.min(
           window.innerWidth - 80,
           startLeft + e.clientX - startX
         )
       );

       settings.top = Math.max(
         0,
         Math.min(
           window.innerHeight - 40,
           startTop + e.clientY - startY
         )
       );

       panel.style.left = `${settings.left}px`;
       panel.style.top = `${settings.top}px`;
     };

     const up = () => {
       document.removeEventListener('pointermove', move);
       document.removeEventListener('pointerup', up);
       saveGeometry();
     };

     document.addEventListener('pointermove', move);
     document.addEventListener('pointerup', up);
     event.preventDefault();
   });

   // Zapamiętywanie zmienionego rozmiaru.
   let resizeTimer;

   new ResizeObserver(() => {
     if (!panel.isConnected || settings.hidden) return;

     clearTimeout(resizeTimer);
     resizeTimer = setTimeout(saveGeometry, 250);
   }).observe(panel);

   window.addEventListener('resize', () => {
     applySettings();
     save();
   });

   // The Crew Online — źródło podstawowej listy to odpowiedź klanu Margonem.
   // Implementacja oparta na przesłanym przez użytkownika The Crew Online 3.4.0:
   // PAGE._g('clan&a=members') + Engine.communication.dispatcher.on_members.
   // Lootlog nie jest źródłem listy ani danych graczy w tym module.
   const CLAN_REQUEST_TIMEOUT_MS = 8000;
   const MEMBERS_CACHE_MS = 0; // lista online ma być pobierana na świeżo przy każdym cyklu
   const MEMBER_RECORD_LENGTH = 11;
   let cachedRawMembers = null;
   let cachedMembersAt = 0;
   let pendingMembersRequest = null;
   let hookedDispatcher = null;
   let hookedMembersHandler = null;
   let lastRoster = [];
   let hasRosterSnapshot = false;
   let lastRenderedPlayers = [];

   const normalizeMembersPayload = data => {
     if (Array.isArray(data)) return data.length >= MEMBER_RECORD_LENGTH ? data : null;
     if (!data || typeof data !== 'object') return null;
     if (Array.isArray(data.members)) {
       return data.members.length >= MEMBER_RECORD_LENGTH ? data.members : null;
     }

     // Margonem może przekazać tablicę jako obiekt z kluczami numerycznymi.
     const numericKeys = Object.keys(data).filter(key => /^(0|[1-9]\d*)$/.test(key));
     if (numericKeys.length < MEMBER_RECORD_LENGTH) return null;
     numericKeys.sort((a, b) => Number(a) - Number(b));
     const flattened = numericKeys.map(key => data[key]);
     return flattened.length >= MEMBER_RECORD_LENGTH ? flattened : null;
   };

   const isChatBeingEdited = () => {
     const active = document.activeElement;
     if (!active) return false;
     if (active.isContentEditable) return true;
     if (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
       return !!active.closest('.chat-tpl, .chat, [class*="chat"]');
     }
     return false;
   };

   const getCurrentEngine = () => {
     const engine = PAGE.Engine;
     if (!engine || engine.logOff || !engine.hero?.d) return null;
     if (isChatBeingEdited()) return null;
     return engine;
   };

   const isSamePendingCharacter = pending => {
     const currentEngine = PAGE.Engine;
     const currentHero = currentEngine?.hero?.d;
     if (!currentEngine || currentEngine !== pending.engine || currentEngine.logOff || !currentHero ||
         window.__vicknessShouldPauseAddons?.()) {
       return false;
     }
     const currentId = String(currentHero.id ?? currentHero.nick ?? '');
     return currentId === pending.heroId;
   };

   // Odpowiedź on_members przechwytujemy wyłącznie do odczytu listy.
   // Oryginalny handler jest wywoływany z tym samym this i argumentami.
   // Jedyny wyjątek zgodny z dostarczonym skryptem: odpowiedź naszego żądania
   // nie trafia do handlera UI, jeśli Engine.clan nie istnieje (brak widoku klanu).
   const installMembersHook = () => {
     const dispatcher = PAGE.Engine?.communication?.dispatcher;
     if (!dispatcher || typeof dispatcher.on_members !== 'function') return false;
     if (dispatcher === hookedDispatcher && dispatcher.on_members === hookedMembersHandler) return true;

     const originalOnMembers = dispatcher.on_members;
     const wrappedOnMembers = function(data, ...args) {
       const members = normalizeMembersPayload(data);
       if (members) {
         cachedRawMembers = members;
         cachedMembersAt = Date.now();

         if (pendingMembersRequest) {
           const pending = pendingMembersRequest;
           pendingMembersRequest = null;
           clearTimeout(pending.timeout);

           if (isSamePendingCharacter(pending)) {
             pending.resolve(members);
           } else {
             pending.reject(new Error('Odpowiedź pominięta — postać została przełączona.'));
           }

           // Zachowanie z dostarczonego The Crew Online 3.4.0:
           // nie wywołuj UI handlera dla naszego żądania, jeśli Engine.clan nie istnieje.
           if (!PAGE.Engine?.clan) return;
         }
       }

       return originalOnMembers.call(this, data, ...args);
     };

     try {
       dispatcher.on_members = wrappedOnMembers;
     } catch (error) {
       console.warn('[The Crew] Nie można podpiąć on_members:', error);
       return false;
     }

     if (dispatcher.on_members !== wrappedOnMembers) return false;
     hookedDispatcher = dispatcher;
     hookedMembersHandler = wrappedOnMembers;
     return true;
   };

   // Gdy użytkownik sam otworzył listę klanu, można odczytać ją lokalnie.
   // Nie otwieramy tej zakładki programowo.
   const readMembersFromOpenClan = () => {
     try {
       const clan = PAGE.Engine?.clan;
       if (!clan || typeof clan.getMemberList !== 'function') return null;
       const memberList = clan.getMemberList();
       if (!memberList || typeof memberList !== 'object') return null;
       const records = memberList instanceof Map
         ? [...memberList.values()]
         : Array.isArray(memberList) ? memberList : Object.values(memberList);
       const flattened = [];
       for (const record of records) {
         if (Array.isArray(record) && record.length >= MEMBER_RECORD_LENGTH) {
           flattened.push(...record.slice(0, MEMBER_RECORD_LENGTH));
         }
       }
       return flattened.length >= MEMBER_RECORD_LENGTH ? flattened : null;
     } catch (_) {
       return null;
     }
   };

   const requestMembers = () => {
     const liveRoster = readMembersFromOpenClan();
     if (liveRoster) {
       cachedRawMembers = liveRoster;
       cachedMembersAt = Date.now();
       return Promise.resolve(liveRoster);
     }

     if (cachedRawMembers && Date.now() - cachedMembersAt < MEMBERS_CACHE_MS) {
       return Promise.resolve(cachedRawMembers);
     }
     if (pendingMembersRequest) return pendingMembersRequest.promise;

     const engine = getCurrentEngine();
     if (!engine) {
       return Promise.reject(new Error(
         PAGE.Engine?.logOff
           ? 'Pominięto odświeżanie podczas przelogowania.'
           : isChatBeingEdited()
             ? 'Pominięto odświeżanie podczas pisania na czacie.'
             : 'Oczekiwanie na załadowanie postaci.'
       ));
     }

     if (typeof PAGE._g !== 'function') {
       return Promise.reject(new Error('Funkcja komunikacji Margonem (_g) nie jest dostępna.'));
     }
     if (!installMembersHook()) {
       return Promise.reject(new Error('Oczekiwanie na handler listy członków Margonem.'));
     }

     const hero = engine.hero.d;
     const pending = {
       engine,
       heroId: String(hero.id ?? hero.nick ?? ''),
       timeout: null,
       promise: null,
       resolve: null,
       reject: null
     };

     pending.promise = new Promise((resolve, reject) => {
       pending.resolve = resolve;
       pending.reject = reject;
     });
     pendingMembersRequest = pending;
     pending.timeout = window.setTimeout(() => {
       if (pendingMembersRequest === pending) pendingMembersRequest = null;
       pending.reject(new Error('Margonem nie zwrócił listy członków klanu w ciągu 8 sekund.'));
     }, CLAN_REQUEST_TIMEOUT_MS);

     try {
       // Bez callbacku: odpowiedź odbieramy przez dispatcher.on_members,
       // zgodnie z przesłanym skryptem The Crew Online 3.4.0.
       PAGE._g('clan&a=members');
     } catch (error) {
       if (pendingMembersRequest === pending) pendingMembersRequest = null;
       clearTimeout(pending.timeout);
       pending.reject(error);
     }

     return pending.promise;
   };

   const toFiniteNumber = value => {
     if (value === '' || value === null || value === undefined) return null;
     const number = Number(value);
     return Number.isFinite(number) ? number : null;
   };

   const getPlayers = async () => {
     const rawMembers = await requestMembers();
     if (!Array.isArray(rawMembers) || rawMembers.length < MEMBER_RECORD_LENGTH) {
       throw new Error('Margonem zwrócił niepełną listę członków klanu.');
     }

     const engine = PAGE.Engine;
     const ownNick = String(engine?.hero?.d?.nick || engine?.hero?.d?.name || '')
       .trim().toLocaleLowerCase('pl');
     const roster = [];
     const seen = new Set();

     // Układ rekordu z dostarczonego skryptu: 11 pól.
     // id, nick, poziom, pole techniczne, profesja, mapa, x, y, ranga, status, grafika.
     for (let i = 0; i + (MEMBER_RECORD_LENGTH - 1) < rawMembers.length; i += MEMBER_RECORD_LENGTH) {
       const idValue = rawMembers[i];
       const nick = String(rawMembers[i + 1] ?? '').trim();
       const statusValue = rawMembers[i + 9];
       const online = Number(statusValue) === 0 ||
         String(statusValue).trim().toLowerCase() === 'online' || statusValue === true;

       if (!online || !nick || idValue === null || idValue === undefined) continue;
       if (ownNick && nick.toLocaleLowerCase('pl') === ownNick) continue;

       const id = String(idValue);
       if (seen.has(id)) continue;
       seen.add(id);

       roster.push({
         id,
         nick,
         level: toFiniteNumber(rawMembers[i + 2]),
         profession: String(rawMembers[i + 4] ?? '').trim(),
         map: String(rawMembers[i + 5] ?? '').trim(),
         x: toFiniteNumber(rawMembers[i + 6]),
         y: toFiniteNumber(rawMembers[i + 7]),
         afk: false,
         isOnline: true
       });
     }

     lastRoster = roster;
     hasRosterSnapshot = true;

     // Podświetlanie członków aktualnej drużyny — tylko lokalny odczyt Engine.
     const partyIds = new Set();
     try {
       const partyMembers = PAGE.Engine?.party?.getMembers?.();
       if (partyMembers instanceof Map) {
         for (const [memberId, member] of partyMembers.entries()) {
           if (memberId != null) partyIds.add(String(memberId));
           if (member?.id != null) partyIds.add(String(member.id));
         }
       } else if (Array.isArray(partyMembers)) {
         for (const member of partyMembers) {
           if (member?.id != null) partyIds.add(String(member.id));
         }
       } else if (partyMembers && typeof partyMembers === 'object') {
         for (const [memberId, member] of Object.entries(partyMembers)) {
           partyIds.add(String(memberId));
           if (member?.id != null) partyIds.add(String(member.id));
         }
       }
     } catch (_) {}

     return roster
       .map(player => ({ ...player, isInGroup: partyIds.has(player.id) }))
       .sort((a, b) =>
         (b.level ?? -1) - (a.level ?? -1) ||
         a.nick.localeCompare(b.nick, 'pl')
       );
   };

   // Aktualizuj DOM tylko wtedy, gdy dane rzeczywiście się zmieniły.
   const render = players => {
     const signature = JSON.stringify(players);

     if (signature === render.lastSignature) return;
     render.lastSignature = signature;

     const fragment = document.createDocumentFragment();

     if (!players.length) {
       fragment.append(
         make('div', 'Gra nie zgłasza obecnie członków klanu online.')
       );
     }

     for (const player of players) {
       const row = make('div');
       row.className = player.isInGroup
         ? 'tc-player tc-in-group'
         : 'tc-player';

       const details = make('div');
       const name = make('div', player.nick + (player.afk ? ' (AFK)' : ''));
       name.className = 'tc-name';

       // Zwięzły układ: Nick, poziom+profesja, mapa (x,y).
       const summary = make('div');
       summary.className = 'tc-summary';

       const levelText = player.level != null ? String(player.level) : '—';
       const professionText = player.profession ? String(player.profession) : '';
       const levelProfession = make('span', `${levelText}${professionText}`);
       levelProfession.className = 'tc-summary-level';
       summary.append(levelProfession);

       const separator = make('span', ', ');
       summary.append(separator);

       const hasMap = Boolean(player.map);
       const hasCoords = player.x != null && player.y != null;
       let locationText = '';
       if (hasMap) locationText = player.map;
       else if (hasCoords) locationText = 'Nieznana mapa';
       else locationText = 'Brak pozycji';

       const location = make('span', locationText);
       location.className = hasMap || hasCoords
         ? 'tc-summary-location'
         : 'tc-summary-missing';
       summary.append(location);

       if (hasCoords) {
         summary.append(make('span', ` (${player.x},${player.y})`));
       }

       details.append(name, summary);

       const inviteBtn = make('button', '+');
       inviteBtn.className = 'tc-btn tc-invite';
       inviteBtn.title = `Zaproś ${player.nick} do drużyny`;

       if (!player.id) {
         inviteBtn.disabled = true;
         inviteBtn.title = 'Brak ID postaci w danych gry';
       } else {
         inviteBtn.addEventListener('click', () => {
           inviteBtn.disabled = true;
           inviteBtn.textContent = '…';

           try {
             if (typeof PAGE._g !== 'function') {
               throw new Error(
                 'Mechanizm zaproszeń nie jest dostępny.'
               );
             }

             PAGE._g(
               `party&a=inv&id=${encodeURIComponent(player.id)}`
             );

             status.textContent =
               `Wysłano żądanie zaproszenia dla ${player.nick}. ` +
               'Sprawdź wynik w grze.';
           } catch (error) {
             console.error('[The Crew] Invite error:', error);
             status.textContent =
               `Nie udało się zaprosić ${player.nick}.`;
           } finally {
             setTimeout(() => {
               inviteBtn.disabled = false;
               inviteBtn.textContent = '+';
             }, 3000);
           }
         });
       }

       row.append(details, inviteBtn);
       fragment.append(row);
     }

     list.replaceChildren(fragment);
   };

   let busy = false;
   let refreshTimer = null;
   let crewRetryTimer = null;
   const CREW_READY_RETRY_MS = 1200;
   const CREW_CHAT_RETRY_MS = 2500;

   function isCrewRunnable() {
     // Ukrycie okna nie zatrzymuje odświeżania. Podczas przelogowania
     // wstrzymujemy jednak wszystkie żądania i aktualizacje listy.
     return window.__vicknessAddonEnabled?.crewOnline !== false &&
       document.visibilityState !== 'hidden' &&
       !window.__vicknessShouldPauseAddons?.();
   }

   function isCrewTransientError(error) {
     const message = String(error?.message || error || '').toLowerCase();
     return message.includes('oczekiwanie na załadowanie postaci') ||
       message.includes('pominięto odświeżanie podczas przelogowania') ||
       message.includes('pominięto odświeżanie podczas pisania na czacie') ||
       message.includes('oczekiwanie na handler listy członków') ||
       message.includes('nie jest dostępna') && message.includes('_g');
   }

   function scheduleCrewRetry(delay = CREW_READY_RETRY_MS) {
     if (crewRetryTimer !== null || !isCrewRunnable()) return;
     crewRetryTimer = window.setTimeout(() => {
       crewRetryTimer = null;
       if (isCrewRunnable()) void refresh();
     }, delay);
   }

   function syncCrewRefreshTimer() {
     if (isCrewRunnable()) {
       if (refreshTimer === null) {
         void refresh();
         refreshTimer = window.setInterval(() => { void refresh(); }, REFRESH_MS);
       }
     } else {
       if (refreshTimer !== null) {
         clearInterval(refreshTimer);
         refreshTimer = null;
       }
       if (crewRetryTimer !== null) {
         clearTimeout(crewRetryTimer);
         crewRetryTimer = null;
       }
     }
   }

   const refresh = async () => {
     if (busy || !isCrewRunnable()) return;
     if (crewRetryTimer !== null) {
       clearTimeout(crewRetryTimer);
       crewRetryTimer = null;
     }
     busy = true;

     try {
       const players = await getPlayers();
       if (!isCrewRunnable()) return;

       lastRenderedPlayers = players;
       render(players);

       status.textContent =
         `Online: ${players.length} · ` +
         `Aktualizacja: ${new Date().toLocaleTimeString('pl-PL')}`;
     } catch (error) {
       if (!isCrewRunnable()) return;
       const message = String(error?.message || 'Błąd odczytu listy członków z gry.');

       // Brak Engine/hero w chwili startu i podczas przełączania postaci jest
       // normalnym stanem przejściowym. Nie zalewaj konsoli warningami — ponów próbę.
       if (isCrewTransientError(error)) {
         status.textContent = message;
         const delay = message.toLowerCase().includes('pisania na czacie')
           ? CREW_CHAT_RETRY_MS
           : CREW_READY_RETRY_MS;
         scheduleCrewRetry(delay);
       } else {
         console.warn('[The Crew] Refresh error:', error);
         if (hasRosterSnapshot) {
           render(lastRenderedPlayers.length ? lastRenderedPlayers : lastRoster);
           status.textContent = `Błąd odświeżania — pokazuję ostatnie dane · ${message}`;
         } else {
           status.textContent = message;
         }
         // Dla błędu sieci/timeoutu wykonaj jeszcze jedną próbę przed kolejnym cyklem 10 s.
         scheduleCrewRetry(3000);
       }
     } finally {
       busy = false;
     }
   };

   // F8: ukrywanie i ponowne otwieranie panelu.
   document.addEventListener('keydown', event => {
     if (event.key !== 'F8' || event.repeat) return;

     if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;

     settings.hidden = !settings.hidden;
     applySettings();
     save();
   });

   // Integracja z przełącznikiem i przyciskami w głównym panelu Vickness.
   window.__vicknessApplyCrewOnline = applySettings;
   window.__vicknessCrewOnlineAction = action => {
     if (action === 'show') {
       settings.hidden = false;
       applySettings();
       save();
     } else if (action === 'hide') {
       settings.hidden = true;
       applySettings();
       save();
     } else if (action === 'collapse') {
       settings.collapsed = !settings.collapsed;
       applySettings();
       save();
     } else if (action === 'refresh') {
       void refresh();
     }
   };
   if (window.__vicknessPendingCrewOnlineAction) {
     const pendingAction = window.__vicknessPendingCrewOnlineAction;
     window.__vicknessPendingCrewOnlineAction = null;
     window.__vicknessCrewOnlineAction(pendingAction);
   }

   applySettings();
   document.addEventListener('visibilitychange', syncCrewRefreshTimer);
   // Jawny start timera; jeśli applySettings już go uruchomiło, funkcja niczego nie dubluje.
   syncCrewRefreshTimer();

   window.addEventListener('pagehide', () => {
     if (refreshTimer !== null) clearInterval(refreshTimer);
     refreshTimer = null;
     if (crewRetryTimer !== null) clearTimeout(crewRetryTimer);
     crewRetryTimer = null;
     clearTimeout(resizeTimer);
     document.removeEventListener('visibilitychange', syncCrewRefreshTimer);
   }, { once: true });
 })();

}

// =============================================================
// POSTACIE ONLINE NA PROFILACH — zintegrowane z przełącznikiem Vickness
// =============================================================
(() => {
  'use strict';
  if (window.top !== window.self) return;
  if (!/^(?:www\.)?margonem\.pl$/i.test(location.hostname) || !/\/profile\/view,\d+/i.test(location.pathname)) return;

  const ENABLE_KEY = 'vickness_profileFinderEnabled';
  let cleanupProfileFinder = null;
  let valueListenerId;

  function isEnabled() {
    try { return typeof GM_getValue === 'function' ? GM_getValue(ENABLE_KEY, true) !== false : true; }
    catch (_) { return true; }
  }
  function activate() {
    if (cleanupProfileFinder || !isEnabled()) return;
    cleanupProfileFinder = startProfileFinder();
  }
  function deactivate() {
    if (!cleanupProfileFinder) return;
    try { cleanupProfileFinder(); } catch (error) { console.warn('[Vickness Postacie online]', error); }
    cleanupProfileFinder = null;
  }

  try {
    if (typeof GM_addValueChangeListener === 'function') {
      valueListenerId = GM_addValueChangeListener(ENABLE_KEY, (_key, _oldValue, newValue) => {
        if (newValue === false) deactivate();
        else activate();
      });
    }
  } catch (_) {}

  activate();
  window.addEventListener('pagehide', () => {
    deactivate();
    try { if (valueListenerId !== undefined && typeof GM_removeValueChangeListener === 'function') GM_removeValueChangeListener(valueListenerId); } catch (_) {}
  }, { once: true });

  function startProfileFinder() {

   'use strict';

   if (document.getElementById('mg-player-finder')) return () => {};

   const REFRESH_MS = 30000;
   const CACHE_MS = 30000;
   const TIMEOUT_MS = 4000;
   const MAX_PARALLEL = 8;

   const WORLDS = [
     'luvia','berufs','gefion','majuna','nomada','lupus',
     'riventia','syberia','aether','aldous','brutal','classic',
     'fobos','gordion','hutena','jaruna','katahha','lelwani',
     'perkun','tarhuna','telawel','tempest','zemyna','zorza',
     'alcatraz','arkantes','asylum','ataentsic','badzior',
     'dionizos','dream','elizjum','ertill','eternia','hades',
     'helios','inferno','latimar','legion','mordor','narwhals',
     'navis','nerthus','nexos','nubes','nyras','odysea',
     'orchidea','pandora','regros','solphyr','stark','stoners',
     'thantos','unia','valhalla','whisper'
   ];

   const accountId = location.pathname.match(/profile\/view,(\d+)/i)?.[1];
   const cache = new Map();
   const inFlight = new Map();

   let busy = false;
   let lastSearch = 0;
   let highlighted = null;
   let disposed = false;

   // ---------- WYGLĄD ----------
   const style = document.createElement('style');

   style.textContent = `
     #mg-player-finder {
       position: fixed;
       top: 14px;
       right: 14px;
       z-index: 999999;
       width: 245px;
       max-width: calc(100vw - 28px);
       max-height: 70vh;
       overflow: auto;
       box-sizing: border-box;
       padding: 10px 12px;
       color: #eee5d2;
       background: linear-gradient(145deg, #22232a, #17181e);
       border: 1px solid #9b8050;
       border-radius: 8px;
       box-shadow: 0 4px 16px #0007, inset 0 1px #ffffff0a;
       font: 12px/1.4 Arial, sans-serif;
     }

     #mg-player-finder .head {
       display: flex;
       align-items: center;
       gap: 6px;
       font-size: 13px;
       font-weight: 700;
       color: #f2dfb4;
       margin-bottom: 7px;
       padding-bottom: 6px;
       border-bottom: 1px solid #ffffff18;
     }

     #mg-player-finder .head::before {
       content: "";
       width: 7px;
       height: 7px;
       flex: 0 0 7px;
       border-radius: 50%;
       background: #65e879;
       box-shadow: 0 0 6px #65e87988;
     }

     #mg-player-finder .status {
       color: #c9b991;
       font-size: 11px;
       margin-bottom: 5px;
     }

     #mg-player-finder .nick {
       color: #8fe9a0;
       font-size: 15px;
       font-weight: 700;
       overflow-wrap: anywhere;
       line-height: 1.3;
     }

     #mg-player-finder .details {
       margin-top: 3px;
       color: #e4ded1;
       font-size: 12px;
     }

     #mg-player-finder .muted {
       color: #98979a;
       font-size: 10px;
       margin-top: 6px;
     }

     #mg-player-finder button {
       display: block;
       width: 100%;
       margin-top: 8px;
       padding: 6px 8px;
       color: #f1e5ca;
       background: linear-gradient(#454047, #302d34);
       border: 1px solid #77684f;
       border-radius: 5px;
       font: 11px Arial, sans-serif;
       cursor: pointer;
       transition: background 150ms ease, border-color 150ms ease;
     }

     #mg-player-finder button:hover {
       background: linear-gradient(#5a5042, #3b342b);
       border-color: #c6a76c;
     }

     /* Jedna zewnętrzna ramka i zielone zacienienie całej karty */
     .mg-pf-highlight {
       position: relative !important;
       box-sizing: border-box !important;
       outline: none !important;
       border: 3px solid #65e879 !important;
       border-radius: 7px !important;
       background: rgba(47, 160, 65, 0.42) !important;
       box-shadow:
         inset 0 0 18px rgba(65, 255, 95, 0.28),
         0 0 12px rgba(65, 255, 95, 0.45) !important;
       z-index: 2;
     }

     .mg-pf-highlight::after {
       content: "ONLINE";
       position: absolute;
       top: 4px;
       right: 5px;
       padding: 2px 5px;
       border: 1px solid #a6edac;
       border-radius: 4px;
       background: #176b36;
       color: #f2fff3;
       font: bold 9px/1.2 Arial, sans-serif;
       letter-spacing: .4px;
       box-shadow: 0 1px 3px #0005;
       pointer-events: none;
     }
   `;

   document.head.appendChild(style);

   // ---------- PANEL ----------
   const panel = document.createElement('aside');
   panel.id = 'mg-player-finder';

   panel.innerHTML = `
     <div class="head">Margonem — gdzie gra gracz?</div>
     <div class="status">Odczytuję profil…</div>
     <div class="result"></div>
     <div class="muted">Światy z profilu · odświeżanie co 30 s</div>
     <button type="button">Szukaj ponownie</button>
   `;

   document.body.appendChild(panel);

   const statusEl = panel.querySelector('.status');
   const resultEl = panel.querySelector('.result');
   const button = panel.querySelector('button');

   // ---------- ŚWIATY Z PROFILU ----------
   function getProfileWorlds() {
     const text = document.body.innerText || '';
     const found = new Set();

     for (const match of text.matchAll(/Świat:\s*([^\r\n]+)/gi)) {
       const value = match[1].trim().toLowerCase();

       for (const world of WORLDS) {
         if (
           value === world ||
           value.split(/[\s,;/|]+/).includes(world)
         ) {
           found.add(world);
         }
       }
     }

     const hash = location.hash.match(/#char_\d+,([a-z0-9_-]+)/i);

     if (hash) {
       const world = hash[1].toLowerCase();
       if (WORLDS.includes(world)) found.add(world);
     }

     return [...found];
   }

   // ---------- POBIERANIE DANYCH ----------
   function fetchWorld(world) {
     const cached = cache.get(world);

     if (cached && Date.now() - cached.time < CACHE_MS) {
       return Promise.resolve(cached.data);
     }

     if (inFlight.has(world)) return inFlight.get(world);

     const promise = new Promise(resolve => {
       let finished = false;
       let request;

       const timer = setTimeout(() => {
         try { request?.abort(); } catch {}
         finish(null);
       }, TIMEOUT_MS + 300);

       function finish(data) {
         if (finished) return;
         finished = true;
         clearTimeout(timer);
         resolve(data);
       }

       try {
         request = GM_xmlhttpRequest({
           method: 'GET',
           url: `https://staticinfo.margonem.pl/online/${encodeURIComponent(world)}.json`,
           timeout: TIMEOUT_MS,

           onload(response) {
             try {
               if (response.status < 200 || response.status >= 300) {
                 finish(null);
                 return;
               }

               const data = JSON.parse(response.responseText);

               if (!Array.isArray(data)) {
                 finish(null);
                 return;
               }

               cache.set(world, { time: Date.now(), data });
               finish(data);
             } catch {
               finish(null);
             }
           },

           onerror() { finish(null); },
           ontimeout() { finish(null); }
         });
       } catch {
         finish(null);
       }
     }).finally(() => inFlight.delete(world));

     inFlight.set(world, promise);
     return promise;
   }

   // ---------- PODŚWIETLANIE KARTY ----------
   function clearHighlight() {
     if (highlighted) {
       highlighted.classList.remove('mg-pf-highlight');
       highlighted = null;
     }
   }

   function highlightCharacter(name, world) {
     clearHighlight();

     if (!name || !world) return;

     const candidates = [...document.querySelectorAll('body *')]
       .filter(el => {
         if (panel.contains(el) || el.children.length > 8) return false;

         const text = (el.innerText || '').trim();

         if (!text || text.length > 350) return false;

         return text.includes(name) &&
           new RegExp(`Świat:\\s*${world}\\b`, 'i').test(text);
       })
       .sort((a, b) => a.innerText.length - b.innerText.length);

     if (candidates.length) {
       highlighted = candidates[0];
       highlighted.classList.add('mg-pf-highlight');
     }
   }

   // ---------- WYNIK ----------
   function showCharacter(character, world) {
     resultEl.replaceChildren();

     const nick = document.createElement('div');
     nick.className = 'nick';
     nick.textContent = character.n || 'Nieznany nick';

     const details = document.createElement('div');
     details.className = 'details';
     details.textContent = `Poziom ${character.l ?? '?'} · ${world}`;

     resultEl.append(nick, details);
     highlightCharacter(character.n, world);
   }

   // ---------- WYSZUKIWANIE ----------
   async function search(force = false) {
     if (busy || disposed) return;

     if (!force && Date.now() - lastSearch < REFRESH_MS) return;

     busy = true;
     lastSearch = Date.now();
     clearHighlight();
     resultEl.replaceChildren();

     try {
       if (!accountId) {
         statusEl.textContent = 'Nie udało się odczytać ID profilu.';
         return;
       }

       const worlds = getProfileWorlds();

       if (!worlds.length) {
         statusEl.textContent = 'Nie znaleziono światów na profilu.';
         return;
       }

       statusEl.textContent = `Sprawdzam ${worlds.length} światów…`;

       const found = [];
       let next = 0;
       let completed = 0;
       let failed = 0;

       async function worker() {
         while (next < worlds.length) {
           const world = worlds[next++];

           try {
             const data = await fetchWorld(world);
             if (disposed) return;

             if (data === null) {
               failed++;
             } else {
               const match = data.find(
                 character => String(character.a) === String(accountId)
               );

               if (match) {
                 found.push({ character: match, world });

                 // Pokazuj pierwsze trafienie bez czekania na resztę.
                 if (found.length === 1) {
                   showCharacter(match, world);
                   statusEl.textContent = 'Znaleziono postać online.';
                 }
               }
             }
           } catch {
             failed++;
           }

           completed++;

           if (!found.length) {
             statusEl.textContent =
               `Sprawdzono ${completed}/${worlds.length} światów…`;
           }
         }
       }

       await Promise.all(
         Array.from(
           { length: Math.min(MAX_PARALLEL, worlds.length) },
           () => worker()
         )
       );
       if (disposed) return;

       if (!found.length) {
         statusEl.textContent = failed === worlds.length
           ? 'Nie udało się pobrać list online.'
           : 'Nie znaleziono postaci online.';
       } else {
         showCharacter(found[0].character, found[0].world);
         statusEl.textContent = 'Znaleziono postać online.';
       }
     } catch (error) {
       statusEl.textContent = 'Błąd wyszukiwania.';
       console.error('[Margonem Finder]', error);
     } finally {
       busy = false;
     }
   }

   button.addEventListener('click', () => search(true));

    search();
    const refreshTimer = window.setInterval(() => search(), REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(refreshTimer);
      clearHighlight();
      panel.remove();
      style.remove();
    };
  
  }
})();

// =============================================================
// WRÓG NA MAPIE 2.8.1 — stabilizacja odczytu graczy i audio
// Ważne: silnik Margonem odczytujemy z unsafeWindow, bo główny userscript
// ma uprawnienia GM_* i działa w izolowanym świecie Tampermonkey.
// =============================================================
(() => {
  'use strict';
  if (location.hostname !== 'riventia.margonem.pl' || window.top !== window.self) return;
  if (window.__vicknessWnmModuleStarted) return;
  window.__vicknessWnmModuleStarted = true;

  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const STORAGE_KEY = 'wnm_settings_v25';
  const DEFAULTS = {
    enabled: true,
    noClan: true,
    enemies: true,
    soundChoice: '1',
    textColor: '#ff3333',
    alertDuration: 5000
  };
  const SCAN_INTERVAL_MS = 1200;
  const SOUND_IDS = {
    '1': '01a18d43-edb0-7064-b23c-7f21fe743a9f',
    '2': '01a18d61-318b-70ab-bca5-4870dee36b96',
    '3': '01a18d61-3187-7016-8f92-a3b493ed7433',
    '4': '01a18d61-318c-7311-812a-dde178534917',
    '5': 'zUxgyvfvc9K4AMGvcwSFor1r0EP8vgmU'
  };

  let settings = loadSettings();
  let scanTimer = null;
  let alertTimer = null;
  let currentMap = null;
  let currentAlert = null;
  let alertQueue = [];
  let alerted = new Set();
  let alertBox = null;
  let running = false;
  let audio = null;
  let lastDiagnostics = {
    running: false, engineReady: false, playerCount: 0,
    resolvedCount: 0, eligibleCount: 0, mapId: null,
    lastScanAt: 0, message: 'Oczekiwanie na silnik gry…'
  };
  let lastReportedState = '';

  function loadSettings() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch (_) {
      return { ...DEFAULTS };
    }
  }
  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) {}
  }
  function getEngine() {
    // Margonem udostępnia Engine w kontekście strony, nie w sandboxie GM_*.
    try {
      if (typeof PAGE.getEngine === 'function') {
        const fromGetter = PAGE.getEngine.call(PAGE);
        if (fromGetter) return fromGetter;
      }
    } catch (_) {}
    try {
      if (PAGE.Engine) return PAGE.Engine;
    } catch (_) {}
    try {
      if (typeof window.getEngine === 'function') {
        const fromGetter = window.getEngine();
        if (fromGetter) return fromGetter;
      }
    } catch (_) {}
    return window.Engine || null;
  }
  function getMapId(engine) {
    try {
      return String(engine?.map?.d?.id ?? engine?.map?.d?.name ?? engine?.map?.id ?? 'unknown');
    } catch (_) { return 'unknown'; }
  }
  function soundCandidates(choice) {
    const id = SOUND_IDS[String(choice)];
    if (!id) return [];
    // Najpierw użyj dokładnego adresu z oryginalnego skryptu 2.7;
    // wariant .mp3 pozostaje zapasowy dla zmienionego formatu JukeHost.
    return [
      `https://audio.jukehost.co.uk/${id}`,
      `https://audio.jukehost.co.uk/${id}.mp3`
    ];
  }
  function mediaErrorMessage(player) {
    const code = player?.error?.code;
    const descriptions = {
      1: 'odtwarzanie przerwane',
      2: 'błąd sieci lub niedostępny plik',
      3: 'nie udało się zdekodować nagrania',
      4: 'format lub adres nagrania jest nieobsługiwany'
    };
    return descriptions[code] || 'nieznany błąd odtwarzacza';
  }
  async function tryPlayUrl(url) {
    // Element audio tworzony bezpośrednio w dokumencie jest stabilniejszy
    // niż konstruktor Audio pobrany z proxy unsafeWindow Tampermonkey.
    const player = document.createElement('audio');
    if (!player || typeof player.play !== 'function') {
      throw new Error('Przeglądarka nie udostępnia elementu audio.');
    }
    player.preload = 'auto';
    player.volume = 1;
    audio = player;

    await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        finishReject(new Error('Przekroczono czas oczekiwania na rozpoczęcie nagrania (12 s).'));
      }, 12000);

      const finishResolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      const finishReject = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      player.addEventListener('error', () => {
        const detail = mediaErrorMessage(player);
        const error = new Error(`JukeHost: ${detail} (${url})`);
        error.mediaError = player.error?.code || 0;
        if (settled) {
          console.warn('[Wróg na mapie] Błąd strumienia audio:', error.message);
        } else {
          finishReject(error);
        }
      });
      player.addEventListener('playing', finishResolve, { once: true });

      try {
        player.src = url;
        player.load();
        const result = player.play();
        if (result && typeof result.then === 'function') {
          result.then(finishResolve).catch(finishReject);
        } else if (player.readyState >= 2) {
          finishResolve();
        }
      } catch (error) {
        finishReject(error);
      }
    });
    return player;
  }
  async function playSound() {
    const choice = String(settings.soundChoice ?? '1');
    if (choice === 'none') return { status: 'muted' };
    const candidates = soundCandidates(choice);
    if (!candidates.length) {
      return { status: 'failed', reason: `Nieznany wybór dźwięku: ${choice}` };
    }

    if (audio) {
      try { audio.pause(); audio.currentTime = 0; } catch (_) {}
      audio = null;
    }

    let lastError = null;
    for (let i = 0; i < candidates.length; i++) {
      try {
        const player = await tryPlayUrl(candidates[i]);
        player.addEventListener('ended', () => {
          if (audio === player) audio = null;
        }, { once: true });
        player.addEventListener('error', () => {
          if (audio === player) audio = null;
          console.warn('[Wróg na mapie] Błąd strumienia audio:', candidates[i]);
        }, { once: true });
        console.info('[Wróg na mapie] Uruchomiono dźwięk:', `dzwonek ${choice}`, candidates[i]);
        return { status: 'played', source: candidates[i], variant: i === 0 ? 'mp3' : 'legacy' };
      } catch (error) {
        lastError = error;
        if (audio) {
          try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (_) {}
          audio = null;
        }
        // Blokada autoplay nie zależy od adresu — nie ma sensu próbować drugiego URL.
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') break;
      }
    }
    const reason = lastError?.name === 'NotAllowedError'
      ? 'Przeglądarka zablokowała odtwarzanie. Kliknij TESTUJ DŹWIĘK bezpośrednio w panelu gry.'
      : (lastError?.message || 'Nie udało się pobrać ani odtworzyć oryginalnego pliku z JukeHost.');
    console.warn('[Wróg na mapie] Nie udało się odtworzyć dźwięku:', lastError);
    return { status: 'failed', reason };
  }
  function getDistance(engine, other) {
    try {
      const hero = engine?.hero?.d;
      const target = other?.d || other;
      if (!hero || !target) return null;
      const dx = Number(hero.x) - Number(target.x);
      const dy = Number(hero.y) - Number(target.y);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
      return Math.round(Math.sqrt(dx * dx + dy * dy));
    } catch (_) { return null; }
  }
  function getPlayerList(engine) {
    try {
      const holder = engine?.whoIsHere;
      let list = null;
      try {
        if (typeof holder?.getList === 'function') list = holder.getList();
      } catch (_) {}
      const isEmpty = value => !value ||
        (Array.isArray(value) && value.length === 0) ||
        (value instanceof Map && value.size === 0) ||
        (!Array.isArray(value) && !(value instanceof Map) && typeof value === 'object' && Object.keys(value).length === 0);
      if (isEmpty(list)) {
        if (holder?.list && typeof holder.list === 'object') list = holder.list;
      }
      if (isEmpty(list)) return [];

      const arrayList = Array.isArray(list);
      const keyedCollection = list instanceof Map || (!arrayList && typeof list === 'object');
      let entries;
      if (list instanceof Map) entries = [...list.entries()];
      else if (arrayList) entries = list.map((value, index) => [String(index), value]);
      else if (typeof list === 'object') entries = Object.entries(list);
      else return [];

      return entries.map(([key, value]) => {
        if (value && typeof value === 'object') {
          if (value.id != null || value.playerId != null || value.d?.id != null) return value;
          // W tablicy indeks nie jest ID postaci — pozostawiamy obiekt bez zmian.
          if (arrayList) return value;
          return { ...value, id: key };
        }
        // Tablica może przechowywać ID; obiekt/mapa może mapować ID jako klucz
        // i flagę/tekst jako wartość.
        const id = value == null || typeof value === 'boolean'
          ? (keyedCollection ? key : value)
          : value;
        return id == null ? null : ({ id });
      }).filter(Boolean);
    } catch (error) {
      console.debug('[Wróg na mapie] Nie udało się odczytać whoIsHere:', error);
      return [];
    }
  }
  function getPlayerId(player) {
    return player?.id ?? player?.d?.id ?? player?.playerId ?? null;
  }
  function getOther(engine, player) {
    const id = getPlayerId(player);
    if (id == null) return player?.d ? player : null;
    const others = engine?.others;
    try {
      if (typeof others?.getById === 'function') {
        const found = others.getById(Number(id)) || others.getById(String(id));
        if (found) return found;
      }
    } catch (_) {}
    try {
      if (typeof others?.get === 'function') {
        const found = others.get(id) || others.get(String(id));
        if (found) return found;
      }
    } catch (_) {}
    try {
      const found = others?.[id] || others?.list?.[id] || others?.d?.[id];
      if (found && typeof found === 'object') return found;
    } catch (_) {}
    return player?.d ? player : null;
  }
  function normalizeRelation(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[ _]+/g, '-');
  }
  function isEnemy(player, other) {
    const relations = [
      player?.relation, player?.relationName, player?.relationType, player?.rel,
      player?.d?.relation, other?.relation, other?.relationName,
      other?.relationType, other?.d?.relation
    ].map(normalizeRelation);
    return relations.some(value => value.includes('enemy') || value.includes('wróg'));
  }
  function isWithoutClan(player, other) {
    const candidates = [
      other?.d?.clan, other?.d?.clan_id, other?.clan, other?.clanId,
      player?.d?.clan, player?.d?.clan_id, player?.clan, player?.clanId
    ];
    const clan = candidates.find(value => value !== undefined);
    if (clan && typeof clan === 'object') {
      return !(clan.id || clan.clanId || clan.name);
    }
    return clan == null || clan === '' || clan === 0 || clan === '0' || clan === false;
  }
  function shouldAlert(player, other) {
    if (!settings.enabled) return false;
    const noClan = settings.noClan && isWithoutClan(player, other);
    const enemy = settings.enemies && isEnemy(player, other);
    return noClan || enemy;
  }
  function getAlertKey(player) {
    return String(getPlayerId(player) ?? player?.nick ?? player?.d?.nick ?? 'unknown');
  }
  function makeAlert(player, other, engine) {
    const distance = getDistance(engine, other);
    const data = other?.d || other || {};
    const nick = String(player?.nick || player?.d?.nick || player?.name || data.nick || data.name || 'Nieznany');
    const level = player?.lvl ?? player?.d?.lvl ?? data.lvl ?? data.level ?? '?';
    return {
      key: getAlertKey(player),
      text: `${nick} ${level}m`,
      distanceText: distance === null ? 'Odległość nieznana' : `${distance} kratek`
    };
  }
  function emitDiagnostics(patch = {}, force = false) {
    lastDiagnostics = { ...lastDiagnostics, ...patch, running };
    const state = [
      lastDiagnostics.running, lastDiagnostics.engineReady,
      lastDiagnostics.playerCount, lastDiagnostics.resolvedCount,
      lastDiagnostics.eligibleCount, lastDiagnostics.message
    ].join('|');
    if (!force && state === lastReportedState) return;
    lastReportedState = state;
    console.info(
      '[Wróg na mapie] Diagnostyka:',
      lastDiagnostics.message,
      `silnik=${lastDiagnostics.engineReady ? 'OK' : 'oczekiwanie'}`,
      `gracze=${lastDiagnostics.playerCount}`,
      `dopasowani=${lastDiagnostics.resolvedCount}`,
      `kandydaci=${lastDiagnostics.eligibleCount}`
    );
    try {
      window.dispatchEvent(new CustomEvent('vickness-wnm-status', { detail: { ...lastDiagnostics } }));
    } catch (_) {}
  }
  function ensureAlertBox() {
    if (alertBox?.isConnected) return;
    alertBox = document.createElement('div');
    alertBox.id = 'wnm-alert';
    Object.assign(alertBox.style, {
      position: 'fixed', top: '45%', left: '50%', transform: 'translate(-50%, -50%)',
      zIndex: '2147483647', display: 'none', textAlign: 'center',
      fontFamily: 'Arial,sans-serif', fontSize: '25px', fontWeight: 'bold',
      lineHeight: '1.5', textShadow: '2px 2px 4px #000,-1px -1px 2px #000',
      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', pointerEvents: 'auto'
    });
    alertBox.addEventListener('click', () => { hideAlert(); processAlertQueue(); });
    (document.body || document.documentElement).appendChild(alertBox);
  }
  function hideAlert() {
    clearTimeout(alertTimer);
    alertTimer = null;
    currentAlert = null;
    if (alertBox) alertBox.style.display = 'none';
  }
  function showAlert(data, options = {}) {
    ensureAlertBox();
    currentAlert = data;
    alertBox.replaceChildren();
    const name = document.createElement('div');
    name.className = 'wnm-alert-name';
    name.textContent = data.text;
    const distance = document.createElement('div');
    distance.className = 'wnm-alert-distance';
    distance.textContent = data.distanceText;
    distance.style.fontSize = '19px';
    alertBox.append(name, distance);
    alertBox.style.color = /^#[0-9a-f]{6}$/i.test(settings.textColor) ? settings.textColor : '#ff3333';
    alertBox.style.display = 'block';
    if (options.sound !== false) void playSound();
    clearTimeout(alertTimer);
    alertTimer = window.setTimeout(() => { hideAlert(); processAlertQueue(); }, Math.max(1000, Number(settings.alertDuration) || 5000));
  }
  function processAlertQueue() {
    if (currentAlert || !alertQueue.length || !running) return;
    showAlert(alertQueue.shift());
  }
  function scanPlayers() {
    if (!running || document.visibilityState === 'hidden') return;
    const engine = getEngine();
    if (!engine) {
      emitDiagnostics({ engineReady: false, playerCount: 0, resolvedCount: 0, eligibleCount: 0, lastScanAt: Date.now(), message: 'Oczekiwanie na silnik Margonem…' });
      return;
    }
    if (!engine.whoIsHere || !engine.others) {
      emitDiagnostics({ engineReady: false, playerCount: 0, resolvedCount: 0, eligibleCount: 0, mapId: getMapId(engine), lastScanAt: Date.now(), message: 'Silnik jest uruchomiony, oczekiwanie na listę graczy…' });
      return;
    }
    const mapId = getMapId(engine);
    if (currentMap === null) currentMap = mapId;
    else if (currentMap !== mapId) {
      currentMap = mapId;
      alerted.clear();
      alertQueue = [];
      hideAlert();
    }

    const players = getPlayerList(engine);
    const eligibleNow = new Set();
    let resolvedCount = 0;
    let eligibleCount = 0;
    for (const player of players) {
      if (!player) continue;
      const id = getPlayerId(player);
      if (id == null) continue;
      const other = getOther(engine, player);
      if (!other) continue;
      resolvedCount++;
      if (!shouldAlert(player, other)) continue;
      const key = getAlertKey(player);
      eligibleNow.add(key);
      eligibleCount++;
      if (alerted.has(key)) continue;
      alerted.add(key);
      alertQueue.push(makeAlert(player, other, engine));
    }
    // Ponowne wejście gracza na mapę może wygenerować nowy alarm.
    for (const key of [...alerted]) {
      if (!eligibleNow.has(key)) alerted.delete(key);
    }
    emitDiagnostics({
      engineReady: true, playerCount: players.length, resolvedCount,
      eligibleCount, mapId, lastScanAt: Date.now(),
      message: players.length > 0 && resolvedCount === 0
        ? `Lista ma ${players.length} wpisów, ale nie udało się dopasować graczy w Engine.others.`
        : eligibleCount
          ? `Skan aktywny · gracze: ${players.length} · kandydaci alarmu: ${eligibleCount}`
          : `Skan aktywny · gracze: ${players.length} · brak podejrzanych`
    });
    processAlertQueue();
  }
  function syncScanTimer() {
    const shouldScan = running && document.visibilityState !== 'hidden';
    if (!shouldScan) {
      if (scanTimer) window.clearInterval(scanTimer);
      scanTimer = null;
      emitDiagnostics({ message: running ? 'Pauza — karta działa w tle.' : 'Dodatek wyłączony.' }, true);
      return;
    }
    if (scanTimer === null) {
      scanPlayers();
      scanTimer = window.setInterval(scanPlayers, SCAN_INTERVAL_MS);
    }
  }
  function start() {
    if (running) return;
    running = true;
    settings.enabled = true;
    saveSettings();
    ensureAlertBox();
    emitDiagnostics({ message: 'Uruchamianie wykrywania…' }, true);
    syncScanTimer();
    console.info('[Wróg na mapie] Uruchomiono wersję 2.8.');
  }
  function stop() {
    if (!running && !scanTimer) return;
    running = false;
    if (scanTimer) window.clearInterval(scanTimer);
    scanTimer = null;
    alertQueue = [];
    alerted.clear();
    hideAlert();
    if (alertBox) { alertBox.remove(); alertBox = null; }
    if (audio) { try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (_) {} audio = null; }
    settings.enabled = false;
    saveSettings();
    emitDiagnostics({ message: 'Dodatek wyłączony.' }, true);
  }
  function setEnabled(value) {
    const shouldRun = !!value;
    if (shouldRun === running) return;
    if (shouldRun) start(); else stop();
  }
  function testAlert() {
    alertQueue = [];
    hideAlert();
    showAlert({ key: 'test', text: 'TEST — WRÓG NA MAPIE', distanceText: 'Przykładowy alarm · 12 kratek' }, { sound: false });
    return true;
  }
  async function testSound() {
    return await playSound();
  }

  window.__vicknessSetWnmEnabled = setEnabled;
  window.__vicknessWnmAPI = {
    playSound, testSound, testAlert,
    getDiagnostics: () => ({ ...lastDiagnostics, running }),
    updateSettings: () => {
      settings = loadSettings();
      settings.enabled = running;
      if (currentAlert && alertBox) alertBox.style.color = settings.textColor;
    }
  };
  window.addEventListener('vickness-wnm-settings-change', () => {
    settings = loadSettings();
    settings.enabled = running;
    if (currentAlert && alertBox) alertBox.style.color = settings.textColor;
  });
  document.addEventListener('visibilitychange', syncScanTimer);
  window.addEventListener('pagehide', () => {
    stop();
    document.removeEventListener('visibilitychange', syncScanTimer);
    delete window.__vicknessSetWnmEnabled;
    delete window.__vicknessWnmAPI;
  }, { once: true });

  setEnabled(window.__vicknessAddonEnabled?.wnm !== false);
})();

// =============================================================
// KOLORY RANG LOOTLOGA NA CZACIE — zintegrowane z Vickness Addons
// Rdzeń kolorowania zintegrowany z panelem; aura z Lootlog Nick Colors 2.8.0.
// =============================================================
(() => {
  'use strict';
  if (location.hostname !== 'riventia.margonem.pl' || window.top !== window.self) return;
  if (window.__vicknessRankChatModuleStarted) return;
  window.__vicknessRankChatModuleStarted = true;

  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const GUILD_ID = '1384811864235704372';
  const WORLD = 'riventia';
  const TARGET_NICK = 'Piekielna Wika';
  const MANUAL_ACCOUNT_IDS = ['7239525'];
  const MANUAL_ACCOUNT_DISCORD_IDS = { '7239525': '606168243232833566' };
  const MEMBERS_URL = `https://api.lootlog.pl/guilds/${GUILD_ID}/members?includeInactive=true`;
  const PROFILE_URL = id => `https://www.margonem.pl/profile/view,${encodeURIComponent(id)}`;
  const CACHE_KEY = 'riventia_lootlog_cache_v24';
  const LEGACY_CACHE_KEY = 'riventia_nick_cache_v23';
  const ONLINE_CHECK_INTERVAL = 5 * 60 * 1000;
  const MEMBERS_REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
  const GATEWAY_RETRIES = 8;
  const GATEWAY_RETRY_DELAY = 3000;
  const PROFILE_RETRIES = 3;
  const PROFILE_RETRY_DELAY = 2500;
  const REQUEST_TIMEOUT_MS = 30000;
  const TICK_MS = 5000;
  const RETRY_DELAY_MS = 30000;
  const AUTHOR_SELECTOR = 'span.author-section, span.hero-name-nick';

  let cache = {};
  try {
    const stored = typeof GM_getValue === 'function' ? GM_getValue(CACHE_KEY, null) : null;
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) cache = stored;
  } catch (error) {
    console.warn('[Vickness Rank Colors] Nie udało się odczytać cache v24:', error);
  }
  if (!cache.accounts || typeof cache.accounts !== 'object' || Array.isArray(cache.accounts)) cache.accounts = {};
  if (!cache.memberColors || typeof cache.memberColors !== 'object' || Array.isArray(cache.memberColors)) cache.memberColors = {};
  if (!cache.lastMembersRefresh && cache.lastFullRefresh) cache.lastMembersRefresh = cache.lastFullRefresh;

  // Jednorazowa migracja profili z wcześniejszego klucza pamięci.
  if (Object.keys(cache.accounts).length === 0) {
    try {
      const legacy = typeof GM_getValue === 'function' ? GM_getValue(LEGACY_CACHE_KEY, {}) : {};
      if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
        for (const [accountId, item] of Object.entries(legacy)) {
          if (!item || !Array.isArray(item.names)) continue;
          cache.accounts[String(accountId)] = {
            names: item.names,
            color: item.color || null,
            updatedAt: Number(item.updatedAt) || 0,
            discordId: item.discordId ? String(item.discordId) : null
          };
        }
      }
    } catch (error) {
      console.warn('[Vickness Rank Colors] Nie udało się przenieść starszego cache:', error);
    }
  }

  let active = false;
  let loading = false;
  let refreshTimer = null;
  let observer = null;
  let observerTimer = null;
  let pendingAuthors = new Set();
  let lastPlayerRefresh = 0;
  let nextRetryAt = 0;
  let nickColors = new Map();
  let sortedNickNames = [];
  let lastColorLog = '';
  let targetDiagnosticLogged = false;
  const activeRequests = new Set();

  const log = (...args) => console.info('[Vickness Rank Colors]', ...args);
  const status = message => {
    const element = document.getElementById('vxRankChatStatus');
    if (element) element.textContent = message;
    window.__vicknessRankChatLastStatus = message;
  };
  const normalize = value => String(value || '').replace(/\u00a0/g, ' ').trim().replace(/:+\s*$/, '').replace(/\s+/g, ' ').toLocaleLowerCase('pl');
  const normalizeAuthor = value => normalize(value).replace(/^\[[^\]]+\]\s*/, '').trim();
  const sleep = ms => new Promise(resolve => window.setTimeout(resolve, ms));

  function saveCache() {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(CACHE_KEY, cache);
    } catch (error) {
      console.warn('[Vickness Rank Colors] Błąd zapisu cache:', error);
    }
  }

  function request(url) {
    return new Promise((resolve, reject) => {
      if (!active) { reject(new Error('Dodatek jest wyłączony.')); return; }
      if (typeof GM_xmlhttpRequest !== 'function') { reject(new Error('GM_xmlhttpRequest nie jest dostępny.')); return; }
      let finished = false;
      let handle = null;
      const finish = (callback, value) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        if (handle) activeRequests.delete(handle);
        callback(value);
      };
      const timeout = window.setTimeout(() => {
        try { handle?.abort?.(); } catch (_) {}
        finish(reject, new Error('Przekroczono limit czasu żądania.'));
      }, REQUEST_TIMEOUT_MS + 250);
      try {
        handle = GM_xmlhttpRequest({
          method: 'GET', url, withCredentials: true, timeout: REQUEST_TIMEOUT_MS,
          onload: response => {
            if (response.status < 200 || response.status >= 300) { finish(reject, new Error(`HTTP ${response.status}`)); return; }
            finish(resolve, response.responseText);
          },
          onerror: () => finish(reject, new Error('Błąd żądania sieciowego.')),
          ontimeout: () => finish(reject, new Error('Timeout żądania.')),
          onabort: () => finish(reject, new Error('Żądanie anulowane.'))
        });
        if (!finished && handle) activeRequests.add(handle);
      } catch (error) { finish(reject, error); }
    });
  }

  async function requestWithRetry(url, retries, delay) {
    let lastError;
    for (let attempt = 1; attempt <= retries && active; attempt++) {
      try { return await request(url); }
      catch (error) {
        lastError = error;
        log(`Błąd pobierania (${attempt}/${retries}):`, error?.message || error);
        if (attempt < retries && active) await sleep(delay * attempt);
      }
    }
    throw lastError || new Error('Dodatek został wyłączony.');
  }

  function toHex(color) {
    if (typeof color === 'string') {
      const value = color.trim();
      if (/^#[0-9a-f]{6}$/i.test(value)) return value;
      if (/^[0-9a-f]{6}$/i.test(value)) return `#${value}`;
      color = Number(value);
    }
    if (!Number.isFinite(color) || color < 0) return null;
    return '#' + Math.min(0xffffff, Math.floor(color)).toString(16).padStart(6, '0');
  }

  function getMemberColor(member) {
    const roles = Array.isArray(member?.roles) ? member.roles : [];
    const coloredRoles = roles.map(role => ({ position: Number(role.position) || 0, color: toHex(role.color) }))
      .filter(role => role.color).sort((a, b) => b.position - a.position);
    return coloredRoles[0]?.color || null;
  }

  async function refreshMemberColors(force = false) {
    if (window.__vicknessShouldPauseAddons?.()) return false;
    const lastRefresh = Number(cache.lastMembersRefresh) || 0;
    const diagnosticRefreshNeeded = cache.diagnosticRefreshDone !== true;
    if (!force && !diagnosticRefreshNeeded && lastRefresh && Date.now() - lastRefresh < MEMBERS_REFRESH_INTERVAL) return false;
    if (!active) throw new Error('Dodatek został wyłączony.');
    log('Odświeżam kolory rang gildii…');
    const members = JSON.parse(await requestWithRetry(MEMBERS_URL, 3, 2000));
    if (!Array.isArray(members)) throw new Error('Nieprawidłowa lista członków gildii.');
    const newColors = {};
    for (const member of members) {
      if (!member?.userId) continue;
      const color = getMemberColor(member);
      if (color) newColors[String(member.userId)] = color;
    }
    if (!active) return false;
    cache.memberColors = newColors;
    cache.lastMembersRefresh = Date.now();
    cache.diagnosticRefreshDone = true;
    for (const account of Object.values(cache.accounts)) {
      if (!account?.discordId) continue;
      const color = newColors[String(account.discordId)];
      if (color) account.color = color;
    }
    saveCache(); rebuildNickColors(); applyAllColors();
    log(`Zaktualizowano kolory ${Object.keys(newColors).length} członków.`);
    return true;
  }

  async function getLootlogApi() {
    const deadline = Date.now() + 60000;
    while (active && Date.now() < deadline) {
      const api = page.lootlogGameClientApi;
      if (api?.ready && typeof api.getOnlinePlayers === 'function') return api;
      await sleep(1000);
    }
    if (!active) throw new Error('Dodatek został wyłączony.');
    throw new Error('Lootlog Game Client API niedostępne.');
  }

  async function getOnlineAccounts() {
    const api = await getLootlogApi();
    let lastError;
    for (let attempt = 1; attempt <= GATEWAY_RETRIES && active; attempt++) {
      try {
        const response = await api.getOnlinePlayers({ guildId: GUILD_ID, world: WORLD });
        if (!response || response.status !== 'success') throw new Error('Nie udało się pobrać graczy online.');
        const accounts = new Map();
        for (const [discordId, sessions] of Object.entries(response.players || {})) {
          const list = Array.isArray(sessions) ? sessions : [sessions];
          for (const session of list) {
            const accountId = session?.player?.accountId;
            if (accountId) accounts.set(String(accountId), String(discordId));
          }
        }
        log(`Pobrano konta online: ${accounts.size}.`);
        return accounts;
      } catch (error) {
        lastError = error;
        log(`Gateway (${attempt}/${GATEWAY_RETRIES}):`, error?.message || error);
        if (attempt < GATEWAY_RETRIES && active) await sleep(GATEWAY_RETRY_DELAY);
      }
    }
    throw new Error(`Gateway nie odpowiedział: ${lastError?.message || 'brak odpowiedzi'}`);
  }

  async function getAccountCharacters(accountId) {
    const html = await requestWithRetry(PROFILE_URL(accountId), PROFILE_RETRIES, PROFILE_RETRY_DELAY);
    if (!active) throw new Error('Dodatek został wyłączony.');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let rows = [...doc.querySelectorAll('.character-list .char-row')];
    if (!rows.length) rows = [...doc.querySelectorAll('[data-nick][data-world]')];
    const names = [];
    for (const row of rows) {
      const world = String(row.dataset.world || '').replace(/^#/, '').trim().toLowerCase();
      const nick = String(row.dataset.nick || '').trim();
      if (world === WORLD && nick) names.push(nick);
    }
    const uniqueNames = [...new Set(names)];
    if (uniqueNames.some(name => normalize(name) === normalize(TARGET_NICK)) && !targetDiagnosticLogged) {
      targetDiagnosticLogged = true;
      log(`ZNALEZIONO ${TARGET_NICK.toUpperCase()} W PROFILU:`, accountId, uniqueNames);
    }
    log('Profil konta:', accountId, 'Postacie na świecie:', uniqueNames);
    return uniqueNames;
  }

  function rebuildNickColors() {
    const next = new Map();
    for (const account of Object.values(cache.accounts)) {
      if (!account || !Array.isArray(account.names)) continue;
      const currentColor = account.discordId ? cache.memberColors[String(account.discordId)] : null;
      const color = toHex(currentColor || account.color);
      if (!color) continue;
      for (const nick of account.names) {
        const key = normalize(nick);
        if (key) next.set(key, color);
      }
    }
    nickColors = next;
    sortedNickNames = [...next.keys()].sort((a, b) => b.length - a.length);
  }

  function findColor(authorText) {
    const text = normalizeAuthor(authorText);
    if (!text) return null;
    if (nickColors.has(text)) return nickColors.get(text);
    for (const nick of sortedNickNames) {
      if (text === nick || text.endsWith(' ' + nick) || text.endsWith(']' + nick)) return nickColors.get(nick);
      const doubledNick = nick + nick.slice(-1);
      if (text === doubledNick || text.endsWith(' ' + doubledNick) || text.endsWith(']' + doubledNick)) return nickColors.get(nick);
    }
    return null;
  }

  function restoreAuthor(author) {
    if (!author?.dataset?.vxRankChatApplied) return;
    const original = author.dataset.vxRankChatOriginalColor || '';
    const priority = author.dataset.vxRankChatOriginalPriority || '';
    if (original) author.style.setProperty('color', original, priority);
    else author.style.removeProperty('color');
    delete author.dataset.vxRankChatApplied;
    delete author.dataset.vxRankChatColor;
    delete author.dataset.vxRankChatOriginalColor;
    delete author.dataset.vxRankChatOriginalPriority;
  }

  function applyAuthor(author) {
    if (!author?.matches?.(AUTHOR_SELECTOR)) return;
    const color = findColor(author.textContent);
    if (!color) { restoreAuthor(author); return; }
    if (!author.dataset.vxRankChatApplied) {
      author.dataset.vxRankChatOriginalColor = author.style.getPropertyValue('color');
      author.dataset.vxRankChatOriginalPriority = author.style.getPropertyPriority('color');
      author.dataset.vxRankChatApplied = '1';
    }
    if (author.dataset.vxRankChatColor !== color) {
      author.style.setProperty('color', color, 'important');
      author.dataset.vxRankChatColor = color;
    }
  }

  function applyAllColors() {
    if (!active || !nickColors.size) return;
    document.querySelectorAll(AUTHOR_SELECTOR).forEach(applyAuthor);
  }

  function collectAuthors(node, set) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement?.closest?.(AUTHOR_SELECTOR);
      if (parent) set.add(parent);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches?.(AUTHOR_SELECTOR)) set.add(node);
    const parent = node.parentElement?.closest?.(AUTHOR_SELECTOR);
    if (parent) set.add(parent);
    node.querySelectorAll?.(AUTHOR_SELECTOR).forEach(author => set.add(author));
  }

  function scheduleAuthors(authors) {
    for (const author of authors) pendingAuthors.add(author);
    if (observerTimer) return;
    observerTimer = window.setTimeout(() => {
      observerTimer = null;
      const batch = [...pendingAuthors];
      pendingAuthors.clear();
      if (!active) return;
      for (const author of batch) if (author.isConnected) applyAuthor(author);
    }, 100);
  }

  function startObserver() {
    if (observer || !document.body || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(records => {
      if (!active) return;
      const authors = new Set();
      for (const record of records) {
        if (record.type === 'characterData' || record.type === 'attributes') collectAuthors(record.target, authors);
        else {
          collectAuthors(record.target, authors);
          record.addedNodes.forEach(node => collectAuthors(node, authors));
        }
      }
      if (authors.size) scheduleAuthors(authors);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  }

  async function checkManualAccounts() {
    for (const accountId of MANUAL_ACCOUNT_IDS) {
      if (!active) return;
      const manualDiscordId = MANUAL_ACCOUNT_DISCORD_IDS[accountId] || null;
      const cached = cache.accounts[accountId];
      if (cached) {
        cached.discordId = manualDiscordId;
        const cachedColor = manualDiscordId ? cache.memberColors[String(manualDiscordId)] : null;
        if (cachedColor) cached.color = cachedColor;
      }
      if (cached && Array.isArray(cached.names) && cached.names.length > 0) continue;
      try {
        log('Pobieram ręczne konto (niezależnie od online):', accountId);
        const names = await getAccountCharacters(accountId);
        if (!active) return;
        const color = manualDiscordId ? cache.memberColors[String(manualDiscordId)] || null : null;
        cache.accounts[accountId] = { ...(cached || {}), discordId: manualDiscordId, color, names, updatedAt: Date.now(), manual: true };
        saveCache();
        log('Zapisano ręczne konto:', accountId, 'Postacie:', names, 'Discord ID:', manualDiscordId || 'NIEUSTALONE', 'Kolor:', color || 'OCZEKUJE NA KOLOR RANGI');
      } catch (error) {
        log('Błąd pobierania ręcznego konta:', accountId, error?.message || error);
      }
    }
    for (const accountId of MANUAL_ACCOUNT_IDS) {
      const account = cache.accounts[accountId];
      if (!account) continue;
      const discordId = MANUAL_ACCOUNT_DISCORD_IDS[accountId];
      if (!discordId) continue;
      account.discordId = discordId;
      const color = cache.memberColors[String(discordId)];
      if (color) account.color = color;
    }
    saveCache(); rebuildNickColors(); applyAllColors();
  }

  async function checkForNewAccounts() {
    await checkManualAccounts();
    if (!active) return { onlineAccounts: 0, newAccounts: 0, failedProfiles: 0 };
    let onlineAccounts;
    try { onlineAccounts = await getOnlineAccounts(); }
    catch (error) {
      log('Nie udało się pobrać listy online. Konta ręczne zostały sprawdzone:', error?.message || error);
      rebuildNickColors(); applyAllColors();
      return { onlineAccounts: 0, newAccounts: 0, failedProfiles: 0 };
    }
    let newAccounts = 0, failedProfiles = 0, retriedProfiles = 0;
    for (const [accountId, discordId] of onlineAccounts) {
      if (!active) break;
      const cached = cache.accounts[accountId];
      if (cached && Array.isArray(cached.names) && cached.names.length > 0) {
        cached.discordId = discordId;
        const currentColor = cache.memberColors[String(discordId)];
        if (currentColor) cached.color = currentColor;
        continue;
      }
      try {
        if (cached) { retriedProfiles++; log(`Ponawiam pobieranie profilu konta ${accountId}…`); }
        else log(`Nowe konto ${accountId}. Pobieram postacie…`);
        const names = await getAccountCharacters(accountId);
        if (!active) break;
        const color = cache.memberColors[String(discordId)] || null;
        cache.accounts[accountId] = { discordId, color, names, updatedAt: Date.now() };
        saveCache();
        if (names.length > 0) { newAccounts++; log(`Zapisano konto ${accountId}: ${names.length} postaci.`); }
      } catch (error) {
        failedProfiles++;
        cache.accounts[accountId] = { ...(cache.accounts[accountId] || {}), discordId, names: [], lastErrorAt: Date.now() };
        saveCache();
        log(`Nie udało się pobrać profilu ${accountId}:`, error?.message || error);
      }
    }
    if (!active) return { onlineAccounts: onlineAccounts.size, newAccounts, failedProfiles };
    const targetInCache = Object.entries(cache.accounts).filter(([, account]) => (account.names || []).some(name => normalize(name) === normalize(TARGET_NICK)));
    log(`Wynik wyszukiwania ${TARGET_NICK} w cache:`, targetInCache.length ? targetInCache : 'NIE ZNALEZIONO');
    saveCache(); rebuildNickColors(); applyAllColors();
    log(`Sprawdzanie zakończone. Nowe konta: ${newAccounts}, ponowione profile: ${retriedProfiles}, błędy profili: ${failedProfiles}.`);
    return { onlineAccounts: onlineAccounts.size, newAccounts, failedProfiles };
  }

  async function refreshNow(force = false) {
    if (window.__vicknessShouldPauseAddons?.()) { status('Wstrzymano odświeżanie na czas przelogowania.'); return false; }
    if (!active) { status('Dodatek jest wyłączony. Włącz go przełącznikiem w panelu.'); return false; }
    if (loading) { status('Synchronizacja już trwa…'); return false; }
    if (!force && Date.now() < nextRetryAt) return false;
    loading = true;
    status('Pobieram kolory rang, konta online i konto ręczne…');
    let roleError = null;
    let accountResult = null;
    try {
      try { await refreshMemberColors(force); }
      catch (error) { roleError = error; log('Nie udało się odświeżyć rang; zostawiam zapisane kolory:', error?.message || error); }
      if (!active) return false;
      accountResult = await checkForNewAccounts();
      if (!active) return false;
      lastPlayerRefresh = Date.now();
      nextRetryAt = 0;
      rebuildNickColors(); applyAllColors();
      const count = nickColors.size;
      const onlineCount = accountResult?.onlineAccounts || 0;
      const message = roleError
        ? `Kolory: ${count} postaci · konta online: ${onlineCount} · błąd rang: ${roleError.message}`
        : `Kolory: ${count} postaci · konta online: ${onlineCount} · synchronizacja ${new Date().toLocaleTimeString('pl-PL')}`;
      status(message);
      return true;
    } catch (error) {
      if (active) {
        nextRetryAt = Date.now() + RETRY_DELAY_MS;
        status(`Błąd synchronizacji: ${error?.message || 'nieznany błąd'}. Ponowię próbę automatycznie.`);
        console.warn('[Vickness Rank Colors] Błąd synchronizacji:', error);
      }
      return false;
    } finally { loading = false; }
  }

  async function tick() {
    if (!active || document.visibilityState === 'hidden' || loading || Date.now() < nextRetryAt) return;
    const now = Date.now();
    const lastMembersRefresh = Number(cache.lastMembersRefresh) || 0;
    if (!lastMembersRefresh || now - lastMembersRefresh >= MEMBERS_REFRESH_INTERVAL) await refreshNow(false);
    else if (!lastPlayerRefresh || now - lastPlayerRefresh >= ONLINE_CHECK_INTERVAL) await refreshNow(false);
  }

  function clearAppliedColors() {
    document.querySelectorAll(`${AUTHOR_SELECTOR}[data-vxRankChatApplied="1"]`).forEach(restoreAuthor);
  }


  // Stała neonowa aura pod postaciami członków gildii (Lootlog Nick Colors 2.8.0).
  const auraWrapped = new WeakSet();
  let auraTimer = null;

  function getAuraColor(character) {
    const data = character?.d || {};
    const accountId = String(data.account ?? character?.account ?? '');
    const account = cache.accounts[accountId];

    if (account) {
      const discordId = account.discordId;
      const guildColor = discordId ? cache.memberColors[String(discordId)] : null;
      const color = guildColor || account.color;
      if (color && /^#[0-9a-f]{6}$/i.test(color)) return color;
    }

    const nick = data.nick || character?.nick;
    return nick ? findColor(nick) : null;
  }

  function drawNeonAura(ctx, character, color) {
    if (!ctx || typeof ctx.save !== 'function') return;
    const engine = page.getEngine?.() || page.Engine;
    const map = engine?.map;
    const mapShift = engine?.mapShift;
    if (!map || !mapShift || typeof mapShift.getShift !== 'function') return;

    const shift = mapShift.getShift();
    const rx = Number(character.rx ?? character.d?.x);
    const ry = Number(character.ry ?? character.d?.y);
    const fw = Number(character.fw) || 32;
    const fh = Number(character.fh) || 48;
    const halfFw = Number(character.halffw) || fw / 2;
    if (!Number.isFinite(rx) || !Number.isFinite(ry)) return;

    const screenX = Math.round(
      rx * 32 + 16 - halfFw + (character.ofsetX ?? 0) -
      (map.offset?.[0] || 0) - shift[0] +
      (character.leftPosMod === undefined ? 0 : character.leftPosMod)
    );
    const screenY = Math.round(
      ry * 32 - fh + 32 - (map.offset?.[1] || 0) - shift[1]
    );

    const match = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!match) return;
    const rgb = match.slice(1).map(value => parseInt(value, 16));
    const centerX = screenX + fw / 2;
    const centerY = screenY + fh - 3;
    const radiusX = 23;
    const radiusY = 11;

    ctx.save();
    try {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.95;
      ctx.shadowColor = color;
      ctx.shadowBlur = 28;
      const gradient = ctx.createRadialGradient(centerX, centerY, 1, centerX, centerY, radiusX);
      gradient.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
      gradient.addColorStop(0.25, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)`);
      gradient.addColorStop(0.6, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.65)`);
      gradient.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.fill();
    } catch (_) {
      // Efekt nie może zatrzymać renderowania postaci.
    } finally {
      ctx.restore();
    }
  }

  function wrapCharacterForAura(character) {
    if (!character || auraWrapped.has(character) || typeof character.drawIcon !== 'function') return;
    const originalDrawIcon = character.drawIcon;
    character.drawIcon = function(ctx, ...args) {
      if (active) {
        const color = getAuraColor(this);
        if (color) drawNeonAura(ctx, this, color);
      }
      return originalDrawIcon.call(this, ctx, ...args);
    };
    auraWrapped.add(character);
  }

  function installAuraOnCharacters() {
    if (!active) return;
    const engine = page.getEngine?.() || page.Engine;
    if (!engine) return;
    if (engine.hero) wrapCharacterForAura(engine.hero);

    const manager = engine.others;
    if (!manager || typeof manager.getDrawableList !== 'function') return;
    let objects;
    try { objects = manager.getDrawableList(); } catch (_) { return; }
    if (!Array.isArray(objects)) return;

    for (const character of objects) {
      if (!character) continue;
      const data = character.d || {};
      if (character.isPlayer === true || data.isPlayer === true) {
        wrapCharacterForAura(character);
      }
    }
  }

  function startAura() {
    installAuraOnCharacters();
    if (!auraTimer) auraTimer = window.setInterval(installAuraOnCharacters, 1000);
  }

  function stopAura() {
    if (auraTimer) window.clearInterval(auraTimer);
    auraTimer = null;
  }

  function stop() {
    if (!active) { status('WYŁĄCZONY'); return; }
    active = false;
    stopAura();
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = null;
    if (observer) observer.disconnect();
    observer = null;
    if (observerTimer) window.clearTimeout(observerTimer);
    observerTimer = null;
    pendingAuthors.clear();
    for (const handle of activeRequests) { try { handle.abort?.(); } catch (_) {} }
    activeRequests.clear();
    clearAppliedColors();
    status('WYŁĄCZONY');
  }

  function start() {
    if (active) return;
    active = true;
    rebuildNickColors(); applyAllColors(); startObserver(); startAura();
    refreshTimer = window.setInterval(tick, TICK_MS);
    status(nickColors.size ? `Aktywny · zapisane kolory: ${nickColors.size} · synchronizacja…` : 'Aktywny · pobieram pierwszą listę rang…');
    void refreshNow(false);
  }

  function setEnabled(value) { if (value) start(); else stop(); }
  function onVisibilityChange() {
    if (!active) return;
    if (document.visibilityState === 'visible') { applyAllColors(); void tick(); }
  }

  window.__vicknessRankChatSetEnabled = setEnabled;
  window.__vicknessRankChatAPI = {
    refreshNow: () => refreshNow(true),
    getStatus: () => window.__vicknessRankChatLastStatus || ''
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', () => {
    stop();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    delete window.__vicknessRankChatSetEnabled;
    delete window.__vicknessRankChatAPI;
  }, { once: true });

  setEnabled(window.__vicknessAddonEnabled?.rankChat !== false);
  if (window.__vicknessPendingRankChatRefresh) {
    window.__vicknessPendingRankChatRefresh = false;
    if (active) void refreshNow(true);
  }
})();

// Moduł kolorowania przedmiotów na czacie wyłączony — nie może dotykać
// mechanizmu podpowiedzi ani danych przedmiotów w interfejsie gry.

// =============================================================
// KOLOROWANIE PRZEDMIOTÓW NA CZACIE — zintegrowany dodatek panelu
// =============================================================
(() => {
    'use strict';
    if (location.hostname !== 'riventia.margonem.pl') return;
    const PAGE_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (PAGE_WINDOW.__vicknessItemChatModuleStarted) return;

    const COLORS = {
        legendary: { color: '#ff3333', glow: 'rgba(255, 30, 30, 0.45)' },
        heroic:    { color: '#3399ff', glow: 'rgba(40, 130, 255, 0.45)' },
        unique:    { color: '#ffd700', glow: 'rgba(255, 205, 0, 0.45)' },
        common:    { color: '#666666', glow: 'rgba(130, 130, 130, 0.20)' },
        upgraded:  { color: '#40e0d0', glow: 'rgba(40, 230, 210, 0.45)' }
    };

    let $ = null;
    let active = false;
    let observer = null;
    let retryTimer = null;
    const scheduled = new WeakSet();
    const hiddenTips = new WeakSet();
    const timers = new Map();

    // Oryginalny mechanizm 3.4.1: blokuj tipShow wyłącznie dla
    // linku przedmiotu, którego dane są właśnie pobierane.
    if (PAGE_WINDOW.jQuery?.fn?.tipShow && !PAGE_WINDOW.jQuery.fn.tipShow.__vicknessWrapped) {
        const originalTipShow = PAGE_WINDOW.jQuery.fn.tipShow;
        const wrappedTipShow = function (...args) {
            if (this[0] && hiddenTips.has(this[0])) return this;
            return originalTipShow.apply(this, args);
        };
        wrappedTipShow.__vicknessWrapped = true;
        PAGE_WINDOW.jQuery.fn.tipShow = wrappedTipShow;
    }

    function install() {
        $ = PAGE_WINDOW.jQuery;
        if (!$ || !$.fn) return false;
        return true;
    }

    function getRarity(item) {
        if (!item) return null;
        let rarity = null;
        try {
            rarity = typeof item.getItemStat === 'function' ? item.getItemStat('rarity') : null;
        } catch (_) {}
        if (!rarity && typeof item.stat === 'string') {
            const match = item.stat.match(/(?:^|;)rarity=([^;]*)/i);
            if (match) rarity = match[1];
        }
        rarity = String(rarity || '').toLowerCase().trim();
        return Object.prototype.hasOwnProperty.call(COLORS, rarity) ? rarity : null;
    }

    function colorNameOnly(el, rarity) {
        let wrapper = el.querySelector(':scope > .vickness-item-chat-name');
        if (!wrapper) {
            const textNodes = Array.from(el.childNodes).filter(
                node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
            );
            if (textNodes.length) {
                wrapper = document.createElement('span');
                wrapper.className = 'vickness-item-chat-name';
                for (const node of textNodes) wrapper.appendChild(node);
                el.insertBefore(wrapper, el.firstChild);
            } else {
                const textContainer = el.querySelector('span, b, strong');
                if (!textContainer || !textContainer.textContent.trim()) return false;
                wrapper = textContainer;
                wrapper.dataset.vicknessItemChatName = '1';
            }
        }
        const style = COLORS[rarity];
        wrapper.style.setProperty('color', style.color, 'important');
        wrapper.style.setProperty('-webkit-text-fill-color', style.color, 'important');
        wrapper.style.setProperty('text-shadow', `0 0 2px ${style.glow}`, 'important');
        return true;
    }

    function colorItem(el) {
        if (!$) return false;
        const item = $(el).data('item');
        if (!item) return false;
        const rarity = getRarity(item);
        if (!rarity || !colorNameOnly(el, rarity)) return false;
        el.dataset.vicknessItemChatRarity = rarity;
        return true;
    }

    function loadItem(el) {
        const node = $(el);
        node.triggerHandler('mouseenter');
        node.triggerHandler('mouseout');
    }

    function clearTimer(el) {
        const timer = timers.get(el);
        if (timer) window.clearInterval(timer);
        timers.delete(el);
    }

    function processItem(el) {
        if (!active || !(el instanceof HTMLElement) || !el.matches('.linked-chat-item') || scheduled.has(el)) return;
        scheduled.add(el);
        hiddenTips.add(el);

        window.setTimeout(() => {
            if (!active || !el.isConnected) {
                scheduled.delete(el);
                hiddenTips.delete(el);
                return;
            }
            if (colorItem(el)) {
                hiddenTips.delete(el);
                return;
            }
            try { loadItem(el); }
            catch (error) { console.warn('[Vickness Item Chat] Nie udało się załadować danych przedmiotu:', error); }

            let attempts = 0;
            let loadAttempts = 0;
            const timer = window.setInterval(() => {
                attempts++;
                if (!active || !el.isConnected) {
                    clearTimer(el);
                    scheduled.delete(el);
                    hiddenTips.delete(el);
                    return;
                }
                if (colorItem(el)) {
                    clearTimer(el);
                    hiddenTips.delete(el);
                    return;
                }
                if (attempts % 20 === 0 && loadAttempts < 5) {
                    loadAttempts++;
                    try { loadItem(el); }
                    catch (error) { console.warn('[Vickness Item Chat] Błąd ponownego ładowania przedmiotu:', error); }
                }
                if (attempts >= 200) {
                    clearTimer(el);
                    hiddenTips.delete(el);
                }
            }, 10);
            timers.set(el, timer);
        }, 0);
    }

    function scan(root) {
        if (!active || !(root instanceof Element)) return;
        if (root.matches('.linked-chat-item')) processItem(root);
        root.querySelectorAll('.linked-chat-item').forEach(processItem);
    }

    function start() {
        if (active || !$) return;
        active = true;
        if (document.body) scan(document.body);
        observer = new MutationObserver(records => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node instanceof Element) scan(node);
                }
            }
        });
        if (document.body) observer.observe(document.body, { childList: true, subtree: true });
        console.log('[Vickness Item Chat] Aktywny — obserwuję przedmioty na czacie.');
    }

    function stop() {
        if (!active) return;
        active = false;
        observer?.disconnect();
        observer = null;
        for (const timer of timers.values()) window.clearInterval(timer);
        timers.clear();
        document.querySelectorAll('.linked-chat-item').forEach(el => {
            scheduled.delete(el);
            if (!el.dataset.vicknessItemChatRarity) return;
            const wrapper = el.querySelector(':scope > .vickness-item-chat-name');
            if (wrapper) {
                while (wrapper.firstChild) el.insertBefore(wrapper.firstChild, wrapper);
                wrapper.remove();
            }
            const nested = el.querySelector('[data-vickness-item-chat-name="1"]');
            if (nested) {
                nested.style.removeProperty('color');
                nested.style.removeProperty('-webkit-text-fill-color');
                nested.style.removeProperty('text-shadow');
                delete nested.dataset.vicknessItemChatName;
            }
            delete el.dataset.vicknessItemChatRarity;
        });
        console.log('[Vickness Item Chat] Wyłączony.');
    }

    function setEnabled(value) {
        if (value) start();
        else stop();
    }

    function waitForJQuery() {
        if (retryTimer) return;
        retryTimer = window.setInterval(() => {
            if (!install()) return;
            window.clearInterval(retryTimer);
            retryTimer = null;
            window.__vicknessItemChatModuleStarted = true;
            PAGE_WINDOW.__vicknessItemChatModuleStarted = true;
            window.__vicknessItemChatSetEnabled = setEnabled;
            PAGE_WINDOW.__vicknessItemChatSetEnabled = setEnabled;
            setEnabled(window.__vicknessAddonEnabled?.itemChat !== false);
        }, 500);
    }

    const publicSetEnabled = value => {
        if (value && !$ && !install()) {
            waitForJQuery();
            return;
        }
        setEnabled(value);
    };
    window.__vicknessItemChatSetEnabled = publicSetEnabled;
    PAGE_WINDOW.__vicknessItemChatSetEnabled = publicSetEnabled;

    window.addEventListener('pagehide', () => {
        stop();
        if (retryTimer) window.clearInterval(retryTimer);
        delete window.__vicknessItemChatSetEnabled;
        delete window.__vicknessItemChatModuleStarted;
        delete PAGE_WINDOW.__vicknessItemChatSetEnabled;
        delete PAGE_WINDOW.__vicknessItemChatModuleStarted;
    }, { once: true });

    if (install()) {
        window.__vicknessItemChatModuleStarted = true;
        PAGE_WINDOW.__vicknessItemChatModuleStarted = true;
        window.__vicknessItemChatSetEnabled = publicSetEnabled;
        PAGE_WINDOW.__vicknessItemChatSetEnabled = publicSetEnabled;
        setEnabled(window.__vicknessAddonEnabled?.itemChat !== false);
    } else {
        waitForJQuery();
    }
})();
