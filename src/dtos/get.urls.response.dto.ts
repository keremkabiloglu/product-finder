export class GetUrlsResponseDto {
  readonly attributeUrl?: string;
  readonly marketPriceUrl?: string;
  readonly brand?: string;
  readonly model?: string;
  readonly marketPrice?: number;

  constructor(opts: Partial<GetUrlsResponseDto>) {
    Object.assign(this, opts);
  }
}
