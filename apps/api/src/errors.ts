import type { Deck } from '@sabaq/lesson/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public deck?: Deck,
  ) {
    super(message);
  }
}
