const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const text = (maxLength = 128) => ({ type: 'string', minLength: 1, maxLength });
const enumeration = (...values) => ({ enum: values });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum, maximum });
const array = (items, maxItems, uniqueItems = false, minItems = 0) => ({ type: 'array', items, maxItems, minItems, uniqueItems });
const ref = name => ({ $ref: `#/$defs/${name}` });
const time = integer(0, 8_640_000_000_000_000);
const id = text();
const uuid = { ...text(36), pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const hash = { ...text(64), pattern: '^[0-9a-f]{64}$' };
const bool = { type: 'boolean' };
const route = nullable(enumeration('arabic_reader', 'new_to_script'));
const grade = enumeration('correct', 'incorrect', 'unknown');
const kind = enumeration('lesson_cycle', 'review', 'diagnostic', 'final', 'reading_practice');
const policy = object(Object.fromEntries(['grading', 'normalization', 'mastery', 'diagnostic', 'final', 'review', 'exposure', 'release_access', 'search', 'import'].map(key => [key, text()])));
const answerText = { type: 'string', maxLength: 4096, pattern: '^[^\\u0000-\\u001f\\u007f-\\u009f]*$' };
const defs = {
  answer: { oneOf: [object({ kind: enumeration('unknown') }), object({ kind: enumeration('option'), option_id: id }), object({ kind: enumeration('set'), option_ids: array(id, 256, true) }), object({ kind: enumeration('text', 'segments'), text: answerText })] },
  assistance: object({ hint_indices: array(integer(0, 255), 256, true), first_hint_at: nullable(time), rule_opened_at: nullable(time), reading_opened_at: nullable(time), meaning_opened_at: nullable(time), answer_revealed_at: nullable(time), reference_opened_at: nullable(time) }),
  familiarity: object({ question_seen_before: bool, material_seen_before: bool, reading_exposed_before: bool }),
  planItem: object({ question_id: id, grading_revision: hash, first_presentation_id: uuid, option_order: array(id, 256, true), assessment_role: enumeration('practice', 'transfer', 'diagnostic', 'final', 'reading_practice') }),
  session: object({ session_id: uuid, kind, status: enumeration('active', 'paused', 'submitted', 'abandoned', 'incompatible'), revision: integer(), data_generation: uuid,
    release_id: text(256), content_version: text(), content_schema: integer(1), policy_versions: policy, lesson_id: nullable(id), reading_ids: array(id, 1000, true), diagnostic_imla_deferred: bool,
    assessment_help_opened_at: nullable(time), reading_help: array(object({ line_id: id, word_id: nullable(id), kind: enumeration('letters', 'rule', 'reading', 'meaning'), opened_at: time }), 10000, true), route_at_start: route,
    question_plan: array(ref('planItem'), 1000, false, 1), active_presentation_id: nullable(uuid), started_at: time, updated_at: time, submitted_at: nullable(time), abandoned_at: nullable(time), incompatibility_reason: nullable(text(256)) }),
  presentation: object({ presentation_id: uuid, session_id: uuid, question_id: id, grading_revision: hash, ordinal: integer(1, 200000), revision: integer(), status: enumeration('draft', 'submitted', 'skipped'), created_at: time, shown_at: nullable(time),
    draft_answer: nullable(ref('answer')), draft_updated_at: nullable(time), assistance: ref('assistance'), familiarity_at_show: ref('familiarity'), feedback_opened_at: nullable(time), feedback_acknowledged_at: nullable(time) }),
  attempt: object({ presentation_id: uuid, session_id: uuid, question_id: id, grading_revision: hash, ordinal: integer(1, 200000), release_id: text(256), content_version: text(), policy_versions: policy,
    answer_raw: ref('answer'), answer_normalized: nullable({ anyOf: [{ type: 'string', maxLength: 16384 }, array({ type: 'string', maxLength: 16384 }, 4097)] }), grade,
    assistance_before_submit: ref('assistance'), familiarity_at_show: ref('familiarity'), first_submission_in_cycle: bool, independent_correct: bool, submitted_at: time, elapsed_ms: nullable(integer()) }),
  exposure: object({ exposure_key: text(256), kind: enumeration('lesson', 'reading', 'question', 'example', 'reading_line', 'reading_word', 'dictionary_entry', 'material'), resource_id: nullable(id), material_key: nullable(hash), exposure_policy: text(),
    first_seen_at: time, last_seen_at: time, first_reading_exposed_at: nullable(time), first_meaning_exposed_at: nullable(time), first_answer_exposed_at: nullable(time), first_completed_at: nullable(time) }),
  reviewCard: object({ question_id: id, grading_revision: hash, revision: integer(), status: enumeration('active', 'suspended'), origins: array(object({ kind: enumeration('lesson', 'reading', 'dictionary', 'manual'), id }), 1000, true, 1),
    step: integer(-1, 4), due_at: time, created_at: time, updated_at: time, last_scheduled_presentation_id: nullable(uuid), last_outcome: nullable(enumeration('correct', 'incorrect', 'unknown', 'assisted')),
    attempt_count: integer(), independent_success_count: integer(), incorrect_count: integer(), unknown_count: integer(), assisted_count: integer(), policy_version: text() }),
  bookmark: object({ bookmark_key: text(256), kind: enumeration('lesson', 'reading', 'dictionary', 'rule'), target_id: id, created_at: time, updated_at: time,
    position: nullable(object({ line_id: id, line_revision: hash, word_ordinal: nullable(integer(0, 10000)) })) }),
  position: object({ kind: enumeration('lesson', 'reading', 'reference'), target_id: id, anchor_id: nullable(text(256)), within_block_ratio: { type: 'number', minimum: 0, maximum: 1 }, content_revision: hash, updated_at: time }),
  settings: object({ selected_route: route, onboarding_completed: bool, locale: enumeration('tt-Cyrl'), theme: enumeration('system', 'light', 'dark'), arabic_size_px: enumeration(28, 32, 40, 48), text_size_px: enumeration(18, 20, 22, 24), reduced_motion: enumeration('system', 'reduce'),
    review_batch_size: integer(1, 10), last_location: nullable(object({ kind: enumeration('lesson', 'reading', 'dictionary', 'reference'), id })), revision: integer(), updated_at: time }),
  control: object({ key: enumeration('control'), accepted_release_id: text(256), progress_schema: integer(1), db_version: integer(1), data_generation: uuid, writer_id: nullable(uuid), writer_epoch: integer(), state_revision: integer(), active_session_id: nullable(uuid),
    update_gate: nullable(object({ update_id: uuid, target_release_id: text(256), phase: enumeration('quiescing', 'commit'), coordinator_id: uuid, requested_at: time })), estimated_record_bytes: integer(), attempt_count: integer(0, 100000) }),
};
const history = { session: 'session', presentation: 'presentation', attempt: 'attempt', exposure: 'exposure', review_card: 'reviewCard', bookmark: 'bookmark', resume_position: 'position' };
defs.legacy = { oneOf: Object.entries(history).map(([origin, name]) => object({ legacy_id: text(512), origin_kind: enumeration(origin), original_id: text(256), source_content_version: text(), reason: enumeration('unknown_content_id', 'unknown_grading_revision', 'unknown_policy_version', 'incompatible_draft'), record: ref(name), imported_at: time })) };
defs.data = object({ settings: ref('settings'), sessions: array(ref('session'), 100000), presentations: array(ref('presentation'), 200000), attempts: array(ref('attempt'), 100000), exposures: array(ref('exposure'), 100000), review_cards: array(ref('reviewCard'), 100000), bookmarks: array(ref('bookmark'), 100000), resume_positions: array(ref('position'), 10000), legacy: array(ref('legacy'), 100000) });
defs.export = object({ format: enumeration('iske-imla-progress'), schema_version: enumeration(1), app_version: { ...text(), pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$' }, content_version: text(), exported_at: time, data: ref('data') });
defs.meta = { oneOf: [ref('control'), object({ key: enumeration('settings'), value: ref('settings') }), object({ key: { ...text(300), pattern: '^position:' }, value: ref('position') })] };
export const progressSchema = { $id: 'progress', $defs: defs };
export const progressValidators = { validateExport: 'export', validateData: 'data', validateMeta: 'meta', validateSession: 'session', validatePresentation: 'presentation', validateAttempt: 'attempt', validateExposure: 'exposure', validateReviewCard: 'reviewCard', validateBookmark: 'bookmark', validatePosition: 'position', validateLegacy: 'legacy' };
