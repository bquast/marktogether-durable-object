/**
 * FINAL index.js
 * Durable Object with SQLite storage + Presence
 */
const ANIMALS = ["Puffy Panda", "Grumpy Gopher", "Sly Snake", "Happy Hippo", "Daring Duck", "Lazy Lion"];

export class NotepadRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Map(); // Track socket -> { name, cursor }

    this.state.blockConcurrencyWhile(async () => {
      await this.state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, content TEXT)
      `);
    });
  }

  async fetch(request) {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    // Assign a random animal name
    const name = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    this.sessions.set(server, { name, cursor: 0 });

    // Send initial state
    const cursor = this.state.storage.sql.exec("SELECT content FROM notes LIMIT 1");
    for (const row of cursor) {
      server.send(JSON.stringify({ type: 'init', content: row.content, name }));
      break; 
    }

    server.addEventListener("message", async (msg) => {
      const data = JSON.parse(msg.data);
      
      if (data.type === 'update') {
        this.state.storage.sql.exec(
          "INSERT INTO notes (id, content) VALUES ('note', ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content",
          data.content
        );
      }

      if (data.type === 'cursor') {
        this.sessions.get(server).cursor = data.pos;
      }

      // Broadcast update/presence to everyone else
      const presence = Array.from(this.sessions.values());
      for (let [socket, info] of this.sessions) {
        if (socket !== server) {
          socket.send(JSON.stringify({ ...data, presence }));
        }
      }
    });

    server.addEventListener("close", () => this.sessions.delete(server));
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const id = env.NOTEPAD_ROOM.idFromName("global-note");
    return env.NOTEPAD_ROOM.get(id).fetch(request);
  }
};