declare module '@/lib/ai' {
  export interface AiConfig {
    baseUrl: string;
    model: string;
    apiKey: string;
    timeoutMs: number;
    retries: number;
    retryMs: number;
  }
  export interface AlertInsights {
    resumen: string;
    recomendacion: string;
    model: string;
  }
  export function aiEnabled(): boolean;
  export function config(): AiConfig;
  export function buildPrompt(alert: any, withContext?: boolean): { role: string; content: string }[];
  export function parseInsights(text: string): { resumen: string; recomendacion: string };
  export function isRefusal(text: string): boolean;
  export function generateAlertInsights(alert: any): Promise<AlertInsights>;
  export function fingerprint(alert: any): string;
}
