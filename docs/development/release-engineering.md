# Подготовка выпуска

Публичный адрес: https://halsab.github.io/isketatar/. Выпуск производится из main; локальная разработка и сборка сами ничего не публикуют. Внешние условия перечислены в external-acceptance.json. Пока там pending, выпуск не допущен.

## Кандидат и заключения

Использовать Node из .nvmrc и npm из packageManager. `npm ci`, `npm run check`, `npm run build` создают dist и quality-results/build-provenance.json. Build фиксирует базовый commit, признак незакоммиченных изменений, Node, release_id, manifest SHA-256, digest входов сборки и product scope. Локальная dirty-сборка допустима для разработки; опубликованный кандидат должен собираться из чистого checkout выбранного SHA.

product_artifact_sha256 включает реальные шаблонные байты HTML/JS/CSS/fonts/JSON, transport worker, версии/политики и shell graph. Из него исключён только built_at, который меняется после добавления отчёта отдельным коммитом. Полный release_id и build_inputs_sha256 включают timestamp и остаются уникальными для конкретного выпуска. Одобрение связывает и source scope, и исполняемый продукт; timestamp не подменяет кодовую идентичность.

После финальной сборки `node tools/build-review-package.mjs` создаёт пакет рецензента и отказывается работать при устаревшем scope/manifest. В итоговый отчёт включить product_scope_sha256, product_artifact_sha256, проверенный release_id и исполнителя. Сохранить настоящий отчёт в docs/development/acceptance-reports/; SHA-256 этого файла записать в report_sha256. Обновить соответствующую роль в external-acceptance.json. Формы, критерии и ответственность описаны в review-handoff.md; автоматическая проверка подтверждает связь файлов, но не содержание человеческого заключения.

`node tools/check-acceptance.mjs` проверяет структуру, права, привязку всех имеющихся одобрений и выводит ожидающие роли. `node tools/check-acceptance.mjs --require-approved` дополнительно блокирует публикацию при любом pending. Неверная дата, старый scope/продукт, изменённый отчёт, посторонний путь или symlink дают ошибку. Нельзя заменить pending на approved ради зелёного CI.

## Состав артефакта

Общая проверка tools/release-artifact.mjs использует тот же строгий manifest parser, что runtime. Разрешены текущий и максимум один предыдущий immutable package, стабильный sw.js и точные корневые копии текущего release. Проверяются размеры, SHA каждого ресурса, отсутствие лишних файлов/ссылок и общий предел. Контрольная сумма всего inventory охватывает также worker и root aliases, не входящие в assets manifest. Учебник, отчёты рецензентов, исходники, node_modules, карты исходников и секреты в публикацию не входят.

Последующие подшаги D11 добавляют получение last-good, упаковку, CI/deploy и smoke. На данном подшаге публикации и удалённые настройки не выполнялись.
