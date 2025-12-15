// js/ServerAPI.js

export class ServerAPI {
  /**
   * @param {string} baseUrl e.g. "http://twserver.alunos.dcc.fc.up.pt:8008"
   */
  constructor(baseUrl) {
    this.baseUrl = (baseUrl || "").replace(/\/+$/, "");
  }

  async post(endpoint, payload) {
    const url = `${this.baseUrl}/${endpoint}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
    }

    if (!res.ok) {
      const msg = data?.error || `HTTP ${res.status} (${endpoint})`;
      const err = new Error(msg);
      err.server = data;
      throw err;
    }
    if (data?.error) {
      //  when server returns 200 with error payload
      const err = new Error(data.error);
      err.server = data;
      throw err;
    }
    return data ?? {};
  }

  //endpoints
  register(nick, password) {
    return this.post("register", { nick, password });
  }
  join(group, nick, password, size) {
    return this.post("join", { group, nick, password, size });
  }
  leave(nick, password, game) {
    return this.post("leave", { nick, password, game });
  }
  roll(nick, password, game) {
    return this.post("roll", { nick, password, game });
  }
  pass(nick, password, game) {
    return this.post("pass", { nick, password, game });
  }
  notify(nick, password, game, cell) {
    return this.post("notify", { nick, password, game, cell });
  }
  ranking(group, size) {
    return this.post("ranking", { group, size });
  }

  /**
   * Start Server-Sent Events stream for updates.
   * @returns {EventSource}
   */
  openUpdateStream(game, nick, onMessage, onError) {
    const url = `${this.baseUrl}/update?game=${encodeURIComponent(game)}&nick=${encodeURIComponent(nick)}`;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      if (!ev?.data) return;
      try {
        const data = JSON.parse(ev.data);
        onMessage?.(data);
      } catch (e) {
        console.error("Bad SSE payload:", e);
      }
    };
    es.onerror = (err) => {
      onError?.(err);
    };
    return es;
  }
}
