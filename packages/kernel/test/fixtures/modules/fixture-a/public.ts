export interface AService {
  describe(): string;
}

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'fixture.a': AService;
  }
}
