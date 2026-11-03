// ==UserScript==
// @name         Riventia Addons - Loader
// @namespace    https://github.com/wikibuch1-wq/vickness-addon-panel
// @version      1.1.2
// @description  Ładuje Riventia Addons z GitHuba z przekazaniem API Tampermonkey
// @match        https://riventia.margonem.pl/*
// @match        http://riventia.margonem.pl/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      discord.com
// @connect      discordapp.com
// @connect      micc.garmory-cdn.cloud
// @connect      api.lootlog.pl
// @connect      lootlog.pl
// @connect      www.margonem.pl
// @connect      staticinfo.margonem.pl
// ==/UserScript==

(() => {
  'use strict';

  const MAIN_URL =
    'https://raw.githubusercontent.com/wikibuch1-wq/vickness-addon-panel/main/userscript/vickness-addon-panel.user.js';

  if (window.__vicknessLoaderStarted) return;
  window.__vicknessLoaderStarted = true;

  const report = (message) => {
    console.error('[Vickness Loader] ' + message);
  };

  if (typeof GM_xmlhttpRequest !== 'function') {
    report('Brak GM_xmlhttpRequest w loaderze. Sprawdź, czy skrypt działa w Tampermonkey.');
    return;
  }

  GM_xmlhttpRequest({
    method: 'GET',
    url: MAIN_URL,
    headers: { 'Cache-Control': 'no-cache' },
    onload: (response) => {
      if (response.status < 200 || response.status >= 300 || !response.responseText) {
        report('Nie udało się pobrać głównego skryptu. HTTP ' + response.status);
        return;
      }

      try {
        const runMain = new Function(
          'GM_getValue',
          'GM_setValue',
          'GM_xmlhttpRequest',
          'GM_addValueChangeListener',
          'GM_removeValueChangeListener',
          'unsafeWindow',
          response.responseText
        );

        runMain(
          GM_getValue,
          GM_setValue,
          GM_xmlhttpRequest,
          GM_addValueChangeListener,
          GM_removeValueChangeListener,
          unsafeWindow
        );

        console.info('[Vickness Loader] Główny skrypt został uruchomiony.');
      } catch (error) {
        report('Błąd uruchamiania głównego skryptu: ' + (error && error.stack ? error.stack : error));
      }
    },
    onerror: () => report('Błąd połączenia z GitHubem podczas pobierania głównego skryptu.'),
    ontimeout: () => report('Przekroczono limit czasu pobierania głównego skryptu.'),
    timeout: 30000
  });
})();
