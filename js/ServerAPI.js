// js/ServerAPI.js
const BASE_URL = "http://twserver.alunos.dcc.fc.up.pt:8008";
export const GROUP_ID = 32;

async function post(path, body) {
  const res = await fetch(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = { error: "Invalid JSON from server" };
  }
  return data;
}

export function register(nick, password) {
  return post("register", { nick, password });
}

export function join(group, nick, password, size) {
  return post("join", { group, nick, password, size });
}

export function leave(nick, password, game) {
  return post("leave", { nick, password, game });
}

export function roll(nick, password, game) {
  return post("roll", { nick, password, game });
}

export function notify(nick, password, game, cell) {
  return post("notify", { nick, password, game, cell });
}

export function passTurn(nick, password, game) {
  return post("pass", { nick, password, game });
}

export function getRanking(group, size) {
  return post("ranking", { group, size });
}

// update é especial: usa Server-Sent Events (EventSource)
export function openUpdateStream(nick, game, onMessage, onError) {
  const url = `${BASE_URL}/update?nick=${encodeURIComponent(nick)}&game=${encodeURIComponent(game)}`;
  const es = new EventSource(url);

  es.onmessage = (event) => {
    if (!event.data) return;
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (e) {
      console.error("Invalid update JSON", e);
    }
  };

  es.onerror = (err) => {
    console.error("SSE error", err);
    onError?.(err);
  };

  return es; // para poderes fechar mais tarde: es.close()
}
