declare module "whatsapp-web.js" {
  export class LocalAuth {
    constructor(options: { clientId: string; dataPath: string });
  }
  export class Client {
    constructor(options: { authStrategy: LocalAuth; puppeteer: { headless: boolean } });
    on(event: string, handler: (...args: string[]) => void): void;
    initialize(): Promise<void>;
    destroy(): Promise<void>;
    getNumberId(number: string): Promise<{ _serialized: string } | null>;
    sendMessage(chatId: string, content: string): Promise<unknown>;
  }
}
