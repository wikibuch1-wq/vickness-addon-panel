// ==UserScript==
// @name         Vickness Addon Panel - Standalone
// @namespace    Vickness
// @version      1.1.33
// @description  Vickness Addons: motywy, przyciemnienie mapy, Titan Tracker 5.0.2 i The Crew Online 3.4.0
// @match        https://riventia.margonem.pl/*
// @match        http://riventia.margonem.pl/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @updateURL     https://raw.githubusercontent.com/wikibuch1-wq/vickness-addon-panel/main/userscript/vickness-addon-panel.user.js
// @downloadURL   https://raw.githubusercontent.com/wikibuch1-wq/vickness-addon-panel/main/userscript/vickness-addon-panel.user.js
// @connect      discord.com
// @connect      discordapp.com
// @connect      micc.garmory-cdn.cloud
// @connect      api.lootlog.pl
// @connect      lootlog.pl
// @connect      www.margonem.pl
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Wspólny stan przełączników dostępny dla obu wbudowanych dodatków.
window.__vicknessAddonEnabled = window.__vicknessAddonEnabled || { loot: true, dc: true, lootlog: true, titan: true, lootChance: true, crewOnline: true };

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
    const SCAN_INTERVAL = 1500;

    const SPECIAL_NPCS = new Set([
        'ogromna płomiennica tląca',
        'ogromny bulwiak pospolity',
        'ogromny mroźlarz',
        'ogromna dzwonkówka tarczowata',
        'ogromny szpicak ponury'
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
            #margDc221Panel {
                position:fixed;
                left:20px;
                top:120px;
                width:280px;
                z-index:2147483647;
                color:#fff;
                background:rgba(12,12,12,.97);
                border:2px solid #d4af37;
                border-radius:9px;
                box-shadow:0 5px 20px rgba(0,0,0,.65);
                font:12px Arial,sans-serif;
                user-select:none;
            }

            #margDc221Header {
                height:32px;
                padding:0 8px;
                display:flex;
                align-items:center;
                justify-content:space-between;
                background:#191919;
                border-radius:7px 7px 0 0;
                cursor:move;
            }

            #margDc221Title {
                color:#d4af37;
                font-size:13px;
                font-weight:bold;
            }

            #margDc221Min {
                background:transparent;
                border:0;
                color:#aaa;
                cursor:pointer;
            }

            #margDc221Body {
                padding:9px;
            }

            #margDc221Webhook {
                width:100%;
                height:30px;
                box-sizing:border-box;
                background:#181818;
                color:#fff;
                border:1px solid #444;
                border-radius:5px;
                padding:5px 7px;
                font-size:11px;
            }

            #margDc221Buttons {
                display:flex;
                gap:5px;
                margin-top:7px;
            }

            .margDc221Btn {
                flex:1;
                height:29px;
                background:#222;
                color:#fff;
                border:1px solid #555;
                border-radius:5px;
                cursor:pointer;
                font-size:10px;
            }

            .margDc221Gold {
                border-color:#d4af37;
                color:#d4af37;
            }

            #margDc221Status {
                margin-top:8px;
                min-height:38px;
                padding:7px;
                background:#171717;
                border-radius:5px;
                line-height:1.4;
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
            if (activePopup && !activePopup.isConnected) {
                hideAfterDeath();
            }

            for (const [key, element] of handled) {
                if (!element || !element.isConnected) {
                    handled.delete(key);
                }
            }
        }, 1000);
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
            if (registered) {
                clearInterval(timer);
                return;
            }

            tries++;
            const API = getLootAPI();

            if (API && typeof API.addCallbackToEvent === 'function') {
                try {
                    API.addCallbackToEvent('loot_update', data => {
                        if (window.__vicknessAddonEnabled && !window.__vicknessAddonEnabled.loot) return;

                        const states = data && data.states && typeof data.states === 'object'
                            ? data.states
                            : {};
                        const ids = Object.keys(states);

                        if (!ids.length) return;

                        ids.forEach(id => {
                            setTimeout(() => {
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
// VICKNESS ADDON PANEL 1.1.31 — przyciemnienie mapy widoczne od razu w zakładce Wygląd
// =============================================================
(() => {
  'use strict';
  if (location.hostname !== 'riventia.margonem.pl' || window.top !== window.self) return;
  if (window.__vicknessStandaloneManagerStarted) return;
  window.__vicknessStandaloneManagerStarted = true;

  const KEY = 'vickness_addon_panel_layout_v2';
  const FLAGS_KEY = 'vickness_addon_enabled_v1';
  const enabled = window.__vicknessAddonEnabled || (window.__vicknessAddonEnabled = { loot: true, dc: true, lootlog: true, titan: true, lootChance: true, crewOnline: true });
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
  } catch (_) { if (typeof enabled.lootlog !== 'boolean') enabled.lootlog = true; if (typeof enabled.titan !== 'boolean') enabled.titan = true; if (typeof enabled.crewOnline !== 'boolean') enabled.crewOnline = true; }
  if (typeof enabled.lootlog !== 'boolean') enabled.lootlog = true;
  if (typeof enabled.titan !== 'boolean') enabled.titan = true;
  if (typeof enabled.lootChance !== 'boolean') enabled.lootChance = true;
  if (typeof enabled.crewOnline !== 'boolean') enabled.crewOnline = true;
  let layout = {};
  try { layout = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) {}

  const PANEL_BASE_WIDTH = 520;
  const PANEL_BASE_HEIGHT = 420;
  let currentPanelScale = 1;
  const baseFontSizes = new WeakMap();
  // Po wykryciu NPC panel DC odpinamy z widoku ustawień i pokazujemy jako samodzielne okno.
  let dcWindowDetached = false;

  function saveFlags() { try { localStorage.setItem(FLAGS_KEY, JSON.stringify(enabled)); } catch (_) {} }
  function saveLayout() { try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch (_) {} }

  // Złote przyciemnienie mapy: ustawienia pozostają zgodne z samodzielnym dodatkiem v6.
  const PAGE_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const MAP_DIMMER_KEYS = { amount: 'margonemDimAmount', enabled: 'margonemDimEnabled' };
  const storedDimmerAmount = localStorage.getItem(MAP_DIMMER_KEYS.amount);
  let mapDimmerAmount = storedDimmerAmount === null
    ? 50
    : Math.max(0, Math.min(100, Number(storedDimmerAmount) || 0));
  let mapDimmerEnabled = localStorage.getItem(MAP_DIMMER_KEYS.enabled) !== '0';
  let lastMapDimmerEngine = null;
  let lastMapDimmerMap = null;
  let lastMapDimmerMapId = null;
  let lastMapDimmerApplyTime = 0;
  let mapDimmerMonitorStarted = false;

  function applyMapDimmer(force = false) {
    const engine = PAGE_WINDOW.Engine || window.Engine;
    if (!engine?.canvasFilter || !engine?.map) return false;
    const mapId = engine.map.getId?.() ?? engine.map.d?.id ?? null;
    const changed = engine !== lastMapDimmerEngine || engine.map !== lastMapDimmerMap || mapId !== lastMapDimmerMapId;
    if (!force && !changed && Date.now() - lastMapDimmerApplyTime < 2000) return true;
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
      lastMapDimmerApplyTime = Date.now();
      return true;
    } catch (error) {
      console.warn('[Vickness — Złote przyciemnienie mapy]', error);
      return false;
    }
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
    applyMapDimmer(true);
  }

  function setMapDimmerEnabled(value) {
    mapDimmerEnabled = Boolean(value);
    try { localStorage.setItem(MAP_DIMMER_KEYS.enabled, mapDimmerEnabled ? '1' : '0'); } catch (_) {}
    syncMapDimmerControls();
    applyMapDimmer(true);
  }

  function startMapDimmerMonitor() {
    if (mapDimmerMonitorStarted) return;
    mapDimmerMonitorStarted = true;
    applyMapDimmer(true);
    // Nie obserwujemy całego DOM — lekki polling wykrywa zmianę silnika lub mapy.
    setInterval(() => {
      const engine = PAGE_WINDOW.Engine || window.Engine;
      if (!engine?.canvasFilter || !engine?.map) return;
      const mapId = engine.map.getId?.() ?? engine.map.d?.id ?? null;
      if (engine !== lastMapDimmerEngine || engine.map !== lastMapDimmerMap || mapId !== lastMapDimmerMapId) {
        applyMapDimmer(true);
      }
    }, 350);
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
    if (home) home.classList.toggle('vxNarrow', rect.width < 470);
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
    #vxStandalonePanel { position:fixed; z-index:2147483646; left:20px; top:20px; display:flex; flex-direction:column; width:min(520px,calc(100vw - 20px)); height:min(420px,calc(100vh - 16px)); min-width:390px; min-height:300px; max-width:calc(100vw - 12px); max-height:calc(100vh - 12px); resize:both; overflow:hidden; background:rgba(8,8,8,.88); color:#eee; border:1px solid #c9a227; border-radius:8px; box-shadow:0 8px 26px #000b; font:12px Arial,sans-serif; backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }
    #vxStandalonePanel * { box-sizing:border-box; }
    #vxStandaloneHeader { position:relative; flex:0 0 auto; padding:9px 35px 8px 10px; text-align:center; background:rgba(16,16,16,.92); border-bottom:1px solid #765b20; cursor:move; user-select:none; }
    #vxStandaloneBrand { color:#dfb943; font-size:16px; font-weight:bold; letter-spacing:2px; }
    #vxStandaloneMin { position:absolute; right:7px; top:7px; border:1px solid #806321; border-radius:4px; background:rgba(23,20,12,.9); color:#dfb943; cursor:pointer; }
    .vxView { padding:8px; }
    #vxWorkspace { display:flex; flex:1 1 0%; min-height:0; min-width:0; overflow:hidden; }
    #vxSidebar { flex:0 0 102px; width:102px; display:flex; flex-direction:column; gap:5px; padding:7px 5px; border-right:1px solid rgba(201,162,39,.24); background:rgba(4,4,4,.30); min-height:0; }
    .vxSideTab { position:relative; display:flex; align-items:center; gap:6px; width:100%; min-height:35px; padding:7px 6px; border:1px solid rgba(201,162,39,.24); border-radius:4px; background:rgba(16,16,16,.58); color:#bcb6a3; text-align:left; font:inherit; cursor:pointer; }
    .vxSideTab:hover { border-color:var(--vx-accent); color:#f3df9b; background:rgba(33,27,16,.78); }
    .vxSideTab.active { border-color:var(--vx-accent); color:var(--vx-accent); background:var(--vx-accent-soft); box-shadow:inset 2px 0 0 var(--vx-accent); }
    .vxSideTab .vxTabIcon { width:14px; flex:0 0 14px; text-align:center; }
    #vxUpdateDot { display:none; width:7px; height:7px; flex:0 0 7px; margin-left:auto; border-radius:50%; background:#7fe18c; box-shadow:0 0 7px #7fe18c; }
    #vxContentArea { display:flex; flex:1 1 auto; flex-direction:column; min-width:0; min-height:0; overflow:hidden; background:rgba(6,6,6,.12); }
    .vxExtraView { display:none; flex:1 1 0%; flex-direction:column; gap:8px; min-width:0; min-height:0; padding:9px; overflow:auto; background:rgba(8,8,8,.24); }
    .vxPageCard { border:1px solid rgba(95,75,32,.68); border-radius:5px; padding:10px; background:rgba(20,20,20,.48); color:#c8c3b5; line-height:1.45; }
    .vxPageTitle { display:block; margin-bottom:6px; color:var(--vx-accent); font-weight:bold; }
    #vxMapDimmerCard { padding:8px 9px; border-color:var(--vx-accent-line); }
    #vxMapDimmerCard .vxAppearanceControl { margin:6px 0; }
    #vxMapDimmerCard .vxPageNote { line-height:1.35; }
    .vxChangelogEntry { padding:8px 0; border-top:1px solid rgba(201,162,39,.16); }
    .vxChangelogEntry:first-of-type { border-top:0; }
    .vxChangelogVersion { color:var(--vx-accent); font-weight:bold; }
    .vxChangelogDate { margin-left:6px; color:#777; font-size:9px; }
    .vxUpdateBanner { display:none; grid-column:1 / -1; align-items:center; justify-content:space-between; gap:8px; padding:8px; border:1px solid rgba(112,198,125,.68); border-radius:5px; background:rgba(20,60,29,.58); color:#bcefc4; }
    .vxUpdateBanner.visible { display:flex; }
    .vxUpdateBannerText { min-width:0; }
    .vxUpdateBannerTitle { display:block; color:#a4f3af; font-weight:bold; }
    .vxUpdateBannerDesc { display:block; margin-top:3px; color:#d1d9cf; font-size:10px; overflow-wrap:anywhere; }
    .vxActionBtn { padding:6px 8px; border:1px solid var(--vx-accent); border-radius:4px; background:var(--vx-accent-soft); color:var(--vx-accent); font:inherit; font-size:10px; cursor:pointer; }
    .vxActionBtn:hover { filter:brightness(1.18); }
    .vxAppearanceControl { display:block; margin:9px 0; }
    .vxAppearanceControl > span { display:flex; justify-content:space-between; gap:8px; margin-bottom:5px; }
    .vxAppearanceControl output { color:var(--vx-accent); }
    .vxAppearanceControl input[type="range"] { width:100%; accent-color:var(--vx-accent); }
    .vxAppearanceControl select { width:100%; padding:7px; background:#151515; color:#eee; border:1px solid var(--vx-accent-line); border-radius:4px; }
    .vxPageNote { color:#888; font-size:10px; line-height:1.45; }
    .vxStandaloneRow { display:flex; align-items:flex-start; justify-content:space-between; gap:4px; margin:0; padding:5px; min-height:70px; height:auto; min-width:0; max-width:100%; overflow:hidden; border:1px solid rgba(95,75,32,.85); border-radius:5px; background:rgba(20,20,20,.76); line-height:1.12; }
    .vxStandaloneRow > div:first-child { flex:1 1 0%; width:0; min-width:0; max-width:100%; overflow-wrap:anywhere; word-break:normal; }
    .vxStandaloneRow .vxStandaloneName,.vxStandaloneRow .vxStandaloneDesc { max-width:100%; min-width:0; }
    .vxStandaloneName { display:block; max-width:100%; color:#e0bd53; font-size:9.5px; line-height:1.1; font-weight:bold; overflow-wrap:anywhere; word-break:normal; }
    .vxStandaloneDesc { display:block; margin-top:2px; color:#999; font-size:8px; line-height:1.12; overflow-wrap:anywhere; word-break:normal; }
    .vxStandaloneState { margin-top:2px; color:#aaa; font-size:7px; line-height:1.05; overflow-wrap:anywhere; }
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
    #vxStandaloneMini .diamond { color:var(--vx-accent); font-size:15px; }
    #vxStandalonePanel { border-color:var(--vx-accent-line); }
    #vxStandaloneBrand,#vxStandaloneMin,.vxStandaloneName,#vxCurrentSetting,.vxChangelogVersion { color:var(--vx-accent); }
    #vxStandaloneMin,.vxOpenSettings,.vxNavBtn,.vxActionBtn { border-color:var(--vx-accent-line); }
    .vxStandaloneRow { border-color:var(--vx-accent-line); }
    #vxStandaloneFooter { border-top-color:var(--vx-accent-line); }
    #vxStandaloneMini { border-color:var(--vx-accent-line); }
    #vxSettingsToolbar { border-bottom-color:var(--vx-accent-line); }
    /* Widok główny jest przewijany wewnątrz okna; stopka zostaje na dole. */
    #vxHomeView { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); grid-auto-rows:minmax(70px,auto); align-content:start; align-items:stretch; gap:4px; padding:5px; flex:1 1 0%; height:0; min-height:0; max-height:none; overflow-y:auto; overflow-x:hidden; }
    #vxHomeView.vxNarrow { grid-template-columns:minmax(0,1fr); grid-auto-rows:minmax(68px,auto); }
    #vxHomeView, #vxSettingsView, #vxChangelogView, #vxAppearanceView { scrollbar-width:thin; scrollbar-color:rgba(201,162,39,.25) transparent; overscroll-behavior:contain; }
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
  </style>
  <div id="vxStandalonePanel">
    <div id="vxStandaloneHeader"><div id="vxStandaloneBrand">Panel Dodatków</div><button id="vxStandaloneMin" type="button" title="Minimalizuj">−</button></div>
    <div id="vxWorkspace">
      <nav id="vxSidebar" aria-label="Nawigacja panelu">
        <button type="button" class="vxSideTab active" data-vx-tab="addons"><span class="vxTabIcon">◆</span><span>Dodatki</span></button>
        <button type="button" class="vxSideTab" data-vx-tab="changelog"><span class="vxTabIcon">☷</span><span>Log zmian</span><span id="vxUpdateDot" title="Dostępna aktualizacja"></span></button>
        <button type="button" class="vxSideTab" data-vx-tab="appearance"><span class="vxTabIcon">◐</span><span>Wygląd</span></button>
      </nav>
      <div id="vxContentArea">
    <div id="vxHomeView" class="vxView">
      <div class="vxUpdateBanner" id="vxUpdateBanner">
        <div class="vxUpdateBannerText"><span class="vxUpdateBannerTitle" id="vxUpdateBannerTitle">Sprawdzanie aktualizacji…</span><span class="vxUpdateBannerDesc" id="vxUpdateBannerDesc">Porównuję wersję z repozytorium GitHub.</span></div>
        <button type="button" class="vxActionBtn" id="vxUpdateOpen">AKTUALIZUJ</button>
      </div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName">Loot Glow</span><span class="vxStandaloneDesc">Podświetlanie lootu • kolor i intensywność</span><div class="vxStandaloneState" id="vxLootState"></div><button type="button" class="vxOpenSettings" id="vxLootOpen">USTAWIENIA</button></div><label class="vxToggle"><input id="vxLootSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName">DC Wykrywacz</span><span class="vxStandaloneDesc">Herosi, tytani, grzybki i Discord</span><div class="vxStandaloneState" id="vxDcState"></div><button type="button" class="vxOpenSettings" id="vxDcOpen">USTAWIENIA</button></div><label class="vxToggle"><input id="vxDcSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName">Belka lootów zintegrowana z Lootlogiem</span><span class="vxStandaloneDesc">Ostatnie herosy i legendarne łupy TheCrew</span><div class="vxStandaloneState" id="vxLootlogState"></div><button type="button" class="vxOpenSettings" id="vxLootlogOpen">USTAWIENIA</button></div><label class="vxToggle"><input id="vxLootlogSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName">Titan Tracker Gold</span><span class="vxStandaloneDesc">Tytani i lista do 15 graczy na wybranych mapach</span><div class="vxStandaloneState" id="vxTitanState"></div><button type="button" class="vxOpenSettings" id="vxTitanOpen">USTAWIENIA</button></div><label class="vxToggle"><input id="vxTitanSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName">Procent łupu</span><span class="vxStandaloneDesc">Szansa według profesji i uprawnionych graczy</span><div class="vxStandaloneState" id="vxLootChanceState"></div><button type="button" class="vxOpenSettings" id="vxLootChanceOpen">USTAWIENIA</button></div><label class="vxToggle"><input id="vxLootChanceSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName">The Crew Online</span><span class="vxStandaloneDesc">Lista klanowiczów online z Lootloga</span><div class="vxStandaloneState" id="vxCrewOnlineState"></div><button type="button" class="vxOpenSettings" id="vxCrewOnlineOpen">USTAWIENIA</button></div><label class="vxToggle"><input id="vxCrewOnlineSwitch" type="checkbox"><span></span></label></div>
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
        <div class="vxLootlogInfo">The Crew Online 3.4.0 pobiera listę członków z danych klanu i uzupełnia szczegóły z Lootloga, gdy są dostępne. Lista odświeża się co 5 sekund; panel pozostaje osobnym oknem na ekranie gry.</div>
        <div class="vxLootlogActions">
          <button type="button" id="vxCrewOnlineShow">POKAŻ PANEL</button>
          <button type="button" id="vxCrewOnlineRefresh">ODŚWIEŻ LISTĘ</button>
          <button type="button" id="vxCrewOnlineCollapse">ZWIŃ / ROZWIŃ</button>
        </div>
      </div>
    </div>
    <div id="vxChangelogView" class="vxExtraView">
      <div class="vxPageCard">
        <span class="vxPageTitle">Dziennik zmian Vickness Addons</span>
        <div class="vxPageNote">Najnowsze zmiany panelu i wbudowanych dodatków.</div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.33</span><span class="vxChangelogDate">bieżące wydanie</span><div>Dodano motyw czarno-czerwony i zaktualizowano Titan Tracker Gold do 5.0.2: kolejność wejścia graczy, komunikaty Discord inline oraz automatyczne rozwijanie po wykryciu tytana.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.32</span><span class="vxChangelogDate">poprzednie wydanie</span><div>Podmieniono The Crew Online na 3.4.0. Zmniejszono czcionki, przełączniki i odstępy kart, żeby zawartość lepiej mieściła się w każdym polu.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.31</span><span class="vxChangelogDate">bieżące wydanie</span><div>Poprawiono karty dodatków: zmniejszono czcionki i odstępy, dopasowano przełączniki oraz przyciski, a długie nazwy i opisy mogą się zawijać bez wychodzenia poza kartę.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.30</span><span class="vxChangelogDate">poprzednie wydanie</span><div>Przeniesiono Złote przyciemnienie mapy na początek zakładki Wygląd, aby przycisk i suwak były widoczne od razu. Poprawiono przewijanie zawartości kółkiem myszy.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.29</span><span class="vxChangelogDate">poprzednie wydanie</span><div>Dodano wyraźny przycisk WŁĄCZ/WYŁĄCZ ZŁOTE PRZYCIEMNIENIE w zakładce Wygląd. Etykieta przycisku synchronizuje się ze stanem filtra.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.28</span><span class="vxChangelogDate">poprzednie wydanie</span><div>Dodano Złote przyciemnienie mapy w zakładce Wygląd z suwakiem, przełącznikiem i przywracaniem jasności. Zaktualizowano The Crew Online do 3.3.9.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.27</span><div>Dodano zakładki Dodatki, Log zmian i Wygląd, sprawdzanie nowszej wersji z GitHuba oraz ustawienia przezroczystości, rozmycia i motywu.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.26</span><div>The Crew Online 3.1.0; skrócony widok graczy i wyróżnianie członków drużyny.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.25</span><div>DC Wykrywacz działa w osobnym oknie po wykryciu NPC.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.24</span><div>The Crew Online 2.7.0 oraz poprawki wyróżniania członków drużyny.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.23</span><div>Zmiana rozmiaru głównego panelu z proporcjonalnym skalowaniem czcionek i zapamiętywaniem pozycji.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.20</span><div>Poprawki odczytu API Lootloga i integracja Procentu łupu 5.11.0 oraz The Crew Online.</div></div>
      </div>
      <div class="vxPageCard"><span class="vxPageTitle">Aktualizacje</span><div id="vxChangelogUpdateStatus">Sprawdzanie aktualnej wersji…</div><div class="vxLootlogActions"><button type="button" id="vxUpdateCheck" class="vxActionBtn">SPRAWDŹ PONOWNIE</button><button type="button" id="vxUpdateOpenFromLog" class="vxActionBtn" style="display:none">OTWÓRZ AKTUALIZACJĘ</button></div><div class="vxPageNote" style="margin-top:7px">Tampermonkey sprawdza aktualizacje według własnego harmonogramu. Po publikacji nowej wersji zwiększ numer @version w pliku na GitHubie.</div></div>
    </div>
    <div id="vxAppearanceView" class="vxExtraView">
      <div class="vxPageCard" id="vxMapDimmerCard">
        <span class="vxPageTitle">Złote przyciemnienie mapy</span>
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
        <label class="vxAppearanceControl"><span><span>Motyw kolorystyczny</span></span><select id="vxThemeSelect"><option value="gold">Czarno-złoty</option><option value="turquoise">Czarno-turkusowy</option><option value="purple">Czarno-fioletowy</option><option value="redblack">Czarno-czerwony</option></select></label>
        <div class="vxLootlogActions"><button type="button" id="vxAppearanceReset" class="vxActionBtn">DOMYŚLNY WYGLĄD</button><button type="button" id="vxLayoutReset" class="vxActionBtn">RESETUJ ROZMIAR I POZYCJĘ</button></div>
      </div>

    </div>
      </div>
    </div>
    <div id="vxStandaloneFooter">Addons by Vickness</div>
  </div>
  <button id="vxStandaloneMini" type="button" title="Otwórz panel"><span class="diamond">◆</span><span>Addons</span></button>`;

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
    const titanPanel = getPanel('rtt-panel');
    if (titanPanel) titanPanel.style.setProperty('display', enabled.titan ? 'block' : 'none', 'important');
    const lootChancePanel = getPanel('mlc513-panel');
    const lootChanceSlot = root.querySelector('#vxSettingsLootChance');
    if (lootChancePanel && lootChanceSlot && !lootChanceSlot.contains(lootChancePanel)) lootChanceSlot.appendChild(lootChancePanel);
    if (lootChancePanel && lootChanceSlot.contains(lootChancePanel)) {
      lootChancePanel.style.setProperty('display', enabled.lootChance ? 'block' : 'none', 'important');
      const body = Array.from(lootChancePanel.children).find(child => !child.classList.contains('heading'));
      if (body) body.style.setProperty('display', 'block', 'important');
    }
    if (!enabled.lootChance) document.querySelectorAll('.mlc513-label').forEach(label => label.remove());
    if (!enabled.lootlog) document.querySelectorAll('.vl-tip').forEach(tip => { tip.style.display = 'none'; });
    if (typeof window.__vicknessApplyCrewOnline === 'function') window.__vicknessApplyCrewOnline();
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
    root.querySelector('#vxTitanState').textContent = enabled.titan ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxLootChanceState').textContent = enabled.lootChance ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxCrewOnlineState').textContent = enabled.crewOnline ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxLootState').textContent = enabled.loot ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxDcState').textContent = enabled.dc ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxLootlogState').textContent = enabled.lootlog ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    dockWidgets();
  }
  function setActiveTab(tab) {
    root.querySelectorAll('[data-vx-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.vxTab === tab);
    });
  }
  function setMainTab(tab) {
    const home = root.querySelector('#vxHomeView');
    const settings = root.querySelector('#vxSettingsView');
    const changelog = root.querySelector('#vxChangelogView');
    const appearance = root.querySelector('#vxAppearanceView');
    home.style.display = tab === 'addons' ? 'grid' : 'none';
    settings.style.display = 'none';
    changelog.style.display = tab === 'changelog' ? 'flex' : 'none';
    appearance.style.display = tab === 'appearance' ? 'flex' : 'none';
    setActiveTab(tab);
    if (tab === 'changelog') checkForUpdates(false);
    if (tab === 'appearance') syncAppearanceControls();
  }
  function openSettings(which) {
    if (!['loot', 'dc', 'lootlog', 'titan', 'lootChance', 'crewOnline'].includes(which)) which = 'dc';
    setActiveTab('addons');
    root.querySelector('#vxHomeView').style.display = 'none';
    root.querySelector('#vxChangelogView').style.display = 'none';
    root.querySelector('#vxAppearanceView').style.display = 'none';
    enabled[which] = true;
    saveFlags();
    root.querySelector('#vxHomeView').style.display = 'none';
    root.querySelector('#vxSettingsView').style.display = 'flex';
    root.querySelector('#vxSettingsLoot').hidden = which !== 'loot';
    root.querySelector('#vxSettingsDc').hidden = which !== 'dc';
    root.querySelector('#vxSettingsLootlog').hidden = which !== 'lootlog';
    root.querySelector('#vxSettingsTitan').hidden = which !== 'titan';
    root.querySelector('#vxSettingsLootChance').hidden = which !== 'lootChance';
    root.querySelector('#vxSettingsCrewOnline').hidden = which !== 'crewOnline';
    root.querySelector('#vxCurrentSetting').textContent = which === 'loot' ? 'LOOT GLOW' : which === 'dc' ? 'DC WYKRYWACZ' : which === 'lootlog' ? 'BELKA LOOTÓW' : which === 'titan' ? 'TITAN TRACKER GOLD' : which === 'lootChance' ? 'PROCENT ŁUPU' : 'THE CREW ONLINE';
    const order = ['loot', 'dc', 'lootlog', 'titan', 'lootChance', 'crewOnline'];
    const next = order[(order.indexOf(which) + 1) % order.length];
    root.querySelector('#vxSwitchAddon').textContent = next === 'loot' ? 'LOOT GLOW →' : next === 'dc' ? 'DC WYKRYWACZ →' : next === 'lootlog' ? 'BELKA LOOTÓW →' : next === 'titan' ? 'TITAN TRACKER →' : next === 'lootChance' ? 'PROCENT ŁUPU →' : 'THE CREW ONLINE →';
    applyToggles();
    setTimeout(dockWidgets, 100);
    setTimeout(dockWidgets, 600);
  }
  function backHome() { setMainTab('addons'); }

  const UPDATE_URL = 'https://raw.githubusercontent.com/wikibuch1-wq/vickness-addon-panel/main/userscript/vickness-addon-panel.user.js';
  const CURRENT_PANEL_VERSION = '1.1.33';
  function compareVersions(a, b) {
    const aa = String(a).split('.').map(part => parseInt(part, 10) || 0);
    const bb = String(b).split('.').map(part => parseInt(part, 10) || 0);
    for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
      const diff = (aa[i] || 0) - (bb[i] || 0);
      if (diff) return diff > 0 ? 1 : -1;
    }
    return 0;
  }
  function setUpdateStatus(message) {
    const status = root.querySelector('#vxChangelogUpdateStatus');
    if (status) status.textContent = message;
  }
  function showUpdateAvailable(latest) {
    const banner = root.querySelector('#vxUpdateBanner');
    const title = root.querySelector('#vxUpdateBannerTitle');
    const desc = root.querySelector('#vxUpdateBannerDesc');
    const dot = root.querySelector('#vxUpdateDot');
    const logOpen = root.querySelector('#vxUpdateOpenFromLog');
    if (banner) banner.classList.add('visible');
    if (title) title.textContent = `Dostępna aktualizacja ${latest}`;
    if (desc) desc.textContent = `Masz ${CURRENT_PANEL_VERSION}. Otwórz aktualizator, aby przejść do najnowszego pliku.`;
    if (dot) dot.style.display = 'inline-block';
    if (logOpen) logOpen.style.display = 'inline-block';
    setUpdateStatus(`Dostępna wersja ${latest}. Zainstalowana wersja: ${CURRENT_PANEL_VERSION}.`);
  }
  function checkForUpdates(showChecking = true) {
    const bannerTitle = root.querySelector('#vxUpdateBannerTitle');
    if (showChecking && bannerTitle) bannerTitle.textContent = 'Sprawdzanie aktualizacji…';
    if (showChecking) setUpdateStatus('Sprawdzam plik na GitHubie…');
    if (typeof GM_xmlhttpRequest !== 'function') {
      setUpdateStatus('Nie można sprawdzić wersji: brak GM_xmlhttpRequest.');
      return;
    }
    GM_xmlhttpRequest({
      method: 'GET',
      url: UPDATE_URL + '?v=' + Date.now(),
      timeout: 12000,
      onload(response) {
        if (response.status < 200 || response.status >= 300) {
          setUpdateStatus(`Nie udało się sprawdzić aktualizacji (HTTP ${response.status}).`);
          return;
        }
        const match = String(response.responseText || '').match(/^\s*\/\/\s*@version\s+([^\s]+)/m);
        if (!match) {
          setUpdateStatus('Nie znaleziono @version w pliku GitHub. Sprawdź, czy repozytorium zawiera skrypt userscript.');
          return;
        }
        const latest = match[1].trim();
        const comparison = compareVersions(latest, CURRENT_PANEL_VERSION);
        if (comparison > 0) {
          showUpdateAvailable(latest);
        } else if (comparison === 0) {
          root.querySelector('#vxUpdateBanner')?.classList.remove('visible');
          root.querySelector('#vxUpdateDot').style.display = 'none';
          root.querySelector('#vxUpdateOpenFromLog').style.display = 'none';
          setUpdateStatus(`Masz najnowszą wersję (${CURRENT_PANEL_VERSION}).`);
        } else {
          root.querySelector('#vxUpdateBanner')?.classList.remove('visible');
          root.querySelector('#vxUpdateDot').style.display = 'none';
          root.querySelector('#vxUpdateOpenFromLog').style.display = 'none';
          setUpdateStatus(`GitHub zawiera wersję ${latest}, a uruchomiona wersja to ${CURRENT_PANEL_VERSION}. Wgraj tę wersję do repozytorium, aby udostępnić ją innym.`);
        }
      },
      onerror() { setUpdateStatus('Nie udało się połączyć z GitHubem. Spróbuj ponownie później.'); },
      ontimeout() { setUpdateStatus('GitHub nie odpowiedział w ciągu 12 sekund.'); }
    });
  }

  const THEME_SETTINGS = {
    gold: { accent: '#dfb943', line: 'rgba(201,162,39,.72)', soft: 'rgba(46,35,8,.62)' },
    turquoise: { accent: '#50d6c8', line: 'rgba(80,214,200,.68)', soft: 'rgba(8,48,45,.62)' },
    purple: { accent: '#bf96ff', line: 'rgba(191,150,255,.68)', soft: 'rgba(41,24,61,.62)' },
    redblack: { accent: '#ff4545', line: 'rgba(235,48,48,.76)', soft: 'rgba(58,8,8,.64)' }
  };
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
    if (!panel) return;
    const appearance = getAppearance();
    const alpha = appearance.opacity / 100;
    const theme = THEME_SETTINGS[appearance.theme];
    root.style.setProperty('--vx-accent', theme.accent);
    root.style.setProperty('--vx-accent-line', theme.line);
    root.style.setProperty('--vx-accent-soft', theme.soft);
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
    panel.style.display = 'none';
    mini.style.display = 'flex';
    layout.minimized = true;
    saveLayout();
  }
  function restore() {
    const panel = root.querySelector('#vxStandalonePanel');
    const mini = root.querySelector('#vxStandaloneMini');
    panel.style.display = 'flex';
    mini.style.display = 'none';
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
    mini.style.display = 'flex';
    clamp(panel, 'main', Math.max(8, Math.round((innerWidth - panel.offsetWidth) / 2)), Math.max(8, Math.round((innerHeight - panel.offsetHeight) / 2)));
    clamp(mini, 'mini', 20, 100);
    if (!layout.main || !(Number(layout.main.width) > 0) || !(Number(layout.main.height) > 0)) savePos(panel, 'main');
    if (!layout.mini) savePos(mini, 'mini');
    applyAppearance();
    syncAppearanceControls();
    syncMapDimmerControls();
    startMapDimmerMonitor();
    setMainTab('addons');
    setTimeout(() => checkForUpdates(true), 1800);

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
      const candidates = ['#vxHomeView', '#vxSettingsView', '#vxChangelogView', '#vxAppearanceView'];
      const activeView = candidates.map(selector => root.querySelector(selector)).find(view => view && getComputedStyle(view).display !== 'none');
      if (!activeView || activeView.scrollHeight <= activeView.clientHeight) return;
      // Przewijaj aktywną zakładkę kółkiem nad jej tłem i tekstem.
      // Nie przechwytuj kółka nad suwakami, polami wyboru ani przyciskami.
      if (event.target.closest('input, select, button, textarea')) return;
      event.preventDefault();
      activeView.scrollTop += event.deltaY;
    }, { passive: false });

    root.querySelector('#vxLootSwitch').addEventListener('change', e => { enabled.loot = e.target.checked; saveFlags(); applyToggles(); });
    root.querySelector('#vxDcSwitch').addEventListener('change', e => { enabled.dc = e.target.checked; saveFlags(); applyToggles(); });
    root.querySelector('#vxLootlogSwitch').addEventListener('change', e => {
      enabled.lootlog = e.target.checked; saveFlags(); applyToggles();
      if (enabled.lootlog) setTimeout(() => getPanel('vickness-lootbar')?.querySelector('.vl-refresh')?.click(), 100);
    });
    root.querySelector('#vxTitanSwitch').addEventListener('change', e => { enabled.titan = e.target.checked; saveFlags(); applyToggles(); });
    root.querySelector('#vxLootChanceSwitch').addEventListener('change', e => { enabled.lootChance = e.target.checked; saveFlags(); applyToggles(); });
    root.querySelector('#vxCrewOnlineSwitch').addEventListener('change', e => { enabled.crewOnline = e.target.checked; saveFlags(); applyToggles(); });
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
    const openUpdater = () => window.open(UPDATE_URL, '_blank', 'noopener');
    root.querySelector('#vxUpdateOpen').addEventListener('click', openUpdater);
    root.querySelector('#vxUpdateOpenFromLog').addEventListener('click', openUpdater);
    root.querySelector('#vxUpdateCheck').addEventListener('click', () => checkForUpdates(true));
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
      const current = !root.querySelector('#vxSettingsLoot').hidden ? 'loot' : !root.querySelector('#vxSettingsDc').hidden ? 'dc' : !root.querySelector('#vxSettingsLootlog').hidden ? 'lootlog' : !root.querySelector('#vxSettingsTitan').hidden ? 'titan' : !root.querySelector('#vxSettingsLootChance').hidden ? 'lootChance' : 'crewOnline';
      const order = ['loot', 'dc', 'lootlog', 'titan', 'lootChance', 'crewOnline'];
      openSettings(order[(order.indexOf(current) + 1) % order.length]);
    });
    root.querySelector('#vxLootlogRefresh').addEventListener('click', () => getPanel('vickness-lootbar')?.querySelector('.vl-refresh')?.click());
    root.querySelector('#vxLootlogLayout').addEventListener('click', () => getPanel('vickness-lootbar')?.querySelector('.vl-layout')?.click());
    root.querySelector('#vxLootlogScaleDown').addEventListener('click', () => getPanel('vickness-lootbar')?.querySelector('.vl-minus')?.click());
    root.querySelector('#vxLootlogScaleUp').addEventListener('click', () => getPanel('vickness-lootbar')?.querySelector('.vl-plus')?.click());
    root.querySelector('#vxStandaloneMin').addEventListener('click', showMini);
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
    panel.style.display = 'none';
    mini.style.display = 'flex';
    layout.minimized = true;
    saveLayout();

    // DC działa niezależnie od głównego panelu: wykrycie otwiera własne okno.
    window.__vicknessOpenDCWindow = openDCWindow;
    // Zachowaj dotychczasową nawigację ustawień, ale nie używaj jej przy samym wykryciu.
    window.__vicknessOpenAddonSettings = function(which) {
      restore();
      openSettings(which === 'loot' ? 'loot' : 'dc');
    };

    // Obsłuż wykrycie, które nastąpiło przed uruchomieniem menedżera Vickness.
    if (window.__vicknessPendingOpenDCWindow) {
      window.__vicknessPendingOpenDCWindow = false;
      openDCWindow();
    }

    setInterval(applyToggles, 500);
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
// BELKA LOOTÓW ZINTEGROWANA Z LOOTLOGIEM — kod dodatku 4.4.7 (z załącznika)
(() => {
  'use strict';

  const API =
    'https://api.lootlog.pl/guilds/thecrew/loots?limit=100&world=riventia';
  // Osobne zapytanie z filtrem rzadkości, aby starsze legendy nie ginęły
  // poza pierwszymi 100 najnowszymi wpisami.
  const LEGENDARY_API =
    'https://api.lootlog.pl/guilds/thecrew/loots?limit=100&world=riventia&rarities=LEGENDARY';
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
      width: max-content;
      min-width: 175px;
      max-width: min(280px,calc(100vw - 20px));
      padding: 8px 10px;
      color: #f4e6b5;
      background: #101010;
      border: 1px solid #bd9226;
      border-radius: 5px;
      box-shadow: 0 4px 14px #000c;
      white-space: normal;
      overflow-wrap: anywhere;
      line-height: 1.5;
      font: 12px Arial,sans-serif;
      pointer-events: none;
      user-select: none;
    }

    .vl-tip strong {
      display: block;
      margin-bottom: 3px;
      color: #f0c647;
    }

    .vl-tip .vl-tip-item {
      margin-top: 3px;
      color: #b8dcff;
    }

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
      item?.icon,
      item?.image,
      item?.iconUrl,
      item?.icon_url,
      item?.iconURL,
      item?.imageUrl,
      item?.image_url
    ];

    const candidates = [];

    for (const field of fields) {
      if (typeof field !== 'string' || !field.trim()) continue;

      const raw = field.trim();
      candidates.push(raw);

      if (!/^https?:\/\//i.test(raw) && !raw.startsWith('//')) {
        const path = raw.replace(/^\/+/, '');
        candidates.push(
          `https://micc.garmory-cdn.cloud/obrazki/itemy/${path}`,
          `https://micc.garmory-cdn.cloud/obrazki/${path}`,
          `https://www.margonem.pl/obrazki/itemy/${path}`,
          `https://www.margonem.pl/obrazki/${path}`,
          `https://lootlog.pl/${path}`
        );
      }
    }

    return [
      ...new Set(
        candidates.map(value =>
          value.startsWith('//') ? `https:${value}` : value
        )
      )
    ];
  }

  function hideTooltip() {
    tooltip.style.display = 'none';
  }

  function showTooltip(tile) {
    const source = tile.querySelector('.vl-tip-source');
    if (!source) return;

    tooltip.replaceChildren();

    const title = document.createElement('strong');
    title.textContent = source.dataset.npc || 'Nieznany NPC';
    tooltip.appendChild(title);

    const playerLine = document.createElement('div');
    playerLine.textContent =
      `Zdobył: ${source.dataset.player || 'Nieznany gracz'}`;
    tooltip.appendChild(playerLine);

    const itemLine = document.createElement('div');
    itemLine.className = 'vl-tip-item';
    itemLine.textContent = source.dataset.item || 'Nieznany przedmiot';
    tooltip.appendChild(itemLine);

    tooltip.style.display = 'block';
    tooltip.style.visibility = 'hidden';
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';

    const itemRect = tile.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();

    let left = itemRect.right + 8;

    if (left + tipRect.width > window.innerWidth - 8) {
      left = itemRect.left - tipRect.width - 8;
    }

    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));

    let top = itemRect.top;
    top = Math.max(8, Math.min(top, window.innerHeight - tipRect.height - 8));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.visibility = 'visible';
  }

  function makeTile(entry) {
    const loot = entry.loot;
    const item = entry.item || getItem(loot);
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

  function render(loots) {
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

    chosen.forEach(entry => itemsBox.appendChild(makeTile(entry)));
  }

  async function loadLoots() {
    if (busy) return;
    busy = true;

    try {
      const data = await fetchJson(API);
      const recentLoots = getLoots(data);
      let legendaryLoots = [];

      // Pobieramy też osobno legendy, aby dotrzeć do nich poza pierwszymi
      // 100 najnowszymi łupami. Jeśli filtr nie jest obsługiwany, zachowujemy
      // działanie podstawowego źródła zamiast wyłączać cały pasek.
      try {
        const legendaryData = await fetchJson(LEGENDARY_API);
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
      render(loots);

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

  loadLoots();
  setInterval(loadLoots, REFRESH_MS);

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

    function start() {
        if (!document.body) {
            setTimeout(start, 500);
            return;
        }

        createPanel();
        tick();
        setInterval(tick, 1000);
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

   function updateItem(item, team) {
     const r = getRarity(item);

     if (!settings.enabled || (window.__vicknessAddonEnabled && !window.__vicknessAddonEnabled.lootChance) || !r || !settings.rarities[r] ||
          !item.isConnected || !isLootWindowOpen()) {
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
       const myProfession = getCurrentProfession();

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
     const team = getTeam();
     let shown = 0;

     items.forEach(item => {
       if (updateItem(item, team)) shown++;
       autoRead(item);
     });

     for (const [item, label] of labels) {
       if (!item.isConnected || !items.includes(item)) {
         label.remove();
         labels.delete(item);
       }
     }

     updateStatus(items.length, shown, team.length || 1);
   }

   function scheduleScan(delay = 250) {
     if (scanTimer) clearTimeout(scanTimer);
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

     observer = new MutationObserver(() => {
       // Obserwuj zmiany DOM, ale nie atrybuty całej strony.
       scheduleScan(0);
     });

     observer.observe(document.body, {
       childList: true,
       subtree: true
     });


     // Sprawdza zamknięcie okna jako zabezpieczenie, gdy gra nie usuwa go z DOM.
     setInterval(() => {
       if (lastWindowOpen && !isLootWindowOpen()) {
         clearLootLabels();
         lastWindowOpen = false;
       }
     }, 100);
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

   const GUILD_ID = '1384811864235704372';
   const WORLD = 'riventia';
   const STORAGE_KEY = 'tc_online_panel_v2';
   const REFRESH_MS = 5000;

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
   const status = make('div', 'Łączenie z Lootlogiem…', 'tc-status');
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

   // Bezpieczny tryb pasywny: nie wysyłamy żądania clan&a=members
   // i nigdy nie blokujemy natywnych handlerów gry. Dzięki temu ręczne
   // otwieranie zakładki Klanowicze pozostaje dostępne.
   let cachedRawMembers = null;
   let cachedMembersAt = 0;
   let pendingMembersRequest = null;
   let membersDispatcherHooked = false;
   let lastRoster = [];
   const playerDetailsCache = new Map();
   const REQUEST_TIMEOUT_MS = 10000;

   const normalizeMembersPayload = (data) => {
     if (Array.isArray(data)) return data.length >= 11 ? data : null;
     if (!data || typeof data !== 'object') return null;
     if (Array.isArray(data.members)) return data.members.length >= 11 ? data.members : null;

     // Odpowiedź obserwowana w grze: 2563 klucze numeryczne = 233 rekordy po 11 pól.
     const numericKeys = Object.keys(data).filter(key => /^(0|[1-9]\d*)$/.test(key));
     if (numericKeys.length < 11) return null;
     numericKeys.sort((a, b) => Number(a) - Number(b));
     const flattened = numericKeys.map(key => data[key]);
     return flattened.length >= 11 ? flattened : null;
   };

   const installMembersHook = () => {
     const dispatcher = PAGE.Engine?.communication?.dispatcher;
     if (membersDispatcherHooked || !dispatcher || typeof dispatcher.on_members !== 'function') return;

     const originalOnMembers = dispatcher.on_members;
     dispatcher.on_members = function(data, ...args) {
       const members = normalizeMembersPayload(data);
       if (members) {
         cachedRawMembers = members;
         cachedMembersAt = Date.now();
         if (pendingMembersRequest) {
           const pending = pendingMembersRequest;
           pendingMembersRequest = null;
           clearTimeout(pending.timeout);
           pending.resolve(members);
           // Pomijamy handler UI tylko dla odpowiedzi naszego żądania,
           // gdy okno klanu jest zamknięte.
           if (!PAGE.Engine?.clan) return;
         }
       }
       return originalOnMembers.call(this, data, ...args);
     };

     membersDispatcherHooked = true;
   };

   const readMembersFromOpenClan = () => {
     try {
       const clan = PAGE.Engine?.clan;
       if (!clan || typeof clan.getMemberList !== 'function') return null;
       const memberList = clan.getMemberList();
       if (!memberList || typeof memberList !== 'object') return null;
       // getMemberList() is normally keyed by player ID; each value is an 11-field record.
       const records = Array.isArray(memberList) ? memberList : Object.values(memberList);
       const flattened = [];
       for (const record of records) {
         if (Array.isArray(record) && record.length >= 11) flattened.push(...record.slice(0, 11));
       }
       return flattened.length >= 11 ? flattened : null;
     } catch (error) {
       return null;
     }
   };

   const requestMembers = () => new Promise((resolve, reject) => {
     installMembersHook();
     const liveRoster = readMembersFromOpenClan();
     if (liveRoster) {
       cachedRawMembers = liveRoster;
       cachedMembersAt = Date.now();
       resolve(liveRoster);
       return;
     }
     if (Array.isArray(cachedRawMembers) && cachedRawMembers.length >= 11 &&
         Date.now() - cachedMembersAt < 30000) {
       resolve(cachedRawMembers);
       return;
     }
     if (pendingMembersRequest) {
       reject(new Error('Oczekiwanie na listę członków już trwa.'));
       return;
     }

     const pending = { resolve, reject, timeout: null };
     pendingMembersRequest = pending;
     pending.timeout = window.setTimeout(() => {
       if (pendingMembersRequest === pending) pendingMembersRequest = null;
       reject(new Error('Serwer nie zwrócił listy. Jeśli automatyczne pobranie nie działa, otwórz Klanowicze ręcznie.'));
     }, REQUEST_TIMEOUT_MS);

     // Najpierw podpinamy przechwytywanie, dopiero potem wysyłamy żądanie.
     try {
       if (typeof PAGE._g === 'function') {
         PAGE._g('clan&a=members');
       } else {
         clearTimeout(pending.timeout);
         pendingMembersRequest = null;
         reject(new Error('Nie znaleziono funkcji komunikacji gry.'));
       }
     } catch (error) {
       clearTimeout(pending.timeout);
       pendingMembersRequest = null;
       reject(error);
     }
   });

   // Odpowiedź members to spłaszczona tablica rekordów po 11 pól:
   // id, nick, hp, maxhp, profesja, mapa, x, y, ranga, czas/status, grafika.
   const getPlayers = async () => {
     const rawMembers = await requestMembers();
     if (!Array.isArray(rawMembers) || rawMembers.length < 11) {
       throw new Error('Serwer zwrócił niepełną listę członków klanu.');
     }

     const roster = [];
     for (let i = 0; i + 10 < rawMembers.length; i += 11) {
       const id = String(rawMembers[i] ?? '');
       const nick = String(rawMembers[i + 1] ?? '').trim();
       if (!id || !nick) continue;
       // Dane lokacji są już w rekordzie klanowym; nie polegaj wyłącznie na Lootlogu.
      // Układ rekordu: id, nick, hp, maxhp, profesja, mapa, x, y, ranga, status, grafika.
      const baseLevelValue = rawMembers[i + 2];
      const baseLevel = baseLevelValue !== '' && baseLevelValue != null && Number.isFinite(Number(baseLevelValue))
        ? Number(baseLevelValue)
        : null;
      const profession = String(rawMembers[i + 4] ?? '').trim();
      const map = String(rawMembers[i + 5] ?? '').trim();
      const xValue = rawMembers[i + 6];
      const yValue = rawMembers[i + 7];
      const x = xValue !== '' && xValue != null && Number.isFinite(Number(xValue)) ? Number(xValue) : null;
      const y = yValue !== '' && yValue != null && Number.isFinite(Number(yValue)) ? Number(yValue) : null;
      roster.push({
        id, nick,
        isOnline: Number(rawMembers[i + 9]) === 0,
        baseLevel,
        baseProfession: profession,
        baseMap: map,
        baseX: x,
        baseY: y
      });
     }
     if (!roster.length) throw new Error('Lista członków nie zawiera rozpoznawalnych rekordów.');
     lastRoster = roster;

     // Spróbuj pobrać dodatkowe dane z Lootloga, ale nie uzależniaj od niego listy.
     const extrasByNick = new Map();
     try {
       const api = PAGE.lootlogGameClientApi;
       if (api?.ready && typeof api.getOnlinePlayers === 'function') {
         const result = await api.getOnlinePlayers({
           guildId: GUILD_ID,
           world: WORLD
         });

         if (result?.status === 'success' && result.players) {
           for (const record of Object.values(result.players).flat()) {
             const player = record?.player;
             if (!player || record.status !== 'online' || player.world !== WORLD) continue;

             const nick = String(player.name || '').trim().toLocaleLowerCase('pl');
             if (!nick) continue;

             const location = player.location || {};
             const extra = {
               level: player.lvl != null && player.lvl !== '' && Number.isFinite(Number(player.lvl)) ? Number(player.lvl) : null,
               profession: player.prof || player.profession || '',
               map: location.map || record.mapName || '',
               x: location.x != null && location.x !== '' && Number.isFinite(Number(location.x)) ? Number(location.x) : null,
               y: location.y != null && location.y !== '' && Number.isFinite(Number(location.y)) ? Number(location.y) : null,
               afk: record.isAfk === true
             };
             const previous = playerDetailsCache.get(nick) || {};
             const merged = {
               level: extra.level ?? previous.level ?? null,
               profession: extra.profession || previous.profession || '',
               map: extra.map || previous.map || '',
               x: extra.x ?? previous.x ?? null,
               y: extra.y ?? previous.y ?? null,
               afk: extra.afk || previous.afk === true
             };
             playerDetailsCache.set(nick, merged);
             extrasByNick.set(nick, merged);
           }
         }
       }
     } catch (error) {
       console.debug('[The Crew] Dodatkowe dane Lootloga niedostępne:', error);
     }

     // Podświetlanie członków aktualnej drużyny.
     const partyMembers = PAGE.Engine?.party?.getMembers?.();
     const partyIds = new Set();

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

     return roster
       .filter(player => player.isOnline)
       .map(player => {
         const nickKey = player.nick.toLocaleLowerCase('pl');
         const extra = extrasByNick.get(nickKey) || playerDetailsCache.get(nickKey) || {};
         return {
           id: player.id,
           nick: player.nick,
           level: extra.level ?? player.baseLevel ?? null,
           profession: extra.profession || player.baseProfession || '',
           map: extra.map || player.baseMap || '',
           x: extra.x ?? player.baseX ?? null,
           y: extra.y ?? player.baseY ?? null,
           isInGroup: partyIds.has(player.id),
           afk: extra.afk === true
         };
       })
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
   let refreshTimer;

   const refresh = async () => {
     if (busy) return;
     busy = true;

     try {
       const players = await getPlayers();

       render(players);

       status.textContent =
         `Online: ${players.length} · ` +
         `Aktualizacja: ${new Date().toLocaleTimeString('pl-PL')}`;
     } catch (error) {
       console.warn('[The Crew] Refresh error:', error);

       if (lastRoster.length) {
         // Zachowaj ostatnie znane dane i jasno oznacz, że nie udało się ich odświeżyć.
         const partyMembers = PAGE.Engine?.party?.getMembers?.();
         const partyIds = new Set();
         if (partyMembers instanceof Map) {
           for (const [id, member] of partyMembers.entries()) {
             if (id != null) partyIds.add(String(id));
             if (member?.id != null) partyIds.add(String(member.id));
           }
         } else if (Array.isArray(partyMembers)) {
           for (const member of partyMembers) if (member?.id != null) partyIds.add(String(member.id));
         } else if (partyMembers && typeof partyMembers === 'object') {
           for (const [id, member] of Object.entries(partyMembers)) {
             partyIds.add(String(id));
             if (member?.id != null) partyIds.add(String(member.id));
           }
         }
         render(lastRoster.filter(p => p.isOnline).map(p => ({
           id: p.id, nick: p.nick, level: null, profession: '', map: '', x: null, y: null,
           isInGroup: partyIds.has(p.id), afk: false
         })).sort((a, b) => a.nick.localeCompare(b.nick, 'pl')));
         status.textContent = `Błąd odświeżania — pokazuję ostatnie dane · ${error.message || 'brak odpowiedzi'}`;
       } else {
         status.textContent = error.message || 'Błąd odczytu listy członków z gry.';
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
   refresh();

   refreshTimer = window.setInterval(refresh, REFRESH_MS);

   window.addEventListener('pagehide', () => {
     clearInterval(refreshTimer);
     clearTimeout(resizeTimer);
   });
 })();
