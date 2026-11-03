declare module "whatsapp-web.js" {
  export interface Store {
    sessionExists(options: { session: string }): Promise<boolean> | boolean;
    delete(options: { session: string }): Promise<unknown> | unknown;
    save(options: { session: string }): Promise<unknown> | unknown;
    extract(options: { session: string; path: string }): Promise<unknown> | unknown;
  }

  export class RemoteAuth {
    constructor(options: {
      store: Store;
      clientId: string;
      dataPath: string;
      backupSyncIntervalMs: number;
    });
  }

  export class Client {
    constructor(options: { authStrategy: RemoteAuth; puppeteer: { headless: boolean } });
    on(event: string, handler: (...args: string[]) => void): void;
    initialize(): Promise<void>;
    destroy(): Promise<void>;
    getNumberId(number: string): Promise<{ _serialized: string } | null>;
    sendMessage(chatId: string, content: string): Promise<unknown>;
  }
}

declare module "wwebjs-mongo" {
  export class MongoStore implements import("whatsapp-web.js").Store {
    constructor(options: { mongoose: typeof import("mongoose") });
    sessionExists(options: { session: string }): Promise<boolean>;
    delete(options: { session: string }): Promise<unknown>;
    save(options: { session: string }): Promise<unknown>;
    extract(options: { session: string; path: string }): Promise<unknown>;
  }
}
