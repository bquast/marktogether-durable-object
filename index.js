/**
 * FULL index.js
 * Durable Object with SQLite backend
 */

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

    // FIX: Iterate the cursor to get the first row
    const cursor = this.state.storage.sql.exec("SELECT content FROM notes LIMIT 1");
    for (const row of cursor) {
        server.send(JSON.stringify({ content: row.content }));
        break; // Only send the first result
    }

    server.addEventListener("message", async (msg) => {
      try {
        const data = JSON.parse(msg.data);
        
        // Persist content
        this.state.storage.sql.exec(
          "INSERT INTO notes (id, content) VALUES ('note', ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content",
          data.content
        );

        // Broadcast to all other sessions
        for (let s of this.sessions) {
          if (s !== server) {
            try {
              s.send(msg.data);
            } catch (e) {
              this.sessions.delete(s);
            }
          }
        }
      } catch (err) {
        console.error("Message handling error:", err);
      }
    });

    server.addEventListener("close", () => this.sessions.delete(server));
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const id = env.NOTEPAD_ROOM.idFromName("global-note");
    const room = env.NOTEPAD_ROOM.get(id);
    return room.fetch(request);
  }
};