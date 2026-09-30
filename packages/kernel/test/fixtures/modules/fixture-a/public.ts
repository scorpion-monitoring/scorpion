export interface AService {
  describe(): string;
  /** The notes written by the handler of `fixture.thing.created@1`. */
  notes(): Promise<{ id: string; thingId: string }[]>;
}

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'fixture.a': AService;
  }
}
