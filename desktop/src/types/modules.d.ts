// Type declarations for modules without types

declare module 'pdf-parse' {
  interface PDFData {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown>;
    text: string;
    version: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: Record<string, unknown>): Promise<PDFData>;
  export = pdfParse;
}

declare module 'rtf-parser' {
  interface RTFDocument {
    content: unknown[];
    style?: Record<string, unknown>;
  }

  type Callback = (err: Error | null, doc: RTFDocument) => void;

  export function string(rtfString: string, callback: Callback): void;
  export function stream(): NodeJS.WritableStream;
}

