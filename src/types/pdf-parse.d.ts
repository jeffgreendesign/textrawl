declare module 'pdf-parse' {
  interface PDFData {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
  }
  function parse(dataBuffer: Buffer): Promise<PDFData>;
  export = parse;
}
