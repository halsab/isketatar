import type { Lesson } from './types';

export const lessonAnchors = (lesson: Lesson) => ['goals', 'theory', 'pitfalls', 'outcomes'].map(section => `${lesson.id}:${section}`).concat(lesson.rules.map(rule => rule.id), lesson.examples.map(example => example.id));
