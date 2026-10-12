// electron net.fetch 只收 string | Request；本适配层在边界归一化 URL，
// 对外仍返回兼容 typeof fetch 入参联合（string | URL | Request）的实现。
interface DesktopTelemetryFetchSource {
  fetch: (input: string | Request, init?: RequestInit) => Promise<Response>;
}

export function createDesktopTelemetryFetch(source: DesktopTelemetryFetchSource): typeof fetch {
  return (input, init) => source.fetch(input instanceof URL ? input.toString() : input, init);
}
