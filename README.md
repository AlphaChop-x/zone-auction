# Zone Auction

Запускаемая основа неофициального мониторинга аукциона **STALZONE**, регион **RU**,
для лабораторной №6. React + TypeScript + Vite + React Router и минимальный
ASP.NET Core 10 backend. Светлое оформление, красный акцент и локальный Manrope
сохранены из предыдущих лабораторных.

**Справочник и лоты пока не подключены.** Поиск и категории отключены, вместо
демонстрационных цен показано начальное состояние. `/api/health` проверяет только
наш backend, а не авторизацию или доступность внешнего API.

## Требования и запуск

- .NET SDK 10 (проверено на 10.0.302).
- Node.js 24 LTS с npm (проверено на Node 24.20.0, npm 11.13.0).

Команды выполняются из корня этого репозитория. Первый терминал:

```sh
dotnet run --project backend/ZoneAuction.Api.csproj
```

Backend: <http://localhost:5080/api/health>, ожидается `{"status":"ok"}`.

Второй терминал:

```sh
cd frontend
npm ci
npm run dev
```

Главная: <http://127.0.0.1:5173/>. Оба процесса должны работать одновременно.
Vite слушает локальный IPv4 и проксирует `/api` на `http://localhost:5080`.
Браузер обращается к своему origin; реквизиты внешнего API ему не нужны.
Остановка каждого процесса — `Ctrl+C` в соответствующем терминале.

## Серверные настройки

Для текущего запуска реквизиты **не требуются**. Для будущей интеграции:

1. Скопируйте `backend/appsettings.Local.example.json` в
   `backend/appsettings.Local.json`.
2. Впишите ID и секрет только в локальный файл. Он исключён из Git.
3. Либо задайте переменные окружения в терминале backend (PowerShell):

```powershell
$env:Stalcraft__ClientId = '<ваш ID>'
$env:Stalcraft__ClientSecret = '<ваш локальный секрет>'
dotnet run --project backend/ZoneAuction.Api.csproj
```

Это placeholders, не настоящие реквизиты. Переменные окружения имеют приоритет
над локальным JSON. После изменения настроек перезапустите backend.
Не помещайте реквизиты во frontend, `VITE_*`, README или отслеживаемые файлы.

Публичные настройки находятся в `backend/appsettings.json`: регион RU,
`https://eapi.stalzone.com/`, OAuth `https://exbo.net/oauth/token`, тайм-аут 15 с.
Ключ секции `Stalcraft` сохранён для согласованных имён переменных окружения.
Настройки подготовлены, но OAuth и запросы лотов ещё не реализованы.

## Проверки и сборка

```sh
dotnet build backend/ZoneAuction.Api.csproj
cd frontend
npm run typecheck
npm run build
```

Для просмотра собранного frontend из `frontend/`:

```sh
npm run preview -- --host 127.0.0.1
```

`preview` проверяет статическую сборку, это не production-размещение и не
полноценный совместный запуск: `/api` proxy настроен для `npm run dev`.

## Структура и предыдущая работа

```text
frontend/               React-приложение, маршруты и запросы к собственному API
backend/                ASP.NET Core, health и серверные настройки
assets/css/             исходные стили, Manrope и лицензия
assets/images/          исходные иллюстрации
assets/js/              прежняя логика демонстрационного каталога
tempPage/index.html     сохранённая вёрстка лабораторных №4–5
docs/mvp-scope.md        согласованный объём и отложенные функции
docs/ai-work-log.md      фактические изменения, проверки и ограничения
```

Старую страницу можно открыть как `tempPage/index.html` или через
`python -m http.server 8000` → <http://localhost:8000/tempPage/>.
Её шесть примеров, цены и количество лотов — материал макета, **не актуальный
аукцион**. В активном React-приложении они не используются.

Маршруты `/items/:itemId/lots` и `/items/:itemId/lots/:lotId` подготовлены
как страницы «Лоты ещё не подключены». Неизвестный маршрут показывает 404-экран.
Подробности выполнения и ручной чек-лист — в `docs/ai-work-log.md`.
