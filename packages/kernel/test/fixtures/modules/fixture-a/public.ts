export interface AService {
  describe(): string;
  /** The notes written by the event handler (`created`) and the jobs (`tick`, or a ping's message). */
  notes(): Promise<{ id: string; thingId: string; body: string }[]>;
  /** Queues `fixture.a.ping`; the job writes `message` as a note. Returns the job id. */
  ping(message: string): Promise<string>;
}

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'fixture.a': AService;
  }
}
