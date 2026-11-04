import net from 'node:net';

/**
 * A tiny TCP proxy placed between collaboration servers and Redis so tests can simulate an
 * outage deterministically (`cut()`) and a recovery (`restore()`) without touching Docker.
 */
export class TcpProxy {
  private server?: net.Server;
  private readonly sockets = new Set<net.Socket>();
  port = 0;

  constructor(
    private readonly targetHost: string,
    private readonly targetPort: number,
  ) {}

  static fromRedisUrl(url: string): TcpProxy {
    const parsed = new URL(url);
    return new TcpProxy(parsed.hostname, Number(parsed.port || 6379));
  }

  get url(): string {
    return `redis://127.0.0.1:${this.port}`;
  }

  async start(port = this.port): Promise<void> {
    this.server = net.createServer((client) => {
      const upstream = net.connect(this.targetPort, this.targetHost);
      for (const socket of [client, upstream]) {
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
        socket.on('error', () => {
          client.destroy();
          upstream.destroy();
        });
      }
      client.pipe(upstream).pipe(client);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, '127.0.0.1', () => resolve());
    });
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  /** Drop every connection and refuse new ones (Redis "goes down"). */
  async cut(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Accept connections again on the same port (Redis "comes back"). */
  async restore(): Promise<void> {
    await this.start(this.port);
  }

  async stop(): Promise<void> {
    await this.cut();
  }
}
