Vickness Auth Worker

Dokumentacja usługi autoryzacyjnej Vickness Addon Panel.

Adres

https://vickness-auth.wikibuch1.workers.dev

Funkcje

Logowanie użytkownika przez Discord OAuth.

Sprawdzanie wymaganej roli Discord podczas logowania.

Wymiana jednorazowego kodu na sesję.

Weryfikacja sesji userscriptu.

Konfiguracja Cloudflare

Wymagane zmienne środowiskowe:

DISCORD_CLIENT_ID

DISCORD_GUILD_ID

DISCORD_ROLE_ID

DISCORD_REDIRECT_URI

Wymagane sekrety:

DISCORD_CLIENT_SECRET

SESSION_SECRET

Wymagane powiązanie KV:

AUTH_KV

Bezpieczeństwo

Nie zapisuj prawdziwych wartości sekretów w tym repozytorium.

Sekrety konfiguruj w panelu Cloudflare Worker.

Nie udostępniaj tokenów sesji ani kodów logowania.

Po zmianach testuj logowanie, jednorazowość kodu oraz dostęp użytkownika bez wymaganej roli.

Aktualizacje

Źródło Workera i mechanizm dostarczania aktualizacji userscriptu powinny być dokumentowane osobno. Samo repozytorium GitHub nie konfiguruje automatycznych aktualizacji skryptu.
