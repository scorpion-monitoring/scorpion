export interface ThingService {
  name(): string;
}

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'fixture.b': ThingService;
  }
}
