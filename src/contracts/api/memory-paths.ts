import { jsonBody, operation, parameter, pathId } from './operations.js';

export const MEMORY_PATHS = {
  '/api/v1/memory': {
    get: { ...operation('listUserMemory', 'List/search caller saved memory (when enabled)', 'MemoryPage'),
      parameters: [parameter('query', 'query', { type: 'string', minLength: 2, maxLength: 256 })] },
    post: { ...operation('saveUserMemory', 'Explicitly author a user assertion; requestId deduplicates retries', 'MemoryNote'),
      requestBody: jsonBody('MemorySaveRequest') },
  },
  '/api/v1/memory/{noteId}/correct': {
    post: { ...operation('correctUserMemory', 'Replace a saved assertion under revision guard', 'MemoryNote'),
      parameters: [pathId('noteId')], requestBody: jsonBody('MemoryCorrectRequest') },
  },
  '/api/v1/memory/{noteId}/delete': {
    post: { ...operation('deleteUserMemory', 'Stop retrieving a saved assertion under revision guard', 'MemoryNote'),
      parameters: [pathId('noteId')], requestBody: jsonBody('MemoryDeleteRequest') },
  },
};
