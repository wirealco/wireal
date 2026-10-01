/** Shared browser/stdio/Worker transport. No service credentials or vendor SDK. */
export class ApiError extends Error {
  readonly code: string;
  constructor(
    message: string,
    readonly status = 0,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = String(status);
  }
}
export type ApiResult<T = any> = {
  data: T | null;
  error: ApiError | null;
  count?: number | null;
};
type Rows = Record<string, any>[];
export type ApiRequest = <T = any>(
  path: string,
  init?: RequestInit,
) => Promise<T>;
type Filter = { field: string; op: string; value: unknown };
type Query = {
  table: string;
  operation: string;
  columns: string;
  filters: Filter[];
  any: Filter[][];
  order: { field: string; ascending: boolean }[];
  offset: number;
  limit: number;
  single?: string;
  count?: boolean;
  head?: boolean;
  values?: unknown;
};

export async function result<T>(
  action: () => Promise<T>,
): Promise<ApiResult<T>> {
  try {
    return { data: await action(), error: null };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof ApiError
          ? error
          : new ApiError(
              error instanceof Error ? error.message : String(error),
            ),
    };
  }
}
export async function readResponse<T>(response: Response): Promise<T> {
  const body =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      body?.error?.message ??
        body?.error_description ??
        body?.title ??
        body?.message ??
        `Request failed (${response.status}).`,
      response.status,
      typeof body?.error === "string" ? body.error : undefined,
    );
  return body as T;
}
export function jsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

export class DataClient {
  constructor(readonly request: ApiRequest) {}
  from(table: string) {
    return new DataQuery(this.request, table);
  }
  async rpc(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<ApiResult> {
    try {
      return await this.request(
        `/api/commands/${encodeURIComponent(name)}`,
        jsonBody(args),
      );
    } catch (error) {
      return result(() => Promise.reject(error));
    }
  }
}
export class DataQuery implements PromiseLike<ApiResult<Rows>> {
  private readonly query: Query;
  constructor(
    private request: ApiRequest,
    table: string,
  ) {
    this.query = {
      table,
      operation: "select",
      columns: "*",
      filters: [],
      any: [],
      order: [],
      offset: 0,
      limit: 1000,
    };
  }
  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    this.query.columns = columns;
    this.query.count = options?.count === "exact";
    this.query.head = options?.head;
    return this;
  }
  update(values: unknown) {
    this.query.operation = "update";
    this.query.values = values;
    return this;
  }
  insert(values: unknown) {
    this.query.operation = "insert";
    this.query.values = values;
    return this;
  }
  delete() {
    this.query.operation = "delete";
    return this;
  }
  eq(field: string, value: unknown) {
    this.query.filters.push({ field, op: "eq", value });
    return this;
  }
  neq(field: string, value: unknown) {
    this.query.filters.push({ field, op: "neq", value });
    return this;
  }
  in(field: string, value: readonly unknown[]) {
    this.query.filters.push({ field, op: "in", value });
    return this;
  }
  ilike(field: string, value: string) {
    this.query.filters.push({ field, op: "ilike", value });
    return this;
  }
  /** Converts the app's fixed OR patterns into structured filters, never SQL. */
  or(pattern: string) {
    const parts = pattern.match(/[^,]+\.in\.\([^)]*\)|[^,]+/g) ?? [];
    this.query.any.push(
      parts.map((part) => {
        const match = part.match(/^(\w+)\.(in|ilike|eq)\.(.*)$/);
        if (!match) throw new ApiError("Invalid query filter.");
        return {
          field: match[1],
          op: match[2],
          value:
            match[2] === "in" ? match[3].slice(1, -1).split(",") : match[3],
        };
      }),
    );
    return this;
  }
  order(field: string, options?: { ascending?: boolean }) {
    this.query.order.push({ field, ascending: options?.ascending !== false });
    return this;
  }
  range(from: number, to: number) {
    this.query.offset = from;
    this.query.limit = to - from + 1;
    return this;
  }
  limit(limit: number) {
    this.query.limit = limit;
    return this;
  }
  async maybeSingle<T = any>(): Promise<ApiResult<T>> {
    this.query.single = "optional";
    return this.execute();
  }
  async single<T = any>(): Promise<ApiResult<T>> {
    this.query.single = "required";
    return this.execute();
  }
  private async execute<T = Rows>(): Promise<ApiResult<T>> {
    try {
      return await this.request("/api/query", jsonBody(this.query));
    } catch (error) {
      return result(() => Promise.reject(error));
    }
  }
  then<TResult1 = ApiResult<Rows>, TResult2 = never>(
    fulfilled?:
      ((value: ApiResult<Rows>) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(fulfilled, rejected);
  }
}

export type UserIdentity = { identity_id: string; provider: string };
export type User = {
  id: string;
  email?: string;
  user_metadata: { full_name?: string; avatar_url?: string; picture?: string };
  identities: UserIdentity[];
};
export type Session = { user: User; access_token: string };
