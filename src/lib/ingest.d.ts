declare module '@/lib/ingest' {
  export function ingestEmlBuffer(buf: Buffer, client?: any): Promise<any>;
  export function ingestCsvText(text: string, client?: any): Promise<any>;
  export function parseCsv(text: string): { rows: any[]; errors: any[] };
  export function authorized(req: any): boolean;
  export const INGEST_TOKEN: string | null;
}
