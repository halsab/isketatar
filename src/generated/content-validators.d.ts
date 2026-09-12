import type { AssessmentData, CoreData, DictionaryData, ModuleData, ReadingData, References } from '../domain/content/types';
export function validateCore(value: unknown): value is CoreData;
export function validateModule(value: unknown): value is ModuleData;
export function validateReadings(value: unknown): value is ReadingData;
export function validateDictionary(value: unknown): value is DictionaryData;
export function validateReferences(value: unknown): value is References;
export function validateAssessments(value: unknown): value is AssessmentData;
