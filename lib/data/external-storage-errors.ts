export class ExternalStorageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ExternalStorageError";
  }
}

export class DataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataIntegrityError";
  }
}

export class DataParityError extends Error {
  constructor(readonly resource: string) {
    super(`file and external data differ for ${resource}`);
    this.name = "DataParityError";
  }
}
