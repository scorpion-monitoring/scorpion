export interface OptService {
  hello(): string;
}

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'fixture.opt': OptService;
  }
}
