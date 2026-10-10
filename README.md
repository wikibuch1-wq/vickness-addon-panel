Vickness Addon Panel

Panel dodatków do Margonem.

Struktura repozytorium

userscript/vickness-addon-panel.user.js — skrypt użytkownika.

worker/README.md — dokumentacja usługi autoryzacyjnej Cloudflare Worker.

Autoryzacja

Dostęp do panelu jest weryfikowany przez usługę autoryzacyjną Cloudflare Worker oraz rolę na serwerze Discord.

Adres usługi:
https://vickness-auth.wikibuch1.workers.dev

Bezpieczeństwo

Repozytorium jest prywatne.

Nie zapisuj w repozytorium sekretów Discorda, tokenów sesji ani kluczy API.

Sekrety przechowuj w ustawieniach Cloudflare Worker.

Przed wydaniem nowej wersji sprawdź działanie logowania, weryfikacji roli i samego panelu.

Zachowuj historię zmian i opisuj istotne modyfikacje w commitach.

Aktualizacje

Automatyczne aktualizacje userscriptu nie są jeszcze skonfigurowane. Przed ich włączeniem należy przygotować bezpieczny sposób dostarczania pliku z prywatnego repozytorium.

Wersja

Aktualny plik userscriptu deklaruje wersję 1.2.0.
