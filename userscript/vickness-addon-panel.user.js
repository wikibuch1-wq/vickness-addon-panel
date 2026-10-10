// ==UserScript==
// @name         Vickness Addon Panel - Standalone
// @namespace    Vickness
// @version      1.1.10
// @description  Panel Vickness: Loot Glow, DC Wykrywacz i belka Lootlog 4.4.7
// @match        https://riventia.margonem.pl/*
// @match        http://riventia.margonem.pl/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      discord.com
// @connect      discordapp.com
// @connect      micc.garmory-cdn.cloud
// @connect      api.lootlog.pl
// @connect      lootlog.pl
// @connect      www.margonem.pl
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Wspólny stan przełączników dostępny dla obu wbudowanych dodatków.
window.__vicknessAddonEnabled = window.__vicknessAddonEnabled || { loot: true, dc: true, lootlog: true };

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

        panel.style.display = 'none';
        mini.style.display = 'flex';

        mini.style.left = `${state.miniX}px`;
        mini.style.top = `${state.miniY}px`;

        saveState();
    }

    function expand() {
        if (!panel || !mini) return;

        state.minimized = false;

        mini.style.display = 'none';
        panel.style.display = 'block';

        panel.style.left = `${state.panelX}px`;
        panel.style.top = `${state.panelY}px`;

        saveState();
    }

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

        // Po poprawnym rozpoznaniu NPC otwórz widok DC w panelu Vickness.
        // Nie pokazuj osobnego, pływającego widgetu DC.
        if (typeof window.__vicknessOpenAddonSettings === 'function') {
            window.__vicknessOpenAddonSettings('dc');
        } else {
            // Zabezpieczenie na wypadek, gdy menedżer dopiero się inicjalizuje.
            window.__vicknessPendingAddonSettings = 'dc';
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

        // Zamknięcie okna Wykrywacza minimalizuje cały panel Vickness.
        if (typeof window.__vicknessMinimizeStandalonePanel === 'function') {
            window.__vicknessMinimizeStandalonePanel();
        } else {
            // Zabezpieczenie, jeśli manager nie zdążył jeszcze się uruchomić.
            window.__vicknessPendingMinimizeStandalonePanel = true;
        }

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
// VICKNESS ADDON PANEL 1.1.10 — integracja Lootlog 4.4.7
// =============================================================
(() => {
  'use strict';
  if (location.hostname !== 'riventia.margonem.pl' || window.top !== window.self) return;
  if (window.__vicknessStandaloneManagerStarted) return;
  window.__vicknessStandaloneManagerStarted = true;

  const KEY = 'vickness_addon_panel_layout_v1';
  const FLAGS_KEY = 'vickness_addon_enabled_v1';
  const enabled = window.__vicknessAddonEnabled || (window.__vicknessAddonEnabled = { loot: true, dc: true });
  try {
    const saved = JSON.parse(localStorage.getItem(FLAGS_KEY) || '{}');
    if (typeof saved.loot === 'boolean') enabled.loot = saved.loot;
    if (typeof saved.dc === 'boolean') enabled.dc = saved.dc;
    if (typeof saved.lootlog === 'boolean') enabled.lootlog = saved.lootlog;
    else if (typeof enabled.lootlog !== 'boolean') enabled.lootlog = true;
  } catch (_) { if (typeof enabled.lootlog !== 'boolean') enabled.lootlog = true; }
  if (typeof enabled.lootlog !== 'boolean') enabled.lootlog = true;
  let layout = {};
  try { layout = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) {}

  function saveFlags() { try { localStorage.setItem(FLAGS_KEY, JSON.stringify(enabled)); } catch (_) {} }
  function saveLayout() { try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch (_) {} }
  function clamp(el, key, fx = 20, fy = 100) {
    const pos = layout[key] || {};
    const x = Number.isFinite(Number(pos.left)) ? Number(pos.left) : fx;
    const y = Number.isFinite(Number(pos.top)) ? Number(pos.top) : fy;
    el.style.left = Math.max(0, Math.min(x, innerWidth - el.offsetWidth)) + 'px';
    el.style.top = Math.max(0, Math.min(y, innerHeight - el.offsetHeight)) + 'px';
  }
  function savePos(el, key) {
    const r = el.getBoundingClientRect();
    layout[key] = { left: Math.round(r.left), top: Math.round(r.top) };
    saveLayout();
  }

  const root = document.createElement('div');
  root.id = 'vicknessStandaloneRoot';
  root.innerHTML = `
  <style>
    #vicknessStandaloneRoot { all:initial; font-family:Arial,sans-serif; }
    #vxStandalonePanel { position:fixed; z-index:2147483646; left:20px; top:100px; width:260px; max-width:calc(100vw - 16px); max-height:65vh; overflow:hidden; background:#0b0b0b; color:#eee; border:1px solid #c9a227; border-radius:8px; box-shadow:0 8px 26px #000b; font:12px Arial,sans-serif; }
    #vxStandalonePanel * { box-sizing:border-box; }
    #vxStandaloneHeader { position:relative; padding:12px 35px 11px 10px; text-align:center; background:#101010; border-bottom:1px solid #765b20; cursor:move; user-select:none; }
    #vxStandaloneBrand { color:#dfb943; font-size:16px; font-weight:bold; letter-spacing:2px; }
    #vxStandaloneSubtitle { margin-top:4px; color:#999; font-size:9px; }
    #vxStandaloneMin { position:absolute; right:7px; top:7px; border:1px solid #806321; border-radius:4px; background:#17140c; color:#dfb943; cursor:pointer; }
    .vxView { padding:8px; }
    .vxStandaloneRow { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:4px 0; padding:6px; border:1px solid #5f4b20; border-radius:5px; background:#141414; }
    .vxStandaloneName { color:#e0bd53; font-weight:bold; }
    .vxStandaloneDesc { display:block; margin-top:4px; color:#999; font-size:10px; }
    .vxStandaloneState { margin-top:4px; color:#aaa; font-size:9px; }
    .vxOpenSettings,.vxNavBtn { margin-top:7px; padding:5px 8px; border:1px solid #806321; border-radius:4px; background:#17140c; color:#dfb943; font-size:10px; cursor:pointer; }
    .vxOpenSettings:hover,.vxNavBtn:hover { background:#30250b; border-color:#d4af37; color:#ffe28a; }
    .vxToggle { position:relative; width:42px; height:23px; flex:0 0 42px; }
    .vxToggle input { position:absolute; opacity:0; width:1px; height:1px; }
    .vxToggle span { position:absolute; inset:0; border-radius:20px; background:#4b2929; border:1px solid #8b4545; cursor:pointer; transition:.15s; }
    .vxToggle span:before { content:''; position:absolute; left:2px; top:2px; width:17px; height:17px; border-radius:50%; background:#eee; transition:.15s; }
    .vxToggle input:checked + span { background:#315b36; border-color:#69b875; }
    .vxToggle input:checked + span:before { transform:translateX(19px); background:#dfffe2; }
    #vxStandaloneFooter { padding:7px; text-align:center; border-top:1px solid #3b3018; color:#777; font-size:9px; }
    #vxSettingsView { display:none; max-height:calc(65vh - 50px); overflow:auto; }
    #vxSettingsToolbar { display:flex; gap:6px; align-items:center; padding:7px 8px; border-bottom:1px solid #4b3b17; background:#111; }
    #vxSettingsToolbar .vxNavBtn { margin:0; }
    #vxCurrentSetting { color:#e0bd53; font-weight:bold; flex:1; text-align:center; }
    .vxSettingsSlot { min-width:0; padding:7px; }
    .vxSettingsSlot[hidden] { display:none!important; }
    #vxStandaloneMini { position:fixed; z-index:2147483646; display:none; align-items:center; gap:8px; padding:10px 14px; background:#0b0b0b; color:#dfb943; border:1px solid #c9a227; border-radius:5px; font:bold 12px Arial,sans-serif; cursor:pointer; user-select:none; }
    #vxStandaloneMini .diamond { color:#f0c64b; font-size:15px; }
    /* Widgety dodatków są osadzane wewnątrz okna Vickness zamiast pływać osobno. */
    #vxSettingsLoot #tmLootPanel { position:relative!important; left:auto!important; top:auto!important; right:auto!important; bottom:auto!important; width:100%!important; max-width:100%!important; height:auto!important; margin:0!important; z-index:1!important; box-shadow:none!important; border:0!important; border-radius:0!important; background:transparent!important; }
    #vxSettingsLoot #tmLootHeader { display:none!important; }
    #vxSettingsLoot #tmLootBody { display:block!important; padding:3px!important; }
    #vxSettingsLoot #tmLootPanel.tmCollapsed { width:100%!important; height:auto!important; }
    #vxSettingsDc #margDc221Panel { position:relative!important; left:auto!important; top:auto!important; right:auto!important; bottom:auto!important; width:100%!important; max-width:100%!important; margin:0!important; z-index:1!important; box-shadow:none!important; }
    #vxSettingsDc #margDc221Header { display:none!important; }
    #vxSettingsDc #margDc221Body { padding:4px!important; }
    .vxLootlogInfo { padding:8px; color:#b9ad84; font-size:11px; line-height:1.45; border:1px solid #5f4b20; border-radius:5px; background:#111; margin-bottom:8px; }
    .vxLootlogActions { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
    .vxLootlogActions button { min-width:0; padding:8px 5px; border:1px solid #806321; border-radius:4px; background:#17140c; color:#dfb943; font-size:10px; cursor:pointer; }
    .vxLootlogActions button:hover { background:#30250b; border-color:#d4af37; color:#ffe28a; }
    /* Sterowanie belką jest dostępne w panelu Vickness, bez osobnego pływającego menu. */
    #vickness-lootbar .vl-controls { display:none!important; }
  </style>
  <div id="vxStandalonePanel">
    <div id="vxStandaloneHeader"><div id="vxStandaloneBrand">VICKNESS</div><div id="vxStandaloneSubtitle">PANEL ZARZĄDZANIA DODATKAMI</div><button id="vxStandaloneMin" type="button" title="Minimalizuj">−</button></div>
    <div id="vxHomeView" class="vxView">
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName">Loot Glow</span><span class="vxStandaloneDesc">Podświetlanie lootu • kolor i intensywność</span><div class="vxStandaloneState" id="vxLootState"></div><button type="button" class="vxOpenSettings" id="vxLootOpen">USTAWIENIA</button></div><label class="vxToggle"><input id="vxLootSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName">DC Wykrywacz</span><span class="vxStandaloneDesc">Herosi, tytani, grzybki i Discord</span><div class="vxStandaloneState" id="vxDcState"></div><button type="button" class="vxOpenSettings" id="vxDcOpen">USTAWIENIA</button></div><label class="vxToggle"><input id="vxDcSwitch" type="checkbox"><span></span></label></div>
      <div class="vxStandaloneRow"><div><span class="vxStandaloneName">Belka lootów zintegrowana z Lootlogiem</span><span class="vxStandaloneDesc">Ostatnie herosy i legendarne łupy TheCrew</span><div class="vxStandaloneState" id="vxLootlogState"></div><button type="button" class="vxOpenSettings" id="vxLootlogOpen">USTAWIENIA</button></div><label class="vxToggle"><input id="vxLootlogSwitch" type="checkbox"><span></span></label></div>
      <div id="vxStandaloneFooter">BLACK &amp; GOLD • ADDON MANAGER</div>
    </div>
    <div id="vxSettingsView">
      <div id="vxSettingsToolbar"><button class="vxNavBtn" id="vxBackHome" type="button">← WSTECZ</button><span id="vxCurrentSetting">USTAWIENIA</span><button class="vxNavBtn" id="vxSwitchAddon" type="button">DRUGI DODATEK →</button></div>
      <div id="vxSettingsLoot" class="vxSettingsSlot" hidden></div>
      <div id="vxSettingsDc" class="vxSettingsSlot" hidden></div>
      <div id="vxSettingsLootlog" class="vxSettingsSlot" hidden>
        <div class="vxLootlogInfo">Belka pokazuje ostatnie zdobycze z Lootlog TheCrew. Sama belka pozostaje na ekranie gry, a jej obsługę znajdziesz tutaj. Przeciągnij belkę, aby zmienić jej położenie.</div>
        <div class="vxLootlogActions">
          <button type="button" id="vxLootlogRefresh">↻ ODŚWIEŻ TERAZ</button>
          <button type="button" id="vxLootlogLayout">↕ ORIENTACJA</button>
          <button type="button" id="vxLootlogScaleDown">− ZMNIEJSZ</button>
          <button type="button" id="vxLootlogScaleUp">+ POWIĘKSZ</button>
        </div>
      </div>
    </div>
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
    if (dc && dcSlot && !dcSlot.contains(dc)) dcSlot.appendChild(dc);
    if (dcMini) dcMini.style.setProperty('display', 'none', 'important');
    if (loot && lootSlot.contains(loot)) {
      loot.style.setProperty('display', enabled.loot ? 'block' : 'none', 'important');
      loot.classList.remove('tmCollapsed');
      const body = loot.querySelector('#tmLootBody');
      if (body) body.style.setProperty('display', 'block', 'important');
    }
    if (dc && dcSlot.contains(dc)) dc.style.setProperty('display', enabled.dc ? 'block' : 'none', 'important');
    const lootbar = getPanel('vickness-lootbar');
    if (lootbar) lootbar.style.setProperty('display', enabled.lootlog ? 'flex' : 'none', 'important');
    if (!enabled.lootlog) document.querySelectorAll('.vl-tip').forEach(tip => { tip.style.display = 'none'; });
  }
  function applyToggles() {
    root.querySelector('#vxLootSwitch').checked = !!enabled.loot;
    root.querySelector('#vxDcSwitch').checked = !!enabled.dc;
    root.querySelector('#vxLootlogSwitch').checked = !!enabled.lootlog;
    root.querySelector('#vxLootState').textContent = enabled.loot ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxDcState').textContent = enabled.dc ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    root.querySelector('#vxLootlogState').textContent = enabled.lootlog ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    dockWidgets();
  }
  function openSettings(which) {
    if (!['loot', 'dc', 'lootlog'].includes(which)) which = 'dc';
    enabled[which] = true;
    saveFlags();
    root.querySelector('#vxHomeView').style.display = 'none';
    root.querySelector('#vxSettingsView').style.display = 'block';
    root.querySelector('#vxSettingsLoot').hidden = which !== 'loot';
    root.querySelector('#vxSettingsDc').hidden = which !== 'dc';
    root.querySelector('#vxSettingsLootlog').hidden = which !== 'lootlog';
    root.querySelector('#vxCurrentSetting').textContent = which === 'loot' ? 'LOOT GLOW' : which === 'dc' ? 'DC WYKRYWACZ' : 'BELKA LOOTÓW';
    const order = ['loot', 'dc', 'lootlog'];
    const next = order[(order.indexOf(which) + 1) % order.length];
    root.querySelector('#vxSwitchAddon').textContent = next === 'loot' ? 'LOOT GLOW →' : next === 'dc' ? 'DC WYKRYWACZ →' : 'BELKA LOOTÓW →';
    applyToggles();
    setTimeout(dockWidgets, 100);
    setTimeout(dockWidgets, 600);
  }
  function backHome() {
    root.querySelector('#vxSettingsView').style.display = 'none';
    root.querySelector('#vxHomeView').style.display = 'block';
  }
  function showMini() {
    const panel = root.querySelector('#vxStandalonePanel');
    const mini = root.querySelector('#vxStandaloneMini');
    const r = panel.getBoundingClientRect();
    mini.style.left = Math.max(0, Math.min(r.left, innerWidth - mini.offsetWidth)) + 'px';
    mini.style.top = Math.max(0, Math.min(r.top, innerHeight - mini.offsetHeight)) + 'px';
    panel.style.display = 'none'; mini.style.display = 'flex';
    layout.minimized = true; savePos(mini, 'mini'); saveLayout();
  }
  function restore() {
    root.querySelector('#vxStandalonePanel').style.display = 'block';
    root.querySelector('#vxStandaloneMini').style.display = 'none';
    layout.minimized = false; saveLayout(); applyToggles();
  }
  function boot() {
    if (!document.body) { setTimeout(boot, 50); return; }
    if (!root.isConnected) document.body.appendChild(root);
    const panel = root.querySelector('#vxStandalonePanel');
    const mini = root.querySelector('#vxStandaloneMini');
    const header = root.querySelector('#vxStandaloneHeader');
    clamp(panel, 'main'); clamp(mini, 'mini');

    root.querySelector('#vxLootSwitch').addEventListener('change', e => { enabled.loot = e.target.checked; saveFlags(); applyToggles(); });
    root.querySelector('#vxDcSwitch').addEventListener('change', e => { enabled.dc = e.target.checked; saveFlags(); applyToggles(); });
    root.querySelector('#vxLootlogSwitch').addEventListener('change', e => {
      enabled.lootlog = e.target.checked; saveFlags(); applyToggles();
      if (enabled.lootlog) setTimeout(() => getPanel('vickness-lootbar')?.querySelector('.vl-refresh')?.click(), 100);
    });
    root.querySelector('#vxLootOpen').addEventListener('click', () => openSettings('loot'));
    root.querySelector('#vxDcOpen').addEventListener('click', () => openSettings('dc'));
    root.querySelector('#vxLootlogOpen').addEventListener('click', () => openSettings('lootlog'));
    root.querySelector('#vxBackHome').addEventListener('click', backHome);
    root.querySelector('#vxSwitchAddon').addEventListener('click', () => {
      const current = !root.querySelector('#vxSettingsLoot').hidden ? 'loot' : !root.querySelector('#vxSettingsDc').hidden ? 'dc' : 'lootlog';
      const order = ['loot', 'dc', 'lootlog'];
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

    // Po każdym odświeżeniu pokaż tylko mały przycisk Addons.
    panel.style.display = 'none';
    mini.style.display = 'flex';
    layout.minimized = true;
    saveLayout();
    applyToggles();

    // Interfejs dla dodatku DC: przy wykryciu moba pokaż główny panel
    // Vickness i od razu przejdź do ustawień/obsługi DC.
    window.__vicknessOpenAddonSettings = function(which) {
      restore();
      openSettings(which === 'loot' ? 'loot' : 'dc');
    };

    // Zamknięcie okna wykrywania minimalizuje cały panel Vickness.
    window.__vicknessMinimizeStandalonePanel = showMini;
    if (window.__vicknessPendingMinimizeStandalonePanel) {
      window.__vicknessPendingMinimizeStandalonePanel = false;
      showMini();
    }

    // Jeśli mob został wykryty zanim panel menedżera się uruchomił, obsłuż to teraz.
    if (window.__vicknessPendingAddonSettings) {
      const pending = window.__vicknessPendingAddonSettings;
      window.__vicknessPendingAddonSettings = null;
      window.__vicknessOpenAddonSettings(pending);
    }

    setInterval(applyToggles, 500);
    window.addEventListener('resize', () => { clamp(panel,'main'); clamp(mini,'mini'); savePos(panel,'main'); savePos(mini,'mini'); });
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
