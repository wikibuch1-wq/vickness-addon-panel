// ==UserScript==
// @name         Vickness Addon Panel - Standalone
// @namespace    Vickness
// @version      1.1.36
// @description  Vickness Addons: Loot Bar 4.4.8, map dimmer v7 i dodatkowe motywy
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
// VICKNESS ADDON PANEL 1.1.36 — Loot Bar 4.4.8; belka zachowuje własne kolory
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

  // Złote przyciemnienie mapy — zaktualizowany mechanizm v7.0.
  // Sterowanie pozostaje w zakładce Wygląd; nie twórzemy osobnego pływającego panelu.
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
  let lastMapDimmerCanvas = null;
  let lastMapDimmerWidth = 0;
  let lastMapDimmerHeight = 0;
  let lastMapDimmerPixelWidth = 0;
  let lastMapDimmerPixelHeight = 0;
  let mapDimmerApplyQueued = false;
  let mapDimmerMonitorStarted = false;
  let mapDimmerResizeObserver = null;
  let mapDimmerMutationObserver = null;

  function getMapDimmerGameElements() {
    const canvas = document.querySelector('#GAME_CANVAS');
    const layer = canvas?.closest('.game-layer') || document.querySelector('.game-layer');
    return { canvas, layer };
  }

  function getMapDimmerDimensions() {
    const { canvas, layer } = getMapDimmerGameElements();
    const element = canvas || layer;
    if (!element) return { canvas: null, width: 0, height: 0, pixelWidth: 0, pixelHeight: 0 };
    const rect = element.getBoundingClientRect();
    return {
      canvas,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
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
      console.warn('[Vickness — Złote przyciemnienie mapy]', error);
      return false;
    }
  }

  function scheduleMapDimmerApply() {
    if (mapDimmerApplyQueued) return;
    mapDimmerApplyQueued = true;
    // Gra czasem przelicza canvas przez dwie klatki po resize/fullscreen.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      mapDimmerApplyQueued = false;
      applyMapDimmer(true);
    }));
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

  function startMapDimmerMonitor() {
    if (mapDimmerMonitorStarted) return;
    mapDimmerMonitorStarted = true;
    watchMapDimmerGameSize();
    applyMapDimmer(true);

    if (typeof MutationObserver === 'function' && document.body) {
      mapDimmerMutationObserver = new MutationObserver(() => {
        const dimensions = getMapDimmerDimensions();
        if (dimensions.canvas !== lastMapDimmerCanvas) watchMapDimmerGameSize();
        else scheduleMapDimmerApply();
      });
      mapDimmerMutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener('resize', watchMapDimmerGameSize);
    document.addEventListener('fullscreenchange', watchMapDimmerGameSize);
    // Zabezpieczenie dla zmian mapy lub canvasu, których gra nie zgłasza zdarzeniem.
    setInterval(() => {
      const engine = PAGE_WINDOW.Engine || window.Engine;
      if (!engine?.canvasFilter || !engine?.map) return;
      const dimensions = getMapDimmerDimensions();
      const mapId = engine.map.getId?.() ?? engine.map.d?.id ?? null;
      if (engine !== lastMapDimmerEngine || engine.map !== lastMapDimmerMap ||
          mapId !== lastMapDimmerMapId || dimensions.canvas !== lastMapDimmerCanvas ||
          dimensions.width !== lastMapDimmerWidth || dimensions.height !== lastMapDimmerHeight ||
          dimensions.pixelWidth !== lastMapDimmerPixelWidth || dimensions.pixelHeight !== lastMapDimmerPixelHeight) {
        if (dimensions.canvas !== lastMapDimmerCanvas) watchMapDimmerGameSize();
        else scheduleMapDimmerApply();
      }
    }, 150);
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
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.36</span><span class="vxChangelogDate">bieżące wydanie</span><div>Podmieniono belkę lootów na Loot Bar by Vickness 4.4.8 z załącznika. Pozostawiono osobną kolorystykę belki niezależną od motywu głównego panelu oraz zachowano jej sterowanie z zakładek Vickness.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.35</span><span class="vxChangelogDate">bieżące wydanie</span><div>Zaktualizowano mechanizm Złotego przyciemnienia mapy do wersji 7.0 z automatycznym dopasowaniem do rozmiaru gry i ponownym nakładaniem po zmianie canvasu. Dodano trzy motywy: czarno-niebieski, czarno-zielony i czarno-różowy. Belka Lootlog zachowuje własną kolorystykę niezależnie od motywu Vickness.</div></div>
        <div class="vxChangelogEntry"><span class="vxChangelogVersion">1.1.34</span><span class="vxChangelogDate">poprzednie wydanie</span><div>Ujednolicono i powiększono czcionki w zakładkach Dodatki, Log zmian i Wygląd. Wybrany motyw zmienia teraz również akcenty, obramowania i tabelki w oknach Loot Glow, belki Lootlog, DC Wykrywacza, Titan Trackera i The Crew Online.</div></div>
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
        <label class="vxAppearanceControl"><span><span>Motyw kolorystyczny</span></span><select id="vxThemeSelect"><option value="gold">Czarno-złoty</option><option value="turquoise">Czarno-turkusowy</option><option value="purple">Czarno-fioletowy</option><option value="redblack">Czarno-czerwony</option><option value="blue">Czarno-niebieski</option><option value="green">Czarno-zielony</option><option value="pink">Czarno-różowy</option></select></label>
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
  const CURRENT_PANEL_VERSION = '1.1.36';
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
    if (!panel) return;
    const appearance = getAppearance();
    const alpha = appearance.opacity / 100;
    const theme = THEME_SETTINGS[appearance.theme];
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
// BELKA LOOTÓW ZINTEGROWANA Z LOOTLOGIEM — kod dodatku 4.4.8 (z załącznika)
// ==UserScript==
// @name         Loot Bar by Vickness - Riventia
// @namespace    vickness.riventia.lootbar
// @version      4.4.8
// @description  Loot Bar Riventia - 10 najnowszych heroików Elity II i 5 najnowszych legend ze wszystkich źródeł
// @match        https://riventia.margonem.pl/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      api.lootlog.pl
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
      font-weight: bold;
    }

    .vl-tip .vl-tip-stats {
      margin-top: 7px;
      padding-top: 6px;
      border-top: 1px solid #393939;
      color: #dedede;
      white-space: pre-line;
      line-height: 1.45;
    }

    .vl-tip .vl-tip-stat {
      margin: 2px 0;
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

    const stats = safeParseStats(source.dataset.stats || '[]');
    if (stats.length) {
      const statsBox = document.createElement('div');
      statsBox.className = 'vl-tip-stats';
      for (const stat of stats) {
        const line = document.createElement('div');
        line.className = 'vl-tip-stat';
        line.textContent = stat;
        statsBox.appendChild(line);
      }
      tooltip.appendChild(statsBox);
    } else {
      const noStats = document.createElement('div');
      noStats.className = 'vl-tip-stats';
      noStats.textContent = 'Brak statystyk w danych Lootlog dla tego przedmiotu.';
      tooltip.appendChild(noStats);
    }

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

  function safeParseStats(value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  // Lootlog API versions may expose item parameters under different keys.
  // Only display fields present on the item object; never invent values.
  function extractItemStats(item) {
    if (!item || typeof item !== 'object') return [];
    const result = [];
    const seen = new Set();
    const ignored = /^(id|hid|uid|uniqueid|name|label|title|rarity|quality|grade|tier|icon|image|img|url|href|description|desc|type|code|level|lvl|owner|player|createdat|updatedat)$/i;
    const statContainers = /^(stats|statistics|attributes|parameters|properties|bonuses|effects|itemstats|item_stats|statlines|statslist)$/i;
    const niceName = key => String(key)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/^./, c => c.toUpperCase());
    const add = (label, value) => {
      if (value == null || result.length >= 35) return;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const text = String(value).trim();
        if (text && !result.includes(`${label}: ${text}`)) result.push(`${label}: ${text}`);
      }
    };
    function walk(value, depth = 0, prefix = '') {
      if (value == null || depth > 4 || result.length >= 35) return;
      if (typeof value !== 'object') { if (prefix) add(prefix, value); return; }
      if (seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry && typeof entry === 'object') {
            const label = entry.name ?? entry.label ?? entry.title ?? entry.stat ?? entry.key;
            const amount = entry.value ?? entry.amount ?? entry.bonus ?? entry.total;
            if (label != null && amount != null) add(label, amount);
            else walk(entry, depth + 1, prefix);
          } else if (prefix) add(prefix, entry);
        }
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (ignored.test(key)) continue;
        if (statContainers.test(key)) { walk(child, depth + 1, ''); continue; }
        if (child && typeof child === 'object') {
          const label = child.name ?? child.label ?? child.title ?? child.stat ?? child.key;
          const amount = child.value ?? child.amount ?? child.bonus ?? child.total;
          if (label != null && amount != null) add(label, amount);
          else walk(child, depth + 1, prefix || niceName(key));
        } else if (/^(?:stat|bonus|attack|armor|defense|strength|agility|intelligence|life|mana|crit|speed|resistance|damage|power|accuracy|block|dodge|hp|mp|lvl|level|req|requirement)/i.test(key)) {
          add(niceName(key), child);
        }
      }
    }
    // Prefer explicit stat containers; if none exist, scan the item for common stat fields.
    const containers = Object.entries(item).filter(([key, value]) => statContainers.test(key) && value != null);
    if (containers.length) containers.forEach(([key, value]) => walk(value, 0, niceName(key)));
    else walk(item);
    return result;
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
    tipSource.dataset.stats = JSON.stringify(extractItemStats(item));
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
