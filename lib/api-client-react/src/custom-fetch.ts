export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;

// Dev-only automation support: when the app is loaded with a
// `?screenshotToken=...` query param (used by the automated screenshot tool,
// which cannot rely on session cookies — see api-server's
// `middleware/auth.ts`), remember it for the lifetime of the page and attach
// it to every request. The server independently validates this token and
// rejects it outright in production, so this is inert in real usage — a
// normal user's URL never carries this param.
let _screenshotToken: string | null = null;
if (typeof window !== "undefined" && typeof window.location !== "undefined") {
  const fromUrl = new URLSearchParams(window.location.search).get(
    "screenshotToken",
  );
  if (fromUrl) {
    _screenshotToken = fromUrl;
    // Strip the token from the address bar immediately so it is not visible in
    // browser history, not leaked in Referer headers on subsequent navigations,
    // and not accidentally bookmarked or shared.
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("screenshotToken");
      history.replaceState(null, "", clean.toString());
    } catch {
      // replaceState is unavailable in some sandboxed iframes — ignore.
    }
  }
}

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

/**
 * Returns the dev-only screenshot automation token captured from
 * `?screenshotToken=...` on page load, or `null` if not present.
 *
 * `customFetch` already attaches this as an `X-Screenshot-Token` header
 * automatically. This getter exists for the narrow set of call sites that
 * bypass `customFetch` entirely — raw `<img src>` / SVG `<image href>` tags
 * (e.g. fabric tile pattern fills) can't attach custom headers, so those
 * call sites must append the token as a `?screenshotToken=` query param
 * themselves via `appendScreenshotToken()` below. The server accepts the
 * token from either the header or the query param (dev-only, see
 * `middleware/auth.ts`).
 */
export function getScreenshotToken(): string | null {
  return _screenshotToken;
}

/**
 * Returns true only for same-origin /api/ URLs (relative or absolute).
 * Used to ensure dev credentials (screenshot token) are never forwarded to
 * third-party hosts — e.g. an absolute CDN URL that happens to pass through
 * this code path should never carry the token.
 */
function isTrustedApiUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  if (url.startsWith("data:") || url.startsWith("blob:")) return false;
  // Relative paths to /api/ are inherently same-origin.
  if (url.startsWith("/api/")) return true;
  // Absolute URLs: accept only when origin matches the current page and the
  // path targets /api/.
  try {
    const parsed = new URL(url);
    return (
      typeof window !== "undefined" &&
      parsed.origin === window.location.origin &&
      parsed.pathname.startsWith("/api/")
    );
  } catch {
    return false;
  }
}

/**
 * Appends the dev-only screenshot token (if present) to a URL as a
 * `screenshotToken` query param, for raw `<img>`/`<image>` tags that can't
 * carry the `X-Screenshot-Token` header. No-op (returns the URL unchanged)
 * when no token is set or when the URL is not a trusted same-origin /api/
 * path, so this is inert for normal users and never leaks the token to
 * external hosts.
 */
export function appendScreenshotToken(url: string): string {
  if (!_screenshotToken || !url) return url;
  // Only append to same-origin /api/ URLs. An unguarded rewrite would forward
  // the dev credential to any host that receives a URL (e.g. external CDNs).
  if (!isTrustedApiUrl(url)) return url;
  // Guard against double-appending (e.g. when buildFabricUrlMap already called
  // this and the setAttribute patcher fires again for the same SVG <image href>
  // element). A double screenshotToken param makes Express parse it as an array,
  // which then fails the strict string comparison in tryScreenshotTokenAuth.
  if (url.includes("screenshotToken=")) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}screenshotToken=${encodeURIComponent(_screenshotToken)}`;
}

let _screenshotImagePatchInstalled = false;

/**
 * Dev-only: when a `?screenshotToken=...` is present, monkey-patch
 * `HTMLImageElement.src` and SVG `<image>` `href`/`xlink:href` attribute
 * writes so every raw `<img>`/`<image>` tag in the app automatically carries
 * the token — without needing every call site (there are hundreds across
 * pottery/quilting/ornaments/travels) to remember to call
 * `appendScreenshotToken()` individually. No-op when no token is present, so
 * this is completely inert for normal users; safe to call once from each
 * artifact's entrypoint (e.g. `main.tsx`).
 */
export function installScreenshotImageAutoAuth(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!_screenshotToken) return;
  if (_screenshotImagePatchInstalled) return;
  _screenshotImagePatchInstalled = true;

  // Only rewrite URLs that are same-origin and target /api/. An unrestricted
  // rewrite would append the dev token to externally-hosted images (e.g. a
  // fabric tile whose src is an absolute URL on a CDN), leaking it to a
  // third-party host. Relative /api/ paths are inherently same-origin.
  // Absolute URLs are accepted only when their origin matches window.location
  // and their pathname starts with /api/.
  const shouldRewrite = (value: string): boolean => {
    if (typeof value !== "string" || value.length === 0) return false;
    if (value.startsWith("data:") || value.startsWith("blob:")) return false;
    if (value.startsWith("/api/")) return true;
    try {
      const url = new URL(value);
      return (
        url.origin === window.location.origin &&
        url.pathname.startsWith("/api/")
      );
    } catch {
      return false;
    }
  };

  // <img src="...">
  const imgProto = window.HTMLImageElement?.prototype;
  const srcDescriptor =
    imgProto && Object.getOwnPropertyDescriptor(imgProto, "src");
  if (imgProto && srcDescriptor?.set) {
    Object.defineProperty(imgProto, "src", {
      ...srcDescriptor,
      set(this: HTMLImageElement, value: string) {
        srcDescriptor.set!.call(
          this,
          shouldRewrite(value) ? appendScreenshotToken(value) : value,
        );
      },
    });
  }

  // SVG <image href="..."> / <image xlink:href="...">, which React sets via
  // setAttribute/setAttributeNS rather than a property setter.
  const origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (
    this: Element,
    name: string,
    value: string,
  ) {
    if (
      this.tagName === "image" &&
      (name === "href" || name === "xlink:href") &&
      shouldRewrite(value)
    ) {
      value = appendScreenshotToken(value);
    }
    return origSetAttribute.call(this, name, value);
  };

  const origSetAttributeNS = Element.prototype.setAttributeNS;
  Element.prototype.setAttributeNS = function (
    this: Element,
    namespace: string | null,
    name: string,
    value: string,
  ) {
    if (this.tagName === "image" && name === "href" && shouldRewrite(value)) {
      value = appendScreenshotToken(value);
    }
    return origSetAttributeNS.call(this, namespace, name, value);
  };
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

/**
 * Resolve a relative API path (e.g. "/api/travels/trips/plan") against the
 * configured base URL, for call sites that need a raw fetch() (streaming
 * responses, etc.) instead of the JSON-only customFetch() helper.
 */
export function resolveApiUrl(path: string): string {
  const resolved = applyBaseUrl(path);
  return typeof resolved === "string" ? resolved : path;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  // Dev-only automation support (see module-level comment above).
  // Guard: only attach the token to same-origin /api/ requests. Without this
  // guard an absolute URL to an external host would silently forward the dev
  // credential to a third party (latent leak — no current call site does this,
  // but defence-in-depth is warranted for a credential that grants a full
  // cookie-free authenticated session).
  if (
    _screenshotToken &&
    !headers.has("x-screenshot-token") &&
    isTrustedApiUrl(resolveUrl(input))
  ) {
    headers.set("x-screenshot-token", _screenshotToken);
  }

  const requestInfo = { method, url: resolveUrl(input) };

  const response = await fetch(input, { ...init, method, headers });

  if (!response.ok) {
    const errorData = await parseErrorBody(response, method);
    throw new ApiError(response, errorData, requestInfo);
  }

  return (await parseSuccessBody(response, responseType, requestInfo)) as T;
}
