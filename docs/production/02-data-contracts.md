# Контракты содержания и пользовательских данных

Статус: принято для будущей реализации. Документ согласован с [архитектурой](01-architecture.md). JSON Schema, runtime-адаптер, IndexedDB и код приложения ещё не реализованы. Здесь определены записи и инварианты; вычисления оценок, переходов и расписания задаёт [механика обучения](03-learning-mechanics.md).

## Общие типы и правила

Имена сохраняемых полей — `snake_case`. JSON — UTF-8. В пользовательских полях — татарский текст; технические ID и редакционные поля не выводятся автоматически.

| Тип | Контракт |
|---|---|
| `ContentId` | Непустая строка до 128 символов; должна существовать в соответствующем каталоге. Регистр значим. Примеры: V04, Q-V04-07, EX-V04-05, READ-F01, lex-55-046 |
| `LocalId` | UUID, создаваемый вне чистой предметной функции; session_id, presentation_id, tab_id, data_generation |
| `Revision` | Целое безопасное число >=0; сравнивается на равенство для CAS |
| `Hash` | SHA-256, 64 строчных шестнадцатеричных символа |
| `TimeMs` | Целое число UTC epoch milliseconds, >=0 и <=8_640_000_000_000_000; локальные даты не принимаются вместо него |
| `Version` | Положительное целое для схем; SemVer-строка для app_version/min_reader_version; непрозрачная строка для content_version/release_id |
| `Profile` | book_jadid_10, book_jadid_6, book_kadimi, book_yanga, loan_original, book_unspecified |
| `SourceSpan` | [начало, конец], целые, 1<=начало<=конец; включительный диапазон LF-строк источника |

Значение `null` применяется только там, где разрешено таблицей. `undefined`, NaN, Infinity и даты, записанные произвольной строкой, не являются сохраняемыми значениями. Массивы ID, обозначающие множество, не содержат повторов. Упорядоченные массивы не сортируются без явного указания.

Runtime-модели и обменный конверт закрыты: неизвестные поля отвергаются схемой. Авторские исходные JSON имеют отдельные схемы: проверяются известные поля и связи, дополнительные редакционные аннотации могут сохраняться в исходнике, но в runtime входят только через явную проекцию. Нельзя пропускать произвольный объект из исходника в React через spread.

## Два манифеста и четыре версии

`content/manifest.json` — существующий редакционный манифест. Он содержит schema_version, content_version, language, assets с path/bytes/sha256/required, total_bytes и editorial_only_paths. Выпуск `2026.09.11.1` содержит 31 обязательный ресурс; приложение не зашивает это число в код.

Будущая сборка создаёт отдельный **release manifest**:

| Поле | Тип и ограничение |
|---|---|
| release_id | Уникальный ID неизменяемой сборки |
| app_version | SemVer программы |
| content_version | Версия редакционного пакета |
| content_schema | Версия runtime-каталога |
| progress_schema | Версия структуры пользовательских записей и обменного JSON |
| min_reader_version | Минимальная совместимая версия приложения |
| base_path | Нормализованный project path, например /isketatar/ |
| built_at | TimeMs, время сборки |
| assets | Массив {url,sha256,bytes,kind,required}; URL уникальны и находятся внутри base_path; bytes — целое >=0 |
| shell_assets | Уникальные URL подмножества assets для автоматической оболочки; включает HTML, recovery, стартовые JS/CSS, core и интерфейсный шрифт |
| question_revisions | Объект QuestionId → Hash, для каждого Q/D/F/RQ текущего выпуска |
| policy_versions | Полный объект версий предметных политик, описанный ниже |

`kind`: shell, script, style, font, content, media. Обязательные assets включают shell/JS/CSS/шрифты и нужное содержание. Сам release manifest и service worker не включают собственный хеш в себя; порядок формирования worker/precache определяет PWA-контракт. Не вычислять самореферентный хеш. Реализация D8.1 вычисляет release_id из отсортированного набора исходных файлов сборки с маркером собственного пути и стабильного built_at; затем подставляет ID и вычисляет настоящие SHA-256 поставляемых тел. Имя asset chunk само по себе не является проверкой целостности. Корневой release-manifest.json служит указателем опубликованного кандидата; shell загружает только manifest своего неизменяемого адреса.

Различаются app_version, content_version, progress_schema и физическая `db_version` IndexedDB. Изменение индекса БД не обязано менять формат экспорта. Замена ключа вопроса не требует новой физической БД.

Пакет immutable: уже опубликованный release_id не переиспользуется с другими байтами. Сеанс прикреплён к конкретному release_id и не получает новый текст во время ответа. Источниковый DOC, аудиты и инструменты не копируются в dist. **sources/sections.json — явное обязательное runtime-исключение**: оно нужно для имён разделов и происхождения. Полный sources/textbook.txt не входит в обязательный офлайн-пакет.

## Версии политик и ревизия вопроса

`policy_versions` содержит ключи grading, normalization, mastery, diagnostic, final, review, exposure, release_access, search, import. Значения — устойчивые строки, первоначально соответственно `grading/1`, `tt-reading/1`, `lesson-mastery/1`, `diagnostic/1`, `final/1`, `review/1`, `exposure/1`, `release-access/1`, `dictionary-search/1`, `progress-import/1`. Изменение поведения повышает версию соответствующей политики. Номер выпуска приложения не подменяет эти сведения.

`grading_revision` — вычисленный Hash проверяемого вопроса. Канонический объект включает:

- type, grading, prompt_tt, stimulus, profile;
- options, отсортированные по устойчивым IDs; тексты опций сохраняются;
- accepted_answers с правилами канонизации ниже;
- политику нормализации и её opt-in параметры;
- разрешённый видимый контекст, необходимый до ответа;
- для RQ: source_reading_id, line_ids и разрешённые display_form всех показываемых контекстных строк вместе с их IDs и профилем. Изменение текста под прежним RQ-ID меняет ревизию;
- для вопроса урока — разрешённые отображаемые части связанных примеров, если они действительно служат контекстом задания. Скрытое готовое чтение не включается в UI под видом контекста.

Каноническая сериализация: ключи объектов рекурсивно сортируются; порядок содержательных массивов сохраняется; результат кодируется UTF-8. Объекты опций сортируются по ID, потому что порядок UI перемешивается. Для exact_option/set ключи рассматриваются как множества и сортируются. В tt_reading варианты — множество нормализованных допустимых строк. В segments сортируется множество вариантов, **порядок частей внутри каждого варианта сохраняется**. Пустые части запрещены. Значимые Unicode-буквы, огласовки, дефисы и различия татарских гласных не удаляются.

explanation_tt, hints_tt, source_lines и редакционная заметка не входят в grading_revision сами по себе. Изменение объяснения не обнуляет освоение. Изменение ключа, формулировки, опции или читаемого контекста не маскируется прежней ревизией. Схема канонизации имеет версию grading; произвольная сериализация JS-объекта не является контрактом хеша.

## Runtime-каталог содержания

Один `ContentCatalog` содержит Map-индексы по ID: lessons, rules, examples, questions, readings, reading_lines, lexicon, course_vocabulary, source_sections. Также содержит ordered routes, профили, интерфейсные строки и release manifest. Статический каталог не копируется в БД прогресса.

### Маршруты и уроки

Источник — curriculum.json и lessons/M*.json. Runtime-урок содержит id, module_id, title_tt, prerequisites[], source_sections[], required_for_completion, skills[], goals_tt[], theory_tt[], rules[], examples[], pitfalls_tt[], outcomes_tt[]. Карта программы — источник module_id, route и required_for_completion; title_tt и prerequisites полного урока сверяются с ней. Уточнение D2 по фактическому корпусу: source_sections программы содержит также обзорные разделы, а полный урок добавляет точные источники примеров. Runtime сохраняет упорядоченное объединение обоих списков (сначала программа), проверяя существование каждого ID; исходные файлы не переписываются. В замороженной редакции это затрагивает B06, C01, C03, V01, V02, V08, V09, K01, K02, K05, K06.

Дополнительные известные поля урока сохраняются явно: letter_groups={sun:string[],moon:string[]}, component_inventory=[{form,function_tt}], external_sources=[{url,supports_tt}]. Это существующие данные L07/L09, а не повод для универсального CMS.

Маршрут — упорядоченный массив уникальных LessonId. В текущем выпуске arabic_reader содержит 46 уроков, new_to_script —53. Диагностика не является уроком маршрута. `required_for_completion` применяется только к выбранному массиву route; B-уроки нельзя включить в знаменатель arabic_reader одним глобальным фильтром.

### Правило и пример

Правило: id, statement_tt, scope_tt, source_sections[]. Индекс rules-index ссылается на него; второй независимой копии формулировки нет.

Пример: id, source_form, display_form, reading_tt:string|null, meaning_tt, explanation_tt, source_lines, profile, status, normalization_note, usage; optional reading_note_tt. `usage` имеет три значения:

- demonstration — обычный разобранный пример;
- reference — доступный расширенный разбор;
- assessment_source — закрытый источник проверки.

`status`: authored, source_checked, editorial_checked, source_only, disputed. Статус не заменяет роль показа или eligibility. null reading_tt не означает отсутствие конструкции: EX-L07-05 имеет готовый вопрос Q-L07-07 о фә, но не становится свободным вопросом о полном чтении имени.

Исходная форма хранится буквально, display_form не пересчитывается общим «исправителем». Сведения об источнике нужны для проверки происхождения, а не для автоматического принятия всех исходных написаний.

### Проверяемый вопрос

Общий runtime-вопрос: id, origin, type, grading, prompt_tt, stimulus, options[], accepted_answers[], explanation_tt, hints_tt[], skill, difficulty, profile, grading_revision. `origin`: course, diagnostic, final, reading. `skill`: letter, reading, rule, morphology; difficulty — целое 1…3.

| Сочетание | Допустимый ответ и ключ |
|---|---|
| choice / exact_option | Один ID существующей опции; accepted_answers содержит ровно один ID |
| select_many / set | Множество существующих option IDs; правильный ключ непустой |
| reading / tt_reading | Текст; options=[]; хотя бы один непустой явно заданный ключ |
| segment / segments | Текст с разделителем +; options=[]; варианты разбиения заданы явно, пустых частей нет |

В данных options={id,text_tt}; уникальны и IDs, и видимые тексты внутри одного вопроса. Нельзя сравнивать видимую позицию опции вместо ID. Неправильная опция не становится словарной статьёй или допустимой орфографией.

Связи зависят от origin:

- course: lesson_id, rule_ids[], source_example_ids[], source_lines, assessment_role=practice|transfer;
- diagnostic/final: group, recommend_lessons[], source_form, source_lines; assessment_role=diagnostic|final;
- reading: source_reading_id, line_ids[], assessment_role=reading_practice|final; профиль/происхождение разрешаются через текст.

У RQ нет обязательного lesson_id; адаптер не выдумывает его. `final.items` содержит 16 вопросов, а reading_text_ids и question_ids текстов добавляют четыре уже существующих RQ. Один ID не копируется в другую коллекцию как новая задача.

По умолчанию allow_terminal_punctuation=false; если будет разрешён, параметр входит в grading_revision. Ключи Q-L08-02 явно принимают «тәрҗемә-и хәл» и «тәрҗемәи хәл»; это не общее разрешение удалять дефисы. Q-A06-09 принимает «бар + дык», а не «бар + ды + к».

### Чтение и словарь

Текст: id, title_tt, level, role, lesson_ids[], profile, provenance, instructions_tt, lines[], help_order[], question_ids[]. Строка: id, source_form, display_form, reading_tt, meaning_tt, source_lines, reading_status, words[]. Слово: surface, reading_tt, meaning_tt, explanation_tt, lexicon_id:string|null.

В runtime слову добавляются word_id=`line_id:ordinal`, ordinal и диапазон в display_form. ordinal слова нумеруется с 0 (READ-01-L01:0 — первое слово); это отличается от ordinal предъявления, которое начинается с 1. Диапазон считается последовательным проходом с курсором; повторяющееся surface нельзя каждый раз искать от начала строки. Координаты JS — UTF-16 code units, границы не разрывают surrogate pair/combining sequence. Для сохранённой позиции нужны line_id и revision строки; старый ordinal не применяется к изменённой строке молча.

Runtime-запись словаря сохраняет id, source_form, display_form, reading_tt, meaning_tt, section/source, origin.profile, status, eligibility, constraints, links, forms и editorial_notes_tt. Разрешение показа определяется eligibility.dictionary_visible; практики — eligibility.practice_allowed **и наличием подготовленного QID**. Archive не попадает в пользовательский каталог. Reference с null reading_tt показывается со строкой «Мәгънәсе чыганак буенча бирелде. Татарча укылышы күрсәтелмәгән.»

course_vocabulary содержит существующие id, lesson_id, source_example_id, display_form, reading_tt, meaning_tt, profile, source_lines, status, kind, source_dictionary_ids[], release, question_ids[]. release=with_lesson|after_linked_question. Правила момента открытия принадлежат механике; сам факт нахождения объекта в пакете не открывает его.

251 из 258active-записей основного словаря сейчас не имеют точной связи через source_dictionary_ids с готовым вопросом. Для них доступна закладка; разрешение редактора не превращается в автогенерацию теста. У عالم сохраняются lex-55-046 «галим» и lex-55-158 «галәм». Группировка выдачи сохраняет дочерние IDs, разные смыслы и источники.

## Сохраняемые ответы

`AnswerValue` — строго один вариант:

| kind | Поля |
|---|---|
| option | option_id:ContentId |
| set | option_ids:ContentId[], уникальные; пустое множество допустимо как отправленный неверный ответ |
| text | text:string, максимум 4096UTF-16 code units |
| segments | text:string с явным +, максимум 4096UTF-16 code units |
| unknown | Дополнительных полей нет; явное «Әлегә белмим» |

Отсутствие черновика обозначается null, а не unknown. kind обязан соответствовать вопросу, кроме unknown, разрешённого всем типам. Для text пустую/пробельную строку UI не отправляет; пользователь может выбрать unknown. Массив опций всегда проверяется по плану конкретной ревизии.

`NormalizedAnswer`: option_id для option; отсортированный массив ID для set; строка для text; упорядоченный массив строк для segments (пустая часть допускается только как сохранённый неверный ввод, не как правильный ключ); null для unknown. Raw и normalized не подменяют друг друга. Нормализация не исправляет автоматически татарские буквы и не использует поисковый индекс.

## Session и Presentation

### Session

| Поле | Тип / инвариант |
|---|---|
| session_id | LocalId, primary key; повторный старт всегда новый ID |
| kind | lesson_cycle, review, diagnostic, final, reading_practice |
| status | active, paused, submitted, abandoned, incompatible |
| revision | Revision, повышается при изменении сеанса |
| data_generation | LocalId текущего набора пользовательских данных |
| release_id, content_version, content_schema | Неизменяемый пакет сеанса |
| policy_versions | Снимок политик выпуска |
| lesson_id | LessonId для lesson_cycle, иначе null |
| reading_ids | ReadingId[] для чтения/итога, иначе [] |
| diagnostic_imla_deferred | boolean; true только для diagnostic при явном завершении после script; отложенные imla не входят в score/рекомендации |
| assessment_help_opened_at | TimeMs или null; для diagnostic/final факт открытия учебной помощи во время незавершённого сеанса, остальные kinds всегда null |
| reading_help | Массив {line_id,word_id,kind,opened_at}; kind=letters,rule,reading,meaning; word_id может быть null для всей строки; для reading_practice, иначе [] |
| route_at_start | arabic_reader, new_to_script или null; история выбора, не текущая настройка |
| question_plan | Непустой массив PlanItem, порядок неизменяем после старта |
| active_presentation_id | LocalId текущего предъявления либо null |
| started_at, updated_at | TimeMs |
| submitted_at | TimeMs только для submitted, иначе null |
| abandoned_at | TimeMs только для abandoned, иначе null |
| incompatibility_reason | null или технический код отсутствия совместимого контента |

PlanItem={question_id,grading_revision,first_presentation_id,option_order,assessment_role}. question_id уникален в сеансе. option_order — перестановка всех IDs опций, для открытого ответа []; одна перестановка фиксируется на сеанс. assessment_role копируется из текущего источника для проверки состава. Для lesson_cycle сначала practice, затем transfer; новые Q-09 не определяют роль своим номером.

Перезапуск создаёт новый session_id; дополнительная session generation не вводится. Явный restart переводит прежний незавершённый сеанс в abandoned. «Саклап чыгу» переводит active в paused; начало другого сеанса сохраняет предыдущий как paused вместе с черновиком. Одновременно active не более одного; control.active_session_id указывает только на него. Для одной цели допускается не более одного active/paused: цель — пара kind+lesson_id для урока, kind+единственный reading_id для обычного чтения, либо singleton kind для diagnostic/final/review. При повторном открытии цели предлагается resume; новый параллельный черновик той же цели не создаётся. submitted/abandoned/incompatible сохраняются в истории.

### Presentation

| Поле | Тип / инвариант |
|---|---|
| presentation_id | LocalId, primary key |
| session_id, question_id, grading_revision | Ссылки на Session и её PlanItem |
| ordinal | Целое >=1 внутри пары session/question;1 — первая попытка цикла |
| revision | Revision записи черновика |
| status | draft, submitted или skipped; skipped допустим только в review |
| created_at | TimeMs |
| shown_at | TimeMs|null; создание плана ещё не означает показ вопроса |
| draft_answer | AnswerValue|null |
| draft_updated_at | TimeMs|null |
| assistance | Assistance, определён ниже |
| familiarity_at_show | {question_seen_before:boolean, material_seen_before:boolean, reading_exposed_before:boolean} |
| feedback_opened_at | TimeMs|null |
| feedback_acknowledged_at | TimeMs|null |

При повторе после обратной связи создаётся новое Presentation с ordinal+1. Первая предъявленная попытка остаётся неизменной для расчёта самостоятельности. Для диагностики/итога редактирование ответов до окончательной отправки — черновик первоначального Presentation, а не цепочка оценённых угадываний.

Пропуск в review переводит показанное draft-предъявление в skipped, очищает draft_answer и фиксирует draft_updated_at. Attempt и feedback не создаются, ReviewCard не меняется. План остаётся прежним; после обработки остальных карточек Session получает submitted, даже если некоторые первые предъявления skipped. Активный указатель никогда не указывает на skipped; импорт проверяет эти связи. Это уточнение формата первого выпуска, до публичного распространения прогресса приложения.

`Assistance`={hint_indices:number[],rule_opened_at:TimeMs|null,reading_opened_at:TimeMs|null,meaning_opened_at:TimeMs|null,answer_revealed_at:TimeMs|null,reference_opened_at:TimeMs|null}. hint_indices уникальны и входят в hints_tt данного вопроса. Для подсказок также сохраняется first_hint_at:TimeMs|null. Каждый ненулевой момент относится к текущему предъявлению и не может быть раньше shown_at.

Помощь записывается при открытии, **до будущей отправки ответа**. Перезагрузка между hint и submit не очищает её. Материал, включённый автором в prompt, не является запрошенной помощью. Например Q-B07-07 уже содержит чтение «аралаша», но проверяет букву; следующий Q-V01-07 не получает обещания абсолютно нового слова.

## Attempt: неизменяемое событие отправки

Primary key Attempt — **presentation_id**. Отдельный attempt_id не нужен: одно предъявление допускает одну отправку. Это idempotency key двойного клика/повторного callback.

| Поле | Тип / инвариант |
|---|---|
| presentation_id, session_id | LocalId |
| question_id, grading_revision | Точная задача и её ревизия |
| ordinal | Снимок ordinal предъявления |
| release_id, content_version, policy_versions | Контекст вычисления |
| answer_raw | AnswerValue |
| answer_normalized | NormalizedAnswer |
| grade | correct, incorrect, unknown |
| assistance_before_submit | Снимок Assistance |
| familiarity_at_show | Снимок знакомства |
| first_submission_in_cycle | boolean, соответствует ordinal=1 для данной пары |
| independent_correct | boolean, вычисляется политикой, не вводится UI |
| submitted_at | TimeMs |
| elapsed_ms | Целое >=0 или null; необязательная метрика, не оценка |

Attempt после commit не переписывается ради исправленного ответа. Reveal после submit не меняет assistance_before_submit задним числом. При смене ключа старый Attempt остаётся связан с прежней grading_revision. «Самостоятельно сейчас» и «раньше не видел» — разные факты.

Обычный submit атомарно создаёт Attempt, переводит Presentation в submitted, обновляет Session и необходимые exposure/review записи. Submit диагностики/итога атомарно фиксирует все ответы и submitted Session; отсутствие ответа преобразуется в unknown только после явного подтверждения окончательной отправки неполного сеанса. До этого null означает неотвеченный черновик.

## Exposure и доступ к материалу

Exposure — агрегированный факт показа, не лемматизатор и не балл:

| Поле | Тип / ограничение |
|---|---|
| exposure_key | Строка primary key; ресурсный ключ либо material:Hash |
| kind | lesson, reading, question, example, reading_line, reading_word, dictionary_entry, material |
| resource_id | Существующий ID/word_id либо null для material |
| material_key | Hash|null |
| exposure_policy | Версия exposure |
| first_seen_at, last_seen_at | TimeMs, first<=last |
| first_reading_exposed_at | TimeMs|null |
| first_meaning_exposed_at | TimeMs|null |
| first_answer_exposed_at | TimeMs|null |
| first_completed_at | TimeMs|null; только kind=reading, явная отметка прочтения, отдельно от ответов RQ |

Консервативный material_key вычисляется из NFC-формы с **явно известным разложением совместимых презентационных форм** и удалением tatweel. Нет глобальной NFKC-мутации контента, удаления всех marks или смешения татарских гласных. Есть два вида агрегированного ключа: visual=Hash(тип,форма,профиль) для знакомства с написанием и reading=Hash(тип,форма,профиль,нормализованное конкретное чтение) для раскрытого чтения. У них разные хеши и общий kind=material. При показе формы пишется visual Exposure; при раскрытии подтверждённого чтения — дополнительно reading Exposure. material_seen_before проверяет visual; reading_exposed_before — соответствующее допустимое чтение данного контекста. Разные чтения омографа не сливаются. Сырая формулировка meaning_tt и example_id не входят в material hash: B07/V01 должны узнавать одну форму при разных пояснениях. Правило построения и таблица допустимых совместимых преобразований версионируются. Исходный текст не изменяется.

Первое фактическое открытие теории записывает lesson exposure с resource_id=lesson_id. first_started_at урока определяется минимумом first_seen_at этого факта и started_at его учебных сеансов; открытие теории без упражнения поэтому не теряется. Создание плана или prefetch не считается открытием.

Надёжное утверждение UI — первая попытка конкретного вопроса. Отсутствие Exposure не доказывает, что человек никогда не видел слово. Для доступа after_linked_question используется подтверждённая отправка/reveal соответствующего вопроса, не эвристическое сходство material_key. Поиск, доступ и оценка имеют разные функции.

Помощь из текста связывается с line_id/word_id и незавершёнными вопросами этой строки. Session.reading_help сохраняет события до первого показа соответствующего RQ; Assistance текущего Presentation не получает невозможное время раньше shown_at. Session.assessment_help_opened_at отмечает учебный режим всех active/paused диагностик/итогов одной транзакцией по механике раздела 6; это не очищаемый визуальным скрытием флаг. Полное чтение строки не открывается в итоговом сеансе до завершения. Источниковая карточка офлайн показывает сохранённый source_form, название раздела и LF-адрес; полный учебник не обещается офлайн.

## ReviewCard и вычисляемый прогресс

ReviewCard хранится только для разрешённых **course** и **reading_practice** QIDs. D/F/RQ-final не входят в SRS; результаты этих проверок рекомендуют уроки и обычные вопросы.

| Поле | Тип / ограничение |
|---|---|
| question_id | ContentId, primary key: одна карточка на QID |
| grading_revision | Текущая ревизия карточки |
| revision | Revision для предотвращения повторного продвижения расписания |
| status | active или suspended |
| origins | Уникальные {kind,id}; kind=lesson,reading,dictionary,manual; ссылка на реальный источник добавления |
| step | Целое -1…4; -1 — новая ручная карточка до первого планового результата |
| due_at | TimeMs |
| created_at, updated_at | TimeMs |
| last_scheduled_presentation_id | LocalId|null |
| last_outcome | correct, incorrect, unknown, assisted или null |
| attempt_count, independent_success_count, incorrect_count, unknown_count, assisted_count | Целые >=0; представление статистики карточки, пересчитываемое из её событий |
| policy_version | Версия review |

Автоматическое добавление: неверный, unknown или подсказанный course/ordinary-reading ответ. Верный ответ сам по себе не создаёт карточку; он влияет на расписание только если карточка уже добавлена либо пользователь добавляет её вручную. Досрочный повтор и предел 30 суток определяет механика, а не компонент карточки.

LessonProgress — **вычисляемая проекция**, не независимо редактируемая таблица:

- lesson_id; state=not_started|in_progress|practiced|mastered;
- first_started_at, practiced_at, first_mastered_at: TimeMs|null;
- latest_completed_session_id:LocalId|null;
- required_question_ids[], covered_question_ids[], current_revision_question_ids[];
- independent_practice_correct, practice_count, independent_transfer_correct, transfer_count;
- needs_refresh:boolean и refresh_question_ids[].

Маршрутная сводка содержит выбранный route, обязательные lesson IDs, practiced/mastered counts, next_lesson_id, final_completed/final_passed раздельно. Проценты и статусы пересчитываются, импортированное mastered=true не принимается на доверии. Если понадобится materialized summary, она хранится как воспроизводимый кэш и обновляется в той же транзакции, что исходные факты.

## Настройки и закладки

Settings хранится в meta под key=settings:

- selected_route: arabic_reader|new_to_script|null;
- onboarding_completed:boolean;
- locale:tt-Cyrl, единственный язык первого выпуска;
- theme:system|light|dark;
- arabic_size_px:28|32|40|48, default32;
- text_size_px:18|20|22|24, default18, основная учебная кириллица: теория, условия и объяснения вопросов, чтение, значения словаря и справочник; размер навигации/кнопок задаёт UI-типографика, браузерный zoom действует на всё;
- reduced_motion:system|reduce;
- review_batch_size:целое 1…10, default10;
- last_location:{kind,id}|null; kind=lesson|reading|dictionary|reference, ID валиден;
- revision:Revision, updated_at:TimeMs.

Размеры — номинальные px при root16px; UI преобразует их в rem. Системный и браузерный zoom не ограничивается.

В настройках нет произвольного URL шрифта, исполняемого CSS, секретных ключей или серверного аккаунта. Незаписанное аудио не включается настройкой: доступность берётся из media manifest с asset_path!=null и ui_available=true.

Bookmark: bookmark_key, kind, target_id, created_at, updated_at, position. kind=lesson|reading|dictionary|rule; bookmark_key детерминирован из kind+target_id, дубликаты не создаются. position=null, кроме чтения, где допустимы line_id, line_revision, word_ordinal:number|null. Ошибочный ordinal не переносится на другой текст. Изменение размерности шрифта не требует сохранения пиксельного scroll как единственного ориентира.

ResumePosition хранится в meta под key=`position:{kind}:{target_id}`: kind=lesson|reading|reference; target_id; anchor_id:string|null; within_block_ratio:number от 0 до 1; content_revision:Hash; updated_at:TimeMs. Якорь — существующий смысловой блок: строка чтения, правило, пример либо раздел урока {lesson_id}:theory с within_block_ratio. Стабильные ID отдельных абзацев theory_tt не предполагаются; полный каталог якорей задан в 05. Позиция обновляется при остановке прокрутки и уходе со страницы; это не закладка и не факт завершения. При иной content_revision сначала восстанавливается существующий стабильный anchor_id, иначе начало материала; старый ordinal не переносится на изменённый блок. Все позиции входят в экспорт как resume_positions[].

## IndexedDB: stores, ключи и CAS

Имя БД — iske-imla-progress. Используется выбранная архитектурой библиотека idb. Физические stores первого выпуска:

| Store | keyPath | Индексы |
|---|---|---|
| meta | key | Нет |
| sessions | session_id | status; started_at |
| presentations | presentation_id | [session_id,question_id,ordinal] unique; session_id |
| attempts | presentation_id | session_id; [question_id,grading_revision]; submitted_at |
| exposures | exposure_key | Нет |
| review_cards | question_id | [status,due_at] |
| bookmarks | bookmark_key | kind |
| legacy | legacy_id | origin_kind |

meta/control={key:'control',progress_schema,db_version,data_generation,writer_id,writer_epoch,state_revision,active_session_id}. writer_id=tab LocalId|null; writer_epoch и state_revision — Revision. writer_id не является идентификатором человека.

control.update_gate=null либо {update_id:LocalId,target_release_id:string,phase:quiescing|commit,coordinator_id:LocalId,requested_at:TimeMs,purpose?:remove_offline}. Отсутствующий purpose означает принятие нового выпуска. Для remove_offline целевой release равен принятому; разрешена только фаза quiescing, без release commit. Это техническое ограждение обновления, не экспортируемое право: команды проверяют gate внутри транзакции. Протокол ACK, отмены, восстановления и допустимые записи определены в 08/09. Таймаут не означает согласия другой вкладки; commit блокирует пользовательские мутации до согласованного завершения/отмены.

control.accepted_release_id — принятый shell этого локального хранилища. Поле входит в schema1 первого ещё не опубликованного выпуска, не экспортируется и сохраняется при import/reset. Первый набор получает проверенный собственный release; согласованный finish меняет его на target в той же транзакции, которая снимает gate. Команды другой оболочки отвергаются даже после снятия gate. При потере технического PWA-реестра это поле позволяет повторно проверить принятый пакет, не принимать произвольный HTML после hard reload и не сбрасывать обучение.

Инварианты счётчиков различны:

- data_generation — новый UUID только при полной замене импорта/reset; поздние callbacks прежнего набора отвергаются;
- writer_epoch увеличивается при передаче права записи другой вкладке; прежняя вкладка не может отправить отложенный ответ своим старым token;
- Session.revision/Presentation.revision/ReviewCard.revision проверяют ожидаемую версию конкретной изменяемой записи;
- state_revision увеличивается один раз на успешную пользовательскую транзакцию; используется для обновления snapshot других вкладок и проверки, что preview импорта не устарел. Он не заменяет предметные revisions.

Каждая команда изменения учебного состояния несёт expected data_generation, writer_epoch и revisions изменяемых записей. Исключение — монотонное наблюдение фактического показа/помощи из любой вкладки: оно проверяет data_generation и текущие записи в транзакции, не требует writer_epoch, не меняет ответы/черновики/SRS и только дополняет exposure/assistance; порядок и ограничения заданы в 09. Репозиторий читает control и записи **внутри той же readwrite-транзакции**, проверяет ожидания, затем пишет. Проверка только в React перед await недостаточна. При конфликте команда ничего не меняет и возвращает write_conflict; UI перечитывает состояние. Старый callback не получает новое право записи автоматически.

Переход права записи — явная операция с повышением writer_epoch. Актуальная вкладка может продолжить существующий сеанс. Закрытие вкладки не должно требовать успешного unload для сохранности данных; реализация координации не полагается на него. Схема не вводит дополнительную session generation: restart всегда новый session_id.

Одна транзакция submit охватывает control, session, presentation, attempt и затронутые review/exposure записи. Если attempts уже содержит presentation_id, репозиторий возвращает существующий результат без повторного счёта/расписания. Повтор с тем же ID, но другим payload — конфликт, не новая попытка.

UI получает подтверждение сохранения после transaction completion, не после одного request success. При abort не появляется половина ответа. Уведомление другой вкладке передаёт state_revision/data_generation после commit; payload не заменяет перечитывание БД. Особенности транзакций и обновления схемы: [MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB), [idb](https://github.com/jakearchibald/idb).

При storage_unavailable ядро курса работает с теми же структурами в памяти и заметным статусом «Үзгәрешләр бу җайланмада сакланмады». Экспорт доступен из текущего снимка памяти. Нельзя утверждать сохранность после перезагрузки. Заполненный CacheStorage офлайн-курса не означает успешной записи прогресса.

## Экспорт и импорт

### Конверт

Export={format:'iske-imla-progress',schema_version,content_version,app_version,exported_at,data}. schema_version соответствует progress_schema; exported_at=TimeMs. data содержит settings, sessions[], presentations[], attempts[], exposures[], review_cards[], bookmarks[], resume_positions[], legacy[].

Контент, ключи курса, аудио, кэш и исполняемые ресурсы не экспортируются. writer_id/epoch, active tab identity и физическая db_version не переносятся как право записи. Ссылки сеансов на release/revision сохраняются. Экспорт читается согласованным readonly-снимком всех пользовательских stores после завершения текущей команды записи; не собирается из несвязанных чтений в разные моменты.

### Проверка до замены

Максимальный размер — **20MiB**, максимум **100000Attempt**. Для остальных массивов: sessions<=100000, presentations<=200000, exposures<=100000, bookmarks<=100000, resume_positions<=10000, review_cards<=числа допустимых известных QIDs, legacy<=100000. Общий лимит байт действует поверх счётчиков. Превышение не приводит к усечению.

Обычный экспорт создаёт восстанавливаемый файл только если итоговая UTF-8 сериализация и все счётчики укладываются в те же пределы. Проверка выполняется при экспорте, а не полной сериализацией после каждого ответа. Для обычного накопления истории действует мягкий порог **16MiB пользовательских записей или 90000Attempt**: перед изменением истории оценивается размер результата транзакции. При достижении порога дальнейшие durable history writes приостанавливаются; текущая сохранённая история остаётся доступна для полного совместимого экспорта. UI показывает «Сакланган тарих өчен урын җитми», предлагает сохранить копию и отдельно явно начать новую локальную историю. Практика может продолжаться в памяти с обычной отметкой несохранённого состояния. Экспорт, просмотр, настройки и явный reset не блокируются. Автоматического удаления и усечения нет.

meta/control дополнительно содержит estimated_record_bytes и attempt_count — неотрицательные целые. estimated_record_bytes — сумма UTF-8 размеров JSON-представлений экспортируемых записей (без control); счётчики обновляются дельтами изменённых записей в той же транзакции. Это воспроизводимая оценка, не отдельная история событий: после импорта/миграции она пересчитывается. Резерв 4MiB оставлен для конверта и структуры массивов; окончательная проверка полного экспорта всё равно обязательна. Импорт корректного файла до 20MiB разрешён даже выше мягкого порога: он сразу переводит накопление durable history в history_full, сохраняя возможность экспорта. Пределы количества остальных массивов проверяются при записи так же, как при импорте.

Если из-за дефекта оценки или старой миграции полный экспорт всё же превышает жёсткий предел, UI не выдаёт такой файл за восстанавливаемую копию и не сообщает об успешном backup; локальная история сохраняется. Это ошибка совместимости, требующая исправления/миграции перед обещанием восстановления, а не повод автоматически удалить часть данных. Штатный history_full — редкое ограничение длинной локальной истории, которое должно быть указано в справке о хранении.

Проверяются format/schema, типы, enum, длины, уникальность ключей, времена, совместимость AnswerValue с вопросом и внутренние связи session/presentation/attempt. Неверная структура отклоняет весь файл без записи. Неизвестный авторский ID отличается от повреждённой ссылки внутри самого экспорта.

- Известный ID и grading_revision: допускается в актуальное состояние после перепроверки результата соответствующей политикой.
- Неизвестный ContentId или неизвестная старая revision: запись и необходимые связи сохраняются в legacy/history, не увеличивают актуальные показатели.
- Известный ID с изменённой revision не проверяется новым ключом как будто он прежний. При известной структуре, но недоступной нужной версии grading/normalization policy запись получает legacy reason=unknown_policy_version.
- Несуществующая Presentation для Attempt, конфликтующие повторные LocalIds или невозможный тип ответа — повреждённый импорт, а не допустимый неизвестный контент.
- Неподдерживаемая версия обменной структуры отклоняется; отсутствие знакомого content_version само по себе не требует уничтожать файл.

Legacy={legacy_id,origin_kind,original_id,source_content_version,reason,record,imported_at}. record — один уже структурно проверенный объект поддерживаемой схемы, а не произвольный HTML/JS; origin_kind указывает его первоначальный тип. reason=unknown_content_id|unknown_grading_revision|unknown_policy_version|incompatible_draft. legacy_id детерминирован внутри импортируемого набора. Эти записи сохраняются при следующем экспорте, но не появляются в выдаче курса.

Импортированный score/mastered не является источником истины. Grade и сводки пересчитываются, когда доступны точная revision и нужные версии политик; иначе запись остаётся исторической без актуального зачёта.

### Подтверждение и commit

Preview содержит число распознанных записей, старых записей, закладок, выбранный маршрут и ожидаемые data_generation/state_revision текущего состояния. Перед заменой доступен экспорт прежнего прогресса. Подтверждение относится к этому preview; если состояние изменилось, preview пересчитывается.

Замена выполняется одной readwrite-транзакцией: очистка и запись всех пользовательских stores, новая data_generation, новый writer token, обновлённый control. Сбой/abort оставляет прежний набор целым. Автоматического слияния нет. Повторный импорт того же файла не удваивает attempts. Поле Session.data_generation всех восстановленных сеансов переписывается на новый локальный UUID: это ограждение записи, а не историческая характеристика учебной попытки. Совместимые импортированные active сеансы восстанавливаются как paused; control.active_session_id=null до явного resume.

Совместимый active/paused session можно восстановить только с доступным закреплённым release. Иначе его черновик сохраняется как incompatible/legacy, предлагается новый сеанс; ключ не подменяется незаметно.

## Миграции и происхождение

Физические миграции IndexedDB выполняются в versionchange через db_version. Старые соединения закрываются при versionchange; blocked не запускает удаление БД. Миграции пользовательской структуры — последовательные чистые преобразования поддерживаемых progress_schema с последующей проверкой. Смена схемы БД и смена содержания — отдельные операции.

При новом content_version:

- прежняя grading_revision сохраняет оценки и review step;
- новая revision сохраняет старые Attempts, но требует актуальной проверки; ReviewCard остаётся с тем же QID и переходит на текущую revision по политике механики;
- удалённый ID остаётся в истории/legacy и исключается из текущих знаменателей;
- first_mastered_at остаётся историческим достижением; needs_refresh и текущая самостоятельная оценка новой редакции — отдельные поля проекции;
- добавленный обязательный вопрос не считается выполненным старым сеансом;
- изменение одного explanation_tt не обнуляет урок.

SourceSpan интерпретируется по неизменяемому снимку книги, разделитель только LF. U+2028 внутри строки не создаёт новый номер. Источниковая карточка показывает название раздела из sources/sections.json и собственный source_form. Если опубликована полная книга, внешняя ссылка обозначается отдельно как сетевая. Русские normalization_note и редакционные комментарии не выводятся без подготовленной татарской проекции.

## Контрольные примеры контракта

- Q-V04-07: «ЫЗАН» нормализуется к допустимому «ызан», «азан» не принимается.
- Q-A05-09: «ал+мак» и «ал + мак» — одно разбиение; «ал + у» и «ал++мак» не являются тем же ответом.
- Q-L07-07: ID b остаётся верным при любой сохранённой перестановке option_order; reading_tt примера может быть null.
- Q-B07-07 и Q-V01-07 имеют разные вопросы, но повторяющийся материал: факт первой попытки Q не означает неизвестности слова.
- RQ-F01-01 получает revision с читаемым контекстом READ-F01; правка строки при прежнем QID требует новой revision.
- Q-V04-07, добавленный из урока и COURSE-EX-V04-05, даёт одну ReviewCard с несколькими origins.
- D-01, F-01 и RQ-F01-01 никогда не получают SRS-карточку; ошибка порождает рекомендацию обычного курса.
- lex-56-122 имеет null reading_tt, хотя одна forms содержит «зи»: это не ключ чтения всей статьи.
- Вкладка со старой data_generation после импорта не может дописать прежний черновик; повторный submit того же presentation_id не создаёт второй Attempt.

При реализации JSON Schema и проверки каталога должны подтвердить эти ограничения на реальном корпусе. Алгоритмы порогов, помощи, доступа и дат не дублируются в компонентах или в импортёре: они вызываются из единственной версии предметной политики.


### Уточнение D8.3a: допуск команды при update_gate

Внутренний Expected (не export) содержит update_id: null до начала обновления либо ID увиденного gate. Уже допущенная монотонная команда с null может завершиться в quiescing; новая команда, захватившая существующий gate, не раскрывает помощь. Draft/pause/position действующего writer разрешены до commit. Commit блокирует все пользовательские команды. Техническое finish снимает gate только reader целевого release после проверки координатором реестра и пакета; recovery меняет writer_epoch, сохраняя update_id/phase.
