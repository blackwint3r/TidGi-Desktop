export interface IMCPServerService {
  initialize(): Promise<void>;
  stop(): Promise<void>;
  getServerEndpoint(): string | undefined;
  isRunning(): boolean;
}
