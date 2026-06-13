export type LlmProviderId = 'gemini' | 'ollama';

export interface OllamaHealth {
  installed: boolean;
  running: boolean;
  modelPresent: boolean;
  models: string[];
  ollamaPath?: string;
  error?: string;
}

export interface GeminiHealth {
  configured: boolean;
}

export interface AiHealthReport {
  provider: LlmProviderId;
  gemini: GeminiHealth;
  ollama: OllamaHealth;
  ready: boolean;
}

export interface InstallOllamaResult {
  ok: boolean;
  method: 'winget' | 'manual' | 'already' | 'bundled';
  message: string;
}

export interface PullModelResult {
  ok: boolean;
  message: string;
}

export interface PullProgressEvent {
  line: string;
  done?: boolean;
  error?: boolean;
}

export interface SetupPending {
  installOllama: boolean;
  pullModel: boolean;
  model: string;
}

export interface BootstrapOptions {
  installOllama?: boolean;
  pullModel?: boolean;
  model?: string;
}

export interface BootstrapResult {
  ok: boolean;
  message: string;
}
