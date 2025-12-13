// js/ServerAPI.js

const BASE_URL = "http://twserver.alunos.dcc.fc.up.pt:8008";

export const GROUP_ID = 32;

/**
 * Função genérica para POST em JSON.
 * Lança Error se vier { error: "..." } ou HTTP != 200.
 */
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
    data = {};
  }

  if (!res.ok || data.error) {
    const msg = data.error || `HTTP error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * /register
 * Regista ou autentica jogador.
 */
export function register(nick, password) {
  return post("register", { nick, password });
}

/**
 * /join
 * Junta-se (ou cria) um jogo online.
 */
export function join(group, nick, password, size) {
  return post("join", { group, nick, password, size });
}

/**
 * /leave
 */
export function leave(nick, password, game) {
  return post("leave", { nick, password, game });
}

/**
 * /roll
 */
export function roll(nick, password, game) {
  return post("roll", { nick, password, game });
}

/**
 * /notify
 * CORRIGIDO: o parâmetro é 'cell', não 'move'
 */
export function notify(nick, password, game, cell) {
  return post("notify", { nick, password, game, cell });
}

/**
 * /pass
 */
export function passTurn(nick, password, game) {
  return post("pass", { nick, password, game });
}

/**
 * /ranking
 */
export function getRanking(group, size) {
  return post("ranking", { group, size });
}

/**
 * /update (Server-Sent Events)
 */
export function openUpdateStream(nick, game, onMessage, onError) {
  const url = `${BASE_URL}/update?nick=${encodeURIComponent(
    nick
  )}&game=${encodeURIComponent(game)}`;

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
    if (onError) onError(err);
  };

  return es;
}