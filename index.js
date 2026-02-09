/**
 * FULL index.js (Worker)
 */
const ANIMALS = ["Puffy Panda", "Grumpy Gopher", "Sly Snake", "Happy Hippo", "Daring Duck", "Lazy Lion"];

export class NotepadRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Map(); // Map socket -> { name, cursor }

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

    // Assign a random animal name to this specific socket
    const name = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    this.sessions.set(server, { name, cursor: 0 });

    // Send current note content and assigned name to the new user
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
        const session = this.sessions.get(server);
        if (session) session.cursor = data.pos;
      }

      // Broadcast update and the full list of active users to everyone
      const presence = Array.from(this.sessions.values());
      for (let [socket, info] of this.sessions) {
        socket.send(JSON.stringify({ ...data, presence }));
      }
    });

    server.addEventListener("close", () => {
      this.sessions.delete(server);
      // Broadcast updated presence list after someone leaves
      const presence = Array.from(this.sessions.values());
      for (let [socket, info] of this.sessions) {
        socket.send(JSON.stringify({ type: 'presence', presence }));
      }
    });

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