export interface ThingService {
  name(): string;
  /** Inserts a thing and emits `fixture.thing.created@1` in one transaction. Returns its id. */
  createThing(name: string): Promise<string>;
  /** Like createThing, then throws inside the transaction, so nothing must be stored or emitted. */
  createThingThenFail(name: string): Promise<never>;
  count(): Promise<number>;
}

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'fixture.b': ThingService;
  }
}
