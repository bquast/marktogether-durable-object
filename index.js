export class NotepadRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Set();
    
    // Durable Object internal SQLite initialization
    this.state.blockConcurrencyWhile(async () => {
      await this.state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY, 
          content TEXT
        )`);
    });
  }

  async fetch(request) {
    const [client, server] = new WebSocketPair();
    server.accept();
    this.sessions.add(server);

    // Fetch initial state from internal SQLite
    const row = this.state.storage.sql.exec("SELECT content FROM notes LIMIT 1").one();
    if (row) {
      server.send(JSON.stringify({ content: row.content }));
    }

    server.addEventListener("message", async (msg) => {
      const data = JSON.parse(msg.data);
      
      // Save to SQLite
      this.state.storage.sql.exec(
        "INSERT INTO notes (id, content) VALUES ('note', ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content",
        data.content
      );

      // Broadcast to other peers
      for (let session of this.sessions) {
        if (session !== server) {
          try {
            session.send(msg.data);
          } catch (e) {
            this.sessions.delete(session);
          }
        }
      }
    });

    server.addEventListener("close", () => this.sessions.delete(server));
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Use the URL path as the unique ID for the notepad room
    const id = env.NOTEPAD_ROOM.idFromName(url.pathname);
    const room = env.NOTEPAD_ROOM.get(id);
    return room.fetch(request);
  }
};