import { createContext } from 'react';
import type { ContentRepository } from '../data/content/repository';
export const StudyScope = createContext<{ content: ContentRepository; releaseId: string } | null>(null);
