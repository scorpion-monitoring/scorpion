// The only file other modules may import. It holds the service interface and nothing else.
export interface Note {
  id: string;
  text: string;
}

export interface NotesService {
  add(text: string): Promise<string>;
  list(page: number, pageSize: number): Promise<{ notes: Note[]; total: number }>;
  /** The names of the export formats contributed to this module's registry. */
  formats(): string[];
  /** Queues the purge job now instead of waiting for its schedule. */
  purgeNow(): Promise<string>;
}

// Lets `ctx.deps['example.notes']` be typed in modules that depend on this one.
declare module '@scorpion/kernel' {
  interface ModuleServices {
    'example.notes': NotesService;
  }
}
