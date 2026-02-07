// 1. The Durable Object Class
export class NotepadRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Set();

    // Initialize SQLite storage
    this.state.blockConcurrencyWhile(async () => {
      await this.state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, content TEXT)
      `);
    });
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    this.sessions.add(server);

    // FIX: use .first() instead of .one() to avoid crashing on empty tables
    const row = this.state.storage.sql.exec("SELECT content FROM notes LIMIT 1").first();
    if (row) server.send(JSON.stringify({ content: row.content }));

    server.addEventListener("message", async (msg) => {
      const data = JSON.parse(msg.data);
      this.state.storage.sql.exec(
        "INSERT INTO notes (id, content) VALUES ('note', ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content",
        data.content
      );

      // Broadcast to all other sessions
      for (let s of this.sessions) {
        if (s !== server) s.send(msg.data);
      }
    });

    server.addEventListener("close", () => this.sessions.delete(server));
    return new Response(null, { status: 101, webSocket: client });
  }
}

// 2. The Global Fetch Handler
export default {
  async fetch(request, env) {
    const id = env.NOTEPAD_ROOM.idFromName("global-note");
    const room = env.NOTEPAD_ROOM.get(id);
    return room.fetch(request);
  }
};