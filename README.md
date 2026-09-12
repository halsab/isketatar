# Иске имля

Татарча белүчеләр өчен иске татар язуын өйрәнү кушымтасы. Дәресләр, күнегүләр, уку, сүзлек һәм кабатлау — бер урында.

Реализована статическая React/TypeScript PWA: полный курс, локальный прогресс, резервные копии, офлайн-пакет и согласованное обновление. Инженерная часть дорожной карты D0–D12 подготовлена к итоговому допуску. Публичного выпуска ещё нет: татарская и предметная рецензии, пилот и реальные устройства/ассистивные технологии ожидают внешней приёмки. Права на материалы подтверждены владельцем.

Основной источник: Әхмәд хәзрәт Сабыр / А. Р. Сабиров, «Иске татар имлясы буенча дәреслек», третье издание, «Иман», Казань, 2020, 88 с.

## Разработка и выпуск

Нужны Node из [.nvmrc](.nvmrc), npm из packageManager в [package.json](package.json) и Python3. В корне репозитория:

```sh
npm ci
npm run dev
```

Открыть `/isketatar/` на адресе Vite. Для проверки production: `npm run check`, `npm run build`, затем `npm run preview`. `npm run test:e2e` использует Chromium/Firefox/WebKit; перед первым запуском выполнить `npx playwright install chromium firefox webkit` (Linux CI также устанавливает системные зависимости через `--with-deps`). Не пересобирать dist во время браузерных тестов. Все эти команды локальны и ничего не публикуют.

- [Журнал реализации по шагам](docs/development/implementation.md) · [Результаты и границы проверок](docs/development/quality-report.md)
- [Подготовка выпуска и CI/CD](docs/development/release-engineering.md) · [Условия выпуска](docs/development/release-conditions.md)
- [Пакет внешней приёмки](docs/development/review-handoff.md) · [Сопровождение и инциденты](docs/development/maintenance.md)
- [Яңалыклар](RELEASE_NOTES.tt.md) · [Внутренний changelog](CHANGELOG.md)

После настоящего одобрения всех внешних условий для актуального кандидата push в защищённую main запускает проверки, Pages и внешний smoke. Пока статусы pending, публикация блокируется. Workflow подготовлены; push и выпуск выполняет владелец. Публичный адрес — [halsab.github.io/isketatar](https://halsab.github.io/isketatar/), обратная связь — [Issues](https://github.com/halsab/isketatar/issues). В публичный issue не прикладывать файл личного прогресса.

## Контракты приложения

Исходные требования сохраняются в [дорожной карте D0–D12](docs/production/11-development-roadmap.md), [описании продукта](PRODUCT.md) и [приёмке документации](docs/production/12-completion-audit.md). Документальный аудит относится к спецификациям; фактические проверки приложения перечислены отдельно выше.

- [План документов и требования](docs/production/00-plan.md)
- [Архитектура](docs/production/01-architecture.md) · [Контракты данных](docs/production/02-data-contracts.md)
- [Учебные механики](docs/production/03-learning-mechanics.md) · [Приёмочные случаи](docs/production/learning-cases.json)
- [Дизайн](DESIGN.md) · [Дизайн-система](docs/production/04-design-system.md) · [Токены](docs/production/design-tokens.json)
- [Маршруты](docs/production/05-routing.md) · [Экраны](docs/production/06-screen-specs.md) · [Татарские дополнения интерфейса](docs/production/ui-copy-additions.json)
- [Ввод, анимация и доступность](docs/production/07-interaction-accessibility.md)
- [PWA и платформы](docs/production/08-pwa-platforms.md) · [Безопасность и сохранность](docs/production/09-security-reliability.md)
- [Качество и выпуск](docs/production/10-quality-release.md) · [Покрытие требований](docs/production/requirements-traceability.json)

Проверка спецификаций: `python3 tools/validate_production_docs.py`. Она дополняет проверку содержания и не запускает приложение.

## Документация

- [Итоговый состав, проверки и границы готовности](docs/09-completion-audit.md)
- [План подготовки и критерии завершения](docs/00-work-plan.md)
- [Принятые требования](docs/01-product-brief.md)
- [Исследование аналогов и методики](docs/01-research.md)
- [Источники](sources/README.md)
- [Редакционная политика](docs/02-editorial-policy.md)
- [Решения по ошибкам и спорным местам книги](docs/02-source-decisions.md)
- [Программа курса](docs/03-curriculum.md)
- [Формат данных](docs/04-content-format.md)
- [Практика и оценивание](docs/05-assessment.md)
- [Словарь и поиск](docs/06-lexicon.md)
- [Чтение и аудиосценарии](docs/07-reading-media.md)
- [Контракт PWA и интерфейса](docs/08-app-contract.md)

## Учебный комплект

53 урока (46 основных и 7 вводных), 145 правил, 361 пример и 436 заданий уроков. Отдельно подготовлены 18 вопросов диагностики, итоговая проверка из20вопросов, 12подборок чтения и словарь из540исходниковых записей. Чтение и словарь связаны с источниками, а неподтверждённые формы не используются как строгие ключи.

Материалы находятся в `content/`: `lessons`, `exercises`, `assessment`, `lexicon`, `readings`, `reference`, `interface` и `media`. [Манифест выпуска](content/manifest.json) перечисляет обязательные текстовые ресурсы. Аудио представлено готовыми сценариями и является дополнительным; записанных файлов нет.

Учебный текст и сообщения интерфейса — на татарском. Проектная документация для разработки — на русском. Историческая орфография, её чтение и современное значение хранятся раздельно. Основная аудитория уже знает татарский; два маршрута отличаются знакомством с арабской графикой.

## Проверка содержания

```sh
python3 tools/build_indexes.py
python3 tools/validate_content.py
```

Используется только стандартная библиотека Python. Эти инструменты собирают указатели и проверяют содержание; они не являются реализацией сайта. Последняя строгая проверка: 0ошибок. Источниковая и редакционная проверка не подменяет научную рецензию специалиста или будущий пилот на учениках.
